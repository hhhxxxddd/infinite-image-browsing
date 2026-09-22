from scripts.iib.parsers.comfyui import ComfyUIParser
from scripts.iib.parsers.model import ImageGenerationInfo, ImageGenerationParams
from scripts.iib.logger import logger
from PIL import Image


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
