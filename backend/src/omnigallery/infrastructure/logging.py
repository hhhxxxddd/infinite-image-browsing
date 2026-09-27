"""Application logging configuration, isolated from repository working directories."""

import logging

from omnigallery.config import LOG_ROOT, is_dev

logger = logging.getLogger("omnigallery")
logger.setLevel(logging.DEBUG)
if not logger.handlers:
    LOG_ROOT.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(LOG_ROOT / "server.log", encoding="utf8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)
    if is_dev:
        console = logging.StreamHandler()
        console.setLevel(logging.INFO)
        logger.addHandler(console)
