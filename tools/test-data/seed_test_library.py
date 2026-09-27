"""Register test media and seed grouped, colored tags through the running local API.

Existing tags and descriptions are preserved. Repeated runs add no duplicate tags
or associations. No direct database writes or external AI requests are made.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from PIL import Image

from omnigallery.library.media_types import get_audio_type, get_video_type, is_image_file

TAG_GROUPS = {
    "内容主题": ("#52c41a", ["风景", "人物", "城市", "几何", "复古", "音效"]),
    "画面特征": (
        "#13c2c2",
        [
            "横图",
            "竖图",
            "方图",
            "超宽全景",
            "超长竖图",
            "大尺寸",
            "微型图",
            "透明背景",
            "灰度",
            "CMYK",
        ],
    ),
    "媒体格式": (
        "#1677ff",
        ["静态图片", "动画", "视频素材", "音频素材", "AVIF", "WebP", "兼容性检查"],
    ),
    "编辑状态": ("#faad14", ["待整理", "待导出", "已确认", "收藏候选"]),
    "生成信息": (
        "#722ed1",
        ["生成参数样本", "A1111", "ComfyUI", "LoRA", "工作流", "零值参数", "EXIF方向"],
    ),
    "音视频特性": (
        "#eb2f96",
        ["带封面", "无封面", "带歌词", "静音", "单声道", "双声道", "无音轨", "长时长"],
    ),
    "边界测试": (
        "#fa541c",
        [
            "同名文件",
            "重复内容",
            "特殊文件名",
            "批量选择",
            "🌈 emoji",
            "English tag",
            "这是十二个汉字长度的标签",
            "未使用标签",
        ],
    ),
    "空分组": ("#8c8c8c", []),
    "": ("#8c8c8c", ["测试素材", "未分组标签"]),
}


class LocalAPI:
    def __init__(self, base: str):
        parsed = urlsplit(base)
        if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("Use the local development server, e.g. http://127.0.0.1:7877")
        self.base = base.rstrip("/") + "/api/"

    def call(self, endpoint: str, payload: dict | None = None):
        data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        request = Request(
            self.base + endpoint, data=data, headers={"Content-Type": "application/json"}
        )
        with urlopen(request, timeout=180) as response:
            return json.load(response)


def tags_for_file(file: dict, index: int) -> set[str]:
    path = Path(file["fullpath"])
    if path.parent.name == "05-批量" and index % 17 == 0:
        return set()  # Leave some bulk samples untagged, retaining rare case labels.
    name = str(path)
    tags = {"测试素材", ["待整理", "待导出", "已确认"][index % 3]}
    if is_image_file(name):
        with Image.open(path) as image:
            tags.add("动画" if getattr(image, "is_animated", False) else "静态图片")
            width, height = image.size
            tags.add("方图" if width == height else "横图" if width > height else "竖图")
            if width * height >= 12_000_000:
                tags.add("大尺寸")
            if max(width, height) <= 32:
                tags.add("微型图")
            if image.mode == "CMYK":
                tags.add("CMYK")
    elif get_video_type(name):
        tags.add("视频素材")
    elif get_audio_type(name):
        tags.update(["音频素材", "音效"])
    rules = {
        "风景": ["壁纸", "锁屏", "sunrise", "mountain", "sea"],
        "人物": ["模特"],
        "城市": ["city"],
        "几何": ["geometry"],
        "复古": ["retro"],
        "超宽全景": ["超宽"],
        "超长竖图": ["超长"],
        "透明背景": ["透明"],
        "灰度": ["灰度"],
        "AVIF": [".avif"],
        "WebP": [".webp"],
        "兼容性检查": ["兼容性", ".avi", "hevc", "av1"],
        "生成参数样本": ["04-生成信息"],
        "A1111": ["A1111", "EXIF生成"],
        "ComfyUI": ["ComfyUI"],
        "LoRA": ["ComfyUI"],
        "工作流": ["工作流10"],
        "零值参数": ["零值"],
        "EXIF方向": ["EXIF旋转"],
        "带封面": ["MP3-128k"],
        "无封面": ["无封面"],
        "带歌词": ["MP3-128k"],
        "静音": ["静音"],
        "单声道": ["单声道", "无封面"],
        "双声道": ["左右声道"],
        "无音轨": ["无音轨", "进度拖动"],
        "长时长": ["两分钟", "30秒"],
        "同名文件": ["同名"],
        "重复内容": ["同名"],
        "特殊文件名": ["#测试", "emoji-", "较长文件"],
        "批量选择": ["05-批量"],
        "🌈 emoji": ["emoji-"],
        "English tag": ["-sea", "-city"],
    }
    tags.update(tag for tag, needles in rules.items() if any(part in name for part in needles))
    if index % 9 == 0:
        tags.add("收藏候选")
    if index % 13 == 0:
        tags.update(["未分组标签", "这是十二个汉字长度的标签"])
    return tags


def seed(api: LocalAPI, root: Path) -> dict:
    if not root.is_dir():
        raise ValueError(f"Media directory does not exist: {root}")
    api.call("extra_paths", {"path": str(root), "types": ["scanned", "walk"]})
    api.call("alias_extra_path", {"path": str(root), "alias": "测试媒体"})
    api.call("update_image_data", {})
    files, cursor = [], ""
    while True:
        result = api.call(
            "search_by_substr",
            {"surstr": "", "folder_paths": [str(root)], "size": 200, "cursor": cursor},
        )
        files.extend(result["files"])
        if not result["cursor"]["has_next"]:
            break
        cursor = result["cursor"]["next"]
    files.sort(key=lambda item: item["fullpath"])
    groups = api.call("tag_groups")
    existing = {
        tag["name"]: tag
        for tag in api.call("basic_info?include_expiry=false")["tags"]
        if tag["type"] == "custom"
    }
    tags = {}
    for group, (color, names) in TAG_GROUPS.items():
        if group and group not in groups:
            api.call("create_tag_group", {"name": group})
        for name in names:
            tag = existing.get(name)
            if tag is None:
                tag = api.call("add_custom_tag", {"tag_name": name, "group_name": group})
                api.call("update_tag", {"id": tag["id"], "color": color})
            tags[name] = tag["id"]
    assignments = {name: [] for name in tags}
    for index, file in enumerate(files):
        for name in tags_for_file(file, index):
            assignments[name].append(file["fullpath"])
        if "04-生成信息" in file["fullpath"] or index % 11 == 0:
            query = "image_description?" + urlencode({"path": file["fullpath"]})
            if not api.call(query)["description"]:
                description = (
                    f"测试素材：{file['name']}。用于检查描述搜索、原地编辑、标签筛选和媒体预览。"
                )
                if "04-生成信息" in file["fullpath"]:
                    description += "\n生成参数与模型名称均为合成测试数据，图片是程序绘制的测试图。"
                api.call(
                    "image_description", {"path": file["fullpath"], "description": description}
                )
    for name, paths in assignments.items():
        if paths:
            api.call(
                "batch_update_image_tag",
                {"img_paths": paths, "action": "add", "tag_id": tags[name]},
            )
    report = {
        "root": str(root),
        "media_count": len(files),
        "tag_count": len(tags),
        "group_count": len([group for group in TAG_GROUPS if group]),
        "formats": dict(
            sorted(Counter(Path(file["fullpath"]).suffix.lower() for file in files).items())
        ),
        "assignments": {name: len(paths) for name, paths in assignments.items()},
    }
    (root / "test-library.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("test_data"))
    parser.add_argument("--api-url", default="http://127.0.0.1:7877")
    args = parser.parse_args()
    report = seed(LocalAPI(args.api_url), args.root.resolve())
    print(
        f"Indexed {report['media_count']} media; prepared {report['tag_count']} tags "
        f"in {report['group_count']} groups. Details: {args.root / 'test-library.json'}"
    )


if __name__ == "__main__":
    main()
