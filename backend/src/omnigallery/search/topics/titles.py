import asyncio
import json
import os
import re
import time

import requests
from fastapi import HTTPException

from omnigallery.infrastructure.http import accumulate_streaming_response
from omnigallery.infrastructure.logging import logger
from omnigallery.search.topics import embedding_requests, normalization

_TOPIC_NAMING_JSON_SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "type": "object",
    "properties": {
        "title": {"type": "string", "minLength": 1, "maxLength": 24},
        "keywords": {
            "type": "array",
            "minItems": 1,
            "maxItems": 6,
            "items": {"type": "string", "minLength": 1},
        },
    },
    "required": ["title", "keywords"],
    "additionalProperties": False,
}


def _call_chat_title_sync(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt_samples: list[str],
    output_lang: str,
    existing_keywords: list[str] | None = None,
    existing_folder_names: list[str] | None = None,
) -> dict | None:
    """
    Ask LLM to generate a short topic title and a few keywords. Returns dict or None.
    If existing_folder_names is provided, AI will prefer reusing an existing folder name
    if the theme matches, instead of generating a new title.
    """
    logger.info("[chat_title] === _call_chat_title_sync START ===")
    logger.info("[chat_title] base_url=%s model=%s lang=%s", base_url, model, output_lang)

    if not api_key:
        logger.error("[chat_title] API Key not configured")
        raise HTTPException(status_code=500, detail="OpenAI API Key not configured")

    logger.info("[chat_title] API Key configured (length=%s)", len(api_key))

    url = f"{embedding_requests._normalize_base_url(base_url)}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    logger.info("[chat_title] Request URL: %s", url)
    logger.info("[chat_title] Request model: %s", model)

    if "localhost" in base_url or "127.0.0.1" in base_url:
        logger.info("[chat_title] Detected local API request (Ollama/LocalAI): %s", base_url)

    samples = [
        (
            normalization._clean_prompt_for_semantic(normalization._clean_for_title(s) or s) or s
        ).strip()
        for s in prompt_samples
        if (s or "").strip()
    ]
    samples = [s[:400] for s in samples][:6]
    logger.info("[chat_title] Prompt samples count: %s", len(samples))

    if not samples:
        logger.error("[chat_title] No prompt samples for title generation")
        raise HTTPException(status_code=400, detail="No prompt samples for title generation")

    json_example = '{"title":"...","keywords":["...","..."]}'
    sys = (
        "You are a topic naming assistant for image-generation prompts.\n"
        "Given several prompt snippets that belong to the SAME theme, output:\n"
        "- a short topic title\n"
        "- 3–6 keywords.\n"
        "\n"
        "Rules:\n"
        f"- Output language MUST be: {output_lang}\n"
        "- Prefer 4–12 characters for Chinese (Simplified/Traditional), otherwise 2–6 English/German words.\n"
        "- Avoid generic boilerplate like: masterpiece, best quality, highly detailed, cinematic, etc.\n"
        "- Keep distinctive terms if they help differentiate themes (e.g., Warhammer 40K, Lolita, scientific illustration).\n"
        "- Do NOT output explanations. Do NOT output markdown/code fences.\n"
        "- The output MUST start with '{' and end with '}' (no leading/trailing characters).\n"
        "\n"
    )
    # Add existing folder names hint for file organization scenarios
    if existing_folder_names:
        folder_list = existing_folder_names[:100]  # Limit to 100 folders
        sys += (
            "IMPORTANT - Title Reuse:\n"
            "The following titles have been used before. "
            "If the theme matches one of them, you MUST reuse that exact title. "
            "Only create a new title if the theme is clearly different from ALL existing ones.\n"
            f"Existing titles: {', '.join(folder_list)}\n\n"
        )
    if existing_keywords:
        # Dynamic keyword selection based on total unique count
        unique_count = len(existing_keywords)
        top_keywords = existing_keywords[:500]  # Relaxed to 500

        # Tiered conditions based on keyword count
        if unique_count <= 200:
            # First 200: Not very strict, can create new keywords if not highly relevant
            strictness_msg = (
                "TIP: Prioritize selecting from the existing list if they fit reasonably well. "
                "Creating new keywords is ACCEPTABLE when existing ones don't capture the essence well.\n"
            )
        elif unique_count <= 500:
            # 200-500: Moderate strictness
            strictness_msg = (
                "IMPORTANT: Try to select from the existing list when reasonably applicable. "
                "Only create new keywords when existing ones clearly don't match.\n"
            )
        else:
            # 500+: Very strict, only create if completely unrelated
            strictness_msg = (
                "CRITICAL: You MUST select from the existing list unless the theme is COMPLETELY UNRELATED to all existing keywords. "
                "In almost all cases, use existing keywords.\n"
            )

        sys += strictness_msg
        sys += f"Existing keywords ({len(top_keywords)} of {unique_count} total): {', '.join(top_keywords)}\n\n"
    sys += "Output STRICT JSON only:\n" + json_example
    user = "Prompt snippets:\n" + "\n".join([f"- {s}" for s in samples])

    payload = {
        "model": model,
        "messages": [{"role": "system", "content": sys}, {"role": "user", "content": user}],
        "temperature": 0.0,
        "top_p": 1.0,
        "max_tokens": 4096,
        "stream": True,  # Enable streaming
        "response_format": {
            "type": "json_object",
            "schema": _TOPIC_NAMING_JSON_SCHEMA,
        },
    }
    # Some OpenAI-compatible providers may use different token limit fields / casing.
    payload["max_output_tokens"] = payload["max_tokens"]
    payload["max_completion_tokens"] = payload["max_tokens"]
    payload["maxOutputTokens"] = payload["max_tokens"]
    payload["maxCompletionTokens"] = payload["max_tokens"]

    # Parse JSON from streaming response.
    # Retry up to 5 times for: network errors, API errors, parsing failures.
    attempt_debug: list[dict] = []
    last_err = ""
    full_response_content = ""
    request_id = f"tc_{int(time.time() * 1000)}_{os.getpid()}"

    logger.info(
        "[topic_cluster][%s] LLM request: model=%s samples=%s existing_keywords=%s max_tokens=%s timeout=120",
        request_id,
        model,
        len(samples),
        len(existing_keywords) if existing_keywords else 0,
        payload.get("max_tokens", "N/A"),
    )
    logger.debug(
        "[topic_cluster][%s] LLM request payload: %s",
        request_id,
        json.dumps(payload, ensure_ascii=False, indent=2),
    )

    for attempt in range(1, 6):
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=120)
        except requests.RequestException as e:
            last_err = f"network_error: {type(e).__name__}: {e}"
            attempt_debug.append({"attempt": attempt, "reason": "network_error", "error": str(e)})
            logger.warning(
                "[topic_cluster][%s] llm_request_error attempt=%s err=%s",
                request_id,
                attempt,
                str(e),
            )
            continue

        # Retry on server-side errors (5xx) and rate limits (429), but not client errors (4xx except 429).
        if resp.status_code != 200:
            body = resp.text or ""
            status = 400 if resp.status_code == 401 else resp.status_code
            if resp.status_code == 429 or resp.status_code >= 500:
                last_err = f"api_error_retriable: status={status} body={body}"
                attempt_debug.append(
                    {
                        "attempt": attempt,
                        "reason": "api_error_retriable",
                        "status": status,
                        "body": body,
                    }
                )
                logger.warning(
                    "[topic_cluster][%s] llm_http_error attempt=%s status=%s body=%s",
                    request_id,
                    attempt,
                    status,
                    body,
                )
                continue
            # 4xx (except 429): fail immediately (client error, not retriable)
            logger.error(
                "[topic_cluster][%s] llm_http_client_error status=%s body=%s",
                request_id,
                status,
                body,
            )
            raise HTTPException(status_code=status, detail=body)

        try:
            # Use streaming response accumulation
            content = accumulate_streaming_response(resp)
            full_response_content = content
        except Exception as e:
            last_err = f"streaming_error: {type(e).__name__}: {e}"
            attempt_debug.append({"attempt": attempt, "reason": "streaming_error", "error": str(e)})
            logger.warning(
                "[topic_cluster][%s] llm_streaming_error attempt=%s err=%s",
                request_id,
                attempt,
                str(e),
            )
            continue

        logger.info(
            "[topic_cluster][%s] llm_response attempt=%s content_length=%s",
            request_id,
            attempt,
            len(content),
        )
        logger.debug("[topic_cluster][%s] llm_response content: %s", request_id, content)

        # Extract JSON from content
        m = re.search(r"\{[\s\S]*\}", content)
        if not m:
            last_err = f"no_json_object; content={content}"
            attempt_debug.append(
                {"attempt": attempt, "reason": "no_json_object", "content": content}
            )
            logger.warning(
                "[topic_cluster][%s] llm_no_json attempt=%s content=%s",
                request_id,
                attempt,
                content,
            )
            continue

        json_str = m.group(0)
        try:
            obj = json.loads(json_str)
        except Exception as e:
            last_err = f"json_parse_failed: {type(e).__name__}: {e}; json_str={json_str}"
            attempt_debug.append(
                {
                    "attempt": attempt,
                    "reason": "json_parse_failed",
                    "json_str": json_str,
                    "error": str(e),
                }
            )
            logger.warning(
                "[topic_cluster][%s] llm_json_parse_error attempt=%s err=%s json_str=%s",
                request_id,
                attempt,
                str(e),
                json_str,
            )
            continue

        if not isinstance(obj, dict):
            last_err = f"json_not_object; json_str={json_str}"
            attempt_debug.append(
                {"attempt": attempt, "reason": "json_not_object", "json_str": json_str}
            )
            logger.warning(
                "[topic_cluster][%s] llm_json_not_object attempt=%s json_str=%s",
                request_id,
                attempt,
                json_str,
            )
            continue

        title = str(obj.get("title") or "").strip()
        keywords = obj.get("keywords") or []
        if not title:
            last_err = f"missing_title; json_str={json_str}"
            attempt_debug.append(
                {"attempt": attempt, "reason": "missing_title", "json_str": json_str}
            )
            logger.warning(
                "[topic_cluster][%s] llm_missing_title attempt=%s json_str=%s",
                request_id,
                attempt,
                json_str,
            )
            continue
        if not isinstance(keywords, list):
            keywords = []
        keywords = [str(x).strip() for x in keywords if str(x).strip()][:6]
        logger.info(
            "[topic_cluster][%s] llm_success attempt=%s title=%s keywords=%s",
            request_id,
            attempt,
            title,
            keywords,
        )
        return {"title": title[:24], "keywords": keywords}

    # Exhausted retries
    dbg = json.dumps(attempt_debug, ensure_ascii=False)
    logger.error(
        "[topic_cluster][%s] llm_failed all_attempts=5 last_error=%s attempts=%s full_response=%s",
        request_id,
        last_err,
        dbg,
        full_response_content,
    )
    raise HTTPException(
        status_code=502,
        detail=f"Chat API JSON extraction failed after 5 attempts; request_id={request_id}; last_error={last_err}; attempts={dbg}",
    )


async def _call_chat_title(
    *,
    base_url: str,
    api_key: str,
    model: str,
    prompt_samples: list[str],
    output_lang: str,
    existing_keywords: list[str] | None = None,
    existing_folder_names: list[str] | None = None,
) -> dict:
    """
    Same rationale as embeddings:
    - requests.post() is synchronous and would block the event loop thread for tens of seconds.
    - Offload to a worker thread to keep other API requests responsive.
    """
    ret = await asyncio.to_thread(
        _call_chat_title_sync,
        base_url=base_url,
        api_key=api_key,
        model=model,
        prompt_samples=prompt_samples,
        output_lang=output_lang,
        existing_keywords=existing_keywords,
        existing_folder_names=existing_folder_names,
    )
    if not isinstance(ret, dict):
        raise HTTPException(status_code=502, detail="Chat API returned empty title payload")
    return ret
