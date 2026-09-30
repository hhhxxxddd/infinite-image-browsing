import type {
  ComfyWorkflow,
  StudioWorkflowParameter,
  StudioWorkflowPresetInput,
  StudioWorkflowSlot
} from '../../../src/features/ai-workflows/api/imageAi'

const scalar = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

const slotKey = ({ node_id, input }: StudioWorkflowSlot) => `${node_id}\u0000${input}`

export function imageInputNodes(graph: ComfyWorkflow) {
  return Object.entries(graph).filter(
    ([, node]) => /LoadImage$/i.test(node.class_type) && 'image' in node.inputs
  )
}

export function maskFromMainImage(graph: ComfyWorkflow, imageNodeId: string): boolean {
  if (graph[imageNodeId]?.class_type !== 'LoadImage') return false
  return Object.values(graph).some((node) =>
    Object.entries(node.inputs).some(
      ([name, value]) =>
        name.toLowerCase().includes('mask') &&
        Array.isArray(value) &&
        value[0] === imageNodeId &&
        value[1] === 1
    )
  )
}

export function setImageRole(
  draft: StudioWorkflowPresetInput,
  nodeId: string,
  role: 'main' | 'reference' | 'internal'
): StudioWorkflowPresetInput {
  if (!imageInputNodes(draft.workflow).some(([id]) => id === nodeId)) return draft
  const references = draft.reference_slots.filter((slot) => slot.node_id !== nodeId)
  if (role === 'reference' && references.length >= 13) return draft
  const next = { ...draft, reference_slots: references }
  if (draft.image_node_id === nodeId && role !== 'main') {
    next.image_node_id = ''
    next.image_input = ''
    next.mask_enabled = false
  }
  if (role === 'main') {
    next.image_node_id = nodeId
    next.image_input = 'image'
    next.reference_slots = references.filter((slot) => slot.node_id !== nodeId)
    if (maskFromMainImage(draft.workflow, nodeId)) {
      next.mask_node_id = ''
      next.mask_input = ''
      next.mask_enabled = true
    }
  } else if (role === 'reference') {
    next.reference_slots = [...references, { node_id: nodeId, input: 'image' }]
  }
  return next
}

export function availableScalarFields(draft: StudioWorkflowPresetInput) {
  const reserved = new Set(
    [
      [draft.image_node_id, draft.image_input],
      [draft.mask_node_id, draft.mask_input],
      [draft.prompt_node_id, draft.prompt_input],
      [draft.negative_prompt_node_id, draft.negative_prompt_input],
      ...draft.reference_slots.map((slot) => [slot.node_id, slot.input])
    ]
      .filter(([id, input]) => id && input)
      .map(([node_id, input]) => slotKey({ node_id, input }))
  )
  return Object.entries(draft.workflow).flatMap(([node_id, node]) =>
    Object.entries(node.inputs)
      .filter(([input, value]) => scalar(value) && !reserved.has(slotKey({ node_id, input })))
      .map(([input, value]) => ({ node_id, input, value }))
  )
}

function validOptionValue(value: string, original: unknown) {
  if (typeof original === 'boolean') return ['true', 'false'].includes(value.toLowerCase())
  if (typeof original === 'number')
    return (
      value.trim() !== '' &&
      Number.isFinite(Number(value)) &&
      (!Number.isInteger(original) || Number.isInteger(Number(value)))
    )
  return typeof original === 'string'
}

