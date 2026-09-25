<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { FileNodeInfo } from '@/api/files'
import { saveAiImageResult } from '@/api/workspaceArtifacts'
import { toImageThumbnailUrl } from '@/util/file'
import { getComfyRouterModels, getImageAICreationConfig, listStudioWorkflows, runStudioWorkflowEdit, runStudioRouterEdit, workflowPurpose, type ImageAICreationMode, type StudioWorkflowSummary } from '@/api/imageAi'
import { studioLayerVisible, studioMaskPaintBounds, type StudioDocument, type StudioGuideLayer, type StudioPaintLayer } from './imageStudioModel'
import { renderStudioDocument, renderStudioMask, type StudioRenderScope } from './imageStudioRender'
import { creationChoiceKey, defaultCreationModels, resizableCreationModels, routerAspectRatios } from './imageCreationOptions'
import type { WorkspaceAsset } from './workspaceModel'

const props = defineProps<{ open: boolean; doc: StudioDocument | null; scope: StudioRenderScope;
  assetInfo: Record<string, FileNodeInfo>; assets: WorkspaceAsset[]; workspaceId: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; artifactSaved: [] }>()
const uploadMaxEdge = 2048
const referenceMaxEdge = 1280
const workflows = ref<StudioWorkflowSummary[]>([])
const workflowId = ref('')
const workflowLoading = ref(false), workflowError = ref('')
const maskChoice = ref('all')
const inputArea = ref<'content' | 'canvas'>('content')
const previewMode = ref<'composite' | 'input'>('composite')
interface ReferenceImage { path: string; name: string; dataUrl: string; width: number; height: number }
const referenceImages = ref<ReferenceImage[]>([])
const selectedInput = ref('main')
const referencePickerOpen = ref(false), referenceQuery = ref(''), addingReference = ref('')
const previewPane = ref<HTMLElement | null>(null)
let referenceDocumentId = ''
const creationMode = ref<ImageAICreationMode>('workflow'), creationModel = ref('vertexai/gemini-3.1-flash-image')
const routerAspectRatio = ref('auto'), routerImageSize = ref<'1K' | '2K' | '4K'>('1K')
const creationModels = ref(defaultCreationModels)
const creationModelsChecked = ref(false), creationModelsLoading = ref(false), creationModelsError = ref('')
const prompt = ref('')
const keyConfigured = ref(false)
const compositeUrl = ref(''), previewUrl = ref(''), maskUrl = ref(''), resultUrl = ref('')
const renderError = ref('')
const sending = ref(false), preparing = ref(false)
let revision = 0
let preparedSources: Promise<{ composite: HTMLCanvasElement; image: HTMLCanvasElement; failures: string[] }> | null = null
let choiceTouched = false
let configurationRequestId = 0
const selectedWorkflow = computed(() => workflows.value.find(item => item.id === workflowId.value))
const masks = computed(() => props.doc?.layers.filter(layer => layer.kind === 'mask' && studioLayerVisible(props.doc!, layer) &&
  (props.scope.kind !== 'group' || layer.groupId === props.scope.id)) ?? [])
const annotations = computed(() => {
  const scope = props.scope
  return props.doc?.layers.filter((layer): layer is StudioGuideLayer | StudioPaintLayer => (layer.kind === 'guide' || (layer.kind === 'paint' && layer.strokes.length > 0)) &&
    studioLayerVisible(props.doc!, layer) && (scope.kind !== 'group' || layer.groupId === scope.id)) ?? []
})
const guides = computed(() => annotations.value.filter((layer): layer is StudioGuideLayer => layer.kind === 'guide'))
const paintLayers = computed(() => annotations.value.filter((layer): layer is StudioPaintLayer => layer.kind === 'paint'))
const maskIds = computed(() => maskChoice.value === 'none' ? [] : maskChoice.value === 'all'
  ? props.scope.kind === 'group' ? masks.value.map(mask => mask.id) : undefined : [maskChoice.value])
const hasMask = computed(() => maskChoice.value !== 'none' && masks.value.some(layer =>
  (!maskIds.value || maskIds.value.includes(layer.id)) && layer.kind === 'mask' && layer.strokes.some(stroke => stroke.mode === 'paint')))
const outputExtension = computed(() => resultUrl.value.startsWith('data:image/jpeg') ? 'jpg' :
  resultUrl.value.startsWith('data:image/webp') ? 'webp' : 'png')
const availableAspectRatios = computed(() => routerAspectRatios(creationModel.value))
const routerCanResize = computed(() => resizableCreationModels.includes(creationModel.value))
const maxReferences = computed(() => creationMode.value === 'workflow' ? selectedWorkflow.value?.reference_slots.length ?? 0
  : creationModel.value === 'vertexai/gemini-2.5-flash-image' ? 2 : 13)
