<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { FileNodeInfo } from '@/api/files'
import { saveAiImageResult } from '@/api/workspaceArtifacts'
import { getComfyRouterModels, getImageAICreationConfig, listStudioWorkflows, runStudioRouterEdit,
  runStudioWorkflowEdit, workflowPurpose, type ImageAICreationMode, type StudioWorkflowSummary } from '@/api/imageAi'
import { studioLayerVisible, type StudioDocument, type StudioGuideLayer, type StudioMaskLayer, type StudioPaintLayer } from './imageStudioModel'
import { renderStudioDocument, renderStudioMask } from './imageStudioRender'
import { creationChoiceKey, defaultCreationModels, resizableCreationModels, routerAspectRatios } from './imageCreationOptions'
interface ReferenceInput { path: string; name: string; doc: StudioDocument }
const props = defineProps<{ doc: StudioDocument | null; assetInfo: Record<string, FileNodeInfo>;
  referenceInputs: ReferenceInput[]; workspaceId?: string; renderError?: string; revision?: number; readonly?: boolean }>()
const emit = defineEmits<{ artifactSaved: [] }>()
const mode = ref<ImageAICreationMode>('workflow')
const model = ref(defaultCreationModels[1].id)
const models = ref(defaultCreationModels)
const ratios = computed(() => routerAspectRatios(model.value))
const modelError = ref('')
const aspectRatio = ref('auto')
const imageSize = ref<'1K' | '2K' | '4K'>('1K')
const workflows = ref<StudioWorkflowSummary[]>([])
const workflowId = ref('')
const workflowError = ref('')
const parameterDraft = ref<Record<string, string | number | boolean>>({})
const prompt = ref('')
const negativePrompt = ref('')
const useMask = ref(true)
const keyConfigured = ref(false)
const sending = ref(false)
const resultUrl = ref('')
let disposed = false
let modelRequestStarted = false

const selectedWorkflow = computed(() => workflows.value.find(item => item.id === workflowId.value))
watch(selectedWorkflow, workflow => {
  const values: Record<string, string | number | boolean> = {}
  for (const parameter of workflow?.parameters ?? []) {
    if (parameter.kind === 'select') { values[parameter.id] = -1; continue }
    const original = workflow?.parameter_defaults?.[parameter.id]?.[0]
    values[parameter.id] = typeof original === 'boolean' || typeof original === 'number' || typeof original === 'string'
      ? original : parameter.kind === 'number' ? 0 : parameter.kind === 'boolean' ? false : ''
  }
  parameterDraft.value = values
})
const parametersValid = computed(() => (selectedWorkflow.value?.parameters ?? []).every(parameter => {
  const value = parameterDraft.value[parameter.id]
  if (parameter.kind === 'select') return typeof value === 'number' && Number.isInteger(value) && value >= -1 && value < parameter.options.length
  if (parameter.kind === 'boolean') return typeof value === 'boolean'
  if (parameter.kind === 'text') return typeof value === 'string'
  return typeof value === 'number' && Number.isFinite(value) &&
    (parameter.minimum === null || value >= parameter.minimum) &&
    (parameter.maximum === null || value <= parameter.maximum)
}))
function parameterValues() {
  const values: Record<string, string | number | boolean> = {}
  for (const parameter of selectedWorkflow.value?.parameters ?? []) {
    const value = parameterDraft.value[parameter.id]
    if (parameter.kind === 'select') {
      if (typeof value === 'number' && value >= 0) values[parameter.id] = value
    } else if (value !== selectedWorkflow.value?.parameter_defaults?.[parameter.id]?.[0]) values[parameter.id] = value
  }
  return values
}
const inputValue = (event: Event) => (event.target as HTMLInputElement).value
function setNumberParameter(id: string, event: Event) {
  const value = inputValue(event)
  parameterDraft.value[id] = value === '' ? Number.NaN : Number(value)
}
function setBooleanParameter(id: string, event: Event) {
  parameterDraft.value[id] = (event.target as HTMLInputElement).checked
}
const maskLayers = computed(() => props.doc?.layers.filter((layer): layer is StudioMaskLayer =>
  layer.kind === 'mask' && studioLayerVisible(props.doc!, layer)) ?? [])
