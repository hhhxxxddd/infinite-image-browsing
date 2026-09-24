<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { FileNodeInfo } from '@/api/files'
import { getImageAICreationConfig, runStudioComfyEdit, runStudioRouterEdit, type ComfyWorkflow, type ImageAICreationMode } from '@/api/imageAi'
import { studioLayerVisible, studioMaskPaintBounds, type StudioDocument, type StudioGuideLayer, type StudioPaintLayer } from './imageStudioModel'
import { renderStudioDocument, renderStudioMask, type StudioRenderScope } from './imageStudioRender'

const props = defineProps<{ open: boolean; doc: StudioDocument | null; scope: StudioRenderScope;
  assetInfo: Record<string, FileNodeInfo> }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const workflowKey = 'iib-studio-comfy-edit-workflow-v1'
const workflow = ref<ComfyWorkflow | null>(null)
const workflowName = ref('')
const imageNodeId = ref(''), imageInput = ref('image')
const maskNodeId = ref(''), maskInput = ref('image')
const promptNodeId = ref(''), promptInput = ref('text'), outputNodeId = ref('')
const maskChoice = ref('all')
const inputArea = ref<'content' | 'canvas'>('content')
const previewMode = ref<'composite' | 'input'>('composite')
const creationMode = ref<ImageAICreationMode>('workflow'), creationModel = ref('')
const previewSize = ref('')
const prompt = ref('')
const keyConfigured = ref(false)
const compositeUrl = ref(''), previewUrl = ref(''), maskUrl = ref(''), resultUrl = ref('')
const renderError = ref('')
const sending = ref(false), preparing = ref(false)
let revision = 0
let preparedSources: Promise<{ composite: HTMLCanvasElement; image: HTMLCanvasElement; failures: string[] }> | null = null
const nodes = computed(() => Object.entries(workflow.value ?? {}).map(([id, node]) => ({
  id, label: `${id} · ${node._meta?.title || node.class_type}`
})))
const inputs = (id: string) => Object.keys(workflow.value?.[id]?.inputs ?? {})
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
const mapped = computed(() => !!workflow.value &&
  imageInput.value in (workflow.value?.[imageNodeId.value]?.inputs ?? {}) &&
  promptInput.value in (workflow.value?.[promptNodeId.value]?.inputs ?? {}) &&
  !!workflow.value?.[outputNodeId.value] &&
  (!hasMask.value || maskInput.value in (workflow.value?.[maskNodeId.value]?.inputs ?? {})) &&
  new Set([`${imageNodeId.value}:${imageInput.value}`, `${promptNodeId.value}:${promptInput.value}`,
    ...(hasMask.value ? [`${maskNodeId.value}:${maskInput.value}`] : [])]).size === (hasMask.value ? 3 : 2))
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
function cropToInput(canvas: HTMLCanvasElement, doc: StudioDocument) {
  const bounds = inputBounds()
  const x = Math.round(bounds.x * canvas.width / doc.width), y = Math.round(bounds.y * canvas.height / doc.height)
  const width = Math.max(1, Math.round(bounds.width * canvas.width / doc.width))
  const height = Math.max(1, Math.round(bounds.height * canvas.height / doc.height))
  if (x === 0 && y === 0 && width === canvas.width && height === canvas.height) return
  const cropped = document.createElement('canvas')
  cropped.width = width; cropped.height = height
  cropped.getContext('2d')!.drawImage(canvas, x, y, width, height, 0, 0, width, height)
  canvas.width = width; canvas.height = height
  canvas.getContext('2d')!.drawImage(cropped, 0, 0)
}

