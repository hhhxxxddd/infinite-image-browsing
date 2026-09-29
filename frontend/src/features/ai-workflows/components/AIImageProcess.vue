<script setup lang="ts">
import WorkflowParameterInput from './WorkflowParameterInput.vue'
import AIImageResults from './AIImageResults.vue'
import AnnotationExtractionSettings from './AnnotationExtractionSettings.vue'
import { sha256Hex } from '@/shared/lib/sha256'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import { submitWorkspaceTask } from '@/features/workspaces/public'
import {
  saveWorkspaceState,
  workspaceStorage
} from '@/features/workspaces/services/workspaceStorage'
import {
  getComfyRouterModels,
  getImageAICreationConfig,
  listStudioWorkflows,
  studioWorkflowRevision,
  workflowPurpose,
  workflowOutputMappings,
  type ImageAICreationMode,
  type StudioWorkflowSummary
} from '@/features/ai-workflows/api/imageAi'
import {
  studioLayerVisible,
  studioDocumentRevision,
  type StudioDocument,
  type StudioMaskLayer
} from '@/features/image-editor/public'
import {
  extractAnnotationPrompt,
  mergeAnnotationPrompt,
  readAnnotationPromptRules,
  type AnnotationPromptRules
} from '../model/annotationPrompt'
import { assertProductionDraftExists } from '@/features/workspaces/model/workspaceWorks'
import { renderStudioDocument, renderStudioMask } from '@/features/image-editor/public'
import {
  creationChoiceKey,
  defaultCreationModels,
  resizableCreationModels,
  routerAspectRatios
} from '../model/creationOptions'
interface ReferenceInput {
  path: string
  name: string
  doc: StudioDocument
}
const props = defineProps<{
  purpose?: 'image_edit' | 'image_generation'
  productionName?: string
  doc: StudioDocument | null
  assetInfo: Record<string, FileNodeInfo>
  referenceInputs: ReferenceInput[]
  workspaceId?: string
  draftScope?: string
  productionId?: string
  renderError?: string
  revision?: number
  readonly?: boolean
  beforeSubmit: () => boolean | Promise<boolean>
}>()
const generation = computed(() => props.purpose === 'image_generation')
const emit = defineEmits<{ previewResult: [path: string] }>()
const mode = ref<ImageAICreationMode>(generation.value ? 'router' : 'workflow')
const model = ref(defaultCreationModels[1].id)
const models = ref(defaultCreationModels)
const ratios = computed(() => routerAspectRatios(model.value))
const modelError = ref('')
const aspectRatio = ref(generation.value ? '1:1' : 'auto')
const imageSize = ref<'1K' | '2K' | '4K'>('1K')
const workflows = ref<StudioWorkflowSummary[]>([])
const workflowId = ref('')
const workflowError = ref('')
const parameterDraft = ref<Record<string, string | number | boolean>>({})
const prompt = ref('')
const persistenceError = ref('')
const sessionKey = (kind: string) =>
  props.workspaceId
    ? `omnigallery:ai-production-${generation.value ? 'generation-' : ''}${kind}-v1:${props.workspaceId}${props.draftScope ? ':' + props.draftScope : ''}`
    : ''
const choiceKey = computed(() => sessionKey('choice') || creationChoiceKey)
const promptKey = (negative = false) =>
  sessionKey(negative ? 'negative' : 'prompt')
    ? `${sessionKey(negative ? 'negative' : 'prompt')}${generation.value ? '' : ':' + props.doc?.id}`
    : `omnigallery:studio-comfy-${negative ? 'negative-prompt' : 'prompt'}-v1:${props.doc?.id}`
const lastExtractedPrompt = ref('')
const annotationRules = ref(readAnnotationPromptRules(null))
const annotationPrompt = computed(() => extractAnnotationPrompt(props.doc, annotationRules.value))
async function saveAnnotationRules(rules: AnnotationPromptRules): Promise<boolean> {
  if (sending.value || props.readonly) return false
  const previous = annotationRules.value
  annotationRules.value = rules
  if (await persistConfiguration()) return true
  annotationRules.value = previous
  return false
}
const canExtractAnnotations = computed(
  () =>
    !!annotationPrompt.value &&
    (annotationPrompt.value !== lastExtractedPrompt.value || !prompt.value.trim())
)
function extractAnnotations() {
  if (!canExtractAnnotations.value || sending.value || props.readonly) return
  prompt.value = mergeAnnotationPrompt(
    prompt.value,
    lastExtractedPrompt.value,
    annotationPrompt.value
  )
  lastExtractedPrompt.value = annotationPrompt.value
}
const negativePrompt = ref('')
const useMask = ref(true)
const keyConfigured = ref(false)
const sending = ref(false)
const confirming = ref(false)
let disposed = false
let modelRequestStarted = false

