"""Small, Cloud-scoped client for Comfy API v2 workflow jobs and assets."""

from __future__ import annotations

import io
import ipaddress
import re
import time
import uuid
from urllib.parse import urlsplit

import requests
from fastapi import HTTPException
from PIL import Image as PilImage
from PIL import UnidentifiedImageError

from scripts.iib.network_proxy import requests_proxy_kwargs

BASE_URL = "https://cloud.comfy.org"
API_URL = BASE_URL + "/api/v2"
_ERROR_HINTS = {
    "unauthorized": "API Key 无效",
    "forbidden": "当前 API Key 无权访问 Comfy Cloud",
    "insufficient_credits": "积分不足",
    "invalid_workflow": "工作流或节点输入无效",
    "workflow_format_ui": "请导入 API 格式的工作流 JSON",
    "missing_asset": "工作流引用的素材不存在",
    "input_blocked": "输入素材被云端拒绝",
    "queue_full": "云端队列已满",
    "rate_limited": "请求频率已达账号限制",
    "idempotency_key_reuse": "提交编号已使用；请检查云端任务后再重试",
}


def _error_code(response) -> str:
    try:
        payload = response.json()
    except (ValueError, TypeError):
        return ""
    error = payload.get("error") if isinstance(payload, dict) else None
    code = error.get("code") if isinstance(error, dict) else None
    return code if isinstance(code, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", code) else ""


def _retry_after(response) -> int | None:
    value = response.headers.get("Retry-After", "") if hasattr(response, "headers") else ""
    return min(int(value), 60) if isinstance(value, str) and value.isascii() and value.isdigit() else None


def _error_detail(response, action: str) -> str:
    code = _error_code(response)
    hint = _ERROR_HINTS.get(code)
    if not hint:
        hint = {401: "API Key 无效", 402: "积分不足", 403: "访问被拒绝",
                422: "输入或工作流无效", 429: "云端暂时限制请求"}.get(response.status_code, "请稍后重试")
    detail = f"Comfy Cloud {action}失败（HTTP {response.status_code}）：{hint}"
    if code and code not in _ERROR_HINTS:
        detail += f"（错误码 {code}）"
    retry_after = _retry_after(response)
    if response.status_code == 429 and retry_after is not None:
        detail += f"；建议 {retry_after} 秒后重试"
    return detail


def _json_response(response, action: str, expected: tuple[int, ...]) -> dict:
    if response.status_code not in expected:
        raise HTTPException(502, detail=_error_detail(response, action))
    try:
        payload = response.json()
    except (ValueError, TypeError) as error:
        raise HTTPException(502, detail=f"Comfy Cloud {action}返回内容无效") from error
    if not isinstance(payload, dict):
        raise HTTPException(502, detail=f"Comfy Cloud {action}返回内容无效")
    return payload


def _uuid(value: object, action: str) -> str:
    if not isinstance(value, str):
        raise HTTPException(502, detail=f"Comfy Cloud {action}未返回有效编号")
    try:
        return str(uuid.UUID(value))
    except ValueError as error:
        raise HTTPException(502, detail=f"Comfy Cloud {action}未返回有效编号") from error


def _cloud_job_url(job: dict) -> str:
    urls = job.get("urls")
    link = urls.get("self") if isinstance(urls, dict) else None
    if not isinstance(link, str):
        raise HTTPException(502, detail="Comfy Cloud 未返回任务查询地址")
    url = BASE_URL + link if link.startswith("/") and not link.startswith("//") else link
    try:
        parsed = urlsplit(url)
        port = parsed.port
    except ValueError as error:
        raise HTTPException(502, detail="Comfy Cloud 任务查询地址无效") from error
    if (parsed.scheme != "https" or parsed.hostname != "cloud.comfy.org" or port not in (None, 443)
            or parsed.username or parsed.password or not parsed.path.startswith("/api/v2/jobs/")):
        raise HTTPException(502, detail="Comfy Cloud 任务查询地址无效")
    return url


def _signed_url(location: str) -> bool:
    try:
        parsed = urlsplit(location)
        port = parsed.port
    except ValueError:
        return False
    try:
        address = ipaddress.ip_address(parsed.hostname or "")
    except ValueError:
        address = None
    return (parsed.scheme == "https" and bool(parsed.hostname) and not parsed.username and not parsed.password
            and port in (None, 443)
            and parsed.hostname.lower() != "localhost"
            and not parsed.hostname.lower().endswith((".localhost", ".local"))
            and (address is None or address.is_global))


class ComfyCloudV2:
    def __init__(self, key: str):
        self.key = key
        self.headers = {"Authorization": f"Bearer {key}"}

    def upload(self, data: bytes, filename: str, content_type: str) -> dict:
        file_path = f"iib-{uuid.uuid4()}-{filename}"
        response = requests.post(
            f"{API_URL}/assets", headers={**self.headers, "Idempotency-Key": str(uuid.uuid4())},
            files={"file": (file_path, data, content_type)},
            data={"content_type": content_type, "file_path": file_path}, timeout=(10, 60),
            allow_redirects=False,
            **requests_proxy_kwargs(),
        )
        asset = _json_response(response, "素材上传", (200, 201))
        asset_id = _uuid(asset.get("id"), "素材上传")
        return {"__type": "core/ASSET", "info": {"id": asset_id, "file_path": file_path}}

    def submit(self, graph: dict) -> dict:
        response = requests.post(
            f"{API_URL}/jobs", headers={**self.headers, "Idempotency-Key": str(uuid.uuid4())},
            json={"workflow": graph, "extra_data": {"api_key_comfy_org": self.key}},
            timeout=(10, 60), allow_redirects=False, **requests_proxy_kwargs(),
        )
        job = _json_response(response, "工作流提交", (201,))
        _uuid(job.get("id"), "工作流提交")
        _cloud_job_url(job)
        return job

    def wait(self, job: dict, timeout: int = 240) -> dict:
        url = _cloud_job_url(job)
        job_id = _uuid(job.get("id"), "工作流提交")
        deadline = time.monotonic() + timeout
        while True:
            status = job.get("status")
            if status == "succeeded":
                return job
            if status in ("failed", "canceled", "expired"):
                error = job.get("error")
                code = error.get("code") if isinstance(error, dict) else None
                node = error.get("node_id") if isinstance(error, dict) else None
                suffix = f"（错误码 {code}）" if isinstance(code, str) and re.fullmatch(r"[a-z][a-z0-9_]{0,63}", code) else ""
                if isinstance(node, str) and re.fullmatch(r"[\w-]{1,128}", node):
                    suffix += f"（节点 {node}）"
                raise HTTPException(502, detail=f"Comfy Cloud 工作流执行失败{suffix}；请在云端查看任务详情")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise HTTPException(504, detail="Comfy Cloud 工作流等待超时；任务可能仍在云端运行")
            time.sleep(min(2, remaining))
            response = requests.get(url, headers=self.headers, timeout=(10, 20),
                                    allow_redirects=False, **requests_proxy_kwargs())
            if response.status_code == 429:
                time.sleep(min(_retry_after(response) or 2, max(0, deadline - time.monotonic())))
                continue
            job = _json_response(response, "任务查询", (200,))
            if _uuid(job.get("id"), "任务查询") != job_id:
                raise HTTPException(502, detail="Comfy Cloud 任务查询返回了不匹配的编号")

    @staticmethod
    def output(job: dict, node_id: str, kind: str) -> dict:
        outputs = job.get("outputs")
        if not isinstance(outputs, list):
            raise HTTPException(502, detail="Comfy Cloud 任务结果格式无效")
        for output in outputs:
            if not isinstance(output, dict) or str(output.get("node_id")) != node_id:
                continue
            name = output.get("name", "")
            content_type = output.get("content_type", "")
            if kind == "image" and (output.get("type") == "image" or content_type in ("image/png", "image/jpeg", "image/webp")):
                return output
            if kind == "text" and (output.get("type") == "text" or isinstance(content_type, str) and
                                   (content_type.startswith("text/") or content_type == "application/json") or
                                   isinstance(name, str) and name.lower().endswith((".txt", ".md", ".json", ".csv"))):
                return output
        detail = ("指定输出节点没有返回图片；请检查工作流映射" if kind == "image" else
                  "指定输出节点没有返回文本文件；请将保存文本的节点设为输出节点")
        raise HTTPException(502, detail=detail)

    def download(self, output: dict, limit: int) -> bytes:
        asset_id = _uuid(output.get("id"), "结果下载")
        response = None
        try:
            response = requests.get(f"{API_URL}/assets/{asset_id}/content", headers=self.headers,
                                    timeout=(10, 20), allow_redirects=False, stream=True,
                                    **requests_proxy_kwargs())
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("Location", "")
                if not _signed_url(location):
                    raise HTTPException(502, detail="Comfy Cloud 文件下载地址无效")
                response.close()
                response = requests.get(location, timeout=(10, 60), allow_redirects=False, stream=True,
                                        **requests_proxy_kwargs())
            if response.status_code != 200:
                raise HTTPException(502, detail=_error_detail(response, "结果下载"))
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(502, detail="Comfy Cloud 输出文件过大")
                chunks.append(chunk)
            return b"".join(chunks)
        except requests.RequestException as error:
            raise HTTPException(502, detail="无法下载 Comfy Cloud 输出") from error
        finally:
            if response is not None:
                response.close()

    def download_text(self, output: dict) -> str:
        try:
            return self.download(output, 262_144).decode("utf-8-sig").strip()
        except UnicodeError as error:
            raise HTTPException(502, detail="Comfy Cloud 文本输出不是 UTF-8") from error

    def download_image(self, output: dict) -> tuple[bytes, str]:
        data = self.download(output, 24_000_000)
        try:
            with PilImage.open(io.BytesIO(data)) as image:
                mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(image.format)
                if not mime:
                    raise HTTPException(502, detail="Comfy Cloud 输出不是支持的图片格式")
                image.verify()
            return data, mime
        except (OSError, UnidentifiedImageError) as error:
            raise HTTPException(502, detail="Comfy Cloud 输出图片无效") from error


def check_connection(key: str) -> tuple[bool, str]:
    """v2 has no user endpoint: a read-only lookup of an unknown job tests auth."""
    try:
        response = requests.get(f"{API_URL}/jobs/{uuid.uuid4()}",
                                headers={"Authorization": f"Bearer {key}"}, timeout=(5, 10),
                                allow_redirects=False,
                                **requests_proxy_kwargs())
    except requests.RequestException:
        return False, "无法连接 Comfy Cloud v2"
    # Cloud currently returns job_not_found; the public v2 spec uses not_found.
    # A generic route/proxy 404 does not establish that authentication succeeded.
    if response.status_code == 404 and _error_code(response) in ("not_found", "job_not_found"):
        return True, "Comfy Cloud v2 API Key 有效；实际额度和节点权限将在提交时检查"
    if response.status_code == 200:
        return True, "Comfy Cloud v2 API Key 有效；实际额度和节点权限将在提交时检查"
    return False, _error_detail(response, "连接验证")
