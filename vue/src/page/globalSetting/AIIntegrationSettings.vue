<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { getQwenModels, getQwenStatus, installQwenModel, saveQwenConfig, saveQwenInstructQuantization, selectQwenModel, startQwenIndex, type QwenModelKind, type QwenModelManager, type QwenModelSize, type QwenQuantization, type QwenStatus } from '@/api/qwen3vl'
import { DEFAULT_IMAGE_DESCRIPTION, DEFAULT_IMAGE_PROMPT_EN, DEFAULT_IMAGE_TAGS, getComfyCloudStatus, getGGUFStatus, getImageAIConfig, saveImageAIConfig, type ComfyWorkflow, type ImageAIConfig, type ImageAITask } from '@/api/imageAi'
import { useGlobalStore } from '@/store/useGlobalStore'

const props = defineProps<{ active: boolean }>()
const global = useGlobalStore()
const modelStatus = ref<Partial<Record<QwenModelKind, QwenStatus>>>({})
const modelManager = ref<QwenModelManager>()
const modelPath = ref<Record<QwenModelKind, string>>({ embedding: '', reranker: '', instruct: '' })
const selectedSize = ref<Record<QwenModelKind, QwenModelSize>>({ embedding: '2B', reranker: '2B', instruct: '2B' })
const modelSaving = ref<QwenModelKind>()
const quantization = ref<QwenQuantization>('none')
const quantSaving = ref(false)
const modelIndexing = ref(false)
const modelError = ref('')
const modelCards: {kind: 'embedding' | 'reranker'; title: string; description: string; note: string}[] = [
  { kind: 'embedding', title: '图文检索模型', description: '用文字找画面，也用于以图搜图。', note: '换模型后需重建图片索引。' },
  { kind: 'reranker', title: '图片重排模型', description: '对检索出的图片再次评分，调整结果顺序。', note: '目前重排文字搜索的前 20 张候选图。' },
]
const resources = [
  { size: '2B', disk: '约 4–5 GB', vram: '建议 8 GB', ram: '建议 16 GB' },
  { size: '8B', disk: '约 16–18 GB', vram: '建议 24 GB', ram: '建议 32 GB' },
]
const content = ref<ImageAIConfig>({
  provider: 'local', openrouter_model: 'qwen/qwen3-vl-8b-instruct',
  gguf_base_url: 'http://127.0.0.1:8080/v1', gguf_model: '',
  comfy_model: 'vertexai/gemini-3.1-flash-lite',
  comfy_mode: 'router', comfy_workflow: null, comfy_workflow_name: '',
  comfy_image_node_id: '', comfy_image_input: 'image',
  comfy_prompt_node_id: '', comfy_prompt_input: 'prompt', comfy_output_node_id: '',
  prompts: { description: DEFAULT_IMAGE_DESCRIPTION, prompt: DEFAULT_IMAGE_PROMPT_EN, tags: DEFAULT_IMAGE_TAGS },
  api_key_configured: false, api_key_source: 'none',
  comfy_api_key_configured: false, comfy_api_key_source: 'none',
})
const promptTask = ref<ImageAITask>('description')
const promptTabs: {task: ImageAITask; label: string; hint: string}[] = [
  { task: 'description', label: '描述', hint: '{max_chars} 是预览中选择的长度' },
  { task: 'prompt', label: '提示词反推', hint: '{max_chars} 当前为 600' },
  { task: 'tags', label: '标签推荐', hint: '{allowed_tags} 是已有自定义标签' },
]
const contentLoaded = ref(false)
const apiKeyDraft = ref('')
const comfyKeyDraft = ref('')
const contentSaving = ref(false)
const contentError = ref('')
const ggufStatus = ref<{ready: boolean; models: string[]}>()
const ggufChecking = ref(false)
const comfyStatus = ref<{ready: boolean; detail: string}>()
const comfyChecking = ref(false)
const workflowNodes = computed(() => Object.entries(content.value.comfy_workflow || {}).map(([id, node]) => ({
  id, label: `${id} · ${node._meta?.title || node.class_type}`,
})))
const workflowInputs = (id: string) => Object.keys(content.value.comfy_workflow?.[id]?.inputs || {})
const workflowReady = computed(() => {
  const graph = content.value.comfy_workflow
  return !!graph && !!graph[content.value.comfy_image_node_id] &&
    workflowInputs(content.value.comfy_image_node_id).includes(content.value.comfy_image_input) &&
    !!graph[content.value.comfy_prompt_node_id] &&
    workflowInputs(content.value.comfy_prompt_node_id).includes(content.value.comfy_prompt_input) &&
    !!graph[content.value.comfy_output_node_id]
})
const savedGGUFUrl = ref('')
const contentReady = computed(() => content.value.provider === 'local'
  ? modelStatus.value.instruct?.state === 'ready'
  : content.value.provider === 'local_gguf'
    ? !!ggufStatus.value?.ready && content.value.gguf_base_url.trim() === savedGGUFUrl.value
    : content.value.provider === 'comfy_cloud'
      ? content.value.comfy_api_key_configured && (content.value.comfy_mode === 'router' || workflowReady.value)
      : content.value.api_key_configured)
