"""Durable Cloud workflow and Router queue execution for the AI editor."""

import time
import uuid

import requests
from fastapi import HTTPException

from omnigallery.ai import image_configuration, image_defaults, image_providers, image_schemas
from omnigallery.ai.providers.comfy_cloud import (
    ComfyCloudV2,
    _error_code,
    _json_response,
    _retry_after,
)
from omnigallery.infrastructure.network_proxy import requests_proxy_kwargs
from omnigallery.workspaces.tasks import TaskCancelled, TaskInterrupted, task_lock


class RetryLater(Exception):
    def __init__(self, delay=3):
        self.delay = delay


def _json(response):
    try:
        value = response.json()
        if isinstance(value, dict):
            return value
    except ValueError:
        pass
    raise RetryLater()


def _check_response(response, expected, *, router=False, cancel=False):
    code = response.status_code
    error_type = response.headers.get("X-Comfy-Error-Type", "")
    if code in expected or (cancel and code == 409):
        return
    if (
        code == 429
        or code >= 500
        or (router and code == 409 and error_type == "concurrency_limit_exceeded")
    ):
        raise RetryLater(_retry_after(response) or 3)
    if code in (401, 403) and error_type != "not_enabled":
        raise TaskInterrupted("云端鉴权失败；检查 API Key 后可继续跟踪原任务")
    hints = {
        402: "额度不足",
        404: "模型或云端任务不存在",
        410: "云端结果已过期，无法取回",
        413: "输入图片过大",
        422: "模型不接受当前输入",
        409: "提交编号与输入不匹配",
    }
    if error_type == "not_enabled":
        detail = "当前账号或模型未开放 Router 队列；不会自动改用同步接口重复提交"
    else:
        detail = hints.get(code, "云端拒绝了请求，请检查配置")
    raise HTTPException(502, f"{detail}（HTTP {code}）")


def _handle_id(value):
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError) as error:
        raise RetryLater() from error


def _begin_submit(context):
    with task_lock:
        execution = context.read()
        if not execution.get("submitted_at"):
            if execution.get("cancel_requested"):
                raise TaskCancelled()
            execution = context.update(submitted_at=time.time(), phase="submitting")
        return execution


def _cloud(req, generation, context, key):
    cloud = ComfyCloudV2(key)
    delay = 3
    execution = context.read()
    if not execution.get("remote_id"):
        # Cloud v2 rejects duplicate keys without replaying the original handle.
        # Once admission is uncertain, never submit a new paid job automatically.
        if execution.get("submitted_at"):
            context.update(unrecoverable=True)
            raise TaskInterrupted(
                "Cloud 提交结果未确认，且未取得任务编号；请在云端检查，不能自动补发"
            )
        context.update(phase="uploading")
        graph = image_providers.prepare_cloud_studio(req, cloud, generation=generation)
        _begin_submit(context)
        try:
            response = cloud.submit_response(graph, idempotency_key=context.task_id)
        except requests.RequestException as error:
            context.update(unrecoverable=True)
            raise TaskInterrupted(
                "Cloud 提交响应丢失，未取得任务编号；请先在云端核对任务"
            ) from error
        if (
            response.status_code in (400, 401, 402, 403, 404, 413, 422)
            and _error_code(response) != "idempotency_key_reuse"
        ):
            # Explicit rejection: surface the provider's sanitized configuration error.
            context.update(remote_done=True)
            _json_response(response, "工作流提交", (201,))
        if response.status_code == 429:
            context.update(submitted_at=None)
            raise RetryLater(_retry_after(response) or 3)
        try:
            job = cloud.submitted_job(response)
        except (requests.RequestException, HTTPException) as error:
            context.update(unrecoverable=True)
            raise TaskInterrupted(
                "Cloud 提交未取得有效任务编号；请先在云端检查任务与额度，再决定是否新建任务"
            ) from error
        context.update(remote_id=job["id"], job={"id": job["id"], "urls": job["urls"]})
    else:
        response = cloud.read_response(execution["job"])
        _check_response(response, (200,))
        job = _json_response(response, "任务查询", (200,))
        delay = _retry_after(response) or 3
        if _handle_id(job.get("id")) != execution["remote_id"]:
            raise HTTPException(502, "云端返回的任务编号不匹配")
    execution = context.read()
    if (
        execution.get("cancel_requested")
        and not execution.get("cancel_sent")
        and job.get("status") not in ("succeeded", "failed", "canceled", "expired")
    ):
        response = cloud.read_response(execution["job"], cancel=True)
        _check_response(response, (200,))
        context.update(cancel_sent=True)
        # Poll remains authoritative, including when cancellation arrives too late.
    status = job.get("status")
    if status in ("succeeded", "failed", "canceled", "expired"):
        context.update(remote_done=True)
    if status == "canceled":
        raise TaskCancelled()
    if status in ("failed", "expired"):
        raise HTTPException(502, "Cloud 工作流执行失败或已过期，请在云端查看详情")
    if status == "succeeded":
        context.update(phase="downloading", queue_position=None)
        try:
            result = image_providers.collect_cloud_studio(req, cloud, job)
        except HTTPException as error:
            raise TaskInterrupted(str(error.detail) + "；可继续获取原任务结果") from error
        context.update(phase="saving")
        return result, 0
    if status not in ("queued", "running", "canceling"):
        raise RetryLater()
    context.update(phase="cloud_queued" if status == "queued" else "processing")
    return None, delay


