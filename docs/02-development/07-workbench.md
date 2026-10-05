# 工作台实现

[文档导航](../README.md) · [使用指南](../01-user-guide/02-workbench.md) · [架构与性能](05-architecture-performance.md)

WorkbenchPage 组合工作区、作品、制作文件、素材及成果，EditorHub 根据工具和 draftId 进入编辑器。模型与仓储在 `frontend/src/features/workspaces/model`。

## 数据契约

| 数据                     | 来源／保存                                      |
| ------------------------ | ----------------------------------------------- |
| 工作区与共享引用         | workbench_projects 设置，workspaceModel 校验    |
| 作品、制作文件、编辑文档 | react/shared/workspaceState.ts 版本事务与纯仓储 |
| 产物／快照               | /api/workspace_artifacts、/api/workspace_inputs |
| 媒体选择                 | 搜索／筛选接口，保存路径引用                    |
| 成果                     | 作品选定产物，媒体库同步另建副本                |

工作区偏好用 localStorage，作品用标签页 sessionStorage；返回工作区或切换工作区清除作品选择。制作数据通过共享订阅与事务同步。

服务端状态与产物分别存入同一应用数据根的 `db` 和 `project-data`，随根迁移调整受管引用。外部素材仍是原路径引用；套用模板的配图使用独立持久副本。备份与共享模板规则见[应用存储实现](09-storage.md)。

颜色由 workspaceColor 校验，未设按 ID 分配。创建、修改与使用时间分开；更新排序包含制作文件日期，打开或媒体新建制作更新最近使用，不改创建日期。

## 交互与加载

工作区／作品标题与返回共用布局。三种卡片区分层级，引用／产物渐进加载，切换取消旧请求。两级排序独立保存，无效日期置后。

MaterialBar 共用范围、类型、来源、预览和动作，范围为空也保留底座。滚轮在 DOM 中跟随与回弹，卸载释放监听、动画和观察器；浏览网格虚拟化，选择避免重绘无关卡片。

WorkbenchSkyBackdrop 独立轮换，隐藏、离开或减少动态效果时暂停，不重绘工作区卡片，见 [资源说明](../../frontend/react/features/workbench/assets/README.md)。

媒体制作使用 CreateMediaDraftDialog／mediaDraftModel，支持已有与新建工作区、作品。提交重读权限与目标，稳定 ID 可重试；文档、索引和引用状态事务提交，失败回滚，成功才进入编辑器。

## 保存与产物

图片会话复用持久仓储和串行保存队列，版本及渲染规则见[图片编辑实现](06-image-editor.md)。音视频保存各自版本时间线，AI 保存用途、配置与输入关联。切换编辑上下文等待保存，失败保留原页。

编辑分支固定快照和来源，生成不建立图片输入。每张 AI 结果独立记录，批次可部分成功，归属不随页面转移。

