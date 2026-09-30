# 06 · React + Mantine 界面迁移

> 当前默认入口 `/` 仍是 Vue。React + Mantine 重构从 `/react.html` 预览；`/legacy.html` 也保留 Vue 对照入口。两个界面共用现有数据，尚未完成默认入口切换。

## 入口与模块边界

- `frontend/index.html` 和 `frontend/legacy.html` 加载 `frontend/src/app/main.ts`（Vue）；`frontend/react.html` 加载 `frontend/react/main.tsx`。Vite 构建三个 HTML 入口；后端 `/` 返回 Vue 的 `index.html`，React 预览从 `/react.html` 打开。Tauri 当前仍从默认 `index.html` 启动。
- `react/main.tsx` 在渲染前调用 `initializeApiClient()`，使 Web 预览和 Tauri 桌面端使用同一后端地址与鉴权处理。
- `react/App.tsx` 负责外壳、一级导航、主题、路由、鉴权弹窗和页面错误隔离。页面与编辑器按需加载，加载失败时保留导航外壳。
- `react/features/media`、`react/features/workbench`、`react/features/discover`、`react/features/settings` 各自负责页面。编辑器通过 `react/features/editors/EditorHub.tsx` 占据全屏，不叠加主导航外壳。
- `react/design/navigation.tsx` 提供 `useEditorNavigation()`；业务页面调用 `openEditor(kind, draftId?)`，关闭时返回原页面。编辑器种类为 `image`、`video`、`audio`、`ai-image`、`ai-audio`、`ai-video`。

React 路由暂以查询参数表示：`?page=workbench`、`?page=discover`、`?page=settings`、`?section=image`、`?section=folders&path=<目录>` 和 `?editor=audio&draft=<id>`。旧版 `?action=open/view/pane` 链接可映射到 React 媒体、目录、预览、图片对比或相应一级页面；其中 `pane` 支持 local、empty、img-sli、workbench、global-setting、random-image。图片对比支持滑动与并排视图，并列显示两图的生成信息。目录下方恢复旧版 `omnigallery:tab-layout:v1` 中的本地目录和图片对比视图；React 后续打开和关闭的视图分别保存在 `omnigallery:react-open-folders:v1`、`omnigallery:react-open-comparisons:v1`，不会覆盖 Vue 标签布局。`pushState` 写入导航，`popstate` 响应浏览器前进／后退。切换一级页面会关闭编辑器；打开编辑器会保留原页面参数，便于返回。后端资源 ID 仍作为 ID 传递，不从展示名称推断。

## 视觉规则

Mantine 负责控件、浮层与主题状态；`react/design/theme.ts` 统一主色、文字、字号、圆角和控件高度。`react/design/global.css` 定义外壳和语义色变量；页面 CSS 应优先使用变量，避免各页面重复设定灰阶和边框。

| 变量                                                               | 用途                     |
| ------------------------------------------------------------------ | ------------------------ |
| `--omni-canvas`                                                    | 工作区域底色             |
| `--omni-surface` / `--omni-surface-soft` / `--omni-surface-raised` | 卡片、次级表面与悬浮表面 |
| `--omni-border`                                                    | 容器边框、分隔线         |
| `--omni-ink` / `--omni-muted`                                      | 主要文字与辅助文字       |
| `--omni-accent-ink` / `--omni-accent-soft`                         | 选中态文字与背景         |
| `--omni-shadow-float`                                              | 浮层阴影                 |

浅色和深色在同一套语义变量下切换。窗口宽度不超过 1000px 时，侧边栏默认收起成图标栏；用户可手动展开或收起，选择保存在 `localStorage` 的 `omnigallery-react-sidebar`。主题由 Mantine color scheme manager 保存。交互反馈应温和、短暂，并遵守 `prefers-reduced-motion`。菜单、弹窗、表单等通用控件用 Mantine 组件，业务页面 CSS 只定义排布及专有视图。

常规界面使用 12/13/14/16/20 px 的 Mantine 字级；全屏编辑器在 `.react-editor-shell` 中覆盖回紧凑字级，避免时间线操作区被放大。`react/design/i18n.tsx` 复用旧版四份语言资源，额外补齐 React 外壳和设置的文案。语言首次打开优先读取后端 `app_fe_setting.global.lang`，缺失时回退到 React 本机副本、旧 Pinia 设置或系统语言；用户切换语言会写回后端并保留本机副本。导航、设置分类、外观、通用和浏览设置，以及媒体浏览／筛选／详情／常用操作会即时切换；用户文件名、标签、元数据、动态错误及工作台、编辑器与 AI 高级表单尚未全量翻译，四语言不能视为全站验收完成。

## 后端契约与设置

`react/shared/apiClient.ts` 是唯一的 React HTTP 入口，提供 `apiFetch`、`apiRequest`、`apiUrl`；业务模块不要再各自实现鉴权、后端端口或 fetch 包装。后端返回 `secret_verification_failed` 时，由 App 中的 Mantine 弹窗请求访问密钥后重试。

