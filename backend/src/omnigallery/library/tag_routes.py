import os
import sqlite3
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel

from omnigallery.config import (
    locale,
)
from omnigallery.infrastructure.auth import verify_secret, write_permission_required
from omnigallery.infrastructure.database import Database
from omnigallery.infrastructure.route_context import RouteContext
from omnigallery.infrastructure.sequence import seq
from omnigallery.library.indexing import add_image_data_single, update_image_data
from omnigallery.library.media_repository import Media
from omnigallery.library.media_types import is_valid_media_path
from omnigallery.library.request_schemas import PathsRequest
from omnigallery.library.tag_repository import MediaTag, Tag


class UpdateTagRequest(BaseModel):
    id: int
    color: str | None = None
    group_name: str | None = None


class TagGroupRequest(BaseModel):
    name: str
    new_name: str | None = None


class RenameCustomTagRequest(BaseModel):
    id: int
    name: str


class ToggleCustomTagToImgRequest(BaseModel):
    img_path: str
    tag_id: int


class SetCustomTagsRequest(BaseModel):
    img_path: str
    tag_ids: list[int]


class BatchUpdateImageRequest(BaseModel):
    img_paths: list[str]
    action: Literal["add", "remove"]
    tag_id: int


class AddCustomTagRequest(BaseModel):
    tag_name: str
    group_name: str = ""


class RemoveCustomTagRequest(BaseModel):
    tag_id: int


class RemoveCustomTagFromRequest(BaseModel):
    img_id: int
    tag_id: str


