<script setup lang="ts">
import SettingsGroup from './SettingsGroup.vue'
import SettingsHelp from './SettingsHelp.vue'
import './settingsControls.css'
import { getErrorMessage } from '@/shared/lib/errorMessage'

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { InputNumber, message } from 'ant-design-vue'
import {
  getQwenModels,
  getQwenStatus,
  installQwenModel,
  saveQwenConfig,
  saveQwenInstructQuantization,
  selectQwenModel,
  startQwenIndex,
  type QwenModelKind,
  type QwenModelManager,
  type QwenModelSize,
  type QwenQuantization,
  type QwenStatus
} from '@/features/ai-workflows/public'
import {
  DEFAULT_IMAGE_DESCRIPTION,
  DEFAULT_IMAGE_PROMPT_EN,
  DEFAULT_IMAGE_TAGS,
  getComfyCloudStatus,
  getComfyRouterModels,
  getGGUFStatus,
  getImageAIConfig,
  getImageAICreationConfig,
  saveImageAIConfig,
  saveImageAICreationConfig,
  type ComfyWorkflow,
  type ComfyRouterModels,
  type ImageAIConfig,
  type ImageAICreationConfig,
  type ImageAITask
} from '@/features/ai-workflows/public'
import { useApplicationStore } from '@/features/application/public'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ openRuntime: [] }>()
const global = useApplicationStore()
const modelStatus = ref<Partial<Record<QwenModelKind, QwenStatus>>>({})
const modelManager = ref<QwenModelManager>()
const modelPath = ref<Record<QwenModelKind, string>>({ embedding: '', reranker: '', instruct: '' })
const selectedSize = ref<Record<QwenModelKind, QwenModelSize>>({
  embedding: '2B',
  reranker: '2B',
  instruct: '2B'
})
const modelSaving = ref<QwenModelKind>()
const quantization = ref<QwenQuantization>('none')
const quantSaving = ref(false)
const modelIndexing = ref(false)
const modelError = ref('')
const modelCards: {
  kind: 'embedding' | 'reranker'
  title: string
  description: string
  note: string
}[] = [
  {
    kind: 'embedding',
    title: '图文检索模型',
    description: '用文字找画面，也用于以图搜图。',
    note: '换模型后需重建图片索引。'
  },
  {
    kind: 'reranker',
    title: '图片重排模型',
    description: '对检索出的图片再次评分，调整结果顺序。',
    note: '目前重排文字搜索的前 20 张候选图。'
  }
]
const resources = [
  { size: '2B', disk: '约 4–5 GB', vram: '建议 8 GB', ram: '建议 16 GB' },
  { size: '8B', disk: '约 16–18 GB', vram: '建议 24 GB', ram: '建议 32 GB' }
]
const content = ref<ImageAIConfig>({
  provider: 'local',
  openrouter_model: 'qwen/qwen3-vl-8b-instruct',
  gguf_base_url: 'http://127.0.0.1:8080/v1',
  gguf_model: '',
  comfy_model: 'vertexai/gemini-3.1-flash-lite',
  comfy_mode: 'router',
  comfy_workflow: null,
  comfy_workflow_name: '',
  comfy_image_node_id: '',
  comfy_image_input: 'image',
  comfy_prompt_node_id: '',
  comfy_prompt_input: 'prompt',
  comfy_output_node_id: '',
  prompts: {
    description: DEFAULT_IMAGE_DESCRIPTION,
    prompt: DEFAULT_IMAGE_PROMPT_EN,
    tags: DEFAULT_IMAGE_TAGS
  },
  api_key_configured: false,
  api_key_source: 'none',
  comfy_api_key_configured: false,
  comfy_api_key_source: 'none'
})
const promptTask = ref<ImageAITask>('description')
const promptTabs: { task: ImageAITask; label: string; hint: string }[] = [
  { task: 'description', label: '描述', hint: '{max_chars} 是预览中选择的长度' },
  { task: 'prompt', label: '提示词反推', hint: '{max_chars} 当前为 600' },
  { task: 'tags', label: '标签推荐', hint: '{allowed_tags} 是已有自定义标签' }
]
const contentLoaded = ref(false)
const apiKeyDraft = ref('')
const comfyKeyDraft = ref('')
const contentSaving = ref(false)
const contentError = ref('')
const contentBaseline = ref('')
const creation = ref<ImageAICreationConfig>({
  mode: 'workflow',
  model: 'vertexai/gemini-3.1-flash-image',
  concurrency: 2,
  comfy_api_key_configured: false,
  comfy_api_key_source: 'none'
})
const creationLoaded = ref(false)
const concurrencyDraft = ref<number>()
const concurrencyValid = computed(
  () =>
    typeof concurrencyDraft.value === 'number' &&
    Number.isInteger(concurrencyDraft.value) &&
    concurrencyDraft.value >= 1 &&
    concurrencyDraft.value <= 15
)
const sharedKeySaving = ref(false),
  sharedKeyError = ref('')
const routerModels = ref<ComfyRouterModels>({ vision: [], creation: [] })
const routerModelsLoading = ref(false),
  routerModelsChecked = ref(false),
  routerModelsError = ref('')
