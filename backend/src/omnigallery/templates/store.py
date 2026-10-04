"""Versioned template packages and durable material copies used by inserted instances.

Manifests are the source of truth. The small SQLite catalog is rebuildable and is
only used for paged listing/search, keeping large editable documents out of lists.
"""

import base64
import copy
import hashlib
import io
import json
import math
import os
import re
import sqlite3
import tempfile
import uuid
from datetime import UTC, datetime

from PIL import Image

from omnigallery.storage.filesystem import checked_path
from omnigallery.storage.layout import storage, write_json
from omnigallery.storage.project_files import storage_operation, storage_root
from omnigallery.templates.comic_defaults import comic_templates
from omnigallery.templates.defaults import starter_templates

PAYLOAD_TYPES = {
    "text": "image-group-v1",
    "layout": "image-layout-v1",
    "image": "image-document-v1",
}

MAX_ASSET_BYTES = 64 * 1024 * 1024


def root():
    return checked_path(storage.root / "templates")


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", value):
        raise ValueError("模板编号无效")
    return value


def digest_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ValueError("模板素材编号无效")
    return value


def package(template_id):
    return checked_path(root() / "items" / identifier(template_id))


def material_path(asset_id):
    return checked_path(storage_root() / "template-assets" / (digest_id(asset_id) + ".blob"))


def asset_path(template_id, asset_id):
    record = read(template_id)
    if digest_id(asset_id) not in record["assets"]:
        raise ValueError("素材不属于此模板")
    return checked_path(package(template_id) / "assets" / (asset_id + ".blob"))


def write_bytes(path, data):
    path = checked_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, pending = tempfile.mkstemp(dir=path.parent, suffix=".pending")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
    finally:
        if os.path.exists(pending):
            os.unlink(pending)


def image_metadata(data):
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > 100_000_000:
            raise ValueError("模板图片超过一亿像素")
        if image.format not in ("PNG", "JPEG", "WEBP", "GIF", "BMP", "TIFF"):
            raise ValueError("模板图片格式不支持")
        result = dict(
            width=image.width,
            height=image.height,
            media_type=Image.MIME[image.format],
            bytes=len(data),
        )
        image.verify()
    return result


def validate_document(document, template_type="text"):
    if template_type not in ("text", "layout", "image"):
        raise ValueError("模板类型不支持")
    if len(json.dumps(document, allow_nan=False)) > 8_000_000:
        raise ValueError("模板文档过大")
    if document.get("version") != 2:
        raise ValueError("模板文档版本不支持")
    layers, groups = document.get("layers"), document.get("groups")
    if not isinstance(layers, list) or not 1 <= len(layers) <= 500:
        raise ValueError("模板需要包含 1 至 500 个图层")
    if (
        not isinstance(groups, list)
        or len(groups) > 500
        or any(not isinstance(g, dict) for g in groups)
    ):
        raise ValueError("模板分组无效")
    if template_type == "text" and len(groups) != 1:
        raise ValueError("文字模板必须是一个分组")
    group_ids = {identifier(group.get("id")) for group in groups}
    if len(group_ids) != len(groups):
        raise ValueError("模板分组编号重复")
    frame_ids = {
        layer.get("id")
        for layer in layers
        if isinstance(layer, dict) and layer.get("kind") == "frame"
    }
    for key in ("width", "height"):
        value = document.get(key)
        if (
            not isinstance(value, (int, float))
            or not math.isfinite(value)
            or not 1 <= value <= 16384
        ):
            raise ValueError("模板尺寸无效")
    if document["width"] * document["height"] > 100_000_000:
        raise ValueError("模板尺寸过大")
    ids = set()
    has_text = False
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("kind") not in (
            "image",
            "text",
            "shape",
            "frame",
        ):
            raise ValueError("文字模板支持文字、图片和矢量形状")
        layer_id = identifier(layer.get("id"))
        if (
            layer_id in ids
            or (layer.get("groupId") and layer["groupId"] not in group_ids)
            or (template_type == "text" and layer.get("groupId") not in group_ids)
        ):
            raise ValueError("模板图层分组或编号无效")
        ids.add(layer_id)
        if layer.get("frameId") and (layer["frameId"] not in frame_ids or layer["kind"] == "frame"):
            raise ValueError("画框引用无效，不支持嵌套画框")
        if template_type == "layout" and layer["kind"] != "frame":
            raise ValueError("版式模板只能包含画框")
        if layer["kind"] in ("frame", "shape"):
            shapes = ("rect", "ellipse", "polygon") + (
                ("speech", "thought", "burst") if layer["kind"] == "shape" else ()
            )
            if layer.get("shape") not in shapes:
                raise ValueError("矢量形状无效")
            for key in ("fill", "stroke"):
                value = layer.get(key)
                if not (
                    isinstance(value, str) and re.fullmatch(r"#[a-fA-F0-9]{6}", value)
                ) and not (key == "fill" and value == "transparent"):
                    raise ValueError("矢量颜色无效")
            for key in ("strokeWidth", "radius"):
                value = layer.get(key)
                if (
                    not isinstance(value, (int, float))
                    or not math.isfinite(value)
                    or not 0 <= value <= 1000
                ):
                    raise ValueError("矢量描边或圆角无效")
            points = layer.get("points")
            tail = layer.get("tail")
            if not isinstance(points, list) or len(points) != 4 or not isinstance(tail, dict):
                raise ValueError("矢量控制点无效")
            for point in [*points, tail]:
                if not isinstance(point, dict) or any(
                    not isinstance(point.get(k), (int, float))
                    or not math.isfinite(point[k])
                    or not 0 <= point[k] <= 1
                    for k in ("x", "y")
                ):
                    raise ValueError("矢量控制点超出边界")
        for key in ("x", "y", "width", "height", "rotation", "opacity"):
            value = layer.get(key)
            if (
                not isinstance(value, (int, float))
                or not math.isfinite(value)
                or abs(value) > 65536
            ):
                raise ValueError("模板图层几何数据无效")
        if layer["width"] <= 0 or layer["height"] <= 0 or not 0 <= layer["opacity"] <= 1:
            raise ValueError("模板图层尺寸或不透明度无效")
        if layer["kind"] == "text":
            if not isinstance(layer.get("text"), str) or len(layer["text"]) > 100_000:
                raise ValueError("模板文字无效或过长")
            has_text = True
        elif layer["kind"] == "image" and not isinstance(layer.get("path"), str):
            raise ValueError("模板图片路径无效")
    if template_type == "text" and not has_text:
        raise ValueError("分组中至少需要一个文字图层")