const contentStateLabel = computed(() => contentReady.value
  ? content.value.provider === 'openrouter' || content.value.provider === 'comfy_cloud' ? 'API 已配置' : content.value.provider === 'local_gguf' ? '本机已连接' : '本地就绪'
  : content.value.provider === 'local_gguf' ? '待连接' : '待配置')
let timer: ReturnType<typeof setTimeout> | undefined
let refreshQueue: Promise<void> = Promise.resolve()
let pendingRefreshes = 0
let activePage = false
let pollFailures = 0

function schedulePoll() {
  clearTimeout(timer)
  if (!activePage || !props.active || document.hidden || pendingRefreshes ||
    !(modelManager.value?.job.running || modelStatus.value.embedding?.running)) return
  timer = setTimeout(() => { void refreshModels(false, true) }, Math.min(30000, 2000 * 2 ** pollFailures))
}

function handleVisibilityChange() {
  clearTimeout(timer)
  if (!document.hidden && activePage && props.active && !pendingRefreshes &&
    (modelManager.value?.job.running || modelStatus.value.embedding?.running)) void refreshModels()
}

function modelName(kind: QwenModelKind, size: QwenModelSize) {
  return kind === 'instruct' ? `Qwen3-VL-${size}-Instruct` : `Qwen3-VL-${kind === 'embedding' ? 'Embedding' : 'Reranker'}-${size}`
}

function choice(kind: QwenModelKind) {
  return modelManager.value?.models[kind]?.find(option => option.size === selectedSize.value[kind])
}

function refreshModels(syncPath = false, poll = false): Promise<void> {
  clearTimeout(timer)
  pendingRefreshes += 1
  const request = refreshQueue.then(async () => {
    if (!activePage) return
    try {
      const wasDownloading = modelManager.value?.job.running
      let manager: QwenModelManager | undefined
      let polledEmbedding: QwenStatus | undefined
      // During a long job, only its live state changes. Read all models once it finishes.
      if (poll && wasDownloading) {
        const [latestManager, latestEmbedding] = await Promise.all([
          getQwenModels(),
          modelStatus.value.embedding?.running ? getQwenStatus('embedding') : Promise.resolve(undefined),
        ])
        manager = latestManager
        polledEmbedding = latestEmbedding
        if (!activePage) return
        if (polledEmbedding) modelStatus.value = { ...modelStatus.value, embedding: polledEmbedding }
        if (manager.job.running) {
          modelManager.value = manager
          modelError.value = ''
          pollFailures = 0
          return
        }
      } else if (poll && modelStatus.value.embedding?.running) {
        const embedding = await getQwenStatus('embedding')
        if (!activePage) return
        modelStatus.value = { ...modelStatus.value, embedding }
        modelError.value = ''
        pollFailures = 0
        return
      }
      const [embedding, reranker, instruct, fullManager] = await Promise.all([
        polledEmbedding ?? getQwenStatus('embedding'), getQwenStatus('reranker'),
        getQwenStatus('instruct'), manager ?? getQwenModels(),
      ])
      if (!activePage) return
      const next = { embedding, reranker, instruct }
      if (syncPath || (wasDownloading && !fullManager.job.running) || !modelManager.value) {
        for (const kind of ['embedding', 'reranker', 'instruct'] as QwenModelKind[]) {
          modelPath.value[kind] = next[kind].model_path
          selectedSize.value[kind] = next[kind].model.includes('8B') ? '8B' : '2B'
        }
        quantization.value = next.instruct.quantization || 'none'
      }
      modelStatus.value = next
      modelManager.value = fullManager
      modelError.value = ''
      pollFailures = 0
    } catch (cause: any) {
      if (activePage) {
        modelError.value = cause?.response?.data?.detail || cause?.message || '读取模型状态失败'
        pollFailures = Math.min(4, pollFailures + 1)
      }
    }
  }).finally(() => {
    pendingRefreshes -= 1
    if (!pendingRefreshes) schedulePoll()
  })
  refreshQueue = request.catch(() => {})
  return request
}

async function saveModelPath(kind: QwenModelKind, reset = false) {
  if (global.conf?.is_readonly || modelSaving.value) return
  modelSaving.value = kind
  try {
    await saveQwenConfig(kind, reset ? '' : modelPath.value[kind].trim())
    await refreshModels(true)
    message.success(reset ? '已恢复默认目录' : '模型目录已保存')
  } catch (cause: any) {
    modelError.value = cause?.response?.data?.detail || cause?.message || '保存模型目录失败'
  } finally { modelSaving.value = undefined }
}

async function saveQuantization() {
  if (global.conf?.is_readonly || quantSaving.value) return
  quantSaving.value = true
  try {
    await saveQwenInstructQuantization(quantization.value)
    await refreshModels(true)
    message.success('加载精度已保存；下次推理时生效')
  } catch (cause: any) {
    modelError.value = cause?.response?.data?.detail || cause?.message || '保存加载精度失败'
  } finally { quantSaving.value = false }
}

