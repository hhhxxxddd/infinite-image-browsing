"""Verified, restart-time migration. Sources are retained as recoverable backups."""

import json
import os
import shutil
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

from omnigallery.storage.filesystem import checked_path, digest, files_under
from omnigallery.storage.layout import DIRECTORIES, write_json


def _read_settings(database: Path):
    if not database.exists():
        return {}
    with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as conn:
        if not conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='global_setting'"
        ).fetchone():
            return {}
        return {
            key: json.loads(value)
            for key, value in conn.execute("SELECT name, setting_json FROM global_setting")
        }


def _database_copy(source: Path, target: Path):
    checked_path(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    with (
        closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as original,
        closing(sqlite3.connect(target)) as copied,
    ):
        original.backup(copied)
        if copied.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise ValueError("数据库完整性校验失败，原目录仍保留")


def _copy(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    if source.stat().st_size != target.stat().st_size or digest(source) != digest(target):
        raise OSError(f"文件校验失败：{source}")


def _remap(value, mappings):
    if isinstance(value, dict):
        return {key: _remap(item, mappings) for key, item in value.items()}
    if isinstance(value, list):
        return [_remap(item, mappings) for item in value]
    if not isinstance(value, str):
        return value
    normalized = value.replace("\\", "/")
    for source, target in mappings:
        prefix = str(source).replace("\\", "/").rstrip("/")
        if os.path.normcase(normalized) == os.path.normcase(prefix):
            return str(target)
        if os.path.normcase(normalized).startswith(os.path.normcase(prefix + "/")):
            return str(target / Path(normalized[len(prefix) + 1 :]))
    return value


def _remap_database(database: Path, mappings):
    if not database.exists():
        return
    with closing(sqlite3.connect(database)) as conn, conn:
        tables = [
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        ]
        # Only path-bearing application fields; arbitrary descriptions, prompts and secrets stay intact.
        fields = {
            "global_setting": ("setting_json",),
            "workspace_state": ("value",),
            "workspace_artifact_lineage": ("source_json",),
            "media": ("path", "fullpath"),
            "folders": ("path",),
            "extra_path": ("path",),
            "folder_icon": ("path",),
        }
        for table, requested in fields.items():
            if table not in tables:
                continue
            columns = {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}
            for column in set(requested) & columns:
                for rowid, raw in conn.execute(
                    f'SELECT rowid, "{column}" FROM "{table}"'
                ).fetchall():
                    if not isinstance(raw, str):
                        continue
                    try:
                        original = json.loads(raw)
                    except ValueError:
                        original = raw
                    updated = _remap(original, mappings)
                    if updated != original:
                        encoded = (
                            json.dumps(updated, ensure_ascii=False)
                            if original is not raw
                            else updated
                        )
                        conn.execute(
                            f'UPDATE "{table}" SET "{column}"=? WHERE rowid=?', (encoded, rowid)
                        )
        if "global_setting" in tables:
            conn.execute("DELETE FROM global_setting WHERE name IN ('project_storage', 'archive')")


def _remap_documents(root: Path, mappings):
    for name in ("project-data", "templates"):
        for path in files_under(root / name):
            if path.suffix == ".json":
                original = json.loads(path.read_text("utf-8"))
                updated = _remap(original, mappings)
                if updated != original:
                    write_json(path, updated)


def _remove_owned(root: Path, child: str):
    path = checked_path(root / child)
    if path.parent != checked_path(root):
        raise ValueError("迁移清理路径超出目标目录")
    if path.is_dir():
        list(files_under(path))
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def validate_destination(storage, target: Path):
    target = checked_path(target)
    roots = {storage.root, storage.default, *(Path(p) for p in storage.state.get("backups", []))}
    for root in roots:
        root = checked_path(root)
        if target == root or target in root.parents or root in target.parents:
            raise ValueError("请选择独立的空目录，不能使用当前数据目录、备份目录或它们的上下级目录")
    if target.exists():
        if not target.is_dir():
            raise ValueError("请选择目录")
        if any(path.name != ".storage.lock" for path in target.iterdir()):
            raise ValueError("目标目录不为空，请选择空目录；现有文件不会被覆盖")
    target.mkdir(parents=True, exist_ok=True)
    probe = target / (".storage-probe-" + uuid.uuid4().hex)
    try:
        probe.write_bytes(b"probe")
    finally:
        probe.unlink(missing_ok=True)


def migrate_root(storage, target: Path):
    """Publish all children before switching the startup locator; retry interrupted copies."""
    source = storage.root
    marker = target / ".storage-migration.json"
    stage_name = ".storage-migration"
    token = storage.state.get("pending_id")
    if marker.exists():
        record = json.loads(checked_path(marker).read_text("utf-8"))
        if not token or record != {"source": str(source), "id": token}:
            raise ValueError("目标目录有其他迁移记录，请选择另一个空目录")
        for name in (*DIRECTORIES, stage_name):
            _remove_owned(target, name)
        marker.unlink()
    validate_destination(storage, target)
    write_json(marker, {"source": str(source), "id": token})
    stage = target / stage_name
    stage.mkdir()
    published = []
    try:
        for name in DIRECTORIES:
            origin = source / name
            if not origin.exists():
                continue
            for path in files_under(origin):
                relative = path.relative_to(source)
                if name == "db" and path.name in {
                    "omnigallery.db-wal",
                    "omnigallery.db-shm",
                    "omnigallery.db-journal",
                }:
                    continue
                if relative == Path("db/omnigallery.db"):
                    _database_copy(path, stage / relative)
                else:
                    _copy(path, stage / relative)
        mappings = [(source / name, target / name) for name in DIRECTORIES]
        _remap_database(stage / "db/omnigallery.db", mappings)
        _remap_documents(stage, mappings)
        for name in DIRECTORIES:
            if (stage / name).exists():
                os.replace(stage / name, target / name)
                published.append(name)
        state = {**storage.state, "directory": str(target)}
        state["backups"] = list(dict.fromkeys([*state.get("backups", []), str(source)]))
        state["excluded_paths"] = list(
            dict.fromkeys([*state.get("excluded_paths", []), str(source)])
        )
        for key in ("pending_directory", "pending_id", "error"):
            state.pop(key, None)
        storage._save(state)
        storage.root = target
    except Exception:
        for name in published:
            _remove_owned(target, name)
        raise
    finally:
        try:
            _remove_owned(target, stage_name)
            marker.unlink(missing_ok=True)
        except (OSError, ValueError):
            # Once the locator is published, cleanup cannot turn a successful
            # migration into a reported rollback. The empty stage can remain.
            if storage.root != target:
                raise


def consolidate_legacy(root: Path, legacy: dict):
    """Import old component locations once; the journal makes startup retries idempotent."""
    marker = root / ".storage-upgrade.json"
    if marker.exists():
        record = json.loads(checked_path(marker).read_text("utf-8"))
        if record.get("root") != str(root):
            raise ValueError("旧版目录迁移记录与当前目录不匹配")
        if record.get("complete"):
            return record["report"]
    else:
        database = checked_path(Path(legacy.get("db") or root / "db/omnigallery.db"))
        settings = _read_settings(database)
        project = settings.get("project_storage") or {}
        archive = settings.get("archive") or {}
        sources = {
            "project-data": project.get("directory") or legacy.get("project-data"),
            "cache": legacy.get("cache"),
            "models": legacy.get("models"),
            "exports": archive.get("directory"),
        }
        sources = {name: str(checked_path(Path(value))) for name, value in sources.items() if value}
        target_db = root / "db/omnigallery.db"
        if database != target_db and database.exists() and target_db.exists():
            raise ValueError("默认位置与旧配置同时存在数据库，请先备份并确定使用哪一个")
        backups = list(project.get("previous_directories", []))
        backups.extend(
            path
            for name, path in sources.items()
            if Path(path) != root / name and Path(path).exists()
        )
        if database != target_db and database.exists():
            backups.append(str(database))
        excluded = []
        project_roots = [*project.get("previous_directories", [])]
        if sources.get("project-data"):
            project_roots.append(sources["project-data"])
        for previous in project_roots:
            for name in (
                "omnigallery-workspace-artifacts",
                "omnigallery-edit-history",
                "media-covers",
            ):
                excluded.append(str(Path(previous) / name))
        record = {
            "root": str(root),
            "database": str(database),
            "sources": sources,
            "copy_database": database != target_db and database.exists(),
            "rewrite_database": bool(
                sources or "project_storage" in settings or "archive" in settings
            ),
            "report": {"backups": list(dict.fromkeys(backups)), "excluded_paths": excluded},
        }
        write_json(marker, record)
    database = checked_path(Path(record["database"]))
    sources = {name: checked_path(Path(value)) for name, value in record["sources"].items()}
    mappings = [(path, root / name) for name, path in sources.items() if path != root / name]
    for origin, _ in mappings:
        if origin == root or origin in root.parents:
            raise ValueError(f"旧存储目录包含应用数据目录，请先调整旧目录：{origin}")
    stage = root / ".storage-upgrade"
    if stage.exists():
        _remove_owned(root, stage.name)
    stage.mkdir()
    additions = []
    try:
        for name, origin in sources.items():
            if origin == root / name:
                continue
            for path in files_under(origin):
                if name == "exports" and not (
                    path.name.startswith("omnigallery_archive_") and path.suffix == ".zip"
                ):
                    continue
                relative = Path(name) / path.relative_to(origin)
                target = root / relative
                if target.exists():
                    checked_path(target)
                    same = target.is_file() and digest(path) == digest(target)
                    if (
                        not same
                        and target.is_file()
                        and name == "project-data"
                        and path.suffix == ".json"
                    ):
                        try:
                            same = _remap(
                                json.loads(path.read_text("utf-8")), mappings
                            ) == json.loads(target.read_text("utf-8"))
                        except (ValueError, OSError):
                            pass
                    if not same:
                        raise ValueError(
                            f"旧目录与应用数据目录存在不同的同名文件，请先处理：{target}"
                        )
                    continue
                _copy(path, stage / relative)
                additions.append(relative)
        target_db = root / "db/omnigallery.db"
        if record["copy_database"] and not target_db.exists():
            _database_copy(database, stage / "db/omnigallery.db")
            additions.append(Path("db/omnigallery.db"))
        for relative in additions:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(stage / relative, target)
        if target_db.exists() and record["rewrite_database"]:
            backup = root / "db/backups/before-unification.db"
            if not backup.exists():
                _database_copy(target_db, backup)
            _remap_database(target_db, mappings)
            _remap_documents(root, mappings)
        record["complete"] = True
        write_json(marker, record)
    finally:
        _remove_owned(root, stage.name)
    return record["report"]