def mount_routes(app: FastAPI, context: RouteContext):
    update_extra_paths = context.update_extra_paths
    is_path_under_parents = context.is_path_under_parents
    api_base = context.api_base

    @app.put(
        api_base + "/media_custom_tags",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def set_media_custom_tags(req: SetCustomTagsRequest):
        path = os.path.normpath(req.img_path)
        context.check_path_trust(path)
        conn = Database.get_connection()
        img = Media.get(conn, path)
        if not img:
            raise HTTPException(404, "Media is not indexed")
        try:
            MediaTag.set_custom_tags(conn, img.id, req.tag_ids)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return MediaTag.get_tags_for_image(conn, img.id, type="custom")

    @app.get(api_base + "/img_selected_custom_tag", dependencies=[Depends(verify_secret)])
    def get_img_selected_custom_tag(path: str):
        path = os.path.normpath(path)
        if not is_valid_media_path(path):
            return []
        conn = Database.get_connection()
        update_extra_paths(conn)
        if not is_path_under_parents(path):
            return []
        img = Media.get(conn, path)
        if not img:
            if Media.count(conn) == 0:
                return []
            update_image_data([os.path.dirname(path)])
            img = Media.get(conn, path)
        assert img
        # tags = Tag.get_all_custom_tag()
        return MediaTag.get_tags_for_image(conn, img.id, type="custom")

    @app.post(api_base + "/get_image_tags", dependencies=[Depends(verify_secret)])
    def get_img_tags(req: PathsRequest):
        conn = Database.get_connection()
        return MediaTag.batch_get_tags_by_path(conn, req.paths)

    @app.post(
        api_base + "/update_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def update_tag(req: UpdateTagRequest):
        conn = Database.get_connection()
        tag = Tag.get(conn, req.id)
        if not tag or tag.type != "custom":
            raise HTTPException(404, "找不到自定义标签")
        if (
            req.group_name is not None
            and req.group_name
            and req.group_name not in Tag.get_groups(conn)
        ):
            raise HTTPException(400, "标签分组不存在")
        with conn:
            if req.color is not None:
                conn.execute("UPDATE tag SET color = ? WHERE id = ?", (req.color, req.id))
            if req.group_name is not None:
                conn.execute("UPDATE tag SET group_name = ? WHERE id = ?", (req.group_name, req.id))
        return Tag.get(conn, req.id)

    @app.get(api_base + "/tag_groups", dependencies=[Depends(verify_secret)])
    def get_tag_groups():
        return Tag.get_groups(Database.get_connection())

    @app.post(
        api_base + "/create_tag_group",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def create_tag_group(req: TagGroupRequest):
        try:
            Tag.create_group(Database.get_connection(), req.name)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        except sqlite3.IntegrityError as error:
            raise HTTPException(409, "分组名称已存在") from error
        return Tag.get_groups(Database.get_connection())

    @app.post(
        api_base + "/rename_tag_group",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def rename_tag_group(req: TagGroupRequest):
        try:
            Tag.rename_group(Database.get_connection(), req.name, req.new_name or "")
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return Tag.get_groups(Database.get_connection())

    @app.post(
        api_base + "/delete_tag_group",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def delete_tag_group(req: TagGroupRequest):
        Tag.remove_group(Database.get_connection(), req.name)
        return Tag.get_groups(Database.get_connection())

    @app.post(
        api_base + "/rename_custom_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def rename_custom_tag(req: RenameCustomTagRequest):
        conn = Database.get_connection()
        try:
            tag, old_name = Tag.rename_custom(conn, req.id, req.name)
        except ValueError as error:
            raise HTTPException(
                409 if str(error) == "标签名称已存在" else 400, str(error)
            ) from error
        if tag.name != old_name:
            from omnigallery.library.auto_tag import AutoTagMatcher

            AutoTagMatcher.reload_rules(conn)
        return tag

    @app.post(
        api_base + "/toggle_custom_tag_to_img",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def toggle_custom_tag_to_img(req: ToggleCustomTagToImgRequest):
        conn = Database.get_connection()
        path = os.path.normpath(req.img_path)
        update_extra_paths(conn)
        if not is_path_under_parents(path):
            raise HTTPException(
                400,
                "当前文件不在扫描目录内，请先添加所在文件夹。"
                if locale == "zh"
                else "The current file is outside the scanned folders. Add its folder first.",
            )
        img = Media.get(conn, path)
        if not img:
            if Media.count(conn):
                # update_image_data([os.path.dirname(path)])
                add_image_data_single(path)
                img = Media.get(conn, path)
            else:
                raise HTTPException(
                    400,
                    "请先添加并扫描目录" if locale == "zh" else "Add and scan a folder first.",
                )
        tags = MediaTag.get_tags_for_image(
            conn=conn, media_id=img.id, type="custom", tag_id=req.tag_id
        )
        is_remove = len(tags)
        if is_remove:
            MediaTag.remove(conn, img.id, tags[0].id)
        else:
            MediaTag(img.id, req.tag_id).save(conn)
        conn.commit()
        return {"is_remove": is_remove}

    @app.post(
        api_base + "/batch_update_image_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def batch_update_image_tag(req: BatchUpdateImageRequest):
        conn = Database.get_connection()
        paths: list[str] = seq(req.img_paths).map(os.path.normpath).to_list()
        update_extra_paths(conn)
        for path in paths:
            if not is_path_under_parents(path):
                raise HTTPException(
                    400,
                    "当前文件不在扫描目录内，请先添加所在文件夹。"
                    if locale == "zh"
                    else "The current file is outside the scanned folders. Add its folder first.",
                )
            img = Media.get(conn, path)
            if not img:
                if Media.count(conn):
                    add_image_data_single(path)
                    img = Media.get(conn, path)
                else:
                    raise HTTPException(
                        400,
                        "请先添加并扫描目录" if locale == "zh" else "Add and scan a folder first.",
                    )
        with conn:
            for path in paths:
                img = Media.get(conn, path)
                if req.action == "add":
                    MediaTag(img.id, req.tag_id).save_or_ignore(conn)
                else:
                    MediaTag.remove(conn, img.id, req.tag_id)

    @app.post(
        api_base + "/add_custom_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def add_custom_tag(req: AddCustomTagRequest):
        conn = Database.get_connection()
        if req.group_name and req.group_name not in Tag.get_groups(conn):
            raise HTTPException(400, "标签分组不存在")
        tag = Tag.get_or_create(conn, name=req.tag_name, type="custom")
        if tag is None:
            raise HTTPException(400, "Invalid tag name")
        if req.group_name:
            conn.execute("UPDATE tag SET group_name = ? WHERE id = ?", (req.group_name, tag.id))
            tag.group_name = req.group_name
        conn.commit()
        return tag

    @app.post(
        api_base + "/remove_custom_tag",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def remove_custom_tag(req: RemoveCustomTagRequest):
        conn = Database.get_connection()
        MediaTag.remove(conn, tag_id=req.tag_id)
        Tag.remove(conn, req.tag_id)

    @app.post(
        api_base + "/remove_custom_tag_from_img",
        dependencies=[Depends(verify_secret), Depends(write_permission_required)],
    )
    def remove_custom_tag_from_img(req: RemoveCustomTagFromRequest):
        conn = Database.get_connection()
        MediaTag.remove(conn, media_id=req.img_id, tag_id=req.tag_id)