const hasMask = computed(() => useMask.value && maskLayers.value.some(layer => layer.strokes.some(stroke => stroke.mode === 'paint')))
const annotations = computed(() => props.doc?.layers.filter((layer): layer is StudioGuideLayer | StudioPaintLayer =>
  (layer.kind === 'guide' || layer.kind === 'paint') && studioLayerVisible(props.doc!, layer)) ?? [])
const combinedPrompt = computed(() => {
  const guides = annotations.value.filter((layer): layer is StudioGuideLayer => layer.kind === 'guide' && !!layer.prompt.trim())
  const paints = annotations.value.filter((layer): layer is StudioPaintLayer => layer.kind === 'paint' && !!layer.prompt.trim())
  const instructions = [prompt.value.trim(), ...guides.map(layer =>
    `请修改${layer.color.toLowerCase() === '#ef4444' ? '红色' : layer.color.toUpperCase() + ' 色'}${layer.shape === 'arrow' ? '箭头指向' : '方框内'}的区域：${layer.prompt.trim()}`),
  ...paints.map(layer => `请去掉${layer.color.toLowerCase() === '#ef4444' ? '红色' : layer.color.toUpperCase() + ' 色'}涂抹标注，并编辑其覆盖的区域：${layer.prompt.trim()}`)]
    .filter(Boolean)
  return instructions.length ? [...(annotations.value.length ? ['图中的彩色框、箭头与涂抹是定位标注；涂抹颜色不是最终颜色，结果中应去除这些标注。'] : []),
    ...instructions].join('\n') : ''
})
const maxReferences = computed(() => mode.value === 'workflow' ? selectedWorkflow.value?.reference_slots.length ?? 0
  : model.value === 'vertexai/gemini-2.5-flash-image' ? 2 : 13)
const usedReferences = computed(() => Math.min(props.referenceInputs.length, maxReferences.value))
const effectiveSize = (source: StudioDocument) => {
  const ratio = Math.min(1, 2048 / Math.max(source.width, source.height))
  return `${Math.round(source.width * ratio)} × ${Math.round(source.height * ratio)}`
}
const inputSize = computed(() => props.doc ? effectiveSize(props.doc) : '')
const workflowUsesMask = computed(() => selectedWorkflow.value?.mask_enabled !== false &&
  !!(selectedWorkflow.value?.mask_node_id || selectedWorkflow.value?.mask_from_image))
const canSubmit = computed(() => !!props.doc && !props.readonly && !props.renderError && keyConfigured.value &&
  !sending.value &&
  (mode.value === 'router' ? !!model.value && !!combinedPrompt.value :
    !!selectedWorkflow.value?.image_node_id && !!selectedWorkflow.value?.output_node_id &&
    parametersValid.value && (!selectedWorkflow.value.prompt_node_id || !!combinedPrompt.value)))