function isGraph(value: unknown): value is ComfyWorkflow {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length > 0 && Object.keys(value).length <= 256 &&
    Object.values(value).every(node => !!node && typeof node === 'object' &&
      typeof (node as ComfyWorkflow[string]).class_type === 'string' &&
      !!(node as ComfyWorkflow[string]).inputs && typeof (node as ComfyWorkflow[string]).inputs === 'object' &&
      !Array.isArray((node as ComfyWorkflow[string]).inputs))
}
function restoreWorkflow() {
  try {
    const saved = JSON.parse(localStorage.getItem(workflowKey) || 'null')
    if (!isGraph(saved?.workflow)) return
    workflow.value = saved.workflow
    workflowName.value = saved.name || ''
    imageNodeId.value = saved.imageNodeId || ''; imageInput.value = saved.imageInput || 'image'
    maskNodeId.value = saved.maskNodeId || ''; maskInput.value = saved.maskInput || 'image'
    promptNodeId.value = saved.promptNodeId || ''; promptInput.value = saved.promptInput || 'text'
    outputNodeId.value = saved.outputNodeId || ''
  } catch { /* Ignore damaged local workflow settings. */ }
}
watch([workflow, workflowName, imageNodeId, imageInput, maskNodeId, maskInput, promptNodeId, promptInput, outputNodeId], () => {
  if (!workflow.value) return
  try { localStorage.setItem(workflowKey, JSON.stringify({ workflow: workflow.value, name: workflowName.value,
    imageNodeId: imageNodeId.value, imageInput: imageInput.value, maskNodeId: maskNodeId.value,
    maskInput: maskInput.value, promptNodeId: promptNodeId.value, promptInput: promptInput.value,
    outputNodeId: outputNodeId.value })) } catch { message.warning('本机空间不足，工作流映射未保存') }
}, { deep: true })
watch(() => props.open, open => {
  if (!open || !props.doc) {
    revision++; preparedSources = null
    compositeUrl.value = ''; previewUrl.value = ''; maskUrl.value = ''; resultUrl.value = ''
    preparing.value = false
    return
  }
  const openedDoc = props.doc
  preparedSources = null
  compositeUrl.value = ''; previewUrl.value = ''; maskUrl.value = ''; renderError.value = ''
  previewMode.value = 'composite'
  restoreWorkflow()
  prompt.value = localStorage.getItem(`iib-studio-comfy-prompt-v1:${openedDoc.id}`) || ''
  maskChoice.value = 'all'; resultUrl.value = ''
  keyConfigured.value = false
  void buildPreview()
  void getImageAICreationConfig().then(config => {
    if (!props.open || props.doc !== openedDoc) return
    keyConfigured.value = config.comfy_api_key_configured
    creationMode.value = config.mode; creationModel.value = config.model
  }).catch(() => { if (props.open && props.doc === openedDoc) keyConfigured.value = false })
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
    previewSize.value = `${image.width} × ${image.height}`
    if (!compositeUrl.value) compositeUrl.value = sources.composite.toDataURL('image/png')
    previewUrl.value = image.toDataURL('image/png')
    maskUrl.value = mask.toDataURL('image/png')
    renderError.value = sources.failures.length ? `无法读取图层：${sources.failures.join('、')}` : ''
  } catch { if (current === revision) renderError.value = '无法准备合成预览' }
  finally { if (current === revision) preparing.value = false }
}
async function importWorkflow(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 1_000_000) { message.error('工作流 JSON 不能超过 1 MB'); return }
  try {
    const graph = JSON.parse(await file.text())
    if (!isGraph(graph)) throw new Error('请导入 ComfyUI API 格式 JSON')
    workflow.value = graph; workflowName.value = file.name
    const entries = Object.entries(graph) as [string, ComfyWorkflow[string]][]
    const image = entries.find(([, node]) => /LoadImage$/i.test(node.class_type) && 'image' in node.inputs)
    const mask = entries.find(([, node]) => /LoadImageMask/i.test(node.class_type) && 'image' in node.inputs)
    const text = entries.find(([, node]) => 'text' in node.inputs || 'prompt' in node.inputs)
    const output = entries.find(([, node]) => /SaveImage|PreviewImage/i.test(node.class_type))
    imageNodeId.value = image?.[0] ?? ''; imageInput.value = 'image'
    maskNodeId.value = mask?.[0] ?? ''; maskInput.value = 'image'
    promptNodeId.value = text?.[0] ?? ''; promptInput.value = text && 'text' in text[1].inputs ? 'text' : 'prompt'
    outputNodeId.value = output?.[0] ?? ''
  } catch (error) { message.error(error instanceof Error ? error.message : '工作流读取失败') }
}
function downloadData(url: string, filename: string) {
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
}
async function downloadInput(kind: 'image' | 'mask') {
  if (!props.doc) return
  const canvas = document.createElement('canvas')
  if (kind === 'image') {
    const failures = await renderStudioDocument(canvas, props.doc, props.assetInfo, false, props.scope, 2048, true)
    if (failures.length) { message.error(`无法读取图层：${failures.join('、')}`); return }
  } else renderStudioMask(canvas, props.doc, maskIds.value, 2048)
  cropToInput(canvas, props.doc)
  downloadData(canvas.toDataURL('image/png'), `${props.doc.name}-${kind === 'image' ? '合成图' : '遮罩'}.png`)
}
async function submit() {
  if (!props.doc || !combinedPrompt.value || sending.value || (creationMode.value === 'workflow' && (!workflow.value || !mapped.value))) return
  sending.value = true; resultUrl.value = ''
  try {
    const image = document.createElement('canvas'), mask = document.createElement('canvas')
    const failures = await renderStudioDocument(image, props.doc, props.assetInfo, false, props.scope, 2048, true)
    if (failures.length) throw new Error(`无法读取图层：${failures.join('、')}`)
    if (hasMask.value && creationMode.value === 'workflow') renderStudioMask(mask, props.doc, maskIds.value, 2048)
    cropToInput(image, props.doc)
    if (hasMask.value && creationMode.value === 'workflow') cropToInput(mask, props.doc)
    const imageBase64 = image.toDataURL('image/png').split(',')[1]
    const result = creationMode.value === 'router'
      ? await runStudioRouterEdit({image_base64: imageBase64, prompt: combinedPrompt.value})
      : await runStudioComfyEdit({ image_base64: imageBase64,
        ...(hasMask.value ? { mask_base64: mask.toDataURL('image/png').split(',')[1] } : {}),
        prompt: combinedPrompt.value, workflow: workflow.value!,
        image_node_id: imageNodeId.value, image_input: imageInput.value,
        mask_node_id: hasMask.value ? maskNodeId.value : '', mask_input: hasMask.value ? maskInput.value : '',
        prompt_node_id: promptNodeId.value, prompt_input: promptInput.value, output_node_id: outputNodeId.value })
    resultUrl.value = `data:${result.media_type};base64,${result.image_base64}`
    message.success('AI 加工完成，结果可预览和下载')
  } catch (error) {
    const detail = (error as {response?: {data?: {detail?: string}}})?.response?.data?.detail
    message.error(detail || (error instanceof Error ? error.message : 'AI 加工失败'))
  } finally { sending.value = false }
}
</script>

