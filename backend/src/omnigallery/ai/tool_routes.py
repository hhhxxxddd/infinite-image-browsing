from fastapi import Depends, FastAPI

from omnigallery.ai import builtin_tools


def mount_routes(app: FastAPI, api_base: str, verify_secret, write_permission_required):
    @app.get(api_base + "/ai-tools/builtin", dependencies=[Depends(verify_secret)])
    def list_builtin_tools():
        return builtin_tools.catalog()

    @app.put(
        api_base + "/ai-tools/builtin/{tool_id}/defaults",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def save_builtin_defaults(tool_id: str, request: dict):
        return builtin_tools.save_defaults(tool_id, request)

    @app.get(
        api_base + "/ai-tools/builtin/{tool_id}/workflow", dependencies=[Depends(verify_secret)]
    )
    def get_builtin_workflow(tool_id: str):
        return builtin_tools.workflow_copy(tool_id)
