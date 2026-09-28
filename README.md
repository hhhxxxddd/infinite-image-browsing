# OmniGallery · 万象馆

**收藏所爱，创作所想。** 面向 Windows 桌面的本地图片、视频、音频管理工具，也可独立运行网页服务。基于 Vue 3、Tauri 2、FastAPI 与 SQLite。

- **管理与查找：** 收录已有目录，按名称、标签、描述筛选；混合媒体预览、拖动排序、批量整理和 ZIP 导出，可选本地 Qwen 画面／相似搜索。
- **编辑与创作：** 图片图层、文字、分组、裁剪、缩放；保存副本或覆盖后可恢复编辑。工作台用作品组织制作文件、产物与成果，支持 Comfy 后台加工和结果对比；选定成果后可同步到媒体库。
- **数据留本机：** 原媒体保留原位置，索引在数据库；工作区产物与编辑快照使用可配置项目目录。只有主动选择云 AI 时上传相关输入，模型权重独立下载。

## 快速运行

需要 Python 3.12+和 Node.js 24。在仓库根目录运行：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e .
npm --prefix frontend ci
npm --prefix frontend run build
python -m omnigallery --port 7877
```

打开 <http://127.0.0.1:7877> 并添加目录。Linux 激活环境用 `source .venv/bin/activate`。Windows 原生热部署、统一检查及打包见[开发指南](docs/02-development/01-development.md)，本地推理依赖见[AI 接入](docs/01-user-guide/03-ai-services.md)。

开发数据默认`.local`，可通过[环境配置](.env.example)调整。工作区作品、制作文件和图层／AI 编辑状态保存在 SQLite，已有浏览器数据首次读取时迁入。备份需包括数据库、项目数据及原媒体。当前处于 Spike 阶段，新标识与数据格式不兼容旧应用数据。

## 文档

[文档导航](docs/README.md) · [媒体库](docs/01-user-guide/01-media-library.md) · [工作台](docs/01-user-guide/02-workbench.md) · [更新记录](docs/04-changelog.md)

## 项目来源

由 [Infinite Image Browsing](https://github.com/zanllp/sd-webui-infinite-image-browsing) fork，感谢原项目的媒体索引与开源基础。现围绕本地媒体管理及创作独立发展，保留原[许可证](LICENSE)。英文产品名 OmniGallery，Python 包`omnigallery`，桌面标识`app.omnigallery.desktop`。
