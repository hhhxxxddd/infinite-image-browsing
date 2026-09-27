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

当前 `wsl-devctl` 的可选 `port` 字段存在整数类型校验问题，项目暂未声明该字段。`status`／`healthy` 仅用于确认进程状态；HTTP 可用性需直接访问 `http://localhost:3002` 和 `http://127.0.0.1:7877/openapi.json` 核验。

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

项目数据包含工作区产物、编辑文档和快照，属于持久数据，不能当缓存清理。目录迁移先复制校验再切换，旧目录保留备份；新旧托管区均排除扫描。完整配置示例见 [`.env.example`](../../.env.example)。

偏好在 localStorage 缓存并防抖写数据库；工作区图层草稿只在浏览器保存。键使用 `omnigallery:*`，浏览器与桌面 WebView 不共享数据。桌面标识为 `app.omnigallery.desktop`；Spike 不读取旧应用数据库或草稿。

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

`frontend/dist`、sidecar 与运行数据不提交。Windows 后端打包工具是 `tools/packaging/build_backend.py`，支持 Nuitka、PyInstaller 和 `--dry-run`；`--with-models` 收集推理运行库，不包含模型权重；`--with-search-index` 显式收集 ANN 扩展，默认 core 包不包含。Tauri Windows 构建及打包后启动检查见[发布工作流](../../.github/workflows/desktop-release.yml)。维护工具在 `tools/maintenance`，演示素材生成器在 `tools/test-data`。

局部基准：`node frontend/scripts/benchmark-generation-metadata.mjs`。测量范围与容量限制见[架构与性能](05-architecture-performance.md)。CodeGraph 本地索引须在目录大改后按使用者索引流程刷新，旧缓存不能作为当前源码依据。
