import hashlib
import hmac
import os
from urllib.parse import urlencode

from fastapi import HTTPException, Request

mem = {"secret_key_hash": None}
secret_key = os.getenv("OMNIGALLERY_SECRET_KEY")
desktop_token = os.getenv("OMNIGALLERY_DESKTOP_TOKEN")


if secret_key:
    print("Secret key loaded successfully. ")


WRITEABLE_PERMISSIONS = ["read-write", "write-only"]


is_api_writeable = not (os.getenv("OMNIGALLERY_ACCESS_CONTROL_PERMISSION")) or (
    os.getenv("OMNIGALLERY_ACCESS_CONTROL_PERMISSION") in WRITEABLE_PERMISSIONS
)


async def write_permission_required():
    if not is_api_writeable:
        error_msg = (
            "User is not authorized to perform this action. Required permission: "
            + ", ".join(WRITEABLE_PERMISSIONS)
        )
        raise HTTPException(status_code=403, detail=error_msg)


async def verify_secret(request: Request):
    if desktop_token:
        token = request.headers.get("X-OmniGallery-Desktop-Token")
        query_token = request.query_params.get("desktop_token")
        if query_token is not None:
            # Native image/video elements cannot add request headers. Remove
            # their credential from the scope before access logs are emitted.
            request.scope["query_string"] = urlencode(
                [
                    (key, value)
                    for key, value in request.query_params.multi_items()
                    if key != "desktop_token"
                ]
            ).encode("ascii")
        token = token or query_token
        if not token or not hmac.compare_digest(
            token.encode("utf-8"), desktop_token.encode("utf-8")
        ):
            raise HTTPException(401, detail={"type": "desktop_verification_failed"})
        return
    if not secret_key:
        return
    token = request.cookies.get("OMNIGALLERY_SECRET")
    if not token:
        raise HTTPException(status_code=401, detail={"type": "secret_verification_failed"})
    if not mem["secret_key_hash"]:
        mem["secret_key_hash"] = hashlib.sha256(
            (secret_key + "_ciallo").encode("utf-8")
        ).hexdigest()
    if mem["secret_key_hash"] != token:
        raise HTTPException(status_code=401, detail={"type": "secret_verification_failed"})