设置页接入项目数据目录、归档目录、网络代理、FFmpeg／PyTorch 运行环境、标签分组与自动打标规则、浏览偏好、Qwen 本地模型、Comfy 连接与模型目录、图片 AI 接入和 OneDrive 同步。浏览与通用偏好启动时优先读取后端 `app_fe_setting.global`，缺失时沿用 React 本机副本或旧 Pinia 设置；修改时先更新当前页面和本机副本，再串行读取并合并写回后端，保留旧版管理的其他字段及 `ignoredConfirmActions` 子项。媒体页监听 `iib-react-browse-preferences-changed`，实时应用缩略图开关、最大短边、卡片基准宽度和自动索引检查。后端只读或保存失败时页面显示错误。重建媒体索引与 Qwen 向量索引都需要用户在设置中确认后才发起。

运行环境页的安装徽标与按钮只对应 Windows 桌面托管版。源码模式的 `/ai-runtime` 不检查启动后端的 Python 是否已安装 PyTorch；该环境由 Python 自身管理，具体模型是否可用以 AI 接入中的模型状态为准。FFmpeg 已用于音频制作和视频 MP4 导出。主任务已在真实浏览器打开通用、外观、浏览、运行环境、AI 接入、快捷键和同步页；模型显示 102/102、Comfy 已连接，与 Vue 共用配置吻合。标签从未分组拖到内容主题后已落库，并通过选择器移回原位；自动规则字段菜单已打开。安装、云端调用及其他写入流程仍需逐项验证。

媒体目录可直接浏览后端 `/files` 列表，包括尚未入索引的文件；常规媒体库仍使用索引查询。旧版 `?action=open/view` 可直达目录或单文件预览。目录中的“查看全部内容”已接入 `directoryWalk.ts`，逐目录读取真实磁盘并分批显示，支持排序、路径边界校验和失败重试；它与“包含子文件夹”的索引搜索是不同入口。目录查看选项还提供 1–600 秒轮询刷新，以及带当前浏览模式的 Web 分享链接。媒体预览在已加载列表末尾继续取下一页，方向键、滚轮和按钮共用续页逻辑；触屏上下滑动也可切换项目。预览中的“新建制作”选择作品后会在同一次工作区写入中创建制作文件、纳入源素材，并打开编辑器；图片制作会读取源尺寸，以完整显示的方式铺入首个图层，音视频制作先将源加入素材池。返回和切换编辑器前等待当前修改保存；保存失败时留在原编辑器并提示错误。

图片理解的 Comfy 工作流可导入 API 格式 JSON，并设置图片输入、提示词和输出节点；全局图片创作的模式、Router 模型与并行数也可设置。Comfy 的连接与密钥配置读取完成前显示检查中，失败时显示状态未知及错误，不将未读取状态误报为“未配置”；服务端只返回密钥配置标志与来源，前端不回显已保存密钥。Studio 工作流预设可以在设置中列出、导入、保存和删除；图片节点可指定主图、参考图或内部角色，参考图可排序（最多 13 张），遮罩可选主图 Alpha 输出或独立 `LoadImageMask` 节点并开关，正向／负向提示词和多个结果节点可映射。可调参数支持数值、文本、开关、选项四类；数值范围与滑块、多个字段和选项值可配置，前端按后端约束预检重复或保留字段、类型与容量，后端仍做最终校验。音频与视频工作流预设也可在 React 设置页修改名称、用途及可调参数，但尚不能作为已经接入的音视频 AI 服务使用。迁移期间不能因为界面出现服务名称就将其标为就绪。

“挑一挑”调用现有 `/pick_media`，按全部／图片／视频／音频分批随机挑选；最近 20 批可返回浏览，已展示路径用于避免短期重复。卡片可进入原图／视频／音频预览，右侧复用媒体库详情面板，可查看和编辑描述、生成信息、音频歌曲信息及自定义标签；卡片可直接收藏或打开标签菜单。无媒体、只读或服务失败时给出对应状态。

React 音频编辑读取后端 `X-Audio-Level-Peaks`，显示实时左右混音电平、峰值和过载状态；试听按后端 12 秒片段上限连续请求与衔接。已在浏览器核对跨片段播放及非静音片段的电平变化。

React 视频编辑的 FFmpeg MP4 导出已在浏览器完成真实验证：工作台产物计数增加，导出画面可播放。全屏编辑器沿用专业布局：顶部保存与导航、左侧工具、中央画布或时间线、右侧属性、底部横向素材条。图片画布与 AI 图片编辑支持保存后继续编辑；AI 图片、音频、视频入口可在同一制作文件内切换，音频和视频仍是不可提交任务的占位页，切回图片时重新读取已保存的主图、参考图和配置。Studio 工作流已有可视节点图及节点映射面板。迁移仍有边界：四语言尚未覆盖工作台、编辑器和设置高级表单的全部文案，媒体动态内容仍按原文显示；运行时参数预览及图片工作流的真实 ComfyUI 端到端提交仍待验收。旧版 Vue 与依赖暂时保留，不应在这些能力迁移和数据验证完成前删除。

## 开发与验收

在 `frontend/` 运行 `npm run dev` 后访问 `/react.html` 验收 React；`/` 和 `/legacy.html` 均可用作 Vue 对照。`npm run check` 一次运行格式、ESLint、Vue 与 React 类型检查、两套前端测试和构建。构建产物应包含 `dist/index.html`、`dist/react.html` 和 `dist/legacy.html`。迁移期间每个页面应以真实后端数据进行浅／深色、不同窗口宽度及关键操作的视觉和行为验收；切换默认入口前应完成剩余能力和数据写入路径的核对。
