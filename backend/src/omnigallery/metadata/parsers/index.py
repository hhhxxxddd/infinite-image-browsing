from PIL import Image

from omnigallery.infrastructure.logging import logger
from omnigallery.metadata.parsers.comfyui import ComfyUIParser
from omnigallery.metadata.parsers.model import ImageGenerationInfo, ImageGenerationParams


def parse_image_info(image_path: str) -> ImageGenerationInfo:
    """Read ComfyUI metadata; other images retain basic dimensions only."""
    with Image.open(image_path) as img:
        if ComfyUIParser.test(img, image_path):
            try:
                return ComfyUIParser.parse(img, image_path)
            except Exception:
                logger.exception("Failed to parse ComfyUI image %s", image_path)
        return ImageGenerationInfo(
            params=ImageGenerationParams(
                meta={"final_width": img.width, "final_height": img.height},
                pos_prompt=[],
                extra={},
            )
        )
