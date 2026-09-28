# 01 · 开发指南

[文档首页](../README.md) · [代码规范](02-coding-standards.md) · [架构与性能](05-architecture-performance.md)

## 1. 安装与运行

使用 **Python 3.12+、Node.js 24**，命令在仓库根目录执行。Windows 推荐独立虚拟环境：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e . -r backend/requirements/dev.txt
npm --prefix frontend ci
```

已安装 `wsl-devctl` 和 `mise` 时，先运行 `mise install` 安装仓库指定工具，再使用原生 Windows 配置统一管理服务：

```powershell
wsl-devctl win register .
wsl-devctl win start omnigallery --prepare  # 首次准备依赖
wsl-devctl win status omnigallery
wsl-devctl win restart omnigallery
wsl-devctl win stop omnigallery
```

根配置为 [`wsl-devctl.windows.json`](../../wsl-devctl.windows.json)，直接运行 Windows `.venv` 后端和本机前端，不同步到 WSL。之后启动可省略 `--prepare`。可选 WSL 模板位于 [`tools/dev/wsl-devctl.example.toml`](../../tools/dev/wsl-devctl.example.toml)，按本机环境配置，不能同时占用相同端口。

Windows 配置声明前端 `3002`、后端 `7877` 端口。更新后的 `wsl-devctl` 会检查进程、端口及端口是否属于该服务；HTTP 可用性仍需直接访问 `http://localhost:3002` 和 `http://127.0.0.1:7877/openapi.json` 核验。

从打包的 Windows 应用中执行命令时，`AppData` 写入可能被重定向到该应用的私有缓存。首次 `mise install` 和 `wsl-devctl win prepare omnigallery` 建议在普通 PowerShell 7 终端执行，确保独立后台服务也能访问运行环境。若出现虚拟环境找不到基础 Python 的错误，应检查后台进程可见的安装路径，完成原生环境准备后再启动服务。

也可手动在两个终端分别热加载：

```powershell
python tools/dev/run_backend.py
```

```powershell
npm --prefix frontend run dev
```

后端开发入口 [`run_backend.py`](../../tools/dev/run_backend.py) 使用 `watchfiles` 监听 `backend/src`，文件变化后重启服务，避免 Windows 隐藏控制台下的重载信号中断服务管理进程。`watchfiles` 仅列在[开发依赖](../../backend/requirements/dev.txt)，独立运行和发布包不依赖它。

打开 `http://localhost:3002`，Vite 将 `/api` 代理到 7877。独立服务先构建前端再启动：

```powershell
npm --prefix frontend run build
python -m omnigallery --port 7877
```

打开 `http://127.0.0.1:7877`。安装后也可使用 `omnigallery --port 7877`。页面根为 `/`，静态资源 `/static`，API `/api`；不提供旧前缀或 `/db` 分层。Linux 激活环境使用 `source .venv/bin/activate`。嵌入范围见[嵌入集成](04-embedding.md)。

依赖文件统一放 `backend/requirements/`：`base.txt` 由可安装包读取，`dev.txt` 为开发工具，`qwen.txt`／`qwen-quant.txt` 为本地推理扩展，`marengo.txt` 为独立实验依赖，`search-index.txt` 为可选 ANN 加速。未装 ANN 时主题聚类用精确余弦比较，功能保留但大集合较慢；Windows 安装该扩展需要 C++构建工具。普通检查不要求完整模型或云端凭据。

### 1.1 本地 Qwen 推理依赖

基础安装及 `wsl-devctl win start omnigallery --prepare` 不包含本地 Qwen 推理扩展。模型文件下载完成后，还需在后端使用的 `.venv` 中安装这些依赖。Windows NVIDIA 显卡使用与桌面运行环境配方一致的 CUDA 12.8 组合：

```powershell
.\.venv\Scripts\python.exe -m pip install torch==2.11.0 torchvision==0.26.0 --index-url https://download.pytorch.org/whl/cu128
.\.venv\Scripts\python.exe -m pip install -r backend/requirements/qwen-quant.txt transformers==4.57.6 qwen-vl-utils==0.0.14 scipy==1.18.1 accelerate==1.12.0 bitsandbytes==0.49.2
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe -c "import torch; print(torch.__version__, torch.cuda.is_available())"
wsl-devctl win restart omnigallery
```

仅使用 CPU 时，将第一个命令的索引改为 `https://download.pytorch.org/whl/cpu`；不使用量化时可安装 `qwen.txt` 并省略 `accelerate`／`bitsandbytes`。EXE 使用应用内的 AI 运行环境安装器，不使用源码 `.venv`。

## 2. 目录

```text
frontend/
  src/app/               启动和页面组合
  src/features/          业务组件、状态、API、模型
  src/shared/            基础 UI、样式、HTTP、类型、纯工具
  src-tauri/             桌面窗口与 Python sidecar
  scripts/               性能基准
backend/
  src/omnigallery/        可安装 Python 包
  requirements/          基础、开发和可选推理依赖
  tests/{unit,integration,support}/
tools/                   检查、维护、测试素材与打包
docs/                   按使用、开发、研究分类的说明
.local/                  忽略提交的运行数据及构建中间产物
```