const selectedWorkflow = computed(() =>
  workflows.value.find((item) => item.id === workflowId.value)
)
watch(selectedWorkflow, (workflow) => {
  const values: Record<string, string | number | boolean> = {}
  for (const parameter of workflow?.parameters ?? []) {
    if (parameter.kind === 'select') {
      values[parameter.id] = -1
      continue
    }
    const original = workflow?.parameter_defaults?.[parameter.id]?.[0]
    values[parameter.id] =
      typeof original === 'boolean' || typeof original === 'number' || typeof original === 'string'
        ? original
        : parameter.kind === 'number'
          ? 0
          : parameter.kind === 'boolean'
            ? false
            : ''
  }
  parameterDraft.value = values
  const key = sessionKey('parameters')
  if (key && workflow) {
    try {
      const saved = JSON.parse(
        props.workspaceId ? workspaceStorage(props.workspaceId).getItem(key) || 'null' : 'null'
      )
      if (saved?.workflowId === workflow.id && saved.values && typeof saved.values === 'object')
        for (const id of Object.keys(values))
          if (typeof saved.values[id] === typeof values[id]) values[id] = saved.values[id]
    } catch {
      /* Keep workflow defaults. */
    }
  }
})
const parametersValid = computed(() =>
  (selectedWorkflow.value?.parameters ?? []).every((parameter) => {
    const value = parameterDraft.value[parameter.id]
    if (parameter.kind === 'select')
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= -1 &&
        value < parameter.options.length
      )
    if (parameter.kind === 'boolean') return typeof value === 'boolean'
    if (parameter.kind === 'text') return typeof value === 'string'
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (parameter.minimum === null || value >= parameter.minimum) &&
      (parameter.maximum === null || value <= parameter.maximum)
    )
  })
)
function parameterValues() {
  const values: Record<string, string | number | boolean> = {}
  for (const parameter of selectedWorkflow.value?.parameters ?? []) {
    const value = parameterDraft.value[parameter.id]
    if (parameter.kind === 'select') {
      if (typeof value === 'number' && value >= 0) values[parameter.id] = value
    } else if (value !== selectedWorkflow.value?.parameter_defaults?.[parameter.id]?.[0])
      values[parameter.id] = value
  }
  return values
}
const maskLayers = computed(() => {
  const doc = props.doc
  return (
    doc?.layers.filter(
      (layer): layer is StudioMaskLayer => layer.kind === 'mask' && studioLayerVisible(doc, layer)
    ) ?? []
  )
})
const hasMask = computed(
  () =>
    useMask.value &&
    maskLayers.value.some((layer) => layer.strokes.some((stroke) => stroke.mode === 'paint'))
)
const workflowUsesMask = computed(
  () =>
    selectedWorkflow.value?.mask_enabled !== false &&
    !!(selectedWorkflow.value?.mask_node_id || selectedWorkflow.value?.mask_from_image)
)
const maxReferences = computed(() =>
  mode.value === 'workflow'
    ? ((hasMask.value && workflowUsesMask.value
        ? selectedWorkflow.value?.mask_reference_limit
        : selectedWorkflow.value?.reference_slots.length) ?? 0)
    : model.value === 'vertexai/gemini-2.5-flash-image'
      ? 2
      : 13
)
const usedReferences = computed(() => Math.min(props.referenceInputs.length, maxReferences.value))
const effectiveSize = (source: StudioDocument) => {
  const ratio = Math.min(1, 2048 / Math.max(source.width, source.height))
  return `${Math.round(source.width * ratio)} × ${Math.round(source.height * ratio)}`
}
const inputSize = computed(() => (props.doc ? effectiveSize(props.doc) : ''))
const canSubmit = computed(
  () =>
    (generation.value || !!props.doc) &&
    !!props.workspaceId &&
    !props.readonly &&
    !props.renderError &&
    keyConfigured.value &&
    !sending.value &&
    !confirming.value &&
    (mode.value === 'router'
      ? !!model.value && !!prompt.value.trim()
      : (generation.value
          ? !!selectedWorkflow.value?.prompt_node_id
          : !!selectedWorkflow.value?.image_node_id) &&
        !!workflowOutputMappings(selectedWorkflow.value).length &&
        parametersValid.value &&
        (!selectedWorkflow.value?.prompt_node_id || !!prompt.value.trim()))
)

