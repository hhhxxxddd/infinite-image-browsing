from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.storage.project_files import migrate_storage, storage_settings


class ProjectStorageRequest(BaseModel):
    directory: str = ""


def mount_routes(app: FastAPI, context: RouteContext):
    api_base = context.api_base

    @app.get(api_base + "/project_storage", dependencies=[Depends(verify_secret)])
    def get_project_storage():
        return storage_settings()

    @app.put(
        api_base + "/project_storage",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def update_project_storage(req: ProjectStorageRequest):
        try:
            return migrate_storage(req.directory)
        except (ValueError, OSError) as error:
            raise HTTPException(400, str(error)) from error
