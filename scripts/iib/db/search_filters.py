"""Common tag and dimension predicates for text and visual searches."""

import os
from sqlite3 import Connection

from pydantic import BaseModel, Field

from scripts.iib.db.size_filter import ImageSizeFilter


class MediaSearchFilters(BaseModel):
    folder_path: str | None = None
    include_subfolders: bool = True
    and_tags: list[int] = Field(default_factory=list)
    or_tags: list[int] = Field(default_factory=list)
    not_tags: list[int] = Field(default_factory=list)
    dimensions: ImageSizeFilter | None = None

    def sql_conditions(self, conn: Connection) -> tuple[list[str], list[int | str]]:
        clauses, params = [], []
        if self.folder_path:
            folder = os.path.abspath(os.path.expanduser(self.folder_path))
            prefix = folder.rstrip(os.sep) + os.sep
            # Compare literal path boundaries, including names containing % or _.
            collation = " COLLATE NOCASE" if os.name == "nt" else ""
            clauses.append(f"substr(image.path, 1, ?) = ?{collation}")
            params.extend([len(prefix), prefix])
            if not self.include_subfolders:
                clauses.append("instr(substr(image.path, ?), ?) = 0")
                params.extend([len(prefix) + 1, os.sep])
        groups = [(self.and_tags, "and"), (self.or_tags, "or"), (self.not_tags, "not")]
        for ids, operator in groups:
            ids = list(dict.fromkeys(ids))
            if not ids:
                continue
            query = "SELECT image_id FROM image_tag WHERE tag_id IN ({})".format(
                ",".join("?" for _ in ids)
            )
            params.extend(ids)
            if operator == "and":
                query += " GROUP BY image_id HAVING COUNT(DISTINCT tag_id) = ?"
                params.append(len(ids))
            clauses.append(f"image.id {'NOT IN' if operator == 'not' else 'IN'} ({query})")
        size_ids = self.dimensions.matching_tag_ids(conn) if self.dimensions else None
        if size_ids == []:
            clauses.append("0 = 1")
        elif size_ids is not None:
            clauses.append("image.id IN (SELECT image_id FROM image_tag WHERE tag_id IN ({}))".format(
                ",".join("?" for _ in size_ids)
            ))
            params.extend(size_ids)
        return clauses, params