async function useModel(kind: QwenModelKind) {
  if (global.conf?.is_readonly || modelSaving.value || modelManager.value?.job.running) return
  modelSaving.value = kind
  try {
    await selectQwenModel(kind, selectedSize.value[kind])
    await refreshModels(true)
    message.success('已切换模型')
  } catch (cause: any) {
    modelError.value = cause?.response?.data?.detail || cause?.message || '切换模型失败'
  } finally { modelSaving.value = undefined }
}

async function downloadModel(kind: QwenModelKind) {
  if (global.conf?.is_readonly || modelManager.value?.job.running) return
  try {
    modelManager.value = await installQwenModel(kind, selectedSize.value[kind])
    modelError.value = ''
    await refreshModels()
  } catch (cause: any) {
    modelError.value = cause?.response?.data?.detail || cause?.message || '启动下载失败'
  }
}

async function buildIndex() {
  if (global.conf?.is_readonly || modelIndexing.value) return
  modelIndexing.value = true
  try { await startQwenIndex(); await refreshModels() }
  catch (cause: any) { modelError.value = cause?.response?.data?.detail || cause?.message || '启动图片索引失败' }
  finally { modelIndexing.value = false }
}

async function refreshContent() {
  try {
    const config = await getImageAIConfig()
    content.value = { ...config, prompts: { ...config.prompts } }
    savedGGUFUrl.value = config.gguf_base_url
    apiKeyDraft.value = ''
    comfyKeyDraft.value = ''
    contentLoaded.value = true
    contentError.value = ''
    if (config.provider === 'local_gguf') void checkGGUF()
    if (config.provider === 'comfy_cloud') void checkComfy()
  } catch (cause: any) {
    contentError.value = cause?.response?.data?.detail || cause?.message || '读取内容处理配置失败'
  }
}

async function checkGGUF() {
  ggufChecking.value = true
  try { ggufStatus.value = await getGGUFStatus() }
  catch { ggufStatus.value = { ready: false, models: [] } }
  finally { ggufChecking.value = false }
}

async function checkComfy() {
  comfyChecking.value = true
  try { comfyStatus.value = await getComfyCloudStatus() }
  catch { comfyStatus.value = { ready: false, detail: '无法验证已保存的 Comfy API Key' } }
  finally { comfyChecking.value = false }
}

async function importComfyWorkflow(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 1_000_000) { contentError.value = '工作流 JSON 不能超过 1 MB'; return }
  try {
    const graph = JSON.parse(await file.text()) as ComfyWorkflow
    const nodes = Object.entries(graph)
    if (!graph || Array.isArray(graph) || nodes.length === 0 || nodes.length > 256 ||
      ('nodes' in graph && 'links' in graph) ||
      nodes.some(([, node]) => !node || typeof node.class_type !== 'string' || !node.inputs || typeof node.inputs !== 'object' || Array.isArray(node.inputs))) {
      throw new Error('请从 ComfyUI 导出 API 格式 JSON，界面格式不能运行')
    }
    const image = nodes.find(([, node]) => node.class_type === 'LoadImage' && 'image' in node.inputs) ||
      nodes.find(([, node]) => 'image' in node.inputs && typeof node.inputs.image === 'string')
    const prompt = nodes.find(([, node]) => 'prompt' in node.inputs && typeof node.inputs.prompt === 'string') ||
      nodes.find(([, node]) => 'text' in node.inputs && typeof node.inputs.text === 'string')
    const output = nodes.find(([, node]) => /SaveText|TextOutput|PreviewText/i.test(node.class_type)) ||
      nodes.find(([, node]) => /save|output/i.test(node.class_type))
    content.value.comfy_workflow = graph
    content.value.comfy_workflow_name = file.name
    content.value.comfy_image_node_id = image?.[0] || ''
    content.value.comfy_image_input = image ? ('image' in image[1].inputs ? 'image' : Object.keys(image[1].inputs)[0] || '') : ''
    content.value.comfy_prompt_node_id = prompt?.[0] || ''
    content.value.comfy_prompt_input = prompt ? ('prompt' in prompt[1].inputs ? 'prompt' : 'text') : ''
    content.value.comfy_output_node_id = output?.[0] || ''
    contentError.value = ''
    message.success(`已导入 ${nodes.length} 个节点，请确认输入和输出映射`)
  } catch (cause: any) {
    contentError.value = cause?.message || '无法读取工作流 JSON'
  }
}