const workspaceImages = computed(() => props.assets.filter(asset => asset.kind === 'image' && !!props.assetInfo[asset.path]))
const matchingWorkspaceImages = computed(() => workspaceImages.value.filter(asset =>
  asset.name.toLocaleLowerCase().includes(referenceQuery.value.trim().toLocaleLowerCase())))
const filteredWorkspaceImages = computed(() => matchingWorkspaceImages.value.slice(0, 60))
const selectedReference = computed(() => referenceImages.value.find(image => image.path === selectedInput.value))
const selectedPreviewUrl = computed(() => previewMode.value === 'composite' ? compositeUrl.value
  : selectedInput.value === 'mask' && creationMode.value === 'workflow' ? maskUrl.value
    : selectedReference.value?.dataUrl || previewUrl.value)
const selectedPreviewName = computed(() => previewMode.value === 'composite' ? '作品预览'
  : selectedInput.value === 'mask' && creationMode.value === 'workflow' ? '遮罩'
    : selectedReference.value?.name || targetLabel.value)
const selectedPreviewSize = computed(() => previewMode.value === 'composite' ? `${props.doc?.width ?? 0} × ${props.doc?.height ?? 0}`
  : selectedReference.value ? `${selectedReference.value.width} × ${selectedReference.value.height}` : uploadSize.value)
const uploadSize = computed(() => {
  if (!props.doc) return ''
  const ratio = Math.min(1, uploadMaxEdge / Math.max(props.doc.width, props.doc.height))
  const width = Math.round(props.doc.width * ratio), height = Math.round(props.doc.height * ratio)
  const bounds = pixelCropBounds(props.doc, width, height)
  return `${bounds.width} × ${bounds.height}`
})
const mapped = computed(() => !!selectedWorkflow.value?.image_node_id && !!selectedWorkflow.value?.output_node_id)
const targetLabel = computed(() => {
  const scope = props.scope
  if (!props.doc || scope.kind === 'all') return '当前可见图层合成图'
  if (scope.kind === 'group') return `分组 · ${props.doc.groups.find(group => group.id === scope.id)?.name ?? '已删除'}`
  return `图层 · ${props.doc.layers.find(layer => layer.id === scope.id)?.name ?? '已删除'}`
})
const combinedPrompt = computed(() => {
  const regions = guides.value.filter(guide => guide.prompt.trim()).map(guide =>
    `请修改${guide.color.toLowerCase() === '#ef4444' ? '红色' : guide.color.toUpperCase() + ' 色'}${guide.shape === 'arrow' ? '箭头指向' : '方框内'}的区域：${guide.prompt.trim()}`)
  const painted = paintLayers.value.filter(layer => layer.prompt.trim()).map(layer =>
    `请去掉${layer.color.toLowerCase() === '#ef4444' ? '红色' : layer.color.toUpperCase() + ' 色'}涂抹标注，并编辑其覆盖的区域：${layer.prompt.trim()}`)
  const instructions = [prompt.value.trim(), ...regions, ...painted].filter(Boolean)
  if (!instructions.length) return ''
  return [...(annotations.value.length ? ['图中的彩色框、箭头与涂抹是定位标注；涂抹颜色不是最终颜色，结果中应去除这些标注。'] : []),
    ...instructions].join('\n')
})

function inputBounds() {
  const doc = props.doc!
  const full = {x: 0, y: 0, width: doc.width, height: doc.height}
  if (inputArea.value === 'canvas') return full
  const layers = doc.layers.filter(layer => studioLayerVisible(doc, layer) && layer.kind !== 'guide' && layer.kind !== 'mask' && layer.kind !== 'paint' &&
    (props.scope.kind === 'all' || (props.scope.kind === 'layer' ? layer.id === props.scope.id : layer.groupId === props.scope.id)))
  const frames = [...layers, ...annotations.value.flatMap(layer => {
    if (layer.kind === 'guide') return [layer]
    const bounds = studioMaskPaintBounds(layer)
    return bounds ? [{ x: layer.x + bounds.x, y: layer.y + bounds.y, width: bounds.width, height: bounds.height, rotation: layer.rotation }] : []
  })]
  if (!frames.length) return full
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  for (const layer of frames) {
    const cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2
    const angle = layer.rotation * Math.PI / 180, cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle))
    const dx = (layer.width * cos + layer.height * sin) / 2
    const dy = (layer.width * sin + layer.height * cos) / 2
    left = Math.min(left, cx - dx); top = Math.min(top, cy - dy)
    right = Math.max(right, cx + dx); bottom = Math.max(bottom, cy + dy)
  }
  const x = Math.min(doc.width - 1, Math.max(0, Math.floor(left)))
  const y = Math.min(doc.height - 1, Math.max(0, Math.floor(top)))
  return {x, y, width: Math.max(1, Math.min(doc.width, Math.ceil(right)) - x),
    height: Math.max(1, Math.min(doc.height, Math.ceil(bottom)) - y)}
}
function pixelCropBounds(doc: StudioDocument, canvasWidth: number, canvasHeight: number) {
  const bounds = inputBounds()
  const x = Math.round(bounds.x * canvasWidth / doc.width), y = Math.round(bounds.y * canvasHeight / doc.height)
  const width = Math.max(1, Math.round(bounds.width * canvasWidth / doc.width))
  const height = Math.max(1, Math.round(bounds.height * canvasHeight / doc.height))
  return {x, y, width, height}
}
function cropToInput(canvas: HTMLCanvasElement, doc: StudioDocument) {
  const {x, y, width, height} = pixelCropBounds(doc, canvas.width, canvas.height)
  if (x === 0 && y === 0 && width === canvas.width && height === canvas.height) return
  const cropped = document.createElement('canvas')
  cropped.width = width; cropped.height = height
  cropped.getContext('2d')!.drawImage(canvas, x, y, width, height, 0, 0, width, height)
  canvas.width = width; canvas.height = height
  canvas.getContext('2d')!.drawImage(cropped, 0, 0)
}

