# 03 · AI 接入

[文档首页](../README.md) · [媒体库](01-media-library.md) · [工作台](02-workbench.md)

## 1. 先选能力

| 能力 | 用途 | 运行位置 |
| --- | --- | --- |
| 图文检索 | 用文字或参考图找图片；默认 Qwen3-VL-Embedding-2B | 本地 |
| 图片重排 | 默认对向量检索前 50 项重新评分；默认 Qwen3-VL-Reranker-2B | 本地 |
| 图片内容处理 | 描述、参考提示词、已有标签建议 | 本地模型、GGUF、OpenRouter 或 Comfy |
| AI 创作 | 按主图、参考图、提示词及可选遮罩加工 | Comfy Router 或 Cloud 工作流 |

当前向量索引**只覆盖图片**。音视频描述可手工编辑，但没有音视频反推或内容索引；研究范围见 [音视频检索实验](../03-research/01-audio-video-search.md)。分数只用于本次查询排序，不是识别概率。

React 的“设置 → AI 接入”分为三个页签：“本地模型”管理模型格式、下载、路径和图片索引；“服务连接”配置 Comfy Cloud 与 OpenRouter 在线图片理解；“使用设置”配置图片理解模板与 Comfy 图片创作的默认模型、调用方式和并发数。顶部始终显示当前图片理解服务。“保存服务配置”保留当前服务，点击“用于图片理解”才启用对应服务；切换页签保留尚未保存的输入。模型的“已选中”表示模型配置，不代表图片理解已经启用。

媒体库机器人图标开启画面搜索，Enter 提交；筛选继续生效，原文字词暂不参与，切回后恢复。以图搜图默认用图片向量返回前 100 项，也可切“找重复图”使用感知哈希与颜色，适合压缩／缩放后的同一画面。

画面搜索与 AI 以图搜图共用图片向量索引，只编码图片内容，不混入人工描述或标签；在数据库中修改这些信息不需要重算画面向量。修改图片文件或更换检索模型后，需要更新索引。开启“AI 重排”时，默认重新评分前 50 张候选图，耗时会增加；候选数量与返回数量独立，即使只返回 20 张，也会从完整候选池重新排序。接口的 `rerank_limit` 可设为 1–200，重排模型不需要建立自己的索引。

## 2. 本地 Qwen