const defaultVisionModels = [
  { id: 'vertexai/gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
  { id: 'vertexai/gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
  { id: 'vertexai/gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
  { id: 'vertexai/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' }
]
const visionChoices = computed(() =>
  routerModelsChecked.value ? routerModels.value.vision : defaultVisionModels
)
const sharedKeyConfigured = computed(
  () => creation.value.comfy_api_key_configured || content.value.comfy_api_key_configured
)
const sharedKeySource = computed(() =>
  creation.value.comfy_api_key_source === 'saved' || content.value.comfy_api_key_source === 'saved'
    ? 'saved'
    : 'none'
)
const contentFingerprint = () =>
  JSON.stringify({
    ...content.value,
    api_key_configured: undefined,
    api_key_source: undefined,
    comfy_api_key_configured: undefined,
    comfy_api_key_source: undefined
  })
const contentDirty = computed(
  () =>
    contentLoaded.value &&
    (contentFingerprint() !== contentBaseline.value || !!apiKeyDraft.value.trim())
)
const ggufStatus = ref<{ ready: boolean; models: string[] }>()
const ggufChecking = ref(false)
const comfyStatus = ref<{ ready: boolean; detail: string }>()
const comfyChecking = ref(false)
const workflowNodes = computed(() =>
  Object.entries(content.value.comfy_workflow || {}).map(([id, node]) => ({
    id,
    label: `${id} · ${node._meta?.title || node.class_type}`
  }))
)
const workflowInputs = (id: string) => Object.keys(content.value.comfy_workflow?.[id]?.inputs || {})
const workflowReady = computed(() => {
  const graph = content.value.comfy_workflow
  return (
    !!graph &&
    !!graph[content.value.comfy_image_node_id] &&
    workflowInputs(content.value.comfy_image_node_id).includes(content.value.comfy_image_input) &&
    !!graph[content.value.comfy_prompt_node_id] &&
    workflowInputs(content.value.comfy_prompt_node_id).includes(content.value.comfy_prompt_input) &&
    !!graph[content.value.comfy_output_node_id]
  )
})
const savedGGUFUrl = ref('')
const contentReady = computed(() =>
  content.value.provider === 'local'
    ? modelStatus.value.instruct?.state === 'ready'
    : content.value.provider === 'local_gguf'
      ? !!ggufStatus.value?.ready && content.value.gguf_base_url.trim() === savedGGUFUrl.value
      : content.value.provider === 'comfy_cloud'
        ? content.value.comfy_api_key_configured &&
          (content.value.comfy_mode === 'router' || workflowReady.value)
        : content.value.api_key_configured
)
const contentStateLabel = computed(() =>
  contentReady.value
    ? content.value.provider === 'openrouter' || content.value.provider === 'comfy_cloud'
      ? 'API 已配置'
      : content.value.provider === 'local_gguf'
        ? '本机已连接'
        : '本地就绪'
    : content.value.provider === 'local_gguf'
      ? '待连接'
      : content.value.provider === 'local'
        ? localModelState('instruct')
        : '待配置'
)
let timer: ReturnType<typeof setTimeout> | undefined
let refreshQueue: Promise<void> = Promise.resolve()
let pendingRefreshes = 0
let activePage = false
let pollFailures = 0

function schedulePoll() {
  clearTimeout(timer)
  if (
    !activePage ||
    !props.active ||
    document.hidden ||
    pendingRefreshes ||
    !(modelManager.value?.job.running || modelStatus.value.embedding?.running)
  )
    return
  timer = setTimeout(
    () => {
      void refreshModels(false, true)
    },
    Math.min(30000, 2000 * 2 ** pollFailures)
  )
}

function handleVisibilityChange() {
  clearTimeout(timer)
  if (
    !document.hidden &&
    activePage &&
    props.active &&
    !pendingRefreshes &&
    (modelManager.value?.job.running || modelStatus.value.embedding?.running)
  )
    void refreshModels()
}

function modelName(kind: QwenModelKind, size: QwenModelSize) {
  return kind === 'instruct'
    ? `Qwen3-VL-${size}-Instruct`
    : `Qwen3-VL-${kind === 'embedding' ? 'Embedding' : 'Reranker'}-${size}`
}

function choice(kind: QwenModelKind) {
  return modelManager.value?.models[kind]?.find(
    (option) => option.size === selectedSize.value[kind]
  )
}

function localModelState(kind: QwenModelKind) {
  const state = modelStatus.value[kind]?.state
  return state === 'ready' ? '本地就绪' : state === 'missing_dependency' ? '缺少运行依赖' : '待配置'
}

function refreshModels(syncPath = false, poll = false): Promise<void> {
  clearTimeout(timer)
  pendingRefreshes += 1
  const request = refreshQueue
    .then(async () => {
      if (!activePage) return
      try {
        const wasDownloading = modelManager.value?.job.running
        let manager: QwenModelManager | undefined
        let polledEmbedding: QwenStatus | undefined
        // During a long job, only its live state changes. Read all models once it finishes.
        if (poll && wasDownloading) {
          const [latestManager, latestEmbedding] = await Promise.all([
            getQwenModels(),
            modelStatus.value.embedding?.running
              ? getQwenStatus('embedding')
              : Promise.resolve(undefined)
          ])
          manager = latestManager
          polledEmbedding = latestEmbedding
          if (!activePage) return
          if (polledEmbedding)
            modelStatus.value = { ...modelStatus.value, embedding: polledEmbedding }
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
          polledEmbedding ?? getQwenStatus('embedding'),
          getQwenStatus('reranker'),
          getQwenStatus('instruct'),
          manager ?? getQwenModels()
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
      } catch (cause) {
        if (activePage) {
          modelError.value = getErrorMessage(cause, '读取模型状态失败')
          pollFailures = Math.min(4, pollFailures + 1)
        }
      }
    })
    .finally(() => {
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
  } catch (cause) {
    modelError.value = getErrorMessage(cause, '保存模型目录失败')
  } finally {
    modelSaving.value = undefined
  }
}

async function saveQuantization() {
  if (global.conf?.is_readonly || quantSaving.value) return
  quantSaving.value = true
  try {
    await saveQwenInstructQuantization(quantization.value)
    await refreshModels(true)
    message.success('加载精度已保存；下次推理时生效')
  } catch (cause) {
    modelError.value = getErrorMessage(cause, '保存加载精度失败')
  } finally {
    quantSaving.value = false
  }
}

async function useModel(kind: QwenModelKind) {
  if (global.conf?.is_readonly || modelSaving.value || modelManager.value?.job.running) return
  modelSaving.value = kind
  try {
    await selectQwenModel(kind, selectedSize.value[kind])
    await refreshModels(true)
    message.success('已切换模型')
  } catch (cause) {
    modelError.value = getErrorMessage(cause, '切换模型失败')
  } finally {
    modelSaving.value = undefined
  }
}

async function downloadModel(kind: QwenModelKind) {
  if (global.conf?.is_readonly || modelManager.value?.job.running) return
  try {
    modelManager.value = await installQwenModel(kind, selectedSize.value[kind])
    modelError.value = ''
    await refreshModels()
  } catch (cause) {
    modelError.value = getErrorMessage(cause, '启动下载失败')
  }
}

async function buildIndex() {
  if (global.conf?.is_readonly || modelIndexing.value) return
  modelIndexing.value = true
  try {
    await startQwenIndex()
    await refreshModels()
  } catch (cause) {
    modelError.value = getErrorMessage(cause, '启动图片索引失败')
  } finally {
    modelIndexing.value = false
  }
}

async function refreshContent() {
  try {
    const config = await getImageAIConfig()
    content.value = { ...config, prompts: { ...config.prompts } }
    contentBaseline.value = contentFingerprint()
    savedGGUFUrl.value = config.gguf_base_url
    apiKeyDraft.value = ''
    comfyKeyDraft.value = ''
    contentLoaded.value = true
    contentError.value = ''
    if (config.provider === 'local_gguf') void checkGGUF()
    if (config.provider === 'comfy_cloud') void checkComfy()
  } catch (cause) {
    contentError.value = getErrorMessage(cause, '读取内容处理配置失败')
  }
}

async function refreshCreation() {
  try {
    creation.value = await getImageAICreationConfig()
    concurrencyDraft.value = creation.value.concurrency
    creationLoaded.value = true
    sharedKeyError.value = ''
  } catch (cause) {
    sharedKeyError.value = getErrorMessage(cause, '读取 Comfy 连接配置失败')
  }
}

async function saveConcurrency() {
  const concurrency = concurrencyDraft.value
  if (typeof concurrency !== 'number') return
  if (
    global.conf?.is_readonly ||
    sharedKeySaving.value ||
    !creationLoaded.value ||
    !concurrencyValid.value
  )
    return
  sharedKeySaving.value = true
  sharedKeyError.value = ''
  try {
    creation.value = await saveImageAICreationConfig({
      mode: creation.value.mode,
      model: creation.value.model,
      concurrency
    })
    message.success('后台加工并发数已保存')
  } catch (error) {
    sharedKeyError.value = error instanceof Error ? error.message : '保存并发数失败'
  } finally {
    sharedKeySaving.value = false
  }
}
async function saveComfyKey(clear = false) {
  if (
    global.conf?.is_readonly ||
    sharedKeySaving.value ||
    !creationLoaded.value ||
    (!clear && !comfyKeyDraft.value.trim())
  )
    return
  sharedKeySaving.value = true
  sharedKeyError.value = ''
  try {
    const saved = await saveImageAICreationConfig({
      mode: creation.value.mode,
      model: creation.value.model,
      ...(clear ? { clear_comfy_api_key: true } : { comfy_api_key: comfyKeyDraft.value.trim() })
    })
    comfyKeyDraft.value = ''
    creation.value = saved
    content.value.comfy_api_key_configured = saved.comfy_api_key_configured
    content.value.comfy_api_key_source = saved.comfy_api_key_source
    comfyStatus.value = undefined
    routerModelsChecked.value = false
    routerModels.value = { vision: [], creation: [] }
    routerModelsError.value = ''
    message.success(clear ? '已清除共用的 Comfy API Key' : '共用 Comfy API Key 已保存')
  } catch (cause) {
    sharedKeyError.value = getErrorMessage(cause, '保存 Comfy API Key 失败')
  } finally {
    sharedKeySaving.value = false
  }
}

async function refreshRouterModels() {
  if (routerModelsLoading.value) return
  routerModelsLoading.value = true
  routerModelsError.value = ''
  try {
    routerModels.value = await getComfyRouterModels()
    routerModelsChecked.value = true
  } catch (cause) {
    routerModelsChecked.value = false
    routerModelsError.value = getErrorMessage(cause, '无法查询 Comfy Router 模型')
  } finally {
    routerModelsLoading.value = false
  }
}

async function checkGGUF() {
  ggufChecking.value = true
  try {
    ggufStatus.value = await getGGUFStatus()
  } catch {
    ggufStatus.value = { ready: false, models: [] }
  } finally {
    ggufChecking.value = false
  }
}

async function checkComfy() {
  comfyChecking.value = true
  try {
    comfyStatus.value = await getComfyCloudStatus()
  } catch {
    comfyStatus.value = { ready: false, detail: '无法验证已保存的 Comfy API Key' }
  } finally {
    comfyChecking.value = false
  }
}

async function importComfyWorkflow(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 1_000_000) {
    contentError.value = '工作流 JSON 不能超过 1 MB'
    return
  }
  try {
    const graph = JSON.parse(await file.text()) as ComfyWorkflow
    const nodes = Object.entries(graph)
    if (
      !graph ||
      Array.isArray(graph) ||
      nodes.length === 0 ||
      nodes.length > 256 ||
      ('nodes' in graph && 'links' in graph) ||
      nodes.some(
        ([, node]) =>
          !node ||
          typeof node.class_type !== 'string' ||
          !node.inputs ||
          typeof node.inputs !== 'object' ||
          Array.isArray(node.inputs)
      )
    ) {
      throw new Error('请从 ComfyUI 导出 API 格式 JSON，界面格式不能运行')
    }
    const image =
      nodes.find(([, node]) => node.class_type === 'LoadImage' && 'image' in node.inputs) ||
      nodes.find(([, node]) => 'image' in node.inputs && typeof node.inputs.image === 'string')
    const prompt =
      nodes.find(([, node]) => 'prompt' in node.inputs && typeof node.inputs.prompt === 'string') ||
      nodes.find(([, node]) => 'text' in node.inputs && typeof node.inputs.text === 'string')
    const output =
      nodes.find(([, node]) => /SaveText|TextOutput|PreviewText/i.test(node.class_type)) ||
      nodes.find(([, node]) => /save|output/i.test(node.class_type))
    content.value.comfy_workflow = graph
    content.value.comfy_workflow_name = file.name
    content.value.comfy_image_node_id = image?.[0] || ''
    content.value.comfy_image_input = image
      ? 'image' in image[1].inputs
        ? 'image'
        : Object.keys(image[1].inputs)[0] || ''
      : ''
    content.value.comfy_prompt_node_id = prompt?.[0] || ''
    content.value.comfy_prompt_input = prompt
      ? 'prompt' in prompt[1].inputs
        ? 'prompt'
        : 'text'
      : ''
    content.value.comfy_output_node_id = output?.[0] || ''
    contentError.value = ''
    message.success(`已导入 ${nodes.length} 个节点，请确认输入和输出映射`)
  } catch (cause) {
    contentError.value = getErrorMessage(cause, '无法读取工作流 JSON')
  }
}

async function saveContent(clearKey?: 'openrouter') {
  if (global.conf?.is_readonly || contentSaving.value) return
  contentSaving.value = true
  contentError.value = ''
  try {
    const saved = await saveImageAIConfig({
      provider: content.value.provider,
      openrouter_model: content.value.openrouter_model.trim(),
      gguf_base_url: content.value.gguf_base_url.trim(),
      gguf_model: content.value.gguf_model.trim(),
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
      ...(clearKey === 'openrouter'
        ? { clear_api_key: true }
        : content.value.provider === 'openrouter' && apiKeyDraft.value.trim()
          ? { api_key: apiKeyDraft.value.trim() }
          : {})
    })
    content.value = { ...saved, prompts: { ...saved.prompts } }
    contentBaseline.value = contentFingerprint()
    savedGGUFUrl.value = saved.gguf_base_url
    apiKeyDraft.value = ''
    message.success(clearKey ? '已清除保存的 API Key' : '配置已保存')
    if (saved.provider === 'local_gguf') void checkGGUF()
    if (saved.provider === 'comfy_cloud') void checkComfy()
  } catch (cause) {
    contentError.value = getErrorMessage(cause, '保存配置失败')
  } finally {
    contentSaving.value = false
  }
}

function resetPrompts() {
  content.value.prompts = {
    description: DEFAULT_IMAGE_DESCRIPTION,
    prompt: DEFAULT_IMAGE_PROMPT_EN,
    tags: DEFAULT_IMAGE_TAGS
  }
}

onMounted(() => {
  activePage = true
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (props.active) {
    void refreshModels(true)
    void refreshContent()
    void refreshCreation()
  }
})
watch(
  () => props.active,
  (active) => {
    clearTimeout(timer)
    if (!active || !activePage) return
    void refreshModels(true)
    if (!contentLoaded.value) void refreshContent()
    if (!creationLoaded.value) void refreshCreation()
  }
)
onUnmounted(() => {
  activePage = false
  clearTimeout(timer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="ai-settings settings-stack">
    <SettingsGroup v-for="card in modelCards" :key="card.kind" :title="card.title" class="ai-card">
      <template #extra>
        <SettingsHelp :label="card.title">
          <p>{{ card.description }} {{ card.note }}</p>
          <p v-for="item in resources" :key="item.size">
            {{ item.size }}：磁盘 {{ item.disk }} · 显存 {{ item.vram }} · 内存 {{ item.ram }}
          </p>
          <p>资源为估算值，模型按需加载。</p>
        </SettingsHelp>
      </template>
      <template #actions
        ><span class="state-badge" :class="{ ready: modelStatus[card.kind]?.state === 'ready' }">{{
          localModelState(card.kind)
        }}</span></template
      >
      <div class="card-layout">
        <div class="model-controls">
          <label class="field-label" :for="`model-${card.kind}`">Qwen3-VL 型号</label>
          <div class="variant-row">
            <a-select
              :id="`model-${card.kind}`"
              v-model:value="selectedSize[card.kind]"
              class="provider-select"
              :disabled="!!modelManager?.job.running"
            >
              <a-select-option value="2B">{{ modelName(card.kind, '2B') }} · 默认</a-select-option>
              <a-select-option value="8B">{{ modelName(card.kind, '8B') }}</a-select-option>
            </a-select>
            <a-button
              v-if="choice(card.kind)?.installed"
              :loading="modelSaving === card.kind"
              :disabled="
                !!global.conf?.is_readonly ||
                choice(card.kind)?.active ||
                !!modelManager?.job.running
              "
              @click="useModel(card.kind)"
              >{{ choice(card.kind)?.active ? '已选中' : '选择模型' }}</a-button
            >
            <a-button
              v-else
              type="primary"
              :disabled="!!global.conf?.is_readonly || !!modelManager?.job.running"
              @click="downloadModel(card.kind)"
              >下载模型</a-button
            >
          </div>
          <p
            class="status-line"
            :class="modelStatus[card.kind]?.state === 'ready' ? 'status-ok' : 'status-warn'"
          >
            {{
              modelStatus[card.kind]?.state === 'ready'
                ? `当前：${modelStatus[card.kind]?.model?.replace('Qwen/', '')}`
                : modelStatus[card.kind]?.detail || '正在读取模型状态…'
            }}
          </p>
          <a-button
            v-if="modelStatus[card.kind]?.state === 'missing_dependency'"
            @click="emit('openRuntime')"
            >前往运行环境</a-button
          >
          <p
            v-if="modelManager?.job.kind === card.kind && modelManager.job.running"
            class="status-line"
          >
            {{ modelManager.job.stage }}
          </p>
          <p
            v-if="modelManager?.job.kind === card.kind && modelManager.job.error"
            class="status-line status-warn"
          >
            {{ modelManager.job.error }}
          </p>
          <details class="advanced">
            <summary>使用已有模型目录</summary>
            <div class="path-control">
              <a-input
                v-model:value="modelPath[card.kind]"
                :disabled="!!modelSaving || !!global.conf?.is_readonly"
                placeholder="后端可访问的完整目录"
              /><a-button
                :loading="modelSaving === card.kind"
                :disabled="
                  !!global.conf?.is_readonly ||
                  !modelPath[card.kind]?.trim() ||
                  modelPath[card.kind].trim() === modelStatus[card.kind]?.model_path
                "
                @click="saveModelPath(card.kind)"
                >保存目录</a-button
              ><a-button
                :disabled="
                  !!global.conf?.is_readonly || modelStatus[card.kind]?.config_source !== 'settings'
                "
                @click="saveModelPath(card.kind, true)"
                >恢复默认</a-button
              >
            </div>
          </details>
          <div class="model-actions">
            <template v-if="card.kind === 'embedding'"
              ><span
                >已索引 {{ modelStatus.embedding?.indexed_count ?? 0 }} /
                {{ modelStatus.embedding?.image_count ?? 0 }} 张</span
              ><a-button
                :loading="modelIndexing || modelStatus.embedding?.running"
                :disabled="modelStatus.embedding?.state !== 'ready' || !!global.conf?.is_readonly"
                @click="buildIndex"
                >更新索引</a-button
              ></template
            >
          </div>
        </div>
      </div>
    </SettingsGroup>
    <a-alert v-if="modelError" type="error" :message="modelError" show-icon />

    <SettingsGroup
      title="Comfy 连接"
      help="API Key 供图片内容处理和工作台 AI 加工共用。密钥不回显，模型运行可能消耗额度。"
      class="ai-card comfy-account"
    >
      <template #actions
        ><span class="state-badge" :class="{ ready: sharedKeyConfigured }">{{
          sharedKeySource === 'saved'
            ? 'Key 已保存'
            : sharedKeyConfigured
              ? '环境变量已配置'
              : '待配置'
        }}</span></template
      >
      <div class="config-field">
        <div class="field-heading">
          <label class="field-label" for="comfy-concurrency">后台加工并发数</label
          ><SettingsHelp label="后台加工并发数"
            >所有工作区共用，范围 1–15，默认 2。降低并发不会中断正在运行的任务。</SettingsHelp
          >
        </div>
        <div class="path-control">
          <div class="concurrency-stepper">
            <a-button
              aria-label="减少并发数"
              :disabled="
                !creationLoaded ||
                sharedKeySaving ||
                !!global.conf?.is_readonly ||
                (concurrencyDraft ?? 2) <= 1
              "
              @click="concurrencyDraft = Math.max(1, (concurrencyDraft ?? 2) - 1)"
              >−</a-button
            >
            <InputNumber
              id="comfy-concurrency"
              v-model:value="concurrencyDraft"
              :min="1"
              :max="15"
              :step="1"
              :precision="0"
              :controls="false"
              :disabled="!creationLoaded || sharedKeySaving || !!global.conf?.is_readonly"
            />
            <a-button
              aria-label="增加并发数"
              :disabled="
                !creationLoaded ||
                sharedKeySaving ||
                !!global.conf?.is_readonly ||
                (concurrencyDraft ?? 2) >= 15
              "
              @click="concurrencyDraft = Math.min(15, (concurrencyDraft ?? 2) + 1)"
              >+</a-button
            >
          </div>
          <a-button
            :loading="sharedKeySaving"
            :disabled="
              !creationLoaded ||
              !concurrencyValid ||
              concurrencyDraft === creation.concurrency ||
              !!global.conf?.is_readonly
            "
            @click="saveConcurrency"
            >保存并发设置</a-button
          >
        </div>
      </div>
      <div class="shared-key-row">
        <div class="config-field">
          <label class="field-label" for="comfy-key">Comfy API Key</label
          ><a-input-password
            id="comfy-key"
            v-model:value="comfyKeyDraft"
            :disabled="sharedKeySaving || !!global.conf?.is_readonly"
            autocomplete="new-password"
            placeholder="留空则保持已保存的 Key"
          />
        </div>
        <a-button
          type="primary"
          :loading="sharedKeySaving"
          :disabled="!creationLoaded || !comfyKeyDraft.trim() || !!global.conf?.is_readonly"
          @click="saveComfyKey()"
          >保存 Key</a-button
        ><a-button
          v-if="sharedKeySource === 'saved'"
          danger
          :disabled="sharedKeySaving || !!global.conf?.is_readonly"
          @click="saveComfyKey(true)"
          >清除</a-button
        >
      </div>
      <div class="connection-actions">
        <a-button :loading="comfyChecking" :disabled="!sharedKeyConfigured" @click="checkComfy"
          >验证连接</a-button
        ><a-button
          :loading="routerModelsLoading"
          :disabled="!sharedKeyConfigured"
          @click="refreshRouterModels"
          >查询可用模型</a-button
        ><span class="connection-status" role="status">{{
          comfyStatus?.detail ||
          (sharedKeyConfigured ? 'Key 已配置，尚未验证连接' : '保存 Key 后可验证连接和查询模型')
        }}</span>
      </div>
      <p
        v-if="routerModelsChecked || routerModelsError"
        class="catalog-status"
        :class="{ error: !!routerModelsError }"
        role="status"
      >
        {{
          routerModelsError ||
          `已查询：${routerModels.vision.length} 个已适配视觉模型 · ${routerModels.creation.length} 个已适配图像模型`
        }}
      </p>
      <p class="compact-help account-help">
        <a
          href="https://platform.comfy.org/profile/api-keys"
          target="_blank"
          rel="noopener noreferrer"
          >管理 API Key</a
        >
        ·
        <a
          href="https://docs.comfy.org/development/cloud/api-reference"
          target="_blank"
          rel="noopener noreferrer"
          >工作流接口</a
        >
      </p>
      <a-alert v-if="sharedKeyError" type="error" :message="sharedKeyError" show-icon />
    </SettingsGroup>

    <SettingsGroup
      title="图片内容处理"
      help="用于生成媒体描述、反推图片提示词和推荐已有标签。"
      class="ai-card"
    >
      <template #actions
        ><span class="state-badge" :class="{ ready: contentReady }">{{
          contentStateLabel
        }}</span></template
      >
      <div class="connection-grid">
        <div class="config-field">
          <label class="field-label" for="image-ai-provider">接入方式</label
          ><a-select
            id="image-ai-provider"
            v-model:value="content.provider"
            class="provider-select"
            :disabled="!contentLoaded || contentSaving || !!global.conf?.is_readonly"
          >
            <a-select-option value="local">本地 Transformers</a-select-option>
            <a-select-option value="local_gguf">本机 GGUF 服务</a-select-option>
            <a-select-option value="comfy_cloud">Comfy Router / Cloud</a-select-option>
            <a-select-option value="openrouter">OpenRouter API</a-select-option>
          </a-select>
        </div>
        <div v-if="content.provider === 'comfy_cloud'" class="config-field">
          <label class="field-label" for="comfy-mode">调用方式</label
          ><a-select
            id="comfy-mode"
            v-model:value="content.comfy_mode"
            class="provider-select"
            :disabled="contentSaving || !!global.conf?.is_readonly"
          >
            <a-select-option value="router">直接调用视觉模型</a-select-option>
            <a-select-option value="workflow">运行自定义 JSON 工作流</a-select-option>
          </a-select>
        </div>
        <div
          v-if="content.provider === 'comfy_cloud' && content.comfy_mode === 'router'"
          class="config-field"
        >
          <div class="field-heading">
            <label class="field-label" for="comfy-model">视觉模型</label
            ><SettingsHelp label="视觉模型">在“Comfy 连接”中查询可用模型后选择。</SettingsHelp>
          </div>
          <a-select
            id="comfy-model"
            v-model:value="content.comfy_model"
            class="provider-select"
            :disabled="contentSaving || !!global.conf?.is_readonly"
          >
            <a-select-option
              v-if="!visionChoices.some((item) => item.id === content.comfy_model)"
              :value="content.comfy_model"
            >
              {{ content.comfy_model }} · 未列入当前可用列表
            </a-select-option>
            <a-select-option v-for="item in visionChoices" :key="item.id" :value="item.id">
              {{ item.label }}
            </a-select-option>
          </a-select>
        </div>
      </div>
      <div v-if="content.provider === 'local'" class="card-layout">
        <div class="model-controls">
          <label class="field-label" for="model-instruct">Qwen3-VL 型号</label>
          <div class="variant-row">
            <a-select
              id="model-instruct"
              v-model:value="selectedSize.instruct"
              class="provider-select"
              :disabled="!!modelManager?.job.running"
            >
              <a-select-option value="2B">{{ modelName('instruct', '2B') }} · 默认</a-select-option>
              <a-select-option value="8B">{{
                modelName('instruct', '8B')
              }}</a-select-option></a-select
            ><a-button
              v-if="choice('instruct')?.installed"
              :loading="modelSaving === 'instruct'"
              :disabled="
                !!global.conf?.is_readonly ||
                choice('instruct')?.active ||
                !!modelManager?.job.running
              "
              @click="useModel('instruct')"
              >{{ choice('instruct')?.active ? '已选中' : '选择模型' }}</a-button
            ><a-button
              v-else
              type="primary"
              :disabled="!!global.conf?.is_readonly || !!modelManager?.job.running"
              @click="downloadModel('instruct')"
              >下载模型</a-button
            >
          </div>
          <p
            class="status-line"
            :class="modelStatus.instruct?.state === 'ready' ? 'status-ok' : 'status-warn'"
          >
            {{
              modelStatus.instruct?.state === 'ready'
                ? `当前：${modelStatus.instruct?.model?.replace('Qwen/', '')}`
                : modelStatus.instruct?.detail || '正在读取模型状态…'
            }}
          </p>
          <a-button
            v-if="modelStatus.instruct?.state === 'missing_dependency'"
            @click="emit('openRuntime')"
            >前往运行环境</a-button
          >
          <p
            v-if="modelManager?.job.kind === 'instruct' && modelManager.job.running"
            class="status-line"
          >
            {{ modelManager.job.stage }}
          </p>
          <p
            v-if="modelManager?.job.kind === 'instruct' && modelManager.job.error"
            class="status-line status-warn"
          >
            {{ modelManager.job.error }}
          </p>
          <div class="quantization-row">
            <div class="field-heading">
              <label class="field-label" for="instruct-quantization">加载精度</label
              ><SettingsHelp label="加载精度"
                >4/8 位量化可降低显存占用，模型下载大小不变。需要可用的 bitsandbytes 和
                accelerate，实际支持取决于设备。</SettingsHelp
              >
            </div>
            <a-select
              id="instruct-quantization"
              v-model:value="quantization"
              class="provider-select"
              :disabled="quantSaving || !!global.conf?.is_readonly"
            >
              <a-select-option value="none">原始精度</a-select-option>
              <a-select-option value="int8">8 位 · bitsandbytes</a-select-option>
              <a-select-option value="nf4">4 位 NF4 · bitsandbytes</a-select-option></a-select
            ><a-button
              :loading="quantSaving"
              :disabled="
                !!global.conf?.is_readonly || quantization === modelStatus.instruct?.quantization
              "
              @click="saveQuantization"
              >应用</a-button
            >
          </div>
          <details class="advanced">
            <summary>使用已有模型目录</summary>
            <div class="path-control">
              <a-input
                v-model:value="modelPath.instruct"
                :disabled="!!modelSaving || !!global.conf?.is_readonly"
                placeholder="后端可访问的完整目录"
              /><a-button
                :loading="modelSaving === 'instruct'"
                :disabled="
                  !!global.conf?.is_readonly ||
                  !modelPath.instruct.trim() ||
                  modelPath.instruct.trim() === modelStatus.instruct?.model_path
                "
                @click="saveModelPath('instruct')"
                >保存目录</a-button
              ><a-button
                :disabled="
                  !!global.conf?.is_readonly || modelStatus.instruct?.config_source !== 'settings'
                "
                @click="saveModelPath('instruct', true)"
                >恢复默认</a-button
              >
            </div>
          </details>
        </div>
      </div>
      <div v-else-if="content.provider === 'local_gguf'" class="api-config">
        <div class="field-heading">
          <label class="field-label" for="gguf-base-url">本机服务地址</label
          ><SettingsHelp label="本机 GGUF 服务"
            >使用文件服务所在机器的 llama.cpp OpenAI 兼容服务。视觉模型需同时加载
            mmproj；仅用于内容处理，不替换检索模型。</SettingsHelp
          >
        </div>
        <a-input
          id="gguf-base-url"
          v-model:value="content.gguf_base_url"
          :disabled="contentSaving || !!global.conf?.is_readonly"
          placeholder="http://127.0.0.1:8080/v1"
        />
        <label class="field-label" for="gguf-model">模型 ID（可选）</label
        ><a-input
          id="gguf-model"
          v-model:value="content.gguf_model"
          :disabled="contentSaving || !!global.conf?.is_readonly"
          placeholder="留空使用服务当前模型"
        />
        <div class="model-actions">
          <a-button :loading="ggufChecking" @click="checkGGUF">测试已保存的连接</a-button
          ><span>{{
            ggufStatus?.ready
              ? `已连接${ggufStatus.models.length ? ` · ${ggufStatus.models.join('、')}` : ''}`
              : '服务未连接或尚未测试'
          }}</span>
        </div>
        <details class="advanced">
          <summary>GGUF 服务配置示例</summary>
          <p class="compact-help">
            示例：<code
              >llama-server -hf Qwen/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M --host 127.0.0.1 --port
              8080</code
            >。<a
              href="https://huggingface.co/Qwen/Qwen3-VL-2B-Instruct-GGUF"
              target="_blank"
              rel="noopener noreferrer"
              >官方 GGUF 模型</a
            >
            ·
            <a
              href="https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md"
              target="_blank"
              rel="noopener noreferrer"
              >llama.cpp 图像支持说明</a
            >
          </p>
        </details>
      </div>
      <div v-else-if="content.provider === 'comfy_cloud'" class="api-config">
        <div v-if="content.comfy_mode === 'workflow'" class="workflow-config">
          <div class="workflow-import">
            <SettingsHelp label="工作流导入"
              >导入 ComfyUI API 格式
              JSON。图片输入需可替换文件名，提示词输入需为文本字段，结果节点需保存文本文件。导入后检查节点映射。</SettingsHelp
            >
            <label
              class="workflow-file-button"
              :class="{ disabled: contentSaving || !!global.conf?.is_readonly }"
              >导入 API 格式 JSON<input
                type="file"
                aria-label="导入 ComfyUI API 格式 JSON 工作流"
                accept=".json,application/json"
                :disabled="contentSaving || !!global.conf?.is_readonly"
                @change="importComfyWorkflow" /></label
            ><span
              >{{ content.comfy_workflow_name || '尚未导入工作流'
              }}<template v-if="content.comfy_workflow">
                · {{ workflowNodes.length }} 个节点</template
              ></span
            >
          </div>
          <div v-if="content.comfy_workflow" class="workflow-mapping">
            <div>
              <label class="field-label" for="comfy-image-node">图片输入节点</label
              ><a-select
                id="comfy-image-node"
                v-model:value="content.comfy_image_node_id"
                class="provider-select"
              >
                <a-select-option value="">选择节点</a-select-option>
                <a-select-option v-for="node in workflowNodes" :key="node.id" :value="node.id">
                  {{ node.label }}
                </a-select-option></a-select
              ><a-select
                v-model:value="content.comfy_image_input"
                class="provider-select"
                aria-label="图片输入字段"
              >
                <a-select-option
                  v-for="name in workflowInputs(content.comfy_image_node_id)"
                  :key="name"
                  :value="name"
                >
                  {{ name }}
                </a-select-option>
              </a-select>
            </div>
            <div>
              <label class="field-label" for="comfy-prompt-node">提示词输入节点</label
              ><a-select
                id="comfy-prompt-node"
                v-model:value="content.comfy_prompt_node_id"
                class="provider-select"
              >
                <a-select-option value="">选择节点</a-select-option>
                <a-select-option v-for="node in workflowNodes" :key="node.id" :value="node.id">
                  {{ node.label }}
                </a-select-option></a-select
              ><a-select
                v-model:value="content.comfy_prompt_input"
                class="provider-select"
                aria-label="提示词输入字段"
              >
                <a-select-option
                  v-for="name in workflowInputs(content.comfy_prompt_node_id)"
                  :key="name"
                  :value="name"
                >
                  {{ name }}
                </a-select-option>
              </a-select>
            </div>
            <div>
              <label class="field-label" for="comfy-output-node">文本文件结果节点</label
              ><a-select
                id="comfy-output-node"
                v-model:value="content.comfy_output_node_id"
                class="provider-select"
              >
                <a-select-option value="">选择节点</a-select-option>
                <a-select-option v-for="node in workflowNodes" :key="node.id" :value="node.id">
                  {{ node.label }}
                </a-select-option>
              </a-select>
            </div>
          </div>
          <p v-if="content.comfy_workflow && !workflowReady" class="status-line status-warn">
            请完成图片、提示词和文本输出的节点映射。
          </p>
        </div>
      </div>
      <div v-else class="api-config">
        <p class="compact-help">生成时会将缩放后的图片发送给 OpenRouter。</p>
        <label class="field-label" for="openrouter-model">OpenRouter 模型 ID</label
        ><a-input
          id="openrouter-model"
          v-model:value="content.openrouter_model"
          :disabled="contentSaving || !!global.conf?.is_readonly"
          placeholder="qwen/qwen3-vl-8b-instruct"
        /><label class="field-label" for="openrouter-key">API Key</label>
        <div class="path-control">
          <a-input-password
            id="openrouter-key"
            v-model:value="apiKeyDraft"
            :disabled="contentSaving || !!global.conf?.is_readonly"
            autocomplete="new-password"
            placeholder="留空则保持现有 Key"
          /><a-button
            v-if="content.api_key_source === 'saved'"
            :disabled="contentSaving || !!global.conf?.is_readonly"
            @click="saveContent('openrouter')"
            >清除 Key</a-button
          >
        </div>
        <p class="compact-help">
          {{
            content.api_key_configured
              ? 'API Key 已配置，页面不回显。'
              : '未配置 Key；也可设置后端环境变量 OPENROUTER_API_KEY。'
          }}
          <a
            href="https://openrouter.ai/models?input_modalities=image%2Ctext"
            target="_blank"
            rel="noopener noreferrer"
            >查看视觉模型</a
          >
        </p>
      </div>

      <details class="prompt-section">
        <summary>默认系统提示词 <span>描述 · 反推 · 标签</span></summary>
        <div class="prompt-heading">
          <SettingsHelp label="默认系统提示词"
            >适用于当前接入方式。预览中可临时修改反推指令。</SettingsHelp
          >
          <a-button :disabled="contentSaving || !!global.conf?.is_readonly" @click="resetPrompts"
            >恢复预设</a-button
          >
        </div>
        <div class="prompt-tabs" role="tablist" aria-label="系统提示词任务">
          <button
            v-for="tab in promptTabs"
            :key="tab.task"
            type="button"
            role="tab"
            :aria-selected="promptTask === tab.task"
            :class="{ active: promptTask === tab.task }"
            @click="promptTask = tab.task"
          >
            {{ tab.label }}
          </button>
        </div>
        <p class="compact-help">{{ promptTabs.find((tab) => tab.task === promptTask)?.hint }}</p>
        <a-textarea
          v-model:value="content.prompts[promptTask]"
          :disabled="contentSaving || !!global.conf?.is_readonly"
          :rows="4"
          :maxlength="2000"
          :aria-label="`默认${promptTabs.find((tab) => tab.task === promptTask)?.label}系统提示词`"
        />
      </details>
      <div class="save-actions">
        <a-button
          type="primary"
          :loading="contentSaving"
          :disabled="
            !contentLoaded ||
            !contentDirty ||
            !!global.conf?.is_readonly ||
            (content.provider === 'openrouter' && !content.openrouter_model.trim()) ||
            (content.provider === 'local_gguf' && !content.gguf_base_url.trim()) ||
            (content.provider === 'comfy_cloud' &&
              content.comfy_mode === 'workflow' &&
              !workflowReady) ||
            !content.prompts.description.trim() ||
            !content.prompts.prompt.trim() ||
            !content.prompts.tags.trim()
          "
          @click="saveContent()"
          >保存内容处理配置</a-button
        ><span class="save-state" role="status">{{
          contentDirty ? '有未保存更改' : '配置已保存'
        }}</span>
      </div>
      <a-alert v-if="contentError" type="error" :message="contentError" show-icon />
    </SettingsGroup>
  </div>
</template>

<style scoped>
.ai-settings {
  width: 100%;
  container-type: inline-size;
}
.ai-card :deep(.settings-group-body) {
  padding: 16px 20px;
}
.state-badge {
  flex: none;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--ui-surface-soft);
  color: var(--zp-secondary);
  font-size: 11px;
}
.state-badge.ready {
  color: var(--primary-color);
  background: var(--primary-color-1);
}
.card-layout,
.model-controls,
.config-field,
.api-config {
  min-width: 0;
}
.field-label {
  display: block;
  color: var(--ui-text);
  font-size: 12px;
  font-weight: 500;
  margin: 0 0 8px;
}
.field-heading {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 6px;
}
.field-heading .field-label {
  margin: 0;
}
.variant-row,
.path-control,
.model-actions,
.save-actions,
.connection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.variant-row .provider-select {
  flex: 1;
  min-width: 180px;
}
.provider-select {
  width: 100%;
  min-width: 0;
}
.status-line,
.compact-help {
  font-size: 12px;
  line-height: 1.7;
  color: var(--zp-secondary);
  margin: 10px 0;
  overflow-wrap: anywhere;
}
.status-ok {
  color: var(--primary-color);
}
.status-warn,
.catalog-status.error {
  color: var(--ui-warning, #a66b1c);
}
.advanced {
  font-size: 12px;
  color: var(--zp-secondary);
  margin: 12px 0;
}
.advanced summary {
  cursor: pointer;
  padding: 4px 0;
  color: var(--ui-text);
}
.path-control {
  margin: 8px 0;
}
.path-control :deep(.ant-input-affix-wrapper),
.path-control > .ant-input {
  flex: 1 1 250px;
  min-width: 0;
}
.concurrency-stepper {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.concurrency-stepper :deep(.ant-input-number) {
  width: 64px;
}
.concurrency-stepper :deep(.ant-input-number-input) {
  text-align: center;
}
.model-actions {
  font-size: 12px;
  color: var(--zp-secondary);
  margin-top: 10px;
}
.quantization-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 12px;
}
.quantization-row .field-heading {
  margin: 0;
}
.quantization-row .provider-select {
  flex: 1;
  min-width: 160px;
}
.api-config code {
  overflow-wrap: anywhere;
  user-select: text;
}
.api-config .field-label {
  margin-top: 12px;
}
.api-config a,
.comfy-account a {
  color: var(--primary-color);
}
.workflow-config {
  margin-top: 12px;
}
.workflow-import {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--zp-secondary);
  overflow-wrap: anywhere;
}
.workflow-file-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 4px 12px;
  border: 1px solid var(--ui-control-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
}
.workflow-file-button:focus-within {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.workflow-file-button.disabled {
  opacity: 0.5;
  cursor: default;
}
.workflow-file-button input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.workflow-mapping {
  display: grid;
  gap: 10px;
  margin-top: 12px;
}
.workflow-mapping > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.workflow-mapping .field-label {
  grid-column: 1/-1;
  margin: 0;
}
.prompt-section {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border);
}
.prompt-section summary {
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.prompt-section summary span {
  color: var(--zp-secondary);
  font-size: 11px;
  font-weight: 400;
  margin-left: 8px;
}
.prompt-section[open] summary {
  margin-bottom: 12px;
}
.prompt-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.prompt-tabs {
  display: flex;
  gap: 5px;
}
.prompt-tabs button {
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
  color: inherit;
  padding: 4px 10px;
  border-radius: var(--ui-radius-sm);
  font-size: 12px;
  cursor: pointer;
}
.prompt-tabs button.active {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: var(--primary-color-1);
}
.prompt-section :deep(textarea) {
  font-size: 12px;
  line-height: 1.7;
}
.save-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border);
}
.save-state,
.connection-status {
  font-size: 12px;
  color: var(--zp-secondary);
}
.connection-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.shared-key-row {
  display: flex;
  align-items: end;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
}
.shared-key-row .config-field {
  flex: 1 1 240px;
}
.connection-actions {
  margin-top: 12px;
}
.catalog-status {
  margin: 10px 0 0;
  color: var(--primary-color);
  font-size: 12px;
}
.account-help {
  margin-bottom: 0;
}
@container (max-width: 650px) {
  .ai-card :deep(.settings-group-body) {
    padding: 16px;
  }
  .connection-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .connection-status {
    flex-basis: 100%;
  }
}
</style>
