# 开发与代码结构

## 运行入口

- `app.py` 创建独立 FastAPI 服务；`scripts/iib/api.py` 挂载媒体、文件、数据库和 AI 接口。默认 API 前缀仍为 `/infinite_image_browsing`，前端代理和既有集成都依赖它。
- `vue/src/main.ts` 加载前端；`vue/src/page/SplitViewTab/SplitViewTab.vue` 管理侧栏与当前视图。媒体库主体在同目录的 `MediaLibrary.vue`，文件夹浏览在 `vue/src/page/fileTransfer/`。
- `vue/src-tauri/src/main.rs` 启动 Windows 桌面版及 Python sidecar；`vue/src-tauri/tauri.conf.json` 配置窗口、安装包和应用标识。

## 数据与功能模块

| 位置 | 职责 |
| --- | --- |
| `scripts/iib/db/` | SQLite 表结构、索引、扫描结果与文字搜索 |
| `scripts/iib/parsers/` | 图片元信息解析，目前主要支持 ComfyUI |
| `scripts/iib/similarity.py`、`scripts/iib/qwen3_vl_search.py` | 近重复查找与本地图文向量检索 |
| `scripts/iib/image_ai.py`、`scripts/iib/qwen3_vl_instruct.py` | 图片描述建议、参考提示词与标签建议 |
| `scripts/iib/qwen_model_manager.py` | 本地模型下载安装与选择 |
| `vue/src/page/globalSetting/` | 设置页，包括扫描、标签与 AI 接入 |

媒体原文件不会因建立索引而移动。用户编辑的标签、描述、生成信息和向量索引存于数据库。桌面版沿用 `com.zanllp.iib` 应用标识与数据目录，避免旧安装丢失数据库。内部 `IIB_*` 环境变量、API 前缀和部分包名同样仍在使用；改名需要同时设计配置、接口和数据迁移。

## 已移除与保留的旧功能

独立的“搜索媒体”、标签搜索、模糊搜索和主题搜索结果页已从前端移除。现用文字与画面搜索均在媒体库中，搜索帮助也位于媒体库搜索框。旧的页面深链接会被视为无效视图；仍有效的文件夹、图片对比、导出及设置视图继续使用。

后端的 `topic_cluster.py`、`organize_files.py` 和相关表仍由已挂载的整理接口使用；`match_images_by_tags` 仍是旧客户端可调用的接口。它们不代表主界面仍提供旧搜索页面。移除这些接口前，应先确认外部调用和已有数据库，再安排迁移。

## 开发与验证

根目录的 `requirements.txt` 是基础后端依赖；本地 Qwen 模型另需 `requirements-qwen3-vl.txt`。前端使用 Node.js 24，在 `vue` 目录运行 `npm ci`、`npm run dev`。独立服务使用根目录 `python -m uvicorn app:create_app --factory --reload --port 7877`，Vite 页面位于 `http://localhost:3002`。`npm run build` 更新由独立服务读取的 `vue/dist`，桌面打包流程也会执行构建。

提交前可运行 `npm run type-check`、`npm run lint`、`npm test` 与 `npm run build`；后端测试使用 `python -m unittest discover -s scripts/iib -p "test_*.py"`。模型推理测试可能需要已下载的权重或单独的测试环境。Windows 构建步骤见 [Tauri 工作流](../.github/workflows/tauri_app_build.yml)，使用方式见 [媒体库说明](media-library.md) 与 [AI 接入说明](qwen3-vl-search.md)。
