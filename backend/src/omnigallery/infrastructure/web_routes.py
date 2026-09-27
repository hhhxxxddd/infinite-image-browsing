"""Static application assets and optional desktop lifecycle endpoint."""

import os

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from omnigallery.config import STATIC_ROOT
from omnigallery.infrastructure.route_context import RouteContext


def mount_routes(app: FastAPI, context: RouteContext):
    app.mount("/static", StaticFiles(directory=STATIC_ROOT, check_dir=False), name="static")

    @app.post(context.api_base + "/shutdown")
    async def shutdown_app():
        if not context.options.get("enable_shutdown"):
            raise HTTPException(status_code=403, detail="Shutdown is disabled.")
        os.kill(os.getpid(), 9)
        return {"message": "Application is shutting down."}
