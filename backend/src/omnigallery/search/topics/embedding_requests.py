import asyncio
import json
import os

import requests
from fastapi import HTTPException

from omnigallery.ai.providers.marengo import is_marengo_model, marengo_text_embeddings
from omnigallery.infrastructure.logging import logger

_EMBEDDING_MAX_TOKENS_SOFT = 7800


_EMBEDDING_REQUEST_MAX_TOKENS_SOFT = 7600


_EMBEDDING_DEBUG = os.getenv("OMNIGALLERY_EMBEDDING_DEBUG", "0").strip().lower() in [
    "1",
    "true",
    "yes",
    "on",
]


def _estimate_tokens_soft(s: str) -> int:
    """
    Lightweight, dependency-free token estimator.
    - ASCII-ish chars: ~4 chars per token (roughly OpenAI/BPE average for English)
    - Non-ASCII chars (CJK etc): ~1 char per token (conservative)
    This is intentionally conservative to avoid provider-side "max tokens exceeded" errors.
    """
    if not s:
        return 0
    ascii_chars = 0
    non_ascii = 0
    for ch in s:
        if ord(ch) < 128:
            ascii_chars += 1
        else:
            non_ascii += 1
    return (ascii_chars + 3) // 4 + non_ascii


def _truncate_for_embedding_tokens(s: str, max_tokens: int = _EMBEDDING_MAX_TOKENS_SOFT) -> str:
    """
    Truncate text to a conservative token budget.
    We do not rely on provider tokenizers to keep the system lightweight.
    """
    s = (s or "").strip()
    if not s:
        return ""
    if _estimate_tokens_soft(s) <= max_tokens:
        return s

    # Walk from start, stop when budget is reached.
    out = []
    tokens = 0
    ascii_bucket = 0  # count ascii chars; every 4 ascii chars ~= +1 token
    for ch in s:
        if ord(ch) < 128:
            ascii_bucket += 1
            if ascii_bucket >= 4:
                tokens += 1
                ascii_bucket = 0
        else:
            tokens += 1
        if tokens > max_tokens:
            break
        out.append(ch)
    return ("".join(out)).strip()


def _batched_by_token_budget(
    items: list[dict],
    *,
    max_items: int,
    max_tokens_sum: int,
) -> list[list[dict]]:
    """
    Split a list of items (each contains 'text') into batches constrained by:
    - max_items
    - sum(estimated_tokens(text)) <= max_tokens_sum
    """
    batches: list[list[dict]] = []
    cur: list[dict] = []
    cur_tokens = 0
    for it in items:
        txt = str(it.get("text") or "")
        t = _estimate_tokens_soft(txt)
        # ensure progress even if one item is huge (should already be truncated per-input)
        if cur and (len(cur) >= max_items or (cur_tokens + t) > max_tokens_sum):
            batches.append(cur)
            cur = []
            cur_tokens = 0
        cur.append(it)
        cur_tokens += t
    if cur:
        batches.append(cur)
    return batches


def _normalize_base_url(base_url: str) -> str:
    return base_url[:-1] if base_url.endswith("/") else base_url


