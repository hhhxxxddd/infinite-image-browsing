# 开发指南

[文档导航](../README.md) · [代码规范](02-coding-standards.md) · [架构与性能](05-architecture-performance.md)

## 环境与启动

开发使用 Python 3.14.8、Node.js 24；桌面另需 Rust stable、Windows MSVC C++ 工具和 WebView2。依赖版本以 `pyproject.toml`、前端锁文件与 `frontend/src-tauri/Cargo.lock` 为准。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e . -r backend/requirements/dev.txt
npm --prefix frontend ci
```

两个终端分别执行 `python tools/dev/run_backend.py` 和 `npm --prefix frontend run dev`。后端监听 127.0.0.1:7877，前端监听 3002 并代理 `/api`；watchfiles 管理后端热更新。

独立服务先 `npm --prefix frontend run build`，再 `python -m omnigallery --port 7877`。默认仅监听回环，主机、权限和路径见 [环境示例](../../.env.example)。Linux 激活使用 `source .venv/bin/activate`。

音视频制作需 FFmpeg 与 ffprobe。Qwen、量化和 HNSW 按功能安装 `backend/requirements/` 对应依赖；Windows 可用应用托管 AI 环境，见 [AI 接入](../01-user-guide/03-ai-services.md)。

## 服务访问

网页开发通过 Vite 同源代理访问后端，不需要 `--allow-cors`。独立服务可用 `OMNIGALLERY_SECRET_KEY` 配置访问密钥；目录白名单和写权限分别由访问控制配置约束。

Tauri 启动独立回环端口的 sidecar，并生成仅本次启动使用的访问令牌，前端自动附带认证，用户无需输入。同一应用数据目录由单个后端持锁，第二个后端不能同时启动。桌面来源允许 `tauri://localhost`、`http://tauri.localhost`、`https://tauri.localhost`，开发来源为 `http://localhost:3002` 和 `http://127.0.0.1:3002`。

显式启用 `--allow-cors` 时，其他来源需以逗号分隔写入 `OMNIGALLERY_CORS_ORIGINS`，不允许 `*` 或 `null`。认证与原媒体 URL 约定见[架构与性能](05-architecture-performance.md#访问与文件完整性)，同源嵌入见[嵌入集成](04-embedding.md)。

## 目录

```text
frontend/react/              React 页面、编辑器、主题与界面公共能力
frontend/src/features/       领域模型、仓储和纯计算
frontend/src/shared/         纯工具、类型与字典
frontend/src-tauri/          桌面窗口与 Python sidecar
frontend/scripts/            前端基准
backend/src/omnigallery/     可安装后端包
backend/tests/               unit、integration、support
backend/requirements/        开发和可选依赖
tools/                      检查、开发、维护、素材与打包
.local/                     忽略提交的运行与构建数据
```

前端 `*.test.mjs` 跟随模型，使用 Node 内置运行器。领域模型不依赖 React，页面与编辑器按需加载。

## 检查

```powershell
python tools/check.py
python tools/check.py backend
npm --prefix frontend run check
python -m pip check
```

前端包含 Prettier、ESLint、TypeScript、全部单测与 Vite 构建；后端包含 Ruff、格式、后端及工具单测。CI 在 Linux 检查两端，Windows 发布另做打包和 sidecar 启动验证。

统一检查不编译 Tauri 原生宿主。安装 Rust 和桌面构建依赖后，可用 `cargo check --locked --manifest-path frontend/src-tauri/Cargo.toml` 检查 Rust，再按下文打包验证启动与媒体访问。

界面需核对浅深主题、宽窄窗口、键盘与空状态。真实云任务、大模型与安装包单独验证，不能由纯模型测试替代。

## 数据与重置

| 配置                     | 默认位置／用途                                                          |
| ------------------------ | ----------------------------------------------------------------------- |
| `OMNIGALLERY_DATA_DIR`   | 默认数据根及启动定位位置；源码 `.local`，桌面由宿主提供用户应用数据目录 |
| 默认根的 `storage.json`  | 记录设置页选择的当前根与待迁移位置，所有受管子目录从当前根派生          |
| `OMNIGALLERY_STATIC_DIR` | 构建后的 `frontend/dist`，不属于业务数据                                |

数据库、项目数据、归档、模板预留区、缓存、模型和托管运行环境均在一个根下。旧版分项环境变量只用于首次导入；不要继续把 DB／CACHE／PROJECT_DATA／MODEL 当作独立配置。生产入口必须使用 `omnigallery.server:create_app`，在导入路径相关服务前完成迁移。具体目录、兼容和恢复见[应用存储实现](09-storage.md)与[存储指南](../01-user-guide/04-storage.md)。

`python tools/maintenance/reset_development_data.py` 默认预览。停止服务及桌面后加 `--yes` 才清理仓库 `.local` 下的 `db`、`cache`、`logs`、`project-data`，会删除其中的设置、作品和服务凭据。原媒体、模型、运行环境、模板、归档、`.env` 和 Git 保留；已有目录迁移或待迁移时拒绝重置，并拒绝符号链接／目录联接。日常释放空间请使用设置页“清理缓存”。

## 桌面打包

先构建前端和 Python sidecar，再构建安装包：

```powershell
npm --prefix frontend run build
python tools/packaging/build_backend.py pyinstaller --with-models --with-search-index
npm --prefix frontend run tauri-build
```

sidecar 就绪后，可在前端目录执行 `npm run tauri -- dev` 进入桌面开发。用 `tools/packaging/smoke_backend.py` 检查实际 sidecar；桌面还需核对启动、图片缩略图、音视频分段读取和退出清理。

模型权重不进入安装包。发布依赖与工具链按 [desktop-release.yml](../../.github/workflows/desktop-release.yml) 安装；流程支持 Nuitka／PyInstaller、锁定依赖的 Tauri 与 NSIS，并创建草稿发布。
