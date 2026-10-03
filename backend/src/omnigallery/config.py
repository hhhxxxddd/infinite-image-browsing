"""Runtime configuration and writable paths for source and packaged builds."""

import locale as system_locale
import os
import platform
from pathlib import Path

from omnigallery.storage.layout import (
    APPLICATION_ROOT,
    IS_PACKAGED,
    RESOURCE_ROOT,
    storage,
)

is_exe_ver = IS_PACKAGED
DATA_ROOT = storage.root
DATABASE_PATH = DATA_ROOT / "db" / "omnigallery.db"
CACHE_ROOT = DATA_ROOT / "cache"
PROJECT_DATA_ROOT = DATA_ROOT / "project-data"
LOG_ROOT = DATA_ROOT / "logs"
STATIC_ROOT = Path(
    os.getenv("OMNIGALLERY_STATIC_DIR", str(RESOURCE_ROOT / "frontend" / "dist"))
).resolve()
index_html_path = str(STATIC_ROOT / "index.html")
cwd = str(APPLICATION_ROOT)
is_dev = os.getenv("OMNIGALLERY_ENV") == "dev"
is_win = platform.system() == "Windows"
enable_access_control = os.getenv("OMNIGALLERY_ACCESS_CONTROL", "disable") == "enable"
DEFAULT_BASE = "/api"
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
AI_MODEL = os.getenv("AI_MODEL", "gpt-4o-mini")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
TWELVELABS_API_KEY = os.getenv("TWELVELABS_API_KEY", "")


def get_cache_dir():
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    return str(CACHE_ROOT)


def get_temp_path():
    path = DATA_ROOT / "tmp"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def get_locale():
    language = os.getenv("OMNIGALLERY_SERVER_LANG") or system_locale.getlocale()[0] or "en"
    return "zh" if language.startswith("zh") else "en"


locale = get_locale()


def get_data_file_path(filename):
    return str(RESOURCE_ROOT / filename)


def get_model_root() -> Path:
    return DATA_ROOT / "models"