function rememberChoice() {
  resultUrl.value = ''
  if (aspectRatio.value !== 'auto' && !ratios.value.includes(aspectRatio.value)) aspectRatio.value = 'auto'
  try { localStorage.setItem(creationChoiceKey, JSON.stringify({ mode: mode.value, model: model.value,
    aspectRatio: aspectRatio.value, imageSize: imageSize.value, workflowId: workflowId.value })) }
  catch { /* Keep the current selection for this session. */ }
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
    if (!models.value.some(item => item.id === model.value)) model.value = models.value[0]?.id || ''
  } catch { if (!disposed) modelError.value = '暂时无法更新模型列表，仍可选择已适配模型。' }
}
onMounted(async () => {
  try {
    const saved = JSON.parse(localStorage.getItem(creationChoiceKey) || 'null') as Record<string, unknown> | null
    if (saved?.mode === 'router' || saved?.mode === 'workflow') mode.value = saved.mode
    if (typeof saved?.model === 'string') model.value = saved.model
    if (typeof saved?.workflowId === 'string') workflowId.value = saved.workflowId
    if (typeof saved?.aspectRatio === 'string') aspectRatio.value = saved.aspectRatio
    if (saved?.imageSize === '1K' || saved?.imageSize === '2K' || saved?.imageSize === '4K') imageSize.value = saved.imageSize
  } catch { /* Use the defaults. */ }
  const [config, library] = await Promise.allSettled([getImageAICreationConfig(), listStudioWorkflows()])
  if (disposed) return
  if (config.status === 'fulfilled') {
    keyConfigured.value = config.value.comfy_api_key_configured
    if (mode.value === 'router') void loadModels()
  }
  if (library.status === 'fulfilled') {
    workflows.value = library.value.filter(item => workflowPurpose(item) === 'image_edit')
    if (!workflows.value.some(item => item.id === workflowId.value)) workflowId.value = workflows.value[0]?.id ?? ''
  } else workflowError.value = '工作流列表暂时无法读取'
})
onBeforeUnmount(() => { disposed = true })
watch(() => props.doc?.id, () => {
  resultUrl.value = ''
  try {
    prompt.value = props.doc ? localStorage.getItem(`iib-studio-comfy-prompt-v1:${props.doc.id}`) || '' : ''
    negativePrompt.value = props.doc ? localStorage.getItem(`iib-studio-comfy-negative-prompt-v1:${props.doc.id}`) || '' : ''
  } catch { prompt.value = ''; negativePrompt.value = '' }
}, { immediate: true })
watch(() => props.revision, () => { resultUrl.value = '' })
watch(prompt, value => {
  if (!props.doc) return
  resultUrl.value = ''
  try { localStorage.setItem(`iib-studio-comfy-prompt-v1:${props.doc.id}`, value) } catch { /* Keep the current draft. */ }
})
watch(negativePrompt, value => {
  if (!props.doc) return
  resultUrl.value = ''
  try { localStorage.setItem(`iib-studio-comfy-negative-prompt-v1:${props.doc.id}`, value) } catch { /* Keep the current draft. */ }
})