function rememberCreationChoice() {
  try { localStorage.setItem(creationChoiceKey, JSON.stringify({mode: creationMode.value, model: creationModel.value,
    aspectRatio: routerAspectRatio.value, imageSize: routerImageSize.value, workflowId: workflowId.value})) }
  catch { /* Keep the choice for this session. */ }
}
function normalizeRouterOptions() {
  if (routerAspectRatio.value !== 'auto' && !availableAspectRatios.value.includes(routerAspectRatio.value)) routerAspectRatio.value = 'auto'
  if (!routerCanResize.value) routerImageSize.value = '1K'
}
function creationChoiceChanged() {
  choiceTouched = true
  normalizeRouterOptions()
  rememberCreationChoice()
}
async function addReference(asset: WorkspaceAsset) {
  if (addingReference.value || referenceImages.value.some(image => image.path === asset.path)) return
  if (referenceImages.value.length >= maxReferences.value) { message.warning(`当前方式最多添加 ${maxReferences.value} 张参考图`); return }
  const file = props.assetInfo[asset.path]
  if (!file) { message.error('工作区素材暂时无法读取'); return }
  addingReference.value = asset.path
  try {
    const source = new Image()
    source.crossOrigin = 'anonymous'
    source.src = toImageThumbnailUrl(file, `${referenceMaxEdge}x${referenceMaxEdge}`)
    await source.decode()
    if (!source.naturalWidth || !source.naturalHeight) throw new Error('参考图无有效尺寸')
    const ratio = Math.min(1, referenceMaxEdge / Math.max(source.naturalWidth, source.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(source.naturalWidth * ratio))
    canvas.height = Math.max(1, Math.round(source.naturalHeight * ratio))
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/png')
    if (dataUrl.length > 16_000_000) throw new Error('参考图转换后超过 12 MB')
    referenceImages.value = [...referenceImages.value,
      {path: asset.path, name: asset.name, dataUrl, width: canvas.width, height: canvas.height}]
    selectedInput.value = asset.path
    previewMode.value = 'input'
    referencePickerOpen.value = false
    previewPane.value?.scrollTo({top: 0})
  } catch (error) { message.error(error instanceof Error ? error.message : '无法读取参考图') }
  finally { addingReference.value = '' }
}
function removeReference(path: string) {
  referenceImages.value = referenceImages.value.filter(image => image.path !== path)
  if (selectedInput.value === path) selectedInput.value = 'main'
}
async function loadRouterModels(openedDoc: StudioDocument, requestId: number) {
  if (!keyConfigured.value || creationModelsLoading.value || creationModelsChecked.value || creationModelsError.value) return
  creationModelsLoading.value = true
  try {
    const catalog = await getComfyRouterModels()
    if (!props.open || props.doc !== openedDoc || requestId !== configurationRequestId) return
    creationModels.value = catalog.creation
    creationModelsChecked.value = true
    if (!catalog.creation.some(model => model.id === creationModel.value)) {
      creationModel.value = catalog.creation[0]?.id || ''
      normalizeRouterOptions()
      if (creationModel.value) rememberCreationChoice()
    }
  } catch {
    if (props.open && props.doc === openedDoc && requestId === configurationRequestId)
      creationModelsError.value = '暂时无法查询可用图像模型；可从已适配模型中选择并尝试。'
  } finally {
    if (requestId === configurationRequestId) creationModelsLoading.value = false
  }
}
async function loadWorkflows(requestId: number) {
  workflowLoading.value = true; workflowError.value = ''
  try {
    const items = await listStudioWorkflows()
    if (!props.open || requestId !== configurationRequestId) return
    workflows.value = items.filter(item => workflowPurpose(item) === 'image_edit')
    if (!workflows.value.some(item => item.id === workflowId.value)) workflowId.value = workflows.value[0]?.id ?? ''
  } catch {
    if (props.open && requestId === configurationRequestId) workflowError.value = '无法读取工作流库'
  } finally { if (requestId === configurationRequestId) workflowLoading.value = false }
}
watch(() => props.open, open => {
  const requestId = ++configurationRequestId
  if (!open || !props.doc) {
    revision++; preparedSources = null
    compositeUrl.value = ''; previewUrl.value = ''; maskUrl.value = ''; resultUrl.value = ''
    preparing.value = false
    return
  }
  const openedDoc = props.doc
  if (referenceDocumentId !== openedDoc.id) { referenceImages.value = []; referenceDocumentId = openedDoc.id }
  selectedInput.value = 'main'; referencePickerOpen.value = false; referenceQuery.value = ''
  preparedSources = null
  compositeUrl.value = ''; previewUrl.value = ''; maskUrl.value = ''; renderError.value = ''
  previewMode.value = 'composite'
  let savedChoice: {mode?: ImageAICreationMode; model?: string; aspectRatio?: string; imageSize?: '1K' | '2K' | '4K'; workflowId?: string} | null = null
  try { savedChoice = JSON.parse(localStorage.getItem(creationChoiceKey) || 'null') } catch { /* Ignore damaged preferences. */ }
  const hasSavedChoice = !!savedChoice && (savedChoice.mode === 'router' || savedChoice.mode === 'workflow') &&
    defaultCreationModels.some(model => model.id === savedChoice?.model)
  if (hasSavedChoice) {
    creationMode.value = savedChoice!.mode!
    creationModel.value = savedChoice!.model!
    routerAspectRatio.value = savedChoice!.aspectRatio || 'auto'
    routerImageSize.value = savedChoice!.imageSize || '1K'
    normalizeRouterOptions()
  }
  workflowId.value = savedChoice?.workflowId || ''
  void loadWorkflows(requestId)
  choiceTouched = false
  creationModels.value = defaultCreationModels
  creationModelsChecked.value = false; creationModelsLoading.value = false; creationModelsError.value = ''
  prompt.value = localStorage.getItem(`iib-studio-comfy-prompt-v1:${openedDoc.id}`) || ''
  maskChoice.value = 'all'; resultUrl.value = ''
  keyConfigured.value = false
  void buildPreview()
  void getImageAICreationConfig().then(config => {
    if (!props.open || props.doc !== openedDoc || requestId !== configurationRequestId) return
    keyConfigured.value = config.comfy_api_key_configured
    if (!hasSavedChoice && !choiceTouched) {
      creationMode.value = config.mode; creationModel.value = config.model
      normalizeRouterOptions()
    }
    if (creationMode.value === 'router') void loadRouterModels(openedDoc, requestId)
  }).catch(() => { if (props.open && props.doc === openedDoc && requestId === configurationRequestId) keyConfigured.value = false })
}, {immediate: true})
watch(creationMode, mode => {
  if (mode !== 'workflow' && selectedInput.value === 'mask') selectedInput.value = 'main'
  if (props.open && props.doc && mode === 'router') void loadRouterModels(props.doc, configurationRequestId)
})
watch(prompt, value => { if (props.open && props.doc) {
  try { localStorage.setItem(`iib-studio-comfy-prompt-v1:${props.doc.id}`, value) } catch { /* Keep the current draft. */ }
} })
watch(maskChoice, () => { if (props.open) void buildPreview() })
watch(inputArea, () => { if (props.open) void buildPreview() })

function previewSources() {
  if (!preparedSources) {
    const doc = props.doc!, assetInfo = props.assetInfo, scope = props.scope
    preparedSources = (async () => {
      const composite = document.createElement('canvas'), image = document.createElement('canvas')
      const compositeFailures = await renderStudioDocument(composite, doc, assetInfo, true, { kind: 'all' }, 1200)
      const failures = await renderStudioDocument(image, doc, assetInfo, false, scope, 1200, true)
      return { composite, image, failures: [...new Set([...compositeFailures, ...failures])] }
    })()
  }
  const source = preparedSources
  return source.catch(error => {
    if (preparedSources === source) preparedSources = null
    throw error
  })
}

async function buildPreview() {
  if (!props.doc) return
  const current = ++revision
  preparing.value = true; renderError.value = ''
  try {
    const sources = await previewSources()
    if (current !== revision) return
    const image = document.createElement('canvas'), mask = document.createElement('canvas')
    image.width = sources.image.width; image.height = sources.image.height
    image.getContext('2d')!.drawImage(sources.image, 0, 0)
    renderStudioMask(mask, props.doc, maskIds.value, 1200)
    cropToInput(image, props.doc); cropToInput(mask, props.doc)
    if (!compositeUrl.value) compositeUrl.value = sources.composite.toDataURL('image/png')
    previewUrl.value = image.toDataURL('image/png')
    maskUrl.value = mask.toDataURL('image/png')
    renderError.value = sources.failures.length ? `无法读取图层：${sources.failures.join('、')}` : ''
  } catch { if (current === revision) renderError.value = '无法准备合成预览' }
  finally { if (current === revision) preparing.value = false }
}
function downloadData(url: string, filename: string) {
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
}
async function downloadInput(kind: 'image' | 'mask') {
  if (!props.doc) return
  const canvas = document.createElement('canvas')
  if (kind === 'image') {
    const failures = await renderStudioDocument(canvas, props.doc, props.assetInfo, false, props.scope, uploadMaxEdge, true)
    if (failures.length) { message.error(`无法读取图层：${failures.join('、')}`); return }
  } else renderStudioMask(canvas, props.doc, maskIds.value, uploadMaxEdge)
  cropToInput(canvas, props.doc)
  downloadData(canvas.toDataURL('image/png'), `${props.doc.name}-${kind === 'image' ? '合成图' : '遮罩'}.png`)
}
async function submit() {
  if (!props.doc || !combinedPrompt.value || sending.value ||
      (creationMode.value === 'workflow' && !mapped.value) ||
      referenceImages.value.length > maxReferences.value) return
  const mode = creationMode.value, model = creationModel.value
  const aspectRatio = routerAspectRatio.value
  const imageSize = resizableCreationModels.includes(model) ? routerImageSize.value : undefined
  const workflowUsesMask = mode === 'workflow' && hasMask.value &&
    !!(selectedWorkflow.value?.mask_node_id || selectedWorkflow.value?.mask_from_image)
  const references = referenceImages.value.map(image => ({...image}))
  sending.value = true; resultUrl.value = ''
  try {
    const image = document.createElement('canvas'), mask = document.createElement('canvas')
    const failures = await renderStudioDocument(image, props.doc, props.assetInfo, false, props.scope, uploadMaxEdge, true)
    if (failures.length) throw new Error(`无法读取图层：${failures.join('、')}`)
    if (workflowUsesMask) renderStudioMask(mask, props.doc, maskIds.value, uploadMaxEdge)
    cropToInput(image, props.doc)
    if (workflowUsesMask) cropToInput(mask, props.doc)
    const imageBase64 = image.toDataURL('image/png').split(',')[1]
    const result = mode === 'router'
      ? await runStudioRouterEdit({image_base64: imageBase64, prompt: combinedPrompt.value, model,
        ...(aspectRatio !== 'auto' ? {aspect_ratio: aspectRatio} : {}),
        ...(imageSize ? {image_size: imageSize} : {}),
        reference_images_base64: references.map(reference => reference.dataUrl.split(',')[1])})
      : await runStudioWorkflowEdit({ workflow_id: workflowId.value, image_base64: imageBase64,
        ...(workflowUsesMask ? { mask_base64: mask.toDataURL('image/png').split(',')[1] } : {}),
        reference_images_base64: references.map(reference => reference.dataUrl.split(',')[1]),
        prompt: combinedPrompt.value })
    resultUrl.value = `data:${result.media_type};base64,${result.image_base64}`
    try {
      await saveAiImageResult(props.workspaceId, `${props.doc.name}-AI结果`, result)
      emit('artifactSaved')
      message.success('AI 加工完成，结果已保存到工作区素材')
    } catch {
      message.warning('AI 加工完成，但结果未能保存到工作区；请先下载图片')
    }
  } catch (error) {
    const detail = (error as {response?: {data?: {detail?: string}}})?.response?.data?.detail
    message.error(detail || (error instanceof Error ? error.message : 'AI 加工失败'))
  } finally { sending.value = false }
}
</script>

<template>
  <a-modal :open="open" title="合成预览与 AI 加工" :width="1040" :footer="null" :closable="!sending"
    :mask-closable="!sending" :keyboard="!sending" @cancel="emit('update:open', false)">
    <div class="handoff" v-if="doc">
      <section ref="previewPane" class="handoff-preview" aria-label="图片输入">
        <div class="pane-heading"><strong>图片输入</strong><span>{{ selectedPreviewSize }} px</span></div>
        <div class="preview-mode" role="tablist" aria-label="预览内容">
          <button type="button" role="tab" :aria-selected="previewMode === 'composite'" :class="{active: previewMode === 'composite'}" @click="previewMode = 'composite'">作品预览</button>
          <button type="button" role="tab" :aria-selected="previewMode === 'input'" :class="{active: previewMode === 'input'}" @click="previewMode = 'input'">实际输入 <span v-if="referenceImages.length">{{ referenceImages.length + 1 }}</span></button>
        </div>
        <figure class="preview-media"><img v-if="selectedPreviewUrl" :src="selectedPreviewUrl" :alt="selectedPreviewName" />
          <button v-if="previewMode === 'input' && (selectedInput === 'main' || selectedInput === 'mask')" type="button"
            class="preview-download" :disabled="preparing" :aria-label="selectedInput === 'mask' ? '下载遮罩 PNG' : '下载合成图 PNG'"
            @click="downloadInput(selectedInput === 'mask' ? 'mask' : 'image')">↓ 下载 PNG</button></figure>
        <div class="preview-caption"><strong>{{ selectedPreviewName }}</strong><span>{{ previewMode === 'composite' ? '遮罩仅以预览色显示' : selectedInput === 'mask' ? '白色编辑 · 黑色保留' : selectedInput === 'main' ? '编辑目标 · 含可见标注' : '参考图' }}</span></div>
        <template v-if="previewMode === 'input'">
          <div class="input-tiles" aria-label="实际输入图片">
            <button type="button" class="input-tile" :class="{active: selectedInput === 'main'}" @click="selectedInput = 'main'"><img v-if="previewUrl" :src="previewUrl" alt="" /><span>主图</span></button>
            <div v-for="(image, index) in referenceImages" :key="image.path" class="reference-tile" :class="{active: selectedInput === image.path}">
              <button type="button" class="reference-select" :title="image.name" @click="selectedInput = image.path"><img :src="image.dataUrl" alt="" /><span>参考 {{ index + 1 }}</span></button>
              <button type="button" class="reference-remove" :aria-label="`移除参考图 ${image.name}`" title="移除参考图" @click="removeReference(image.path)">×</button>
            </div>
            <button v-if="creationMode === 'workflow' && masks.length" type="button" class="input-tile" :class="{active: selectedInput === 'mask'}" @click="selectedInput = 'mask'"><img v-if="maskUrl" :src="maskUrl" alt="" /><span>遮罩</span></button>
            <button type="button" class="add-reference" :disabled="referenceImages.length >= maxReferences" @click="referencePickerOpen = !referencePickerOpen"><span aria-hidden="true">＋</span>参考图</button>
          </div>
          <div v-if="referencePickerOpen" class="reference-picker">
            <div class="reference-picker-head"><input v-model="referenceQuery" placeholder="搜索工作区图片" aria-label="搜索工作区图片" /><button type="button" aria-label="关闭参考图选择" @click="referencePickerOpen = false">×</button></div>
            <div v-if="filteredWorkspaceImages.length" class="reference-options"><button v-for="asset in filteredWorkspaceImages" :key="asset.path" type="button"
              :disabled="!!addingReference || referenceImages.some(image => image.path === asset.path)" @click="addReference(asset)">
              <img :src="toImageThumbnailUrl(assetInfo[asset.path], '96x96')" alt="" /><span :title="asset.name">{{ asset.name }}</span><small v-if="referenceImages.some(image => image.path === asset.path)">已添加</small></button></div>
            <p v-else class="handoff-note">工作区没有匹配的图片素材。</p>
            <p v-if="matchingWorkspaceImages.length > 60" class="handoff-note">仅显示前 60 项，可搜索其他图片。</p>
          </div>
          <div class="input-settings"><label class="handoff-field">主图范围<select v-model="inputArea"><option value="content">内容边界</option><option value="canvas">完整画布</option></select></label>
            <span class="input-size">发送主图 {{ uploadSize }} px · PNG</span></div>
          <label v-if="creationMode === 'workflow' && masks.length" class="handoff-field mask-choice">使用的遮罩<select v-model="maskChoice"><option value="all">全部可见遮罩</option><option value="none">不使用遮罩</option>
            <option v-for="layer in masks" :key="layer.id" :value="layer.id">{{ layer.name }}</option></select></label>
        </template>
        <p v-if="renderError" class="handoff-error" role="alert">{{ renderError }}</p>
      </section>
      <section class="handoff-config" aria-label="AI 加工参数"><div class="config-scroll">
        <div class="pane-heading"><strong>加工参数</strong></div>
        <label class="handoff-field">创作方式<select v-model="creationMode" :disabled="sending" @change="creationChoiceChanged()"><option value="router">Comfy Router · 直接调用图像模型</option><option value="workflow">Comfy Cloud · JSON 工作流</option></select></label>
        <label v-if="creationMode === 'router'" class="handoff-field">图像模型<select v-model="creationModel" :disabled="sending || !creationModels.length" @change="creationChoiceChanged()"><option v-for="model in creationModels" :key="model.id" :value="model.id">{{ model.label }}</option></select></label>
        <div v-if="creationMode === 'router'" class="router-output-options">
          <label class="handoff-field">输出比例<select v-model="routerAspectRatio" :disabled="sending" @change="creationChoiceChanged()"><option value="auto">模型自动</option><option v-for="ratio in availableAspectRatios" :key="ratio" :value="ratio">{{ ratio }}</option></select></label>
          <label class="handoff-field">输出分辨率<select v-model="routerImageSize" :disabled="sending || !routerCanResize" @change="creationChoiceChanged()"><option value="1K">1K{{ routerCanResize ? '' : ' · 固定' }}</option><option v-if="routerCanResize" value="2K">2K</option><option v-if="routerCanResize" value="4K">4K</option></select></label>
        </div>
        <p v-if="creationMode === 'router'" class="handoff-note">输出分辨率为模型档位，与左侧输入图片尺寸不同。</p>
        <p v-if="creationMode === 'router' && (creationModelsLoading || creationModelsError || (creationModelsChecked && !creationModels.length))" class="handoff-note" role="status">{{ creationModelsLoading ? '正在查询 Comfy Router 可用图像模型…' : creationModelsError || '当前账号没有可用的已适配图像模型。' }}</p>
        <label class="handoff-field">整体编辑提示词<textarea v-model="prompt" rows="3" placeholder="描述期望的修改或创作结果" /></label>
        <label v-if="creationMode === 'workflow'" class="handoff-field">工作流<select v-model="workflowId" :disabled="sending || workflowLoading" @change="rememberCreationChoice()">
          <option value="">选择已保存工作流</option><option v-for="item in workflows" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
        <p v-if="creationMode === 'workflow' && workflowError" class="handoff-error" role="alert">{{ workflowError }}</p>
        <p v-else-if="creationMode === 'workflow' && !workflows.length" class="handoff-note">暂无工作流，请先到“工作台 → AI 创作”导入并配置。</p>
        <p v-else-if="creationMode === 'workflow' && selectedWorkflow" class="handoff-note">最多使用 {{ selectedWorkflow.reference_slots.length }} 张参考图{{ selectedWorkflow.mask_from_image ? ' · 遮罩由主图提供' : selectedWorkflow.mask_node_id ? ' · 支持独立遮罩' : '' }}</p>
        <p v-if="creationMode === 'router' && hasMask" class="handoff-note">Router 不接收独立遮罩；需要遮罩通道时请选择 JSON 工作流。</p>
        <div v-if="resultUrl" class="handoff-result"><strong>加工结果</strong><img :src="resultUrl" alt="Comfy Cloud 加工结果" />
          <button type="button" @click="downloadData(resultUrl, `${doc.name}-AI结果.${outputExtension}`)">下载结果</button></div>
      </div><div class="config-footer">
        <p v-if="!keyConfigured" class="handoff-note">请先在“设置 → AI 接入”保存 Comfy API Key。</p>
        <p v-else-if="referenceImages.length > maxReferences" class="handoff-note" role="alert">当前模型最多使用 {{ maxReferences }} 张参考图，请从左侧移除多余图片。</p>
        <p v-else-if="creationMode === 'workflow' && hasMask && !(selectedWorkflow?.mask_node_id || selectedWorkflow?.mask_from_image)" class="handoff-warning">当前工作流没有遮罩通道，本次会忽略遮罩。</p>
        <button type="button" class="send-button" :disabled="!keyConfigured || (creationMode === 'workflow' && !mapped) || (creationMode === 'router' && !creationModel) || referenceImages.length > maxReferences || !combinedPrompt || preparing || !!renderError || sending"
          @click="submit">{{ sending ? '云端处理中…' : creationMode === 'router' ? '发送到 Comfy Router' : '发送到 Comfy Cloud' }}</button>
      </div></section>
    </div>
  </a-modal>
</template>

<style scoped>
.handoff{display:grid;grid-template-columns:minmax(0,42%) minmax(0,58%);height:min(67vh,650px);min-height:350px;overflow:hidden;border:1px solid var(--ui-border);border-radius:10px;color:var(--ui-text)}
.handoff-preview,.handoff-config{min-width:0;min-height:0}.handoff-preview{position:relative;padding:16px;overflow-y:auto;border-right:1px solid var(--ui-border);background:var(--ui-surface-soft)}.handoff-config{display:flex;flex-direction:column;background:var(--ui-surface)}.config-scroll{flex:1;min-height:0;overflow-y:auto;padding:16px 20px}.config-footer{flex:none;padding:11px 20px 16px;border-top:1px solid var(--ui-border);background:var(--ui-surface)}
.pane-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.pane-heading strong{font-size:14px}.pane-heading span,.handoff-note{font-size:11px;color:var(--ui-muted);line-height:1.5}
.preview-mode{display:flex;gap:4px;margin-bottom:10px;padding:3px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface)}.preview-mode button{flex:1;border:0;border-radius:5px;background:transparent;color:var(--ui-muted);padding:7px 10px;cursor:pointer;font-size:12px}.preview-mode button.active{background:var(--ui-surface-soft);color:var(--primary-color);box-shadow:0 1px 4px #0002;font-weight:600}.preview-mode button:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
.preview-media{position:relative;display:flex;align-items:center;justify-content:center;height:min(29vh,290px);min-height:165px;margin:0;overflow:hidden;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface)}.preview-media img{display:block;width:100%;height:100%;object-fit:contain}.preview-download{position:absolute;right:10px;bottom:10px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);padding:7px 10px;cursor:pointer;font-size:12px;opacity:0;transition:opacity .15s}.preview-media:hover .preview-download,.preview-download:focus-visible{opacity:1}.preview-download:disabled{cursor:default;opacity:.5}.preview-caption{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:30px;font-size:11px}.preview-caption strong{max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}.preview-caption span{color:var(--ui-muted);text-align:right}
.input-tiles{display:flex;gap:7px;overflow-x:auto;padding:3px 0 8px}.input-tile,.reference-tile,.add-reference{position:relative;box-sizing:border-box;flex:0 0 74px;height:76px;overflow:hidden;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface);color:var(--ui-text);font-size:11px}.input-tile,.reference-select,.add-reference{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer}.input-tile.active,.reference-tile.active{border-color:var(--primary-color);box-shadow:inset 0 0 0 1px var(--primary-color)}.input-tile img,.reference-select img{width:100%;height:48px;object-fit:contain}.input-tile span,.reference-select span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reference-select{width:100%;height:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit}.reference-remove{position:absolute;top:2px;right:2px;width:20px;height:20px;border:0;border-radius:4px;background:var(--ui-surface);color:var(--ui-text);cursor:pointer;font-size:16px;line-height:18px}.add-reference{border-style:dashed}.add-reference span{font-size:22px;line-height:20px}.add-reference:disabled{opacity:.5;cursor:default}
.reference-picker{position:absolute;left:10px;right:10px;bottom:10px;z-index:3;padding:8px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface);box-shadow:0 10px 28px #0002}.reference-picker-head{display:flex;gap:5px}.reference-picker-head input{flex:1;min-width:0;padding:6px;border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface);color:var(--ui-text)}.reference-picker-head button{width:28px;border:0;background:transparent;color:var(--ui-muted);cursor:pointer;font-size:17px}.reference-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;max-height:160px;margin-top:7px;overflow-y:auto}.reference-options button{display:flex;align-items:center;gap:6px;min-width:0;padding:4px;border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface-soft);color:var(--ui-text);cursor:pointer;text-align:left;font-size:11px}.reference-options button:disabled{opacity:.5;cursor:default}.reference-options img{width:32px;height:32px;flex:none;object-fit:cover}.reference-options span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reference-options small{white-space:nowrap}
.input-settings{display:flex;align-items:end;justify-content:space-between;gap:8px}.input-settings .handoff-field{flex:1;max-width:190px}.input-size{padding-bottom:8px;color:var(--ui-muted);font-size:11px;white-space:nowrap}.mask-choice{max-width:220px}.handoff-field{display:flex;flex-direction:column;gap:5px;margin:10px 0;font-size:11px;color:var(--ui-muted)}.handoff-field :is(select,textarea){width:100%;min-width:0;box-sizing:border-box;padding:7px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);font:inherit;font-size:12px}.router-output-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.router-output-options .handoff-field{min-width:0}
.send-button{width:100%;padding:10px;border:1px solid var(--primary-color);border-radius:7px;background:var(--primary-color);color:#fff;cursor:pointer;font-size:12px}.send-button:disabled{opacity:.5;cursor:default}.config-footer .handoff-note{margin:0 0 8px}.handoff-error{color:#b42318;font-size:12px}.handoff-result{display:grid;gap:8px;margin-top:14px}.handoff-result img{max-width:100%;max-height:260px;object-fit:contain;border:1px solid var(--ui-border);border-radius:8px}.handoff-result button{justify-self:start;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface-soft);color:var(--ui-text);padding:6px 9px;cursor:pointer;font-size:12px}
.handoff-warning{margin:0 0 8px;color:var(--ui-amber,#a86a08);font-size:11px;line-height:1.5}
@media(hover:none){.preview-download{opacity:1}}
@media(max-width:800px){.handoff{display:flex;flex-direction:column;height:auto;max-height:76vh;overflow-y:auto}.handoff-preview{flex:none;overflow:visible;border-right:0;border-bottom:1px solid var(--ui-border)}.handoff-config{overflow:visible}.config-scroll{overflow:visible}.preview-media{height:min(38vh,300px)}}
@media(max-width:480px){.router-output-options{grid-template-columns:1fr}.input-settings{display:block}.input-size{display:block;padding:0 0 8px}}
</style>
