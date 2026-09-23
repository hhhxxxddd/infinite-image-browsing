# 拾影视觉规则

界面的共享变量定义在 `vue/src/ui-system.scss`，由 `main.ts` 在基础样式之后引入。页面优先使用 `--ui-*` 变量；旧组件仍可使用与之映射的 `--zp-*` 变量。深色主题由 `body.dark` 切换。

| 用途 | 变量 | 规则 |
| --- | --- | --- |
| 字体 | `--ui-font` | Segoe UI Variable 优先，中文回退到 Microsoft YaHei UI；正文默认 13px / 1.5 |
| 页面、侧栏、卡片 | `--ui-canvas`、`--ui-sidebar`、`--ui-surface`、`--ui-surface-soft` | 用层次区别区域，避免页面自行指定纯白或纯黑 |
| 文本、边框、悬停 | `--ui-text`、`--ui-muted`、`--ui-border`、`--ui-hover` | 明暗主题共用语义，保证静止、悬停与禁用状态可辨 |
| 圆角、间距 | `--ui-radius-sm`、`--ui-radius`、`--ui-radius-lg`、`--ui-space-1` 至 `--ui-space-5` | 小控件 7px、卡片 10px、弹层 14px；间距按 4 / 8 / 12 / 16 / 24px 使用 |
| 动效 | `--ui-motion-fast`、`--ui-motion`、`--ui-ease` | 控件反馈约 120ms，面板/视图约 190ms；优先过渡透明度与位移，不改变内容尺寸 |

新增页面应先使用共享表面和控件状态，再补局部布局。悬浮菜单、弹窗与抽屉由全局规则统一边框、圆角、阴影；页面局部样式只处理其特殊结构。所有动作应保留可见焦点，退出动画不得阻挡下层点击。系统启用“减少动态效果”时，过渡、动画和滚动动效会自动缩减。