function downloadResult() {
  if (!resultUrl.value || !props.doc) return
  const extension = resultUrl.value.startsWith('data:image/jpeg') ? 'jpg' : resultUrl.value.startsWith('data:image/webp') ? 'webp' : 'png'
  const anchor = document.createElement('a')
  anchor.href = resultUrl.value; anchor.download = `${props.doc.name}-AI结果.${extension}`
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
}
async function submit() {
  if (!canSubmit.value || !props.doc) return
  const source = JSON.parse(JSON.stringify(props.doc)) as StudioDocument
  const referenceSources = props.referenceInputs.slice(0, usedReferences.value).map(item => ({ name: item.name,
    doc: JSON.parse(JSON.stringify(item.doc)) as StudioDocument }))
  const instruction = combinedPrompt.value
  const chosenReferences: string[] = []
  const usesMask = mode.value === 'workflow' && hasMask.value && workflowUsesMask.value
  sending.value = true; resultUrl.value = ''
  try {
    const image = document.createElement('canvas')
    const failures = await renderStudioDocument(image, source, props.assetInfo, false, { kind: 'all' }, 2048, true)
    if (failures.length) throw new Error(`无法读取图层：${failures.join('、')}`)
    const imageBase64 = image.toDataURL('image/png').split(',')[1]
    for (const reference of referenceSources) {
      const referenceCanvas = document.createElement('canvas')
      const referenceFailures = await renderStudioDocument(referenceCanvas, reference.doc, props.assetInfo, false, { kind: 'all' }, 2048)
      if (referenceFailures.length) throw new Error(`无法读取参考图：${referenceFailures.join('、')}`)
      chosenReferences.push(referenceCanvas.toDataURL('image/png').split(',')[1])
    }
    const mask = document.createElement('canvas')
    if (usesMask) renderStudioMask(mask, source, undefined, 2048)
    const result = mode.value === 'router'
      ? await runStudioRouterEdit({ image_base64: imageBase64, prompt: instruction, model: model.value,
        ...(aspectRatio.value !== 'auto' ? { aspect_ratio: aspectRatio.value } : {}),
        ...(resizableCreationModels.includes(model.value) ? { image_size: imageSize.value } : {}),
        reference_images_base64: chosenReferences })
      : await runStudioWorkflowEdit({ workflow_id: workflowId.value, image_base64: imageBase64,
        ...(usesMask ? { mask_base64: mask.toDataURL('image/png').split(',')[1] } : {}),
        reference_images_base64: chosenReferences, prompt: instruction, negative_prompt: negativePrompt.value,
        parameter_values: parameterValues() })
    resultUrl.value = `data:${result.media_type};base64,${result.image_base64}`
    if (props.workspaceId) {
      try {
        await saveAiImageResult(props.workspaceId, `${source.name}-AI结果`, result)
        emit('artifactSaved')
        message.success('AI 加工完成，结果已保存到工作区素材')
      } catch {
        message.warning('AI 加工完成，但结果未能保存到工作区；请先下载图片')
      }
    } else message.success('AI 加工完成；请下载图片保存结果')
  } catch (error) {
    const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
    message.error(detail || (error instanceof Error ? error.message : 'AI 加工失败'))
  } finally { sending.value = false }
}
</script>