<template>
  <a-modal :open="open" title="合成预览与 AI 加工" :width="920" :footer="null" :closable="!sending"
    :mask-closable="!sending" :keyboard="!sending" @cancel="emit('update:open', false)">
    <div class="handoff" v-if="doc">
      <div class="handoff-preview">
        <div class="handoff-heading"><strong>{{ previewMode === 'composite' ? '当前画布 · 完整合成' : targetLabel }}</strong><span>{{ previewMode === 'composite' ? `${doc.width} × ${doc.height}` : previewSize || `${doc.width} × ${doc.height}` }}</span></div>
        <div class="preview-mode" role="tablist" aria-label="预览内容">
          <button type="button" role="tab" :aria-selected="previewMode === 'composite'" :class="{active: previewMode === 'composite'}" @click="previewMode = 'composite'">作品预览</button>
          <button type="button" role="tab" :aria-selected="previewMode === 'input'" :class="{active: previewMode === 'input'}" @click="previewMode = 'input'">AI 输入与遮罩</button>
        </div>
        <label class="handoff-field">AI 输入范围<select v-model="inputArea"><option value="content">内容边界</option><option value="canvas">完整画布</option></select></label>
        <figure v-if="previewMode === 'composite'" class="composite-preview"><img v-if="compositeUrl" :src="compositeUrl" alt="包含箭头、提示框、涂抹与遮罩预览色的完整作品" /><figcaption>完整合成预览 · 遮罩以半透明预览色显示</figcaption></figure>
        <div v-else class="preview-pair" :class="{single: creationMode === 'router'}"><figure><img v-if="previewUrl" :src="previewUrl" alt="AI 输入合成图" /><figcaption>实际发送的合成图</figcaption></figure>
          <figure v-if="creationMode === 'workflow'"><img v-if="maskUrl" :src="maskUrl" alt="黑底白色编辑区域遮罩" /><figcaption>遮罩 · 白色修改 / 黑色保留</figcaption></figure></div>
        <p v-if="renderError" class="handoff-error" role="alert">{{ renderError }}</p>
        <div class="handoff-actions"><button type="button" :disabled="preparing" @click="downloadInput('image')">下载合成图</button>
          <button v-if="creationMode === 'workflow'" type="button" :disabled="preparing" @click="downloadInput('mask')">下载遮罩 PNG</button></div>
        <label v-if="creationMode === 'workflow'" class="handoff-field">使用的遮罩<select v-model="maskChoice"><option value="all">全部可见遮罩</option><option value="none">不使用遮罩</option>
          <option v-for="layer in masks" :key="layer.id" :value="layer.id">{{ layer.name }}</option></select></label>
      </div>
      <div class="handoff-config">
        <label class="handoff-field">整体编辑提示词<textarea v-model="prompt" rows="3" placeholder="描述期望的修改或创作结果" /></label>
        <p v-if="annotations.length" class="handoff-note">框、箭头与涂抹会画入 AI 输入图，并附上各自的编辑说明；遮罩仍是单独的黑白通道。普通下载图不包含这些标注。</p>
        <div class="handoff-heading"><strong>{{ creationMode === 'router' ? 'Comfy Router 图像模型' : 'Comfy Cloud 图像编辑工作流' }}</strong><span>{{ creationMode === 'router' ? creationModel : workflowName || '尚未导入' }}</span></div>
        <template v-if="creationMode === 'workflow'"><label class="workflow-file">导入 API 格式 JSON<input type="file" accept=".json,application/json" aria-label="导入图像编辑工作流 JSON" @change="importWorkflow" /></label>
        <p class="handoff-note">图片与遮罩分别映射到加载节点，结果由图片输出节点保存。云端调用会消耗额度。</p>
        <div v-if="workflow" class="workflow-map">
          <label>图片输入节点<select v-model="imageNodeId"><option value="">选择节点</option><option v-for="node in nodes" :key="node.id" :value="node.id">{{ node.label }}</option></select></label>
          <label>字段<select v-model="imageInput"><option v-for="name in inputs(imageNodeId)" :key="name" :value="name">{{ name }}</option></select></label>
          <label>遮罩输入节点<select v-model="maskNodeId"><option value="">不映射遮罩</option><option v-for="node in nodes" :key="node.id" :value="node.id">{{ node.label }}</option></select></label>
          <label>字段<select v-model="maskInput"><option v-for="name in inputs(maskNodeId)" :key="name" :value="name">{{ name }}</option></select></label>
          <label>提示词节点<select v-model="promptNodeId"><option value="">选择节点</option><option v-for="node in nodes" :key="node.id" :value="node.id">{{ node.label }}</option></select></label>
          <label>字段<select v-model="promptInput"><option v-for="name in inputs(promptNodeId)" :key="name" :value="name">{{ name }}</option></select></label>
          <label>图片输出节点<select v-model="outputNodeId"><option value="">选择节点</option><option v-for="node in nodes" :key="node.id" :value="node.id">{{ node.label }}</option></select></label>
        </div></template>
        <p v-if="creationMode === 'router'" class="handoff-note">Router 接收带彩色标注的合成图与提示词；黑白遮罩通道不会上传。需精确遮罩时，在“设置 → AI 接入 → AI 创作接入”切换到 JSON 工作流。</p>
        <p v-if="!keyConfigured" class="handoff-note">请先在“设置 → AI 接入”保存 Comfy API Key。</p>
        <p v-else-if="creationMode === 'workflow' && hasMask && !maskNodeId" class="handoff-note">已绘制遮罩；请映射遮罩加载节点，或选择“不使用遮罩”。</p>
        <button type="button" class="send-button" :disabled="!keyConfigured || (creationMode === 'workflow' && !mapped) || !combinedPrompt || preparing || !!renderError || sending"
          @click="submit">{{ sending ? '云端处理中…' : creationMode === 'router' ? '发送到 Comfy Router' : '发送到 Comfy Cloud' }}</button>
        <div v-if="resultUrl" class="handoff-result"><strong>加工结果</strong><img :src="resultUrl" alt="Comfy Cloud 加工结果" />
          <button type="button" @click="downloadData(resultUrl, `${doc.name}-AI结果.${outputExtension}`)">下载结果</button></div>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
