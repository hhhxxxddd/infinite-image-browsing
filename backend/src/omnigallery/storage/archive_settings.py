from omnigallery.config import DATA_ROOT
from omnigallery.storage.archive import archive_settings


def current_archive_settings():
    return archive_settings("", str(DATA_ROOT))
