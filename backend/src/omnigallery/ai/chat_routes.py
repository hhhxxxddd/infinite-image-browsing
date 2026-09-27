import requests
from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from omnigallery.config import AI_MODEL, OPENAI_API_KEY, OPENAI_BASE_URL
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.logging import logger
from omnigallery.infrastructure.route_context import RouteContext


class AIChatRequest(BaseModel):
    messages: list[dict]
    temperature: float | None = 0.7
    max_tokens: int | None = None
    stream: bool | None = False


def mount_routes(app: FastAPI, context: RouteContext):
    api_base = context.api_base

    @app.post(
        f"{api_base}/ai-chat",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    async def ai_chat(req: AIChatRequest):
        """通用AI聊天接口，转发到OpenAI兼容API"""
        if not OPENAI_API_KEY:
            raise HTTPException(status_code=500, detail="OpenAI API Key not configured")

        try:
            payload = {
                "model": AI_MODEL,
                "messages": req.messages,
                "temperature": req.temperature,
                "stream": req.stream,
            }
            if req.max_tokens:
                payload["max_tokens"] = req.max_tokens

            headers = {
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            }

            response = requests.post(
                f"{OPENAI_BASE_URL}/chat/completions", json=payload, headers=headers, timeout=60
            )

            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail=response.text)

            return response.json()

        except requests.RequestException as e:
            logger.error(f"AI API request failed: {e}")
            raise HTTPException(status_code=500, detail=f"AI API request failed: {str(e)}") from e
