"""One durable editable record per saved image, with deduplicated source snapshots."""
import copy
import hashlib
import json
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from scripts.iib.project_storage import storage_root, storage_lock

history_lock = storage_lock


def history_root():
    return storage_root() / "iib-edit-history"


def is_history_path(path):
    try:
        return os.path.commonpath((os.path.realpath(path), str(history_root()))) == str(history_root())
    except ValueError:
        return False


def digest_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent, suffix=".pending")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def _json(path, value):
    _write(path, json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8"))


def revision(record_id):
    if not re.fullmatch(r"[a-f0-9]{32}", record_id):
        raise ValueError("编辑记录编号无效")
    return json.loads((history_root() / "records" / (record_id + ".json")).read_text("utf-8"))


def latest(path):
    index = history_root() / "outputs" / (digest_file(path) + ".json")
    if not index.exists():
        return None
    return revision(json.loads(index.read_text("utf-8"))["revision"])


def resolve_revision(path, record_id=None):
    current = latest(path)
    if record_id is None:
        return current
    if current and current["id"] == record_id:
        return current
    raise ValueError("编辑记录已变化，请重新打开图片")


def snapshot_path(record, asset_id):
    if not re.fullmatch(r"[a-f0-9]{64}", asset_id) or asset_id not in record["assets"]:
        raise ValueError("快照不属于此编辑记录")
    return history_root() / "assets" / (asset_id + ".blob")


def prepare(path, document, export_area, check_path, parent_id=None, overwrite=False):
    # Limit the document, including stroke data, before copying any sources.
    if len(json.dumps(document, allow_nan=False)) > 8_000_000:
        raise ValueError("编辑文档过大")
    if document.get("version") != 2 or not isinstance(document.get("layers"), list) or len(document["layers"]) > 500:
        raise ValueError("编辑文档格式无效")
    if export_area not in ("content", "canvas"):
        raise ValueError("保存范围无效")
    parent = resolve_revision(path, parent_id)
    now = datetime.now(timezone.utc).isoformat()
    record = {"id": parent["id"] if parent and overwrite else uuid.uuid4().hex,
              "created_at": parent["created_at"] if parent and overwrite else now, "updated_at": now,
              "source_path": parent["source_path"] if parent else str(Path(path).resolve()),
              "document": copy.deepcopy(document), "export_area": export_area, "assets": {}}
    def archive(source, name):
        # Copy first, then hash these exact bytes; subsequent overwrites cannot change them.
        data = Path(source).read_bytes()
        asset_id = hashlib.sha256(data).hexdigest()
        with Image.open(source) as image:
            media_type = Image.MIME.get(image.format, "application/octet-stream")
        target = history_root() / "assets" / (asset_id + ".blob")
        if not target.exists():
            _write(target, data)
        record["assets"][asset_id] = {"name": name, "bytes": len(data), "media_type": media_type}
        return asset_id
    # Retain the initial original once, not a chain of flattened intermediate outputs.
    if parent:
        record["source_asset"] = parent["source_asset"]
        record["assets"][parent["source_asset"]] = parent["assets"][parent["source_asset"]]
    else:
        record["source_asset"] = archive(path, Path(path).name)
    for layer in record["document"]["layers"]:
        if layer.get("kind") != "image":
            continue
        source = layer.get("path", "")
        if source.startswith("snapshot:"):
            asset_id = source.removeprefix("snapshot:")
            if not parent:
                raise ValueError("缺少素材对应的编辑记录")
            saved = snapshot_path(parent, asset_id)
            if not saved.is_file():
                raise ValueError("编辑素材快照已丢失")
            record["assets"][asset_id] = parent["assets"][asset_id]
        else:
            check_path(source)
            asset_id = archive(source, Path(source).name)
        layer["path"] = "snapshot:" + asset_id
    return record


def save_edit(path, document, export_area, check_path, parent_id=None, **kwargs):
    from scripts.iib.image_edit import edit_image_copy
    with history_lock:
        changed = []
        previous = latest(path)
        old_hash = digest_file(path)
        try:
            record = prepare(path, document, export_area, check_path, parent_id, kwargs.get("overwrite", False))
            def before_publish(encoded, destination):
                record.update(output_path=str(destination), overwrite=kwargs.get("overwrite", False), output_hash=digest_file(encoded))
                for target, value in (
                    (history_root() / "records" / (record["id"] + ".json"), record),
                    (history_root() / "outputs" / (record["output_hash"] + ".json"), {"revision": record["id"]}),
                ):
                    changed.append((target, target.read_bytes() if target.exists() else None))
                    _json(target, value)
            destination = edit_image_copy(path, before_publish=before_publish, revision_id=record["id"], **kwargs)
        except Exception:
            for target, data in reversed(changed):
                if data is None:
                    target.unlink(missing_ok=True)
                else:
                    _write(target, data)
            raise
        # Cleanup is best-effort after successful publication; it must never report a failed save.
        try:
            if previous and kwargs.get("overwrite") and old_hash != record["output_hash"]:
                (history_root() / "outputs" / (old_hash + ".json")).unlink(missing_ok=True)
            used = set()
            for item in (history_root() / "records").glob("*.json"):
                used.update(json.loads(item.read_text("utf-8"))["assets"])
            for item in (history_root() / "assets").glob("*.blob"):
                if item.stem not in used:
                    item.unlink()
        except (OSError, ValueError, KeyError):
            pass
        return destination


def public_record(record, owner):
    assets = {}
    for asset_id, meta in record["assets"].items():
        path = "snapshot:" + asset_id
        assets[path] = {"fullpath": path, "name": meta["name"], "bytes": meta["bytes"],
                        "type": "file", "size": str(meta["bytes"]), "date": record["created_at"],
                        "created_time": record["created_at"], "is_under_scanned_path": False,
                        "edit_snapshot": {"owner": owner, "revision": record["id"], "asset": asset_id}}
    return {**record, "asset_info": assets}
