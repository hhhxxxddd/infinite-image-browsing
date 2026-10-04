# AI 设置

[文档导航](../README.md) · [媒体库](01-media-library.md) · [工作台](02-workbench.md)

## 功能与依赖

| 功能                       | 依赖                                   |
| -------------------------- | -------------------------------------- |
| 图片画面描述／相似搜索     | 本地 Qwen Embedding，重排可用 Reranker |
| 图片描述、标签与提示词建议 | 本地 Qwen Instruct 或配置的在线服务    |
| 图片生成／编辑             | Comfy Router 或 Comfy Cloud            |

图片向量索引只覆盖图片。音视频可手工编辑描述，没有产品级内容索引、反推或自动转写；AI 音视频制作未接入。内容建议先进入草稿，采用后保存。

AI 设置分为三个页签：

- **服务连接**：保存统一 Comfy 密钥，分别检查 Router 模型接口与 Cloud 工作流状态。
- **模型管理**：在线模型按文字、图片、音频、视频和理解、生成、编辑、专项处理筛选；仅展示已适配模型。启用开关控制功能选择器的候选项，当前会话已选模型仍保留。查询可用状态读取服务端目录，不运行付费生成。下方管理本地 Qwen 模型。
- **功能配置**：内容理解及提示词、创作与编辑默认值、专项工具与工作流入口。图片生成与图片编辑分别保存默认模式和模型，只影响没有已保存选择的新会话；音视频当前标记后续接入。

下载、登记本地路径和选择功能提供方分别进行，成功下载不代表功能已经可用。运行依赖继续在独立的「运行环境」页管理。工具配置与工作台共用同一份内置参数／自定义工作流，不保存第二份副本。

## 本地模型与运行环境

Qwen 支持 Safetensors 与应用托管 GGUF。Embedding、Reranker、Instruct 分别负责检索、重排与内容处理，大小和格式以界面选项为准。权重独立下载，也可指定已有路径。

Safetensors 使用 PyTorch。Windows x64 可在应用内安装独立 CPU／CUDA 环境；源码未安装独立环境时使用后端 Python。手动安装参考 `backend/requirements/qwen.txt` 或 `qwen-quant.txt`，PyTorch 需匹配本机硬件，安装后执行 `python -m pip check`。

GGUF 使用应用管理的 llama.cpp 与配套视觉文件，不依赖 Python 推理扩展。安装下载、校验、自检后切换，失败保留原版本。主模型与视觉文件必须匹配。

本地推理共用串行通道，切换释放旧进程，空闲两分钟或退出时清理。索引运行时不能切换检索模型；模型、视觉文件或协议改变可能要求重建索引。

应用内下载固定写入应用数据目录的 `models`，源码默认 `.local/models`；选择已有模型仍可引用外部路径。下载用断点清单和完整哈希，不能以文件长度判断完成。

应用安装的 Python AI、GGUF、FFmpeg 分别位于同一根下的 `ai-runtime`、`gguf-runtime`、`media-runtime`，随统一目录迁移。缓存清理保留模型和运行环境；外部模型、系统 Python／FFmpeg 保持原位置。目录与备份见[存储与备份](04-storage.md)。

## 在线服务

服务连接独立保存 Comfy 密钥，功能配置决定实际提供方；网络代理仍在通用设置中管理。密钥不写进工作流或仓库，导入前移除凭据。

OpenRouter 独立接入已移除。升级时清除旧 OpenRouter 密钥与模型字段；旧提供方若为 OpenRouter，已有 Comfy 密钥则迁移到 Router，否则切回本地，保留提示词和工作流内容。Comfy Router 直接调用已适配模型，Comfy Cloud 使用 API v2 与用户工作流。图片结果须进入文件输出，文本处理须输出文本文件，节点预览不能替代结果。

最多映射 16 个有序结果节点，单次最多 64 图片、总大小 256 MB，模型支持数量仍由服务决定。连接检查不保证额度、订阅、节点或任务成功。系统只恢复同一任务，不自动创建新的付费任务。

AI 图片创作任务并发可设 1–15，默认 2。AI 图片生成／编辑使用后台队列：关闭页面仍继续处理，取得云端编号的任务在后端重启后自动继续查询。暂时断网自动重连，多次失败显示「跟踪中断」，可点「继续跟踪」获取原任务。完成结果保存在当前工作区，不要求页面一直打开。

「取消任务」先向云端请求取消，确认停止后才显示已取消；如果任务已经完成，仍保存结果。Cloud 工作流提交响应丢失且没有取得编号时，需要先在云端核对，系统不会补发新任务；旧版缺少恢复数据的任务也不会自动重提。Router 响应丢失时在安全时限内复用原幂等键，超时停止补发；云端结果有保留期限，应及时恢复连接。内置单图层工具的重启与取消规则不同，见[图片编辑](05-image-editor.md#结果连续编辑与任务边界)。

实际输入会上传到所选服务并消耗额度。API 部署模式暂不接入，规划见[工作台实现](../02-development/07-workbench.md#comfy-接入边界与后续规划)。

## 当前开放模型

下表为当前代码内置的已适配候选，不代表每个账户均可调用；可用状态以设置中的查询结果和服务权限为准。音视频暂未接入。

| 用途／系列 | 当前版本 |
| --- | --- |
| Nano Banana | 2（Gemini 3.1 Flash Image）、2 Lite（Gemini 3.1 Flash-Lite Image）、Pro（Gemini 3 Pro Image） |
| FLUX | 3 Image |
| Seedream | 5.0（260128）、5.0 Pro（260628）、5.0 Flash（260915） |
| GPT Image | 2.5 Flare、2.5 Sunburst |
| Gemini 内容理解 | 3.8 Flash、3.1 Flash Lite、3.1 Pro Preview |
| GPT 内容理解 | 6 Sol、6 Luna、6 Astra |

图片模型的尺寸、比例和参考图数量随模型切换：FLUX 3 最多 9 张额外参考图；Seedream 5.0 最多 13 张，Pro／Flash 最多 9 张。Seedream 5.0 提供 2K／3K，Pro 提供 1K／2K，Flash 提供 1K／1.5K／2K；GPT Image 当前提供已适配的原生尺寸（自动或方形／横图／竖图）。这些生成尺寸遵循各家的接口口径，与内置高清化的最短边尺寸不同。

消除、抠图、高清化仍使用内置 Qwen2.1、SAM3 和 SeedVR2 工作流；不接入 Router 的专项接口。高清化提供原尺寸及按最短边计算的 2K／4K／8K，见[图片编辑](05-image-editor.md#高清化)。Claude 不在内容理解候选中。

协议依据：[FLUX 3](https://docs.comfy.org/development/comfy-router/models/black-forest-labs/flux-3-image/code)、[Seedream 5.0 Pro](https://docs.comfy.org/development/comfy-router/models/byteplus/seedream-5-0-pro-260628/code)、[GPT Image 2.5](https://docs.comfy.org/development/comfy-router/models/openai/gpt-image-2-5-flare/code)、[GPT 6](https://docs.comfy.org/development/comfy-router/models/openai/gpt-6-sol/code)。

## 验证与数据

先配置环境和模型，再建立图片索引，用少量真实查询核对结果与过期状态。检索分数只在本次查询中排序。

本地处理不上传媒体。在线内容处理和云制作发送实际选中的输入，纯文字生成不上传未用参考图。

自动测试校验协议、权限、路径、下载、进程及状态，不能替代目标设备的模型质量、显存或真实云服务验证。