function rememberChoice() {
  if (aspectRatio.value !== 'auto' && !ratios.value.includes(aspectRatio.value))
    aspectRatio.value = 'auto'
  scheduleConfigurationSave()
  if (mode.value === 'router') void loadModels()
}
function switchMode(next: ImageAICreationMode) {
  if (sending.value || props.readonly || mode.value === next) return
  mode.value = next
  rememberChoice()
}
async function loadModels() {
  if (modelRequestStarted || !keyConfigured.value) return
  modelRequestStarted = true
  try {
    const catalog = await getComfyRouterModels()
    if (disposed) return
    models.value = catalog.creation
    if (!models.value.some((item) => item.id === model.value))
      model.value = models.value[0]?.id || ''
  } catch {
    if (!disposed) modelError.value = '暂时无法更新模型列表，仍可选择已适配模型。'
  }
}
let workflowRequest = 0
async function refreshWorkflows() {
  const request = ++workflowRequest
  try {
    const library = await listStudioWorkflows()
    if (disposed || request !== workflowRequest) return
    workflows.value = library.filter(
      (item) => workflowPurpose(item) === (generation.value ? 'image_generation' : 'image_edit')
    )
    if (!workflows.value.some((item) => item.id === workflowId.value))
      workflowId.value = workflows.value[0]?.id ?? ''
    workflowError.value = ''
  } catch {
    if (!disposed && request === workflowRequest) workflowError.value = '工作流列表暂时无法读取'
  }
}
watch(studioWorkflowRevision, refreshWorkflows)
onMounted(async () => {
  try {
    const saved = JSON.parse(
      (props.workspaceId ? workspaceStorage(props.workspaceId).getItem(choiceKey.value) : null) ??
        (generation.value ? null : localStorage.getItem(creationChoiceKey)) ??
        'null'
    ) as Record<string, unknown> | null
    if (saved?.mode === 'router' || saved?.mode === 'workflow') mode.value = saved.mode
    if (typeof saved?.model === 'string') model.value = saved.model
    if (typeof saved?.workflowId === 'string') workflowId.value = saved.workflowId
    if (typeof saved?.aspectRatio === 'string') aspectRatio.value = saved.aspectRatio
    if (typeof saved?.useMask === 'boolean') useMask.value = saved.useMask
    annotationRules.value = readAnnotationPromptRules(saved?.annotationRules)
    if (saved?.imageSize === '1K' || saved?.imageSize === '2K' || saved?.imageSize === '4K')
      imageSize.value = saved.imageSize
  } catch {
    /* Use the defaults. */
  }
  await Promise.allSettled([
    getImageAICreationConfig().then((config) => {
      if (disposed) return
      keyConfigured.value = config.comfy_api_key_configured
      if (mode.value === 'router') void loadModels()
    }),
    refreshWorkflows()
  ])
})
onBeforeUnmount(() => {
  disposed = true
  if (configurationTimer) clearTimeout(configurationTimer)
  void persistConfiguration()
})
watch(
  () => props.doc?.id,
  () => {
    lastExtractedPrompt.value = ''
    try {
      const storage = props.workspaceId ? workspaceStorage(props.workspaceId) : undefined
      prompt.value = props.doc || generation.value ? storage?.getItem(promptKey()) || '' : ''
      negativePrompt.value =
        props.doc || generation.value ? storage?.getItem(promptKey(true)) || '' : ''
    } catch {
      prompt.value = ''
      negativePrompt.value = ''
    }
  },
  { immediate: true }
)
function draftStateEntries(): Record<string, string> {
  if (!props.workspaceId) return {}
  const entries: Record<string, string> = {
    [choiceKey.value]: JSON.stringify({
      mode: mode.value,
      model: model.value,
      aspectRatio: aspectRatio.value,
      imageSize: imageSize.value,
      useMask: useMask.value,
      workflowId: workflowId.value,
      annotationRules: annotationRules.value
    })
  }
  if (selectedWorkflow.value)
    entries[sessionKey('parameters')] = JSON.stringify({
      workflowId: selectedWorkflow.value.id,
      values: parameterDraft.value
    })
  if (props.doc || generation.value) {
    entries[promptKey()] = prompt.value
    entries[promptKey(true)] = negativePrompt.value
  }
  return entries
}
let configurationTimer: ReturnType<typeof setTimeout> | undefined
async function persistConfiguration(): Promise<boolean> {
  if (configurationTimer) clearTimeout(configurationTimer)
  configurationTimer = undefined
  const workspaceId = props.workspaceId,
    productionId = props.productionId,
    entries = draftStateEntries()
  if (!workspaceId || props.readonly) return true
  try {
    await saveWorkspaceState(workspaceId, (storage) => {
      if (productionId) assertProductionDraftExists(storage, workspaceId, productionId)
      for (const [key, value] of Object.entries(entries)) storage.setItem(key, value)
    })
    persistenceError.value = ''
    return true
  } catch (error) {
    persistenceError.value = error instanceof Error ? error.message : '加工配置尚未保存，请重试'
    return false
  }
}
function scheduleConfigurationSave() {
  if (configurationTimer) clearTimeout(configurationTimer)
  if (!props.readonly)
    configurationTimer = setTimeout(() => {
      void persistConfiguration()
    }, 250)
}
watch(
  [
    mode,
    model,
    aspectRatio,
    imageSize,
    useMask,
    workflowId,
    parameterDraft,
    prompt,
    negativePrompt
  ],
  scheduleConfigurationSave,
  { deep: true }
)
function usePrompt(value: string, append = false) {
  if (props.readonly || sending.value || !value.trim()) return
  prompt.value = (
    append && prompt.value.trim() ? prompt.value.trim() + '\n' + value.trim() : value.trim()
  ).slice(0, 8000)
}
defineExpose({ draftStateEntries, persistConfiguration, usePrompt })