def _router(req, context, key):
    base = f"{image_defaults.COMFY_ROUTER_URL}/{req.model}/requests"
    headers = {"X-API-Key": key}

    def call(method, url, **kwargs):
        return requests.request(
            method,
            url,
            headers=headers,
            timeout=(10, 45),
            allow_redirects=False,
            **requests_proxy_kwargs(),
            **kwargs,
        )

    execution = context.read()
    if not execution.get("remote_id"):
        payload = image_providers.router_studio_payload(req)
        execution = _begin_submit(context)
        if time.time() - execution["submitted_at"] > 23 * 3600:
            context.update(unrecoverable=True)
            raise TaskInterrupted(
                "Router 提交结果未确认，已接近幂等记录保留期限；请在云端检查，不能自动补发"
            )
        headers["Idempotency-Key"] = context.task_id
        response = call("POST", base, json=payload)
        if response.status_code in (400, 402, 404, 410, 413, 422):
            context.update(remote_done=True)
        _check_response(response, (201,), router=True)
        status = _json(response)
        remote_id = _handle_id(status.get("request_id"))
        context.update(remote_id=remote_id)
        headers.pop("Idempotency-Key", None)
    else:
        remote_id = execution["remote_id"]
        response = call("GET", f"{base}/{remote_id}/status")
        _check_response(response, (200,), router=True)
        status = _json(response)
        if _handle_id(status.get("request_id")) != remote_id:
            raise HTTPException(502, "Router 返回的任务编号不匹配")
    execution = context.read()
    if (
        execution.get("cancel_requested")
        and not execution.get("cancel_sent")
        and status.get("status") != "COMPLETED"
    ):
        cancelled = call("PUT", f"{base}/{remote_id}/cancel")
        _check_response(cancelled, (202,), router=True, cancel=True)
        context.update(cancel_sent=True)
    if status.get("status") == "COMPLETED":
        context.update(remote_done=True)
        error_type = status.get("error_type")
        if error_type == "cancelled":
            raise TaskCancelled()
        if error_type:
            hints = {
                "queue_timeout": "云端排队超时",
                "content_policy_violation": "输入或结果被模型拒绝",
                "insufficient_credits": "云端额度不足",
            }
            raise HTTPException(502, hints.get(error_type, "Router 执行失败，请在云端查看详情"))
        context.update(phase="downloading", queue_position=None)
        result = call("GET", f"{base}/{remote_id}")
        _check_response(result, (200, 202), router=True)
        if result.status_code == 202:
            return None, _retry_after(result) or 3
        try:
            parsed = image_providers.parse_router_studio_result(_json(result), remote_id)
        except HTTPException as error:
            # The paid job already finished. Preserve its handle and inputs so a CDN
            # failure can be resumed without generating (and charging for) a new image.
            raise TaskInterrupted(str(error.detail) + "；可继续获取原任务结果") from error
        context.update(phase="saving")
        return parsed, 0
    if status.get("status") not in ("IN_QUEUE", "IN_PROGRESS"):
        raise RetryLater()
    position = status.get("queue_position")
    context.update(
        phase="cloud_queued" if status["status"] == "IN_QUEUE" else "processing",
        queue_position=position if type(position) is int and position >= 0 else None,
    )
    return None, _retry_after(response) or 3


def run_image_task(payload, context):
    generation = payload["generation"]
    if payload["mode"] == "workflow":
        req = image_schemas.StudioEditRequest.model_validate(payload["request"])

        def run(key):
            return _cloud(req, generation, context, key)
    else:
        schema = (
            image_schemas.StudioRouterGenerationRequest
            if generation
            else image_schemas.StudioRouterEditRequest
        )
        req = schema.model_validate(payload["request"])

        def run(key):
            return _router(req, context, key)

    failures = 0
    while True:
        execution = context.read()
        if execution.get("cancel_requested") and not execution.get("submitted_at"):
            raise TaskCancelled()
        key, _ = image_configuration.comfy_cloud_key()
        if not key:
            raise TaskInterrupted("请配置 Comfy API Key 后继续跟踪原任务")
        try:
            result, delay = run(key)
            failures = 0
            if result is not None:
                return result
        except (requests.RequestException, RetryLater) as error:
            failures += 1
            if failures >= 12:
                raise TaskInterrupted("暂时无法连接云端；恢复连接后可继续跟踪原任务") from error
            context.update(phase="reconnecting")
            delay = max(getattr(error, "delay", 3), min(60, 2**failures))
        context.sleep(delay)
