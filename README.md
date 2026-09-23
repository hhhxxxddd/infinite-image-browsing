# 拾影

拾影是本地媒体库，用于整理图片、视频和音频，尤其适合保存 AI 生图及其生成信息。媒体原文件留在原目录；应用记录索引、标签、描述和界面设置。提供 Windows 桌面版、独立网页服务和开发模式。

项目源自 [Infinite Image Browsing](https://github.com/zanllp/sd-webui-infinite-image-browsing)。当前界面与检索流程已独立演进；原许可证和既有数据目录标识仍予保留，以兼容现有安装与数据库。

[使用说明](docs/media-library.md) · [AI 接入](docs/qwen3-vl-search.md) · [开发与代码结构](docs/development.md) · [嵌入集成](vue/usage.md) · [更新记录](CHANGELOG.md)

## 功能

- **媒体库与文件夹**：收录本机目录；按全部媒体、图片、视频或文件夹浏览；支持增量扫描、标签、排序、批量操作和 ZIP 导出。
- **预览与信息**：查看原图和生成参数；编辑个人描述、标签及补充的生成信息，修改保存到数据库，不写回原文件。
- **文字搜索**：查找文件名、标签和个人描述。支持 `tag:`、`name:`、`desc:`、`has:desc`、引号短语、排除、`OR` 与括号。路径不参与文字匹配；当前媒体库搜索框不提供正则模式。
- **画面搜索**：在同一搜索框切换到画面模式，由本地 Qwen3-VL Embedding 按自然语言找图；文字词与画面描述分别使用，已应用筛选继续生效。可选 Reranker 重排候选；以图搜图也可用感知哈希与颜色匹配来找近重复图片。
- **图片内容处理**：使用本地 Qwen3-VL Instruct 或 OpenRouter 生成描述建议、反推参考提示词、推荐已有标签。结果由用户决定是否保存。
- **设置**：管理扫描、缩略图、标签规则、快捷键、归档目录以及三类 AI 能力的模型与提示词。

## 安装运行

### Python 独立服务

需要 Python 3.12+。在仓库根目录创建虚拟环境并安装基础依赖：

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py --port 7877
```

在 WSL / Linux 中用 `source venv/bin/activate` 激活环境。打开 [http://127.0.0.1:7877](http://127.0.0.1:7877)，再从界面添加媒体目录。仓库中的 `vue/dist` 是预构建网页；只有修改前端源码时才需要 Node.js。

本地 Qwen 模型按需另装 `requirements-qwen3-vl.txt`，然后在“设置 → AI 接入”下载模型或选择已有目录。模型权重不随源码和 EXE 分发。资源要求与数据目录见 [AI 接入说明](docs/qwen3-vl-search.md)。

### 前端与后端开发

前端使用 Node.js 24、npm；后端在项目根目录运行：

```powershell
python -m uvicorn app:create_app --factory --reload --port 7877
```

另一终端运行前端：

```powershell
cd vue
npm ci
npm run dev
```

开发页为 [http://localhost:3002](http://localhost:3002)，Vite 将 API 代理到 `127.0.0.1:7877`。更新独立网页资源时在 `vue` 目录执行 `npm run build`。

仓库中的 [wsl-devctl.toml](wsl-devctl.toml) 是当前机器的 Windows / WSL 热部署示例，包含特定用户名和路径。其他机器使用前需修改对应配置；它不是跨机器通用的默认部署文件。

### Windows 桌面版

桌面版基于 Tauri 2，启动打包的 Python 后端。构建脚本见 [.github/workflows/tauri_app_build.yml](.github/workflows/tauri_app_build.yml)。用户可在设置中下载模型；权重保存在应用数据目录，不打进安装包。

为保留现有安装的数据，桌面应用标识仍为 `com.zanllp.iib`。数据库位于 `%LOCALAPPDATA%\com.zanllp.iib\iib.db`；默认归档目录为同目录下的 `zip_temp`。更换应用标识前必须设计数据迁移，不能直接改名。

## 数据与隐私

默认情况下，媒体、索引和本地 AI 推理均在运行服务的机器上处理。选择 OpenRouter 内容处理时，应用会把待处理图片发送给所配置的服务；详见 [AI 接入说明](docs/qwen3-vl-search.md)。访问认证、允许目录及只读模式见 [.env.example](.env.example)。

普通图片、视频和音频也可收录；能否在内置播放器中播放取决于浏览器或桌面 WebView 的解码能力。当前自动生成信息解析主要针对 ComfyUI 图片元数据；无元数据的媒体仍可手动添加描述与标签。

## 检查

```powershell
python -m pip install -r requirements-dev.txt
python -m unittest discover -s scripts/iib -p "test_*.py"
cd vue
npm run type-check
npm test
npm run build
```

更细的界面操作见 [媒体库使用说明](docs/media-library.md)。
