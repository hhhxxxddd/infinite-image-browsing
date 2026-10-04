# OmniGallery · 星空馆

**收藏所爱，创作所想。** 本地图片、视频和音频管理与创作工具，支持 Windows 桌面应用和独立网页服务。

- **媒体库：** 收录已有目录，按名称、标签、描述和尺寸查找；混合预览、收藏、批量整理、图片对比及 ZIP 导出。
- **工作台：** 用工作区组织作品、共享素材、制作文件与成果；支持图片图层、文字、画框、漫画版式与共享模板，音频多轨混音和视频剪辑。
- **可选 AI：** 本地 Qwen 图片语义／相似搜索和内容建议；Comfy Router／Cloud 提供图片生成、编辑及可恢复后台任务；图片图层内置消除、抠图与高清化。
- **本机数据：** 只设置一个应用数据目录，统一保存数据库、作品、编辑快照、归档、模型和运行环境，提供占用统计及缓存清理。原媒体保留原位置；主动使用云服务时才上传相关输入。

界面使用 React、Mantine 和 TypeScript，桌面宿主为 Tauri 2，后端使用 FastAPI、SQLite 和 FFmpeg。

## 快速运行

开发与 CI 使用 Python 3.14.8 和 Node.js 24。在仓库根目录执行：

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

## 数据与边界

源码运行数据默认放在 `.local/`，可在设置中统一迁移；桌面默认使用当前用户的应用数据目录。迁移在重启时复制、校验再切换，保留原目录。备份应用数据及原媒体，操作见[存储与备份](docs/01-user-guide/04-storage.md)，部署配置见[环境示例](.env.example)。

复制和压平拒绝媒体或 TXT 侧车同名覆盖，重命名同步侧车与应用引用。重新扫描保留媒体身份、收藏、自定义标签和注释；草稿与原图保存会拒绝过期会话覆盖。

图片向量索引不包含音视频。AI 音频／视频入口尚未接入生成服务。预览播放取决于编码与系统解码器，可读取封面不代表原文件可播放。视频剪辑目前不含转场和关键帧动画。

## 文档

[文档导航](docs/README.md) · [媒体库](docs/01-user-guide/01-media-library.md) · [工作台](docs/01-user-guide/02-workbench.md) · [图片编辑](docs/01-user-guide/05-image-editor.md) · [AI 接入](docs/01-user-guide/03-ai-services.md) · [存储与备份](docs/01-user-guide/04-storage.md) · [更新记录](docs/04-changelog.md)

源码目录、开发命令、检查和桌面打包统一见[开发指南](docs/02-development/01-development.md)。

## 项目来源

基于 [Infinite Image Browsing](https://github.com/zanllp/sd-webui-infinite-image-browsing) 发展，感谢原项目的开源基础。使用 [MIT 许可证](LICENSE)。英文产品名 OmniGallery，Python 包名 `omnigallery`，桌面标识 `app.omnigallery.desktop`。