删除清理所属文档和快照关联，产物删除清理成果／AI 引用；不删除已同步媒体副本。事务及备份边界见[架构与性能](05-architecture-performance.md#持久化与任务)。

回归覆盖空素材、超过首批、切换／失败、返回、排序、冲突和成果同步；真实服务可用性单独验证。

## 音视频素材、属性与版本

音视频共用 `SourceRangePicker`、`SourceRelinkDialog`、`ProjectSourcesDialog`、`TimelineTimeControls` 和 `EditorVersionHistory`，主编辑器负责将确认结果转为自己的文档事务。素材条默认查看；“选段添加”是独立动作，视频可选音画／画面／声音，音频只取声音。画面预览使用媒体元素的 Range 请求，所选声音流用有界混音试听，不把完整原片转为 Blob；后端元数据失败不能用猜测时长继续提交。

`sourceRange.ts` 校验源入出点、媒体流和编辑器传入的添加时长上限。`sourceRelink.ts` 校验替换类型及所有受影响片段的源范围，重链只替换引用、名称和源时长，保留时间位置、样式、包络及关联；主编辑器重新检查锁定、容量和媒体版本。确认时再次读取磁盘元数据，异步请求不能跨素材、工作区或制作文件提交。`sourceCommitGate` 区分可取消的预检与不可关闭的提交，失败恢复重试，避免提交完成后用户以为已经取消。

片段 `audioStream` 是音频流顺序编号，省略时为 0，不是 ffprobe 的绝对流 index。`audio_streams.py` 返回语言、标题、声道、采样率及相对容器的起点和可用结束时间；选段、属性切换、波形、重链、试听与导出均使用该编号，缺失流明确拒绝。源入点始终属于媒体时间轴，迟起流用前置静音保留时间。视频画面使用容器时长，声音片段使用所选流的可用结束时间；缓存身份包含流编号，切换后不沿用另一流的时长或波形。

`ProjectSourcesDialog` 汇总同源引用，`POST /source_relink/inspect` 检查可用性，`POST /source_relink/candidates` 在受信任目录内有界扫描。同名、共享候选及未完整扫描的结果不自动猜测；应用前逐源重新校验所有片段区间与选定声音流。`projectSources.ts` 从原文档一次映射引用，防止 A→B→C 连锁替换；主组件一次提交形成一个撤销步骤。工作区／制作文件存在、源版本、锁定及只读在提交时再次检查。

`audioProperties.ts` 与 `videoProperties.ts` 显式提取可复制字段，不能复制源路径、片段 ID、时间线位置或关联 ID。音频属性区分片段、音轨和总混音；视频区分画面和字幕，画面可复制变换、调色、局部效果、淡化及动画，字幕只复制样式。应用到同类选中项并跳过锁定对象；目标片段较短时按区间限制动画和淡化。`visibleClipFades` 保持原本为零的淡化，滚动延长或负包络偏移不能凭空增加淡入／淡出。预设存于工作区版本仓储的 `omnigallery:editor-presets-v1:<workspaceId>:<audio|video>`，通过事务保存和订阅刷新，不使用独立浏览器存储绕过冲突保护。

制作版本存于 `omnigallery:editor-versions-v1:<workspaceId>:<draftId>`，`editorVersionModel.ts` 限制最近 30 条及总 UTF-8 容量 12 MiB；超额回收最早版本，单个快照过大则拒绝并保留旧记录。创建前完成当前保存，恢复前先保存“恢复前的制作文件”；非法记录保留原始内容，不能按空列表覆盖。版本只包含剪辑指令，源媒体字节和产物不复制。

`EditorSnapshotPreview` 独立解析选中版本并显示时间线。音频使用连续混音试听，视频使用只读 `VideoStage` 与共享声音时钟连续播放或定位查看，音画等待状态共同控制播放；复用已有代理但不创建或清理代理。查看／seek 不恢复当前文档、不写保存队列，关闭后停止播放与请求。缺失源媒体仍需回到编辑器重新指定。

损坏文档由 `EditorRecoveryPanel` 提供独立入口，不依赖正常时间线初始化。`recoverEditorDocument` 在同一工作区事务中保存原始字符串、恢复索引和所选正常版本，失败整体回滚；再次检查制作文件类型、当前 raw、历史版本及会话身份。副本存于 `omnigallery:editor-recovery-v1:<workspace>:<draft>:<backupId>`，每文档最多 100 份，满额拒绝而不覆盖旧副本。状态迁移对原始坏副本不改写路径，下载保留 UTF-8 原文。恢复成功后重新加载，重建初始文档与保存队列；只读可浏览和下载，不能恢复写入。正常版本页也能通过 `EditorRecoveryBackups` 查看保留副本。

## AI 输入画布

AIStudio 的图片编辑使用 `AIInputBoard` 同屏呈现主图和参考图；仅无主图时显示添加主图空位。`aiInputBoardLayout` 只计算视图几何，拖动和缩放不会写入 StudioDocument 或提交图片；引用顺序仍由 `referencePaths` 决定。每张卡片独立渲染预览、保留 AIEditCanvas 撤销栈，仅当前选中卡响应编辑快捷键；左侧工具和参数通过 portal 挂到不随画布缩放的容器。切换选择不卸载图片编辑器。工具条共用图片编辑的样式和 `useEditorToolAnchor` 浮层定位，打开设置不改变 viewport 尺寸；选中图的撤销／重做通过 portal 放入左上操作条。

主图沿用原持久键，参考图仍以主图路径＋参考图路径隔离。所有参考图初始化与保存独立于当前选中项，修改回调显式携带路径，避免快速切换时写错图片。提交时分别渲染主图和参考图，遮罩保持独立输入；编辑器不按服务端能力限制添加或恢复参考图。`planAIEditSubmission` 在提交边界按支持数量取前 N 张，并决定是否发送遮罩；忽略的输入保留在编辑器中，以同一计划生成提示。固定快照来源和保存冲突检测继续生效。

裁剪和尺寸复用 `ImageTransformTools`，AI 不传校正回调，因此不显示校正 Tab；`ImageCropFrame` 接受 HTMLElement 引用，使用文档大小构造局部图片框。尺寸页的填充、内容缩放与位置直接展开。工具栏保存状态、任务浮层和素材条约定见[设计系统](03-design-system.md#编辑器)。

## AI 图片异步任务

`workspaces/tasks.py` 保存调度状态与执行回执，`ai/image_tasks.py` 实现 Router 队列和 Cloud 工作流的恢复协议。`studio_task.execution` 保存云端编号、查询链接、提交时间、取消标记及阶段；公开接口不返回内部执行数据。输入和提交时归属保存在 `project-data/omnigallery-workspace-artifacts/<workspace>/.tasks/<task>.json`，属于项目数据，不属于可清理缓存。完成／确认取消／确定失败后移除快照，跟踪中断保留；删除工作区一并清理。系统连接密钥执行时从配置读取，不放入任务快照。

- 前端提交 UUID；后端以编号和请求指纹去重，同编号不同输入返回 409。浏览器暂存编号以恢复响应丢失的本地提交。
- Router 使用 `POST /v2/models/{provider}/{model}/requests`，提交重试复用任务 UUID 作为 `Idempotency-Key`。成功后持久化 `request_id`，按 `Retry-After` 查询状态、取回原生结果。不使用同步调用降级；没有编号且距首次提交超过 23 小时时停止补发，避开 24 小时幂等记录过期风险。
- Cloud 使用已有 API v2 工作流接口；上传输入后记录提交意图，再提交一次。官方 Cloud 合约对重复键返回拒绝，不重放响应；提交结果不明且无编号时显示不可自动恢复的跟踪中断，要求核对云端。已有编号则重启后查询原任务，不再上传或提交。
- 网络错误、限流与临时服务错误退避重试，连续 12 次失败转为可恢复的跟踪中断。鉴权问题允许改好配置后继续跟踪。Cloud 和 Router 的结果下载／解析失败均保留原任务，显示可恢复的跟踪中断；本地保存失败支持重新保存，不重新生成。
- 取消本地等待任务不调用云端；已提交任务发取消请求后继续查询。只有云端确认取消才终止，取消太晚则正常保存完成结果。
- 下载完成后先保存同目录的 `.result.json` 快照，全部产物提交后清理；本地保存失败可离线恢复，不再依赖云端结果保留期限。每张产物保存后立即记录；任务 UUID 与输出序号派生稳定产物编号，避免保存成功、回执提交前崩溃导致重复产物。部分结果保留，恢复跳过已记录结果。删除工作区后的后台返回不得重建文件。

接口：`GET /api/image-ai/tasks?workspace_id=...`；`POST /api/image-ai/tasks`；`POST /api/image-ai/tasks/{id}/cancel` 与 `/resume`（都须提供 `workspace_id`，修改接口沿用认证和写权限）。新协议用于 AI 图片生成／编辑；内置单图层工具和文本建议保留各自任务路径。

## Comfy 接入边界与后续规划

共享连接与模型目录使用 `/ai/services/comfy`、`/ai/services/comfy/status/{router|workflow}`、`/ai/services/models`。密钥保存独立于任何媒体功能，状态仅证明对应接口可访问，不保证模型额度或权限。目录条目带 `media`、`capabilities`、`enabled` 和可空的 `available`；媒体类型与能力分开扩展，未适配的音视频能力不会成为可执行候选。启用配置保存隐藏列表，新适配模型不会被旧目录快照永久排除。

图片功能继续使用自己的 `/image-ai/config` 和 `/image-ai/creation/config`。创作配置的 `defaults.image_generation` 与 `defaults.image_edit` 分离；旧单一默认值兼容迁入两者，并保留原有并发。新会话读取默认值，已保存或已交互的选择不被迟到的配置响应覆盖。旧 OpenRouter 接入在挂载路由时迁移并清除遗留密钥，不再读取其环境变量或调用服务。

Router 图片适配按原生协议分发：Nano Banana 使用 Gemini contents；FLUX 3 使用 images、resolution 与 aspect_ratio；Seedream 5.0 系列使用 image、像素 size 与 b64_json；GPT Image 2.5 使用 image、size 与 PNG 输出。每模型的尺寸、比例和参考图上限由 `image_defaults.router_image_options` 定义，前端 `creationOptions.ts` 保持对应选项，切换时清理不支持的参数。FLUX 2 与旧 Nano Banana 不再作为可执行模型。结果解析支持 Gemini inlineData、OpenAI／Seedream data 及 FLUX result.sample；下载输出 URL 不附带 Comfy 凭据，拒绝本地地址、无效图片及超限文件。GPT 6 内容理解走原生 Responses input/output，Gemini 保留原生接口，均不返回推理内容。

当前保留两个执行入口：Comfy Router 直接调用已适配的模型；Comfy Cloud 运行 API 格式工作流。当前适配范围见[AI 设置](../01-user-guide/03-ai-services.md#当前开放模型)；服务目录中存在不等于已经完成请求／结果适配。后续计划增加视频生成／编辑／延长／口型及音频配音／音效；3D 不纳入当前计划。图片专项处理继续走内置工作流，不重复接入 Router 专项接口。

**Comfy API 部署仅记录，暂不开发。** 后续有需要再增加独立的部署连接（`https://<deployment>.run.comfy.app`），管理地址、凭据、工作流与节点兼容性，复用任务状态与结果归档。它与现有 Cloud 工作流入口分开配置；本次不增加设置项，也不创建部署。

协议依据：[Router 队列](https://docs.comfy.org/development/comfy-router/queue)、[Router 请求头与幂等](https://docs.comfy.org/development/comfy-router/headers)、[Comfy API v2 合约](https://github.com/Comfy-Org/docs/blob/main/openapi-v2.yaml)、[工作流运行方式](https://docs.comfy.org/development/run-workflows/overview)。单测模拟丢失响应、重启、限流、取消晚到、结果过期及部分保存；不产生付费云任务。

## 内置工具与自定义工作流

`ToolSettings` 使用两个独立 Tab；`BuiltinToolSettings` 显示工具、连接是否配置、默认参数与只读流程，`WorkflowSettings` 保留自定义图编辑器。切换 Tab 保留编辑状态；自定义有未保存修改时禁止用内置副本覆盖。复制只创建本地草稿，明确保存后才进入用户预设列表。

`ai/builtin_tools.py` 定义固定工具身份、版本、输入输出约定及出厂流程；只允许修改开放的默认参数，不提供内置流程编辑／删除接口。默认值单独保存于数据库 `global_setting` 的 `builtin_tool_defaults:<tool_id>`，随应用数据目录迁移。用途仅用于自定义工作流，内置目录不包含用途选择。

- `GET /api/ai-tools/builtin`：内置目录和默认参数，不返回服务凭据。
- `PUT /api/ai-tools/builtin/{tool_id}/defaults`：严格校验可配置字段并遵守写权限；SAM3 接受整数 `refine_iterations` 0–5 和裁边开关；SeedVR2 接受 `target_resolution: original|2K|4K|8K`；Qwen2.1 消除接受提示词、0–256 的融合值（默认 16）及 64–4096 且按 32 对齐的处理宽高。
- `GET /api/ai-tools/builtin/{tool_id}/workflow`：读取出厂流程作为只读详情或自定义草稿。

自定义流程摘要派生 `unavailable_reason`：映射结果是 SAM3 → MaskToImage 的遮罩时，管理页保留原预设并提示专用入口；普通 AI 编辑器不列出它，后端通用执行入口同样拒绝，避免将遮罩当作图片编辑结果。自定义修改或删除不改变系统抠图绑定。

## 音频时间线

`AudioStudio` 使用 `audioTimeline.ts` 的 v1 文档，包含关联组、轨道声像／角色／压低背景音乐／处理、片段声像／音量点／淡化曲线／声道／反相，以及主混音处理。新增字段可选，旧文档保持默认音色。`audioEditing.ts` 统一多选、锁定、关联、分割、复制粘贴和波纹删除；分割只拆当前关联组，左右两边分别关联。读取失败时保留原始 JSON，保存队列、快捷键和自动保存均不得覆盖它。

`TimelineTimeControls` 供音视频共用，解析秒数或时码并校验范围；Enter 通过 blur 唯一提交，Escape 恢复受控值，非法或被拒绝的输入恢复真实值并提示。未设置选区使用空值占位，不以播放头伪装入点；选区端点限制在内容范围，主动定位播放头仍可超出内容以加入新素材。内容缩短时编辑器同步约束已有播放头、选区和滚动位置。输入控件保留自身按键，时间线片段获得焦点时空格仍可播放／暂停。

时间输入仅在用户编辑时维护文本草稿，未编辑时直接由时间值格式化显示；不能通过 effect 每帧镜像播放头到另一份状态，否则连续播放会反复触发被动更新并可能报告 React 更新深度告警。

时间线绘制限于可见刻度；网格间隔从标尺步长计算，不能从仅剩一个刻度的列表猜测。音频播放头按每行高度绘制，不能用超长绝对定位元素模拟贯穿线。轨道高度由真实行数和查看设置计算，删除不会留下装饰撑开的空白。可见波形通过 `/audio_studio/source` 的 `start/duration/samples` 获取；前端最多两个请求并发，缓存 64 个窗口，后端按源版本与窗口缓存并流式解码。左右声道分开、1／2／4／8 倍显示振幅和行高只改变查看。

`AudioClipEnvelope` 在实际片段上绘制音量点和淡化边缘。`audioEnvelopeEditing.ts` 统一命中、插点和移动，点时间保持排序与唯一，限制在片段范围；鼠标、键盘和数值控件使用同一文档语义。拆分／裁边保留原包络的局部区间，避免新片头重新开始淡入。手势从开始文档预览，松手一次提交，Escape／指针取消恢复；视图音量曲线不写入额外状态副本。淡化支持直线、柔和、等功率，声道支持交换、单声道、仅左／右及相位反转。接缝试听使用有界前后范围，循环选区与播放跟随属于会话设置。

`ContinuousAudioEngine` 用一个 Web Audio 时钟调度 12 秒混音块，提前准备后续块，最多缓存 8 块。总处理全部关闭时，后端按单位总增益生成浮点 WAV，前端 GainNode 实时调整总音量，零增益也能恢复；正式 WAV 导出保持 PCM16。浮点试听保留超 0 dBFS 的峰值，避免先削波再降低总音量造成试听与导出不同。

总增益在主混音 DSP 之前，因此开启总处理时不能用输出端增益替代。片段／音轨调参异步准备新声音快照，在当前时钟位置衔接，快速连续修改只接受最新快照。暂停取消本地播放等待、释放播放节点，但继续观察后台准备；声音修订变化、切换制作文件或离开时释放当前窗口兴趣，仍被其他窗口观察的计算继续。`observeDocument` 在暂停状态也接收声音变化并清除旧准备，不自动提交新任务。撤销／重做同步试听文档。声像、音量包络、交叉淡化和对白侧链压低音乐由 FFmpeg 实现。

音视频声音共用 `audio_mix_render.py`：每次最多两个媒体输入，按最多 10 秒 seek 与解码，拼接轨道后连续处理轨道 DSP、对白侧链和总混音 DSP；这些轨道／总线处理器不会在窗口交界重启。源变速仍采用有界窗口解码与预热，尚未验证其与单个不中断的 `atempo` 进程逐采样相同。正式输出使用完整混音的对应采样区间，画面／文字尾部补静音。音频分析也复用完整 PCM 后通过单输入测量，不再沿用一次全图的累计 256 片段限制。

`AudioProcessingControls` 提供降噪、音色预设／三段手动 EQ、预设／手动压缩、减轻齿音、动态 loudnorm 及限幅，处理默认关闭。旁路保留参数并临时关闭处理，供 A/B 原声对比。声道与相位属于片段属性，轨道／总混音处理不包含它们；声音属性预设按片段、音轨和总混音分别复制。带状态的效果、背景音乐压低，以及保持音调且 `rate != 1` 的可听片段使用完整混音缓存；`atempo` 的相位与历史同样不能在每次 seek 或试听分块时重置。前端 `needsCompleteMix` 与后端 `needs_full_mix` 共同执行该规则。

### 完整声音缓存

`audio_mix_cache.py` 管理可丢弃的完整 48 kHz 双声道浮点 PCM；`audio_mix_render.py` 提供统一音视频渲染、声学修订与源解析。缓存不进入素材／产物／成果数据库，只读可准备、读取及取消自己的试听计算。前端仍按 12 秒、最多 8 块的内存预算调度，整工程 PCM 留在磁盘。

- `POST /audio_mix_cache/start` 提交 `{workspace_id,kind:'audio'|'video',document}`，相同工作区与声音修订合并任务。
- `GET /audio_mix_cache/{id}?workspace_id` 返回 `id/revision/state/phase/progress/duration/error`。状态为 queued、running、ready、failed、cancelled 或 expired，时长仅含可听声音；请求可在画面／文字尾部读取静音。
- `POST /audio_mix_cache/{id}/cancel?workspace_id` 显式取消；运行任务先停止并回收解码进程，随后终态为 cancelled。
- `GET /audio_mix_cache/{id}/chunk?workspace_id&start&duration` 按 48 kHz 采样点读取最多 12 秒的浮点 WAV，并返回 `X-Audio-Level-Peaks`（20 Hz，左右声道交错 float32 的 base64）。支持 RIFF、RF64 和扩展浮点 WAV，仅读取头及所需 PCM。

声音修订 SHA-256 包含真实声音字段及已解析源路径、大小、mtime／ctime、inode；排除图像、字幕、标记、名称和锁定。提交／复用、worker 开始／完成和 ready 读取都验证路径信任、工作区删除标记及源指纹，源变化不能返回旧混音。导出通过 `lease_ready(workspace,kind,document)` 借用相同修订并 pin 文件；未命中时使用同一个完整渲染器，发布仍遵循任务的源版本检查。

start body 与 status／cancel 查询可带 UUID `client_id`。每次准备使用独立兴趣 UUID，start／status 续期五分钟，cancel 带 client_id 仅释放该兴趣；最后一个兴趣消失才取消未完成计算。已释放编号在同任务内不能重新登记，迟到 status 只读状态、迟到 start 返回 409；改声音再撤销生成新兴趣，旧 start 响应补发的取消不能误杀当前准备。前端已知任务编号时先停止观察再取消，提交响应晚到时取得编号后补发取消。过期无人观察的任务同样回收；暂停继续观察，不释放兴趣。不带 client_id 的旧提交保留全任务显式取消语义，cancel 不带编号仍取消整个任务。

单 worker，排队和运行合计最多 4 项，历史及 ready 元数据各最多 256 项；每任务最多 64 个活动兴趣，活动及撤回编号总计最多 256 个。超出队列或会话容量返回 429。PCM LRU 预算 20 GiB，借用中的文件不回收；预检按最多四份 `声音时长 × 48000 × 8` 加 512 MiB 余量估算临时处理空间，超过容量或空闲空间不足返回 507。ready manifest 支持重启复用，未完成缓存不恢复。关闭服务终止当前计算，工作区删除先禁止新任务、取消计算并等待导出借用释放，再清理缓存。

`AudioLoudnessAnalysis` 通过 `/audio_studio/analysis` 创建、轮询和取消整段分析，`audio_analysis.py` 借用 ready 混音或通过同一个有界渲染器生成临时 PCM，再用单输入统计 LUFS、LRA、真峰值和采样峰值过载范围；前端显示最多 128 段并支持定位。分析任务单并发、内存最多 32 条、约一小时过期，不属于持久导出队列；分析前后核对声音与源 stat 修订，变化返回 409，不保存错误报告。

完成报告通过工作区事务存于 `omnigallery:audio-loudness-reports-v1:<workspace>:<draft>`，保留最近 8 份、UTF-8 总量最多 256 KiB，只含日期、前端声音 SHA-256、后端声音／源修订和测量值。提交时确认同一音频制作文件仍存在且可写；只读可检查和查看，但不保存新报告。重开可查看历史；声音或整段时长变化标为过期。`POST /audio_studio/analysis/revision` 只核对源 stat，重新打开、窗口重新聚焦及声音变化时检测同路径源修改，源修订不同或无法核对均禁用旧过载位置。无法读取的原始报告保留，不能覆盖为空列表。

音视频导出都先确认名称和范围，每次打开确认框按当前有效选区选择默认范围，无选区则回落整条时间线。音频使用 `/audio_studio/tasks` 的持久任务队列；旧同步 `/audio_studio/export` 保留兼容。提交保存后的文档 SHA-256 修订、原始导出快照与 `task_id`，成功返回 202。`audio_exports.py` 通过 `MediaExportQueue` 适配音频校验、源指纹、FFmpeg 处理和产物发布，任务完成与产物写入保持同一事务。前端未确认提交保存在 `audio-export-pending-v1`，网络结果不确定时重用编号；只有明确尚未创建的 `audio_export_not_created` 拒绝才释放该快照。

音频任务与视频任务分别单并发、各最多 4 个活动任务。工作区删除先停止两种队列，等待写入结束，再删除目录。重启将运行中任务标记中断，排队任务可恢复；导出对应提交修订，期间编辑不影响已接受的快照。列表、创建和取消分别使用 GET／POST `/audio_studio/tasks`、POST `/audio_studio/tasks/{task_id}/cancel`；读取需鉴权，创建和取消另需写权限。

音频的确定性回归覆盖波形、包络／淡化、关联剪辑、声道／相位、处理旁路、整段分析、任务取消及源重链／版本恢复。长时间线读取与有界窗口测试不能代替大文件压力验收。录音、新增导出规格及智能辅助按当前范围暂不开发。视频声音链路与验收边界见[视频编辑实现](08-video-editor.md)。
