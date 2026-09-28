from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from omnigallery.ai.chat_routes import mount_routes as mount_ai_chat_routes
from omnigallery.ai.image_routes import mount_image_ai_routes
from omnigallery.ai.models.desktop_runtime import mount_runtime_routes
from omnigallery.ai.models.manager import mount_qwen_model_manager_routes
from omnigallery.ai.models.qwen_instruct import mount_qwen3_vl_instruct_routes
from omnigallery.config import (
    AI_MODEL,
    EMBEDDING_MODEL,
    OPENAI_API_KEY,
    OPENAI_BASE_URL,
    TWELVELABS_API_KEY,
    enable_access_control,
    index_html_path,
)
from omnigallery.image_editing.routes import mount_routes as mount_image_editing_routes
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.network_proxy import mount_network_proxy_routes
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.infrastructure.web_routes import mount_routes as mount_infrastructure_web_routes
from omnigallery.library.content_routes import mount_routes as mount_library_content_routes
from omnigallery.library.file_routes import mount_routes as mount_library_file_routes
from omnigallery.library.folder_icons import mount_folder_icon_routes
from omnigallery.library.index_routes import mount_routes as mount_library_index_routes
from omnigallery.library.organize import mount_organize_routes
from omnigallery.library.tag_routes import mount_routes as mount_library_tag_routes
from omnigallery.metadata.audio import mount_audio_routes
from omnigallery.metadata.routes import mount_routes as mount_metadata_routes
from omnigallery.search.qwen import mount_qwen3_vl_routes
from omnigallery.search.routes import mount_routes as mount_search_routes
from omnigallery.search.similarity import mount_similarity_routes
from omnigallery.search.tag_graph import mount_tag_graph_routes
from omnigallery.search.topics.routes import mount_topic_cluster_routes
from omnigallery.settings.routes import mount_routes as mount_settings_routes
from omnigallery.storage.routes import mount_routes as mount_storage_routes
from omnigallery.workspaces.artifacts import mount_workspace_artifact_routes
from omnigallery.workspaces.state import mount_workspace_state_routes


@asynccontextmanager
async def _lifespan(app: FastAPI):
    # The first connection initializes the schema; load persisted library roots
    # before serving any route, independently of the frontend's request order.
    app.state.context.update_extra_paths(Database.get_connection())
    yield


def mount_routes(app: FastAPI, **options):
    context = RouteContext(options=options)
    context.update_all_scanned_paths()
    app.state.context = context
    if options.get("allow_cors"):
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["*"],
            allow_headers=["*"],
            allow_credentials=True,
        )
    mount_settings_routes(app, context)
    mount_library_file_routes(app, context)
    mount_library_content_routes(app, context)
    mount_metadata_routes(app, context)
    mount_image_editing_routes(app, context)
    mount_storage_routes(app, context)
    mount_infrastructure_web_routes(app, context)
    mount_library_index_routes(app, context)
    mount_search_routes(app, context)
    mount_library_tag_routes(app, context)
    mount_ai_chat_routes(app, context)
    api_base = context.api_base
    mount_workspace_state_routes(app, api_base, verify_secret, write_permission_required)
    check_path_trust = context.check_path_trust
    is_path_trusted = context.is_path_trusted
    mount_audio_routes(app, api_base, verify_secret, check_path_trust)

    mount_similarity_routes(app, api_base, verify_secret, is_path_trusted, enable_access_control)

    mount_qwen3_vl_instruct_routes(
        app, api_base, verify_secret, write_permission_required, is_path_trusted
    )

    mount_image_ai_routes(app, api_base, verify_secret, write_permission_required, is_path_trusted)

    mount_workspace_artifact_routes(
        app,
        api_base,
        verify_secret,
        write_permission_required,
        options.get("extra_paths_cli", []),
        check_path_trust=check_path_trust,
    )

    mount_network_proxy_routes(app, api_base, verify_secret, write_permission_required)

    mount_folder_icon_routes(app, api_base, verify_secret, write_permission_required)

    mount_runtime_routes(app, api_base, verify_secret, write_permission_required)

    mount_qwen_model_manager_routes(app, api_base, verify_secret, write_permission_required)

    mount_qwen3_vl_routes(app, api_base, verify_secret, write_permission_required, is_path_trusted)

    topic_cluster_funcs = mount_topic_cluster_routes(
        app=app,
        api_base=api_base,
        verify_secret=verify_secret,
        write_permission_required=write_permission_required,
        check_path_trust=check_path_trust,
        openai_base_url=OPENAI_BASE_URL,
        openai_api_key=OPENAI_API_KEY,
        twelvelabs_api_key=TWELVELABS_API_KEY,
        embedding_model=EMBEDDING_MODEL,
        ai_model=AI_MODEL,
    )

    mount_tag_graph_routes(
        app=app,
        api_base=api_base,
        verify_secret=verify_secret,
        check_path_trust=check_path_trust,
        is_path_trusted=is_path_trusted,
        embedding_model=EMBEDDING_MODEL,
        ai_model=AI_MODEL,
        openai_base_url=OPENAI_BASE_URL,
        openai_api_key=OPENAI_API_KEY,
    )

    mount_organize_routes(
        app=app,
        api_base=api_base,
        verify_secret=verify_secret,
        write_permission_required=write_permission_required,
        check_path_trust=check_path_trust,
        start_cluster_job_func=topic_cluster_funcs["start_cluster_job"],
        get_cluster_job_status_func=topic_cluster_funcs["get_cluster_job_status"],
    )

    return app


def create_app(**options) -> FastAPI:
    options.setdefault("launch_mode", "server")
    app = FastAPI(title="OmniGallery", lifespan=_lifespan)
    mount_routes(app, **options)

    @app.get("/", include_in_schema=False)
    def index():
        return FileResponse(index_html_path)

    return app
