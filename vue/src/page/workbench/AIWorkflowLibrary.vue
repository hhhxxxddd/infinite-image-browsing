<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { message, Modal } from 'ant-design-vue'
import { DeleteOutlined, FileAddOutlined, RobotOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/api/files'
import {
  createStudioWorkflow, deleteStudioWorkflow, getStudioWorkflow, listStudioWorkflows, updateStudioWorkflow,
  studioWorkflowPurposeLabels, workflowPurpose,
  type ComfyWorkflow, type StudioWorkflowParameter, type StudioWorkflowPresetInput,
  type StudioWorkflowPurpose, type StudioWorkflowSummary,
} from '@/api/imageAi'
import type { WorkspaceRecord } from './workspaceModel'
import AIImageEditor from './AIImageEditor.vue'

const AIWorkflowGraph = defineAsyncComponent(() => import('./AIWorkflowGraph.vue'))

const props = defineProps<{ workspace?: WorkspaceRecord; assetInfo: Record<string, FileNodeInfo>; readonly?: boolean }>()
const emit = defineEmits<{ artifactSaved: [] }>()
const legacyKey = 'iib-studio-comfy-edit-workflow-v1'
const rows = ref<StudioWorkflowSummary[]>([])
const sortedRows = computed(() => [...rows.value].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', {numeric: true})))
const selectedId = ref('')
const draft = ref<StudioWorkflowPresetInput | null>(null)
const legacyDraft = ref(false)
const savedSnapshot = ref('')
const loading = ref(false), saving = ref(false), error = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const section = ref<'generation' | 'edit' | 'audio' | 'video' | 'workflows'>('edit')
const sectionTabs = [
  {id: 'generation', label: '图片生成'}, {id: 'edit', label: '图片编辑'},
  {id: 'audio', label: '音频创作'}, {id: 'video', label: '视频创作'},
  {id: 'workflows', label: '工作流管理'},
] as const
const sectionPurpose = computed<StudioWorkflowPurpose | null>(() => {
  if (section.value === 'generation') return 'image_generation'
  if (section.value === 'edit') return 'image_edit'
  if (section.value === 'audio') return 'audio_creation'
  if (section.value === 'video') return 'video_creation'
  return null
})
const categoryWorkflows = computed(() => sortedRows.value.filter(item => workflowPurpose(item) === sectionPurpose.value))
const sectionLabel = computed(() => sectionPurpose.value ? studioWorkflowPurposeLabels[sectionPurpose.value] : '全局工作流')
const selectedNodeId = ref('')
const parameterOpen = ref(false)
const inputs = (id: string) => Object.keys(draft.value?.workflow[id]?.inputs ?? {})
const isScalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
const isReservedParameterTarget = (id: string, input: string) => !!draft.value && (
  draft.value.image_node_id === id && draft.value.image_input === input ||
  draft.value.mask_node_id === id && draft.value.mask_input === input ||
  draft.value.prompt_node_id === id && draft.value.prompt_input === input ||
  draft.value.negative_prompt_node_id === id && draft.value.negative_prompt_input === input ||
  draft.value.reference_slots.some(slot => slot.node_id === id && slot.input === input))
const scalarInputs = (id: string) => Object.entries(draft.value?.workflow[id]?.inputs ?? {})
  .filter(([name, value]) => isScalar(value) && !isReservedParameterTarget(id, name)).map(([name]) => name)
const parameterNodes = computed(() => Object.entries(draft.value?.workflow ?? {})
  .filter(([id]) => scalarInputs(id).length).map(([id, node]) => ({id, title: node._meta?.title || node.class_type})))
const targetValue = (nodeId: string, input: string) => draft.value?.workflow[nodeId]?.inputs[input]
const valueText = (value: unknown) => typeof value === 'boolean' ? String(value) : String(value ?? '')
const selectedNode = computed(() => {
  const node = draft.value?.workflow[selectedNodeId.value]
  return node ? {id: selectedNodeId.value, node, title: node._meta?.title || node.class_type} : null
})
const textInputs = (id: string) => {
  const node = draft.value?.workflow[id]
  if (!node) return []
  const scalar = Object.keys(node.inputs).filter(name => typeof node.inputs[name] === 'string')
  const likely = scalar.filter(name => /prompt|text|instruction|description|caption|negative|positive/i.test(name))
  return likely.length ? likely : /prompt|text|clip|string|提示词|负向/i.test(`${node.class_type} ${node._meta?.title || ''}`) ? scalar : []
}
const isImageNode = (id: string) => !!draft.value?.workflow[id] && /LoadImage$/i.test(draft.value.workflow[id].class_type) &&
  'image' in draft.value.workflow[id].inputs
const isOutputNode = (id: string) => !!draft.value?.workflow[id] && /SaveImage|PreviewImage/i.test(draft.value.workflow[id].class_type)
const isPromptNode = (id: string) => textInputs(id).length > 0
function maskFromMainImage(graph: ComfyWorkflow, imageNodeId: string): boolean {
  if (graph[imageNodeId]?.class_type !== 'LoadImage') return false
  return Object.values(graph).some(node => Object.entries(node.inputs).some(([name, value]) =>
    name.toLowerCase().includes('mask') && Array.isArray(value) && value[0] === imageNodeId && value[1] === 1))
}
const maskFromImage = computed(() => !!draft.value && maskFromMainImage(draft.value.workflow, draft.value.image_node_id))
const maskMapped = computed(() => !!draft.value && (maskFromImage.value || !!draft.value.mask_node_id))
const dirty = computed(() => !!draft.value && (!selectedId.value || JSON.stringify(draft.value) !== savedSnapshot.value))

function isGraph(value: unknown): value is ComfyWorkflow {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length > 0 && Object.keys(value).length <= 256 &&
    Object.values(value).every(node => !!node && typeof node === 'object' &&
      typeof (node as ComfyWorkflow[string]).class_type === 'string' &&
      !!(node as ComfyWorkflow[string]).inputs && typeof (node as ComfyWorkflow[string]).inputs === 'object' &&
      !Array.isArray((node as ComfyWorkflow[string]).inputs))
}
function initialDraft(graph: ComfyWorkflow, name: string): StudioWorkflowPresetInput {
  const entries = Object.entries(graph)
  const images = entries.filter(([, node]) => /LoadImage$/i.test(node.class_type) && 'image' in node.inputs)
  const mask = entries.find(([, node]) => /LoadImageMask/i.test(node.class_type) && 'image' in node.inputs)
  const fromImage = maskFromMainImage(graph, images[0]?.[0] ?? '')
  const textCandidates = entries.filter(([, node]) => typeof node.inputs.text === 'string' || typeof node.inputs.prompt === 'string')
  const text = textCandidates.find(([, node]) => !/negative|负向/i.test(node._meta?.title || '')) ||
    entries.find(([, node]) => /user prompt|用户提示|正向提示/i.test(node._meta?.title || '') &&
      Object.values(node.inputs).some(value => typeof value === 'string')) || textCandidates[0]
  const textInput = text && (['text', 'prompt', 'value'].find(key => typeof text[1].inputs[key] === 'string') ||
    Object.keys(text[1].inputs).find(key => typeof text[1].inputs[key] === 'string'))
  const negative = entries.find(([, node]) => Object.entries(node.inputs).some(([key, value]) =>
    /negative/i.test(key) && typeof value === 'string')) || textCandidates.find(([, node]) =>
    /negative|负向/i.test(node._meta?.title || ''))
  const negativeInput = negative && (Object.keys(negative[1].inputs).find(key =>
    /negative/i.test(key) && typeof negative[1].inputs[key] === 'string') ||
    (typeof negative[1].inputs.text === 'string' ? 'text' : '') ||
    (typeof negative[1].inputs.prompt === 'string' ? 'prompt' : ''))
  const output = entries.find(([, node]) => /SaveImage|PreviewImage/i.test(node.class_type))
  return {name: name.replace(/\.json$/i, ''), purpose: 'image_edit', workflow: graph,
    image_node_id: images[0]?.[0] ?? '', image_input: 'image',
    mask_node_id: fromImage ? '' : mask?.[0] ?? '', mask_input: !fromImage && mask ? 'image' : '',
    mask_enabled: fromImage || !!mask,
    prompt_node_id: textInput ? text?.[0] || '' : '', prompt_input: textInput || '',
    negative_prompt_node_id: negativeInput ? negative?.[0] || '' : '', negative_prompt_input: negativeInput || '',
    output_node_id: output?.[0] ?? '',
    reference_slots: images.slice(1).map(([node_id]) => ({node_id, input: 'image'})), parameters: []}
}
async function refresh() {
  loading.value = true; error.value = ''
  try { rows.value = await listStudioWorkflows() }
  catch { error.value = '无法读取工作流库'; rows.value = [] }
  finally { loading.value = false }
}
async function select(id: string, force = false) {
  if (!force && id === selectedId.value && draft.value) return
  if (!force && dirty.value && id !== selectedId.value) {
    Modal.confirm({title: '放弃未保存的映射？', content: '当前工作流的修改尚未保存。', okText: '放弃修改', cancelText: '继续编辑',
      onOk: () => select(id, true)})
    return
  }
  parameterOpen.value = false
  selectedId.value = id; draft.value = null; legacyDraft.value = false
  try {
    const item = await getStudioWorkflow(id)
    if (selectedId.value === id) {
      draft.value = {name: item.name, purpose: workflowPurpose(item), workflow: item.workflow,
        image_node_id: item.image_node_id, image_input: item.image_input,
        mask_node_id: item.mask_node_id, mask_input: item.mask_input,
        mask_enabled: item.mask_enabled ?? true,
        prompt_node_id: item.prompt_node_id, prompt_input: item.prompt_input,
        negative_prompt_node_id: item.negative_prompt_node_id ?? '', negative_prompt_input: item.negative_prompt_input ?? '',
        output_node_id: item.output_node_id, reference_slots: item.reference_slots.map(slot => ({...slot})),
        parameters: structuredClone(item.parameters ?? [])}
      savedSnapshot.value = JSON.stringify(draft.value)
      selectedNodeId.value = item.image_node_id || Object.keys(item.workflow)[0] || ''
    }
  } catch { message.error('工作流读取失败') }
}
async function importFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (file.size > 1_000_000) { message.error('工作流 JSON 不能超过 1 MB'); return }
  try {
    const graph: unknown = JSON.parse(await file.text())
    if (!isGraph(graph)) throw new Error('请导入 ComfyUI 的 API 格式 JSON')
    const apply = () => {
      parameterOpen.value = false
      selectedId.value = ''; draft.value = initialDraft(graph, file.name); legacyDraft.value = false; savedSnapshot.value = ''
      selectedNodeId.value = draft.value.image_node_id || Object.keys(graph)[0] || ''
    }
    if (dirty.value) Modal.confirm({title: '放弃未保存的映射？', content: '导入新工作流会替换当前编辑内容。',
      okText: '继续导入', cancelText: '继续编辑', onOk: apply})
    else apply()
  } catch (cause) { message.error(cause instanceof Error ? cause.message : '工作流读取失败') }
}
function setNode(field: 'image' | 'mask' | 'prompt' | 'negative_prompt', id: string) {
  if (!draft.value) return
  draft.value[`${field}_node_id`] = id
  const input = field === 'prompt' || field === 'negative_prompt' ? textInputs(id) : inputs(id)
  const defaultInput = field === 'prompt' || field === 'negative_prompt'
    ? (field === 'negative_prompt' ? input.find(name => /negative/i.test(name)) : input.find(name => /^(text|prompt|positive_prompt)$/i.test(name))) ||
      input.find(name => typeof draft.value?.workflow[id]?.inputs[name] === 'string')
    : input.find(name => name === 'image')
  draft.value[`${field}_input`] = id ? defaultInput || input[0] || '' : ''
  if (field === 'image' && maskFromMainImage(draft.value.workflow, id)) {
    draft.value.mask_node_id = ''
    draft.value.mask_input = ''
  }
  if (field === 'mask' && id) draft.value.mask_enabled = true
}
function setImageRole(id: string, role: 'main' | 'reference' | 'internal') {
  if (!draft.value || !isImageNode(id)) return
  draft.value.reference_slots = draft.value.reference_slots.filter(slot => slot.node_id !== id)
  if (draft.value.image_node_id === id && role !== 'main') setNode('image', '')
  if (role === 'main') {
    setNode('image', id)
    draft.value.mask_enabled = maskFromImage.value
  } else if (role === 'reference' && draft.value.reference_slots.length < 13)
    draft.value.reference_slots.push({node_id: id, input: 'image'})
}
function keepOnlyMain() {
  if (!draft.value) return
  draft.value.reference_slots = []
  draft.value.mask_node_id = ''
  draft.value.mask_input = ''
  draft.value.mask_enabled = false
  draft.value.prompt_node_id = ''
  draft.value.prompt_input = ''
  draft.value.negative_prompt_node_id = ''
  draft.value.negative_prompt_input = ''
  draft.value.output_node_id = ''
}
function moveReference(id: string, direction: number) {
  if (!draft.value) return
  const index = draft.value.reference_slots.findIndex(slot => slot.node_id === id)
  const next = index + direction
  if (index < 0 || next < 0 || next >= draft.value.reference_slots.length) return
  const slots = draft.value.reference_slots
  ;[slots[index], slots[next]] = [slots[next], slots[index]]
}
function addParameter(nodeId?: string, input?: string) {
  if (!draft.value) return
  const target = nodeId && input ? {node_id: nodeId, input} : nextParameterTarget()
  if (!target || !isScalar(targetValue(target.node_id, target.input))) return
  if (draft.value.parameters.some(parameter => parameter.targets.some(item => item.node_id === target.node_id && item.input === target.input))) return
  const original = targetValue(target.node_id, target.input)
  draft.value.parameters.push({id: crypto.randomUUID(), name: target.input,
    kind: typeof original === 'number' ? 'number' : typeof original === 'boolean' ? 'boolean' : 'text',
    targets: [target], options: [], minimum: null, maximum: null, step: null})
  parameterOpen.value = true
}
const selectValue = (event: Event) => (event.target as HTMLSelectElement).value
function parameterKinds(parameter: StudioWorkflowParameter) {
  const original = targetValue(parameter.targets[0]?.node_id || '', parameter.targets[0]?.input || '')
  return typeof original === 'number' ? ['number', 'select'] :
    typeof original === 'boolean' ? ['boolean', 'select'] : ['text', 'select']
}
function changeParameterKind(parameter: StudioWorkflowParameter, kind: StudioWorkflowParameter['kind']) {
  parameter.kind = kind
  if (kind === 'select') {
    parameter.options = [{name: '默认', values: parameter.targets.map(target =>
      valueText(targetValue(target.node_id, target.input)))}]
  } else { parameter.targets = parameter.targets.slice(0, 1); parameter.options = [] }
}
function onParameterKindChange(parameter: StudioWorkflowParameter, event: Event) {
  changeParameterKind(parameter, selectValue(event) as StudioWorkflowParameter['kind'])
}
function changeParameterNode(parameter: StudioWorkflowParameter, index: number, id: string) {
  const input = scalarInputs(id)[0] || ''
  parameter.targets[index] = {node_id: id, input}
  for (const option of parameter.options) option.values[index] = valueText(targetValue(id, input))
  if (parameter.kind !== 'select' && !parameterKinds(parameter).includes(parameter.kind))
    changeParameterKind(parameter, parameterKinds(parameter)[0] as StudioWorkflowParameter['kind'])
}
function changeParameterInput(parameter: StudioWorkflowParameter, index: number, input: string) {
  parameter.targets[index].input = input
  for (const option of parameter.options) option.values[index] = valueText(targetValue(parameter.targets[index].node_id, input))
  if (parameter.kind !== 'select' && !parameterKinds(parameter).includes(parameter.kind))
    changeParameterKind(parameter, parameterKinds(parameter)[0] as StudioWorkflowParameter['kind'])
}
function nextParameterTarget() {
  for (const node of parameterNodes.value) for (const input of scalarInputs(node.id)) {
    if (!draft.value?.parameters.some(item => item.targets.some(target => target.node_id === node.id && target.input === input)))
      return {node_id: node.id, input}
  }
  return null
}
function addParameterTarget(parameter: StudioWorkflowParameter) {
  const target = nextParameterTarget()
  if (!target) return
  parameter.targets.push(target)
  for (const option of parameter.options) option.values.push(valueText(targetValue(target.node_id, target.input)))
}
function removeParameterTarget(parameter: StudioWorkflowParameter, index: number) {
  if (parameter.targets.length < 2) return
  parameter.targets.splice(index, 1)
  for (const option of parameter.options) option.values.splice(index, 1)
}
function setParameterLimit(parameter: StudioWorkflowParameter, key: 'minimum' | 'maximum' | 'step', event: Event) {
  const value = (event.target as HTMLInputElement).value
  parameter[key] = value === '' ? null : Number(value)
}
function addParameterOption(parameter: StudioWorkflowParameter) {
  parameter.options.push({name: `选项 ${parameter.options.length + 1}`,
    values: parameter.targets.map(target => valueText(targetValue(target.node_id, target.input)))})
}
async function save() {
  if (!draft.value || saving.value) return
  saving.value = true
  try {
    const migrated = legacyDraft.value
    const submitted = JSON.parse(JSON.stringify(draft.value)) as StudioWorkflowPresetInput
    const item = selectedId.value ? await updateStudioWorkflow(selectedId.value, submitted)
      : await createStudioWorkflow(submitted)
    if (migrated) localStorage.removeItem(legacyKey)
    selectedId.value = item.id
    if (draft.value && JSON.stringify(draft.value) === JSON.stringify(submitted)) draft.value.name = item.name
    savedSnapshot.value = JSON.stringify({...submitted, name: item.name})
    try { rows.value = await listStudioWorkflows(); error.value = '' }
    catch { error.value = '工作流已保存，列表暂时无法更新' }
    message.success('工作流已保存，所有工作区均可使用')
  } catch (cause) {
    const detail = (cause as {response?: {data?: {detail?: string}}})?.response?.data?.detail
    message.error(detail || '保存工作流失败，请检查节点映射')
  } finally { saving.value = false }
}
function remove(item: StudioWorkflowSummary) {
  if (props.readonly) return
  Modal.confirm({title: `删除“${item.name}”？`, content: '删除后，所有工作区都不能再选用这个工作流。', okText: '删除', cancelText: '取消', okType: 'danger',
    onOk: async () => {
      try {
        await deleteStudioWorkflow(item.id)
        if (selectedId.value === item.id) {
          selectedId.value = ''; draft.value = null; savedSnapshot.value = ''
          selectedNodeId.value = ''
        }
        rows.value = rows.value.filter(row => row.id !== item.id)
        message.success('工作流已删除')
      } catch { message.error('删除工作流失败，请重试') }
    }})
}
async function migrateLegacy() {
  if (props.readonly) return
  let saved: Record<string, unknown> | null = null
  try { saved = JSON.parse(localStorage.getItem(legacyKey) || 'null') } catch { /* Ignore damaged local data. */ }
  if (!saved || !isGraph(saved.workflow)) return
  const preset = initialDraft(saved.workflow, String(saved.name || '原有工作流'))
  preset.image_node_id = String(saved.imageNodeId || preset.image_node_id)
  preset.image_input = String(saved.imageInput || preset.image_input)
  preset.mask_node_id = String(saved.maskNodeId || '')
  preset.mask_input = preset.mask_node_id ? String(saved.maskInput || 'image') : ''
  preset.prompt_node_id = String(saved.promptNodeId || preset.prompt_node_id)
  preset.prompt_input = String(saved.promptInput || preset.prompt_input)
  preset.output_node_id = String(saved.outputNodeId || preset.output_node_id)
  preset.mask_enabled = true
  try {
    const item = await createStudioWorkflow(preset)
    localStorage.removeItem(legacyKey)
    await refresh(); await select(item.id)
    message.success('原有工作流已迁移到全局工作流库')
  } catch {
    selectedId.value = ''; draft.value = preset; legacyDraft.value = true; savedSnapshot.value = ''
    message.warning('原有工作流已打开，请检查节点映射并保存到全局工作流库')
  }
}
onMounted(async () => { await refresh(); await migrateLegacy() })
</script>

<template>
  <div class="ai-workflows">
    <div class="ai-section-bar">
      <nav class="ai-section-tabs" aria-label="AI 创作功能">
        <button v-for="tab in sectionTabs"
          :key="tab.id" type="button" :class="{active: section === tab.id}" :aria-current="section === tab.id ? 'page' : undefined" @click="section = tab.id">{{ tab.label }}</button>
      </nav>
      <button v-if="section === 'workflows'" type="button" class="primary workflow-import" :disabled="readonly" @click="fileInput?.click()"><FileAddOutlined /> 导入 API JSON</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden aria-label="导入 ComfyUI API 格式工作流" @change="importFile" />
    </div>
    <AIImageEditor v-if="section === 'edit'" :workspace="workspace" :asset-info="assetInfo" :readonly="readonly" @artifact-saved="emit('artifactSaved')" />
    <section v-else-if="section !== 'workflows'" class="category-placeholder">
      <strong>{{ sectionLabel }}</strong>
      <p>创作界面正在规划。此处将只使用用途为“{{ sectionLabel }}”的工作流。</p>
      <div class="category-workflows"><span>已配置工作流 · {{ categoryWorkflows.length }}</span>
        <p v-if="!categoryWorkflows.length">暂无对应工作流，可在“工作流管理”中导入并设置用途。</p>
        <div v-for="item in categoryWorkflows" :key="item.id">{{ item.name }}</div>
      </div>
      <button type="button" @click="section = 'workflows'">打开工作流管理</button>
    </section>
    <template v-else>
    <div class="ai-layout">
      <section class="library-panel"><div class="panel-heading"><strong>全局工作流库</strong><span>{{ rows.length }} 个</span></div>
        <p v-if="loading" class="empty">正在读取…</p><p v-else-if="error" class="empty error">{{ error }}</p>
        <p v-else-if="!rows.length" class="empty">还没有工作流。导入 ComfyUI API 格式 JSON 开始配置。</p>
        <div v-for="item in sortedRows" :key="item.id" class="workflow-row" :class="{selected: selectedId === item.id}">
          <button type="button" class="workflow-select" :aria-current="selectedId === item.id ? 'true' : undefined" @click="select(item.id)">
            <span class="row-icon"><RobotOutlined /></span><span class="row-copy"><strong>{{ item.name }}</strong><small>{{ studioWorkflowPurposeLabels[workflowPurpose(item)] }}<template v-if="workflowPurpose(item) === 'image_edit'"> · 最多 {{ item.reference_slots.length }} 张参考图<span v-if="item.mask_enabled !== false && (item.mask_node_id || item.mask_from_image)"> · 可用遮罩</span></template></small></span>
          </button>
          <button type="button" class="row-delete" :disabled="readonly" :title="`删除工作流：${item.name}`" :aria-label="`删除工作流：${item.name}`" @click="remove(item)"><DeleteOutlined /></button>
        </div>
      </section>
      <section class="editor-panel"><template v-if="draft">
        <div class="panel-heading"><div><strong>{{ selectedId ? '编辑工作流' : '新工作流' }}</strong><span>{{ dirty ? '未保存 · ' : '' }}{{ draft.purpose === 'image_edit' ? '节点映射只需配置一次' : '设置工作流用途' }}</span></div></div>
        <div class="editor-scroll"><div class="workflow-meta">
          <label class="workflow-name">名称<input v-model="draft.name" :disabled="readonly" maxlength="100" placeholder="例如：局部换装" /></label>
          <label class="workflow-purpose">用途<select v-model="draft.purpose" :disabled="readonly">
            <option value="image_generation">图片生成</option><option value="image_edit">图片编辑</option>
            <option value="audio_creation">音频创作</option><option value="video_creation">视频创作</option>
          </select></label>
        </div>
          <section v-if="draft.purpose === 'image_edit'" class="mapping-summary" aria-label="节点映射概览">
            <div class="mapping-heading"><strong>节点映射</strong><small>点击已配置项定位节点</small>
              <button type="button" :disabled="readonly" @click="keepOnlyMain">只映射主图</button></div>
            <div class="mapping-overview">
              <button type="button" :disabled="!draft.image_node_id" :class="{'required-missing': !draft.image_node_id}" :title="draft.image_node_id ? `主图：节点 ${draft.image_node_id} · 字段 ${draft.image_input}` : '请在节点图中指定主图输入'" @click="selectedNodeId = draft.image_node_id"><span>主图</span><strong>{{ draft.image_node_id ? '已配置' : '未配置' }}</strong></button>
              <button type="button" :disabled="!draft.reference_slots.length" :title="draft.reference_slots.length ? `参考图输入节点：${draft.reference_slots.map(slot => slot.node_id).join('、')}` : '未配置参考图输入位'" @click="selectedNodeId = draft.reference_slots[0].node_id"><span>参考图</span><strong>{{ draft.reference_slots.length ? '已配置' : '未配置' }}</strong><small v-if="draft.reference_slots.length">{{ draft.reference_slots.length }} 个输入位</small></button>
              <button type="button" :disabled="!draft.prompt_node_id" :title="draft.prompt_node_id ? `正向提示词：节点 ${draft.prompt_node_id} · 字段 ${draft.prompt_input}` : '未配置正向提示词'" @click="selectedNodeId = draft.prompt_node_id"><span>正向提示词</span><strong>{{ draft.prompt_node_id ? '已配置' : '未配置' }}</strong></button>
              <button type="button" :disabled="!draft.negative_prompt_node_id" :title="draft.negative_prompt_node_id ? `负向提示词：节点 ${draft.negative_prompt_node_id} · 字段 ${draft.negative_prompt_input}` : '未配置负向提示词'" @click="selectedNodeId = draft.negative_prompt_node_id"><span>负向提示词</span><strong>{{ draft.negative_prompt_node_id ? '已配置' : '未配置' }}</strong></button>
              <button type="button" :disabled="!maskMapped" :title="maskMapped ? `遮罩：${draft.mask_node_id ? `节点 ${draft.mask_node_id}` : `主图节点 ${draft.image_node_id} 的 MASK 输出`}` : '未配置遮罩映射'" @click="selectedNodeId = draft.mask_node_id || draft.image_node_id"><span>遮罩</span><strong>{{ maskMapped ? '已配置' : '未配置' }}</strong><small v-if="maskMapped && !draft.mask_enabled">未启用</small></button>
              <button type="button" :disabled="!draft.output_node_id" :class="{'required-missing': !draft.output_node_id}" :title="draft.output_node_id ? `图片结果：节点 ${draft.output_node_id}` : '运行前需指定图片结果节点'" @click="selectedNodeId = draft.output_node_id"><span>图片结果</span><strong>{{ draft.output_node_id ? '已配置' : '未配置' }}</strong></button>
            </div>
          </section>
          <section class="parameter-config">
            <button type="button" class="parameter-trigger" @click="parameterOpen = true">可调参数 {{ draft.parameters.length }} 个 · 配置</button>
            <a-modal :open="parameterOpen" :width="760" title="可调参数" :footer="null" @cancel="parameterOpen = false">
            <div class="parameter-list">
              <div class="parameter-modal-actions"><p class="hint">名称、控件和目标字段均由此工作流决定；选项型参数可以同时写入多个字段。</p>
                <button type="button" :disabled="readonly || !nextParameterTarget()" @click="addParameter()">＋ 添加参数</button></div>
              <div v-for="(parameter, parameterIndex) in draft.parameters" :key="parameter.id" class="parameter-card">
                <div class="parameter-main"><label>名称<input v-model="parameter.name" :disabled="readonly" maxlength="80" placeholder="自定义参数名" /></label>
                  <label>控件<select :value="parameter.kind" :disabled="readonly" @change="onParameterKindChange(parameter, $event)">
                    <option v-for="kind in parameterKinds(parameter)" :key="kind" :value="kind">{{ {number: '数值', text: '文本', boolean: '开关', select: '选项'}[kind] }}</option>
                  </select></label>
                  <button type="button" class="parameter-remove" :disabled="readonly" @click="draft.parameters.splice(parameterIndex, 1)">删除</button></div>
                <div v-for="(target, targetIndex) in parameter.targets" :key="targetIndex" class="parameter-target">
                  <span>目标 {{ targetIndex + 1 }}</span>
                  <select :value="target.node_id" :disabled="readonly" aria-label="目标节点" @change="changeParameterNode(parameter, targetIndex, selectValue($event))">
                    <option v-for="node in parameterNodes" :key="node.id" :value="node.id">{{ node.id }} · {{ node.title }}</option>
                  </select>
                  <select :value="target.input" :disabled="readonly" aria-label="目标字段" @change="changeParameterInput(parameter, targetIndex, selectValue($event))">
                    <option v-for="field in scalarInputs(target.node_id)" :key="field" :value="field">{{ field }}</option>
                  </select>
                  <button v-if="parameter.kind === 'select' && parameter.targets.length > 1" type="button" :disabled="readonly" aria-label="移除目标字段" @click="removeParameterTarget(parameter, targetIndex)">×</button>
                </div>
                <button v-if="parameter.kind === 'select'" type="button" class="parameter-add" :disabled="readonly || parameter.targets.length >= 12 || !nextParameterTarget()" @click="addParameterTarget(parameter)">＋ 目标字段</button>
                <div v-if="parameter.kind === 'number'" class="parameter-bounds">
                  <label>最小值<input type="number" :value="parameter.minimum ?? ''" :disabled="readonly" @change="setParameterLimit(parameter, 'minimum', $event)" /></label>
                  <label>最大值<input type="number" :value="parameter.maximum ?? ''" :disabled="readonly" @change="setParameterLimit(parameter, 'maximum', $event)" /></label>
                  <label>步长<input type="number" min="0" :value="parameter.step ?? ''" :disabled="readonly" @change="setParameterLimit(parameter, 'step', $event)" /></label>
                </div>
                <div v-if="parameter.kind === 'select'" class="parameter-options"><strong>选项</strong>
                  <div v-for="(option, optionIndex) in parameter.options" :key="optionIndex" class="parameter-option">
                    <input v-model="option.name" :disabled="readonly" maxlength="80" aria-label="选项名称" placeholder="选项名称" />
                    <input v-for="(target, targetIndex) in parameter.targets" :key="targetIndex" v-model="option.values[targetIndex]" :disabled="readonly"
                      :aria-label="`${target.node_id}.${target.input} 的值`" :placeholder="`${target.node_id}.${target.input}`" />
                    <button type="button" :disabled="readonly || parameter.options.length < 2" aria-label="删除选项" @click="parameter.options.splice(optionIndex, 1)">×</button>
                  </div><button type="button" class="parameter-add" :disabled="readonly || parameter.options.length >= 32" @click="addParameterOption(parameter)">＋ 选项</button>
                </div>
              </div>
              <p v-if="!draft.parameters.length" class="hint">选择节点的未连接输入字段，点“设为可调参数”即可添加。</p>
              <div class="parameter-modal-footer"><span>修改参数后，仍需保存工作流。</span><button type="button" @click="parameterOpen = false">完成配置</button></div>
            </div>
            </a-modal>
          </section>
          <div class="graph-layout">
            <AIWorkflowGraph :workflow="draft.workflow" :main-id="draft.purpose === 'image_edit' ? draft.image_node_id : ''"
              :reference-ids="draft.purpose === 'image_edit' ? draft.reference_slots.map(slot => slot.node_id) : []"
              :prompt-id="draft.purpose === 'image_edit' ? draft.prompt_node_id : ''"
              :negative-prompt-id="draft.purpose === 'image_edit' ? draft.negative_prompt_node_id : ''"
              :mask-id="draft.purpose === 'image_edit' ? draft.mask_node_id : ''" :mask-enabled="draft.mask_enabled !== false"
              :result-id="draft.purpose === 'image_edit' ? draft.output_node_id : ''" :selected-id="selectedNodeId"
              @select="selectedNodeId = $event" />
            <aside class="graph-inspector"><template v-if="selectedNode">
              <div class="inspector-heading"><span>节点 {{ selectedNode.id }}</span><strong>{{ selectedNode.title }}</strong><small>{{ selectedNode.node.class_type }}</small></div>
              <template v-if="draft.purpose === 'image_edit' && isImageNode(selectedNode.id)"><div class="inspector-group"><strong>图片来源</strong>
                <div class="role-options"><button type="button" :class="{active: draft.image_node_id === selectedNode.id}" :disabled="readonly" @click="setImageRole(selectedNode.id, 'main')">主图</button>
                   <button type="button" :class="{active: draft.reference_slots.some(slot => slot.node_id === selectedNodeId)}" :disabled="readonly" @click="setImageRole(selectedNodeId, 'reference')">参考图</button>
                  <button type="button" :class="{active: draft.image_node_id !== selectedNodeId && !draft.reference_slots.some(slot => slot.node_id === selectedNodeId)}" :disabled="readonly" @click="setImageRole(selectedNodeId, 'internal')">不替换</button></div>
                <template v-if="draft.image_node_id === selectedNode.id"><label>主图字段<select v-model="draft.image_input" :disabled="readonly"><option v-for="name in inputs(selectedNode.id)" :key="name">{{ name }}</option></select></label>
                  <label class="inspector-toggle"><input v-model="draft.mask_enabled" type="checkbox" :disabled="readonly || !maskFromImage" />使用主图遮罩</label>
                  <p v-if="!maskFromImage" class="hint">此节点的 MASK 输出尚未连接到工作流。</p></template>
                <template v-if="draft.reference_slots.some(slot => slot.node_id === selectedNodeId)"><div class="reference-order"><span>参考图 {{ draft.reference_slots.findIndex(slot => slot.node_id === selectedNodeId) + 1 }}</span>
                    <button type="button" :disabled="readonly" aria-label="参考图前移" @click="moveReference(selectedNode.id, -1)">↑</button>
                    <button type="button" :disabled="readonly" aria-label="参考图后移" @click="moveReference(selectedNode.id, 1)">↓</button></div></template>
              </div></template>
              <div v-if="draft.purpose === 'image_edit' && selectedNode.node.class_type === 'LoadImageMask'" class="inspector-group"><strong>独立遮罩</strong><button type="button" class="assignment" :disabled="readonly" @click="setNode('mask', draft.mask_node_id === selectedNode.id ? '' : selectedNode.id)">{{ draft.mask_node_id === selectedNode.id ? '取消遮罩映射' : '设为遮罩输入' }}</button></div>
              <div v-if="draft.purpose === 'image_edit' && isPromptNode(selectedNode.id)" class="inspector-group"><strong>文本输入</strong>
                <button type="button" class="assignment" :class="{active: draft.prompt_node_id === selectedNode.id}" :disabled="readonly" @click="setNode('prompt', draft.prompt_node_id === selectedNode.id ? '' : selectedNode.id)">{{ draft.prompt_node_id === selectedNode.id ? '取消正向提示词映射' : '设为正向提示词' }}</button>
                <label v-if="draft.prompt_node_id === selectedNode.id">正向字段<select v-model="draft.prompt_input" :disabled="readonly"><option v-for="name in textInputs(selectedNode.id)" :key="name">{{ name }}</option></select></label>
                <button type="button" class="assignment" :class="{active: draft.negative_prompt_node_id === selectedNode.id}" :disabled="readonly" @click="setNode('negative_prompt', draft.negative_prompt_node_id === selectedNode.id ? '' : selectedNode.id)">{{ draft.negative_prompt_node_id === selectedNode.id ? '取消负向提示词映射' : '设为负向提示词' }}</button>
                <label v-if="draft.negative_prompt_node_id === selectedNode.id">负向字段<select v-model="draft.negative_prompt_input" :disabled="readonly"><option v-for="name in textInputs(selectedNode.id)" :key="name">{{ name }}</option></select></label></div>
              <div v-if="draft.purpose === 'image_edit'" class="inspector-group"><strong>图片结果</strong><button type="button" class="assignment" :class="{active: draft.output_node_id === selectedNode.id}" :disabled="readonly" @click="draft.output_node_id = draft.output_node_id === selectedNode.id ? '' : selectedNode.id">{{ draft.output_node_id === selectedNode.id ? '取消结果节点映射' : '设为结果节点' }}</button>
                <p v-if="!isOutputNode(selectedNode.id)" class="hint">请确认此节点能返回图片。</p></div>
              <div class="inspector-group"><strong>节点输入</strong><div v-for="(value, key) in selectedNode.node.inputs" :key="key" class="input-detail"><span>{{ key }}</span><small>{{ Array.isArray(value) ? `← ${value[0]} · 输出 ${value[1]}` : String(value).slice(0, 48) }}</small>
                <button v-if="isScalar(value)" type="button" :disabled="readonly || isReservedParameterTarget(selectedNodeId, String(key)) || draft.parameters.some(parameter => parameter.targets.some(target => target.node_id === selectedNodeId && target.input === key))" @click="addParameter(selectedNodeId, String(key))">设为可调</button></div></div>
            </template><div v-else class="inspector-empty">选择图中的节点进行配置</div></aside>
          </div></div>
        <footer class="editor-footer"><span>{{ Object.keys(draft.workflow).length }} 个节点 · API 格式<template v-if="draft.purpose === 'image_edit' && !draft.output_node_id"> · 未设置结果，保存后暂不可运行</template></span><button type="button" class="primary" :disabled="readonly || saving" @click="save">{{ saving ? '保存中…' : '保存工作流' }}</button></footer>
      </template><div v-else class="editor-empty"><RobotOutlined /><strong>选择工作流，或导入一个新的 JSON</strong><span>在这里配置节点，图片加工时直接选择。</span></div></section>
    </div>
    </template>
  </div>
</template>

<style scoped>
.ai-workflows{display:flex;flex-direction:column;gap:16px;width:100%;color:var(--ui-text)}.primary{display:inline-flex;align-items:center;justify-content:center;gap:7px;flex:none;border:1px solid var(--primary-color);border-radius:7px;background:var(--primary-color);color:#fff;padding:9px 12px;cursor:pointer;font-size:12px}.primary:disabled{opacity:.5;cursor:default}.ai-layout{display:grid;grid-template-columns:minmax(220px,29%) minmax(0,1fr);min-height:480px;gap:12px}.library-panel,.editor-panel{border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface)}.library-panel{padding:10px;max-height:660px;overflow-y:auto}.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 9px 12px;border-bottom:1px solid var(--ui-border);font-size:13px}.panel-heading strong{display:block}.panel-heading span{color:var(--ui-muted);font-size:11px}.empty{padding:35px 15px;color:var(--ui-muted);text-align:center;font-size:12px;line-height:1.6}.error{color:#b42318}.workflow-row{display:flex;align-items:center;gap:9px;width:100%;margin-top:6px;padding:10px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--ui-text);text-align:left;cursor:pointer}.workflow-row:hover{background:var(--ui-hover)}.workflow-row.selected{border-color:var(--primary-color);background:var(--primary-color-1)}.row-icon{display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:6px;background:var(--ui-surface-soft);color:var(--primary-color)}.row-copy{min-width:0}.row-copy strong,.row-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-copy strong{font-size:12px}.row-copy small{margin-top:3px;color:var(--ui-muted);font-size:10px}.editor-panel{display:flex;flex-direction:column;min-width:0;max-height:660px}.editor-panel>.panel-heading{padding:15px 18px}.icon-danger{border:0;background:transparent;color:var(--ui-muted);cursor:pointer}.icon-danger:hover{color:#d44444}.editor-scroll{flex:1;overflow-y:auto;padding:13px 18px}.editor-scroll label{display:flex;flex-direction:column;gap:5px;min-width:0;color:var(--ui-muted);font-size:11px}.editor-scroll input,.editor-scroll select,.slot-row select{width:100%;min-width:0;padding:8px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);font:inherit;font-size:12px}.full-field{margin-bottom:16px}.mapping-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(105px,28%);gap:8px 10px}.mapping-title{grid-column:1/-1;margin-top:8px;color:var(--ui-text);font-size:12px;font-weight:650}.mapping-title small{color:var(--ui-muted);font-size:10px;font-weight:400}.wide-field{grid-column:1/-1}.slots-heading{display:flex;justify-content:space-between;align-items:center;margin:22px 0 8px;padding-top:13px;border-top:1px solid var(--ui-border);font-size:12px}.slots-heading button{border:0;background:transparent;color:var(--primary-color);cursor:pointer;font-size:11px}.slot-row{display:grid;grid-template-columns:20px minmax(0,1fr) minmax(80px,23%) 24px;gap:7px;align-items:center;margin:6px 0}.slot-row>span{color:var(--ui-muted);font-size:11px}.slot-row button{border:0;background:transparent;color:var(--ui-muted);cursor:pointer;font-size:18px}.hint{margin:9px 0;color:var(--ui-muted);font-size:11px;line-height:1.5}.editor-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid var(--ui-border)}.editor-footer span{color:var(--ui-muted);font-size:11px}.editor-empty{display:flex;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:9px;color:var(--ui-muted);font-size:12px}.editor-empty>.anticon{font-size:32px;color:var(--primary-color)}.editor-empty strong{color:var(--ui-text);font-size:14px}
.ai-workflows{gap:8px}
.workflow-import{margin-left:auto;min-height:30px;padding:5px 9px;white-space:nowrap}.workflow-row{gap:0;padding:0;cursor:default}.workflow-select{display:flex;align-items:center;gap:9px;min-width:0;flex:1;padding:10px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.workflow-select .row-copy{flex:1}
.row-delete{display:grid;place-items:center;width:30px;height:30px;flex:none;margin-right:6px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--ui-muted);cursor:pointer}.row-delete:hover:not(:disabled),.row-delete:focus-visible{border-color:#d44444;color:#d44444;background:color-mix(in srgb,var(--ui-surface) 90%,#d44444)}.row-delete:disabled{opacity:.45;cursor:default}
.ai-section-bar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}.ai-section-tabs{display:flex;min-width:0;overflow-x:auto;gap:5px;padding:4px;border:1px solid var(--ui-border);border-radius:9px;background:var(--ui-surface);width:max-content;max-width:100%}.ai-section-tabs button{border:0;border-radius:6px;background:transparent;color:var(--ui-muted);padding:7px 15px;cursor:pointer;font-size:12px}.ai-section-tabs button.active{background:var(--primary-color-1);color:var(--primary-color);font-weight:650}
@media(max-width:750px){.ai-layout{grid-template-columns:1fr}.library-panel,.editor-panel{max-height:none}.editor-panel{min-height:480px}}
.ai-layout{grid-template-columns:minmax(205px,23%) minmax(0,1fr)}
.library-panel,.editor-panel{max-height:790px}
.editor-scroll{padding:12px;overflow:auto}
.workflow-meta{display:flex;align-items:center;flex-wrap:wrap;gap:9px 18px;margin:0 2px 10px}
.workflow-meta label{display:inline-flex;align-items:center;flex-direction:row;gap:8px;margin:0;color:var(--ui-text);font-weight:650;white-space:nowrap}
.workflow-name input{width:240px}
.workflow-purpose select{width:150px}
@media(max-width:620px){.workflow-meta{align-items:stretch;flex-direction:column}.workflow-meta label{width:100%}.workflow-name input,.workflow-purpose select{flex:1;width:100%}}
.category-placeholder{min-height:350px;padding:24px;border:1px solid var(--ui-border);border-radius:10px;background:var(--ui-surface)}
.category-placeholder>strong{font-size:17px}.category-placeholder>p{margin:8px 0 20px;color:var(--ui-muted);font-size:12px}
.category-workflows{max-width:560px;padding:14px;border:1px solid var(--ui-border);border-radius:8px;background:var(--ui-surface-soft);font-size:12px}
.category-workflows>span{font-weight:650}.category-workflows>p{margin:12px 0 0;color:var(--ui-muted)}
.category-workflows>div{margin-top:10px;padding:9px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface)}
.category-placeholder>button{margin-top:18px;padding:7px 11px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--primary-color);cursor:pointer;font-size:12px}
.mapping-summary{margin:0 2px 10px}
.mapping-heading{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.mapping-heading strong{font-size:11px}.mapping-heading small{color:var(--ui-muted);font-size:10px}
.mapping-heading button{margin-left:auto;border:0;background:transparent;color:var(--primary-color);cursor:pointer;font-size:10px}
.mapping-heading button:disabled{opacity:.45;cursor:default}
.mapping-overview{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.mapping-overview button{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border:1px solid var(--ui-border);border-radius:99px;background:var(--ui-surface-soft);color:var(--ui-text);cursor:pointer;font-size:11px}
.mapping-overview button strong{color:var(--primary-color);font-size:10px;font-weight:650}.mapping-overview button small{color:var(--ui-muted);font-size:10px}
.mapping-overview button:disabled{cursor:default}.mapping-overview button:disabled strong{color:var(--ui-muted)}
.mapping-overview button.required-missing{border-color:#d9a7a0;background:#fff6f4}.mapping-overview button.required-missing strong{color:#a34337}
.parameter-config{margin:0 2px 10px}
.parameter-trigger{padding:5px 9px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--primary-color);cursor:pointer;font-size:11px}
.parameter-modal-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}
.parameter-modal-actions button,.parameter-add{border:0;background:transparent;color:var(--primary-color);cursor:pointer;font-size:11px}
.parameter-modal-actions button:disabled,.parameter-add:disabled{opacity:.45;cursor:default}
.parameter-list{max-height:65vh;overflow:auto;padding:0 2px 6px}
.parameter-list label{display:flex;flex-direction:column;gap:5px;min-width:0;color:var(--ui-muted);font-size:11px}
.parameter-list input,.parameter-list select{width:100%;min-width:0;padding:8px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);font:inherit;font-size:12px}
.parameter-card{margin-top:8px;padding:9px;border:1px solid var(--ui-border);border-radius:7px;background:var(--ui-surface-soft)}
.parameter-main,.parameter-target,.parameter-bounds{display:flex;align-items:end;flex-wrap:wrap;gap:7px;margin-bottom:7px}
.parameter-main label:first-child{flex:1;min-width:130px}.parameter-main label:nth-child(2){width:96px}
.parameter-main button,.parameter-target button,.parameter-option button{padding:6px;border:0;background:transparent;color:var(--ui-muted);cursor:pointer;font-size:11px}
.parameter-remove:hover,.parameter-target button:hover,.parameter-option button:hover{color:#b42318}
.parameter-target>span{align-self:center;width:40px;flex:none;color:var(--ui-muted);font-size:10px}
.parameter-target select:nth-of-type(1){flex:1;min-width:125px}.parameter-target select:nth-of-type(2){width:130px}
.parameter-bounds label{width:88px}.parameter-options{margin-top:7px;padding-top:7px;border-top:1px solid var(--ui-border)}
.parameter-options>strong{font-size:11px}.parameter-option{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:5px}
.parameter-option input{width:110px;flex:1;min-width:85px}.input-detail button{flex:none;border:0;background:transparent;color:var(--primary-color);cursor:pointer;font-size:10px}.input-detail button:disabled{opacity:.4;cursor:default}
.parameter-modal-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:14px;padding-top:12px;border-top:1px solid var(--ui-border)}
.parameter-modal-footer span{color:var(--ui-muted);font-size:11px}.parameter-modal-footer button{padding:7px 11px;border:1px solid var(--primary-color);border-radius:6px;background:var(--primary-color);color:#fff;cursor:pointer;font-size:11px}
.graph-layout{display:grid;grid-template-columns:minmax(0,1fr) 252px;height:560px;min-width:0;overflow:hidden;border:1px solid var(--ui-border);border-radius:9px}
.graph-inspector{min-width:0;overflow:auto;border-left:1px solid var(--ui-border);background:var(--ui-surface)}
.inspector-heading{display:flex;flex-direction:column;gap:5px;padding:14px;border-bottom:1px solid var(--ui-border)}
.inspector-heading span,.inspector-heading small{color:var(--ui-muted);font-size:10px}.inspector-heading strong{font-size:13px;overflow-wrap:anywhere}
.inspector-group{display:flex;flex-direction:column;gap:9px;padding:13px 14px;border-bottom:1px solid var(--ui-border)}.inspector-group>strong{font-size:11px}
.inspector-group label{display:flex;flex-direction:column;gap:5px;color:var(--ui-muted);font-size:11px}
.inspector-group label.inspector-toggle{align-items:center;flex-direction:row;color:var(--ui-text)}
.inspector-toggle input{width:auto;margin:0;accent-color:var(--primary-color)}
.role-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.role-options button,.assignment,.reference-order button{padding:6px 5px;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface);color:var(--ui-text);cursor:pointer;font-size:10px}
.role-options button.active,.assignment.active{border-color:var(--primary-color);background:var(--primary-color-1);color:var(--primary-color);font-weight:650}
.role-options button:disabled,.assignment:disabled,.reference-order button:disabled{opacity:.55;cursor:default}
.reference-order{display:flex;align-items:center;gap:5px;color:var(--ui-muted);font-size:11px}.reference-order span{flex:1}.reference-order button{width:28px;font-size:14px}
.input-detail{display:flex;align-items:baseline;justify-content:space-between;gap:6px;min-width:0;padding:4px 0;border-top:1px solid var(--ui-border);font-size:10px}.input-detail span{min-width:0;overflow-wrap:anywhere}.input-detail small{max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ui-muted);font-size:10px}
.inspector-empty{display:grid;place-items:center;height:100%;padding:20px;color:var(--ui-muted);font-size:11px;text-align:center}
@media(max-width:1100px){.graph-layout{grid-template-columns:minmax(0,1fr) 210px}}
@media(max-width:850px){.ai-layout{grid-template-columns:1fr}.library-panel,.editor-panel{max-height:none}.graph-layout{height:540px;grid-template-columns:minmax(0,1fr) 225px}}
@media(max-width:620px){.graph-layout{display:flex;flex-direction:column;height:760px}.graph-layout .workflow-graph{height:440px;min-height:440px}.graph-inspector{flex:1;border-left:0;border-top:1px solid var(--ui-border)}}
</style>
