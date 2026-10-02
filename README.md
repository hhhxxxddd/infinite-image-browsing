# OmniGallery · 星空馆

**收藏所爱，创作所想。** 本地图片、视频和音频管理与创作工具，支持 Windows 桌面应用和独立网页服务。

- **媒体库：** 收录已有目录，按名称、标签、描述和尺寸查找；混合预览、收藏、批量整理、图片对比及 ZIP 导出。
- **工作台：** 用工作区组织作品、共享素材、制作文件与成果；支持图片图层编辑、音频多轨混音和视频剪辑。
- **可选 AI：** 本地 Qwen 图片语义／相似搜索和内容建议；Comfy 服务提供图片生成、编辑、多结果及后台任务。
- **本机数据：** 原媒体保留原位置，索引与制作状态保存在 SQLite，产物和编辑快照存入可配置项目目录。主动使用云服务时才上传相关输入。

界面使用 React、Mantine 和 TypeScript，桌面宿主为 Tauri 2，后端使用 FastAPI、SQLite 和 FFmpeg。

## 快速运行

需要 Python 3.12+ 和 Node.js 24。在仓库根目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
npm --prefix frontend ci
npm --prefix frontend run build
python -m omnigallery --port 7877
```

打开 <http://127.0.0.1:7877> 并添加媒体目录。Linux 使用 `source .venv/bin/activate` 激活环境。音视频制作需要 FFmpeg 和 ffprobe；本地 AI 模型与推理环境独立安装，基础启动不需要下载模型。

Windows 安装包见 [Releases](https://github.com/hhhxxxddd/infinite-image-browsing/releases)。源码开发和打包方法见[开发指南](docs/02-development/01-development.md)。

## 开发与检查

安装 `backend/requirements/dev.txt` 后，在两个终端分别执行：

```powershell
python tools/dev/run_backend.py
npm --prefix frontend run dev
```

前端为 <http://localhost:3002>，`/api` 代理到本机 7877。统一检查执行 `python tools/check.py`，包含格式、lint、类型、测试与前端构建。

```text
frontend/react/          页面、组件、编辑器与主题
frontend/src/            独立领域模型、仓储、类型与字典
frontend/src-tauri/      桌面宿主
backend/src/omnigallery/ 后端包
tools/                  开发、检查、打包与测试素材工具
docs/                   使用与开发文档
```

## 数据与边界

源码运行数据默认放在 `.local/`，配置见 [环境示例](.env.example)。备份需包含数据库、项目数据目录和原媒体；编辑文档、产物及输入快照属于持久数据。

图片向量索引不包含音视频。AI 音频／视频入口尚未接入生成服务。预览播放取决于编码与系统解码器，可读取封面不代表原文件可播放。视频剪辑目前不含转场和关键帧动画。

## 文档

[文档导航](docs/README.md) · [媒体库](docs/01-user-guide/01-media-library.md) · [工作台](docs/01-user-guide/02-workbench.md) · [AI 接入](docs/01-user-guide/03-ai-services.md) · [更新记录](docs/04-changelog.md)

## 项目来源

基于 [Infinite Image Browsing](https://github.com/zanllp/sd-webui-infinite-image-browsing) 发展，感谢原项目的开源基础。使用 [MIT 许可证](LICENSE)。英文产品名 OmniGallery，Python 包名 `omnigallery`，桌面标识 `app.omnigallery.desktop`。