.handoff{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,340px);gap:20px;max-height:72vh;overflow:auto;color:var(--ui-text)}
.handoff-preview,.handoff-config{min-width:0}.handoff-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.handoff-heading strong{font-size:13px;min-width:0}.handoff-heading span{min-width:0;overflow-wrap:anywhere;text-align:right}.handoff-heading span,.handoff-note{font-size:11px;color:var(--ui-muted);line-height:1.5}
.preview-mode{display:flex;gap:4px;width:max-content;max-width:100%;margin-bottom:9px;padding:3px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface-soft)}.preview-mode button{border:0;border-radius:5px;background:transparent;color:var(--ui-muted);padding:5px 10px;cursor:pointer;font-size:11px}.preview-mode button.active{background:var(--ui-surface);color:var(--primary-color);box-shadow:0 1px 4px #0002;font-weight:600}.preview-mode button:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
.preview-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.preview-pair.single{grid-template-columns:1fr}.preview-pair figure,.composite-preview{min-width:0;margin:0;border:1px solid var(--ui-border);border-radius:8px;overflow:hidden;background:var(--ui-surface-soft)}.preview-pair img,.composite-preview img{display:block;width:100%;max-height:300px;aspect-ratio:1;object-fit:contain}.preview-pair figcaption,.composite-preview figcaption{padding:6px;text-align:center;font-size:11px;color:var(--ui-muted)}
.handoff-actions{display:flex;gap:6px;margin:10px 0}.handoff-actions button,.handoff-result button{border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface-soft);color:var(--ui-text);padding:6px 9px;cursor:pointer;font-size:12px}.handoff-field,.workflow-map label{display:flex;flex-direction:column;gap:5px;margin:10px 0;font-size:11px;color:var(--ui-muted)}.handoff-field :is(select,textarea),.workflow-map select{width:100%;min-width:0;box-sizing:border-box;padding:7px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);font:inherit;font-size:12px}
.workflow-file{position:relative;display:inline-flex;margin:4px 0;padding:7px 10px;border:1px solid var(--ui-border);border-radius:6px;cursor:pointer;font-size:12px}.workflow-file input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.workflow-map{display:grid;grid-template-columns:minmax(0,1fr) minmax(80px,110px);gap:0 7px}.workflow-map label:last-child{grid-column:1/-1}.send-button{width:100%;margin-top:9px;padding:9px;border:1px solid var(--primary-color);border-radius:7px;background:var(--primary-color);color:#fff;cursor:pointer}.send-button:disabled{opacity:.5;cursor:default}.handoff-error{color:#b42318;font-size:12px}.handoff-result{display:grid;gap:8px;margin-top:14px}.handoff-result img{max-width:100%;max-height:260px;object-fit:contain;border:1px solid var(--ui-border);border-radius:8px}
@media(max-width:720px){.handoff{grid-template-columns:1fr;max-height:75vh}}
</style>
