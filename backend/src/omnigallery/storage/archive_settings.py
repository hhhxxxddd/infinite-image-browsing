from omnigallery.config import DATA_ROOT
from omnigallery.infrastructure.database import Database
from omnigallery.storage.archive import archive_settings
from omnigallery.storage.settings_repository import SettingsRepository


def current_archive_settings():
    saved = SettingsRepository.get_setting(Database.get_connection(), "archive") or {}
    return archive_settings(saved.get("directory", ""), str(DATA_ROOT))