def _call_embeddings_sync(
    *,
    inputs: list[str],
    model: str,
    base_url: str,
    api_key: str,
    tl_api_key: str | None = None,
) -> list[list[float]]:
    logger.info("[embeddings] === _call_embeddings_sync START ===")
    logger.info("[embeddings] base_url=%s model=%s n_inputs=%s", base_url, model, len(inputs))

    # Opt-in TwelveLabs Marengo backend: selected purely by the embedding model
    # name (e.g. EMBEDDING_MODEL=marengo3.0). Marengo is not OpenAI-compatible,
    # so it has its own dedicated key (TWELVELABS_API_KEY) and client; the
    # OpenAI path below is untouched otherwise.
    if is_marengo_model(model):
        return marengo_text_embeddings(inputs=inputs, model=model, api_key=tl_api_key or api_key)

    if not api_key:
        logger.error("[embeddings] API Key not configured")
        raise HTTPException(status_code=500, detail="OpenAI API Key not configured")

    logger.info("[embeddings] API Key configured (length=%s)", len(api_key))

    url = f"{_normalize_base_url(base_url)}/embeddings"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "input": inputs}

    logger.info("[embeddings] Request URL: %s", url)
    logger.info("[embeddings] Request model: %s", model)
    logger.info("[embeddings] Request n_inputs: %s", len(inputs))

    if "localhost" in base_url or "127.0.0.1" in base_url:
        logger.info("[embeddings] Detected local API request (Ollama/LocalAI): %s", base_url)

    logger.debug(
        "[embeddings] Request payload: %s",
        json.dumps(
            {"model": model, "input": ["(truncated)" if len(s) > 50 else s for s in inputs]},
            ensure_ascii=False,
        ),
    )

    try:
        logger.info("[embeddings] Initiating HTTP request, timeout=120s")
        resp = requests.post(url, json=payload, headers=headers, timeout=120)
        logger.info("[embeddings] HTTP request completed")
    except requests.exceptions.Timeout as e:
        logger.error("[embeddings] Request timeout: url=%s error=%s", url, str(e))
        logger.error("[embeddings] If using Ollama, ensure service is running: ollama serve")
        raise HTTPException(status_code=504, detail=f"Embedding API request timeout: {e}") from e
    except requests.exceptions.ConnectionError as e:
        logger.error("[embeddings] Connection failed: url=%s error=%s", url, str(e))
        logger.error("[embeddings] Please check if API address is correct and Ollama is running")
        raise HTTPException(status_code=502, detail=f"Embedding API connection failed: {e}") from e
    except requests.RequestException as e:
        logger.error(
            "[embeddings] Request failed: url=%s error=%s type=%s", url, str(e), type(e).__name__
        )
        raise HTTPException(status_code=502, detail=f"Embedding API request failed: {e}") from e

    logger.info(
        "[embeddings] Response: status=%s content_length=%s", resp.status_code, len(resp.content)
    )

    if resp.status_code != 200:
        status = 400 if resp.status_code == 401 else resp.status_code
        body = (resp.text or "")[:600]
        logger.error("[embeddings] Non-200 response: status=%s body=%s", status, body)
        if resp.status_code == 404:
            logger.error("[embeddings] 404 error, please check API address and model name")
        raise HTTPException(status_code=status, detail=body)

    try:
        data = resp.json()
    except Exception as e:
        logger.error("[embeddings] Failed to parse JSON: error=%s text=%s", str(e), resp.text[:500])
        raise HTTPException(status_code=500, detail="Invalid JSON response") from e

    items = data.get("data") or []
    items.sort(key=lambda x: x.get("index", 0))
    embeddings = [x.get("embedding") for x in items]

    if any(not isinstance(v, list) for v in embeddings):
        logger.error(
            "[embeddings] Invalid embeddings format: n_items=%s valid_embeddings=%s",
            len(items),
            sum(1 for v in embeddings if isinstance(v, list)),
        )
        raise HTTPException(status_code=500, detail="Invalid embeddings response format")

    logger.info(
        "[embeddings] Success: n_embeddings=%s dim=%s",
        len(embeddings),
        len(embeddings[0]) if embeddings else 0,
    )

    return embeddings


async def _call_embeddings(
    *,
    inputs: list[str],
    model: str,
    base_url: str,
    api_key: str,
    tl_api_key: str | None = None,
) -> list[list[float]]:
    """
    IMPORTANT:
    - We must NOT block FastAPI's event loop thread with a long-running synchronous HTTP request.
    - Use a thread offload for requests.post to keep the server responsive while waiting the embedding API.
    """
    return await asyncio.to_thread(
        _call_embeddings_sync,
        inputs=inputs,
        model=model,
        base_url=base_url,
        api_key=api_key,
        tl_api_key=tl_api_key,
    )
