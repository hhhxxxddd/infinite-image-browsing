import os

from omnigallery.config import cwd

tags_translate: dict[str, str] = {}


try:
    import codecs

    with codecs.open(os.path.join(cwd, "tags-translate.csv"), "r", "utf-8") as tag:
        tags_translate_str = tag.read()
        for line in tags_translate_str.splitlines():
            en, mapping = line.split(",")
            tags_translate[en.strip()] = mapping.strip()
except Exception:
    pass
