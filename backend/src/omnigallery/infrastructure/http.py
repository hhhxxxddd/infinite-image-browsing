import json

import requests

from omnigallery.config import is_dev


def accumulate_streaming_response(resp: requests.Response) -> str:
    """
    Accumulate content from a streaming HTTP response.

    Args:
        resp: The response object from requests.post with stream=True

    Returns:
        Accumulated text content from the stream
    """
    content_buffer = ""
    for raw in resp.iter_lines(decode_unicode=False):
        if not raw:
            continue
        # Ensure explicit UTF-8 decoding to avoid mojibake
        try:
            line = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else str(raw)
        except Exception:
            line = (
                raw.decode("utf-8", errors="replace")
                if isinstance(raw, (bytes, bytearray))
                else str(raw)
            )
        line = line.strip()
        if line.startswith("data: "):
            line = line[6:].strip()
        if line == "[DONE]":
            break
        try:
            obj = json.loads(line)
        except Exception:
            # Some providers may return partial JSON or non-JSON lines; skip
            continue
        # Try to extract incremental content (compat with OpenAI-style streaming)
        delta = (obj.get("choices") or [{}])[0].get("delta") or {}
        chunk_text = delta.get("content") or ""
        if chunk_text:
            try:
                if is_dev:
                    print(
                        f"[streaming] chunk_received len={len(chunk_text)} snippet={chunk_text[:200]}"
                    )
            except Exception:
                pass
            content_buffer += chunk_text

    return content_buffer.strip()
