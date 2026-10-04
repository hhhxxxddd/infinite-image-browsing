import { useNotice } from '../../shared/notices'
import {
  ActionIcon,
  Accordion,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Select,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconFileImport,
  IconPlus,
  IconTrash
} from '@tabler/icons-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type {
  ComfyWorkflow,
  StudioWorkflowPurpose,
  StudioWorkflowPreset,
  StudioWorkflowPresetInput,
  StudioWorkflowSummary
} from '../../../src/features/ai-workflows/model/imageAIContracts'
import { apiFetch } from '../../shared/apiClient'
import { errorText, SettingsCard } from './components'
import WorkflowParameterSettings from './WorkflowParameterSettings'
import {
  imageInputNodes,
  availableScalarFields,
  maskFromMainImage,
  setImageRole,
  validateWorkflowMappings
} from './workflowMapping'
const WorkflowGraph = lazy(() => import('./WorkflowGraph'))

const purposeOptions: { value: StudioWorkflowPurpose; label: string }[] = [
  { value: 'image_generation', label: '图片生成' },
  { value: 'image_edit', label: '图片编辑' },
  { value: 'audio_creation', label: '音频创作' },
  { value: 'video_creation', label: '视频创作' }
]

function isGraph(value: unknown): value is ComfyWorkflow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const nodes = Object.values(value)
  return (
    nodes.length > 0 &&
    nodes.length <= 256 &&
    nodes.every(
      (node) =>
        !!node &&
        typeof node === 'object' &&
        'class_type' in node &&
        typeof node.class_type === 'string' &&
        'inputs' in node &&
        !!node.inputs &&
        typeof node.inputs === 'object' &&
        !Array.isArray(node.inputs)
    )
  )
}

function initialDraft(graph: ComfyWorkflow, filename: string): StudioWorkflowPresetInput {
  const nodes = Object.entries(graph)
  const imageNodes = imageInputNodes(graph)
  const mask = nodes.find(
    ([, node]) => /LoadImageMask/i.test(node.class_type) && 'image' in node.inputs
  )
  const derivedMask = maskFromMainImage(graph, imageNodes[0]?.[0] || '')
  const textCandidates = nodes.filter(
    ([, node]) => typeof node.inputs.prompt === 'string' || typeof node.inputs.text === 'string'
  )
  const textNode =
    textCandidates.find(([, node]) => !/negative|负向/i.test(node._meta?.title || '')) ||
    textCandidates[0]
  const promptInput = textNode
    ? ['text', 'prompt', 'value'].find((key) => typeof textNode[1].inputs[key] === 'string') || ''
    : ''
  const negativeNode =
    nodes.find(([, node]) =>
      Object.entries(node.inputs).some(
        ([key, value]) => /negative/i.test(key) && typeof value === 'string'
      )
    ) || textCandidates.find(([, node]) => /negative|负向/i.test(node._meta?.title || ''))
  const negativeInput = negativeNode
    ? Object.keys(negativeNode[1].inputs).find(
        (key) => /negative/i.test(key) && typeof negativeNode[1].inputs[key] === 'string'
      ) ||
      ['text', 'prompt'].find((key) => typeof negativeNode[1].inputs[key] === 'string') ||
      ''
    : ''
  const separateNegative =
    !!negativeInput && (negativeNode?.[0] !== textNode?.[0] || negativeInput !== promptInput)
  const outputs = nodes.filter(([, node]) => /SaveImage/i.test(node.class_type))
  if (!outputs.length)
    outputs.push(...nodes.filter(([, node]) => /PreviewImage/i.test(node.class_type)))
  return {
    name: filename.replace(/\.json$/i, ''),
    purpose: imageNodes.length ? 'image_edit' : 'image_generation',
    workflow: graph,
    image_node_id: imageNodes[0]?.[0] || '',
    image_input: imageNodes[0] ? 'image' : '',
    mask_node_id: derivedMask ? '' : mask?.[0] || '',
    mask_input: !derivedMask && mask ? 'image' : '',
    mask_enabled: derivedMask || !!mask,
    prompt_node_id: textNode?.[0] || '',
    prompt_input: promptInput,
    negative_prompt_node_id: separateNegative ? negativeNode?.[0] || '' : '',
    negative_prompt_input: separateNegative ? negativeInput : '',
    output_node_id: outputs[0]?.[0] || '',
    output_mappings: outputs.slice(0, 16).map(([node_id]) => ({ node_id, label: '' })),
    reference_slots: imageNodes.slice(1, 14).map(([node_id]) => ({ node_id, input: 'image' })),
    parameters: []
  }
}

