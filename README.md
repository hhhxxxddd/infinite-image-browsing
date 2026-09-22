# 拾影

面向 AI 生图整理的本地媒体库，基于 [Infinite Image Browsing](https://github.com/zanllp/sd-webui-infinite-image-browsing) 改造。支持 Windows、WSL / Linux 独立运行，以及 Tauri 桌面端。

[安装与运行](#安装运行) · [使用说明](docs/media-library.md) · [更新记录](CHANGELOG.md) · [AI 助手接入](docs/ai-agents-zh.md)

## 当前功能

- **媒体库**：侧栏提供全部媒体、图片、视频、文件夹和设置；已添加的本机目录直接显示在侧栏。添加目录后扫描收录，原文件保留在原位置。
- **文件夹**：树形层级、路径导航、新建子文件夹、删除空子文件夹、修改入口名称和移除管理入口。移除入口与删除磁盘文件是不同操作。
- **卡片与排序**：单击选择、双击预览；底部显示不带扩展名的文件名。拖动卡片或多选整组排序，先更新当前列表，再保存顺序，不整页刷新。
- **统一预览**：普通预览和全屏使用同一个组件，默认支持上下滑动、滚轮和方向键切换；图片可缩放、旋转、收藏、下载、删除和定时轮播。
- **生成信息**：右侧常驻正向提示词、负向提示词、模型、参数与标签。未识别的信息可以手动补全，支持分项或原文编辑、复制信息。编辑内容保存到媒体库数据库，不改写原始图片。
- **搜索与筛选**：搜索文件名和生成信息，按标签、尺寸、比例等过滤；以图搜图集成在搜索框，使用本机视觉特征匹配。
- **图片对比**：顶部“图片对比”选择两张图片，或多选两张后进入；支持并排、滑块和生成信息对比。
- **导出**：选中文件后统一从“导出”选择下载 ZIP 或保存到应用归档目录，可设置目录和压缩选项。
- **扫描与索引**：支持手动增量扫描。媒体库页面可见时，自动更新索引每分钟检查目录变化；扫描后提示刷新列表，避免打断当前浏览。全量重建仍是手动维护操作。
- **设置**：太阳／月亮开关切换浅色和深色；缩略图、参数差异、标签规则、归档和快捷键集中管理。快捷键页直接显示固定按键、可编辑按键和生效位置。

## 媒体与数据

自动解析仅面向 **ComfyUI** 图片元数据，支持 PNG、JPEG、WebP 及其中的兼容参数格式；提取范围取决于工作流节点。普通图片、视频、音频仍可浏览和管理，实际播放能力取决于浏览器及文件编码。

媒体、索引和界面设置保存在运行服务的机器上。WSL 部署通过 `/mnt/c`、`/mnt/e` 等路径访问 Windows 磁盘；Windows 本地后端使用盘符路径。界面偏好自动保存，归档目录需要点击“保存目录”。

缩略图默认分辨率为 512 像素，可在设置中调整；通过 `IIB_CACHE_DIR` 指定媒体缓存目录。可用 `--generate_video_cover` 和 `--generate_image_cache` 预生成封面与缩略图。

本地以图搜图不调用第三方服务。可选的 AI 助手、语义检索和整理功能需要单独配置模型服务；这些功能的数据处理范围应以相应接入配置为准。访问认证、允许路径和只读模式见 [.env.example](.env.example)。

# 安装/运行

## 使用 Python 独立运行

使用 Python **3.12+**（推荐 3.13），在项目根目录执行：

```sh
python -m venv venv
# Windows PowerShell
.\venv\Scripts\Activate.ps1
# WSL / Linux：source venv/bin/activate
python -m pip install -r requirements.txt
python app.py --extra_paths /path/to/ComfyUI/output
```

打开 [网页版](http://127.0.0.1:7877)。后端默认端口为 **7877**，可用 `--port` 覆盖。在首页通过 **添加文件夹** 将 ComfyUI 输出文件夹加入搜索索引；`--extra_paths` 只提供浏览入口。仓库内的 `vue/dist` 是已构建的网页，普通运行不需要 Node.js。

`hnswlib` 需要 C++ 编译工具：Windows 使用 Visual Studio Build Tools 的 C++ 工作负载，WSL 使用 `build-essential`。视频解码使用 PyAV 自带的 FFmpeg 库，AVIF 使用 Pillow 原生支持。

此版本独立运行，已移除其他生成软件的集成和元数据解析插件。已有数据库记录会保留；如需更新历史元数据，可在设置中重建索引（手动编辑过的记录会保留）。

## 前后端热更新开发（Windows / WSL）

项目提供 `mise.toml`，供 `dev-tools` 管理 **Node.js 24 LTS** 和 Python 3.13。前端使用 npm 和 `package-lock.json`，不再使用 Yarn。

后端终端（根目录，激活虚拟环境后）：

```sh
python -m uvicorn app:create_app --factory --reload --port 7877
```

前端终端：

```sh
cd vue
npm ci
npm run dev
```

开发时打开 [前端开发页](http://localhost:3002)，API 由 Vite 代理到 `127.0.0.1:7877`。前端支持 HMR，后端修改后自动重启。Uvicorn 会监控当前目录的 Python 文件。更新独立网页版资源运行 `npm run build`。

### 使用 dev-tools / wsl-devctl（本机已配置）

根目录的 [wsl-devctl.toml](wsl-devctl.toml) 托管源码同步、后端和前端三个服务，项目名为 `infinite-image-browsing`。配置对应本机 Ubuntu、用户 `root` 和 `E:\Projects\MyProjects\infinite-image-browsing`；其他机器先修改配置中的用户、源码路径和数据路径。

首次准备（Windows PowerShell）：

```powershell
wsl -d Ubuntu -u root -- dev-tools project prepare /mnt/e/Projects/MyProjects/infinite-image-browsing
wsl -d Ubuntu -u root -- wsl-devctl register /mnt/e/Projects/MyProjects/infinite-image-browsing/wsl-devctl.toml
wsl -d Ubuntu -u root -- wsl-devctl start infinite-image-browsing --prepare
```

日常管理（已注册后不必重复注册）：

```powershell
wsl -d Ubuntu -u root -- wsl-devctl start infinite-image-browsing
wsl -d Ubuntu -- wsl-devctl status infinite-image-browsing
wsl -d Ubuntu -- wsl-devctl doctor infinite-image-browsing
wsl -d Ubuntu -u root -- wsl-devctl restart infinite-image-browsing
wsl -d Ubuntu -u root -- wsl-devctl stop infinite-image-browsing
```

依赖清单变化后，停止服务，再运行 `start infinite-image-browsing --prepare`。管理命令使用 root，应用进程以 `root` 运行。服务由 systemd 托管，关闭终端后继续运行；未设置开机自启。

继续在 Windows 源码目录编辑，wsl-devctl 每 750 毫秒同步到 WSL ext4 镜像 `/root/.cache/wsl-devctl/build/infinite-image-browsing`，由 Vite HMR / Uvicorn reload 应用修改。Windows 的 `venv`、`node_modules`、构建产物及 `.codegraph` 不同步；Linux 依赖在镜像内独立安装。前端准备时会构建 `vue/dist`，供后端独立页面使用。

开发访问 [http://localhost:3002](http://localhost:3002)，后端端口为 **7877**。数据库保存在 `/root/.local/share/infinite-image-browsing/iib.db`，媒体缓存保存在 `/root/.cache/infinite-image-browsing`，不会被源码同步覆盖。在网页添加图片目录时使用 WSL 路径，例如 `E:\ComfyUI\output` 对应 `/mnt/e/ComfyUI/output`。

## 依赖升级与验证

主要升级：Vue 3.5、Vite 8、Ant Design Vue 4、Pinia 4、Tauri 2、FastAPI 0.141、Pillow 12、PyAV 18、NumPy 2.5。直接依赖固定版本，前端和桌面端分别使用 npm / Cargo 锁文件。TypeScript 固定为 6.0.3，与仓库中的 ESLint 工具链配套。

```sh
python -m pip install -r requirements-dev.txt
python -m unittest discover -s scripts/iib -p "test_*.py"
python -m unittest scripts.iib.parsers.test_comfyui_only
python -m pip check
cd vue
npm run lint
npm test
npm run build
```

TwelveLabs/Marengo 语义搜索属于可选依赖，启用时安装 `requirements-marengo.txt`。在线测试需要单独配置 API Key，默认跳过。

## 作为桌面应用程序

桌面端迁移至 Tauri 2，打包的就是网页版同一套 Vue 页面、组件和样式；差异主要在原生窗口、文件夹选择器和系统 WebView 的字体渲染。每个桌面实例自行分配后端端口，独立网页版默认使用 7877。

构建需要 Rust 和对应系统的 Tauri 2 开发库；先将 Python 后端打包为 `iib_api_server-<目标平台>` 放入 `vue/src-tauri`，再运行 `npm run tauri-build`。Windows 打包步骤见 [.github/workflows/tauri_app_build.yml](.github/workflows/tauri_app_build.yml)。

## 作为库使用

使用 iframe 接入 IIB，将 IIB 作为应用的文件浏览器。参考[接入说明](vue/usage.md)。

## 作为 AI 助手技能

IIB 可以与 Claude Code、Cursor 和 OpenClaw 等 AI 助手一起使用。详情请参阅 [AI 助手文档](docs/ai-agents-zh.md)。

## 本地相似图片搜索

在媒体库搜索框点击图片图标选择参考图片，或直接将图片拖入搜索框。也可在图片的文件操作菜单中选择“查找相似图片”。结果直接显示在当前媒体网格，不跳转页面。搜索框下方显示参考图片，可更换图片、调整最低相似分，或点击“清除搜图”恢复原来的浏览结果和位置。结果按相似分排序，保留预览、选择和文件操作。输入文字并提交搜索可切回文字搜索。

- 全程在运行本服务的电脑上处理，不调用 AI、不需要 API 密钥、不上传第三方服务。
- 使用感知哈希和颜色直方图比较画面，适合重复图片、缩放压缩版本和相近构图；不提供人物识别、文本描述检索等语义能力。
- 搜索范围为已扫描收录的图片，不包含视频。首次会计算本地图片特征，后续复用缓存；文件修改时间或大小变化后重新计算。
- 相似分为 0–100，是视觉匹配分数，不是识别概率；最高分也不代表文件字节完全相同。每次最多显示 100 项。
- 参考图最大 20 MB，仅在内存中处理；图片特征缓存位于 `IIB_CACHE_DIR/similarity-v1.sqlite3`（未指定时使用默认缓存目录）。
- 接口：`POST /infinite_image_browsing/db/similar_images`，传 `image_base64` 或 `path` 二选一，以及 `minimum` 和 `limit`。接口沿用服务认证和目录访问控制。
- 验证：`python -m unittest scripts.iib.test_similarity scripts.iib.test_runtime`。

### 路径与部署系统

路径属于后端运行的系统。当前 WSL 开发服务使用 Linux 路径（例如 `/mnt/e/ComfyUI/output`）；Windows 完整桌面包启动 Windows 本地后端，使用 `E:\ComfyUI\output` 等盘符路径，并提供原生文件夹选择。WSL 中保存的目录配置不会自动转换为 Windows 路径，迁移后应重新选择媒体文件夹。