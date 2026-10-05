"""Caption line wrapping for ASS with the same word/character policy as Canvas."""

import os
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from PIL import ImageFont


@lru_cache(maxsize=64)
def _font(family, size, bold):
    fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    aliases = {
        "sans-serif": "arialbd.ttf" if bold else "arial.ttf",
        "serif": "timesbd.ttf" if bold else "times.ttf",
        "monospace": "courbd.ttf" if bold else "cour.ttf",
    }
    for candidate in (fonts / aliases.get(family, f"{family}.ttf"), family, "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(str(candidate), size=max(1, round(size)))
        except OSError:
            continue
    return ImageFont.load_default(size=max(1, round(size)))


def caption_lines(cue, canvas_width):
    style = cue.style
    if not style.wrap:
        return cue.text.split("\n")
    font = _font(style.fontFamily, style.fontSize, style.bold)

    def measure(text):
        # System font fallback renders East Asian full-width glyphs at one em.
        return sum(
            style.fontSize
            if unicodedata.east_asian_width(char) in {"W", "F"}
            else font.getlength(char)
            for char in text
        )

    width = canvas_width * style.maxWidth
    result = []
    for paragraph in cue.text.split("\n"):
        line = ""
        for token in re.findall(r"[^\S\n]+|[A-Za-z0-9_'’\-]+|.", paragraph):
            if measure(line + token) <= width:
                line += token
                continue
            if line.strip():
                result.append(line.rstrip())
                line = ""
            clean = token.lstrip()
            if measure(clean) <= width:
                line = clean
                continue
            for char in clean:
                if line and measure(line + char) > width:
                    result.append(line)
                    line = ""
                line += char
        result.append(line.rstrip())
    return result