function inputFromPreset(preset: StudioWorkflowPreset): StudioWorkflowPresetInput {
  const input = Object.fromEntries(
    Object.entries(preset).filter(([key]) => !['id', 'created_at', 'updated_at'].includes(key))
  ) as unknown as StudioWorkflowPresetInput
  return {
    ...input,
    reference_slots: input.reference_slots || [],
    parameters: input.parameters || [],
    output_mappings: input.output_mappings?.length
      ? input.output_mappings
      : input.output_node_id
        ? [{ node_id: input.output_node_id, label: '' }]
        : [],
    mask_enabled: input.mask_enabled ?? true
  }
}

export default function WorkflowSettings({
  initialPreset,
  onDirtyChange
}: {
  initialPreset?: StudioWorkflowPresetInput
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [rows, setRows] = useState<StudioWorkflowSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<StudioWorkflowPresetInput | null>(initialPreset ?? null)
  const [saved, setSaved] = useState('')
  const [readonly, setReadonly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const setNotice = useNotice()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState(initialPreset?.image_node_id ?? '')
  const [nodeFocusRevision, setNodeFocusRevision] = useState(0)
  const [parameterOpen, setParameterOpen] = useState(false)
  const [parameterId, setParameterId] = useState('')

  const dirty = !!draft && JSON.stringify(draft) !== saved
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  const isImagePurpose = draft?.purpose === 'image_edit' || draft?.purpose === 'image_generation'
  const nodes = useMemo(
    () =>
      Object.entries(draft?.workflow || {}).map(([id, node]) => ({
        value: id,
        label: `${id} · ${node._meta?.title || node.class_type}`
      })),
    [draft?.workflow]
  )
  const imageNodes = useMemo(() => imageInputNodes(draft?.workflow || {}), [draft?.workflow])
  const maskNodes = nodes.filter(
    ({ value }) =>
      draft?.workflow[value]?.class_type === 'LoadImageMask' &&
      'image' in draft.workflow[value].inputs
  )
  const outputNodes = nodes.filter(({ value }) =>
    /SaveImage|PreviewImage/i.test(draft?.workflow[value]?.class_type || '')
  )
  const derivedMask = !!draft && maskFromMainImage(draft.workflow, draft.image_node_id)
  const selectedNode = draft?.workflow[selectedNodeId]
  const selectedFields = draft
    ? availableScalarFields(draft).filter((field) => field.node_id === selectedNodeId)
    : []
  const imageRole =
    draft?.image_node_id === selectedNodeId
      ? 'main'
      : draft?.reference_slots.some((slot) => slot.node_id === selectedNodeId)
        ? 'reference'
        : 'internal'
  const textInputs = (id: string) =>
    Object.entries(draft?.workflow[id]?.inputs || {})
      .filter(([, value]) => typeof value === 'string')
      .map(([name]) => ({ value: name, label: name }))

  useEffect(() => {
    let active = true
    void Promise.all([
      apiFetch<StudioWorkflowSummary[]>('/image-ai/studio/workflows'),
      apiFetch<{ is_readonly: boolean }>('/global_setting')
    ])
      .then(([list, global]) => {
        if (active) {
          setRows(list)
          setReadonly(global.is_readonly)
          setLoading(false)
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(errorText(cause, '读取工作流预设失败'))
          setLoading(false)
        }
      })
    return () => {
      active = false
    }
  }, [])

  async function select(id: string) {
    setError('')
    setNotice('')
    if (!id) {
      setSelectedId('')
      setDraft(null)
      setSaved('')
      return
    }
    setLoading(true)
    try {
      const preset = await apiFetch<StudioWorkflowPreset>(
        `/image-ai/studio/workflows/${encodeURIComponent(id)}`
      )
      const input = inputFromPreset(preset)
      setSelectedId(id)
      setDraft(input)
      setSelectedNodeId(
        input.image_node_id || input.prompt_node_id || Object.keys(input.workflow)[0] || ''
      )
      setSaved(JSON.stringify(input))
    } catch (cause) {
      setError(errorText(cause, '读取工作流失败'))
    } finally {
      setLoading(false)
    }
  }

  function requestSelect(id: string) {
    if (dirty) {
      setPendingSelection(id)
      return
    }
    void select(id)
  }

  function update<K extends keyof StudioWorkflowPresetInput>(
    key: K,
    value: StudioWorkflowPresetInput[K]
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
    setNotice('')
  }

  function chooseImageRole(id: string, role: 'main' | 'reference' | 'internal') {
    setDraft((current) => (current ? setImageRole(current, id, role) : current))
    setNotice('')
  }

  function chooseTextNode(role: 'prompt' | 'negative_prompt', id: string) {
    setDraft((current) => {
      if (!current) return current
      const fields = Object.entries(current.workflow[id]?.inputs || {})
        .filter(([, value]) => typeof value === 'string')
        .map(([name]) => name)
      const preferred =
        (role === 'negative_prompt'
          ? fields.find((name) => /negative/i.test(name))
          : fields.find((name) => /^(text|prompt|positive_prompt)$/i.test(name))) ||
        fields[0] ||
        ''
      return {
        ...current,
        [`${role}_node_id`]: id,
        [`${role}_input`]: id ? preferred : ''
      }
    })
  }

  function moveReference(index: number, direction: number) {
    setDraft((current) => {
      if (!current) return current
      const to = index + direction
      if (to < 0 || to >= current.reference_slots.length) return current
      const slots = [...current.reference_slots]
      ;[slots[index], slots[to]] = [slots[to], slots[index]]
      return { ...current, reference_slots: slots }
    })
  }

  function updateOutput(index: number, key: 'node_id' | 'label', value: string) {
    setDraft((current) => {
      if (!current) return current
      const mappings = [...(current.output_mappings || [])]
      mappings[index] = { ...mappings[index], [key]: value }
      return { ...current, output_mappings: mappings, output_node_id: mappings[0]?.node_id || '' }
    })
  }

  function removeOutput(index: number) {
    setDraft((current) => {
      if (!current) return current
      const mappings = (current.output_mappings || []).filter((_, position) => position !== index)
      return { ...current, output_mappings: mappings, output_node_id: mappings[0]?.node_id || '' }
    })
  }

  async function importFile(file?: File) {
    if (!file) return
    if (file.size > 1_000_000) {
      setError('工作流 JSON 不能超过 1 MB')
      return
    }
    try {
      const graph: unknown = JSON.parse(await file.text())
      if (!isGraph(graph)) throw new Error('请从 ComfyUI 导出 API 格式 JSON 工作流')
      const next = initialDraft(graph, file.name)
      if (dirty) {
        setError('请先保存当前工作流，再导入新文件。')
        return
      }
      setSelectedId('')
      setDraft(next)
      setSelectedNodeId(
        next.image_node_id || next.prompt_node_id || Object.keys(next.workflow)[0] || ''
      )
      setSaved('')
      setNotice(`已导入 ${Object.keys(graph).length} 个节点；确认映射后保存。`)
      setError('')
    } catch (cause) {
      setError(errorText(cause, '无法导入工作流'))
    }
  }

  function addNodeParameter(input: string) {
    if (!draft || readonly || busy) return
    const existing = draft.parameters.find((parameter) =>
      parameter.targets.some(
        (target) => target.node_id === selectedNodeId && target.input === input
      )
    )
    if (existing) {
      setParameterId(existing.id)
      setParameterOpen(true)
      return
    }
    const field = selectedFields.find((item) => item.input === input)
    if (!field || draft.parameters.length >= 32) return
    const id = crypto.randomUUID()
    setDraft({
      ...draft,
      parameters: [
        ...draft.parameters,
        {
          id,
          name: input,
          kind:
            typeof field.value === 'number'
              ? 'number'
              : typeof field.value === 'boolean'
                ? 'boolean'
                : 'text',
          number_display: 'input',
          targets: [{ node_id: selectedNodeId, input }],
          options: [],
          minimum: null,
          maximum: null,
          step: null
        }
      ]
    })
    setParameterId(id)
    setParameterOpen(true)
  }
  function focusNode(id: string) {
    setSelectedNodeId(id)
    setNodeFocusRevision((revision) => revision + 1)
  }

  function toggleNodeOutput() {
    if (!draft || readonly || busy) return
    const mappings = draft.output_mappings || []
    const next = mappings.some((mapping) => mapping.node_id === selectedNodeId)
      ? mappings.filter((mapping) => mapping.node_id !== selectedNodeId)
      : mappings.length < 16
        ? [...mappings, { node_id: selectedNodeId, label: '' }]
        : mappings
    setDraft({ ...draft, output_mappings: next, output_node_id: next[0]?.node_id || '' })
  }

  function moveOutput(index: number, offset: number) {
    if (!draft) return
    const mappings = [...(draft.output_mappings || [])]
    const to = index + offset
    if (to < 0 || to >= mappings.length) return
    ;[mappings[index], mappings[to]] = [mappings[to], mappings[index]]
    setDraft({ ...draft, output_mappings: mappings, output_node_id: mappings[0]?.node_id || '' })
  }

  async function save() {
    if (!draft || busy) return
    const mappingError = validateWorkflowMappings(draft)
    if (mappingError) {
      setError(mappingError)
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const submitted = { ...draft, name: draft.name.trim() }
      const path = selectedId
        ? `/image-ai/studio/workflows/${encodeURIComponent(selectedId)}`
        : '/image-ai/studio/workflows'
      const preset = await apiFetch<StudioWorkflowPreset>(path, {
        method: selectedId ? 'PUT' : 'POST',
        body: JSON.stringify(submitted)
      })
      const [list] = await Promise.all([
        apiFetch<StudioWorkflowSummary[]>('/image-ai/studio/workflows')
      ])
      const input = inputFromPreset(preset)
      setRows(list)
      setSelectedId(preset.id)
      setDraft(input)
      setSaved(JSON.stringify(input))
      setNotice('工作流已保存，所有工作区均可选用。')
    } catch (cause) {
      setError(errorText(cause, '保存工作流失败；请检查节点映射'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!selectedId) return
    setBusy(true)
    setError('')
    try {
      await apiFetch(`/image-ai/studio/workflows/${encodeURIComponent(selectedId)}`, {
        method: 'DELETE'
      })
      setRows((current) => current.filter((row) => row.id !== selectedId))
      setSelectedId('')
      setDraft(null)
      setSaved('')
      setConfirmDelete(false)
      setNotice('工作流已删除。')
    } catch (cause) {
      setError(errorText(cause, '删除工作流失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      title="自定义工作流"
      description="导入 ComfyUI API 格式 JSON，配置图片、音频或视频工作流预设。"
    >
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} mb="md">
          {error}
        </Alert>
      )}
      <div className="settings-workflow-layout">
        <aside className="settings-workflow-list">
          <Group justify="space-between" mb="sm">
            <Text size="sm" fw={700}>
              预设 · {rows.length}
            </Text>
            <Button
              component="label"
              variant="light"
              size="xs"
              leftSection={<IconFileImport size={14} />}
              disabled={readonly || loading}
            >
              导入 JSON
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(event) => {
                  void importFile(event.currentTarget.files?.[0])
                  event.currentTarget.value = ''
                }}
              />
            </Button>
          </Group>
          {rows.length === 0 && (
            <Text size="xs" c="dimmed">
              暂无工作流预设。
            </Text>
          )}
          {rows.map((row) => (
            <button
              type="button"
              key={row.id}
              className={`settings-workflow-item${selectedId === row.id ? ' is-active' : ''}`}
              onClick={() => requestSelect(row.id)}
            >
              <span>{row.name}</span>
              <Badge size="xs" variant="light">
                {purposeOptions.find((option) => option.value === row.purpose)?.label ||
                  row.purpose}
              </Badge>
            </button>
          ))}
        </aside>
        <div className="settings-workflow-editor">
          {!draft ? (
            <div className="settings-workflow-empty">
              <IconPlus size={24} />
              <Text size="sm" c="dimmed">
                选择现有预设，或导入 ComfyUI API JSON。
              </Text>
            </div>
          ) : (
            <Stack gap="sm">
              {rows.find((row) => row.id === selectedId)?.unavailable_reason && (
                <Alert color="gray">
                  {rows.find((row) => row.id === selectedId)?.unavailable_reason}
                </Alert>
              )}
              <Group justify="space-between">
                <Text size="sm" fw={700}>
                  {selectedId ? '编辑工作流' : '新工作流'}
                </Text>
                <Group gap="xs">
                  {dirty && (
                    <Badge color="orange" variant="light">
                      未保存
                    </Badge>
                  )}
                  {selectedId && (
                    <Tooltip label="删除工作流">
                      <ActionIcon
                        color="red"
                        variant="subtle"
                        disabled={readonly || busy}
                        onClick={() => setConfirmDelete(true)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Group>
              <TextInput
                label="名称"
                value={draft.name}
                onChange={(event) => update('name', event.currentTarget.value)}
                maxLength={100}
                disabled={readonly || busy}
              />
              <Select
                label="用途"
                value={draft.purpose}
                data={purposeOptions}
                onChange={(value) => value && update('purpose', value as StudioWorkflowPurpose)}
                disabled={readonly || busy}
              />
              <Text size="xs" c="dimmed">
                {nodes.length} 个节点
                {isImagePurpose ? ` · ${draft.reference_slots.length} 个参考图输入` : ''}
                {` · ${draft.parameters.length} 个可调参数`}
              </Text>
              <Group gap={6} aria-label="节点映射概览">
                {[
                  { label: '主图', id: draft.image_node_id },
                  {
                    label: `参考图 ${draft.reference_slots.length}`,
                    id: draft.reference_slots[0]?.node_id
                  },
                  { label: '正向提示词', id: draft.prompt_node_id },
                  { label: '负向提示词', id: draft.negative_prompt_node_id },
                  {
                    label: '遮罩',
                    id: draft.mask_node_id || (derivedMask ? draft.image_node_id : '')
                  },
                  {
                    label: `图片结果 ${draft.output_mappings?.length || 0}`,
                    id: draft.output_node_id
                  }
                ].map((mapping) => (
                  <Button
                    key={mapping.label}
                    size="compact-xs"
                    variant="light"
                    disabled={!mapping.id}
                    onClick={() => focusNode(mapping.id || '')}
                  >
                    {mapping.label} · {mapping.id ? '已配置' : '未配置'}
                  </Button>
                ))}
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={readonly || busy}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      reference_slots: [],
                      mask_node_id: '',
                      mask_input: '',
                      mask_enabled: false,
                      prompt_node_id: '',
                      prompt_input: '',
                      negative_prompt_node_id: '',
                      negative_prompt_input: '',
                      output_node_id: '',
                      output_mappings: []
                    })
                  }
                >
                  只映射主图
                </Button>
              </Group>
              <div className="workflow-node-layout">
                <Suspense fallback={<div className="workflow-graph">加载节点图…</div>}>
                  <WorkflowGraph
                    key={selectedId || 'new'}
                    draft={draft}
                    selectedId={selectedNodeId}
                    focusRevision={nodeFocusRevision}
                    onSelect={setSelectedNodeId}
                  />
                </Suspense>
                <aside className="workflow-node-inspector">
                  {selectedNode ? (
                    <Stack gap="sm">
                      <div>
                        <Text size="xs" c="dimmed">
                          节点 {selectedNodeId}
                        </Text>
                        <Text fw={700} size="sm">
                          {selectedNode._meta?.title || selectedNode.class_type}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {selectedNode.class_type}
                        </Text>
                      </div>
                      {imageNodes.some(([id]) => id === selectedNodeId) && (
                        <>
                          <Text size="xs" fw={700}>
                            图片来源
                          </Text>
                          <SegmentedControl
                            size="xs"
                            value={imageRole}
                            data={[
                              { value: 'main', label: '主图' },
                              { value: 'reference', label: '参考图' },
                              { value: 'internal', label: '不替换' }
                            ]}
                            disabled={readonly || busy}
                            onChange={(value) =>
                              chooseImageRole(
                                selectedNodeId,
                                value as 'main' | 'reference' | 'internal'
                              )
                            }
                          />
                          {imageRole === 'main' && (
                            <Switch
                              size="xs"
                              label="使用主图遮罩"
                              checked={derivedMask && draft.mask_enabled !== false}
                              disabled={readonly || busy || !derivedMask}
                              onChange={(event) =>
                                update('mask_enabled', event.currentTarget.checked)
                              }
                            />
                          )}
                        </>
                      )}
                      {textInputs(selectedNodeId).length > 0 &&
                        !imageNodes.some(([id]) => id === selectedNodeId) && (
                          <>
                            <Text size="xs" fw={700}>
                              提示词映射
                            </Text>
                            <Button
                              size="xs"
                              variant="light"
                              disabled={readonly || busy}
                              onClick={() => chooseTextNode('prompt', selectedNodeId)}
                            >
                              设为正向提示词
                            </Button>
                            <Button
                              size="xs"
                              variant="default"
                              disabled={readonly || busy}
                              onClick={() => chooseTextNode('negative_prompt', selectedNodeId)}
                            >
                              设为负向提示词
                            </Button>
                          </>
                        )}
                      <Button
                        size="xs"
                        variant="default"
                        disabled={readonly || busy}
                        onClick={toggleNodeOutput}
                      >
                        {draft.output_mappings?.some(
                          (mapping) => mapping.node_id === selectedNodeId
                        )
                          ? '移出结果节点'
                          : '添加为结果节点'}
                      </Button>
                      <Text size="xs" fw={700}>
                        节点输入
                      </Text>
                      {Object.entries(selectedNode.inputs).map(([input, value]) => (
                        <div className="workflow-node-field" key={input}>
                          <Group gap={5} justify="space-between">
                            <Text size="xs" fw={650}>
                              {input}
                            </Text>
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              disabled={
                                readonly ||
                                busy ||
                                !selectedFields.some((field) => field.input === input)
                              }
                              onClick={() => addNodeParameter(input)}
                            >
                              设为可调
                            </Button>
                          </Group>
                          <Text size="xs" c="dimmed" className="workflow-node-value">
                            {Array.isArray(value)
                              ? `来自节点 ${value[0]} · 输出 ${value[1]}`
                              : String(value)}
                          </Text>
                        </div>
                      ))}
                    </Stack>
                  ) : (
                    <Text size="sm" c="dimmed">
                      点击节点查看输入及映射。
                    </Text>
                  )}
                </aside>
              </div>
              <Button
                variant="light"
                size="xs"
                onClick={() => {
                  setParameterId('')
                  setParameterOpen(true)
                }}
              >
                可调参数 {draft.parameters.length} 个 · 配置
              </Button>
              <Accordion
                key={draft.purpose}
                variant="separated"
                multiple
                defaultValue={isImagePurpose ? ['inputs'] : []}
              >
                {isImagePurpose && (
                  <Accordion.Item value="inputs">
                    <Accordion.Control>图片与提示词输入</Accordion.Control>
                    <Accordion.Panel>
                      {draft.purpose === 'image_edit' && (
                        <Stack gap="xs" mb="md">
                          <Text size="xs" c="dimmed">
                            每个图片输入节点可作为主图、参考图或工作流内部节点；参考图按下方顺序提交。
                          </Text>
                          {imageNodes.map(([id, node]) => {
                            const referenceIndex = draft.reference_slots.findIndex(
                              (slot) => slot.node_id === id
                            )
                            return (
                              <Group
                                key={id}
                                justify="space-between"
                                className="settings-workflow-role-row"
                              >
                                <Text
                                  size="sm"
                                  truncate
                                  title={`${id} · ${node._meta?.title || node.class_type}`}
                                >
                                  {id} · {node._meta?.title || node.class_type}
                                </Text>
                                <Group gap={4} wrap="nowrap">
                                  <Select
                                    size="xs"
                                    aria-label={`${id} 的图片角色`}
                                    value={
                                      draft.image_node_id === id
                                        ? 'main'
                                        : referenceIndex >= 0
                                          ? 'reference'
                                          : 'internal'
                                    }
                                    data={[
                                      { value: 'main', label: '主图' },
                                      {
                                        value: 'reference',
                                        label: '参考图',
                                        disabled:
                                          draft.reference_slots.length >= 13 && referenceIndex < 0
                                      },
                                      { value: 'internal', label: '内部' }
                                    ]}
                                    disabled={readonly || busy}
                                    onChange={(value) =>
                                      value &&
                                      chooseImageRole(
                                        id,
                                        value as 'main' | 'reference' | 'internal'
                                      )
                                    }
                                  />
                                  {referenceIndex >= 0 && (
                                    <>
                                      <ActionIcon
                                        size="sm"
                                        variant="subtle"
                                        aria-label={`${id} 参考图前移`}
                                        disabled={readonly || busy || referenceIndex === 0}
                                        onClick={() => moveReference(referenceIndex, -1)}
                                      >
                                        <IconArrowUp size={15} />
                                      </ActionIcon>
                                      <ActionIcon
                                        size="sm"
                                        variant="subtle"
                                        aria-label={`${id} 参考图后移`}
                                        disabled={
                                          readonly ||
                                          busy ||
                                          referenceIndex === draft.reference_slots.length - 1
                                        }
                                        onClick={() => moveReference(referenceIndex, 1)}
                                      >
                                        <IconArrowDown size={15} />
                                      </ActionIcon>
                                    </>
                                  )}
                                </Group>
                              </Group>
                            )
                          })}
                          {!imageNodes.length && (
                            <Alert color="orange">
                              该工作流没有 LoadImage 输入节点，不能用于图片编辑。
                            </Alert>
                          )}
                          <Text size="xs" c="dimmed">
                            参考图顺序：
                            {draft.reference_slots
                              .map((slot, index) => `${index + 1}. ${slot.node_id}`)
                              .join(' → ') || '未配置'}
                            （最多 13 张）
                          </Text>
                        </Stack>
                      )}
                      <div className="settings-workflow-mapping">
                        <Select
                          label="提示词节点"
                          searchable
                          clearable
                          data={nodes}
                          value={draft.prompt_node_id || null}
                          onChange={(value) => chooseTextNode('prompt', value || '')}
                          disabled={readonly || busy}
                        />
                        <Select
                          label="提示词字段"
                          data={textInputs(draft.prompt_node_id)}
                          value={draft.prompt_input || null}
                          onChange={(value) => update('prompt_input', value || '')}
                          disabled={readonly || busy}
                        />
                        <Select
                          label="负向提示词节点"
                          searchable
                          clearable
                          data={nodes}
                          value={draft.negative_prompt_node_id || null}
                          onChange={(value) => chooseTextNode('negative_prompt', value || '')}
                          disabled={readonly || busy}
                        />
                        <Select
                          label="负向提示词字段"
                          data={textInputs(draft.negative_prompt_node_id)}
                          value={draft.negative_prompt_input || null}
                          onChange={(value) => update('negative_prompt_input', value || '')}
                          disabled={readonly || busy}
                        />
                      </div>
                    </Accordion.Panel>
                  </Accordion.Item>
                )}
                {draft.purpose === 'image_edit' && (
                  <Accordion.Item value="mask">
                    <Accordion.Control>遮罩配置</Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="sm">
                        {derivedMask && (
                          <Alert color="blue">
                            主图 LoadImage 的 MASK
                            输出已连接到遮罩输入，使用主图透明通道，无需独立遮罩节点。
                          </Alert>
                        )}
                        <Select
                          label="独立遮罩节点"
                          description="仅支持 LoadImageMask 的 image 字段；channel 需为 alpha、red、green 或 blue。"
                          searchable
                          clearable
                          data={maskNodes}
                          value={draft.mask_node_id || null}
                          disabled={readonly || busy || derivedMask}
                          onChange={(value) =>
                            setDraft((current) =>
                              current
                                ? {
                                    ...current,
                                    mask_node_id: value || '',
                                    mask_input: value ? 'image' : '',
                                    mask_enabled: !!value
                                  }
                                : current
                            )
                          }
                        />
                        <Switch
                          label="制作时启用遮罩"
                          description="关闭时会从本次运行图中移除遮罩连接。"
                          checked={
                            (derivedMask || !!draft.mask_node_id) && draft.mask_enabled !== false
                          }
                          disabled={
                            readonly ||
                            busy ||
                            (!derivedMask && !draft.mask_node_id) ||
                            !isImagePurpose
                          }
                          onChange={(event) => update('mask_enabled', event.currentTarget.checked)}
                        />
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                )}
                {isImagePurpose && (
                  <Accordion.Item value="outputs">
                    <Accordion.Control>
                      图片结果节点 · {draft.output_mappings?.length || 0}
                    </Accordion.Control>
                    <Accordion.Panel>
                      <Stack gap="xs">
                        <Text size="xs" c="dimmed">
                          一个节点输出的多张图片会自动保存；可映射最多 16 个不同结果节点。
                        </Text>
                        {(draft.output_mappings || []).map((mapping, index) => (
                          <Group key={index} align="end" wrap="nowrap">
                            <Select
                              className="settings-workflow-flex"
                              label={`结果 ${index + 1} 节点`}
                              searchable
                              data={nodes}
                              value={mapping.node_id || null}
                              onChange={(value) => updateOutput(index, 'node_id', value || '')}
                              disabled={readonly || busy}
                            />
                            <TextInput
                              className="settings-workflow-flex"
                              label="显示名称"
                              maxLength={80}
                              value={mapping.label}
                              onChange={(event) =>
                                updateOutput(index, 'label', event.currentTarget.value)
                              }
                              disabled={readonly || busy}
                            />
                            <ActionIcon
                              variant="subtle"
                              aria-label={`定位结果 ${index + 1}`}
                              onClick={() => focusNode(mapping.node_id)}
                            >
                              ↗
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle"
                              aria-label={`上移结果 ${index + 1}`}
                              disabled={readonly || busy || index === 0}
                              onClick={() => moveOutput(index, -1)}
                            >
                              <IconArrowUp size={15} />
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle"
                              aria-label={`下移结果 ${index + 1}`}
                              disabled={
                                readonly ||
                                busy ||
                                index === (draft.output_mappings?.length || 0) - 1
                              }
                              onClick={() => moveOutput(index, 1)}
                            >
                              <IconArrowDown size={15} />
                            </ActionIcon>
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              aria-label={`移除结果 ${index + 1}`}
                              disabled={readonly || busy}
                              onClick={() => removeOutput(index)}
                            >
                              <IconTrash size={15} />
                            </ActionIcon>
                          </Group>
                        ))}
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconPlus size={14} />}
                          disabled={
                            readonly ||
                            busy ||
                            (draft.output_mappings?.length || 0) >= 16 ||
                            !outputNodes.some(
                              ({ value }) =>
                                !(draft.output_mappings || []).some(
                                  (mapping) => mapping.node_id === value
                                )
                            )
                          }
                          onClick={() => {
                            const next = outputNodes.find(
                              ({ value }) =>
                                !(draft.output_mappings || []).some(
                                  (mapping) => mapping.node_id === value
                                )
                            )
                            if (!next) return
                            const mappings = [
                              ...(draft.output_mappings || []),
                              { node_id: next.value, label: '' }
                            ]
                            setDraft({
                              ...draft,
                              output_mappings: mappings,
                              output_node_id: mappings[0].node_id
                            })
                          }}
                        >
                          添加结果节点
                        </Button>
                      </Stack>
                    </Accordion.Panel>
                  </Accordion.Item>
                )}
              </Accordion>
              <Group justify="flex-end" mt="sm">
                <Button
                  disabled={readonly || busy || !dirty}
                  loading={busy}
                  onClick={() => void save()}
                >
                  保存工作流
                </Button>
              </Group>
            </Stack>
          )}
        </div>
      </div>
      <Modal
        opened={parameterOpen}
        onClose={() => setParameterOpen(false)}
        title="工作流可调参数"
        size="xl"
        centered
      >
        {draft && (
          <WorkflowParameterSettings
            draft={draft}
            onChange={setDraft}
            disabled={readonly || busy}
            focusedId={parameterId}
          />
        )}
      </Modal>
      <Modal
        opened={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="删除工作流"
        centered
      >
        <Text size="sm">删除后，所有工作区都不能再选用“{draft?.name}”。</Text>
        {error && (
          <Alert color="red" mt="md">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setConfirmDelete(false)}>
            取消
          </Button>
          <Button color="red" loading={busy} onClick={() => void remove()}>
            删除
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={pendingSelection !== null}
        onClose={() => setPendingSelection(null)}
        title="未保存的工作流"
        centered
      >
        <Text size="sm">切换预设会丢失当前未保存的映射。</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setPendingSelection(null)}>
            继续编辑
          </Button>
          <Button
            color="orange"
            onClick={() => {
              const id = pendingSelection
              setPendingSelection(null)
              if (id !== null) void select(id)
            }}
          >
            放弃更改
          </Button>
        </Group>
      </Modal>
    </SettingsCard>
  )
}
