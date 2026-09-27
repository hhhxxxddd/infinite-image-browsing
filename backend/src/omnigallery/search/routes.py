import os

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from omnigallery.config import is_dev
from omnigallery.infrastructure.auth import verify_secret
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.logging import logger
from omnigallery.infrastructure.paths import normalize_paths
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.library.media_repository import Media
from omnigallery.library.schemas import Cursor
from omnigallery.library.tag_repository import MediaTag
from omnigallery.search.filters import MediaSearchFilters
from omnigallery.search.size_filter import ImageSizeFilter


class SearchBySubstrRequest(MediaSearchFilters):
    surstr: str
    manual_order: bool = False
    cursor: str | None = ""
    regexp: str | None = ""
    folder_paths: list[str] = None
    size: int | None = 200
    filename_only: bool | None = False
    media_type: str | None = None  # "all", "image", "video", "audio"


class MatchImagesByTagsRequest(BaseModel):
    and_tags: list[int] | None = []
    or_tags: list[int] | None = []
    not_tags: list[int] | None = []
    cursor: str | None = ""
    folder_paths: list[str] = None
    size: int | None = 200
    random_sort: bool | None = False
    dimensions: ImageSizeFilter | None = None


def mount_routes(app: FastAPI, context: RouteContext):
    filter_allowed_files = context.filter_allowed_files
    api_base = context.api_base

    @app.post(api_base + "/search_by_substr", dependencies=[Depends(verify_secret)])
    def search_by_substr(req: SearchBySubstrRequest):
        if is_dev:
            logger.info(req)
        conn = Database.get_connection()
        folder_paths = normalize_paths(req.folder_paths or [], os.getcwd())
        if not folder_paths and req.folder_paths:
            return {"files": [], "cursor": Cursor(has_next=False)}
        filter_clauses, filter_params = req.sql_conditions(conn)
        from omnigallery.search.query import SearchQueryError

        try:
            imgs, next_cursor = Media.find_by_substring(
                conn=conn,
                substring=req.surstr,
                cursor=req.cursor,
                limit=req.size,
                regexp=req.regexp,
                folder_paths=folder_paths,
                filename_only=req.filename_only,
                media_type=req.media_type,
                filter_clauses=filter_clauses,
                filter_params=filter_params,
                manual_order=req.manual_order,
            )
        except SearchQueryError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return {
            "files": filter_allowed_files([x.to_file_info() for x in imgs]),
            "cursor": next_cursor,
        }

    @app.post(api_base + "/match_images_by_tags", dependencies=[Depends(verify_secret)])
    def match_image_by_tags(req: MatchImagesByTagsRequest):
        if is_dev:
            logger.info(req)
        conn = Database.get_connection()
        folder_paths = normalize_paths(req.folder_paths or [], os.getcwd())
        if not folder_paths and req.folder_paths:
            return {"files": [], "cursor": Cursor(has_next=False)}
        imgs, next_cursor = MediaTag.get_images_by_tags(
            conn=conn,
            tag_dict={"and": req.and_tags, "or": req.or_tags, "not": req.not_tags},
            cursor=req.cursor,
            folder_paths=folder_paths,
            limit=req.size,
            random_sort=req.random_sort,
            size_tag_ids=req.dimensions.matching_tag_ids(conn) if req.dimensions else None,
        )
        return {
            "files": filter_allowed_files([x.to_file_info() for x in imgs]),
            "cursor": next_cursor,
        }
