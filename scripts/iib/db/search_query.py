"""Parse the local media search language into parameterized SQLite conditions."""

import re


class SearchQueryError(ValueError):
    pass


def _tokens(query: str) -> list[str]:
    if len(query) > 1000:
        raise SearchQueryError("搜索内容过长（最多 1000 字符）")
    result = []
    index = 0
    while index < len(query):
        if query[index].isspace():
            index += 1
            continue
        if query[index] in "()|-":
            result.append(query[index])
            index += 1
            continue
        start = index
        quoted = False
        escaped = False
        while index < len(query):
            char = query[index]
            if escaped:
                escaped = False
            elif quoted and char == "\\":
                escaped = True
            elif char == '"':
                quoted = not quoted
            elif not quoted and (char.isspace() or char in "()|"):
                break
            index += 1
        if quoted:
            raise SearchQueryError("引号没有闭合")
        result.append(query[start:index])
        if len(result) > 64:
            raise SearchQueryError("搜索条件过多（最多 64 项）")
    return result


def _value(raw: str) -> str:
    if raw.startswith('"'):
        if not raw.endswith('"') or len(raw) < 2:
            raise SearchQueryError("引号应包住完整的搜索词")
        return raw[1:-1].replace('\\"', '"').replace('\\\\', '\\')
    if '"' in raw:
        raise SearchQueryError("请用引号包住带空格的搜索词")
    return raw


class _Parser:
    def __init__(self, tokens: list[str]):
        self.tokens = tokens
        self.index = 0

    def peek(self):
        return self.tokens[self.index] if self.index < len(self.tokens) else None

    def take(self):
        token = self.peek()
        self.index += 1
        return token

    def parse(self):
        if not self.tokens:
            return None
        result = self.or_expr(0)
        if self.peek() is not None:
            raise SearchQueryError("括号或运算符位置不正确")
        return result

    def or_expr(self, depth):
        node = self.and_expr(depth)
        while self.peek() in ("OR", "|"):
            self.take()
            node = ("or", node, self.and_expr(depth))
        return node

    def and_expr(self, depth):
        node = self.unary(depth)
        while self.peek() is not None and self.peek() not in (")", "OR", "|"):
            if self.peek() == "AND":
                self.take()
            node = ("and", node, self.unary(depth))
        return node

    def unary(self, depth):
        if self.peek() in ("-", "NOT"):
            self.take()
            return ("not", self.unary(depth))
        if self.peek() == "(":
            if depth >= 12:
                raise SearchQueryError("括号嵌套过深")
            self.take()
            node = self.or_expr(depth + 1)
            if self.take() != ")":
                raise SearchQueryError("括号没有闭合")
            return node
        token = self.peek()
        if token is None or token in (")", "AND", "OR", "|"):
            raise SearchQueryError("搜索条件不完整")
        self.take()
        return ("term", token)


def _like(value: str) -> str:
    return "%" + value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _term(token: str, filename_only: bool) -> tuple[str, list[str]]:
    field = "name" if filename_only else "all"
    match = re.fullmatch(r"([A-Za-z]+):(.*)", token, re.DOTALL)
    if match:
        field, token = match.group(1).lower(), match.group(2)
        if field not in ("tag", "name", "desc", "has"):
            raise SearchQueryError(f"不支持的指令：{field}:（可用 tag:、name:、desc:、has:）")
    value = _value(token)
    if not value:
        raise SearchQueryError("指令后需要填写搜索词")
    if field == "has":
        if value == "desc":
            return "(trim(coalesce(image.description, '')) <> '')", []
        if value == "tag":
            return "EXISTS (SELECT 1 FROM image_tag WHERE image_tag.image_id = image.id)", []
        raise SearchQueryError("has: 仅支持 desc 或 tag")
    if field == "name":
        return "search_filename(image.path) LIKE ? ESCAPE '\\'", [_like(value)]
    if field == "desc":
        return "image.description LIKE ? ESCAPE '\\'", [_like(value)]
    tag_head = "EXISTS (SELECT 1 FROM image_tag AS text_image_tag JOIN tag AS text_tag ON text_tag.id = text_image_tag.tag_id WHERE text_image_tag.image_id = image.id AND ("
    if field == "tag":
        return tag_head + "text_tag.name = ? COLLATE NOCASE OR search_tag_label(text_tag.name) = ? COLLATE NOCASE))", [value, value]
    tag_contains = tag_head + "text_tag.name LIKE ? ESCAPE '\\' OR search_tag_label(text_tag.name) LIKE ? ESCAPE '\\'))"
    return "(search_filename(image.path) LIKE ? ESCAPE '\\' OR image.description LIKE ? ESCAPE '\\' OR " + tag_contains + ")", [_like(value)] * 4


def _compile(node, filename_only: bool) -> tuple[str, list[str]]:
    if node[0] == "term":
        return _term(node[1], filename_only)
    if node[0] == "not":
        clause, params = _compile(node[1], filename_only)
        return f"NOT ({clause})", params
    left, left_params = _compile(node[1], filename_only)
    right, right_params = _compile(node[2], filename_only)
    return f"({left} {node[0].upper()} {right})", left_params + right_params


def compile_search_query(query: str, filename_only: bool = False) -> tuple[str, list[str]]:
    """Return a WHERE fragment and bound params; empty query adds no condition."""
    ast = _Parser(_tokens(query.strip())).parse()
    return _compile(ast, filename_only) if ast else ("", [])