<template>
  <section class="ai-image-process" aria-label="AI 加工设置">
    <header><strong>AI 加工</strong></header>
    <div class="process-fields">
      <div class="mode-switch" role="group" aria-label="创作方式">
        <button type="button" :class="{active: mode === 'workflow'}" :aria-pressed="mode === 'workflow'" :disabled="sending || readonly" @click="switchMode('workflow')"><strong>工作流</strong><small>Comfy Cloud</small></button>
        <button type="button" :class="{active: mode === 'router'}" :aria-pressed="mode === 'router'" :disabled="sending || readonly" @click="switchMode('router')"><strong>图像模型</strong><small>Comfy Router</small></button>
      </div>
      <section class="process-section"><div class="section-heading"><strong>生成配置</strong><span>{{ mode === 'workflow' ? '按工作流映射' : '按模型设置' }}</span></div>
        <template v-if="mode === 'workflow'"><label>工作流<select v-model="workflowId" :disabled="sending || readonly" @change="rememberChoice"><option value="">选择工作流</option><option v-for="item in workflows" :key="item.id" :value="item.id">{{ item.name }}</option></select></label>
          <p v-if="workflowError" class="process-note error" role="alert">{{ workflowError }}</p>
          <p v-else-if="!workflows.length" class="process-note">还没有工作流，请到“工作流管理”导入。</p>
        </template>
        <template v-else><label>模型<select v-model="model" :disabled="sending || readonly" @change="rememberChoice"><option v-for="item in models" :key="item.id" :value="item.id">{{ item.label }}</option></select></label>
          <div class="output-fields" :class="{single: !resizableCreationModels.includes(model)}"><label>输出比例<select v-model="aspectRatio" :disabled="sending || readonly" @change="rememberChoice"><option value="auto">模型自动</option><option v-for="ratio in ratios" :key="ratio">{{ ratio }}</option></select></label>
            <label v-if="resizableCreationModels.includes(model)">输出分辨率<select v-model="imageSize" :disabled="sending || readonly" @change="rememberChoice"><option value="1K">1K</option><option value="2K">2K</option><option value="4K">4K</option></select></label></div>
          <p v-if="modelError" class="process-note" role="status">{{ modelError }}</p></template>
      </section>
      <section v-if="mode === 'router' || selectedWorkflow" class="process-section"><div class="section-heading"><strong>编辑要求</strong><span v-if="mode === 'workflow'">按映射显示</span></div>
        <label v-if="mode === 'router' || selectedWorkflow?.prompt_node_id">{{ mode === 'workflow' ? '正向提示词' : '整体编辑提示词' }}<textarea v-model="prompt" rows="4" :disabled="sending || readonly" placeholder="描述希望怎样修改图片" /></label>
        <p v-else class="process-note">未映射正向提示词，将沿用工作流 JSON 中的设置。</p>
        <label v-if="mode === 'workflow' && selectedWorkflow?.negative_prompt_node_id">负向提示词<textarea v-model="negativePrompt" rows="3" :disabled="sending || readonly" placeholder="描述不希望出现的内容；留空将传入空文本" /></label>
        <div v-if="mode === 'workflow' && selectedWorkflow?.parameters.length" class="workflow-parameters"><strong>可调参数</strong>
          <div v-for="parameter in selectedWorkflow.parameters" :key="parameter.id" class="workflow-parameter">
            <label v-if="parameter.kind === 'number'">{{ parameter.name }}<input type="number" :value="parameterDraft[parameter.id]" :min="parameter.minimum ?? undefined" :max="parameter.maximum ?? undefined" :step="parameter.step ?? 'any'" :disabled="sending || readonly" @input="setNumberParameter(parameter.id, $event)" /></label>
            <label v-else-if="parameter.kind === 'text'">{{ parameter.name }}<input type="text" :value="parameterDraft[parameter.id]" :disabled="sending || readonly" @input="parameterDraft[parameter.id] = inputValue($event)" /></label>
            <label v-else-if="parameter.kind === 'boolean'" class="workflow-parameter-toggle"><input type="checkbox" :checked="parameterDraft[parameter.id] === true" :disabled="sending || readonly" @change="setBooleanParameter(parameter.id, $event)" />{{ parameter.name }}</label>
            <label v-else>{{ parameter.name }}<select :value="parameterDraft[parameter.id]" :disabled="sending || readonly" @change="parameterDraft[parameter.id] = Number(inputValue($event))">
              <option :value="-1">保持工作流默认</option><option v-for="(option, index) in parameter.options" :key="index" :value="index">{{ option.name }}</option>
            </select></label>
          </div>
        </div>
        <p v-if="annotations.some(layer => layer.prompt.trim()) && (mode === 'router' || selectedWorkflow?.prompt_node_id)" class="process-note">提示框、箭头和涂抹说明会一起加入提示词。</p>
      </section>
      <section class="process-section input-section"><div class="section-heading"><strong>输入素材</strong><span>本次提交</span></div>
        <div class="input-stats"><div><span>主图</span><strong>{{ inputSize }} px</strong></div><div><span>参考图</span><strong>{{ usedReferences }} / {{ maxReferences }} 张</strong></div></div>
        <div v-if="referenceInputs.length" class="reference-list"><span v-for="(item, index) in referenceInputs" :key="item.path" :class="{ ignored: index >= usedReferences }" :title="`${item.name} · ${effectiveSize(item.doc)} px${index >= usedReferences ? ' · 本次忽略' : ''}`">{{ item.name }}{{ index >= usedReferences ? ' · 忽略' : '' }}</span></div>
        <p v-if="referenceInputs.length > maxReferences" class="process-note warning">超出输入位的 {{ referenceInputs.length - usedReferences }} 张参考图将在本次提交中忽略。</p>
        <label v-if="maskLayers.length" class="mask-option"><input v-model="useMask" type="checkbox" :disabled="sending || readonly" />使用遮罩通道</label>
        <p v-if="hasMask && mode === 'workflow' && selectedWorkflow && !workflowUsesMask" class="process-note warning">当前工作流没有遮罩通道，本次提交将忽略遮罩。</p>
        <p v-if="hasMask && mode === 'router'" class="process-note warning">当前图像模型没有独立遮罩通道，本次提交将忽略遮罩。</p>
      </section>
      <div v-if="resultUrl" class="result"><strong>加工结果</strong><img :src="resultUrl" alt="AI 加工结果" /><button type="button" @click="downloadResult">下载结果</button></div>
    </div>
    <footer><p v-if="!keyConfigured" class="process-note">请先在“设置 → AI 接入”保存 Comfy API Key。</p>
      <p v-else-if="mode === 'workflow' && selectedWorkflow && !selectedWorkflow.output_node_id" class="process-note">运行前请在工作流管理中设置图片结果节点。</p>
      <button type="button" class="submit" :disabled="!canSubmit" @click="submit">{{ sending ? '云端处理中…' : '开始 AI 加工' }}</button></footer>
  </section>