def read(template_id):
    record = json.loads(checked_path(package(template_id) / "manifest.json").read_text("utf-8"))
    if (
        record.get("version") != 1
        or record.get("type") not in PAYLOAD_TYPES
        or record.get("payload_type") != PAYLOAD_TYPES.get(record.get("type"))
    ):
        raise ValueError("模板版本暂不支持")
    return record


def summary(record):
    return {
        "has_preview": record.get("has_preview", False),
        **{
            key: record[key]
            for key in ("id", "name", "type", "payload_type", "created_at", "updated_at", "builtin")
        },
    }


def catalog():
    path = checked_path(root() / "catalog.sqlite")
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, "
        "type TEXT NOT NULL, updated_at TEXT NOT NULL, summary TEXT NOT NULL)"
    )
    try:
        if conn.execute("PRAGMA user_version").fetchone()[0] != 1:
            conn.execute("DELETE FROM templates")
            for manifest in (root() / "items").glob("*/manifest.json"):
                record = read(manifest.parent.name)
                index_record(conn, record)
            conn.execute("PRAGMA user_version = 1")
            conn.commit()
    except Exception:
        conn.close()
        raise
    return conn


def index_record(conn, record):
    conn.execute(
        "INSERT OR REPLACE INTO templates VALUES (?, ?, ?, ?, ?)",
        (
            record["id"],
            record["name"],
            record["type"],
            record["updated_at"],
            json.dumps(summary(record), ensure_ascii=False),
        ),
    )


def publish(record):
    # Invalidate catalog before changing the source of truth. Rebuild on next read,
    # including after a crash between manifest and index publication.
    checked_path(root() / "catalog.sqlite").unlink(missing_ok=True)
    write_json(checked_path(package(record["id"]) / "manifest.json"), record)


def record_for(template_id, name, document, assets, builtin=False, template_type="text"):
    stamp = datetime.now(UTC).isoformat()
    return dict(
        version=1,
        id=template_id,
        name=name,
        type=template_type,
        payload_type=PAYLOAD_TYPES[template_type],
        created_at=stamp,
        updated_at=stamp,
        builtin=builtin,
        document=document,
        assets=assets,
    )