前端测试 `*.test.mjs` 跟随模型；后端测试按单元／集成分区，共享资源在 support。详细依赖边界见[架构说明](05-architecture-performance.md#1-模块与边界)。

## 3. 运行数据与重置

| 配置 | 默认位置／用途 |
| --- | --- |
| `OMNIGALLERY_DATA_DIR` | 源码 `.local`；桌面为用户应用数据目录 |
| `OMNIGALLERY_DB_PATH` | 数据根 `db/omnigallery.db` |
| `OMNIGALLERY_CACHE_DIR` | 数据根 `cache`；桌面使用系统应用缓存目录 |
| `OMNIGALLERY_PROJECT_DATA_DIR` | 源码数据根 `project-data`；桌面 exe 旁 `.local/project-data`，设置可更改 |
| `OMNIGALLERY_STATIC_DIR` | 源码／打包资源中的 `frontend/dist` |
| `OMNIGALLERY_MODEL_DIR` | 数据根 `models`，桌面为用户应用数据下 `models` |

项目数据包含工作区产物、媒体库编辑文档和快照，属于持久数据，不能当缓存清理。工作区制作文件及图层／AI 编辑状态保存在数据库，备份需同时包含数据库与项目目录。目录迁移先复制校验再切换，旧目录保留备份；新旧托管区均排除扫描。完整配置示例见 [`.env.example`](../../.env.example)。

偏好在 localStorage 缓存并防抖写数据库；工作区作品、制作文件、图层和 AI 状态通过事务写入 SQLite，首次读取迁入已有 `omnigallery:*` 浏览器状态。同一服务／数据库下，浏览器与桌面 WebView 共享制作文件，各自保留界面偏好。保存失败和版本冲突不发布暂存修改，详见[状态持久化](05-architecture-performance.md#1-模块与边界)。桌面标识为 `app.omnigallery.desktop`；Spike 不读取旧应用标识的数据。

重置开发数据先预览目标：

```powershell
python tools/maintenance/reset_development_data.py
```

停用服务与桌面应用后加 `--yes` 才删除受控 `.local` 数据。工具拒绝外部链接／目录联接，不清理原始媒体、模型、凭据、自定义项目目录、源码或 Git。不要对运行中的数据库执行重置。

## 4. 检查与构建

```powershell
python tools/check.py             # 全部
python tools/check.py backend     # Ruff、格式、后端与工具测试
python tools/check.py frontend    # 格式、ESLint、类型、测试、构建
```

基础 CI 不运行真实付费任务或完整模型推理；需要凭据／权重的验证单独说明，跳过不等于通过。后端测试使用临时数据库，先关客户端与线程连接再清临时目录。连接诊断可加 `-X tracemalloc=8 -W always::ResourceWarning`；`with sqlite3.connect(...)` 只管理事务，不关闭连接。

`frontend/dist`、sidecar 与运行数据不提交。Windows 后端打包工具是 `tools/packaging/build_backend.py`，支持 Nuitka、PyInstaller 和 `--dry-run`；`--with-models` 收集可选云模型 SDK，Qwen 的本地推理依赖统一由 EXE 内的运行环境管理器安装，不嵌入冻结程序；`--with-search-index` 显式收集 ANN 扩展，默认 core 包不包含。Tauri Windows 构建及打包后启动检查见[发布工作流](../../.github/workflows/desktop-release.yml)。维护工具在 `tools/maintenance`，演示素材生成器在 `tools/test-data`。

EXE 的 `ai-runtime` 安装器使用官方 Python 嵌入发行包及 pip wheel（固定 SHA-256 校验），仅接受 CPU／CUDA 12.8 两种预定义依赖方案，不接受任意命令、包名或下载地址。打包器将共用的 `runtime_engines.py` 和 stdin/stdout worker 放入 `ai-worker.zip`，兼容两个打包器；worker 通过独立解释器运行，避免冻结程序的扩展模块与 DLL 冲突。运行环境通过真实导入及设备运算后原子切换；安装失败不修改当前指针，失败日志保存在 `ai-runtime/last-install.log`。升级兼容组合时同步修改 `desktop_runtime.RECIPE`、固定包版本并执行独立环境与 EXE 冒烟验证。推理请求限时 10 分钟，进程退出或超时会释放 worker，下次请求重新启动。

局部基准：`node frontend/scripts/benchmark-generation-metadata.mjs`。测量范围与容量限制见[架构与性能](05-architecture-performance.md)。CodeGraph 本地索引须在目录大改后按使用者索引流程刷新，旧缓存不能作为当前源码依据。

## 5. 手工测试素材

`python tools/test-data/generate_test_media.py --output test_data/basic-demos` 生成基础图片、视频、音频；`python tools/test-data/generate_test_cases.py` 补齐尺寸、透明、文件名、ComfyUI 元信息及批量列表样本，保留已有文件。需要 Pillow、piexif 及 PATH 中的 ffmpeg。后端启动后运行 `python tools/test-data/seed_test_library.py`，通过本地 API 将 `test_data` 注册为“测试媒体”，补齐分组、颜色与标签关联，并生成 `test_data/test-library.json` 清单。重复导入不重复建标签，现有描述和标签样式保留；媒体文件不提交到 Git。
