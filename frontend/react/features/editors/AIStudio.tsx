import type { ImageAICreationConfig } from '../../../src/features/ai-workflows/model/imageAIContracts'
import {
  resolveCreationDefault,
  type AIModel
} from '../../../src/features/ai-workflows/model/aiServices'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Indicator,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip
} from '@mantine/core'
import {
  IconBolt,
  IconDeviceFloppy,
  IconDownload,
  IconNotes,
  IconPhotoPlus,
  IconListCheck,
  IconX,
  IconSparkles
} from '@tabler/icons-react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { formatFileSize } from '../../shared/formatFileSize'
import { mutateWorkspaceState, readWorkspaceState } from '../../shared/workspaceState'
import { useEditorNavigation } from '../../design/navigation'
import {
  addWorkspaceAssets,
  readWorkspaceRecords,
  type WorkspaceAsset
} from '../../../src/features/workspaces/model/workspaceModel'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import {
  assertProductionDraftExists,
  createWorkspaceWorksRepository
} from '../../../src/features/workspaces/model/workspaceWorks'
import {
  defaultCreationModels,
  routerImageSizes,
  routerReferenceLimit,
  normalizeRouterChoice,
  routerAspectRatios
} from '../../../src/features/ai-workflows/model/creationOptions'
import { parameterSliderRange } from '../../../src/features/ai-workflows/model/workflowParameters'
import { workflowOutputMappings } from '../../../src/features/ai-workflows/model/workflowOutputs'
import {
  extractAnnotationPrompt,
  mergeAnnotationPrompt,
  readAnnotationPromptRules,
  type AnnotationPromptRules
} from '../../../src/features/ai-workflows/model/annotationPrompt'
import { sha256Hex } from '../../../src/shared/lib/sha256'
import {
  createImageLayer,
  createStudioDocument,
  studioLayerVisible,
  type StudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel'
import {
  renderStudioDocument,
  renderStudioMask,
  studioImageDimensions
} from '../../../src/features/image-editor/model/imageStudioRender'
import { studioDocumentRevision } from '../../../src/features/image-editor/model/studioPublication'
import {
  aiCreationSessionKey,
  readAICreationSession,
  selectAIImageTask
} from '../../../src/features/ai-workflows/model/aiCreationSession'
import type { EditorContext, RegisterEditorBeforeLeave } from './EditorHub'
import { savedAIEditDocument, savedAIReferenceDocument, savedAIReferencePaths } from './aiEditInput'
import { uniqueAIImageChoices } from './aiImageChoices'
import { EditorSaveQueue } from './editorSaveQueue'
import AITaskList, { type AIImageTask as Task } from './AITaskList'
import { planAIEditSubmission } from './aiEditSubmission'
import AIInputBoard, { type AIInputSlot } from './AIInputBoard'
import MaterialBar, { type MaterialClickMode } from './MaterialBar'
import AICreationTabs, { type AICreationKind } from './AICreationTabs'
import WorkbenchMediaPicker from '../workbench/WorkbenchMediaPicker'
import { MediaPreview } from '../media/MediaPreview'
import { getArtifactMetadata, getGenerationInfo } from '../media/mediaApi'
import { parse as parseGenerationInfo } from '../../../src/features/generation-metadata/model/generationInfoParser'
import {
  aiWorkflowParameterOverrides,
  initializeAIWorkflowParameters,
  validAIWorkflowParameters,
  type AIWorkflowParameter,
  type ParameterValue,
  type ParameterizedWorkflow
} from './aiWorkflowParameters'

type Mode = 'router' | 'workflow'
type Workflow = ParameterizedWorkflow & {
  unavailable_reason?: string
  name: string
  purpose?: string
  prompt_node_id: string
  image_node_id: string
  output_node_id: string
  output_mappings?: { node_id: string; label: string }[] | null
  negative_prompt_node_id?: string
  mask_enabled?: boolean
  mask_node_id?: string | null
  mask_from_image?: boolean
  mask_reference_limit?: number | null
  reference_slots?: string[]
}
type Model = { id: string; label: string }
type Choice = {
  mode: Mode
  model: string
  workflowId: string
  aspectRatio: string
  imageSize: string
  useMask?: boolean
  annotationRules?: AnnotationPromptRules
}

function imageUrl(context: EditorContext, path: string) {
  if (path.startsWith('workspace-artifact:'))
    return apiUrl(
      `/workspace_artifacts/${encodeURIComponent(path.slice('workspace-artifact:'.length))}/file`
    )
  const file = context.assetInfo[path]
  if (file?.workspace_artifact_id)
    return apiUrl(`/workspace_artifacts/${encodeURIComponent(file.workspace_artifact_id)}/file`)
  if (file?.edit_snapshot) {
    const value = file.edit_snapshot
    return apiUrl(
      `/image_edit_asset?path=${encodeURIComponent(value.owner)}&revision=${encodeURIComponent(value.revision)}&asset=${encodeURIComponent(value.asset)}`
    )
  }
  return apiUrl(
    `/img/${encodeURIComponent(file?.name || path.split(/[\\/]/).pop() || 'image')}?path=${encodeURIComponent(path)}`
  )
}

function storedEditDocumentId(
  storage: Pick<Storage, 'getItem'>,
  suffix: string,
  path: string,
  fallback: string
) {
  try {
    const raw = storage.getItem(
      `omnigallery:ai-image-edit-v1:${suffix}:${encodeURIComponent(path)}`
    )
    const value = JSON.parse(raw || 'null') as { id?: string } | null
    return value?.id || fallback
  } catch {
    return fallback
  }
}

async function imageAsBase64(source: string): Promise<string> {
  const image = new window.Image()
  image.crossOrigin = 'anonymous'
  image.src = source
  await image.decode()
  const ratio = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio))
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png').split(',')[1]
}

function WorkflowParameterField({
  parameter,
  value,
  readonly,
  onChange
}: {
  parameter: AIWorkflowParameter
  value: ParameterValue | undefined
  readonly: boolean
  onChange: (next: ParameterValue) => void
}) {
  if (parameter.kind === 'boolean')
    return (
      <Switch
        label={parameter.name}
        checked={value === true}
        onChange={(event) => onChange(event.currentTarget.checked)}
        disabled={readonly}
      />
    )
  if (parameter.kind === 'text')
    return (
      <TextInput
        label={parameter.name}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.currentTarget.value)}
        disabled={readonly}
      />
    )
  if (parameter.kind === 'select')
    return (
      <Select
        label={parameter.name}
        value={String(typeof value === 'number' ? value : -1)}
        data={[
          { value: '-1', label: '保持工作流默认' },
          ...parameter.options.map((option, index) => ({
            value: String(index),
            label: option.name
          }))
        ]}
        onChange={(next) => onChange(Number(next ?? -1))}
        disabled={readonly}
      />
    )
  const slider = parameterSliderRange(parameter)
  return (
    <Stack gap={5}>
      <NumberInput
        label={parameter.name}
        value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
        min={parameter.minimum ?? undefined}
        max={parameter.maximum ?? undefined}
        step={parameter.step ?? 1}
        onChange={(next) => onChange(next === '' ? Number.NaN : Number(next))}
        disabled={readonly}
      />
      {slider && (
        <Slider
          aria-label={`${parameter.name}滑块`}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          value={typeof value === 'number' && Number.isFinite(value) ? value : slider.min}
          onChange={onChange}
          disabled={readonly}
        />
      )}
    </Stack>
  )
}

