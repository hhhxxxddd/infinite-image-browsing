from scripts.iib.tool import omit


class ImageGenerationParams:
    def __init__(self, meta: dict | None = None, pos_prompt: list | None = None, extra: dict | None = None) -> None:
        self.meta = {} if meta is None else meta
        self.pos_prompt = [] if pos_prompt is None else pos_prompt
        self.extra = omit({} if extra is None else extra, ["meta", "pos_prompt"])


class ImageGenerationInfo:
    def __init__(
        self,
        raw_info: str = "",
        params: ImageGenerationParams | None = None,
    ):
        self.raw_info = raw_info
        self.params = ImageGenerationParams() if params is None else params