async function requestSubmit() {
  if (!canSubmit.value) return
  const source = props.doc,
    workspaceId = props.workspaceId
  confirming.value = true
  try {
    const approved = (await persistConfiguration()) && (await props.beforeSubmit())
    confirming.value = false
    if (approved && !disposed && props.doc === source && props.workspaceId === workspaceId)
      await submit()
  } finally {
    confirming.value = false
  }
}

async function submit() {
  if (!canSubmit.value || !props.workspaceId) return
  const source = props.doc ? (JSON.parse(JSON.stringify(props.doc)) as StudioDocument) : null
  const referenceSources = props.referenceInputs.slice(0, usedReferences.value).map((item) => ({
    name: item.name,
    doc: JSON.parse(JSON.stringify(item.doc)) as StudioDocument
  }))
  const instruction = prompt.value.trim()
  const chosenReferences: string[] = []
  const usesMask = mode.value === 'workflow' && hasMask.value && workflowUsesMask.value
  const workspaceId = props.workspaceId
  const productionId = props.productionId
  const chosenMode = mode.value
  const assetInfo = { ...props.assetInfo }
  const settings =
    chosenMode === 'router'
      ? {
          prompt: instruction,
          model: model.value,
          ...(aspectRatio.value !== 'auto' ? { aspect_ratio: aspectRatio.value } : {}),
          ...(resizableCreationModels.includes(model.value) ? { image_size: imageSize.value } : {})
        }
      : {
          workflow_id: workflowId.value,
          prompt: instruction,
          negative_prompt: negativePrompt.value,
          parameter_values: parameterValues()
        }
  sending.value = true
  try {
    if (generation.value) {
      await submitWorkspaceTask(
        workspaceId,
        props.productionName || 'AI 图片生成',
        chosenMode,
        settings,
        productionId
          ? {
              documentId: productionId,
              documentRevision: sha256Hex(
                JSON.stringify({ purpose: 'image_generation', mode: chosenMode, settings })
              )
            }
          : undefined,
        'image_generation'
      )
      message.success('已提交后台生成，可在素材条和“全部”中查看状态')
      return
    }
    if (!source) return
    const image = document.createElement('canvas')
    const failures = await renderStudioDocument(
      image,
      source,
      assetInfo,
      false,
      { kind: 'all' },
      2048,
      true
    )
    if (failures.length) throw new Error(`无法读取图层：${failures.join('、')}`)
    const imageBase64 = image.toDataURL('image/png').split(',')[1]
    for (const reference of referenceSources) {
      const referenceCanvas = document.createElement('canvas')
      const referenceFailures = await renderStudioDocument(
        referenceCanvas,
        reference.doc,
        assetInfo,
        false,
        { kind: 'all' },
        2048
      )
      if (referenceFailures.length)
        throw new Error(`无法读取参考图：${referenceFailures.join('、')}`)
      chosenReferences.push(referenceCanvas.toDataURL('image/png').split(',')[1])
    }
    const mask = document.createElement('canvas')
    if (usesMask) renderStudioMask(mask, source, undefined, 2048)
    await submitWorkspaceTask(
      workspaceId,
      `${source.name}-AI结果`,
      chosenMode,
      {
        ...settings,
        image_base64: imageBase64,
        reference_images_base64: chosenReferences,
        ...(usesMask ? { mask_base64: mask.toDataURL('image/png').split(',')[1] } : {})
      },
      productionId
        ? { documentId: productionId, documentRevision: studioDocumentRevision(source) }
        : undefined
    )
    message.success('已提交后台加工，可在素材条和“全部”中查看状态')
  } catch (error) {
    const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    message.error(detail || (error instanceof Error ? error.message : 'AI 加工失败'))
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section class="ai-image-process" :aria-label="generation ? 'AI 图片生成设置' : 'AI 加工设置'">
    <header>
      <slot name="task"
        ><strong>{{ generation ? 'AI 图片生成' : 'AI 图片编辑' }}</strong></slot
      >
    </header>
    <p v-if="persistenceError" class="process-note error" role="alert">{{ persistenceError }}</p>
    <div class="process-fields">
      <div class="mode-switch" role="group" aria-label="创作方式">
        <button
          type="button"
          :class="{ active: mode === 'workflow' }"
          :aria-pressed="mode === 'workflow'"
          :disabled="sending || readonly"
          @click="switchMode('workflow')"
        >
          <strong>工作流</strong><small>Comfy Cloud</small>
        </button>
        <button
          type="button"
          :class="{ active: mode === 'router' }"
          :aria-pressed="mode === 'router'"
          :disabled="sending || readonly"
          @click="switchMode('router')"
        >
          <strong>图像模型</strong><small>Comfy Router</small>
        </button>
      </div>
      <section class="process-section">
        <div class="section-heading">
          <strong>生成配置</strong
          ><span>{{ mode === 'workflow' ? '按工作流映射' : '按模型设置' }}</span>
        </div>
        <template v-if="mode === 'workflow'"
          ><label
            >工作流<select
              v-model="workflowId"
              :disabled="sending || readonly"
              @change="rememberChoice"
            >
              <option value="">选择工作流</option>
              <option v-for="item in workflows" :key="item.id" :value="item.id">
                {{ item.name }}
              </option>
            </select></label
          >
          <p v-if="workflowError" class="process-note error" role="alert">{{ workflowError }}</p>
          <p v-else-if="!workflows.length" class="process-note">
            还没有工作流，请到“工作流管理”导入。
          </p>
          <p
            v-else-if="selectedWorkflow"
            class="process-note"
            :title="
              workflowOutputMappings(selectedWorkflow)
                .map((item) => item.label || `节点 ${item.node_id}`)
                .join('、')
            "
          >
            图片结果：{{ workflowOutputMappings(selectedWorkflow).length }} 个映射 ·
            返回图片全部保存
          </p>
        </template>
        <template v-else
          ><label
            >模型<select v-model="model" :disabled="sending || readonly" @change="rememberChoice">
              <option v-for="item in models" :key="item.id" :value="item.id">
                {{ item.label }}
              </option>
            </select></label
          >
          <div class="output-fields" :class="{ single: !resizableCreationModels.includes(model) }">
            <label
              >输出比例<select
                v-model="aspectRatio"
                :disabled="sending || readonly"
                @change="rememberChoice"
              >
                <option value="auto">模型自动</option>
                <option v-for="ratio in ratios" :key="ratio">{{ ratio }}</option>
              </select></label
            >
            <label v-if="resizableCreationModels.includes(model)"
              >输出分辨率<select
                v-model="imageSize"
                :disabled="sending || readonly"
                @change="rememberChoice"
              >
                <option value="1K">1K</option>
                <option value="2K">2K</option>
                <option value="4K">4K</option>
              </select></label
            >
          </div>
          <p v-if="modelError" class="process-note" role="status">{{ modelError }}</p></template
        >
      </section>
      <section v-if="mode === 'router' || selectedWorkflow" class="process-section">
        <div class="section-heading">
          <strong>{{ generation ? '生成提示词' : '编辑要求' }}</strong
          ><span v-if="mode === 'workflow'">按映射显示</span>
        </div>
        <label v-if="mode === 'router' || selectedWorkflow?.prompt_node_id"
          >{{ generation ? '正向提示词' : mode === 'workflow' ? '正向提示词' : '整体编辑提示词'
          }}<textarea
            v-model="prompt"
            rows="4"
            :disabled="sending || readonly"
            :placeholder="
              generation ? '描述想生成的主体、构图、风格和光线' : '描述希望怎样修改图片'
            "
            maxlength="8000"
          />
        </label>
        <p v-else class="process-note">未映射正向提示词，将沿用工作流 JSON 中的设置。</p>
        <div
          v-if="!generation && (mode === 'router' || selectedWorkflow?.prompt_node_id)"
          class="annotation-extract"
        >
          <button
            type="button"
            :disabled="sending || readonly || !canExtractAnnotations"
            @click="extractAnnotations"
          >
            提取批注
          </button>
          <span>{{
            !annotationPrompt
              ? '暂无文字批注'
              : lastExtractedPrompt === annotationPrompt
                ? '已提取，可直接修改'
                : '按序号逐行提取，可继续修改'
          }}</span>
          <AnnotationExtractionSettings
            :rules="annotationRules"
            :doc="doc"
            :disabled="sending || readonly"
            :save-rules="saveAnnotationRules"
          />
        </div>
        <label v-if="mode === 'workflow' && selectedWorkflow?.negative_prompt_node_id"
          >负向提示词<textarea
            v-model="negativePrompt"
            rows="3"
            :disabled="sending || readonly"
            placeholder="描述不希望出现的内容；留空将传入空文本"
          />
        </label>
        <div
          v-if="mode === 'workflow' && selectedWorkflow?.parameters.length"
          class="workflow-parameters"
        >
          <strong>可调参数</strong>
          <div
            v-for="parameter in selectedWorkflow.parameters"
            :key="parameter.id"
            class="workflow-parameter"
          >
            <WorkflowParameterInput
              :parameter="parameter"
              :value="parameterDraft[parameter.id]"
              :disabled="sending || readonly"
              @update:value="parameterDraft[parameter.id] = $event"
            />
          </div>
        </div>
      </section>
      <section v-if="!generation" class="process-section input-section">
        <div class="section-heading"><strong>输入素材</strong><span>本次提交</span></div>
        <div class="input-stats">
          <div>
            <span>主图</span><strong>{{ inputSize }} px</strong>
          </div>
          <div>
            <span>参考图</span><strong>{{ usedReferences }} / {{ maxReferences }} 张</strong>
          </div>
        </div>
        <div v-if="referenceInputs.length" class="reference-list">
          <span
            v-for="(item, index) in referenceInputs"
            :key="item.path"
            :class="{ ignored: index >= usedReferences }"
            :title="`${item.name} · ${effectiveSize(item.doc)} px${index >= usedReferences ? ' · 本次忽略' : ''}`"
            >{{ item.name }}{{ index >= usedReferences ? ' · 忽略' : '' }}</span
          >
        </div>
        <p
          v-if="
            referenceInputs.length > maxReferences &&
            hasMask &&
            workflowUsesMask &&
            mode === 'workflow' &&
            maxReferences < (selectedWorkflow?.reference_slots.length ?? 0)
          "
          class="process-note warning"
        >
          当前工作流使用遮罩时最多接收 {{ maxReferences }} 张参考图，本次提交将忽略其余
          {{ referenceInputs.length - usedReferences }} 张。
        </p>
        <p v-else-if="referenceInputs.length > maxReferences" class="process-note warning">
          超出输入位的 {{ referenceInputs.length - usedReferences }} 张参考图将在本次提交中忽略。
        </p>
        <label v-if="maskLayers.length" class="mask-option"
          ><input
            v-model="useMask"
            type="checkbox"
            :disabled="sending || readonly"
          />使用遮罩通道</label
        >
        <p
          v-if="hasMask && mode === 'workflow' && selectedWorkflow && !workflowUsesMask"
          class="process-note warning"
        >
          当前工作流没有遮罩通道，本次提交将忽略遮罩。
        </p>
        <p v-if="hasMask && mode === 'router'" class="process-note warning">
          当前图像模型没有独立遮罩通道，本次提交将忽略遮罩。
        </p>
      </section>
      <AIImageResults
        :purpose="generation ? 'image_generation' : 'image_edit'"
        :workspace-id="workspaceId"
        :production-id="productionId"
        :asset-info="assetInfo"
        @preview="emit('previewResult', $event)"
      />
    </div>
    <footer>
      <p v-if="!keyConfigured" class="process-note">请先在“设置 → AI 接入”保存 Comfy API Key。</p>
      <p
        v-else-if="
          mode === 'workflow' &&
          selectedWorkflow &&
          !workflowOutputMappings(selectedWorkflow).length
        "
        class="process-note"
      >
        运行前请在工作流管理中设置图片结果节点。
      </p>
      <p
        v-else-if="
          generation && mode === 'workflow' && selectedWorkflow && !selectedWorkflow.prompt_node_id
        "
        class="process-note"
      >
        运行前请在工作流管理中设置正向提示词输入。
      </p>
      <button type="button" class="submit" :disabled="!canSubmit" @click="requestSubmit">
        {{
          confirming
            ? '等待保存确认…'
            : sending
              ? '正在提交…'
              : generation
                ? '开始生成'
                : '开始 AI 加工'
        }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.annotation-extract {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: -6px 0 14px;
  font-size: 11px;
  color: var(--ui-muted);
}
.annotation-extract > button {
  flex: none;
  padding: 5px 9px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--primary-color);
  cursor: pointer;
  font: inherit;
}
.annotation-extract > button:disabled {
  opacity: 0.5;
  cursor: default;
}
.annotation-extract > span {
  min-width: 0;
  flex: 1;
  overflow-wrap: anywhere;
}
.ai-image-process {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 580px;
  max-height: calc(100vh - 178px);
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
  color: var(--ui-text);
  overflow: hidden;
}
.ai-image-process > header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ui-border);
}
header strong {
  font-size: 15px;
}
header span,
.process-note,
.input-heading span {
  color: var(--ui-muted);
  font-size: 11px;
}
.process-fields {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px;
}
.process-fields > label,
.output-fields label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
  color: var(--ui-muted);
  font-size: 11px;
}
.process-fields :is(select, textarea, input[type='search']) {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--ui-text);
  padding: 8px;
  font: inherit;
  font-size: 12px;
}
.process-fields textarea {
  resize: vertical;
  line-height: 1.5;
}
.output-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}
.process-note {
  margin: 7px 0 12px;
  line-height: 1.5;
}
.process-note.error {
  color: #b42318;
}
.input-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 15px 0 8px;
}
.input-heading strong {
  font-size: 12px;
}
.reference-list {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-bottom: 8px;
}
.reference-item {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  max-width: 180px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
}
.reference-item img,
.reference-picker img {
  width: 32px;
  height: 32px;
  object-fit: cover;
  border-radius: 4px;
}
.reference-item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.reference-item button {
  border: 0;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
}
.add-reference {
  width: 100%;
  padding: 8px;
  border: 1px dashed var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--primary-color);
  cursor: pointer;
  font-size: 12px;
}
.add-reference:disabled {
  opacity: 0.45;
  cursor: default;
}
.reference-picker {
  margin-top: 8px;
  padding: 9px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
}
.reference-picker > div {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
  max-height: 185px;
  overflow: auto;
  margin-top: 7px;
}
.reference-picker button {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  color: var(--ui-text);
  padding: 4px;
  text-align: left;
  cursor: pointer;
}
.reference-picker button:disabled {
  opacity: 0.5;
}
.reference-picker button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
.process-fields > .mask-option {
  display: flex;
  align-items: center;
  flex-direction: row;
  gap: 7px;
  margin-top: 12px;
}
.mask-option input {
  accent-color: var(--primary-color);
}
.ai-image-process > footer {
  padding: 12px 16px;
  border-top: 1px solid var(--ui-border);
}
footer .process-note {
  margin: 0 0 8px;
}
.submit {
  width: 100%;
  padding: 10px;
  border: 1px solid var(--primary-color);
  border-radius: 7px;
  background: var(--primary-color);
  color: #fff;
  cursor: pointer;
  font-size: 12px;
}
.submit:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (max-width: 1020px) {
  .ai-image-process {
    max-height: none;
    min-height: 430px;
  }
}
.reference-item {
  align-items: flex-start;
  flex-direction: column;
  gap: 3px;
  padding: 6px 8px;
}
.reference-item small {
  color: var(--ui-muted);
  font-size: 10px;
}
.ai-image-process {
  min-height: 440px;
}
.workflow-parameters {
  margin: 2px 0 15px;
  padding: 11px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface-soft);
}
.workflow-parameters > strong {
  display: block;
  margin-bottom: 10px;
  font-size: 12px;
}
.workflow-parameter {
  margin-top: 9px;
}
.workflow-parameter label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ui-muted);
  font-size: 11px;
}
.workflow-parameter label.workflow-parameter-toggle {
  align-items: center;
  flex-direction: row;
  color: var(--ui-text);
}
.workflow-parameter-toggle input {
  accent-color: var(--primary-color);
}
.ai-image-process > header {
  align-items: center;
  padding: 13px 15px;
}
.process-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}
.mode-switch {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
}
.mode-switch button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 0;
  min-height: 34px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
}
.mode-switch button strong {
  font-size: 12px;
  font-weight: 650;
}
.mode-switch button small {
  font-size: 10px;
}
.mode-switch button.active {
  border-color: var(--ui-border);
  background: var(--ui-surface);
  color: var(--primary-color);
  box-shadow: 0 1px 3px #0000000b;
}
.mode-switch button:disabled {
  opacity: 0.6;
  cursor: default;
}
.process-section {
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
}
.section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.section-heading strong {
  font-size: 12px;
}
.section-heading span {
  color: var(--ui-muted);
  font-size: 10px;
}
.process-section label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 11px;
  color: var(--ui-muted);
  font-size: 11px;
}
.process-section label:last-child {
  margin-bottom: 0;
}
.process-section :is(select, textarea, input[type='number'], input[type='text']) {
  width: 100%;
  box-sizing: border-box;
  padding: 8px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 12px;
}
.process-section textarea {
  min-height: 78px;
  resize: vertical;
  line-height: 1.5;
}
.output-fields {
  gap: 8px;
}
.output-fields.single {
  grid-template-columns: 1fr;
}
.output-fields label {
  margin-bottom: 0;
}
.process-note {
  margin: 8px 0 0;
}
.process-note.error {
  color: #b42318;
}
.process-note.warning {
  color: color-mix(in srgb, var(--ui-amber, #a86a08) 76%, var(--ui-text) 24%);
}
.workflow-parameters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 11px 0 0;
  padding: 11px 0 0;
  border: 0;
  border-top: 1px solid var(--ui-border);
  border-radius: 0;
  background: transparent;
}
.workflow-parameters > strong {
  grid-column: 1/-1;
  margin: 0;
  font-size: 11px;
}
.workflow-parameter {
  min-width: 0;
  margin: 0;
}
.workflow-parameter:has(input[type='text']),
.workflow-parameter:has(.ant-switch),
.workflow-parameter:has(.workflow-number-slider) {
  grid-column: 1/-1;
}
.workflow-parameter label {
  margin: 0;
}
.workflow-parameter label.workflow-parameter-toggle {
  margin: 0;
}
.input-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.input-stats > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 5px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface-soft);
}
.input-stats span {
  color: var(--ui-muted);
  font-size: 10px;
}
.input-stats strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 650;
}
.reference-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 9px 0 0;
}
.reference-list > span {
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 7px;
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  color: var(--ui-muted);
  font-size: 10px;
}
.reference-list > span.ignored {
  border-color: color-mix(in srgb, var(--ui-amber, #a86a08) 35%, var(--ui-border));
  color: color-mix(in srgb, var(--ui-amber, #a86a08) 76%, var(--ui-text) 24%);
}
.process-section label.mask-option {
  align-items: center;
  flex-direction: row;
  gap: 7px;
  margin: 10px 0 0;
  color: var(--ui-text);
}
.mask-option input {
  accent-color: var(--primary-color);
}
.ai-image-process > footer {
  padding: 11px 12px;
}
</style>