export default function AIStudio({
  context,
  onBeforeLeave,
  backAction,
  helpAction
}: {
  context: EditorContext
  onBeforeLeave?: RegisterEditorBeforeLeave
  backAction: ReactNode
  helpAction: ReactNode
}) {
  const navigation = useEditorNavigation()
  const scope = `${context.work.id}:${context.draft.id}`
  const suffix = `${context.workspaceId}:${scope}`
  const storage = readWorkspaceState(context.workspaceId)
  const sourcePath =
    context.draft.source?.inputPath ||
    storage.getItem(`omnigallery:ai-image-edit-asset-v1:${suffix}`) ||
    ''
  const initialInputPath =
    sourcePath || context.assets.find((item) => item.kind === 'image')?.path || ''
  const editDocumentId = storedEditDocumentId(storage, suffix, initialInputPath, context.draft.id)
  const activePurposeKey = `omnigallery:ai-production-active-purpose-v1:${suffix}`
  const [purpose, setPurpose] = useState<'image_edit' | 'image_generation'>(() => {
    const saved = storage.getItem(activePurposeKey)
    if (saved === 'image_edit' || saved === 'image_generation') return saved
    return readAICreationSession(storage, context.workspaceId, scope, context.draft.aiPurpose)
      .imageTask === 'generation'
      ? 'image_generation'
      : 'image_edit'
  })
  const prefix = `omnigallery:ai-production-${purpose === 'image_generation' ? 'generation-' : ''}`
  const choiceKey = `${prefix}choice-v1:${suffix}`
  const promptKey = `${prefix}prompt-v1:${suffix}${purpose === 'image_edit' ? `:${editDocumentId}` : ''}`
  const negativeKey = `${prefix}negative-v1:${suffix}${purpose === 'image_edit' ? `:${editDocumentId}` : ''}`
  const initialChoice = (() => {
    try {
      return JSON.parse(storage.getItem(choiceKey) || 'null') as Partial<Choice> | null
    } catch {
      return null
    }
  })()
  const [choice, setChoice] = useState<Choice>({
    ...resolveCreationDefault(purpose, initialChoice),
    workflowId: initialChoice?.workflowId || '',
    aspectRatio: initialChoice?.aspectRatio || (purpose === 'image_generation' ? '1:1' : 'auto'),
    imageSize: initialChoice?.imageSize || '1K',
    annotationRules: readAnnotationPromptRules(initialChoice?.annotationRules)
  })
  useEffect(() => {
    setChoice((current) => {
      const next = normalizeRouterChoice(current)
      return JSON.stringify(next) === JSON.stringify(current) ? current : next
    })
  }, [choice.model, choice.aspectRatio, choice.imageSize])
  const creationDefaults = useRef<ImageAICreationConfig['defaults'] | null>(null)
  const choiceTouched = useRef(false)
  const currentPurpose = useRef(purpose)
  function editChoice(next: Choice) {
    choiceTouched.current = true
    setChoice(normalizeRouterChoice(next))
  }
  const [prompt, setPrompt] = useState(storage.getItem(promptKey) || '')
  const [negative, setNegative] = useState(storage.getItem(negativeKey) || '')
  const [inputPath, setInputPath] = useState(initialInputPath)
  const [referencePaths, setReferencePaths] = useState<string[]>(
    (() => {
      try {
        return (
          savedAIReferencePaths(storage, suffix, initialInputPath) ??
          context.draft.source?.referenceInputs?.map((item) => item.path) ??
          []
        )
      } catch {
        return context.draft.source?.referenceInputs?.map((item) => item.path) ?? []
      }
    })()
  )
  const [activeReference, setActiveReference] = useState('')
  const [slotTarget, setSlotTarget] = useState<AIInputSlot | null>(null)
  const [slotSearch, setSlotSearch] = useState('')
  const [referenceErrors, setReferenceErrors] = useState<Record<string, string>>({})
  const [referenceState, setReferenceState] = useState<Record<string, StudioDocument>>({})
  const referenceSaves = useRef(new Map<string, EditorSaveQueue<StudioDocument>>())
  const [useMask, setUseMask] = useState(initialChoice?.useMask !== false)
  const [previewError, setPreviewError] = useState('')
  const [editState, setEditState] = useState<{ path: string; document: StudioDocument } | null>(
    null
  )
  const [saveStatus, setSaveStatus] = useState('')
  const canvasSave = useRef<{ path: string; queue: EditorSaveQueue<StudioDocument> } | null>(null)
  const [models, setModels] = useState<Model[]>(defaultCreationModels)
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [parameterDraft, setParameterDraft] = useState<Record<string, ParameterValue>>({})
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskAction, setTaskAction] = useState('')
  const taskScope = useRef<string | null>(context.workspaceId)
  const taskRefresh = useRef<{ workspace: string; promise: Promise<void> } | null>(null)
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [note, setNote] = useState(context.draft.brief || '')
  const noteSaved = useRef(context.draft.brief || '')
  const [notesOpen, setNotesOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [outputName, setOutputName] = useState(context.draft.name)
  const [materialMode, setMaterialMode] = useState<MaterialClickMode>('view')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewPath, setPreviewPath] = useState('')
  const [borrowedPrompt, setBorrowedPrompt] = useState('')
  const [borrowLoading, setBorrowLoading] = useState(false)
  const [generationResultId, setGenerationResultId] = useState('')
  const [generationZoom, setGenerationZoom] = useState(1)
  const [generationOffset, setGenerationOffset] = useState({ x: 0, y: 0 })
  const generationDrag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(
    null
  )
  const [addedAssets, setAddedAssets] = useState<WorkspaceAsset[]>([])
  const imageAssets = useMemo(
    () =>
      addWorkspaceAssets([], [...context.assets, ...addedAssets]).filter(
        (item) => item.kind === 'image'
      ),
    [context.assets, addedAssets]
  )
  const previewFiles = imageAssets
    .map((asset) => context.assetInfo[asset.path])
    .filter((file): file is NonNullable<typeof file> => !!file)
  useEffect(() => {
    if (!previewPath || purpose !== 'image_generation') {
      setBorrowedPrompt('')
      setBorrowLoading(false)
      return
    }
    let active = true
    const file = context.assetInfo[previewPath]
    if (!file) return
    setBorrowedPrompt('')
    setBorrowLoading(true)
    const load = file.workspace_artifact_id
      ? getArtifactMetadata(file.workspace_artifact_id).then((value) => value.generation_info)
      : getGenerationInfo(file.fullpath)
    void load
      .then((raw) => {
        if (!active) return
        const value = parseGenerationInfo(raw || '').prompt
        setBorrowedPrompt(typeof value === 'string' ? value.trim() : '')
      })
      .catch(() => {
        if (active) setBorrowedPrompt('')
      })
      .finally(() => {
        if (active) setBorrowLoading(false)
      })
    return () => {
      active = false
    }
  }, [previewPath, purpose, context.assetInfo])
  const sourceInput = context.draft.source?.inputPath
  const inputChoices = uniqueAIImageChoices([
    ...(sourceInput
      ? [{ value: sourceInput, label: `来源 · ${context.draft.source?.label || '画布快照'}` }]
      : []),
    ...imageAssets
      .filter((item) => item.path !== sourceInput)
      .map((item) => ({ value: item.path, label: item.name }))
  ])
  const referenceChoices = uniqueAIImageChoices([
    ...(context.draft.source?.referenceInputs?.map((item) => ({
      value: item.path,
      label: `来源参考 · ${context.assetInfo[item.sourcePath]?.name || item.sourcePath.split(/[\\/]/).pop() || '图片'}`
    })) ?? []),
    ...imageAssets.map((item) => ({ value: item.path, label: item.name }))
  ])
  const availableWorkflows = workflows.filter(
    (item) => !item.unavailable_reason && (item.purpose || 'image_edit') === purpose
  )
  const selectedWorkflow = availableWorkflows.find((item) => item.id === choice.workflowId)
  const selectedOutputs = workflowOutputMappings(selectedWorkflow)
  useEffect(() => {
    if (!availableWorkflows.length || selectedWorkflow) return
    setChoice((current) => ({ ...current, workflowId: availableWorkflows[0].id }))
  }, [workflows, purpose, choice.workflowId])
  const parameterKey = `${prefix}parameters-v1:${suffix}`
  const parametersValid = selectedWorkflow
    ? validAIWorkflowParameters(selectedWorkflow, parameterDraft)
    : false
  const restoredInput = useMemo(() => {
    try {
      return { document: savedAIEditDocument(storage, suffix, inputPath), error: '' }
    } catch (cause) {
      return {
        document: null,
        error: cause instanceof Error ? cause.message : '已保存的 AI 编辑画布无法读取'
      }
    }
  }, [inputPath, suffix])
  const currentDocument =
    editState?.path === inputPath ? editState.document : restoredInput.document
  const restoredReferences = useMemo(
    () =>
      Object.fromEntries(
        referencePaths.map((path) => {
          try {
            return [
              path,
              { document: savedAIReferenceDocument(storage, suffix, inputPath, path), error: '' }
            ]
          } catch (cause) {
            return [
              path,
              {
                document: null,
                error: cause instanceof Error ? cause.message : '已保存的参考图无法读取'
              }
            ]
          }
        })
      ),
    [referencePaths, inputPath, suffix]
  )
  const activeDocument = activeReference
    ? (referenceState[activeReference] ?? restoredReferences[activeReference]?.document)
    : currentDocument
  const activePreviewPath = activeReference || inputPath
  const maskLayers = currentDocument?.layers.filter(
    (layer) =>
      layer.kind === 'mask' &&
      studioLayerVisible(currentDocument, layer) &&
      layer.strokes.some((stroke) => stroke.mode === 'paint')
  )
  const workflowUsesMask =
    selectedWorkflow?.mask_enabled !== false &&
    !!(selectedWorkflow?.mask_node_id || selectedWorkflow?.mask_from_image)
  const [historyHost, setHistoryHost] = useState<HTMLDivElement | null>(null)
  const referenceLimit =
    choice.mode === 'workflow'
      ? ((useMask && maskLayers?.length && workflowUsesMask
          ? selectedWorkflow?.mask_reference_limit
          : selectedWorkflow?.reference_slots?.length) ?? 0)
      : routerReferenceLimit(choice.model)
  const inputPlan = planAIEditSubmission({
    mainPath: inputPath,
    referencePaths,
    referenceLimit,
    hasMask: !!maskLayers?.length,
    useMask,
    supportsMask: choice.mode === 'workflow' && workflowUsesMask,
    providerLabel:
      choice.mode === 'workflow'
        ? useMask && maskLayers?.length && workflowUsesMask
          ? '当前工作流提交遮罩时'
          : '当前工作流'
        : '当前模型'
  })
  const annotationPrompt = extractAnnotationPrompt(
    currentDocument,
    readAnnotationPromptRules(choice.annotationRules)
  )
  const relevantTasks = tasks.filter(
    (item) =>
      item.document_id === context.draft.id || (!item.document_id && item.name === outputName)
  )
  const generationResults = [
    ...new Set(
      relevantTasks
        .filter((item) => item.purpose === 'image_generation' && item.state === 'completed')
        .slice()
        .reverse()
        .flatMap((item) =>
          item.results?.length
            ? item.results.map((result) => result.artifact_id)
            : item.artifact_id
              ? [item.artifact_id]
              : []
        )
        .filter(Boolean)
    )
  ]
  useEffect(() => {
    setGenerationResultId((current) =>
      generationResults.includes(current) ? current : generationResults[0] || ''
    )
  }, [generationResults.join('|')])
  useEffect(() => {
    setGenerationZoom(1)
    setGenerationOffset({ x: 0, y: 0 })
  }, [generationResultId])

  useEffect(() => {
    if (!selectedWorkflow) {
      setParameterDraft({})
      return
    }
    let saved: { workflowId?: string; values?: Record<string, unknown> } | null = null
    try {
      saved = JSON.parse(storage.getItem(parameterKey) || 'null')
    } catch {
      /* Keep workflow defaults if an earlier parameter draft is damaged. */
    }
    setParameterDraft(initializeAIWorkflowParameters(selectedWorkflow, saved))
  }, [selectedWorkflow, parameterKey])

  function ensureCanvasSaveQueue(document: StudioDocument): EditorSaveQueue<StudioDocument> {
    if (canvasSave.current?.path === inputPath) return canvasSave.current.queue
    const path = inputPath
    const key = `omnigallery:ai-image-edit-v1:${suffix}:${encodeURIComponent(path)}`
    let previousRaw = storage.getItem(key)
    const queue = new EditorSaveQueue(document, async (snapshot) => {
      const raw = JSON.stringify(snapshot)
      await mutateWorkspaceState(context.workspaceId, (draftStorage) => {
        assertProductionDraftExists(draftStorage, context.workspaceId, context.draft.id)
        if (draftStorage.getItem(key) !== previousRaw)
          throw new Error('此 AI 编辑画布已在其他窗口修改，请重新打开；本次修改尚未保存')
        draftStorage.setItem(key, raw)
        draftStorage.setItem(`omnigallery:ai-image-edit-asset-v1:${suffix}`, path)
      })
      previousRaw = raw
    })
    if (!previousRaw) queue.update({ ...document })
    canvasSave.current = { path, queue }
    return queue
  }
  function changeDocument(next: StudioDocument) {
    if (!inputPath || context.readonly) return
    ensureCanvasSaveQueue(currentDocument ?? next).update(next)
    setEditState({ path: inputPath, document: next })
    setSaveStatus('未保存')
  }
  function ensureReferenceSaveQueue(path: string, document: StudioDocument) {
    const existing = referenceSaves.current.get(path)
    if (existing) return existing
    const key = `omnigallery:ai-image-ref-v1:${suffix}:${encodeURIComponent(inputPath)}:${encodeURIComponent(path)}`
    let previousRaw = storage.getItem(key)
    const queue = new EditorSaveQueue(document, async (snapshot) => {
      const raw = JSON.stringify(snapshot)
      await mutateWorkspaceState(context.workspaceId, (draftStorage) => {
        assertProductionDraftExists(draftStorage, context.workspaceId, context.draft.id)
        if (draftStorage.getItem(key) !== previousRaw)
          throw new Error('此参考图画布已在其他窗口修改，请重新打开；本次修改尚未保存')
        draftStorage.setItem(key, raw)
      })
      previousRaw = raw
    })
    if (!previousRaw) queue.update({ ...document })
    referenceSaves.current.set(path, queue)
    return queue
  }
  function changeReferenceDocument(path: string, next: StudioDocument) {
    if (!referencePaths.includes(path) || context.readonly) return
    ensureReferenceSaveQueue(
      path,
      referenceState[path] ?? restoredReferences[path]?.document ?? next
    ).update(next)
    setReferenceState((current) => ({ ...current, [path]: next }))
    setSaveStatus('未保存')
  }
  async function flushCanvas(): Promise<boolean> {
    if (context.readonly || purpose !== 'image_edit' || !inputPath) return true
    try {
      if (currentDocument) await ensureCanvasSaveQueue(currentDocument).flush()
      for (const queue of referenceSaves.current.values()) await queue.flush()
      setSaveStatus('画布已保存')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI 编辑画布未能保存')
      setSaveStatus('保存失败')
      return false
    }
  }
  async function switchInput(nextPath: string) {
    if (nextPath === inputPath) return
    if (!(await flushCanvas())) return
    try {
      await persistSettings()
      const nextId = storedEditDocumentId(storage, suffix, nextPath, context.draft.id)
      const nextReferences = savedAIReferencePaths(storage, suffix, nextPath) ?? []
      setEditState(null)
      canvasSave.current = null
      setReferenceState({})
      setReferenceErrors({})
      setPreviewError('')
      referenceSaves.current.clear()
      setActiveReference('')
      setInputPath(nextPath)
      setReferencePaths(nextReferences)
      setPrompt(storage.getItem(`${prefix}prompt-v1:${suffix}:${nextId}`) || '')
      setNegative(storage.getItem(`${prefix}negative-v1:${suffix}:${nextId}`) || '')
      setSaveStatus('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '切换输入图片失败')
    }
  }

  useEffect(() => {
    if (purpose !== 'image_edit' || !inputPath || restoredInput.error || currentDocument) return
    let live = true
    const file = context.assetInfo[inputPath]
    if (!file) {
      setPreviewError('输入图片已不可用')
      return
    }
    void studioImageDimensions(file)
      .then((dimensions) => {
        if (!live) return
        if (!dimensions) throw new Error('无法读取输入图片尺寸')
        const ratio = Math.min(1, 2048 / Math.max(dimensions.width, dimensions.height))
        const width = Math.max(1, Math.round(dimensions.width * ratio))
        const height = Math.max(1, Math.round(dimensions.height * ratio))
        const fresh = createStudioDocument(file.name)
        fresh.width = width
        fresh.height = height
        fresh.layers = [createImageLayer(inputPath, { x: 0, y: 0, width, height }, file.name)]
        setEditState({ path: inputPath, document: fresh })
      })
      .catch((cause) => {
        if (live) setPreviewError(cause instanceof Error ? cause.message : '输入图片读取失败')
      })
    return () => {
      live = false
    }
  }, [
    purpose,
    inputPath,
    restoredInput.document,
    restoredInput.error,
    currentDocument,
    context.assetInfo
  ])

  useEffect(() => {
    if (purpose !== 'image_edit' || !inputPath) return
    let live = true
    const pending = referencePaths.filter(
      (path) =>
        !referenceState[path] &&
        !restoredReferences[path]?.document &&
        !restoredReferences[path]?.error &&
        !referenceErrors[path]
    )
    if (!pending.length) return
    void Promise.all(
      pending.map(async (path) => {
        try {
          const file = context.assetInfo[path]
          if (!file) throw new Error('参考图已不可用')
          const dimensions = await studioImageDimensions(file)
          if (!dimensions) throw new Error('无法读取参考图尺寸')
          const ratio = Math.min(1, 2048 / Math.max(dimensions.width, dimensions.height))
          const width = Math.max(1, Math.round(dimensions.width * ratio))
          const height = Math.max(1, Math.round(dimensions.height * ratio))
          const fresh = createStudioDocument(file.name)
          fresh.width = width
          fresh.height = height
          fresh.layers = [createImageLayer(path, { x: 0, y: 0, width, height }, file.name)]
          return { path, document: fresh, error: '' }
        } catch (cause) {
          return {
            path,
            document: null,
            error: cause instanceof Error ? cause.message : '参考图读取失败'
          }
        }
      })
    ).then((results) => {
      if (!live) return
      setReferenceState((current) => ({
        ...Object.fromEntries(
          results.flatMap((item) => (item.document ? [[item.path, item.document]] : []))
        ),
        ...current
      }))
      setReferenceErrors((current) => ({
        ...current,
        ...Object.fromEntries(
          results.filter((item) => item.error).map((item) => [item.path, item.error])
        )
      }))
    })
    return () => {
      live = false
    }
  }, [
    purpose,
    inputPath,
    referencePaths,
    referenceState,
    restoredReferences,
    referenceErrors,
    context.assetInfo
  ])

  useEffect(() => {
    if (purpose !== 'image_edit' || !inputPath || context.readonly) return
    if (currentDocument) ensureCanvasSaveQueue(currentDocument)
    for (const path of referencePaths) {
      const doc = referenceState[path] ?? restoredReferences[path]?.document
      if (doc) ensureReferenceSaveQueue(path, doc)
    }
    if (
      !canvasSave.current?.queue.dirty &&
      ![...referenceSaves.current.values()].some((queue) => queue.dirty)
    )
      return
    const timer = window.setTimeout(() => void flushCanvas(), 450)
    return () => window.clearTimeout(timer)
  }, [purpose, inputPath, currentDocument, referenceState, referencePaths, context.readonly])

  useEffect(() => {
    onBeforeLeave?.(async () => {
      if (context.readonly) return true
      if (!(await flushCanvas())) return false
      try {
        await persistSettings()
        return true
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'AI 创作设置未能保存')
        return false
      }
    })
    return () => onBeforeLeave?.(null)
  })

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        !canvasSave.current?.queue.dirty &&
        ![...referenceSaves.current.values()].some((queue) => queue.dirty)
      )
        return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  function refreshTasks(): Promise<void> {
    if (taskRefresh.current?.workspace === context.workspaceId) return taskRefresh.current.promise
    const promise = readTasks().finally(() => {
      if (taskRefresh.current?.promise === promise) taskRefresh.current = null
    })
    taskRefresh.current = { workspace: context.workspaceId, promise }
    return promise
  }
  async function readTasks() {
    try {
      const query = new URLSearchParams({ workspace_id: context.workspaceId })
      const [nextTasks, artifacts] = await Promise.all([
        apiFetch<Task[]>(`/image-ai/tasks?${query}`),
        apiFetch<WorkspaceArtifact[]>(`/workspace_artifacts?${query}`).catch(() => [])
      ])
      if (taskScope.current !== context.workspaceId) return
      setTasks(nextTasks)
      const images = artifacts.filter((item) => item.kind === 'image' && !item.input_owner)
      for (const item of images) {
        const path = `workspace-artifact:${item.id}`
        context.assetInfo[path] = {
          workspace_artifact_id: item.id,
          workspace_artifact_source: item.source,
          fullpath: path,
          name: item.name,
          type: 'file',
          size: formatFileSize(item.bytes),
          bytes: item.bytes,
          date: item.created_at,
          created_time: item.created_at,
          is_under_scanned_path: false,
          width: item.width,
          height: item.height
        }
      }
      setAddedAssets((current) =>
        addWorkspaceAssets(
          current,
          images.map((item) => ({
            path: `workspace-artifact:${item.id}`,
            name: item.name,
            kind: 'image'
          }))
        )
      )
    } catch (cause) {
      if (taskScope.current !== context.workspaceId) return
      setError(cause instanceof Error ? cause.message : '任务列表读取失败')
    }
  }
  useEffect(() => {
    let live = true
    taskScope.current = context.workspaceId
    void Promise.allSettled([
      apiFetch<ImageAICreationConfig>('/image-ai/creation/config').then((value) => {
        if (!live) return
        setKeyConfigured(value.comfy_api_key_configured)
        creationDefaults.current = value.defaults
        const active = currentPurpose.current
        const activePrefix = `omnigallery:ai-production-${active === 'image_generation' ? 'generation-' : ''}`
        if (!choiceTouched.current && !storage.getItem(`${activePrefix}choice-v1:${suffix}`)) {
          const defaults = resolveCreationDefault(active, null, value.defaults)
          setChoice((current) => ({ ...current, ...defaults }))
        }
      }),
      apiFetch<{ models: AIModel[] }>('/ai/services/models').then((value) => {
        if (live)
          setModels(
            value.models.filter((item) => item.enabled && item.capabilities.includes('generation'))
          )
      }),
      apiFetch<Workflow[]>('/image-ai/studio/workflows').then((value) => {
        if (live) setWorkflows(value)
      }),
      refreshTasks()
    ])
    return () => {
      live = false
      taskScope.current = null
    }
  }, [context.workspaceId])
  const hasActiveTasks = tasks.some((task) => task.state === 'queued' || task.state === 'running')
  useEffect(() => {
    if (!hasActiveTasks) return
    const timer = window.setInterval(() => void refreshTasks(), 3500)
    return () => window.clearInterval(timer)
  }, [hasActiveTasks, context.workspaceId])

  async function actOnTask(task: Task, action: 'cancel' | 'resume') {
    setTaskAction(task.id)
    try {
      await apiFetch(
        `/image-ai/tasks/${task.id}/${action}?${new URLSearchParams({ workspace_id: context.workspaceId })}`,
        { method: 'POST' }
      )
      // A poll started before the action may still hold the old state.
      await taskRefresh.current?.promise
      await refreshTasks()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务操作失败')
    } finally {
      setTaskAction('')
    }
  }

  async function persistSettings() {
    await mutateWorkspaceState(context.workspaceId, (draftStorage) => {
      assertProductionDraftExists(draftStorage, context.workspaceId, context.draft.id)
      draftStorage.setItem(choiceKey, JSON.stringify({ ...choice, useMask }))
      if (selectedWorkflow)
        draftStorage.setItem(
          parameterKey,
          JSON.stringify({ workflowId: selectedWorkflow.id, values: parameterDraft })
        )
      const activeId =
        currentDocument?.id || storedEditDocumentId(storage, suffix, inputPath, context.draft.id)
      const activeSuffix = purpose === 'image_edit' ? `:${activeId}` : ''
      draftStorage.setItem(`${prefix}prompt-v1:${suffix}${activeSuffix}`, prompt)
      draftStorage.setItem(`${prefix}negative-v1:${suffix}${activeSuffix}`, negative)
      if (purpose === 'image_edit' && inputPath)
        draftStorage.setItem(
          `omnigallery:ai-image-refs-v1:${suffix}:${encodeURIComponent(inputPath)}`,
          JSON.stringify(referencePaths)
        )
      if (note !== noteSaved.current) {
        const repository = createWorkspaceWorksRepository(context.workspaceId, draftStorage)
        const current = repository.load()
        repository.save({
          ...current,
          works: current.works.map((work) =>
            work.id === context.work.id
              ? {
                  ...work,
                  drafts: work.drafts.map((draft) =>
                    draft.id === context.draft.id
                      ? { ...draft, brief: note, updatedAt: new Date().toISOString() }
                      : draft
                  )
                }
              : work
          )
        })
      }
    })
    noteSaved.current = note
  }
  async function saveNote() {
    if (context.readonly || note === noteSaved.current) return
    try {
      await persistSettings()
      setStatus('制作笔记已保存')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '制作笔记未能保存')
    }
  }
  async function saveEdit() {
    setError('')
    if (!(await flushCanvas())) return
    try {
      await persistSettings()
      setSaveStatus('编辑文档已保存到本机')
    } catch (cause) {
      setSaveStatus('保存失败')
      setError(cause instanceof Error ? cause.message : 'AI 编辑设置未能保存')
    }
  }
  async function exportEditedImage() {
    if (busy || context.readonly || purpose !== 'image_edit' || !inputPath) return
    setBusy(true)
    setError('')
    try {
      if (!(await flushCanvas())) return
      await persistSettings()
      let imageBase64: string
      if (activeDocument) {
        const output = document.createElement('canvas')
        const missing = await renderStudioDocument(
          output,
          activeDocument,
          context.assetInfo,
          false,
          { kind: 'all' },
          undefined,
          true
        )
        if (missing.length) throw new Error(`无法读取画布素材：${missing.join('、')}`)
        imageBase64 = output.toDataURL('image/png').split(',')[1]
      } else imageBase64 = await imageAsBase64(imageUrl(context, activePreviewPath))
      await apiFetch('/workspace_artifacts', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: context.workspaceId,
          name: (activeDocument?.name || outputName.trim() || 'AI 编辑图片').slice(0, 120),
          format: 'png',
          source: 'ai_image_edit',
          image_base64: imageBase64,
          document_id: context.draft.id,
          document_revision: activeDocument
            ? studioDocumentRevision(activeDocument)
            : sha256Hex(JSON.stringify({ path: activePreviewPath, imageBase64 }))
        })
      })
      setStatus('产物已导出到工作区')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出产物失败')
    } finally {
      setBusy(false)
    }
  }
  async function addLibraryAssets(incoming: WorkspaceAsset[]) {
    const images = incoming.filter((asset) => asset.kind === 'image')
    if (!images.length) throw new Error('请选择图片素材')
    const settings = await apiFetch<{ app_fe_setting?: { workbench_projects?: unknown } }>(
      '/global_setting'
    )
    const records = readWorkspaceRecords(settings.app_fe_setting?.workbench_projects)
    await apiFetch('/app_fe_setting', {
      method: 'POST',
      body: JSON.stringify({
        name: 'workbench_projects',
        value: JSON.stringify({
          version: 2,
          items: records.map((item) =>
            item.id === context.workspaceId
              ? {
                  ...item,
                  assets: addWorkspaceAssets(item.assets, images),
                  updatedAt: new Date().toISOString()
                }
              : item
          )
        })
      })
    })
    const files = await apiFetch<Record<string, EditorContext['assetInfo'][string]>>(
      '/batch_get_files_info',
      {
        method: 'POST',
        body: JSON.stringify({ paths: images.map((item) => item.path) })
      }
    )
    Object.assign(context.assetInfo, files)
    setAddedAssets((current) => addWorkspaceAssets(current, images))
    setPickerOpen(false)
    setStatus(`已加入 ${images.length} 张图片`)
    if (slotTarget && images[0]) await putInSlot(images[0].path)
  }
  function chooseSlot(slot: AIInputSlot) {
    setSlotTarget(slot)
    setSlotSearch('')
  }
  async function putInSlot(path: string) {
    if (context.readonly || !slotTarget) return
    if (slotTarget === 'main') {
      if (sourceInput) return
      await switchInput(path)
    } else if (path !== inputPath && !referencePaths.includes(path)) {
      if (slotTarget === 'append') {
        setReferencePaths((current) => [...current, path])
      } else {
        const old = slotTarget.reference
        setReferencePaths((current) => current.map((item) => (item === old ? path : item)))
      }
      setActiveReference(path)
      setSaveStatus('未保存')
    }
    setSlotTarget(null)
  }
  function removeReference(path: string) {
    if (context.readonly) return
    setReferencePaths((current) => current.filter((item) => item !== path))
    if (activeReference === path) setActiveReference('')
    setSaveStatus('未保存')
  }
  async function selectMaterial(asset: WorkspaceAsset) {
    if (purpose === 'image_generation') {
      setPreviewPath(asset.path)
      return
    }
    if (asset.path === inputPath) {
      setActiveReference('')
      return
    }
    if (referencePaths.includes(asset.path)) {
      setActiveReference(asset.path)
      return
    }
    if (inputPath) {
      setReferencePaths((current) => [...current, asset.path])
      setActiveReference(asset.path)
      setStatus('已加入参考图')
      return
    }
    await switchInput(asset.path)
  }
  function materialAction(asset: WorkspaceAsset, key: string) {
    if (key === 'preview') {
      setPreviewPath(asset.path)
      return
    }
    if (key === 'main') {
      if (sourceInput && asset.path !== sourceInput) {
        setStatus('此分支使用固定来源快照，不能替换主图')
      } else if (purpose === 'image_generation') {
        void switchPurpose('image_edit', asset.path)
      } else {
        void switchInput(asset.path)
      }
    }
    if (
      key === 'reference' &&
      inputPath &&
      asset.path !== inputPath &&
      !referencePaths.includes(asset.path)
    ) {
      setReferencePaths((current) => [...current, asset.path])
      setActiveReference(asset.path)
    }
    if (key === 'remove-reference') {
      setReferencePaths((current) => current.filter((path) => path !== asset.path))
      if (activeReference === asset.path) setActiveReference('')
    }
  }
  async function switchPurpose(
    next: 'image_edit' | 'image_generation',
    requestedInputPath?: string
  ) {
    if (next === purpose || busy) return
    try {
      if (!(await flushCanvas())) return
      await persistSettings()
      await mutateWorkspaceState(context.workspaceId, (draftStorage) => {
        assertProductionDraftExists(draftStorage, context.workspaceId, context.draft.id)
        draftStorage.setItem(activePurposeKey, next)
        const prior = readAICreationSession(
          draftStorage,
          context.workspaceId,
          scope,
          context.draft.aiPurpose
        )
        draftStorage.setItem(
          aiCreationSessionKey(context.workspaceId, scope),
          JSON.stringify(
            selectAIImageTask(prior, next === 'image_generation' ? 'generation' : 'edit')
          )
        )
      })
      const nextPrefix = `omnigallery:ai-production-${next === 'image_generation' ? 'generation-' : ''}`
      const nextInputPath =
        next === 'image_edit' ? sourceInput || requestedInputPath || inputPath : inputPath
      const nextDocumentId =
        nextInputPath === inputPath && currentDocument?.id
          ? currentDocument.id
          : storedEditDocumentId(storage, suffix, nextInputPath, context.draft.id)
      const nextChoice = JSON.parse(
        readWorkspaceState(context.workspaceId).getItem(`${nextPrefix}choice-v1:${suffix}`) ||
          'null'
      ) as Partial<Choice> | null
      currentPurpose.current = next
      choiceTouched.current = false
      setChoice({
        ...resolveCreationDefault(next, nextChoice, creationDefaults.current),
        workflowId: nextChoice?.workflowId || '',
        aspectRatio: nextChoice?.aspectRatio || (next === 'image_generation' ? '1:1' : 'auto'),
        imageSize: nextChoice?.imageSize || '1K',
        annotationRules: readAnnotationPromptRules(nextChoice?.annotationRules)
      })
      setUseMask(nextChoice?.useMask !== false)
      if (nextInputPath !== inputPath) {
        setEditState(null)
        canvasSave.current = null
        setReferenceState({})
        setReferenceErrors({})
        setPreviewError('')
        referenceSaves.current.clear()
        setActiveReference('')
        setInputPath(nextInputPath)
        setReferencePaths(savedAIReferencePaths(storage, suffix, nextInputPath) ?? [])
      }
      setPrompt(
        readWorkspaceState(context.workspaceId).getItem(
          `${nextPrefix}prompt-v1:${suffix}${next === 'image_edit' ? `:${nextDocumentId}` : ''}`
        ) || ''
      )
      setNegative(
        readWorkspaceState(context.workspaceId).getItem(
          `${nextPrefix}negative-v1:${suffix}${next === 'image_edit' ? `:${nextDocumentId}` : ''}`
        ) || ''
      )
      setPurpose(next)
      setError('')
      setStatus('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '切换创作方式失败')
    }
  }
  async function openRelatedEditor(next: AICreationKind | 'image', draftId: string) {
    if (busy) return
    if (!context.readonly) {
      if (!(await flushCanvas())) return
      try {
        await persistSettings()
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'AI 创作设置未能保存')
        return
      }
    }
    navigation.openEditor(next, draftId)
  }
  async function switchCreationKind(next: AICreationKind) {
    if (next === 'ai-image') return
    await openRelatedEditor(next, context.draft.id)
  }
  async function submit() {
    if (busy || context.readonly) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      if (!keyConfigured) throw new Error('请先在设置 · AI 设置中配置 Comfy 密钥')
      if (!(await flushCanvas())) return
      await persistSettings()
      if (choice.mode === 'router' && !prompt.trim()) throw new Error('请填写画面描述或编辑要求')
      if (choice.mode === 'workflow' && !selectedWorkflow) throw new Error('请选择工作流')
      if (choice.mode === 'workflow' && !selectedOutputs.length)
        throw new Error('当前工作流没有映射图片输出节点')
      if (choice.mode === 'workflow' && selectedWorkflow?.prompt_node_id && !prompt.trim())
        throw new Error('当前工作流需要填写提示词')
      if (choice.mode === 'workflow' && selectedWorkflow && !parametersValid)
        throw new Error('请检查工作流可调参数的取值')
      const settings: Record<string, unknown> =
        choice.mode === 'router'
          ? {
              prompt: prompt.trim(),
              model: choice.model,
              ...(choice.aspectRatio !== 'auto' ? { aspect_ratio: choice.aspectRatio } : {}),
              ...(routerImageSizes(choice.model).length > 0 ? { image_size: choice.imageSize } : {})
            }
          : {
              workflow_id: choice.workflowId,
              prompt: prompt.trim(),
              negative_prompt: negative,
              parameter_values: selectedWorkflow
                ? aiWorkflowParameterOverrides(selectedWorkflow, parameterDraft)
                : {}
            }
      if (choice.mode === 'workflow' && !choice.workflowId) throw new Error('请选择工作流')
      if (purpose === 'image_edit') {
        if (!inputPath) throw new Error('请选择一张输入图片')
        if (restoredInput.error) throw new Error(restoredInput.error)
        if (currentDocument) {
          const canvas = document.createElement('canvas')
          const missing = await renderStudioDocument(
            canvas,
            currentDocument,
            context.assetInfo,
            false,
            { kind: 'all' },
            2048,
            true
          )
          if (missing.length) throw new Error(`无法读取编辑画布素材：${missing.join('、')}`)
          settings.image_base64 = canvas.toDataURL('image/png').split(',')[1]
          if (inputPlan.submitMask) {
            const mask = document.createElement('canvas')
            renderStudioMask(mask, currentDocument, undefined, 2048)
            settings.mask_base64 = mask.toDataURL('image/png').split(',')[1]
          }
        } else {
          settings.image_base64 = await imageAsBase64(imageUrl(context, inputPath))
        }
        const references = inputPlan.references
        settings.reference_images_base64 = await Promise.all(
          references.map(async (path) => {
            const saved =
              referenceState[path] ?? savedAIReferenceDocument(storage, suffix, inputPath, path)
            if (!saved) return imageAsBase64(imageUrl(context, path))
            const canvas = document.createElement('canvas')
            const missing = await renderStudioDocument(
              canvas,
              saved,
              context.assetInfo,
              false,
              { kind: 'all' },
              2048
            )
            if (missing.length) throw new Error(`无法读取参考图素材：${missing.join('、')}`)
            return canvas.toDataURL('image/png').split(',')[1]
          })
        )
      }
      const revision =
        purpose === 'image_edit' && currentDocument
          ? studioDocumentRevision(currentDocument)
          : sha256Hex(JSON.stringify({ purpose, mode: choice.mode, settings }))
      const submission = {
        workspace_id: context.workspaceId,
        name: (outputName.trim() || context.draft.name).slice(0, 120),
        mode: choice.mode,
        purpose,
        request: settings,
        document_id: context.draft.id,
        document_revision: revision
      }
      const pendingKey = `omnigallery:pending-ai-task:${context.workspaceId}:${context.draft.id}`
      const fingerprint = sha256Hex(JSON.stringify(submission))
      let pending: { id: string; fingerprint: string } | null = null
      try {
        pending = JSON.parse(sessionStorage.getItem(pendingKey) || 'null')
      } catch {
        /* Ignore an obsolete draft marker. */
      }
      const submissionId = pending?.fingerprint === fingerprint ? pending.id : crypto.randomUUID()
      sessionStorage.setItem(pendingKey, JSON.stringify({ id: submissionId, fingerprint }))
      await apiFetch<Task>('/image-ai/tasks', {
        method: 'POST',
        body: JSON.stringify({ ...submission, submission_id: submissionId })
      })
      sessionStorage.removeItem(pendingKey)
      setNotesOpen(false)
      setTasksOpen(true)
      setStatus(
        [
          '任务已提交，可在任务列表查看进度和结果',
          ...(purpose === 'image_edit' ? inputPlan.notices : [])
        ].join(' · ')
      )
      await refreshTasks()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败')
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    function dismissPanel(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.key !== 'Escape' ||
        !(notesOpen || tasksOpen)
      )
        return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('[role="dialog"],[role="menu"]')) return
      event.preventDefault()
      if (notesOpen) void saveNote()
      setNotesOpen(false)
      setTasksOpen(false)
    }
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('[role="dialog"],[role="menu"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveEdit()
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      }
    }
    window.addEventListener('keydown', dismissPanel, true)
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('keydown', dismissPanel, true)
      window.removeEventListener('keydown', keydown)
    }
  })

  return (
    <div className="react-editor-panel react-ai-studio">
      <div className="react-editor-toolbar">
        {backAction}
        <Text className="react-image-doc-title" fw={700} size="sm" title={context.draft.name}>
          {context.draft.name}
        </Text>
        <Button
          size="xs"
          onClick={() => void saveEdit()}
          disabled={context.readonly || busy}
          leftSection={<IconDeviceFloppy size={14} />}
        >
          保存编辑
        </Button>

        {purpose === 'image_edit' && (
          <Button
            size="xs"
            onClick={() => void exportEditedImage()}
            disabled={!inputPath || context.readonly || busy}
            leftSection={<IconDownload size={14} />}
          >
            导出产物
          </Button>
        )}
        <div className="react-ai-history-actions" ref={setHistoryHost} />
        {helpAction}
        <Tooltip label={saveStatus || '编辑文档已保存到本机'}>
          <span
            className={`react-image-save-state ${saveStatus === '未保存' ? 'is-dirty' : saveStatus === '保存失败' ? 'is-error' : ''}`}
            aria-label={saveStatus || '编辑文档已保存到本机'}
          />
        </Tooltip>
      </div>
      {status && (
        <div className="react-ai-command-status" role="status" aria-live="polite">
          <Text c="teal" size="xs" title={status}>
            {status}
          </Text>
        </div>
      )}
      {notesOpen && (
        <div className="react-ai-notes-panel">
          <Group justify="space-between" mb="xs">
            <Text fw={700} size="sm">
              制作笔记
            </Text>
            <ActionIcon
              aria-label="关闭制作笔记"
              variant="subtle"
              onClick={() => {
                void saveNote()
                setNotesOpen(false)
              }}
            >
              <IconX size={17} />
            </ActionIcon>
          </Group>
          <Textarea
            aria-label="制作笔记内容"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            minRows={8}
            autosize
            maxLength={10000}
            disabled={context.readonly}
          />
          <Button
            size="xs"
            mt="sm"
            onClick={() => void saveNote()}
            disabled={context.readonly || note === noteSaved.current}
          >
            保存笔记
          </Button>
        </div>
      )}
      {tasksOpen && (
        <AITaskList
          tasks={relevantTasks}
          documentName={context.draft.name}
          readonly={context.readonly}
          taskAction={taskAction}
          onRefresh={refreshTasks}
          onClose={() => setTasksOpen(false)}
          onAction={actOnTask}
          onViewResult={(task, artifactId) => {
            if (purpose === 'image_generation' && task.purpose === 'image_generation') {
              setGenerationResultId(artifactId)
            } else {
              setPreviewPath(`workspace-artifact:${artifactId}`)
            }
            setTasksOpen(false)
          }}
        />
      )}
      <div className="react-ai-top-actions" role="group" aria-label="AI 创作与任务">
        <AICreationTabs active="ai-image" onChange={(next) => void switchCreationKind(next)} />
        <span className="react-ai-actions-divider" aria-hidden="true" />
        <Tooltip label="制作笔记">
          <ActionIcon
            size={30}
            aria-label="制作笔记"
            aria-expanded={notesOpen}
            variant={notesOpen ? 'light' : 'subtle'}
            onClick={() => {
              if (notesOpen) void saveNote()
              setTasksOpen(false)
              setNotesOpen((value) => !value)
            }}
          >
            <IconNotes size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="任务列表">
          <Indicator
            inline
            disabled={
              !relevantTasks.some((task) => task.state === 'queued' || task.state === 'running')
            }
            size={7}
            offset={3}
          >
            <ActionIcon
              size={30}
              aria-label="任务列表"
              aria-expanded={tasksOpen}
              aria-controls="ai-studio-task-list"
              variant={tasksOpen ? 'light' : 'subtle'}
              onClick={() => {
                if (notesOpen) void saveNote()
                setNotesOpen(false)
                setTasksOpen((value) => !value)
                if (!tasksOpen) void refreshTasks()
              }}
            >
              <IconListCheck size={18} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </div>
      {error && (
        <Alert color="red" mx="md" mt="sm" withCloseButton onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      <div className="react-editor-main">
        <div className={`react-editor-stage${purpose === 'image_edit' ? ' is-ai-edit' : ''}`}>
          {purpose === 'image_generation' ? (
            generationResultId ? (
              <div className="react-ai-generation-viewer">
                <div
                  className="react-ai-generation-canvas"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    generationDrag.current = {
                      x: event.clientX,
                      y: event.clientY,
                      offsetX: generationOffset.x,
                      offsetY: generationOffset.y
                    }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    const drag = generationDrag.current
                    if (!drag) return
                    setGenerationOffset({
                      x: drag.offsetX + event.clientX - drag.x,
                      y: drag.offsetY + event.clientY - drag.y
                    })
                  }}
                  onPointerUp={() => {
                    generationDrag.current = null
                  }}
                  onPointerCancel={() => {
                    generationDrag.current = null
                  }}
                  onWheel={(event) => {
                    event.preventDefault()
                    setGenerationZoom((value) =>
                      Math.max(0.25, Math.min(4, value + (event.deltaY < 0 ? 0.1 : -0.1)))
                    )
                  }}
                >
                  <img
                    src={apiUrl(
                      `/workspace_artifacts/${encodeURIComponent(generationResultId)}/file`
                    )}
                    alt="AI 生成结果"
                    draggable={false}
                    style={{
                      transform: `translate(${generationOffset.x}px, ${generationOffset.y}px) scale(${generationZoom})`
                    }}
                  />
                </div>
                <Group className="react-ai-generation-zoom" gap={4}>
                  <ActionIcon
                    variant="subtle"
                    aria-label="缩小画面"
                    onClick={() => setGenerationZoom((value) => Math.max(0.25, value - 0.1))}
                  >
                    −
                  </ActionIcon>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => {
                      setGenerationZoom(1)
                      setGenerationOffset({ x: 0, y: 0 })
                    }}
                  >
                    {Math.round(generationZoom * 100)}%
                  </Button>
                  <ActionIcon
                    variant="subtle"
                    aria-label="放大画面"
                    onClick={() => setGenerationZoom((value) => Math.min(4, value + 0.1))}
                  >
                    +
                  </ActionIcon>
                </Group>
              </div>
            ) : (
              <Stack align="center" maw={420} gap="xs">
                <IconSparkles size={44} color="var(--mantine-primary-color-filled)" />
                <Title order={2}>从描述开始创作</Title>
                <Text c="dimmed" ta="center" size="sm">
                  生成不需要参考图。输入创作描述并选择模型，产物会保存到当前工作区。
                </Text>
              </Stack>
            )
          ) : (
            <AIInputBoard
              key={inputPath || 'empty'}
              inputs={
                inputPath
                  ? [
                      {
                        path: inputPath,
                        label: '主图',
                        name: context.assetInfo[inputPath]?.name || '主图',
                        document: currentDocument,
                        error: restoredInput.error || previewError
                      },
                      ...referencePaths
                        .filter((path) => path !== inputPath)
                        .map((path, index) => ({
                          path,
                          label: `参考图 ${index + 1}`,
                          name:
                            context.assetInfo[path]?.name || path.split(/[\\/]/).pop() || '参考图',
                          document:
                            referenceState[path] ?? restoredReferences[path]?.document ?? null,
                          error: restoredReferences[path]?.error || referenceErrors[path]
                        }))
                    ]
                  : []
              }
              selectedPath={activeReference || inputPath}
              assetInfo={context.assetInfo}
              readonly={context.readonly}
              fixedMain={!!sourceInput}
              historyHost={historyHost}
              onSelect={(path) => setActiveReference(path === inputPath ? '' : path)}
              onChange={(path, doc) =>
                path === inputPath ? changeDocument(doc) : changeReferenceDocument(path, doc)
              }
              onChoose={chooseSlot}
              onRemove={removeReference}
            />
          )}
        </div>
        <aside className="react-editor-inspector" style={{ width: 362, flexBasis: 362 }}>
          <Stack className="react-ai-inspector-scroll" gap="md">
            <div className="react-ai-purpose-switch">
              <SegmentedControl
                size="xs"
                aria-label="AI 图片创作方式"
                value={purpose}
                onChange={(value) => void switchPurpose(value as 'image_edit' | 'image_generation')}
                disabled={context.readonly}
                data={[
                  { value: 'image_generation', label: '图片生成' },
                  { value: 'image_edit', label: '图片编辑' }
                ]}
              />
              <Badge variant="light" color="graphite">
                {purpose === 'image_generation' ? 'AI 生成' : 'AI 编辑'}
              </Badge>
            </div>
            <div>
              <Text fw={700} size="sm">
                {purpose === 'image_generation' ? '生成配置' : '编辑配置'}
              </Text>
              <Text size="xs" c="dimmed">
                {purpose === 'image_generation'
                  ? '从文字描述生成新图片'
                  : '编辑主图，参考图提供补充信息'}
              </Text>
              {context.draft.source && (
                <Group gap={6} mt="xs" wrap="nowrap">
                  <Badge variant="light" color="gray" size="sm">
                    来源
                  </Badge>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="gray"
                    onClick={() => {
                      const sourceId = context.draft.source?.documentId
                      if (sourceId) void openRelatedEditor('image', sourceId)
                    }}
                    title={context.draft.source.label}
                    style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {context.draft.source.label || '图片画布'}
                  </Button>
                </Group>
              )}
            </div>
            {purpose === 'image_edit' && inputPath && (
              <Button
                size="xs"
                variant="default"
                leftSection={<IconPhotoPlus size={15} />}
                disabled={context.readonly}
                onClick={() => chooseSlot('append')}
              >
                添加参考图
              </Button>
            )}
            <SegmentedControl
              fullWidth
              value={choice.mode}
              onChange={(value) => editChoice({ ...choice, mode: value as Mode })}
              data={[
                { value: 'router', label: '图像模型' },
                { value: 'workflow', label: '工作流' }
              ]}
              disabled={context.readonly}
            />
            {choice.mode === 'router' ? (
              <>
                <Select
                  label="模型"
                  data={[
                    ...models,
                    ...(!models.some((item) => item.id === choice.model)
                      ? [{ id: choice.model, label: `${choice.model} · 当前设置` }]
                      : [])
                  ].map((item) => ({ value: item.id, label: item.label }))}
                  value={choice.model}
                  onChange={(value) => editChoice({ ...choice, model: value || choice.model })}
                  searchable
                  disabled={context.readonly}
                />
                <Group grow>
                  <Select
                    label="输出比例"
                    data={[
                      { value: 'auto', label: '模型自动' },
                      ...routerAspectRatios(choice.model).map((ratio) => ({
                        value: ratio,
                        label: ratio
                      }))
                    ]}
                    value={choice.aspectRatio}
                    onChange={(value) => editChoice({ ...choice, aspectRatio: value || 'auto' })}
                    disabled={context.readonly}
                  />
                  <Select
                    label="分辨率"
                    data={routerImageSizes(choice.model)}
                    value={choice.imageSize}
                    onChange={(value) =>
                      editChoice({
                        ...choice,
                        imageSize: value || routerImageSizes(choice.model)[0]
                      })
                    }
                    disabled={context.readonly}
                  />
                </Group>
              </>
            ) : (
              <>
                <Select
                  label="工作流"
                  data={availableWorkflows.map((item) => ({ value: item.id, label: item.name }))}
                  value={choice.workflowId}
                  onChange={(value) => editChoice({ ...choice, workflowId: value || '' })}
                  placeholder="选择已配置工作流"
                  disabled={context.readonly}
                />
                {selectedWorkflow && (
                  <Text size="xs" c={selectedOutputs.length ? 'dimmed' : 'red'}>
                    {selectedOutputs.length
                      ? `图片结果：${selectedOutputs.length} 个映射`
                      : '当前工作流没有图片输出映射'}
                  </Text>
                )}
                {!!selectedWorkflow?.negative_prompt_node_id && (
                  <Textarea
                    label="反向提示词"
                    value={negative}
                    onChange={(event) => setNegative(event.currentTarget.value)}
                    autosize
                    minRows={2}
                    disabled={context.readonly}
                  />
                )}
                {!!selectedWorkflow?.parameters.length && (
                  <Stack
                    gap="sm"
                    p="sm"
                    style={{
                      border: '1px solid var(--mantine-color-default-border)',
                      borderRadius: 10
                    }}
                  >
                    <Text size="sm" fw={700}>
                      可调参数
                    </Text>
                    {selectedWorkflow.parameters.map((parameter) => (
                      <WorkflowParameterField
                        key={parameter.id}
                        parameter={parameter}
                        value={parameterDraft[parameter.id]}
                        readonly={context.readonly || busy}
                        onChange={(next) =>
                          setParameterDraft((current) => ({ ...current, [parameter.id]: next }))
                        }
                      />
                    ))}
                    {!parametersValid && (
                      <Text size="xs" c="red">
                        参数超出工作流允许范围
                      </Text>
                    )}
                  </Stack>
                )}
              </>
            )}
            {purpose === 'image_edit' && (
              <>
                {inputPlan.notices.map((notice) => (
                  <Text key={notice} size="xs" c="orange">
                    {notice}
                  </Text>
                ))}
                {!!maskLayers?.length && choice.mode === 'workflow' && workflowUsesMask && (
                  <Switch
                    label="提交遮罩"
                    checked={useMask}
                    onChange={(event) => setUseMask(event.currentTarget.checked)}
                    disabled={context.readonly}
                  />
                )}
              </>
            )}
            <Textarea
              label={purpose === 'image_generation' ? '画面描述' : '编辑要求'}
              description={
                purpose === 'image_generation'
                  ? '描述主题、构图、色彩、光线与风格'
                  : '说明希望在原图上改变什么'
              }
              value={prompt}
              onChange={(event) => setPrompt(event.currentTarget.value)}
              autosize
              minRows={6}
              maxRows={12}
              maxLength={8000}
              disabled={context.readonly}
            />
            {purpose === 'image_edit' && annotationPrompt && (
              <Button
                size="xs"
                variant="light"
                onClick={() =>
                  setPrompt((current) => mergeAnnotationPrompt(current, '', annotationPrompt))
                }
                disabled={context.readonly}
              >
                提取画布标注到编辑要求
              </Button>
            )}
            <TextInput
              label="任务与产物名称"
              value={outputName}
              onChange={(event) => setOutputName(event.currentTarget.value)}
              maxLength={120}
              disabled={context.readonly}
            />
            {!keyConfigured && (
              <Alert color="yellow" title="尚未配置 AI 设置">
                请先在设置中配置 Comfy 密钥。
              </Alert>
            )}
          </Stack>
          <footer className="react-ai-inspector-footer">
            <Button
              fullWidth
              leftSection={<IconBolt size={17} />}
              onClick={() => void submit()}
              loading={busy}
              disabled={
                !keyConfigured ||
                context.readonly ||
                (choice.mode === 'router' && !prompt.trim()) ||
                (choice.mode === 'workflow' &&
                  (!selectedWorkflow ||
                    !selectedOutputs.length ||
                    !parametersValid ||
                    (!!selectedWorkflow.prompt_node_id && !prompt.trim())))
              }
            >
              开始 AI {purpose === 'image_generation' ? '生成' : '加工'}
            </Button>
          </footer>
        </aside>
      </div>
      <MaterialBar
        items={imageAssets}
        assetInfo={context.assetInfo}
        activePath={
          purpose === 'image_generation'
            ? `workspace-artifact:${generationResultId}`
            : activeReference || inputPath
        }
        usedPaths={
          purpose === 'image_generation' ? [] : [inputPath, ...referencePaths].filter(Boolean)
        }
        roles={
          purpose === 'image_generation'
            ? {}
            : Object.fromEntries([
                ...(inputPath ? [[inputPath, '主图']] : []),
                ...referencePaths.map((path, index) => [path, `参考图 ${index + 1}`])
              ])
        }
        onSelect={(asset) => void selectMaterial(asset)}
        onPreview={(asset) => setPreviewPath(asset.path)}
        onAdd={() => setPickerOpen(true)}
        readonly={context.readonly}
        clickMode={
          purpose === 'image_generation'
            ? 'view'
            : inputPath && materialMode === 'switch'
              ? 'add'
              : materialMode
        }
        selectAction={inputPath ? 'add' : 'switch'}
        onClickModeChange={purpose === 'image_generation' ? undefined : setMaterialMode}
        actions={(asset) =>
          purpose === 'image_generation'
            ? [{ key: 'preview', label: '预览文件' }]
            : [
                {
                  key: 'main',
                  label: asset.path === inputPath ? '当前主图' : '设为主图',
                  disabled: context.readonly || !!sourceInput || asset.path === inputPath
                },
                referencePaths.includes(asset.path)
                  ? { key: 'remove-reference', label: '移除参考图', disabled: context.readonly }
                  : {
                      key: 'reference',
                      label: '添加为参考图',
                      disabled: context.readonly || !inputPath || asset.path === inputPath
                    }
              ]
        }
        onAction={materialAction}
        className="react-ai-material-bar"
      />
      <Modal
        opened={slotTarget !== null && !pickerOpen}
        onClose={() => setSlotTarget(null)}
        title={
          slotTarget === 'main' ? '选择主图' : slotTarget === 'append' ? '添加参考图' : '替换参考图'
        }
        size="lg"
        centered
      >
        <Stack gap="sm">
          <Group wrap="nowrap">
            <TextInput
              placeholder="搜索图片"
              aria-label="搜索输入图片"
              value={slotSearch}
              onChange={(event) => setSlotSearch(event.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button variant="default" onClick={() => setPickerOpen(true)}>
              从媒体库添加
            </Button>
          </Group>
          <div className="react-ai-input-picker">
            {(slotTarget === 'main' ? inputChoices : referenceChoices)
              .filter(
                (item) =>
                  (slotTarget === 'main' ||
                    (item.value !== inputPath && !referencePaths.includes(item.value))) &&
                  item.label.toLowerCase().includes(slotSearch.toLowerCase())
              )
              .map((item) => (
                <button
                  type="button"
                  key={item.value}
                  onClick={() => void putInSlot(item.value)}
                  title={item.label}
                >
                  <img src={imageUrl(context, item.value)} alt="" loading="lazy" />
                  <span>{item.label}</span>
                </button>
              ))}
          </div>
        </Stack>
      </Modal>
      <WorkbenchMediaPicker
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        alreadyAdded={imageAssets.map((asset) => asset.path)}
        onConfirm={addLibraryAssets}
      />
      <MediaPreview
        files={previewFiles}
        index={previewPath ? previewFiles.findIndex((file) => file.fullpath === previewPath) : null}
        onClose={() => setPreviewPath('')}
        onIndexChange={(index) => setPreviewPath(previewFiles[index]?.fullpath || '')}
        readonly={context.readonly}
        footerActions={(file) =>
          purpose === 'image_generation' ? (
            <Group gap="xs">
              <Button
                size="sm"
                variant="light"
                disabled={context.readonly || borrowLoading || !borrowedPrompt}
                onClick={() => {
                  setPrompt(borrowedPrompt.slice(0, 8000))
                  setPreviewPath('')
                  setStatus('已使用素材的生成提示词')
                }}
              >
                使用提示词
              </Button>
              <Button
                size="sm"
                variant="subtle"
                disabled={context.readonly || borrowLoading || !borrowedPrompt}
                onClick={() => {
                  setPrompt((current) =>
                    (current.trim()
                      ? `${current.trim()}\n${borrowedPrompt}`
                      : borrowedPrompt
                    ).slice(0, 8000)
                  )
                  setPreviewPath('')
                  setStatus('已追加素材的生成提示词')
                }}
              >
                追加提示词
              </Button>
            </Group>
          ) : (
            <Button
              size="sm"
              variant="light"
              disabled={
                context.readonly ||
                !inputPath ||
                file.fullpath === inputPath ||
                referencePaths.includes(file.fullpath)
              }
              onClick={() => {
                setReferencePaths((current) => [...current, file.fullpath])
                setActiveReference(file.fullpath)
                setPreviewPath('')
              }}
            >
              {referencePaths.includes(file.fullpath) ? '已加入参考图' : '添加为参考图'}
            </Button>
          )
        }
      />
    </div>
  )
}
