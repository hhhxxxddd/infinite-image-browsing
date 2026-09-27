# 03 · AI 接入

[文档首页](../README.md) · [媒体库](01-media-library.md) · [工作台](02-workbench.md)

## 1. 先选能力

| 能力 | 用途 | 运行位置 |
| --- | --- | --- |
| 图文检索 | 用文字或参考图找图片；默认 Qwen3-VL-Embedding-2B | 本地 |
| 图片重排 | 对向量检索前 20 项重新评分；默认 Qwen3-VL-Reranker-2B | 本地 |
| 图片内容处理 | 描述、参考提示词、已有标签建议 | 本地模型、GGUF、OpenRouter 或 Comfy |
| AI 创作 | 按主图、参考图、提示词及可选遮罩加工 | Comfy Router 或 Cloud 工作流 |

当前向量索引**只覆盖图片**。音视频描述可手工编辑，但没有音视频反推或内容索引；研究范围见 [音视频检索实验](../03-research/01-audio-video-search.md)。分数只用于本次查询排序，不是识别概率。

媒体库机器人图标开启画面搜索，Enter 提交；筛选继续生效，原文字词暂不参与，切回后恢复。以图搜图默认用图片向量返回前 100 项，也可切“找重复图”使用感知哈希与颜色，适合压缩／缩放后的同一画面。

## 2. 本地 Qwen

在“设置 → AI 接入”分别准备检索、重排、内容处理模型。支持同系列 2B 单文件及 8B 分片完整权重，不能直接换成其他架构。官方模型：[Embedding 2B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B)、[Reranker 2B](https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B)、[Instruct 2B](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct)。

源码部署先安装可选推理依赖（基础安装见[开发指南](../02-development/01-development.md)）：

```powershell
python -m pip install -r backend/requirements/qwen.txt
```

1. 选择 2B／8B，点击“下载并安装”，或填写后端可访问的已有完整模型目录。
2. 确保目录包含配置、处理器和全部权重，下载失败可重试。
3. 检索模型点击“更新索引”后才能检索；同模型增量处理新增／变更图片，换模型须重建。重排与内容处理无需独立索引。

2B 完整权重约 4–5 GB，建议至少 8 GB 显存、16 GB 内存；8B 约 16–18 GB，建议至少 24 GB 显存、32 GB 内存。按需加载，实际峰值依输入而变；本机验证以 2B 为主，8B 需在目标设备实测。

模型不随安装包分发。桌面版下载到用户应用数据的 `models`，源码默认 `.local/models`，可用 `OMNIGALLERY_MODEL_DIR` 改位置。完整权重可通过 WSL 路径复用，例如 `/mnt/c/Users/<用户名>/Downloads/models/...`。独立路径变量为 `OMNIGALLERY_QWEN3_VL_EMBEDDING_PATH`、`OMNIGALLERY_QWEN3_VL_RERANKER_PATH`、`OMNIGALLERY_QWEN3_VL_INSTRUCT_PATH`，设置页保存的路径优先。

内容处理可选择加载时 8 位／4 位 NF4 量化：

```powershell
python -m pip install -r backend/requirements/qwen-quant.txt
```

量化仍下载完整 Safetensors，只减少运行内存／显存，不省下载空间；依 PyTorch、bitsandbytes 和设备而定。切换精度后下次生成重新加载。检索与重排保持原精度，避免改变向量空间。

## 3. 描述、参考提示词与标签

在图片描述页点击 AI 图标，确认本次提示词与长度后生成到编辑区，再修改或保存。描述支持 80／120／200 字目标；参考提示词可选中文或 English，也可自写指令。建议不会自动保存描述或改原始生成参数；标签从已有自定义标签中推荐，采用后才修改关联。

默认系统提示词在“设置 → AI 接入”保存，`{max_chars}` 替换目标长度，`{allowed_tags}` 替换已有标签。预览临时指令不覆盖全局默认；反推参考指令缓存于当前浏览器，保存的结果独立进入应用数据库。

## 4. 内容处理服务

### 本机 GGUF

使用支持多模态的 [llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)，例如：

```bash
llama-server -hf Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M --host 127.0.0.1 --port 8080
```

设置中选择“本机 GGUF 服务”，填 `http://127.0.0.1:8080/v1`，保存后测试；模型 ID 可留空。使用本地 GGUF 文件时须同时加载匹配 mmproj，只有文字服务不能分析图片。后端只接受回环地址，图片仅发给本机；普通 GGUF 对话服务不能替代检索／重排链路。

### OpenRouter

填写支持图片输入的模型 ID 和 Key；默认 `qwen/qwen3-vl-8b-instruct`。可用 `OPENROUTER_API_KEY` 提供凭据。图片缩放到最多 1024×1024，转 JPEG 后按[图像接口](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding)发送；费用和能力由所选模型决定。Key 只存后端专用表，设置接口不回显。检索和重排仍在本地运行。

### Comfy Router／Cloud

保存 [Comfy API Key](https://platform.comfy.org/profile/api-keys)，或设置 `COMFY_API_KEY`，供内容处理与工作台共用。设置接口只显示是否配置；“验证连接”用 v2 只读查询验证认证，不保证额度、订阅、模型、节点权限或运行成功。

- **Router：** 直接调用已适配的视觉／图像模型，可实时查询账号支持项；查询失败显示预置项，不代表云端可用。可选项以界面列表为准。Router 图像编辑不提供像素级遮罩映射。
- **Cloud：** 导入 ComfyUI **API 格式** JSON，映射图片、提示词及输出。内容处理把最多 1024×1024 JPEG 上传为 [v2 asset](https://docs.comfy.org/api-reference/v2/overview)，提交 job 后读取文本文件结果；仅在节点面板显示文字的旧节点不能作为输出。

节点和模型须在云端可用；导入前移除 JSON 凭据。图像创作及遮罩／参考图映射见 [工作流说明](02-workbench.md#4-comfy-工作流)。云端调用会上传实际输入并消耗对应额度，应用不会推算账号订阅状态。

## 5. 网络与数据

“设置 → AI 接入 → 网络代理”可填并验证 HTTP(S) 代理，用于模型下载和云服务；关闭后直连。媒体原文件、索引和本地推理无需上传；选用云内容处理或创作时才发送相关输入。

图片向量在数据库 `media_qwen_visual_embedding`，参考提示词在 `media_ai_note`；与原图生成信息分开。工作流、节点映射和服务配置在数据库，模型目录单独存放，备份规则见[运行数据](../02-development/01-development.md#3-运行数据与重置)。API 入口与开发说明见后端 `/docs`，统一使用 `/api` 认证和目录访问边界。
