"""Match indexed image dimensions without rescanning files or changing the schema."""

import re
from sqlite3 import Connection
from typing import Annotated

from pydantic import BaseModel, Field, model_validator

Dimension = Annotated[int, Field(strict=True, gt=0, le=1_000_000)]


class ImageSizeFilter(BaseModel):
    width: Dimension | None = None
    height: Dimension | None = None
    ratio_width: Dimension | None = None
    ratio_height: Dimension | None = None

    @model_validator(mode="after")
    def require_pairs(self):
        if (self.width is None) != (self.height is None):
            raise ValueError("Provide both width and height")
        if (self.ratio_width is None) != (self.ratio_height is None):
            raise ValueError("Provide both ratio_width and ratio_height")
        return self

    def matching_tag_ids(self, conn: Connection) -> list[int] | None:
        # None means unrestricted; an empty list must produce no results.
        if self.width is None and self.ratio_width is None:
            return None
        matches = []
        for tag_id, name in conn.execute("SELECT id, name FROM tag WHERE type = 'size'"):
            size = re.fullmatch(r"(\d+)\s*[×xX]\s*(\d+)", name.strip())
            if not size:
                continue
            width, height = map(int, size.groups())
            if width <= 0 or height <= 0:
                continue
            if self.width is not None and (width, height) != (self.width, self.height):
                continue
            if self.ratio_width is not None and width * self.ratio_height != height * self.ratio_width:
                continue
            matches.append(tag_id)
        return matches