@storage_operation
def ensure_defaults():
    root().mkdir(parents=True, exist_ok=True)
    marker = checked_path(root() / "seeded-v1.json")
    if not marker.exists():
        for template_id, document in starter_templates():
            if not (package(template_id) / "manifest.json").exists():
                publish(record_for(template_id, document["name"], document, {}, True))
        write_json(marker, {"version": 1})
    comic_marker = checked_path(root() / "seeded-comic-v1.json")
    if not comic_marker.exists():
        for kind, template_id, document in comic_templates():
            validate_document(document, kind)
            if not (package(template_id) / "manifest.json").exists():
                publish(record_for(template_id, document["name"], document, {}, True, kind))
        write_json(comic_marker, {"version": 1})  # Deleted starters stay deleted.


@storage_operation
def list_templates(query="", offset=0, limit=12, template_type="text"):
    ensure_defaults()
    conn = catalog()
    try:
        # instr treats user wildcards literally.
        where = "type = ? AND instr(lower(name), lower(?)) > 0"
        total = conn.execute(
            f"SELECT COUNT(*) FROM templates WHERE {where}", (template_type, query)
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT summary FROM templates WHERE {where} "
            "ORDER BY updated_at DESC, id LIMIT ? OFFSET ?",
            (template_type, query, limit, offset),
        )
        items = [json.loads(row[0]) for row in rows]
        conn.commit()
        return dict(items=items, total=total)
    finally:
        conn.close()


@storage_operation
def save(name, document, assets, preview="", template_type="text"):
    ensure_defaults()
    validate_document(document, template_type)
    preview_data = None
    if preview:
        if len(preview) > 2_000_000:
            raise ValueError("模板预览过大")
        preview_data = base64.b64decode(preview, validate=True)
        meta = image_metadata(preview_data)
        if meta["media_type"] != "image/png" or max(meta["width"], meta["height"]) > 1024:
            raise ValueError("模板预览必须是 1024 像素以内的 PNG 图片")
    document = copy.deepcopy(document)
    template_id = uuid.uuid4().hex
    used = {
        layer["path"] for layer in document["layers"] if layer["kind"] == "image" and layer["path"]
    }
    if (
        set(assets) != used
        or sum(len(value) for value in assets.values()) > MAX_ASSET_BYTES * 4 // 3
    ):
        raise ValueError("模板素材缺失或总大小超过 64 MB")
    metadata, blobs, paths = {}, {}, {}
    for path, encoded in assets.items():
        data = base64.b64decode(encoded, validate=True)
        digest = hashlib.sha256(data).hexdigest()
        metadata[digest] = image_metadata(data)
        blobs[digest] = data
        paths[path] = "asset:" + digest
    for layer in document["layers"]:
        if layer["kind"] == "image" and layer["path"]:
            layer["path"] = paths[layer["path"]]
    document["name"] = name
    for digest, data in blobs.items():
        write_bytes(package(template_id) / "assets" / (digest + ".blob"), data)
    record = record_for(template_id, name, document, metadata, template_type=template_type)
    if preview_data:
        write_bytes(package(template_id) / "preview.png", preview_data)
        record["has_preview"] = True
    publish(record)
    return summary(record)


@storage_operation
def public_document(template_id, instantiate=False):
    ensure_defaults()
    record = read(template_id)
    document = copy.deepcopy(record["document"])
    for layer in document["layers"]:
        if layer["kind"] != "image" or not layer["path"]:
            continue
        asset_id = digest_id(layer["path"].removeprefix("asset:"))
        source = asset_path(template_id, asset_id)
        if instantiate:
            target = material_path(asset_id)
            if not target.exists():
                data = source.read_bytes()
                if hashlib.sha256(data).hexdigest() != asset_id:
                    raise ValueError("模板素材校验失败")
                write_bytes(target, data)
            layer["path"] = "template-asset:" + asset_id
        else:
            layer["path"] = f"template-library:{template_id}:{asset_id}"
    return {**summary(record), "document": document}


@storage_operation
def rename(template_id, name):
    record = read(template_id)
    record.update(name=name, updated_at=datetime.now(UTC).isoformat())
    record["document"]["name"] = name
    publish(record)
    return summary(record)


@storage_operation
def delete(template_id):
    record = read(template_id)
    # Delete only manifest-owned files; inserted material copies are outside this package.
    paths = [asset_path(template_id, asset_id) for asset_id in record["assets"]]
    if record.get("has_preview"):
        paths.append(checked_path(package(template_id) / "preview.png"))
    checked_path(root() / "catalog.sqlite").unlink(missing_ok=True)
    checked_path(package(template_id) / "manifest.json").unlink()
    for path in paths:
        path.unlink(missing_ok=True)
    directory = package(template_id)
    if (directory / "assets").exists():
        (directory / "assets").rmdir()
    directory.rmdir()
