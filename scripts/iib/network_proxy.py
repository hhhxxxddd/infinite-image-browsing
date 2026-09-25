"""Shared outbound proxy settings for optional external services."""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from urllib.parse import urlsplit

import requests
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field

from scripts.iib.db.datamodel import DataBase, GlobalSetting

SETTING_KEY = "network_proxy"
PROXY_ENV_KEYS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy")


class ProxySettingsRequest(BaseModel):
    enabled: bool = False
    url: str = Field(default="", max_length=2048)


def proxy_settings() -> dict:
    saved = GlobalSetting.get_setting(DataBase.get_conn(), SETTING_KEY)
    saved = saved if isinstance(saved, dict) else {}
    return {"enabled": saved.get("enabled") is True, "url": saved.get("url") or ""}


def save_proxy_settings(req: ProxySettingsRequest) -> dict:
    url = req.url.strip()
    if req.enabled and not url:
        raise HTTPException(400, detail="启用代理前请填写代理地址")
    if url:
        try:
            parsed = urlsplit(url)
            valid = (parsed.scheme in ("http", "https") and bool(parsed.hostname)
                     and parsed.username is None and parsed.password is None
                     and parsed.path in ("", "/") and not parsed.query and not parsed.fragment)
            _ = parsed.port
        except ValueError:
            valid = False
        if not valid:
            raise HTTPException(400, detail="代理地址应为 http://主机:端口 或 https://主机:端口，且不包含账号密码")
    settings = {"enabled": req.enabled, "url": url}
    GlobalSetting.save_setting(DataBase.get_conn(), SETTING_KEY, json.dumps(settings))
    return settings


def requests_proxy_kwargs() -> dict:
    settings = proxy_settings()
    if not settings["enabled"]:
        # Explicit None entries keep Requests from merging process proxy variables.
        return {"proxies": {"http": None, "https": None, "all": None}}
    return {"proxies": {"http": settings["url"], "https": settings["url"]}}


def download_environment() -> dict[str, str]:
    """Build an isolated child-process environment for Hugging Face downloads."""
    env = os.environ.copy()
    settings = proxy_settings()
    for key in PROXY_ENV_KEYS:
        env.pop(key, None)
    if settings["enabled"]:
        env["HTTP_PROXY"] = settings["url"]
        env["HTTPS_PROXY"] = settings["url"]
        env["http_proxy"] = settings["url"]
        env["https_proxy"] = settings["url"]
    return env


@contextmanager
def bundled_download_environment():
    """Fallback for frozen executables that cannot spawn a Python worker script."""
    desired = download_environment()
    original = {key: os.environ.get(key) for key in PROXY_ENV_KEYS}
    try:
        for key in PROXY_ENV_KEYS:
            if key in desired:
                os.environ[key] = desired[key]
            else:
                os.environ.pop(key, None)
        yield
    finally:
        for key, value in original.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


def mount_network_proxy_routes(app: FastAPI, db_api_base: str, verify_secret, write_permission_required):
    @app.get(db_api_base + "/network-proxy", dependencies=[Depends(verify_secret)])
    def get_network_proxy():
        return proxy_settings()

    @app.put(db_api_base + "/network-proxy", dependencies=[Depends(verify_secret), Depends(write_permission_required)])
    def put_network_proxy(req: ProxySettingsRequest):
        return save_proxy_settings(req)

    @app.get(db_api_base + "/network-proxy/check", dependencies=[Depends(verify_secret)])
    def check_network_proxy():
        if not proxy_settings()["enabled"]:
            return {"ready": False, "detail": "请先启用并保存代理"}
        try:
            with requests.get("https://api.comfy.org/v2/models", timeout=(5, 10),
                              stream=True, **requests_proxy_kwargs()) as response:
                return {"ready": response.status_code < 500,
                        "detail": "已连接到 Comfy Router" if response.status_code < 500
                        else f"Comfy Router 返回 HTTP {response.status_code}"}
        except requests.RequestException:
            return {"ready": False, "detail": "无法通过代理连接 Comfy Router；请检查代理地址和服务状态"}