</template>

<style scoped>
.ai-image-process{display:flex;flex-direction:column;min-width:0;min-height:580px;max-height:calc(100vh - 178px);border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface);color:var(--ui-text);overflow:hidden}.ai-image-process>header{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:14px 16px;border-bottom:1px solid var(--ui-border)}header strong{font-size:15px}header span,.process-note,.input-heading span{color:var(--ui-muted);font-size:11px}.process-fields{flex:1;min-height:0;overflow:auto;padding:14px 16px}.process-fields>label,.output-fields label{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;color:var(--ui-muted);font-size:11px}.process-fields :is(select,textarea,input[type=search]){width:100%;box-sizing:border-box;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);padding:8px;font:inherit;font-size:12px}.process-fields textarea{resize:vertical;line-height:1.5}.output-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.process-note{margin:7px 0 12px;line-height:1.5}.process-note.error{color:#b42318}.input-heading{display:flex;justify-content:space-between;align-items:center;margin:15px 0 8px}.input-heading strong{font-size:12px}.reference-list{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:8px}.reference-item{display:flex;align-items:center;gap:7px;min-width:0;max-width:180px;padding:4px;border:1px solid var(--ui-border);border-radius:6px}.reference-item img,.reference-picker img{width:32px;height:32px;object-fit:cover;border-radius:4px}.reference-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.reference-item button{border:0;background:transparent;color:var(--ui-muted);cursor:pointer}.add-reference{width:100%;padding:8px;border:1px dashed var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--primary-color);cursor:pointer;font-size:12px}.add-reference:disabled{opacity:.45;cursor:default}.reference-picker{margin-top:8px;padding:9px;border:1px solid var(--ui-border);border-radius:7px}.reference-picker>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;max-height:185px;overflow:auto;margin-top:7px}.reference-picker button{display:flex;align-items:center;gap:7px;min-width:0;border:1px solid var(--ui-border);border-radius:5px;background:var(--ui-surface);color:var(--ui-text);padding:4px;text-align:left;cursor:pointer}.reference-picker button:disabled{opacity:.5}.reference-picker button span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.process-fields>.mask-option{display:flex;align-items:center;flex-direction:row;gap:7px;margin-top:12px}.mask-option input{accent-color:var(--primary-color)}.result{display:flex;flex-direction:column;gap:9px;margin-top:18px;padding-top:15px;border-top:1px solid var(--ui-border)}.result strong{font-size:12px}.result img{display:block;max-width:100%;max-height:320px;object-fit:contain;background:var(--ui-surface-soft)}.result button{align-self:flex-start;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);padding:6px 10px;cursor:pointer}.ai-image-process>footer{padding:12px 16px;border-top:1px solid var(--ui-border)}footer .process-note{margin:0 0 8px}.submit{width:100%;padding:10px;border:1px solid var(--primary-color);border-radius:7px;background:var(--primary-color);color:#fff;cursor:pointer;font-size:12px}.submit:disabled{opacity:.5;cursor:default}@media(max-width:1020px){.ai-image-process{max-height:none;min-height:430px}}
.reference-item{align-items:flex-start;flex-direction:column;gap:3px;padding:6px 8px}
.reference-item small{color:var(--ui-muted);font-size:10px}
.ai-image-process{min-height:440px}
.workflow-parameters{margin:2px 0 15px;padding:11px;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface-soft)}
.workflow-parameters>strong{display:block;margin-bottom:10px;font-size:12px}.workflow-parameter{margin-top:9px}
.workflow-parameter label{display:flex;flex-direction:column;gap:6px;color:var(--ui-muted);font-size:11px}
.workflow-parameter label.workflow-parameter-toggle{align-items:center;flex-direction:row;color:var(--ui-text)}
.workflow-parameter-toggle input{accent-color:var(--primary-color)}
.ai-image-process>header{align-items:center;padding:13px 15px}
.process-fields{display:flex;flex-direction:column;gap:10px;padding:12px}
.mode-switch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px;padding:3px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface-soft)}
.mode-switch button{display:flex;align-items:center;justify-content:center;gap:7px;min-width:0;min-height:34px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--ui-muted);cursor:pointer}
.mode-switch button strong{font-size:12px;font-weight:650}.mode-switch button small{font-size:10px}.mode-switch button.active{border-color:var(--ui-border);background:var(--ui-surface);color:var(--primary-color);box-shadow:0 1px 3px #0000000b}
.mode-switch button:disabled{opacity:.6;cursor:default}
.process-section{padding:12px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface)}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:10px}.section-heading strong{font-size:12px}.section-heading span{color:var(--ui-muted);font-size:10px}
.process-section label{display:flex;flex-direction:column;gap:6px;margin-bottom:11px;color:var(--ui-muted);font-size:11px}
.process-section label:last-child{margin-bottom:0}
.process-section :is(select,textarea,input[type=number],input[type=text]){width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);font:inherit;font-size:12px}
.process-section textarea{min-height:78px;resize:vertical;line-height:1.5}
.output-fields{gap:8px}.output-fields.single{grid-template-columns:1fr}.output-fields label{margin-bottom:0}
.process-note{margin:8px 0 0}.process-note.error{color:#b42318}
.process-note.warning{color:color-mix(in srgb,var(--ui-amber,#a86a08) 76%,var(--ui-text) 24%)}
.workflow-parameters{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:11px 0 0;padding:11px 0 0;border:0;border-top:1px solid var(--ui-border);border-radius:0;background:transparent}
.workflow-parameters>strong{grid-column:1/-1;margin:0;font-size:11px}.workflow-parameter{min-width:0;margin:0}.workflow-parameter:has(input[type=text]),.workflow-parameter:has(input[type=checkbox]){grid-column:1/-1}
.workflow-parameter label{margin:0}.workflow-parameter label.workflow-parameter-toggle{margin:0}
.input-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.input-stats>div{display:flex;align-items:baseline;justify-content:space-between;gap:5px;min-width:0;padding:8px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface-soft)}
.input-stats span{color:var(--ui-muted);font-size:10px}.input-stats strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:650}
.reference-list{display:flex;flex-wrap:wrap;gap:5px;margin:9px 0 0}.reference-list>span{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 7px;border:1px solid var(--ui-border);border-radius:5px;color:var(--ui-muted);font-size:10px}
.reference-list>span.ignored{border-color:color-mix(in srgb,var(--ui-amber,#a86a08) 35%,var(--ui-border));color:color-mix(in srgb,var(--ui-amber,#a86a08) 76%,var(--ui-text) 24%)}
.process-section label.mask-option{align-items:center;flex-direction:row;gap:7px;margin:10px 0 0;color:var(--ui-text)}.mask-option input{accent-color:var(--primary-color)}
.result{margin:2px 0 0;padding:12px;border:1px solid var(--ui-border);border-radius:8px}.ai-image-process>footer{padding:11px 12px}
</style>