export function validateWorkflowMappings(draft: StudioWorkflowPresetInput): string | null {
  const graph = draft.workflow
  if (!draft.name.trim()) return '请填写工作流名称。'
  const mapped = [
    [draft.image_node_id, draft.image_input],
    [draft.mask_node_id, draft.mask_input],
    [draft.prompt_node_id, draft.prompt_input],
    [draft.negative_prompt_node_id, draft.negative_prompt_input],
    ...draft.reference_slots.map((slot) => [slot.node_id, slot.input])
  ].filter(([id, input]) => id || input)
  const imagePurpose = draft.purpose === 'image_generation' || draft.purpose === 'image_edit'
  if (imagePurpose) {
    const outputs = draft.output_mappings?.length
      ? draft.output_mappings
      : draft.output_node_id
        ? [{ node_id: draft.output_node_id, label: '' }]
        : []
    if (!outputs.length || outputs.length > 16) return '请设置 1 至 16 个图片结果节点。'
    if (
      new Set(outputs.map((item) => item.node_id)).size !== outputs.length ||
      outputs.some((item) => !graph[item.node_id] || item.label.length > 80)
    )
      return '图片结果节点重复或无效。'
    if (draft.purpose === 'image_generation') {
      if (
        Object.values(graph).some((node) =>
          ['LoadImage', 'LoadImageMask'].includes(node.class_type)
        )
      )
        return '纯文字生图工作流不能包含图片或遮罩输入节点。'
    } else if (draft.purpose === 'image_edit') {
      if (!draft.image_node_id || draft.image_input !== 'image') return '请设置主图输入节点。'
      if (!imageInputNodes(graph).some(([id]) => id === draft.image_node_id))
        return '主图必须映射到 LoadImage 的 image 字段。'
    }
    if (mapped.some(([id, input]) => !id || !input || !(input in (graph[id]?.inputs || {}))))
      return '图片、遮罩或提示词映射的节点字段无效。'
    if (
      new Set(mapped.map(([node_id, input]) => slotKey({ node_id, input }))).size !== mapped.length
    )
      return '图片、参考图、遮罩和提示词不能映射到同一个字段。'
    for (const [id, input] of [
      [draft.prompt_node_id, draft.prompt_input],
      [draft.negative_prompt_node_id, draft.negative_prompt_input]
    ]) {
      if (id && typeof graph[id]?.inputs[input] !== 'string')
        return '提示词必须映射到文本输入字段。'
    }
    if (draft.reference_slots.length > 13) return '最多设置 13 张参考图。'
    if (
      draft.reference_slots.some(
        (slot) =>
          slot.node_id === draft.image_node_id ||
          slot.input !== 'image' ||
          !imageInputNodes(graph).some(([id]) => id === slot.node_id)
      )
    )
      return '参考图必须映射到独立 LoadImage 节点的 image 字段。'
    if (draft.mask_node_id) {
      const mask = graph[draft.mask_node_id]
      if (mask?.class_type !== 'LoadImageMask' || draft.mask_input !== 'image')
        return '独立遮罩只能映射到 LoadImageMask 的 image 字段。'
      if (!['alpha', 'red', 'green', 'blue'].includes(String(mask.inputs.channel)))
        return 'LoadImageMask 需要有效的 channel 字段。'
      if (maskFromMainImage(graph, draft.image_node_id))
        return '主图节点已输出遮罩，无需再映射独立遮罩节点。'
    }
  }
  if (draft.parameters.length > 32) return '最多设置 32 个可调参数。'
  const reserved = new Set(mapped.map(([node_id, input]) => slotKey({ node_id, input })))
  const seenIds = new Set<string>()
  const seenTargets = new Set<string>()
  for (const parameter of draft.parameters) {
    const error = validateParameter(parameter, graph, reserved, seenIds, seenTargets)
    if (error) return error
  }
  return null
}

function validateParameter(
  parameter: StudioWorkflowParameter,
  graph: ComfyWorkflow,
  reserved: Set<string>,
  seenIds: Set<string>,
  seenTargets: Set<string>
): string | null {
  if (!parameter.id.trim() || seenIds.has(parameter.id) || !parameter.name.trim())
    return '可调参数的名称和编号必须有效且唯一。'
  seenIds.add(parameter.id)
  if (!parameter.targets.length || parameter.targets.length > 12)
    return `${parameter.name}需要 1 至 12 个字段。`
  if (parameter.kind !== 'select' && parameter.targets.length !== 1)
    return '数值、文本和开关参数只能映射一个字段。'
  if (parameter.kind === 'select' && (!parameter.options.length || parameter.options.length > 32))
    return '选项参数需要 1 至 32 个选项。'
  if (parameter.number_display === 'slider' && parameter.kind !== 'number')
    return '滑块显示方式只能用于数值参数。'
  if (
    parameter.kind === 'number' &&
    ([parameter.minimum, parameter.maximum, parameter.step].some(
      (value) => value !== null && !Number.isFinite(value)
    ) ||
      (parameter.step !== null && parameter.step <= 0) ||
      (parameter.minimum !== null &&
        parameter.maximum !== null &&
        parameter.minimum > parameter.maximum))
  )
    return `${parameter.name}的数值范围或步长无效。`
  for (const target of parameter.targets) {
    const key = slotKey(target)
    const original = graph[target.node_id]?.inputs[target.input]
    if (reserved.has(key) || seenTargets.has(key) || !scalar(original))
      return `${parameter.name}映射了保留、重复或非标量字段。`
    if (
      (parameter.kind === 'number' && typeof original !== 'number') ||
      (parameter.kind === 'text' && typeof original !== 'string') ||
      (parameter.kind === 'boolean' && typeof original !== 'boolean')
    )
      return `${parameter.name}的数据类型与字段不匹配。`
    seenTargets.add(key)
  }
  for (const option of parameter.options) {
    if (!option.name.trim() || option.values.length !== parameter.targets.length)
      return `${parameter.name}的选项名称或字段数量无效。`
    if (
      option.values.some(
        (value, index) =>
          !validOptionValue(
            value,
            graph[parameter.targets[index].node_id].inputs[parameter.targets[index].input]
          )
      )
    )
      return `${parameter.name}的选项值与节点字段类型不匹配。`
  }
  return null
}
