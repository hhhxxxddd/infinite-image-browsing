# 03 · 设计系统

[文档首页](../README.md) · [代码规范](02-coding-standards.md)

## 1. 品牌与主题

品牌为“万象馆／OmniGallery”，副标题“收藏所爱，创作所想”。蓝色四格展窗图标位于 `frontend/public/favicon.svg`；在 frontend 下用 `npm exec tauri icon -- public/favicon.svg` 同步桌面图标。

共享变量在 `frontend/src/shared/styles/designSystem.scss`，由 `app/main.ts` 在基础样式后引入；优先 `--ui-*`，既有 `--zp-*` 映射按实际迁移逐步替换。深色主题用 `body.dark`，Ant Design Vue 主题与变量同步。

| 用途 | 变量／约定 |
| --- | --- |
| 字体 | `--ui-font`，Segoe UI Variable／Microsoft YaHei UI；正文 13px / 1.5 |
| 表面 | `--ui-canvas`、`--ui-sidebar`、`--ui-surface`、`--ui-surface-soft` |
| 外壳 | `--ui-shell`、`--ui-sidebar-glass`、`--ui-header-glass`、`--ui-stage` |
| 文字／边界 | `--ui-text`、`--ui-muted`、`--ui-border`、`--ui-control-border`、`--ui-hover` |
| 圆角／间距 | 小控件 7px、卡片 10px、弹层 14px；间距 4／8／12／16／24px |
| 阴影／动画 | `--ui-shadow-card`、`--ui-shadow`；控件约 120ms，面板约 190ms |

主色浅色 `#1769aa`、深色 `#8ac5f7`，页面底色 `#f5f8fb`／`#121a24`。正文目标对比至少 4.5:1，重要控件边界与选中态至少 3:1。主内容表面不透明，玻璃效果只用于框架；文件名有深色渐变遮罩，用户标签颜色独立保留。

## 2. 交互基础

保留可见焦点、可读光标、禁用和悬停状态；退出动画不能挡住下层点击。尊重系统减少动态效果，优先过渡透明度与位移。侧栏宽度直接切到终值，不做让瀑布流持续重排的宽度动画。AI 光晕仅表示画面搜索已开启，不替代焦点边框。

弹窗、抽屉和菜单复用全局边框、圆角、阴影；页面只处理特殊结构。单个操作直接展示，不再藏入只有一项的更多菜单。

## 3. 预览与编辑器

预览和统一图片编辑器采用纯黑画布、浮动工具、右侧圆角面板。样式分别归 `media-preview/styles/previewPanels.css` 与 `image-editor/styles/studioEditorShell.css`；桌面距边缘 12px、面板圆角 22px。

右侧上方常驻图层，标题提供新增图片／文字／分组，画布行切换下方设置；下方显示对象属性或工具，两区独立滚动、滚动条沿外缘，分隔线支持拖动与键盘调整。裁剪／缩放期间上方保留但不可操作。左侧只放选择移动、裁剪、缩放、撤销重做、对比，工作区另有笔记。

左上保存条与预览工具同高，不随右侧切换移动。裁剪／缩放时隐藏保存条，取消／应用在右下工具区。媒体库显示未修改／修改未保存，工作区自动保存明确称“草稿已保存到本机”，不能统称缓存。

裁剪／缩放、画布边界、内容填充与保存范围的行为统一遵循[图片制作](../01-user-guide/02-workbench.md#2-图片制作)，不要在页面另做一套。输入框显式设置可见 caret，画布 hover 不覆盖背景模式或棋盘格。

## 4. 素材选择

共用 `MediaLibraryPicker.vue`：搜索筛选在上，四列卡片在下，小屏三列，受限高度仅滚动、不压缩卡片行。显示文件名，不能通过悬停暴露路径。多选勾选左上、独立预览右上、媒体类型左下。

添加／替换图片只搜索图片，点击直接选入，不显示多选和确认页脚。工作区通用素材选择仍可多选全部媒体。
