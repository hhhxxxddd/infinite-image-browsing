"""Small editable starter collection; no external fonts or image dependencies."""

from copy import deepcopy


def text(value, x, y, width, height, size, color, **style):
    layer = dict(
        kind="text",
        text=value,
        name=value,
        x=x,
        y=y,
        width=width,
        height=height,
        rotation=0,
        opacity=1,
        visible=True,
        locked=False,
        font="system-ui",
        fontSize=size,
        bold=True,
        align="center",
        color=color,
        lineHeight=1.24,
        letterSpacing=0,
    )
    layer.update(style)
    return layer


def effects(**changes):
    value = dict(
        fill=dict(mode="solid", endColor="#60a5fa", angle=90),
        stroke=dict(enabled=False, color="#ffffff", width=2),
        shadow=dict(enabled=False, color="#000000", angle=45, distance=6, blur=4),
        glow=dict(enabled=False, color="#60a5fa", range=12),
        background=dict(enabled=False, color="#111827", radius=6, opacity=0.8),
    )
    for name, fields in changes.items():
        value[name].update(fields)
    return value


def starter_templates():
    designs = [
        (
            "editorial",
            "简约标题",
            640,
            190,
            [
                text("记录此刻", 20, 10, 600, 100, 78, "#f8fafc"),
                text("把平凡的日子，写成自己的故事", 20, 125, 600, 45, 26, "#cbd5e1"),
            ],
        ),
        (
            "outline",
            "漫画强调",
            620,
            190,
            [
                text(
                    "精彩登场！",
                    30,
                    25,
                    560,
                    130,
                    88,
                    "#facc15",
                    rotation=-4,
                    effects=effects(
                        stroke=dict(enabled=True, color="#1e293b", width=5),
                        shadow=dict(enabled=True, color="#1e293b", distance=8, blur=0),
                    ),
                ),
            ],
        ),
        (
            "neon",
            "霓虹夜色",
            640,
            230,
            [
                text(
                    "夜色正好",
                    30,
                    35,
                    580,
                    105,
                    78,
                    "#f0abfc",
                    effects=effects(
                        fill=dict(mode="gradient", endColor="#67e8f9", angle=0),
                        glow=dict(enabled=True, color="#a855f7", range=18),
                    ),
                ),
                text("NIGHT STORIES", 60, 165, 520, 38, 24, "#a5f3fc", letterSpacing=8),
            ],
        ),
        (
            "caption",
            "电影字幕",
            680,
            175,
            [
                text(
                    "每一程，都有新的风景",
                    20,
                    20,
                    640,
                    80,
                    42,
                    "#ffffff",
                    effects=effects(background=dict(enabled=True, opacity=0.8, radius=10)),
                ),
                text("Every journey tells a story.", 40, 110, 600, 45, 24, "#fde68a"),
            ],
        ),
        (
            "label",
            "便签标注",
            560,
            205,
            [
                text(
                    "今日灵感",
                    30,
                    20,
                    500,
                    88,
                    54,
                    "#292524",
                    effects=effects(
                        background=dict(enabled=True, color="#fef08a", opacity=1, radius=12)
                    ),
                ),
                text("留一点时间，给喜欢的事", 35, 135, 490, 45, 28, "#fef9c3"),
            ],
        ),
        (
            "chapter",
            "章节标题",
            620,
            220,
            [
                text("CHAPTER 01", 40, 15, 540, 44, 24, "#fbbf24", letterSpacing=5),
                text("故事从这里开始", 20, 78, 580, 85, 60, "#ffffff"),
                text("新的篇章 · 新的可能", 50, 178, 520, 30, 20, "#cbd5e1"),
            ],
        ),
    ]
    for key, name, width, height, layers in designs:
        group_id = "template-group"
        for index, layer in enumerate(layers):
            layer.update(id=f"layer-{index}", groupId=group_id)
        yield (
            "builtin-" + key,
            dict(
                version=2,
                id="template-document",
                name=name,
                createdAt="",
                updatedAt="",
                width=width,
                height=height,
                background="transparent",
                backgroundView="checkerboard",
                groups=[
                    dict(
                        id=group_id,
                        name=name,
                        visible=True,
                        locked=False,
                        collapsed=False,
                        stackIndex=0,
                    )
                ],
                layers=deepcopy(layers),
            ),
        )