async function saveContent(clearKey?: 'openrouter' | 'comfy') {
  if (global.conf?.is_readonly || contentSaving.value) return
  contentSaving.value = true
  contentError.value = ''
  try {
    const saved = await saveImageAIConfig({
      provider: content.value.provider, openrouter_model: content.value.openrouter_model.trim(),
      gguf_base_url: content.value.gguf_base_url.trim(), gguf_model: content.value.gguf_model.trim(),
      comfy_model: content.value.comfy_model,
      comfy_mode: content.value.comfy_mode,
      comfy_workflow: content.value.comfy_workflow,
      comfy_workflow_name: content.value.comfy_workflow_name,
      comfy_image_node_id: content.value.comfy_image_node_id,
      comfy_image_input: content.value.comfy_image_input,
      comfy_prompt_node_id: content.value.comfy_prompt_node_id,
      comfy_prompt_input: content.value.comfy_prompt_input,
      comfy_output_node_id: content.value.comfy_output_node_id,
      prompts: { ...content.value.prompts },
      ...(clearKey === 'openrouter' ? { clear_api_key: true } : content.value.provider === 'openrouter' && apiKeyDraft.value.trim() ? { api_key: apiKeyDraft.value.trim() } : {}),
      ...(clearKey === 'comfy' ? { clear_comfy_api_key: true } : content.value.provider === 'comfy_cloud' && comfyKeyDraft.value.trim() ? { comfy_api_key: comfyKeyDraft.value.trim() } : {}),
    })
    content.value = { ...saved, prompts: { ...saved.prompts } }
    savedGGUFUrl.value = saved.gguf_base_url
    apiKeyDraft.value = ''
    comfyKeyDraft.value = ''
    message.success(clearKey ? '已清除保存的 API Key' : '配置已保存')
    if (saved.provider === 'local_gguf') void checkGGUF()
    if (saved.provider === 'comfy_cloud') void checkComfy()
  } catch (cause: any) {
    contentError.value = cause?.response?.data?.detail || cause?.message || '保存配置失败'
  } finally { contentSaving.value = false }
}

function resetPrompts() {
  content.value.prompts = { description: DEFAULT_IMAGE_DESCRIPTION, prompt: DEFAULT_IMAGE_PROMPT_EN, tags: DEFAULT_IMAGE_TAGS }
}

