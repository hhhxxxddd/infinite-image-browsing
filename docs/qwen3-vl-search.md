# AI 接入：图文检索、图片重排与内容处理

当前向量索引只覆盖图片。视频画面与音频内容检索尚未接入，后续验证方案见[音视频语义索引 Spike](audio-video-semantic-index-spike.md)。

设置页按能力展示三种模型：**图文检索模型**把图片与文字编码成同一检索空间，默认 [Qwen3-VL-Embedding-2B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B)；**图片重排模型**对检索候选图逐张评分，默认 [Qwen3-VL-Reranker-2B](https://huggingface.co/Qwen/Qwen3-VL-Reranker-2B)；**图片内容处理模型**生成描述建议、反推提示词和标签建议，默认本地 [Qwen3-VL-2B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct)。模型仓库需要完整下载，包括配置、处理器和权重文件。当前本地加载器适配 Qwen3-VL 同系列，并识别 2B 单文件权重及 8B 分片权重；换其他架构仍需实现对应适配器。

在媒体库搜索框点击机器人图标，搜索框会发出蓝色光效；直接输入画面描述并按 Enter。搜索框右侧的问号会随模式切换说明内容。已应用的筛选条件继续生效，普通文字搜索词在此模式下不参与查询，切回文字模式后会恢复。搜索框下方可开启「AI 重排」、查看已索引数量和更新索引。开启重排后，先按向量相似度取前 20 张，再逐张评分排序。结果卡片显示当前排序分数；重排时同时显示原始向量分数。分数用于同一次查询内部排序，不是识别概率。

以图搜图默认使用 Embedding 模型将参考图与已索引的图片直接比较，返回相似度最高的前 100 张，不设固定最低分。筛选面板可以调整最低分，也可以切换“近重复图片”方式，使用感知哈希和颜色匹配寻找缩放、压缩后的同一画面。前者适合内容或构图相近的图片；后者适合近乎同图的变体。粘贴图片和选择库中图片均支持这两种方式。

在图片预览中，内容处理模型按需生成 80、120 或 200 字以内的描述建议；采用后可编辑再保存。反推参考提示词时，可以临时切换中文或 English，也可以直接修改要求；模型也可从已有自定义标签中推荐标签。三种任务的默认系统提示词保存在“设置 → AI 接入”；`{max_chars}` 会替换为当前长度，`{allowed_tags}` 会替换为已有标签列表。预览中临时修改的反推指令只保存在当前浏览器，反推结果可单独保存。生成不会直接覆盖描述、原始生成参数或标签。

图片内容处理还可切换到 **OpenRouter API**：填写支持图片输入的模型 ID（默认 `qwen/qwen3-vl-8b-instruct`）及 API Key。生成时后端把图片缩放到不超过 1024×1024、编码成 JPEG 并通过 OpenRouter 的 [图像输入接口](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding) 发给所选模型。API Key 只保存在后端专用表，不会通过设置接口回显；也可用后端环境变量 `OPENROUTER_API_KEY` 提供。该方式无需本地模型显存，费用及能力取决于所选模型。图文检索与重排仍在本地运行。

**Comfy Router / Cloud** 内容处理有两种调用方式。默认通过 [Comfy Router](https://docs.comfy.org/development/comfy-router/quickstart) 直接调用 Gemini 3.1 Flash Lite、3.7 Flash、3.8 Flash 或 3.1 Pro 视觉模型；保存 API Key 后可从 Router 实时查询当前账号可用的受支持模型。查询失败时仍可查看预置选项，但无法确认云端可用性。也可以导入 ComfyUI“保存（API 格式）”导出的 JSON 工作流，分别映射图片输入节点及字段、提示词输入节点及字段、文本输出节点。运行时上传缩放到不超过 1024×1024 的 JPEG 图片，把当前任务的提示词注入工作流，再提交任务并等待输出节点的文本或文本文件。工作流使用 [Comfy Cloud 兼容 API](https://docs.comfy.org/development/cloud/api-reference)；节点和模型须在用户的云端环境可用，普通 ComfyUI 界面格式 JSON 不适用。当前使用的兼容接口标记为实验性，后续可能迁移到 Cloud API v2。

在“设置 → AI 接入”填入 [Comfy API Key](https://platform.comfy.org/profile/api-keys) 并保存；也可使用后端环境变量 `COMFY_API_KEY`。Key 存在后端专用表，设置接口只返回配置状态，不回显内容。“验证已保存的 Key”只验证认证是否成功，实际模型权限、工作流节点与额度在生成时检查。云端调用会消耗额度；内容处理方式用于描述、提示词反推和标签建议，检索与重排仍在本地。独立的 **AI 创作接入** 可选 Comfy Router 图像模型或图片制作中的自定义 Comfy Cloud 工作流，复用同一个 Key。当前直接图像编辑支持 Nano Banana 2 Lite、Nano Banana 2、Nano Banana Pro 和 Gemini 2.5 Flash Image；Router 不提供像素级遮罩映射，需要精确遮罩时使用 JSON 工作流。工作流 JSON 保存在本机存储中，导入前应移除工作流中自带的凭证或敏感内容。

内容处理的本地 Transformers 模型可在设置中选 **8 位**或 **4 位 NF4** 加载。先安装 `python -m pip install -r requirements-qwen3-vl-quant.txt`，再选精度并应用；模型仍下载完整 Safetensors 权重，加载时才量化，因此节省运行内存/显存而不节省下载空间。推理后端是否支持所选精度取决于本机 PyTorch、bitsandbytes 和设备驱动；切换精度会释放已加载模型，下次生成时重新加载。图文检索与重排继续使用原始精度，避免更换向量空间或改动已有索引。

内容处理也可选 **本机 GGUF 服务**。安装支持多模态的 [llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md)，例如启动官方 [Qwen3-VL-2B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF) 的 Q4_K_M 版本：

```bash
llama-server -hf Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M --host 127.0.0.1 --port 8080
```

在“设置 → AI 接入”选择“本机 GGUF 服务”，填写 `http://127.0.0.1:8080/v1`，保存后测试连接。也可使用已经下载的 GGUF，但启动时必须同时加载匹配的视觉投影文件（mmproj）；否则文字服务能连接，也无法正确分析图片。模型 ID 可留空以使用服务当前模型。后端只接受回环地址，图片仅发送到本机服务。GGUF 当前用于描述、反推提示词和标签建议；检索与重排需要专用的多模态向量和评分链路，不能直接以普通 GGUF 对话模型替换。

资源估算：2B 模型完整权重约 4–5 GB，建议至少 8 GB 显存及 16 GB 内存；8B 完整权重约 16–18 GB，建议至少 24 GB 显存及 32 GB 内存。三个本地模型按需加载，实际峰值随输入图片和推理配置变化。8B 仓库参见 [Embedding](https://huggingface.co/Qwen/Qwen3-VL-Embedding-8B/tree/main)、[Reranker](https://huggingface.co/Qwen/Qwen3-VL-Reranker-8B/tree/main)、[Instruct](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct/tree/main)。目前已验证本机 2B 运行；8B 已加入完整分片识别，仍需在下载权重后实测推理及资源占用。

先在“设置 → AI 接入”选 2B 或 8B，未安装时点击“下载并安装”。模型下载所需的 Hugging Face Hub 与进度组件属于基础后端依赖；本地推理另需安装 `requirements-qwen3-vl.txt`。应用从官方 Hugging Face 模型仓库下载完整文件到持久模型目录，安装完成后自动启用；下载失败可重试。已有模型仍可通过“使用已有模型目录”填写后端可访问的完整路径。给图文检索模型建立索引后即可使用语义搜索；以图搜图的源图栏会显示已索引张数。更换检索模型后要重新建索引，后续同模型增量更新只处理新增或变更的图片。重排与内容处理不需要单独索引。向量保存在 `image_qwen_visual_embedding`；保存的反推提示词保存在 `image_ai_note`，与图片原始元信息分开。

Windows EXE 使用 Tauri 启动内置 Python 服务，模型下载到 Windows 用户的应用数据目录 `models` 子目录，不写入 EXE 或安装目录，应用更新后仍可使用。打包流程安装 Qwen 推理与 Hugging Face 下载依赖，再收集进后端 sidecar；模型权重按需下载，不放进安装包。其他部署方式默认保存在 `~/.cache/infinite-image-browsing/models`，可设置 `IIB_MODEL_DIR` 改变应用下载目录。

WSL 可直接读取 Windows 下载目录中的完整模型文件，避免重复复制权重。以下是路径格式示例，实际用户名和目录由本机决定：

```text
/mnt/c/Users/<用户名>/Downloads/qwen3-vl-models/Qwen3-VL-Embedding-2B
/mnt/c/Users/<用户名>/Downloads/qwen3-vl-models/Qwen3-VL-Reranker-2B
/mnt/c/Users/<用户名>/Downloads/qwen3-vl-models/Qwen3-VL-2B-Instruct
```

其他部署方式可用设置页或环境变量 `IIB_QWEN3_VL_EMBEDDING_PATH`、`IIB_QWEN3_VL_RERANKER_PATH`、`IIB_QWEN3_VL_INSTRUCT_PATH` 指定后端可访问的绝对路径；设置页保存的路径优先。后端 Python 依赖：

```bash
python -m pip install -r requirements-qwen3-vl.txt
```

接口：`GET /infinite_image_browsing/db/qwen-models`、`POST /infinite_image_browsing/db/qwen-models/install`、`POST /infinite_image_browsing/db/qwen-models/select` 用于查看、下载和启用 2B/8B；`GET /infinite_image_browsing/db/qwen3-vl/{kind}/status`、`PUT /infinite_image_browsing/db/qwen3-vl/{kind}/config`（`kind` 为 `embedding`、`reranker` 或 `instruct`）、`POST /infinite_image_browsing/db/qwen3-vl/embedding/index`、`POST /infinite_image_browsing/db/qwen3-vl/search` 用于本地检索。内容处理接口是 `GET/PUT /infinite_image_browsing/db/image-ai/config`、`POST /infinite_image_browsing/db/image-ai/generate`；独立的创作配置使用 `GET/PUT /infinite_image_browsing/db/image-ai/creation/config`，直接图像编辑使用 `POST /infinite_image_browsing/db/image-ai/studio-router-edit`，模型列表使用 `GET /infinite_image_browsing/db/image-ai/comfy/models`。`GET /infinite_image_browsing/db/image-ai/comfy/status` 验证已保存的 Comfy API Key。以图搜图的 `POST /infinite_image_browsing/db/similar_images` 可选 `method: "qwen" | "hash"`；旧客户端省略时沿用 `hash`。参考提示词使用 `/infinite_image_browsing/db/image_ai_note` 读写。接口沿用服务认证和目录访问控制。
