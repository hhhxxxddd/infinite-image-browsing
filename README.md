# 拾影

**把散落在本机的图片、视频和动图，整理成可以浏览、检索和继续创作的媒体库。**

拾影是一款以 Windows 桌面端为主的本地媒体管理应用，也可作为独立网页服务运行。它收录已有文件夹，建立索引、缩略图和标签；媒体原文件留在原处。界面使用 Vue 3，桌面外壳使用 Tauri 2，后端使用 Python、FastAPI 和 SQLite。

## 能做什么

- **一起浏览**：按全部媒体、图片、视频或目录查看；横竖图与视频按比例混排。目录图展示文件夹层级，已添加的根目录可以设置显示名称。支持增量扫描、缩略图尺寸切换，以及拖到另一张卡片上交换手动顺序。
- **找到想要的内容**：按文件名、标签、个人描述搜索；用标签分组、排除标签、比例和尺寸组合筛选。可用本地 Qwen3-VL 根据画面描述或参考图找图，也可用感知哈希寻找近重复图片。
- **整理与导出**：彩色标签可分组、搜索和设置自动打标规则；支持多选后打标签、复制、移动、删除和 ZIP 导出。Windows 桌面版支持从资源管理器拖入文件夹，以及把原文件拖出到桌面。
- **预览与编辑**：逐张预览图片、动图、视频和音频，查看或收起右侧详情；查看生成参数，补写描述、标签和生成信息。图片可裁剪、缩放和调整比例，结果另存为副本，并继承原图的标签和必要元信息。内置播放器不支持的格式可交给本机应用打开。
- **按需接入 AI**：下载或选用已有的 Qwen3-VL 检索、重排与内容处理模型，生成描述、参考提示词和标签建议；内容处理还可选加载时 4/8 位量化、本机 GGUF 视觉服务、Comfy Cloud 直连模型或自定义 JSON 工作流、OpenRouter。模型权重不随源码或安装包分发。

媒体索引与用户补充的信息保存在本地数据库；日常整理不会搬动原文件。复制、移动、重命名、删除和图片编辑等明确的文件操作会修改磁盘内容或生成副本。

本地索引与本地模型推理不需要把媒体上传到云端。选择 Comfy Cloud API 或 OpenRouter 内容处理时，待处理图片会缩放后发送给对应服务；具体行为见 [AI 接入](docs/qwen3-vl-search.md)。

## 运行

### 独立网页服务

需要 **Python 3.12+**。在仓库根目录运行：

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py --port 7877
```

然后打开 <http://127.0.0.1:7877>，从界面添加文件夹。WSL / Linux 将激活命令换为 `source venv/bin/activate`。仓库中的 `vue/dist` 是服务读取的前端资源，直接运行服务无需先安装 Node.js。

本地 Qwen 推理另外需要 `python -m pip install -r requirements-qwen3-vl.txt`；随后在“设置 → AI 接入”下载模型或选择后端可访问的现有模型目录。模型体积和配置方式见 [AI 接入](docs/qwen3-vl-search.md)。

### 前端开发

需要 **Node.js 24**。先在仓库根目录启动后端：

```powershell
python -m uvicorn app:create_app --factory --reload --port 7877
```

再开一个终端：

```powershell
cd vue
npm ci
npm run dev
```

开发页面位于 <http://localhost:3002>，Vite 将 API 转发到后端。更新独立服务使用的前端资源时运行 `npm run build`。Windows 桌面版使用 Tauri 2 和打包的 Python sidecar；构建步骤见 [桌面构建工作流](.github/workflows/tauri_app_build.yml)。

## 文档与验证

[文档索引](docs/README.md) · [媒体库操作](docs/media-library.md) · [AI 接入](docs/qwen3-vl-search.md) · [开发结构](docs/development.md) · [更新记录](CHANGELOG.md)

```powershell
python -m pip install -r requirements-dev.txt
python -m unittest discover -s scripts/iib -p "test_*.py"
python -m unittest scripts.iib.parsers.test_comfyui_only
cd vue
npm run lint
npm run build
npm test
```

## 项目来源

拾影由 [zanllp 的 Infinite Image Browsing](https://github.com/zanllp/sd-webui-infinite-image-browsing) fork 而来。感谢原项目及其贡献者提供的媒体索引、预览与开源基础。拾影已围绕本地媒体库重新设计了界面、目录和标签工作流、混合媒体预览及 AI 检索；两者现在是不同的产品方向。原项目的许可证见 [LICENSE](LICENSE)。为兼容已有安装和数据库，部分内部名称、API 路径及桌面应用标识 `com.zanllp.iib` 仍沿用上游。
