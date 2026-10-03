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

界面需核对浅深主题、宽窄窗口、键盘与空状态。真实云任务、大模型与安装包单独验证，不能由纯模型测试替代。

## 数据与重置

| 配置                           | 默认位置／用途                                                         |
| ------------------------------ | ---------------------------------------------------------------------- |
| `OMNIGALLERY_DATA_DIR`         | 源码 `.local`，桌面为用户应用数据目录                                  |
| `OMNIGALLERY_DB_PATH`          | 数据根 `db/omnigallery.db`                                             |
| `OMNIGALLERY_CACHE_DIR`        | 数据根 `cache`，桌面为系统缓存目录                                     |
| `OMNIGALLERY_PROJECT_DATA_DIR` | 源码数据根 `project-data`；桌面 exe 旁 `.local/project-data`，设置可改 |
| `OMNIGALLERY_MODEL_DIR`        | 数据根 `models`                                                        |
| `OMNIGALLERY_STATIC_DIR`       | 构建后的 `frontend/dist`                                               |

备份包含数据库、项目数据与原媒体。迁移项目目录先复制校验再切换，保留旧目录；托管目录排除扫描。

`python tools/maintenance/reset_development_data.py` 默认预览。停止服务及桌面后加 `--yes` 才清理受控数据；不删除原媒体、模型、凭据、自定义项目目录或 Git，并拒绝外部链接／目录联接。

## 桌面打包

前端目录执行 `npm run tauri -- dev` 进入桌面开发。发布依赖与工具链按工作流安装，先构建前端和 Python sidecar，再构建安装包：

```powershell
npm --prefix frontend run build
python tools/packaging/build_backend.py pyinstaller --with-models --with-search-index
npm --prefix frontend run tauri-build
```

用 `tools/packaging/smoke_backend.py` 检查实际 sidecar。模型权重不进入安装包。发布依赖与工具链按 `.github/workflows/desktop-release.yml` 安装；流程支持 Nuitka／PyInstaller、锁定依赖的 Tauri 与 NSIS，并创建草稿发布。
