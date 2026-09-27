from pydantic import BaseModel


class PathsRequest(BaseModel):
    paths: list[str]
