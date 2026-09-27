"""Runtime configuration and writable paths for source and packaged builds."""

import locale as system_locale
import os
import platform
import sys
from pathlib import Path

from dotenv import load_dotenv

is_nuitka = "__compiled__" in globals()
is_pyinstaller_bundle = bool(getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"))
is_exe_ver = is_nuitka or is_pyinstaller_bundle
PACKAGE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_ROOT.parents[2]
APPLICATION_ROOT = Path(sys.executable).resolve().parent if is_exe_ver else PROJECT_ROOT
RESOURCE_ROOT = Path(
    getattr(sys, "_MEIPASS", os.getenv("OMNIGALLERY_BUNDLE_ROOT", APPLICATION_ROOT))
)
load_dotenv(APPLICATION_ROOT / ".env")
DATA_ROOT = (
    Path(os.getenv("OMNIGALLERY_DATA_DIR", str(APPLICATION_ROOT / ".local"))).expanduser().resolve()
)
DATABASE_PATH = (
    Path(os.getenv("OMNIGALLERY_DB_PATH", str(DATA_ROOT / "db" / "omnigallery.db")))
    .expanduser()
    .resolve()
)
CACHE_ROOT = (
    Path(os.getenv("OMNIGALLERY_CACHE_DIR", str(DATA_ROOT / "cache"))).expanduser().resolve()
)
PROJECT_DATA_ROOT = (
    Path(os.getenv("OMNIGALLERY_PROJECT_DATA_DIR", str(DATA_ROOT / "project-data")))
    .expanduser()
    .resolve()
)
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
    """Model assets may live outside the disposable application data directory."""
    return (
        Path(os.getenv("OMNIGALLERY_MODEL_DIR", str(DATA_ROOT / "models"))).expanduser().resolve()
    )
