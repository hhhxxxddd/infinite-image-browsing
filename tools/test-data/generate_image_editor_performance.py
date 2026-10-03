"""Create and register a 4K image with six editable layers through the local API.

Existing media and edits are preserved. The five image sources are each 3840x2160;
the saved image contains their immutable snapshots plus one editable text layer.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlencode

from generate_test_media import font, scene
from PIL import Image, ImageDraw
from seed_test_library import LocalAPI

SIZE = (3840, 2160)
NAME = "性能测试-4K-6图层.png"


def generate(root: Path, api: LocalAPI) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    output = root / NAME
    if output.exists():
        record = api.call("image_edit_history?" + urlencode({"path": str(output)}))["record"]
        if not record or len(record["document"]["layers"]) < 5:
            raise ValueError("同名文件已存在，但不是多图层测试用例；请使用另一个输出目录")
        print(f"Preserved existing fixture: {output}")
        return output

    specs = [
        ("背景", "texture", (0, 0, 3840, 2160)),
        ("城市", "city", (160, 360, 1600, 900)),
        ("山景", "mountain", (2080, 360, 1600, 900)),
        ("几何", "geometry", (160, 1180, 1600, 900)),
        ("海面", "sea", (2080, 1180, 1600, 900)),
    ]
    canvas = Image.new("RGBA", SIZE, "#101827")
    layers = []
    for index, (label, theme, (x, y, width, height)) in enumerate(specs):
        source = root / f"素材-{index + 1}-4K-{label}.png"
        if not source.exists():
            scene(SIZE, theme, f"4K SOURCE {index + 1} / {label}").save(source)
        with Image.open(source) as image:
            if image.size != SIZE:
                raise ValueError(f"素材尺寸应为 3840x2160：{source}")
            canvas.alpha_composite(image.convert("RGBA").resize((width, height)), (x, y))
        layers.append(
            {
                "id": f"perf-4k-image-{index + 1}",
                "kind": "image",
                "name": f"4K {label}",
                "path": str(source),
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "rotation": 0,
                "opacity": 1,
                "visible": True,
                "locked": False,
                "crop": {"x": 0, "y": 0, "width": 1, "height": 1},
                "zoom": 1,
                "focusX": 0.5,
                "focusY": 0.5,
                "fit": "cover",
                "brightness": 100,
                "contrast": 100,
                "radius": 0,
            }
        )
    title = "4K / 6 LAYERS / DRAG - RESIZE - ROTATE"
    layers.append(
        {
            "id": "perf-4k-title",
            "kind": "text",
            "name": "性能测试标题",
            "text": title,
            "x": 160,
            "y": 80,
            "width": 3520,
            "height": 220,
            "rotation": 0,
            "opacity": 1,
            "visible": True,
            "locked": False,
            "font": "system-ui",
            "fontSize": 104,
            "bold": True,
            "align": "center",
            "color": "#eef1ff",
        }
    )
    ImageDraw.Draw(canvas).text((1920, 190), title, font=font(104), fill="#eef1ff", anchor="mm")
    now = datetime.now(UTC).isoformat()
    document = {
        "version": 2,
        "id": "performance-4k-six-layers",
        "name": output.stem,
        "createdAt": now,
        "updatedAt": now,
        "width": 3840,
        "height": 2160,
        "background": "#101827",
        "groups": [],
        "layers": layers,
    }
    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG")
    result = api.call(
        "edit_image",
        {
            "path": layers[0]["path"],
            "crop": {"x": 0, "y": 0, "width": 1, "height": 1},
            "width": 3840,
            "height": 2160,
            "overwrite": False,
            "copy_name": NAME,
            "export_area": "canvas",
            "editor_document": document,
            "rendered_base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        },
    )
    if len(result["record"]["document"]["layers"]) != 6:
        raise ValueError("保存后的编辑记录应包含 6 个图层")
    (root / "测试说明.json").write_text(
        json.dumps(
            {
                "file": str(output),
                "size": list(SIZE),
                "layers": 6,
                "image_layers": 5,
                "source_size": list(SIZE),
                "revision": result["record"]["id"],
                "checks": [
                    "拖拽时 X/Y 实时同步",
                    "缩放时宽/高实时同步",
                    "旋转角度实时同步",
                    "每个手势只需一次撤销",
                    "Esc 取消手势",
                    "重新打开保留可编辑图层",
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Registered: {output} (3840x2160, 5 image layers + 1 text layer)")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("test_data/regression-cases/06-性能"))
    parser.add_argument("--api", default="http://127.0.0.1:7877")
    args = parser.parse_args()
    generate(args.output.resolve(), LocalAPI(args.api))


if __name__ == "__main__":
    main()
