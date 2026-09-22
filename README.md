# 无边图像浏览


[查看近期更新](https://github.com/zanllp/sd-webui-infinite-image-browsing/wiki/Change-log)

[安装/运行](#安装运行)


## 软件支持

本项目仅面向本机文件管理，图片、视频、索引与界面设置均保存在本机。WSL 部署时可通过 `/mnt/c`、`/mnt/e` 等路径访问 Windows 磁盘。

仅解析 **ComfyUI** 生成的图片元数据，支持 PNG、JPEG、WebP 及 ComfyUI 图片中的兼容参数格式；提取范围取决于工作流节点。普通图片、视频和音频仍可浏览、搜索文件名和管理。

界面设置和工作区快照默认自动保存到本机数据库，无需开启同步开关；网页版和桌面版行为一致。

## 主要特性

### 本地媒体库界面
- 左侧固定导航：全部媒体、图片、视频、文件夹、搜索媒体和标签管理。
- 通过“添加文件夹”收录本机图片和视频，扫描后即可浏览；原文件保留在原位置。
- 已添加的文件夹显示在侧栏，也可在“文件夹”页面修改显示名称或移除浏览入口。
- 媒体库提供文件搜索、缩略图大小调整、选择文件和逐张查看。文件卡片提供预览、收藏及文件操作菜单。
- 搜图集成在媒体库搜索框中；图片对比、统计、导出和工作区位于“更多工具”。
- 使用蓝白应用布局，支持浅色、深色和跟随系统。网页版与桌面版共用这套界面。

### 🔥 极佳性能
- 存在缓存的情况下后，图像可以在几毫秒内显示。
- 默认使用缩略图显示图像，默认大小为512像素，您可以在全局设置页中调整缩略图分辨率。
- 你还可以控制网格图像的宽度，允许以64px到1024px的宽度范围进行显示
- 支持通过`--generate_video_cover`和`--generate_image_cache`来预先生成缩略图和视频封面，以提高性能。
- 支持通过`IIB_CACHE_DIR`环境变量来指定缓存目录。

### 🔍 图像搜索和收藏
- 将会把Prompt、Model、Lora等信息转成标签，将根据使用频率排序以供进行精确的搜索。
- 支持标签自动完成、[翻译](https://github.com/zanllp/sd-webui-infinite-image-browsing/issues/39)和自定义。
- 可通过在右键菜单切换自定义标签来实现图像收藏。
- 支持类似谷歌的高级搜索。
- 同样支持模糊搜索，您可以使用文件名或生成信息的一部分进行搜索。
- 支持添加自定义搜索路径，方便管理自己创建的文件夹集合。
- 支持媒体类型筛选、视频标签搜索与随机排序。
- 支持按规则自动打标签。

### 🎵 逐张查看
- 一次显示一张图片或一个视频，通过方向键切换，按 Esc 返回。
- 信息面板与背景遮罩持续优化，预览返回更顺畅。
- 删除操作在逐张查看时保持同步。

### 🖼️ 查看图像/视频和“发送到”
- 支持查看图像生成信息。全屏预览下同样支持。
- EXIF/元数据集成在全屏预览中，支持分层浏览与高亮显示。
- 支持全屏预览，并且支持在全屏预览下使用自定义快捷键进行操作
- 支持在全屏预览模式下通过按下方向键或点击按钮移动到前一个或后一个图像。
- 支持播放本机文件夹中的视频文件

### 💻 多种使用方法
- 您可以使用 Python 独立运行它。
- 还提供桌面应用程序版本。
- **NEW**：[与 AI 助手一起使用](docs/ai-agents-zh.md)（Claude Code、Cursor、OpenClaw 等）

### 🚶‍♀️ Walk模式
- 自动加载下一个文件夹 `(类似于 os.walk)`，可让您无需分页浏览所有图像。
- 已测试可正常处理超过 27,000 个文件。
- 当存在文件夹的情况下你可以通过右上角的walk按钮从其他模式切换到walk模式，它会将所有的文件夹打平，避免来回进出文件夹的繁琐操作。

### 🌳 基于文件树结构的预览和文件操作
- 支持基于文件树结构的预览。
- 支持自动刷新。
- 支持基本文件操作以及多选删除/移动/复制，新建文件夹等。
- 按住 Ctrl、Shift 或 Cmd 键可选择多个项目。
  - 支持多选的操作有：删除、移动、复制、打包下载、添加标签、移除标签，移动到其他文件夹，复制到其他文件夹，拖拽
  - 你可以通过右下角的保持多选按钮来保持多选的状态，对选中的文件集合可以很方便的进行多次操作
- 支持拖拽到文件夹，移动/复制支持“出错继续”。

### 🆚 图像对比 (类似ImgSli)
- 提供两张图片的并排比较
- 同时提供图像生成信息的比较

### 🌐 多语言支持
- 目前支持简体中文/繁体中文/英文/德语。
- 如果您希望添加新的语言，请参考 [i18n.ts](https://github.com/zanllp/sd-webui-infinite-image-browsing/blob/main/vue/src/i18n/zh-hans.ts) 并提交相关的代码。


### 🔐 隐私和安全
- 支持自定义secret key来进行身份验证
- 支持自定义访问控制允许的路径。
- 支持控制访问权限。你可以让IIB以只读模式运行
- [点击这里查看详情](.env.example)

### ⌨️ 快捷键
- 支持删除和添加/移除Tag，在全局设置页进行自定义触发按钮

### 📦 打包 / 批量下载
- 允许你一次性打包下载多个图像
- 数据来源可以是搜索结果/普通的图像网格查看页面/walk模式等。使用拖拽或者“发送到”都可将图片添加待处理列表


如果您喜欢这个项目并且觉得它对您有帮助，请考虑给我点个⭐️。这将对我持续开发和维护这个项目非常重要。如果您有任何建议或者想法，请随时在issue中提出，我会尽快回复。再次感谢您的支持！


[在微信上赞助我](.github/wechat_funding.jpg)

<a href='https://ko-fi.com/zanllp' target='_blank'><img height='35' style='border:0px;height:46px;' src='https://az743702.vo.msecnd.net/cdn/kofi3.png?v=0' border='0' alt='Buy Me a Coffee at ko-fi.com' />


[视频演示可以在Bilibili上观看](https://space.bilibili.com/27227392/channel/series)

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

打开 [网页版](http://127.0.0.1:7877)。后端默认端口为 **7877**，可用 `--port` 覆盖。在首页通过 **+ 添加** 将 ComfyUI 输出文件夹加入搜索索引；`--extra_paths` 只提供浏览入口。仓库内的 `vue/dist` 是已构建的网页，普通运行不需要 Node.js。

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

根目录的 [wsl-devctl.toml](wsl-devctl.toml) 托管源码同步、后端和前端三个服务，项目名为 `infinite-image-browsing`。配置对应本机 Ubuntu、用户 `hxd` 和 `E:\CodingProjects\Local\infinite-image-browsing`；其他机器先修改配置中的用户、源码路径和数据路径。

首次准备（Windows PowerShell）：

```powershell
wsl -d Ubuntu -- dev-tools project prepare /mnt/e/CodingProjects/Local/infinite-image-browsing
wsl -d Ubuntu -u root -- wsl-devctl register /mnt/e/CodingProjects/Local/infinite-image-browsing/wsl-devctl.toml
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

依赖清单变化后，停止服务，再运行 `start infinite-image-browsing --prepare`。管理命令使用 root，应用进程以 `hxd` 运行。服务由 systemd 托管，关闭终端后继续运行；未设置开机自启。

继续在 Windows 源码目录编辑，wsl-devctl 每 750 毫秒同步到 WSL ext4 镜像 `/home/hxd/.cache/wsl-devctl/build/infinite-image-browsing`，由 Vite HMR / Uvicorn reload 应用修改。Windows 的 `venv`、`node_modules`、构建产物及 `.codegraph` 不同步；Linux 依赖在镜像内独立安装。前端准备时会构建 `vue/dist`，供后端独立页面使用。

开发访问 [http://localhost:3002](http://localhost:3002)，后端端口为 **7877**。数据库保存在 `/home/hxd/.local/share/infinite-image-browsing/iib.db`，媒体缓存保存在 `/home/hxd/.cache/infinite-image-browsing`，不会被源码同步覆盖。在网页添加图片目录时使用 WSL 路径，例如 `E:\ComfyUI\output` 对应 `/mnt/e/ComfyUI/output`。

## 依赖升级与验证

主要升级：Vue 3.5、Vite 8、Ant Design Vue 4、Pinia 4、Tauri 2、FastAPI 0.141、Pillow 12、PyAV 18、NumPy 2.5。直接依赖固定版本，前端和桌面端分别使用 npm / Cargo 锁文件。TypeScript 使用当前 ESLint 工具链兼容的最新 6.x 稳定版（6.0.3），未强行升级到不兼容的 7.x。

```sh
python -m pip install -r requirements-dev.txt
python -m unittest scripts.iib.test_runtime scripts.iib.parsers.test_comfyui_only scripts.iib.test_marengo_embedding
python -m pip check
cd vue
npm run lint
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

# 预览

<img width="1920" alt="image" src="https://user-images.githubusercontent.com/25872019/230064374-47ba209e-562b-47b8-a2ce-d867e3afe204.png">

## 图像搜索

在第一次使用时，你需要点击等待索引的生成，我2万张图像的情况下大概需要15秒（配置是amd 5600x和pcie ssd）。后续使用他会检查文件夹是否发生变化，如果发生变化则需要重新生成索引,通常这个过程极快。

图像搜索支持翻译，具体看这个 https://github.com/zanllp/sd-webui-infinite-image-browsing/issues/39 。
<img width="1109" alt="image" src="https://github.com/zanllp/sd-webui-infinite-image-browsing/assets/25872019/62d1ffe3-2d1f-4449-803a-970273753855">
<img width="620" alt="image" src="https://user-images.githubusercontent.com/25872019/234639759-2d270fe5-b24b-4542-b75a-a025ba78ec89.png">
## 图像比较

![ezgif com-video-to-gif](https://github.com/zanllp/sd-webui-infinite-image-browsing/assets/25872019/4023317b-0b2d-41a3-8155-c4862eb43846)

## 全屏预览 (并排布局)
![11](https://github.com/zanllp/sd-webui-infinite-image-browsing/assets/25872019/ee941bfc-0c1b-4777-91df-115435cc8542)

## 全屏预览
<img width="1024" alt="image" src="https://user-images.githubusercontent.com/25872019/232167416-32a8b19d-b766-4f98-88f6-a1d48eaebec0.png">

在全屏预览下同样可以查看图片信息和进行上下文菜单上的的操作，支持拖拽/调整/展开收起

https://user-images.githubusercontent.com/25872019/235327735-bfb50ea7-7682-4e50-b303-38159456e527.mp4


如果你和我一样不需要查看生成信息，你可以选择直接缩小这个面板，所有上下文操作仍然可用

<img width="599" alt="image" src="https://github.com/zanllp/sd-webui-infinite-image-browsing/assets/25872019/f26abe8c-7a76-45c3-9d7f-18ae8b6b6a91">

### 右键菜单
<img width="1024" alt="image" src="https://user-images.githubusercontent.com/25872019/230896820-26344b09-2297-4a2f-a6a7-4c2f0edb8a2c.png">

也可以通过右上角的图标来触发
<img width="227" alt="image" src="https://github.com/zanllp/sd-webui-infinite-image-browsing/assets/25872019/f2005ad3-2d3b-4fa7-b3e5-bc17f26f7e19">

### Walk模式


https://user-images.githubusercontent.com/25872019/230768207-daab786b-d4ab-489f-ba6a-e9656bd530b8.mp4




### 深色模式

<img width="768" alt="image" src="https://user-images.githubusercontent.com/25872019/230064879-c95866ac-999d-4d4b-87ea-3e38c8479415.png">

## 本地相似图片搜索

在媒体库搜索框点击“搜图”选择参考图片，或直接将图片拖入搜索框。也可在图片的文件操作菜单中选择“查找相似图片”。结果直接显示在当前媒体网格，不跳转页面。搜索框下方显示参考图片，可更换图片、调整最低相似分，或点击“清除搜图”恢复原来的浏览结果和位置。结果按相似分排序，保留预览、选择和文件操作。输入文字并点击“搜索”可切回文字搜索。

- 全程在运行本服务的电脑上处理，不调用 AI、不需要 API 密钥、不上传第三方服务。
- 使用感知哈希和颜色直方图比较画面，适合重复图片、缩放压缩版本和相近构图；不提供人物识别、文本描述检索等语义能力。
- 搜索范围为已扫描收录的图片，不包含视频。首次会计算本地图片特征，后续复用缓存；文件修改时间或大小变化后重新计算。
- 相似分为 0–100，是视觉匹配分数，不是识别概率；最高分也不代表文件字节完全相同。每次最多显示 100 项。
- 参考图最大 20 MB，仅在内存中处理；图片特征缓存位于 `IIB_CACHE_DIR/similarity-v1.sqlite3`（未指定时使用默认缓存目录）。
- 接口：`POST /infinite_image_browsing/db/similar_images`，传 `image_base64` 或 `path` 二选一，以及 `minimum` 和 `limit`。接口沿用服务认证和目录访问控制。
- 验证：`python -m unittest scripts.iib.test_similarity scripts.iib.test_runtime`。

### 路径与部署系统

路径属于后端运行的系统。当前 WSL 开发服务使用 Linux 路径（例如 `/mnt/e/ComfyUI/output`）；Windows 完整桌面包启动 Windows 本地后端，使用 `E:\ComfyUI\output` 等盘符路径，并提供原生文件夹选择。WSL 中保存的目录配置不会自动转换为 Windows 路径，迁移后应重新选择媒体文件夹。