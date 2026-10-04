"""Native editable bubbles and sample comic pages, without external materials."""

from omnigallery.templates.defaults import text


def vector(kind, shape, x, y, width, height, **changes):
    return dict(
        kind=kind,
        shape=shape,
        x=x,
        y=y,
        width=width,
        height=height,
        rotation=0,
        opacity=1,
        visible=True,
        locked=False,
        fill="#ffffff",
        stroke="#18202b",
        strokeWidth=3,
        radius=0,
        points=[dict(x=0, y=0), dict(x=1, y=0), dict(x=1, y=1), dict(x=0, y=1)],
        tail=dict(x=0.25, y=1),
        **changes,
    )


def document(template_id, name, width, height, layers, groups=()):
    return dict(
        version=2,
        id=template_id,
        name=name,
        width=width,
        height=height,
        background="#ffffff",
        createdAt="2026-10-04T00:00:00Z",
        updatedAt="2026-10-04T00:00:00Z",
        groups=list(groups),
        layers=layers,
    )


def comic_templates():
    for shape, name, caption in (
        ("speech", "漫画对白", "在这里输入对白"),
        ("thought", "心里话", "我在想……"),
        ("burst", "惊叹时刻", "哇！"),
        ("rect", "故事旁白", "故事从这里开始……"),
    ):
        template_id = "builtin-bubble-" + shape
        group_id = template_id + "-group"
        group = dict(id=group_id, name=name, visible=True, locked=False, collapsed=False)
        bubble = vector(
            "shape", shape, 10, 10, 500, 280, id=template_id + "-shape", name=name, groupId=group_id
        )
        words = text(
            caption, 90, 65, 340, 115, 32, "#18202b", id=template_id + "-text", groupId=group_id
        )
        doc = document(template_id, name, 520, 310, [bubble, words], [group])
        doc["background"] = "transparent"
        yield "text", template_id, doc

    for key, name, boxes in (
        (
            "daily",
            "日常四格",
            [(30, 110, 740, 235), (30, 365, 740, 235), (30, 620, 740, 235), (30, 875, 740, 235)],
        ),
        ("adventure", "冒险开场", [(30, 110, 740, 560), (30, 690, 360, 420), (410, 690, 360, 420)]),
    ):
        template_id = "builtin-page-" + key
        frames = [
            vector("frame", "rect", *box, id=f"{template_id}-frame-{i}", name=f"画框 {i + 1}")
            for i, box in enumerate(boxes)
        ]
        title = text(
            "今天的故事" if key == "daily" else "冒险，从此刻开始",
            35,
            25,
            730,
            65,
            44,
            "#18202b",
            id=template_id + "-title",
        )
        group_id = template_id + "-dialogue"
        group = dict(id=group_id, name="开场对白", visible=True, locked=False, collapsed=False)
        bubble = vector(
            "shape",
            "speech",
            70,
            155,
            320,
            180,
            id=template_id + "-bubble",
            name="对白气泡",
            groupId=group_id,
        )
        words = text(
            "准备好了吗？",
            115,
            190,
            230,
            80,
            30,
            "#18202b",
            id=template_id + "-words",
            groupId=group_id,
        )
        yield (
            "image",
            template_id,
            document(template_id, name, 800, 1160, [*frames, title, bubble, words], [group]),
        )
