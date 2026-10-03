from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.storage.layout import storage
from omnigallery.storage.maintenance import clear_cache, usage
from omnigallery.storage.project_files import storage_settings


class ApplicationStorageRequest(BaseModel):
    directory: str = ""


def mount_routes(app: FastAPI, context: RouteContext):
    api_base = context.api_base

    @app.get(api_base + "/project_storage", dependencies=[Depends(verify_secret)])
    def get_project_storage():
        return storage_settings()

    @app.get(api_base + "/application_storage", dependencies=[Depends(verify_secret)])
    def get_application_storage():
        return storage.settings()

    @app.put(
        api_base + "/application_storage",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def update_application_storage(req: ApplicationStorageRequest):
        try:
            return storage.schedule(req.directory)
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error

    @app.get(api_base + "/application_storage/usage", dependencies=[Depends(verify_secret)])
    def storage_usage():
        return usage(storage.root)

    @app.post(
        api_base + "/application_storage/clear-cache",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def clean_cache():
        with storage.lock:
            try:
                return clear_cache(storage.root)
            except (OSError, ValueError) as error:
                raise HTTPException(400, str(error)) from error