onMounted(() => {
  activePage = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (props.active) {
    void refreshModels(true)
    void refreshContent()
  }
})
watch(() => props.active, active => {
  clearTimeout(timer)
  if (!active || !activePage) return
  void refreshModels(true)
  if (!contentLoaded.value) void refreshContent()
})
onUnmounted(() => {
  activePage = false
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="ai-settings">
    <article v-for="card in modelCards" :key="card.kind" class="ai-card">
      <header><div><h3>{{ card.title }}</h3><p>{{ card.description }}</p></div><span class="state-badge" :class="{ready: modelStatus[card.kind]?.state === 'ready'}">{{ modelStatus[card.kind]?.state === 'ready' ? '本地就绪' : '待配置' }}</span></header>
      <div class="card-layout">
        <div class="model-controls">
          <label class="field-label" :for="`model-${card.kind}`">Qwen3-VL 型号</label>
          <div class="variant-row">
            <select :id="`model-${card.kind}`" v-model="selectedSize[card.kind]" class="provider-select" :disabled="!!modelManager?.job.running"><option value="2B">{{ modelName(card.kind, '2B') }} · 默认</option><option value="8B">{{ modelName(card.kind, '8B') }}</option></select>
            <a-button v-if="choice(card.kind)?.installed" :loading="modelSaving === card.kind" :disabled="!!global.conf?.is_readonly || choice(card.kind)?.active || !!modelManager?.job.running" @click="useModel(card.kind)">{{ choice(card.kind)?.active ? '使用中' : '启用' }}</a-button>
            <a-button v-else type="primary" :disabled="!!global.conf?.is_readonly || !!modelManager?.job.running" @click="downloadModel(card.kind)">下载并安装</a-button>
          </div>
          <p class="status-line" :class="modelStatus[card.kind]?.state === 'ready' ? 'status-ok' : 'status-warn'">{{ modelStatus[card.kind]?.state === 'ready' ? `当前：${modelStatus[card.kind]?.model?.replace('Qwen/', '')}` : modelStatus[card.kind]?.detail || '正在读取模型状态…' }}</p>
          <p v-if="modelManager?.job.kind === card.kind && modelManager.job.running" class="status-line">{{ modelManager.job.stage }}</p>
          <p v-if="modelManager?.job.kind === card.kind && modelManager.job.error" class="status-line status-warn">{{ modelManager.job.error }}</p>
          <details class="advanced"><summary>使用已有模型目录</summary><div class="path-control"><a-input v-model:value="modelPath[card.kind]" :disabled="!!modelSaving || !!global.conf?.is_readonly" placeholder="后端可访问的完整目录" /><a-button :loading="modelSaving === card.kind" :disabled="!!global.conf?.is_readonly || !modelPath[card.kind]?.trim() || modelPath[card.kind].trim() === modelStatus[card.kind]?.model_path" @click="saveModelPath(card.kind)">保存目录</a-button><a-button :disabled="!!global.conf?.is_readonly || modelStatus[card.kind]?.config_source !== 'settings'" @click="saveModelPath(card.kind, true)">恢复默认</a-button></div></details>
          <div class="model-actions"><template v-if="card.kind === 'embedding'"><span>已索引 {{ modelStatus.embedding?.indexed_count ?? 0 }} / {{ modelStatus.embedding?.image_count ?? 0 }} 张</span><a-button size="small" :loading="modelIndexing || modelStatus.embedding?.running" :disabled="modelStatus.embedding?.state !== 'ready' || !!global.conf?.is_readonly" @click="buildIndex">更新索引</a-button></template><span>{{ card.note }}</span></div>
        </div>
        <aside class="resource-list"><h4>资源参考</h4><ul><li v-for="item in resources" :key="item.size"><strong>{{ item.size }}</strong><span>磁盘 {{ item.disk }}</span><span>显存 {{ item.vram }}</span><span>内存 {{ item.ram }}</span></li></ul><small>估算值；实际占用因图片和设备而异。</small></aside>
      </div>
    </article>
    <a-alert v-if="modelError" type="error" :message="modelError" show-icon />

    <article class="ai-card">
      <header><div><h3>图片内容处理模型</h3><p>生成描述、反推提示词、推荐已有标签。</p></div><span class="state-badge" :class="{ready: contentReady}">{{ contentStateLabel }}</span></header>
      <div class="provider-row"><label class="field-label" for="image-ai-provider">接入方式</label><select id="image-ai-provider" v-model="content.provider" class="provider-select" :disabled="!contentLoaded || contentSaving || !!global.conf?.is_readonly"><option value="local">本地 Transformers</option><option value="local_gguf">本机 GGUF 服务</option><option value="comfy_cloud">Comfy Cloud API</option><option value="openrouter">OpenRouter API</option></select></div>
      <div v-if="content.provider === 'local'" class="card-layout">
        <div class="model-controls">
          <label class="field-label" for="model-instruct">Qwen3-VL 型号</label>
          <div class="variant-row"><select id="model-instruct" v-model="selectedSize.instruct" class="provider-select" :disabled="!!modelManager?.job.running"><option value="2B">{{ modelName('instruct', '2B') }} · 默认</option><option value="8B">{{ modelName('instruct', '8B') }}</option></select><a-button v-if="choice('instruct')?.installed" :loading="modelSaving === 'instruct'" :disabled="!!global.conf?.is_readonly || choice('instruct')?.active || !!modelManager?.job.running" @click="useModel('instruct')">{{ choice('instruct')?.active ? '使用中' : '启用' }}</a-button><a-button v-else type="primary" :disabled="!!global.conf?.is_readonly || !!modelManager?.job.running" @click="downloadModel('instruct')">下载并安装</a-button></div>
          <p class="status-line" :class="modelStatus.instruct?.state === 'ready' ? 'status-ok' : 'status-warn'">{{ modelStatus.instruct?.state === 'ready' ? `当前：${modelStatus.instruct?.model?.replace('Qwen/', '')}` : modelStatus.instruct?.detail || '正在读取模型状态…' }}</p>
          <p v-if="modelManager?.job.kind === 'instruct' && modelManager.job.running" class="status-line">{{ modelManager.job.stage }}</p><p v-if="modelManager?.job.kind === 'instruct' && modelManager.job.error" class="status-line status-warn">{{ modelManager.job.error }}</p>
          <div class="quantization-row"><label class="field-label" for="instruct-quantization">加载精度</label><select id="instruct-quantization" v-model="quantization" class="provider-select" :disabled="quantSaving || !!global.conf?.is_readonly"><option value="none">原始精度</option><option value="int8">8 位 · bitsandbytes</option><option value="nf4">4 位 NF4 · bitsandbytes</option></select><a-button :loading="quantSaving" :disabled="!!global.conf?.is_readonly || quantization === modelStatus.instruct?.quantization" @click="saveQuantization">应用</a-button></div>
          <p class="compact-help">4/8 位在加载时量化，可降低显存占用；模型下载大小不变。需安装可用的 bitsandbytes 与 accelerate，实际支持取决于设备后端。</p>
          <details class="advanced"><summary>使用已有模型目录</summary><div class="path-control"><a-input v-model:value="modelPath.instruct" :disabled="!!modelSaving || !!global.conf?.is_readonly" placeholder="后端可访问的完整目录" /><a-button :loading="modelSaving === 'instruct'" :disabled="!!global.conf?.is_readonly || !modelPath.instruct.trim() || modelPath.instruct.trim() === modelStatus.instruct?.model_path" @click="saveModelPath('instruct')">保存目录</a-button><a-button :disabled="!!global.conf?.is_readonly || modelStatus.instruct?.config_source !== 'settings'" @click="saveModelPath('instruct', true)">恢复默认</a-button></div></details>
        </div>
        <aside class="resource-list"><h4>资源参考</h4><ul><li v-for="item in resources" :key="item.size"><strong>{{ item.size }}</strong><span>磁盘 {{ item.disk }}</span><span>显存 {{ item.vram }}</span><span>内存 {{ item.ram }}</span></li></ul><small>三种本地模型按需加载。</small></aside>
      </div>
      <div v-else-if="content.provider === 'local_gguf'" class="api-config">
        <p class="compact-help">使用后端所在机器的 llama.cpp OpenAI 兼容服务；视觉模型须连同 mmproj 一起加载。仅用于描述、提示词和标签建议，不替换图文检索索引模型。</p>
        <label class="field-label" for="gguf-base-url">本机服务地址</label><a-input id="gguf-base-url" v-model:value="content.gguf_base_url" :disabled="contentSaving || !!global.conf?.is_readonly" placeholder="http://127.0.0.1:8080/v1" />
        <label class="field-label" for="gguf-model">模型 ID（可留空使用服务当前模型）</label><a-input id="gguf-model" v-model:value="content.gguf_model" :disabled="contentSaving || !!global.conf?.is_readonly" placeholder="留空" />
        <div class="model-actions"><a-button size="small" :loading="ggufChecking" @click="checkGGUF">测试已保存的连接</a-button><span>{{ ggufStatus?.ready ? `已连接${ggufStatus.models.length ? ` · ${ggufStatus.models.join('、')}` : ''}` : '服务未连接或尚未测试' }}</span></div>
        <p class="compact-help">示例：<code>llama-server -hf Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M --host 127.0.0.1 --port 8080</code>。<a href="https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF" target="_blank" rel="noopener noreferrer">官方 GGUF 模型</a> · <a href="https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md" target="_blank" rel="noopener noreferrer">llama.cpp 图像支持说明</a></p>
      </div>
      <div v-else-if="content.provider === 'comfy_cloud'" class="api-config">
        <p class="compact-help">将缩放后的图片发送给 Comfy Cloud，用于描述、提示词反推和标签建议。云端运行会消耗额度。</p>
        <label class="field-label" for="comfy-mode">调用方式</label>
        <select id="comfy-mode" v-model="content.comfy_mode" class="provider-select" :disabled="contentSaving || !!global.conf?.is_readonly"><option value="router">直接调用视觉模型</option><option value="workflow">运行自定义 JSON 工作流</option></select>
        <template v-if="content.comfy_mode === 'router'">
          <label class="field-label" for="comfy-model">视觉模型</label>
          <select id="comfy-model" v-model="content.comfy_model" class="provider-select" :disabled="contentSaving || !!global.conf?.is_readonly"><option value="vertexai/gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option><option value="vertexai/gemini-3.7-flash">Gemini 3.7 Flash</option></select>
        </template>
        <div v-else class="workflow-config">
          <div class="workflow-import"><label class="workflow-file-button" :class="{disabled: contentSaving || !!global.conf?.is_readonly}">导入 API 格式 JSON<input type="file" aria-label="导入 ComfyUI API 格式 JSON 工作流" accept=".json,application/json" :disabled="contentSaving || !!global.conf?.is_readonly" @change="importComfyWorkflow" /></label><span>{{ content.comfy_workflow_name || '尚未导入工作流' }}<template v-if="content.comfy_workflow"> · {{ workflowNodes.length }} 个节点</template></span></div>
          <p class="compact-help">在 ComfyUI 中选择“保存（API 格式）”。图片输入应为可替换文件名的节点，提示词输入应为文本字段，输出节点需要返回文本或文本文件。导入后请检查下方映射。</p>
          <div v-if="content.comfy_workflow" class="workflow-mapping">
            <div><label class="field-label" for="comfy-image-node">图片输入节点</label><select id="comfy-image-node" v-model="content.comfy_image_node_id" class="provider-select"><option value="">选择节点</option><option v-for="node in workflowNodes" :key="node.id" :value="node.id">{{ node.label }}</option></select><select v-model="content.comfy_image_input" class="provider-select" aria-label="图片输入字段"><option v-for="name in workflowInputs(content.comfy_image_node_id)" :key="name" :value="name">{{ name }}</option></select></div>
            <div><label class="field-label" for="comfy-prompt-node">提示词输入节点</label><select id="comfy-prompt-node" v-model="content.comfy_prompt_node_id" class="provider-select"><option value="">选择节点</option><option v-for="node in workflowNodes" :key="node.id" :value="node.id">{{ node.label }}</option></select><select v-model="content.comfy_prompt_input" class="provider-select" aria-label="提示词输入字段"><option v-for="name in workflowInputs(content.comfy_prompt_node_id)" :key="name" :value="name">{{ name }}</option></select></div>
            <div><label class="field-label" for="comfy-output-node">文本输出节点</label><select id="comfy-output-node" v-model="content.comfy_output_node_id" class="provider-select"><option value="">选择节点</option><option v-for="node in workflowNodes" :key="node.id" :value="node.id">{{ node.label }}</option></select></div>
          </div>
          <p v-if="content.comfy_workflow && !workflowReady" class="status-line status-warn">请完成图片、提示词和文本输出的节点映射。</p>
        </div>
        <label class="field-label" for="comfy-key">Comfy API Key</label>
        <div class="path-control"><a-input-password id="comfy-key" v-model:value="comfyKeyDraft" :disabled="contentSaving || !!global.conf?.is_readonly" autocomplete="new-password" placeholder="留空则保持现有 Key" /><a-button v-if="content.comfy_api_key_source === 'saved'" :disabled="contentSaving || !!global.conf?.is_readonly" @click="saveContent('comfy')">清除 Key</a-button></div>
        <p class="compact-help">{{ content.comfy_api_key_configured ? 'API Key 已配置，页面不回显。' : '未配置 Key；也可设置后端环境变量 COMFY_API_KEY。' }} <a href="https://platform.comfy.org/profile/api-keys" target="_blank" rel="noopener noreferrer">管理 Comfy API Key</a> · <a href="https://docs.comfy.org/development/cloud/api-reference" target="_blank" rel="noopener noreferrer">工作流接口说明</a></p>
        <div class="model-actions"><a-button size="small" :loading="comfyChecking" @click="checkComfy">验证已保存的 Key</a-button><span>{{ comfyStatus?.detail || '尚未验证' }}</span></div>
      </div>
      <div v-else class="api-config"><p class="compact-help">填写支持图片输入的模型 ID。生成时会把缩放后的图片发送给 OpenRouter；无需本地模型显存。</p><label class="field-label" for="openrouter-model">OpenRouter 模型 ID</label><a-input id="openrouter-model" v-model:value="content.openrouter_model" :disabled="contentSaving || !!global.conf?.is_readonly" placeholder="qwen/qwen3-vl-8b-instruct" /><label class="field-label" for="openrouter-key">API Key</label><div class="path-control"><a-input-password id="openrouter-key" v-model:value="apiKeyDraft" :disabled="contentSaving || !!global.conf?.is_readonly" autocomplete="new-password" placeholder="留空则保持现有 Key" /><a-button v-if="content.api_key_source === 'saved'" :disabled="contentSaving || !!global.conf?.is_readonly" @click="saveContent('openrouter')">清除 Key</a-button></div><p class="compact-help">{{ content.api_key_configured ? 'API Key 已配置，页面不回显。' : '未配置 Key；也可设置后端环境变量 OPENROUTER_API_KEY。' }} <a href="https://openrouter.ai/models?input_modalities=image%2Ctext" target="_blank" rel="noopener noreferrer">查看视觉模型</a></p></div>

      <div class="prompt-section"><div class="prompt-heading"><div><h4>默认系统提示词</h4><p>适用于当前接入方式；预览中可临时修改反推指令。</p></div><a-button size="small" :disabled="contentSaving || !!global.conf?.is_readonly" @click="resetPrompts">恢复预设</a-button></div><div class="prompt-tabs" role="tablist" aria-label="系统提示词任务"><button v-for="tab in promptTabs" :key="tab.task" type="button" role="tab" :aria-selected="promptTask === tab.task" :class="{active: promptTask === tab.task}" @click="promptTask = tab.task">{{ tab.label }}</button></div><p class="compact-help">{{ promptTabs.find(tab => tab.task === promptTask)?.hint }}</p><a-textarea v-model:value="content.prompts[promptTask]" :disabled="contentSaving || !!global.conf?.is_readonly" :rows="4" :maxlength="2000" :aria-label="`默认${promptTabs.find(tab => tab.task === promptTask)?.label}系统提示词`" /></div>
      <div class="save-actions"><a-button type="primary" :loading="contentSaving" :disabled="!contentLoaded || !!global.conf?.is_readonly || (content.provider === 'openrouter' && !content.openrouter_model.trim()) || (content.provider === 'local_gguf' && !content.gguf_base_url.trim()) || (content.provider === 'comfy_cloud' && content.comfy_mode === 'workflow' && !workflowReady) || !content.prompts.description.trim() || !content.prompts.prompt.trim() || !content.prompts.tags.trim()" @click="saveContent()">保存内容处理配置</a-button><a-button @click="refreshContent">重新读取</a-button></div>
      <a-alert v-if="contentError" type="error" :message="contentError" show-icon />
    </article>
  </div>
</template>

<style scoped>
.ai-settings { display: flex; flex-direction: column; gap: 14px; width: 100%; min-width: 0; container-type: inline-size; }
.ai-card { padding: 18px; border: 1px solid var(--zp-border); border-radius: 8px; background: var(--zp-primary-background); }
.ai-card header { display: flex; justify-content: space-between; gap: 12px; align-items: start; margin-bottom: 12px; }
.ai-card h3 { font-size: 15px; margin: 0 0 3px; font-weight: 600; }
.ai-card header p { font-size: 12px; color: var(--zp-secondary); margin: 0; }
.state-badge { flex: none; padding: 3px 8px; border-radius: 20px; background: var(--zp-secondary-background); color: var(--zp-secondary); font-size: 11px; }
.state-badge.ready { background: var(--primary-color-1); color: var(--primary-color); }
.card-layout { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 18px; }
.model-controls { min-width: 0; }
.field-label { display: block; font-size: 12px; font-weight: 600; margin: 4px 0 7px; }
.variant-row, .provider-row, .path-control, .model-actions, .save-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.variant-row .provider-select { flex: 1; min-width: 180px; }
.provider-select { padding: 6px 8px; border: 1px solid var(--zp-border); border-radius: 6px; background: var(--zp-primary-background); color: inherit; }
.status-line, .compact-help { font-size: 12px; line-height: 1.5; color: var(--zp-secondary); margin: 9px 0; }
.status-ok { color: #237804; }
.status-warn { color: #ad6800; }
.advanced { font-size: 12px; color: var(--zp-secondary); margin: 12px 0; }
.advanced summary { cursor: pointer; }
.path-control { margin: 8px 0; }
.path-control :deep(.ant-input-affix-wrapper), .path-control > .ant-input { flex: 1 1 250px; min-width: 0; }
.model-actions { font-size: 12px; color: var(--zp-secondary); margin-top: 10px; }
.resource-list { padding: 10px 12px; background: var(--zp-secondary-background); border-radius: 7px; align-self: start; color: var(--zp-secondary); }
.resource-list h4 { font-size: 12px; margin: 0 0 8px; color: inherit; }
.resource-list ul { list-style: none; margin: 0; padding: 0; }
.resource-list li { display: flex; flex-direction: column; gap: 2px; font-size: 11px; line-height: 1.35; padding: 6px 0; border-top: 1px solid var(--zp-border); }
.resource-list li strong { font-size: 12px; color: var(--primary-color); }
.resource-list small { display: block; font-size: 10px; line-height: 1.4; margin-top: 6px; }
.provider-row { margin-bottom: 14px; }
.quantization-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.quantization-row .field-label { margin: 0; }
.api-config code { overflow-wrap: anywhere; user-select: text; }
.provider-row .field-label { margin: 0; }
.api-config { width: 100%; min-width: 0; }
.api-config .field-label { margin-top: 12px; }
.api-config a { color: var(--primary-color); }
.workflow-config { margin-top: 12px; padding: 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-surface-soft); }
.workflow-import { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--zp-secondary); overflow-wrap: anywhere; }
.workflow-file-button { position: relative; display: inline-flex; align-items: center; min-height: 34px; padding: 5px 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-sm); background: var(--ui-surface); color: var(--ui-text); cursor: pointer; }
.workflow-file-button:focus-within { outline: 2px solid var(--primary-color); outline-offset: 2px; }
.workflow-file-button.disabled { opacity: .5; cursor: default; }
.workflow-file-button input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.workflow-mapping { display: grid; gap: 10px; }
.workflow-mapping > div { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; }
.workflow-mapping .field-label { width: 100%; margin: 0; }
.workflow-mapping .provider-select { min-width: 0; max-width: 100%; }
.workflow-mapping .provider-select:first-of-type { flex: 1 1 230px; }
.prompt-section { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--zp-border); }
.prompt-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
.prompt-heading h4 { font-size: 13px; margin: 0; }
.prompt-heading p { font-size: 11px; color: var(--zp-secondary); margin: 4px 0 9px; }
.prompt-tabs { display: flex; gap: 5px; }
.prompt-tabs button { border: 1px solid var(--zp-border); background: var(--zp-primary-background); color: inherit; padding: 4px 10px; border-radius: 5px; font-size: 12px; cursor: pointer; }
.prompt-tabs button.active { border-color: var(--primary-color); color: var(--primary-color); background: var(--primary-color-1); }
.prompt-section :deep(textarea) { font-size: 12px; line-height: 1.5; }
.save-actions { margin-top: 14px; }
.ai-settings{gap:16px;}
.ai-card{padding:20px;border-radius:var(--ui-radius);background:var(--ui-surface);}
.ai-card header{align-items:center;padding-bottom:12px;border-bottom:1px solid var(--ui-border);}
.ai-card h3{font-size:14px;letter-spacing:-.01em;}
.provider-select{min-height:34px;padding-inline:10px;border-radius:var(--ui-radius-sm);background:var(--ui-surface-soft);transition:border-color var(--ui-motion-fast) var(--ui-ease),box-shadow var(--ui-motion-fast) var(--ui-ease);}
.provider-select:focus-visible{border-color:var(--primary-color);box-shadow:0 0 0 3px var(--primary-color-1);}
.resource-list{border:1px solid var(--ui-border);border-radius:var(--ui-radius);background:var(--ui-surface-soft);}
.advanced summary{padding:6px 0;color:var(--ui-text);font-weight:500;}
.prompt-tabs button{border-radius:var(--ui-radius-sm);transition:background-color var(--ui-motion-fast) var(--ui-ease),border-color var(--ui-motion-fast) var(--ui-ease);}
.state-badge{font-weight:500;}
@container (max-width: 720px) {
  .card-layout { grid-template-columns: 1fr; }
  .resource-list ul { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .resource-list li { border-top: 0; }
  .ai-card { padding: 14px; }
}
</style>