在“设置 → AI 接入”分别准备检索、重排、内容处理模型。标题旁的问号以表格列出支持的系列、规格与格式：三类模型均支持 Safetensors 2B／8B 和 GGUF 8B，内置 GGUF 下载提供 Q6_K。相同用途、版本与规格的 GGUF 可使用其他量化，例如 Q4_K_M、Q5_K_M、Q8_0，需匹配视觉文件和当前引擎，不能直接换成任意其他架构。官方模型：[Embedding](https://huggingface.co/Qwen/Qwen3-VL-Embedding-8B)、[Reranker](https://huggingface.co/Qwen/Qwen3-VL-Reranker-8B)、[Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct)。

### GGUF 检索、重排与图片理解（应用托管）

1. “设置 → 运行环境 → GGUF 引擎”安装 NVIDIA GPU（CUDA 12.4）或 CPU 版本。Windows x64 的源码与桌面版都支持；不需要另外安装 Python、PyTorch，也不需要手工启动服务。
2. “AI 接入”在图文检索／结果重排／图片理解卡片选择“GGUF · llama.cpp”，下载 8B 模型。模型路径同时作为下载目标，填写该模型的绝对目录，例如 `D:\Downloads\models\Qwen3-VL-8B-Instruct-GGUF-Q6_K`；留空使用托管目录。三种用途各放一个目录，主模型 Q6_K，配套 mmproj 保留 F16。下载分段续传、固定来源版本并校验 SHA-256。
3. 下载完成后自动选择模型。图文检索切换后点击“重建图片向量索引”；重排和图片理解无需索引。在“本地模型”的图片理解卡片点击“用于图片理解”，即可启用本地描述、提示词反推和标签建议，无需另填端口或启动服务。已有 GGUF 可填写目录或主模型文件路径：同目录应有一个主模型和一个匹配 mmproj，多个候选文件时需提供 `gguf-model.json`。

应用只启动一个本机推理进程，使用随机回环端口和临时凭据；切换模型时释放上一个进程，空闲两分钟及正常退出时停止。Windows 子进程受 Job Object 管理，后端异常退出也会清理。检索使用最后一个 token 的归一化向量；图片重排发送真实图片，并按 yes/no logits 的条件概率评分；Instruct 通过多模态聊天接口发送图片和指令，沿用系统／用户提示词的角色及输出长度限制。内置 Instruct Q6_K 来自 [Bartowski 的量化仓库](https://huggingface.co/bartowski/Qwen_Qwen3-VL-8B-Instruct-GGUF)，基于官方 8B Instruct，并配套该仓库的 F16 mmproj。

单个 GGUF 8B 主模型约 6–7 GB，视觉文件约 1.2 GB。资源需求依设备、输入和运行时而变，CPU 较慢；两个模型轮换加载会增加开启重排的搜索耗时。主模型／视觉文件／预处理版本变化都会使旧索引失效，避免混用向量空间。第三方量化不保证与完整精度数值完全一致，应以实际图库检索质量评估。

自动安装使用应用固定的 llama.cpp 兼容版本，不直接跟随上游每日更新。其他系统可自行安装兼容的 `llama-server`，或通过绝对路径环境变量 `OMNIGALLERY_LLAMA_SERVER` 指定；由应用接管进程，不填写服务 URL。模型清单记录量化来源、固定版本和文件哈希。

### Safetensors 与 PyTorch

“设置 → 运行环境”位于“AI 接入”左侧。Windows x64 的源码版与桌面版均在此提供“本地 AI 运行环境 · PyTorch”：

- 选择 NVIDIA GPU（CUDA 12.8）或 CPU，点击“安装必要依赖”。安装独立 Python 和应用指定的依赖组合，不需要系统 Python，也不修改系统环境。
- “检查环境”实际加载依赖并执行设备运算；缺失或损坏时点击“修复／重新安装”。应用携带的新兼容版本与已安装版本不一致时，按钮显示“更新运行环境”。
- 安装过程显示阶段进度和失败信息，可失败后重试。新环境通过检查才切换，失败保留原环境；已下载的模型和图片索引不会删除。
- 环境存放在应用数据目录的 `ai-runtime`，与模型目录分开。首次 GPU 安装需要数 GB 下载和磁盘空间；CUDA 检查失败时可更新显卡驱动或改用 CPU。
- 源码版未安装独立环境时使用启动后端的 Python；安装成功后自动改用应用管理的独立环境，不修改原虚拟环境。其他系统仍使用启动后端的 Python。网络连接使用“通用”里的代理设置。

源码部署也可自行管理启动后端的 Python，安装可选推理依赖（基础安装见[开发指南](../02-development/01-development.md)）：

```powershell
python -m pip install -r backend/requirements/qwen.txt
```

运行依赖属于启动后端的 Python 环境，WSL 与 Windows 的虚拟环境不能共用。Windows 使用 NVIDIA 显卡时，先按 [PyTorch 官方安装说明](https://pytorch.org/get-started/locally/)选择 CUDA 构建，再安装其余依赖。本机 RTX 3080 已验证的命令如下，均在仓库根目录执行：

```powershell
.\.venv\Scripts\python.exe -m pip install "torch>=2.6,<3" "torchvision>=0.24,<1" --index-url https://download.pytorch.org/whl/cu128
.\.venv\Scripts\python.exe -m pip install -r backend/requirements/qwen.txt
.\.venv\Scripts\python.exe -m pip check
```

安装后重启后端并重新进入 AI 接入页；模型缺依赖时可从模型卡片跳转到“运行环境”，不要重复下载完整模型。

1. 选择 2B／8B，点击“下载模型”，或填写后端可访问的已有完整模型目录。“已选中”只表示当前配置；“本地就绪”才表示模型文件和运行依赖均已满足。下载权重不会替当前 Python 环境安装推理依赖。
2. 确保目录包含配置、处理器和全部权重，下载失败可重试。
3. 检索模型点击“更新索引”后才能检索；同模型增量处理新增／变更图片，换模型须重建。重排与内容处理无需独立索引。

2B 完整权重约 4–5 GB，建议至少 8 GB 显存、16 GB 内存；8B 约 16–18 GB，建议至少 24 GB 显存、32 GB 内存。按需加载，实际峰值依输入而变；本机验证以 2B 为主，8B 需在目标设备实测。

模型不随安装包分发。桌面版下载到用户应用数据的 `models`，源码默认 `.local/models`，可用 `OMNIGALLERY_MODEL_DIR` 改位置。完整权重可通过 WSL 路径复用，例如 `/mnt/c/Users/<用户名>/Downloads/models/...`。独立路径变量为 `OMNIGALLERY_QWEN3_VL_EMBEDDING_PATH`、`OMNIGALLERY_QWEN3_VL_RERANKER_PATH`、`OMNIGALLERY_QWEN3_VL_INSTRUCT_PATH`，设置页保存的路径优先。

内容处理可选择加载时 8 位／4 位 NF4 量化：

```powershell
python -m pip install -r backend/requirements/qwen-quant.txt
```

图片理解的加载时量化仍下载完整 Safetensors，只减少运行内存／显存，不省下载空间；依 PyTorch、bitsandbytes 和设备而定。切换精度后下次生成重新加载。Safetensors 检索与重排保持原精度；GGUF 检索与重排使用独立的量化模型与索引口径，更换量化需重建图片索引。

## 3. 描述、参考提示词与标签

在图片描述页点击 AI 图标，确认本次提示词与长度后生成到编辑区，再修改或保存。描述支持 80／120／200 字目标；参考提示词可选中文或 English，也可自写指令。建议不会自动保存描述或改原始生成参数；标签从已有自定义标签中推荐，采用后才修改关联。

默认系统提示词在“设置 → AI 接入 → 使用设置 → 图片理解模板”保存，`{max_chars}` 替换目标长度，`{allowed_tags}` 替换已有标签。预览临时指令不覆盖全局默认；反推参考指令缓存于当前浏览器，保存的结果独立进入应用数据库。

## 4. 内容处理服务

### 本地模型

本地图片理解使用“AI 接入 → 本地模型”中选定的 Qwen3-VL-Instruct。GGUF 的引擎启动、模型加载和资源释放均由应用管理，无需填写服务地址或自行运行 llama-server。选择模型后点击“用于图片理解”启用。旧版自管 GGUF 服务配置读取时回退到应用托管的本地模型，旧地址与模型 ID 不再使用；下一次保存会清理这些废弃字段。普通对话模型不能替代专用 Embedding／Reranker。

### OpenRouter

填写支持图片输入的模型 ID 和 Key；默认 `qwen/qwen3-vl-8b-instruct`。可用 `OPENROUTER_API_KEY` 提供凭据。图片缩放到最多 1024×1024，转 JPEG 后按[图像接口](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding)发送；费用和能力由所选模型决定。Key 只存后端专用表，设置接口不回显。检索和重排仍在本地运行。

### Comfy Router／Cloud

保存 [Comfy API Key](https://platform.comfy.org/profile/api-keys)，或设置 `COMFY_API_KEY`，供内容处理与工作台共用。设置接口只显示是否配置；“验证连接”用 v2 只读查询验证认证，不保证额度、订阅、模型、节点权限或运行成功。

- **Router：** 直接调用已适配的视觉／图像模型，可实时查询账号支持项；查询失败显示预置项，不代表云端可用。可选项以界面列表为准。图片生成只发送提示词和输出设置；图像编辑发送主图与支持的参考图，不提供像素级遮罩映射。
- **Cloud：** 导入 ComfyUI **API 格式** JSON，按用途映射提示词、输出及图片输入。纯文字生图工作流不使用图片输入节点；内容处理把最多 1024×1024 JPEG 上传为 [v2 asset](https://docs.comfy.org/api-reference/v2/overview)，提交 job 后读取文本文件结果；仅在节点面板显示文字的旧节点不能作为输出。

节点和模型须在云端可用；导入前移除 JSON 凭据。图像创作及遮罩／参考图映射见 [工作流说明](02-workbench.md#4-comfy-工作流)。云端调用会上传实际输入并消耗对应额度，应用不会推算账号订阅状态。

## 5. 网络与数据

“设置 → 通用 → 网络连接”可填并验证 HTTP(S) 代理，用于模型下载和云服务；关闭后直连。媒体原文件、索引和本地推理无需上传；选用云内容处理或创作时才发送相关输入。

图片向量在数据库 `media_qwen_visual_embedding`，参考提示词在 `media_ai_note`；与原图生成信息分开。工作流、节点映射和服务配置在数据库，模型目录单独存放，备份规则见[运行数据](../02-development/01-development.md#3-运行数据与重置)。API 入口与开发说明见后端 `/docs`，统一使用 `/api` 认证和目录访问边界。
