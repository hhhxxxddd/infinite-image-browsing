import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  ColorInput,
  Divider,
  Group,
  Loader,
  Modal,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip
} from '@mantine/core'
import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsMove,
  IconDeviceFloppy,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFolderPlus,
  IconLock,
  IconLockOpen,
  IconNotes,
  IconPhotoPlus,
  IconPencil,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconResize,
  IconScissors,
  IconSparkles,
  IconSquare,
  IconTrash,
  IconTypography
} from '@tabler/icons-react'
import { apiFetch, apiRequest, apiUrl } from '../../shared/apiClient'
import {
  mutateWorkspaceState,
  readWorkspaceState,
  reloadWorkspaceState
} from '../../shared/workspaceState'
import { createWorkImageDraftRepository } from '../../../src/features/workspaces/model/workspaceWorks'
import { createWorkspaceWorksRepository } from '../../../src/features/workspaces/model/workspaceWorks'
import {
  createBranchDocument,
  installAIBranch,
  matchingAIBranches,
  prepareAIInput,
  type AIInputScope
} from '../../../src/features/workspaces/model/aiProductionBranch'
import { useEditorNavigation } from '../../design/navigation'
import {
  addWorkspaceAssets,
  readWorkspaceRecords,
  type WorkspaceAsset
} from '../../../src/features/workspaces/model/workspaceModel'
import WorkbenchMediaPicker from '../workbench/WorkbenchMediaPicker'
import { MediaPreview } from '../media/MediaPreview'
import MaterialBar, { type MaterialClickMode } from './MaterialBar'
import { resolveAIHandoffSelection } from './aiHandoffSelection'
import {
  applyStudioTemplate,
  createImageLayer,
  createStudioDocument,
  createStudioGroup,
  createTextLayer,
  cropStudioImage,
  dropStudioItem,
  resizeStudioCanvas,
  resizeStudioFrame,
  studioExportDocument,
  studioLayerLocked,
  studioLayerVisible,
  type StudioDocument,
  type StudioDragItem,
  type StudioLayer
} from '../../../src/features/image-editor/model/imageStudioModel'
import {
  renderStudioDocument,
  studioImageDimensions
} from '../../../src/features/image-editor/model/imageStudioRender'
import { exportStudioBlob } from '../../../src/features/image-editor/model/studioExport'
import { studioDocumentRevision } from '../../../src/features/image-editor/model/studioPublication'
import { blobToBase64 } from '../../../src/shared/lib/blobEncoding'
import { studioFonts } from '../../../src/features/image-editor/model/imageStudioFonts'
import { aspectRatioPresets } from '../../../src/shared/lib/aspectRatioPresets'
import { imageLayouts } from '../../../src/features/image-editor/model/imageCreationModel'
import type { EditorContext, MediaImageSession, RegisterEditorBeforeLeave } from './EditorHub'
import { EditorSaveQueue } from './editorSaveQueue'

const numeric = (value: string | number, fallback: number) =>
  typeof value === 'number' ? value : Number(value) || fallback

function layerThumbnailUrl(path: string, file?: EditorContext['assetInfo'][string]) {
  if (file?.edit_snapshot) {
    const snapshot = file.edit_snapshot
    return apiUrl(
      `/image_edit_asset?path=${encodeURIComponent(snapshot.owner)}&revision=${encodeURIComponent(snapshot.revision)}&asset=${encodeURIComponent(snapshot.asset)}`
    )
  }
  if (file?.workspace_artifact_id)
    return apiUrl(
      `/workspace_artifacts/${encodeURIComponent(file.workspace_artifact_id)}/thumbnail?size=96`
    )
  return apiUrl(
    `/image-thumbnail?path=${encodeURIComponent(path)}&size=96x96&t=${encodeURIComponent(file?.date || '0')}`
  )
}

export default function ImageStudio({
  context,
  mediaFile,
  onMediaSaved,
  onBeforeLeave
}: {
  context: EditorContext
  mediaFile?: MediaImageSession
  onMediaSaved?: (file: EditorContext['assetInfo'][string], overwrite: boolean) => void
  onBeforeLeave?: RegisterEditorBeforeLeave
}) {
  const navigation = useEditorNavigation()
  const [doc, setDoc] = useState<StudioDocument>(() => {
    if (mediaFile) return structuredClone(mediaFile.initialDocument)
    const repository = createWorkImageDraftRepository(
      context.workspaceId,
      context.work.id,
      readWorkspaceState(context.workspaceId)
    )
    return (
      repository.loadDocument(context.draft.id) ?? {
        ...createStudioDocument(context.draft.name),
        id: context.draft.id
      }
    )
  })
  const saverRef = useRef<EditorSaveQueue<StudioDocument> | null>(null)
  if (!mediaFile && !saverRef.current) {
    saverRef.current = new EditorSaveQueue(doc, async (snapshot) => {
      await mutateWorkspaceState(context.workspaceId, (storage) => {
        const repository = createWorkImageDraftRepository(
          context.workspaceId,
          context.work.id,
          storage
        )
        const index = repository.loadIndex() ?? { version: 2, activeId: snapshot.id, docs: [] }
        repository.save(snapshot, index)
      })
    })
  }
  const [selectedId, setSelectedId] = useState('')
  const [activeMediaFile, setActiveMediaFile] = useState(mediaFile?.file)
  const [activeMediaRecord, setActiveMediaRecord] = useState(mediaFile?.record)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [overwriteOpen, setOverwriteOpen] = useState(false)
  const [mediaSaveChoiceOpen, setMediaSaveChoiceOpen] = useState(false)
  const leaveResolver = useRef<((allowed: boolean) => void) | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [panel, setPanel] = useState<'properties' | 'notes' | 'none'>('properties')
  const [layerPaneHeight, setLayerPaneHeight] = useState(32)
  const inspectorRef = useRef<HTMLElement>(null)
  const [materialMode, setMaterialMode] = useState<MaterialClickMode>('add')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerMode, setPickerMode] = useState<'library' | 'add' | 'replace'>('library')
  const [previewPath, setPreviewPath] = useState('')
  const [addedAssets, setAddedAssets] = useState<WorkspaceAsset[]>([])
  const [viewZoom, setViewZoom] = useState(1)
  const [stageSize, setStageSize] = useState({ width: 850, height: 650 })
  const [solidBackground, setSolidBackground] = useState(
    doc.background === 'transparent' ? '#ffffff' : doc.background
  )
  const [compare, setCompare] = useState(false)
  const [tool, setTool] = useState<'select' | 'resize' | 'crop'>('select')
  const [cropStart, setCropStart] = useState<{ x: number; y: number }>()
  const [cropFrame, setCropFrame] = useState<{
    x: number
    y: number
    width: number
    height: number
  }>()
  const [groupOpen, setGroupOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [dragItem, setDragItem] = useState<StudioDragItem>()
  const [layerMenu, setLayerMenu] = useState<{
    kind: 'blank' | 'group' | 'layer'
    id?: string
    x: number
    y: number
  }>()
  const [deleteGroupId, setDeleteGroupId] = useState('')
  const [renameGroupId, setRenameGroupId] = useState('')
  const [renameGroupName, setRenameGroupName] = useState('')
  const clipboard = useRef<
    { layers: StudioLayer[]; group?: StudioDocument['groups'][number] } | undefined
  >(undefined)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState(context.draft.brief || '')
  const noteSaved = useRef(context.draft.brief || '')
  const [exportOpen, setExportOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState(doc.name)
  const [exportName, setExportName] = useState(`${context.draft.name}.png`)
  const [exportArea, setExportArea] = useState<'content' | 'canvas'>(
    mediaFile?.record?.export_area || 'content'
  )
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg'>('png')
  const [aiOpen, setAiOpen] = useState(false)
  const [aiScope, setAiScope] = useState('all')
  const aiScopeRef = useRef('all')
  const [aiArea, setAiArea] = useState<'content' | 'canvas'>('content')
  const [aiMaskChoice, setAiMaskChoice] = useState('all')
  const [aiRefs, setAiRefs] = useState<string[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [aiPreview, setAiPreview] = useState('')
  const [aiPreviewError, setAiPreviewError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inlineTextRef = useRef<HTMLTextAreaElement>(null)
  const [editingTextId, setEditingTextId] = useState('')
  const editingOriginalText = useRef('')
  const stageRef = useRef<HTMLDivElement>(null)
  const originalDoc = useRef(doc)
  const leaveHandlerRef = useRef<() => Promise<boolean>>(async () => true)
  const mediaDirty = !!mediaFile && JSON.stringify(doc) !== JSON.stringify(originalDoc.current)
  const undoStack = useRef<StudioDocument[]>([])
  const redoStack = useRef<StudioDocument[]>([])
  const [, setHistoryVersion] = useState(0)
  const renderSeq = useRef(0)
  const dragRef = useRef<
    | {
        id: string
        pointerX: number
        pointerY: number
        x: number
        y: number
        mode: 'move' | 'resize'
        keepRatio: boolean
        original: StudioDocument
        moved: boolean
      }
    | undefined
  >(undefined)
  const spaceHeld = useRef(false)
  const panRef = useRef<
    { pointerId: number; x: number; y: number; left: number; top: number } | undefined
  >(undefined)
  const selected = doc.layers.find((layer) => layer.id === selectedId)
  const backgroundMode =
    doc.background !== 'transparent'
      ? 'solid'
      : doc.backgroundView === 'checkerboard'
        ? 'checkerboard'
        : 'transparent'
  const editingTextLayer = doc.layers.find(
    (layer) => layer.id === editingTextId && layer.kind === 'text'
  )
  const selectedGroup = doc.groups.find((group) => group.id === selectedGroupId)
  const menuGroup =
    layerMenu?.kind === 'group' ? doc.groups.find((group) => group.id === layerMenu.id) : undefined
  const menuLayer =
    layerMenu?.kind === 'layer' ? doc.layers.find((layer) => layer.id === layerMenu.id) : undefined
  const layerRows = useMemo(() => {
    type Row =
      | { kind: 'group'; group: StudioDocument['groups'][number] }
      | { kind: 'layer'; layer: StudioLayer }
    const rows: Row[] = []
    const shown = new Set<string>()
    for (const group of doc.groups) {
      if (!doc.layers.some((layer) => layer.groupId === group.id)) {
        rows.push({ kind: 'group', group })
        shown.add(group.id)
      }
    }
    for (const layer of [...doc.layers].reverse()) {
      const group = layer.groupId ? doc.groups.find((item) => item.id === layer.groupId) : undefined
      if (group && !shown.has(group.id)) {
        rows.push({ kind: 'group', group })
        shown.add(group.id)
      }
      if (!group || !group.collapsed) rows.push({ kind: 'layer', layer })
    }
    return rows
  }, [doc.groups, doc.layers])
  const canReplaceImage =
    !!selected && selected.kind === 'image' && !studioLayerLocked(doc, selected)
  const imageAssets = useMemo(
    () =>
      addWorkspaceAssets([], [...context.assets, ...addedAssets]).filter(
        (asset) => asset.kind === 'image'
      ),
    [context.assets, addedAssets]
  )
  const previewFiles = imageAssets
    .map((asset) => context.assetInfo[asset.path])
    .filter((file): file is NonNullable<typeof file> => !!file)
  const scope: AIInputScope = aiScope.startsWith('layer:')
    ? { kind: 'layer', id: aiScope.slice(6) }
    : aiScope.startsWith('group:')
      ? { kind: 'group', id: aiScope.slice(6) }
      : { kind: 'all' }
  const aiScopeChoices = [
    { value: 'all', label: '整张画布' },
    ...doc.groups
      .filter((group) =>
        doc.layers.some(
          (layer) =>
            (layer.kind === 'image' || layer.kind === 'text') &&
            layer.groupId === group.id &&
            studioLayerVisible(doc, layer)
        )
      )
      .map((group) => ({ value: `group:${group.id}`, label: `分组 · ${group.name}` })),
    ...doc.layers
      .filter(
        (layer) =>
          (layer.kind === 'image' || layer.kind === 'text') && studioLayerVisible(doc, layer)
      )
      .map((layer) => ({ value: `layer:${layer.id}`, label: `图层 · ${layer.name}` }))
  ]
  const aiMasks = doc.layers.filter(
    (layer) =>
      layer.kind === 'mask' &&
      studioLayerVisible(doc, layer) &&
      (scope.kind !== 'group' || layer.groupId === scope.id)
  )
  const aiMaskIds =
    aiMaskChoice === 'none'
      ? []
      : aiMaskChoice === 'all'
        ? aiMasks.map((layer) => layer.id)
        : aiMasks.some((layer) => layer.id === aiMaskChoice)
          ? [aiMaskChoice]
          : []
  const aiLabel =
    aiScopeChoices.find((item) => item.value === aiScope)?.label.replace(/^分组 · |^图层 · /, '') ||
    '整张画布'
  function chooseAIScope(value: string) {
    aiScopeRef.current = value
    setAiScope(value)
  }
  const aiBranches = mediaFile
    ? []
    : matchingAIBranches(
        createWorkspaceWorksRepository(context.workspaceId, readWorkspaceState(context.workspaceId))
          .load()
          .works.find((item) => item.id === context.work.id)?.drafts ?? context.work.drafts,
        doc.id,
        scope,
        aiArea
      )

  useEffect(() => {
    if (!canReplaceImage && materialMode === 'replace') setMaterialMode('add')
  }, [canReplaceImage, materialMode])

  useEffect(() => {
    const saver = saverRef.current
    if (!saver || context.readonly) return
    saver.update(doc)
    if (!saver.dirty) return
    setDirty(true)
    const timer = window.setTimeout(() => {
      if (!dragRef.current) void flushChanges()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [doc, context.readonly])
  leaveHandlerRef.current = mediaFile
    ? async () => {
        if (tool === 'crop' || editingTextId) {
          setError('请先完成或取消当前调整')
          return false
        }
        if (!mediaDirty) return true
        return new Promise<boolean>((resolve) => {
          leaveResolver.current = resolve
          setDiscardOpen(true)
        })
      }
    : flushChanges
  useEffect(() => {
    onBeforeLeave?.(() => leaveHandlerRef.current())
    return () => onBeforeLeave?.(null)
  }, [onBeforeLeave])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (mediaFile ? !mediaDirty : !saverRef.current?.dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [mediaFile, mediaDirty])

  useEffect(() => {
    const seq = ++renderSeq.current
    const target = document.createElement('canvas')
    void renderStudioDocument(target, compare ? originalDoc.current : doc, context.assetInfo, true)
      .then(() => {
        if (seq !== renderSeq.current || !canvasRef.current) return
        const visible = canvasRef.current
        visible.width = target.width
        visible.height = target.height
        visible.getContext('2d')?.drawImage(target, 0, 0)
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : '画布预览失败'))
  }, [doc, compare, context.assetInfo])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const fitScale = Math.max(
    0.03,
    Math.min((stageSize.width - 100) / doc.width, (stageSize.height - 185) / doc.height, 1)
  )
  const displayWidth = Math.max(1, Math.round(doc.width * fitScale * viewZoom))
  const displayHeight = Math.max(1, Math.round(doc.height * fitScale * viewZoom))

  function update(next: StudioDocument) {
    undoStack.current.push(doc)
    if (undoStack.current.length > 60) undoStack.current.shift()
    redoStack.current = []
    setHistoryVersion((value) => value + 1)
    const staged = { ...next, updatedAt: new Date().toISOString() }
    saverRef.current?.update(staged)
    setDoc(staged)
    setDirty(true)
    setStatus('')
  }
  function undo() {
    const previous = undoStack.current.pop()
    if (!previous) return
    redoStack.current.push(doc)
    saverRef.current?.update(previous)
    setDoc(previous)
    setDirty(true)
    setHistoryVersion((value) => value + 1)
  }
  function redo() {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(doc)
    saverRef.current?.update(next)
    setDoc(next)
    setDirty(true)
    setHistoryVersion((value) => value + 1)
  }
  function updateLayer(id: string, change: Partial<StudioLayer>) {
    update({
      ...doc,
      layers: doc.layers.map((layer) =>
        layer.id === id ? ({ ...layer, ...change } as StudioLayer) : layer
      )
    })
  }
  function addImage(path: string) {
    addImages([path])
  }
  function addImages(paths: string[]) {
    const layers = paths.map((path) => {
      const file = context.assetInfo[path]
      const naturalWidth = file?.width || doc.width * 0.65
      const naturalHeight = file?.height || doc.height * 0.65
      const scale = Math.min(
        1,
        (doc.width * 0.75) / naturalWidth,
        (doc.height * 0.75) / naturalHeight
      )
      const width = Math.max(16, Math.round(naturalWidth * scale))
      const height = Math.max(16, Math.round(naturalHeight * scale))
      return createImageLayer(
        path,
        {
          x: Math.round((doc.width - width) / 2),
          y: Math.round((doc.height - height) / 2),
          width,
          height
        },
        file?.name || '图片'
      )
    })
    if (!layers.length) return
    update({ ...doc, layers: [...doc.layers, ...layers] })
    setSelectedId(layers.at(-1)?.id || '')
    setSelectedIds(layers.map((layer) => layer.id))
    setSelectedGroupId('')
    setPanel('properties')
  }
  function replaceImage(path: string) {
    if (!selected || selected.kind !== 'image' || studioLayerLocked(doc, selected)) return
    updateLayer(selected.id, {
      path,
      name:
        context.assetInfo[path]?.name ||
        imageAssets.find((item) => item.path === path)?.name ||
        selected.name,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      zoom: 1
    })
  }
  function addText() {
    const layer = createTextLayer({
      x: doc.width * 0.2,
      y: doc.height * 0.42,
      width: doc.width * 0.6,
      height: doc.height * 0.16
    })
    update({ ...doc, layers: [...doc.layers, layer] })
    setSelectedId(layer.id)
    setSelectedIds([layer.id])
    setSelectedGroupId('')
    setPanel('properties')
  }
  function moveLayer(delta: number) {
    const index = doc.layers.findIndex((layer) => layer.id === selectedId)
    const nextIndex = Math.min(doc.layers.length - 1, Math.max(0, index + delta))
    if (index < 0 || index === nextIndex) return
    const layers = [...doc.layers]
    const [layer] = layers.splice(index, 1)
    layers.splice(nextIndex, 0, layer)
    update({ ...doc, layers })
  }
  function addGroup() {
    const group = createStudioGroup(`分组 ${doc.groups.length + 1}`)
    update({
      ...doc,
      groups: [...doc.groups, group],
      layers: doc.layers.map((layer) =>
        layer.id === selectedId ? { ...layer, groupId: group.id } : layer
      )
    })
    setSelectedGroupId(group.id)
    setSelectedId('')
    setSelectedIds([])
    setPanel('properties')
  }
  function updateGroup(id: string, changes: Partial<StudioDocument['groups'][number]>) {
    update({
      ...doc,
      groups: doc.groups.map((group) => (group.id === id ? { ...group, ...changes } : group))
    })
  }

  function chooseLayer(id: string, toggle = false) {
    if (toggle) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id]
      setSelectedIds(next)
      setSelectedId(next.at(-1) || '')
    } else {
      setSelectedIds([id])
      setSelectedId(id)
    }
    setSelectedGroupId('')
    if (!toggle) setPanel('properties')
  }

  function copySelection() {
    const group = doc.groups.find((item) => item.id === selectedGroupId)
    const layers = group
      ? doc.layers.filter((item) => item.groupId === group.id)
      : doc.layers.filter((item) => selectedIds.includes(item.id))
    if (!group && !layers.length) return
    clipboard.current = {
      layers: structuredClone(layers),
      group: group ? structuredClone(group) : undefined
    }
    setStatus(group ? '已复制分组' : `已复制 ${layers.length} 个图层`)
  }

  function pasteSelection() {
    const copied = clipboard.current
    if (!copied || context.readonly) return
    const group = copied.group
      ? { ...copied.group, id: crypto.randomUUID(), name: `${copied.group.name} 副本` }
      : undefined
    const layers = copied.layers.map((item) => ({
      ...structuredClone(item),
      id: crypto.randomUUID(),
      name: `${item.name} 副本`,
      x: item.x + 24,
      y: item.y + 24,
      groupId: group ? group.id : item.groupId
    }))
    update({
      ...doc,
      groups: group ? [...doc.groups, group] : doc.groups,
      layers: [...doc.layers, ...layers]
    })
    setSelectedGroupId(group?.id || '')
    setSelectedIds(group ? [] : layers.map((item) => item.id))
    setSelectedId(group ? '' : layers.at(-1)?.id || '')
  }

  function removeSelection() {
    if (context.readonly) return
    const ids = new Set(
      selectedIds.filter((id) => {
        const layer = doc.layers.find((item) => item.id === id)
        return layer && !studioLayerLocked(doc, layer)
      })
    )
    if (!ids.size) return
    update({ ...doc, layers: doc.layers.filter((item) => !ids.has(item.id)) })
    setSelectedId('')
    setSelectedIds([])
  }

  function dissolveGroup(id: string) {
    update({
      ...doc,
      groups: doc.groups.filter((group) => group.id !== id),
      layers: doc.layers.map((layer) =>
        layer.groupId === id ? { ...layer, groupId: undefined } : layer
      )
    })
    setSelectedGroupId('')
  }

  function createSelectionGroup() {
    if (!selectedIds.length || !groupName.trim()) return
    const group = createStudioGroup(groupName.trim())
    const ids = new Set(selectedIds)
    update({
      ...doc,
      groups: [...doc.groups, group],
      layers: doc.layers.map((layer) =>
        ids.has(layer.id) ? { ...layer, groupId: group.id } : layer
      )
    })
    setSelectedId('')
    setSelectedIds([])
    setSelectedGroupId(group.id)
    setGroupOpen(false)
    setPanel('properties')
  }

  async function addLibraryAssets(incoming: WorkspaceAsset[]) {
    const images = incoming.filter((item) => item.kind === 'image')
    if (!images.length) throw new Error('请选择图片素材')
    if (mediaFile) {
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
      if (pickerMode === 'add') addImages(images.map((asset) => asset.path))
      if (pickerMode === 'replace') replaceImage(images[0].path)
      return
    }
    const settings = await apiFetch<{ app_fe_setting?: { workbench_projects?: unknown } }>(
      '/global_setting'
    )
    const records = readWorkspaceRecords(settings.app_fe_setting?.workbench_projects)
    const next = records.map((item) =>
      item.id === context.workspaceId
        ? {
            ...item,
            assets: addWorkspaceAssets(item.assets, images),
            updatedAt: new Date().toISOString()
          }
        : item
    )
    await apiFetch<void>('/app_fe_setting', {
      method: 'POST',
      body: JSON.stringify({
        name: 'workbench_projects',
        value: JSON.stringify({ version: 2, items: next })
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
    if (pickerMode === 'add') addImages(images.map((asset) => asset.path))
    if (pickerMode === 'replace') replaceImage(images[0].path)
    setStatus(
      pickerMode === 'replace'
        ? '已替换当前图片图层'
        : pickerMode === 'add'
          ? `已添加 ${images.length} 个图片图层`
          : `已加入 ${images.length} 张图片`
    )
  }

  async function downloadImage() {
    setBusy(true)
    setError('')
    try {
      if (!(await flushChanges())) throw new Error('制作文件未保存')
      const exportDoc = studioExportDocument(doc, exportArea === 'content')
      const blob = await exportStudioBlob(exportDoc, context.assetInfo, exportFormat)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${doc.name || '图片'}.${exportFormat === 'jpeg' ? 'jpg' : 'png'}`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载图片失败')
    } finally {
      setBusy(false)
    }
  }
  async function persist() {
    if (mediaFile) return doc
    const saver = saverRef.current
    if (!saver) throw new Error('图片制作文件保存器未就绪')
    const snapshot = await saver.flush()
    setDirty(saver.dirty)
    return snapshot
  }
  async function persistNote() {
    if (mediaFile) return
    if (note === noteSaved.current || context.readonly) return
    await mutateWorkspaceState(context.workspaceId, (storage) => {
      const repository = createWorkspaceWorksRepository(context.workspaceId, storage)
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
    })
    noteSaved.current = note
  }
  async function flushChanges(): Promise<boolean> {
    if (context.readonly) return true
    if (dragRef.current) return false
    try {
      await Promise.all([persist(), persistNote()])
      setError('')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '制作文件未能保存，请重试')
      return false
    }
  }
  async function save() {
    if (mediaFile) {
      setMediaSaveChoiceOpen(true)
      return
    }
    if (busy || context.readonly) return
    setBusy(true)
    setError('')
    try {
      await Promise.all([persist(), persistNote()])
      setStatus('制作文件已保存')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  async function saveMedia(overwrite: boolean) {
    const target = activeMediaFile
    if (!mediaFile || !target || busy || context.readonly) return
    if (tool === 'crop' || editingTextId || dragRef.current) {
      setError('请先完成或取消当前调整')
      return
    }
    setBusy(true)
    setError('')
    try {
      const exportDoc = studioExportDocument(doc, exportArea === 'content')
      const blob = await exportStudioBlob(exportDoc, context.assetInfo, 'png')
      const saved = await apiFetch<{
        file: EditorContext['assetInfo'][string]
        record: NonNullable<MediaImageSession['record']>
      }>('/edit_image', {
        method: 'POST',
        body: JSON.stringify({
          path: target.fullpath,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          width: exportDoc.width,
          height: exportDoc.height,
          rendered_base64: await blobToBase64(blob),
          overwrite,
          editor_document: structuredClone(doc),
          export_area: exportArea,
          parent_revision: activeMediaRecord?.id
        })
      })
      Object.assign(context.assetInfo, saved.record.asset_info, {
        [saved.file.fullpath]: saved.file
      })
      setActiveMediaFile(saved.file)
      setActiveMediaRecord(saved.record)
      setAddedAssets((current) =>
        addWorkspaceAssets(current, [
          { path: saved.file.fullpath, name: saved.file.name, kind: 'image' }
        ])
      )
      setDoc(saved.record.document)
      originalDoc.current = structuredClone(saved.record.document)
      undoStack.current = []
      redoStack.current = []
      setHistoryVersion((value) => value + 1)
      setDirty(false)
      setStatus(overwrite ? '已覆盖原图' : '已保存副本')
      onMediaSaved?.(saved.file, overwrite)
      window.dispatchEvent(
        new CustomEvent('omnigallery:media-updated', {
          detail: { path: saved.file.fullpath, overwrite }
        })
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存图片失败')
    } finally {
      setBusy(false)
      setOverwriteOpen(false)
    }
  }
  async function exportArtifact() {
    if (busy || context.readonly) return
    setBusy(true)
    setError('')
    try {
      await persist()
      const exportDoc = studioExportDocument(doc, exportArea === 'content')
      const blob = await exportStudioBlob(exportDoc, context.assetInfo, exportFormat)
      await apiFetch('/workspace_artifacts', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: context.workspaceId,
          name: (exportName.trim() || `${doc.name}.${exportFormat}`).replace(
            /\.(png|jpe?g)$/i,
            `.${exportFormat === 'jpeg' ? 'jpg' : 'png'}`
          ),
          format: exportFormat,
          source: 'image_studio',
          image_base64: await blobToBase64(blob),
          document_id: doc.id,
          document_revision: studioDocumentRevision(exportDoc)
        })
      })
      setExportOpen(false)
      setStatus('产物已导出到工作区')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }
  function pointFromEvent(
    event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>
  ) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) * doc.width) / rect.width,
      y: ((event.clientY - rect.top) * doc.height) / rect.height
    }
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (compare || editingTextId || spaceHeld.current || event.button === 1) return
    const point = pointFromEvent(event)
    if (tool === 'crop' && selected?.kind === 'image') {
      setCropStart(point)
      setCropFrame(undefined)
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }
    const layer = [...doc.layers]
      .reverse()
      .find(
        (item) =>
          studioLayerVisible(doc, item) &&
          point.x >= item.x &&
          point.x <= item.x + item.width &&
          point.y >= item.y &&
          point.y <= item.y + item.height
      )
    setSelectedId(layer?.id || '')
    setSelectedIds(layer ? [layer.id] : [])
    setSelectedGroupId('')
    if (layer && !context.readonly && !studioLayerLocked(doc, layer)) {
      dragRef.current = {
        id: layer.id,
        pointerX: point.x,
        pointerY: point.y,
        x: layer.x,
        y: layer.y,
        mode: tool === 'resize' ? 'resize' : 'move',
        keepRatio: event.shiftKey,
        original: doc,
        moved: false
      }
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (tool === 'crop' && cropStart && selected?.kind === 'image') {
      const point = pointFromEvent(event)
      const x = Math.max(selected.x, Math.min(cropStart.x, point.x))
      const y = Math.max(selected.y, Math.min(cropStart.y, point.y))
      const right = Math.min(selected.x + selected.width, Math.max(cropStart.x, point.x))
      const bottom = Math.min(selected.y + selected.height, Math.max(cropStart.y, point.y))
      setCropFrame({ x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) })
      return
    }
    const drag = dragRef.current
    if (!drag) return
    const point = pointFromEvent(event)
    drag.moved = true
    setDoc((current) => ({
      ...current,
      layers: current.layers.map((layer) => {
        if (layer.id !== drag.id) return layer
        if (drag.mode === 'resize') {
          return {
            ...layer,
            ...resizeStudioFrame(
              drag.original.layers.find((item) => item.id === drag.id) ?? layer,
              'se',
              point.x - drag.pointerX,
              point.y - drag.pointerY,
              drag.keepRatio
            )
          }
        }
        return {
          ...layer,
          x: Math.round(drag.x + point.x - drag.pointerX),
          y: Math.round(drag.y + point.y - drag.pointerY)
        }
      })
    }))
    setDirty(true)
  }
  function pointerUp() {
    if (cropStart) {
      setCropStart(undefined)
      return
    }
    const drag = dragRef.current
    if (drag?.moved) {
      undoStack.current.push(drag.original)
      if (undoStack.current.length > 60) undoStack.current.shift()
      redoStack.current = []
      setHistoryVersion((value) => value + 1)
    }
    dragRef.current = undefined
    if (drag?.moved) window.setTimeout(() => void flushChanges(), 100)
  }

  function applyCrop() {
    if (!cropFrame || selected?.kind !== 'image' || context.readonly) return
    const file = context.assetInfo[selected.path]
    const selection = {
      x: (cropFrame.x - selected.x) / selected.width,
      y: (cropFrame.y - selected.y) / selected.height,
      width: cropFrame.width / selected.width,
      height: cropFrame.height / selected.height
    }
    const cropped = cropStudioImage(selected, selection, file?.width || 0, file?.height || 0)
    update({
      ...doc,
      layers: doc.layers.map((item) => (item.id === selected.id ? cropped : item))
    })
    setCropFrame(undefined)
    setTool('select')
  }
  useEffect(() => {
    if (!aiOpen) return
    setAiMaskChoice('all')
    setAiRefs([])
    setAiArea('content')
  }, [aiOpen])
  useEffect(() => {
    if (!aiOpen) return
    let live = true
    setAiPreview('')
    setAiPreviewError('')
    try {
      const prepared = prepareAIInput(doc, scope, aiArea, aiMaskIds)
      const preview = document.createElement('canvas')
      void renderStudioDocument(preview, prepared, context.assetInfo, true)
        .then((errors) => {
          if (!live) return
          if (errors.length) throw new Error(`无法读取输入图片：${errors.join('、')}`)
          setAiPreview(preview.toDataURL('image/png'))
        })
        .catch((reason) => {
          if (live) setAiPreviewError(reason instanceof Error ? reason.message : '输入预览失败')
        })
    } catch (reason) {
      setAiPreviewError(reason instanceof Error ? reason.message : '输入预览失败')
    }
    return () => {
      live = false
    }
  }, [aiOpen, aiScope, aiArea, aiMaskChoice, doc, context.assetInfo])
  async function createAIBranch() {
    if (aiBusy || context.readonly) return
    setAiBusy(true)
    setAiPreviewError('')
    const branchId = crypto.randomUUID()
    const savedIds: string[] = []
    let installing = false
    try {
      const selectedSource = resolveAIHandoffSelection(doc, aiScopeRef.current)
      if (!(await flushChanges())) throw new Error('当前图片制作文件未能保存，尚未建立 AI 分支')
      const prepared = prepareAIInput(doc, selectedSource.scope, aiArea, aiMaskIds)
      async function snapshot(input: StudioDocument, name: string) {
        const canvas = document.createElement('canvas')
        const errors = await renderStudioDocument(canvas, input, context.assetInfo, false)
        if (errors.length) throw new Error(`无法读取输入图片：${errors.join('、')}`)
        const saved = await apiFetch<{ id: string }>('/workspace_inputs', {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: context.workspaceId,
            production_id: branchId,
            name: name.slice(0, 110),
            format: 'png',
            image_base64: canvas.toDataURL('image/png').split(',')[1]
          })
        })
        savedIds.push(saved.id)
        return `workspace-artifact:${saved.id}`
      }
      const inputPath = await snapshot(prepared, doc.name)
      const references: { path: string; originalPath: string; doc: StudioDocument }[] = []
      for (const originalPath of [...new Set(aiRefs)].slice(0, 13)) {
        const file = context.assetInfo[originalPath]
        const size = file && (await studioImageDimensions(file))
        if (!size) throw new Error('参考图不可用，请重新选择')
        const ratio = Math.min(1, 1280 / Math.max(size.width, size.height))
        const refDoc = createStudioDocument(file.name)
        refDoc.width = Math.max(1, Math.round(size.width * ratio))
        refDoc.height = Math.max(1, Math.round(size.height * ratio))
        refDoc.background = 'transparent'
        refDoc.layers = [
          createImageLayer(originalPath, { x: 0, y: 0, width: refDoc.width, height: refDoc.height })
        ]
        const path = await snapshot(refDoc, file.name)
        references.push({ path, originalPath, doc: createBranchDocument(refDoc, path, file.name) })
      }
      installing = true
      await mutateWorkspaceState(context.workspaceId, (storage) => {
        installAIBranch(
          storage,
          context.workspaceId,
          context.work.id,
          doc,
          selectedSource.scope,
          aiArea,
          selectedSource.label,
          branchId,
          inputPath,
          prepared,
          references
        )
      })
      setAiOpen(false)
      navigation.openEditor('ai-image', branchId)
    } catch (reason) {
      let installed = false
      if (installing) {
        try {
          await reloadWorkspaceState(context.workspaceId)
          installed = createWorkspaceWorksRepository(
            context.workspaceId,
            readWorkspaceState(context.workspaceId)
          )
            .load()
            .works.some((work) => work.drafts.some((draft) => draft.id === branchId))
        } catch {
          setAiPreviewError('无法确认 AI 分支是否已保存。输入快照已保留，请刷新工作区核对。')
          return
        }
      }
      if (installed) {
        setAiOpen(false)
        navigation.openEditor('ai-image', branchId)
      } else {
        await Promise.allSettled(
          savedIds.map((id) =>
            apiRequest(`/workspace_artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' })
          )
        )
        setAiPreviewError(reason instanceof Error ? reason.message : '创建 AI 制作文件失败')
      }
    } finally {
      setAiBusy(false)
    }
  }
  async function openExistingAIBranch(branchId: string) {
    if (aiBusy || busy) return
    setAiBusy(true)
    try {
      if (!(await flushChanges())) {
        setAiPreviewError('当前图片制作文件未能保存，请检查错误后重试')
        return
      }
      setAiOpen(false)
      navigation.openEditor('ai-image', branchId)
    } finally {
      setAiBusy(false)
    }
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target
      if (
        event.defaultPrevented ||
        event.isComposing ||
        (target instanceof HTMLElement && target.closest('[role="dialog"],[role="menu"]'))
      )
        return
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
        return
      }
      if (editing) return
      if (event.altKey) return
      if (event.code === 'Space') {
        spaceHeld.current = true
        event.preventDefault()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        if (selectedIds.length || selectedGroupId) {
          event.preventDefault()
          copySelection()
        }
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        if (clipboard.current) {
          event.preventDefault()
          pasteSelection()
        }
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g') {
        if (selectedGroupId) {
          event.preventDefault()
          dissolveGroup(selectedGroupId)
        } else if (selectedIds.length > 1) {
          event.preventDefault()
          setGroupName(`分组 ${doc.groups.length + 1}`)
          setGroupOpen(true)
        }
        return
      }
      if (event.key === 'Escape') {
        if (compare) setCompare(false)
        else if (tool !== 'select') {
          setTool('select')
          setCropFrame(undefined)
        } else if (panel !== 'none') setPanel('none')
        else {
          setSelectedIds([])
          setSelectedId('')
          setSelectedGroupId('')
        }
        return
      }
      const step = event.shiftKey ? 10 : 1
      const motions: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step]
      }
      if (motions[event.key] && !context.readonly) {
        const [dx, dy] = motions[event.key]
        const selectedLayer = doc.layers.find((layer) => layer.id === selectedId)
        if (selectedGroupId && doc.groups.find((group) => group.id === selectedGroupId)?.locked) {
          event.preventDefault()
          update({
            ...doc,
            layers: doc.layers.map((layer) =>
              layer.groupId === selectedGroupId
                ? { ...layer, x: layer.x + dx, y: layer.y + dy }
                : layer
            )
          })
        } else if (selectedLayer && !studioLayerLocked(doc, selectedLayer)) {
          event.preventDefault()
          updateLayer(selectedLayer.id, { x: selectedLayer.x + dx, y: selectedLayer.y + dy })
        }
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !context.readonly) {
        if (selectedIds.length) event.preventDefault()
        removeSelection()
      }
    }
    function keyup(event: KeyboardEvent) {
      if (event.code === 'Space') spaceHeld.current = false
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
    }
  })

  const layerMenuItems: {
    label: string
    run: () => void
    disabled?: boolean
    danger?: boolean
  }[] = []
  if (layerMenu?.kind === 'blank') {
    layerMenuItems.push(
      {
        label: '添加图片',
        run: () => {
          setPickerMode('add')
          setPickerOpen(true)
        },
        disabled: context.readonly
      },
      { label: '添加文字', run: addText, disabled: context.readonly }
    )
    if (clipboard.current)
      layerMenuItems.push({
        label: '粘贴图层 / 分组',
        run: pasteSelection,
        disabled: context.readonly
      })
  } else if (menuGroup) {
    layerMenuItems.push(
      {
        label: '重命名分组',
        run: () => {
          setRenameGroupId(menuGroup.id)
          setRenameGroupName(menuGroup.name)
        },
        disabled: context.readonly
      },
      {
        label: menuGroup.collapsed ? '展开分组' : '收起分组',
        run: () => updateGroup(menuGroup.id, { collapsed: !menuGroup.collapsed })
      },
      {
        label: menuGroup.visible ? '隐藏分组' : '显示分组',
        run: () => updateGroup(menuGroup.id, { visible: !menuGroup.visible }),
        disabled: context.readonly
      },
      {
        label: menuGroup.locked ? '解锁分组' : '锁定分组',
        run: () => updateGroup(menuGroup.id, { locked: !menuGroup.locked }),
        disabled: context.readonly
      },
      ...(!mediaFile
        ? [
            {
              label: '合成预览 / AI 加工',
              run: () => {
                chooseAIScope(`group:${menuGroup.id}`)
                setAiOpen(true)
              }
            }
          ]
        : []),
      {
        label: '复制分组',
        run: () => {
          clipboard.current = {
            group: structuredClone(menuGroup),
            layers: structuredClone(doc.layers.filter((layer) => layer.groupId === menuGroup.id))
          }
        }
      }
    )
    if (clipboard.current)
      layerMenuItems.push({
        label: '粘贴图层 / 分组',
        run: pasteSelection,
        disabled: context.readonly
      })
    layerMenuItems.push(
      {
        label: '解散分组，保留图层',
        run: () => dissolveGroup(menuGroup.id),
        disabled: context.readonly
      },
      {
        label: '删除分组及图层',
        run: () => setDeleteGroupId(menuGroup.id),
        disabled: context.readonly,
        danger: true
      }
    )
  } else if (menuLayer) {
    const locked = studioLayerLocked(doc, menuLayer)
    if (menuLayer.kind === 'text')
      layerMenuItems.push({
        label: '编辑文字',
        run: () => setEditingTextId(menuLayer.id),
        disabled: context.readonly || locked
      })
    if (menuLayer.kind === 'image')
      layerMenuItems.push(
        {
          label: '替换图片',
          run: () => {
            chooseLayer(menuLayer.id)
            setPickerMode('replace')
            setPickerOpen(true)
          },
          disabled: context.readonly || locked
        },
        {
          label: '铺满画布',
          run: () =>
            updateLayer(menuLayer.id, { x: 0, y: 0, width: doc.width, height: doc.height }),
          disabled: context.readonly || locked
        },
        ...(!mediaFile
          ? [
              {
                label: 'AI 加工',
                run: () => {
                  chooseAIScope(`layer:${menuLayer.id}`)
                  setAiOpen(true)
                }
              }
            ]
          : [])
      )
    layerMenuItems.push(
      {
        label: '复制图层',
        run: () => {
          const copy = {
            ...structuredClone(menuLayer),
            id: crypto.randomUUID(),
            name: `${menuLayer.name} 副本`,
            x: menuLayer.x + 24,
            y: menuLayer.y + 24
          }
          const index = doc.layers.findIndex((layer) => layer.id === menuLayer.id)
          update({
            ...doc,
            layers: [...doc.layers.slice(0, index + 1), copy, ...doc.layers.slice(index + 1)]
          })
          setSelectedId(copy.id)
          setSelectedIds([copy.id])
        },
        disabled: context.readonly
      },
      {
        label: '复制到剪贴板',
        run: () => {
          clipboard.current = { layers: [structuredClone(menuLayer)] }
        }
      }
    )
    if (clipboard.current)
      layerMenuItems.push({
        label: '粘贴图层 / 分组',
        run: pasteSelection,
        disabled: context.readonly
      })
    layerMenuItems.push(
      {
        label: '移到最上层',
        run: () =>
          update({
            ...doc,
            layers: [...doc.layers.filter((layer) => layer.id !== menuLayer.id), menuLayer]
          }),
        disabled: context.readonly || locked
      },
      {
        label: '移到最下层',
        run: () =>
          update({
            ...doc,
            layers: [menuLayer, ...doc.layers.filter((layer) => layer.id !== menuLayer.id)]
          }),
        disabled: context.readonly || locked
      },
      {
        label: menuLayer.visible ? '隐藏图层' : '显示图层',
        run: () => updateLayer(menuLayer.id, { visible: !menuLayer.visible }),
        disabled: context.readonly || locked
      },
      {
        label: menuLayer.locked ? '解锁图层' : '锁定图层',
        run: () => updateLayer(menuLayer.id, { locked: !menuLayer.locked }),
        disabled: context.readonly
      },
      {
        label: '删除图层',
        run: () => {
          update({ ...doc, layers: doc.layers.filter((layer) => layer.id !== menuLayer.id) })
          setSelectedId('')
          setSelectedIds([])
        },
        disabled: context.readonly || locked,
        danger: true
      }
    )
  }

  return (
    <div className="react-editor-panel react-image-studio">
      <div className="react-editor-toolbar">
        <Text fw={700} size="xs" className="react-image-doc-title" title={doc.name}>
          {mediaFile ? '调整图片' : '图片制作'} · {doc.name}
        </Text>
        <SegmentedControl
          size="xs"
          aria-label="保存范围"
          value={exportArea}
          onChange={(value) => setExportArea(value === 'canvas' ? 'canvas' : 'content')}
          data={[
            { value: 'content', label: '内容区' },
            { value: 'canvas', label: '整个画布' }
          ]}
        />
        {mediaFile ? (
          <>
            <Button
              size="xs"
              onClick={() => void saveMedia(false)}
              loading={busy}
              disabled={context.readonly}
            >
              保存副本
            </Button>
            <Button
              size="xs"
              color="red"
              variant="light"
              onClick={() => setOverwriteOpen(true)}
              disabled={busy || context.readonly}
            >
              覆盖原图
            </Button>
          </>
        ) : (
          <>
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={15} />}
              onClick={() => void save()}
              loading={busy}
              disabled={context.readonly}
            >
              保存编辑
            </Button>
            <Button
              size="xs"
              variant="filled"
              leftSection={<IconDownload size={15} />}
              onClick={() => setExportOpen(true)}
              disabled={context.readonly}
            >
              导出产物
            </Button>
            <Tooltip label="下载图片">
              <ActionIcon
                aria-label="下载图片"
                variant="subtle"
                onClick={() => void downloadImage()}
                disabled={busy}
              >
                <IconDownload size={17} />
              </ActionIcon>
            </Tooltip>
          </>
        )}
        <Tooltip
          label={
            status ||
            (mediaFile
              ? mediaDirty
                ? '修改未保存'
                : activeMediaRecord
                  ? '已保存编辑记录'
                  : '原图未修改'
              : dirty
                ? '修改未保存'
                : '编辑文档已保存到本机')
          }
        >
          <span
            className={`react-image-save-state ${(mediaFile ? mediaDirty : dirty) ? 'is-dirty' : ''}`}
            aria-label={
              status ||
              (mediaFile
                ? mediaDirty
                  ? '修改未保存'
                  : '已保存'
                : dirty
                  ? '修改未保存'
                  : '编辑文档已保存到本机')
            }
          />
        </Tooltip>
      </div>
      {!mediaFile && (
        <div className="react-image-top-actions" role="group" aria-label="图片制作操作">
          <Tooltip label="修改名称">
            <ActionIcon
              aria-label="修改名称"
              variant="subtle"
              onClick={() => {
                setRenameName(doc.name)
                setRenameOpen(true)
              }}
            >
              <IconPencil size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="合成 / AI 加工">
            <ActionIcon
              aria-label="合成 / AI 加工"
              variant="subtle"
              disabled={!doc.layers.length}
              onClick={() => {
                chooseAIScope(
                  selectedGroup
                    ? `group:${selectedGroup.id}`
                    : selected
                      ? `layer:${selected.id}`
                      : 'all'
                )
                setAiOpen(true)
              }}
            >
              <IconSparkles size={18} />
            </ActionIcon>
          </Tooltip>
        </div>
      )}
      {error && (
        <Alert color="red" mx="md" mt="sm" withCloseButton onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      <div className="react-editor-main">
        <nav className="react-image-tool-rail" aria-label="图片编辑工具">
          <Tooltip label="选择与移动">
            <ActionIcon
              aria-label="选择与移动"
              variant={tool === 'select' ? 'light' : 'subtle'}
              onClick={() => {
                setTool('select')
                setPanel('properties')
              }}
            >
              <IconArrowsMove size={18} stroke={1.8} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="缩放图层">
            <ActionIcon
              aria-label="缩放图层"
              variant={tool === 'resize' ? 'light' : 'subtle'}
              onClick={() => setTool(tool === 'resize' ? 'select' : 'resize')}
              disabled={selected?.kind !== 'image'}
            >
              <IconResize size={18} stroke={1.8} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="裁剪图层">
            <ActionIcon
              aria-label="裁剪图层"
              variant={tool === 'crop' ? 'light' : 'subtle'}
              onClick={() => {
                setTool(tool === 'crop' ? 'select' : 'crop')
                setCropFrame(undefined)
              }}
              disabled={selected?.kind !== 'image'}
            >
              <IconScissors size={18} stroke={1.8} />
            </ActionIcon>
          </Tooltip>
          <Divider />
          <Tooltip label="添加文字">
            <ActionIcon
              aria-label="添加文字"
              variant="subtle"
              onClick={addText}
              disabled={context.readonly}
            >
              <IconTypography size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="添加图片">
            <ActionIcon
              aria-label="添加图片"
              variant="subtle"
              onClick={() => {
                setPickerMode('add')
                setPickerOpen(true)
              }}
              disabled={context.readonly}
            >
              <IconPhotoPlus size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="图层">
            <ActionIcon
              aria-label="图层"
              variant={panel !== 'none' ? 'light' : 'subtle'}
              onClick={() => setPanel(panel === 'none' ? 'properties' : 'none')}
            >
              <IconFolderPlus size={18} />
            </ActionIcon>
          </Tooltip>
          <Divider />
          <Tooltip label="撤销 Ctrl+Z">
            <ActionIcon
              aria-label="撤销"
              variant="subtle"
              onClick={undo}
              disabled={!undoStack.current.length || context.readonly}
            >
              <IconArrowBackUp size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="重做 Ctrl+Y">
            <ActionIcon
              aria-label="重做"
              variant="subtle"
              onClick={redo}
              disabled={!redoStack.current.length || context.readonly}
            >
              <IconArrowForwardUp size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="调整前对比">
            <ActionIcon
              aria-label="调整前对比"
              variant={compare ? 'light' : 'subtle'}
              onClick={() => setCompare((value) => !value)}
            >
              <IconEye size={18} />
            </ActionIcon>
          </Tooltip>
          <Divider />
          {!mediaFile && (
            <Tooltip label="制作笔记">
              <ActionIcon
                aria-label="制作笔记"
                variant={panel === 'notes' ? 'light' : 'subtle'}
                onClick={() => setPanel('notes')}
              >
                <IconNotes size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </nav>
        <div
          className="react-editor-stage"
          ref={stageRef}
          onPointerDown={(event) => {
            if (event.button !== 1 && !spaceHeld.current) return
            panRef.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              left: event.currentTarget.scrollLeft,
              top: event.currentTarget.scrollTop
            }
            event.currentTarget.setPointerCapture(event.pointerId)
            event.preventDefault()
          }}
          onPointerMove={(event) => {
            const pan = panRef.current
            if (!pan || pan.pointerId !== event.pointerId) return
            event.currentTarget.scrollLeft = pan.left - (event.clientX - pan.x)
            event.currentTarget.scrollTop = pan.top - (event.clientY - pan.y)
          }}
          onPointerUp={(event) => {
            if (panRef.current?.pointerId === event.pointerId) panRef.current = undefined
          }}
          onPointerCancel={(event) => {
            if (panRef.current?.pointerId === event.pointerId) panRef.current = undefined
          }}
          onWheel={(event) => {
            event.preventDefault()
            setViewZoom((value) =>
              Math.max(
                0.3,
                Math.min(4, value * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.0015))
              )
            )
          }}
        >
          <div
            className="react-editor-canvas-wrap"
            data-checkerboard={
              doc.background === 'transparent' && doc.backgroundView === 'checkerboard'
            }
            style={{ width: displayWidth, height: displayHeight }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onPointerCancel={pointerUp}
              onDoubleClick={(event) => {
                const point = pointFromEvent(event)
                const layer = [...doc.layers]
                  .reverse()
                  .find(
                    (item) =>
                      studioLayerVisible(doc, item) &&
                      point.x >= item.x &&
                      point.x <= item.x + item.width &&
                      point.y >= item.y &&
                      point.y <= item.y + item.height
                  )
                if (!layer) return
                chooseLayer(layer.id)
                if (layer.kind === 'image' && !studioLayerLocked(doc, layer)) {
                  setTool('crop')
                  setCropFrame({ x: layer.x, y: layer.y, width: layer.width, height: layer.height })
                } else if (layer.kind === 'text' && !studioLayerLocked(doc, layer)) {
                  editingOriginalText.current = layer.text
                  setEditingTextId(layer.id)
                  window.requestAnimationFrame(() => inlineTextRef.current?.focus())
                }
              }}
              style={{ cursor: dragRef.current ? 'grabbing' : 'default' }}
              aria-label="图片画布"
            />
            {editingTextLayer?.kind === 'text' && (
              <textarea
                ref={inlineTextRef}
                className="react-image-inline-text"
                aria-label="画布文字编辑"
                value={editingTextLayer.text}
                onChange={(event) =>
                  updateLayer(editingTextLayer.id, { text: event.currentTarget.value })
                }
                onBlur={() => setEditingTextId('')}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    updateLayer(editingTextLayer.id, { text: editingOriginalText.current })
                    setEditingTextId('')
                  } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault()
                    event.stopPropagation()
                    setEditingTextId('')
                  }
                }}
                style={{
                  left: `${(editingTextLayer.x / doc.width) * 100}%`,
                  top: `${(editingTextLayer.y / doc.height) * 100}%`,
                  width: `${(editingTextLayer.width / doc.width) * 100}%`,
                  height: `${(editingTextLayer.height / doc.height) * 100}%`,
                  fontFamily: editingTextLayer.font,
                  fontSize: Math.max(12, editingTextLayer.fontSize * (displayWidth / doc.width)),
                  fontWeight: editingTextLayer.bold ? 700 : 400,
                  color: editingTextLayer.color,
                  textAlign: editingTextLayer.align,
                  transform: `rotate(${editingTextLayer.rotation}deg)`
                }}
              />
            )}
            {selected && !compare && (
              <div
                className="react-image-selection"
                style={{
                  left: `${(selected.x / doc.width) * 100}%`,
                  top: `${(selected.y / doc.height) * 100}%`,
                  width: `${(selected.width / doc.width) * 100}%`,
                  height: `${(selected.height / doc.height) * 100}%`,
                  transform: `rotate(${selected.rotation}deg)`
                }}
                aria-hidden="true"
              />
            )}
            {cropFrame && (
              <div
                className="react-image-crop-frame"
                style={{
                  left: `${(cropFrame.x / doc.width) * 100}%`,
                  top: `${(cropFrame.y / doc.height) * 100}%`,
                  width: `${(cropFrame.width / doc.width) * 100}%`,
                  height: `${(cropFrame.height / doc.height) * 100}%`
                }}
                aria-hidden="true"
              />
            )}
          </div>
          <div className="react-image-zoom">
            <Text size="xs">{Math.round(viewZoom * 100)}%</Text>
            <Slider
              min={30}
              max={400}
              value={viewZoom * 100}
              onChange={(value) => setViewZoom(value / 100)}
              w={130}
            />
            <Button size="compact-xs" variant="subtle" onClick={() => setViewZoom(1)}>
              适应
            </Button>
          </div>
          {tool === 'crop' && cropFrame && (
            <Group className="react-image-crop-actions">
              <Button size="xs" onClick={applyCrop}>
                应用裁剪
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setCropFrame(undefined)
                  setTool('select')
                }}
              >
                取消
              </Button>
            </Group>
          )}
        </div>
        <aside className="react-editor-inspector" data-open={panel !== 'none'} ref={inspectorRef}>
          <section
            className="react-image-layer-pane"
            style={{ height: `${layerPaneHeight}%` }}
            aria-label="图层管理"
          >
            <Group justify="space-between" mb={8}>
              <Text fw={700} size="sm">
                图层{' '}
                <Text span c="dimmed" size="xs">
                  {doc.layers.length}
                </Text>
              </Text>
              <Group gap={3}>
                <Tooltip label="添加图片">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="添加图片图层"
                    onClick={() => {
                      setPickerMode('add')
                      setPickerOpen(true)
                    }}
                    disabled={context.readonly}
                  >
                    <IconPhotoPlus size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="添加文字">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="添加文字图层"
                    onClick={addText}
                    disabled={context.readonly}
                  >
                    <IconTypography size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="图层上移">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="图层上移"
                    onClick={() => moveLayer(1)}
                    disabled={context.readonly || !selectedId}
                  >
                    <IconArrowUp size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="图层下移">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="图层下移"
                    onClick={() => moveLayer(-1)}
                    disabled={context.readonly || !selectedId}
                  >
                    <IconArrowDown size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="新建分组">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="新建分组"
                    onClick={addGroup}
                    disabled={context.readonly}
                  >
                    <IconFolderPlus size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            <button
              type="button"
              className="react-image-layer-row"
              data-selected={!selected && !selectedGroup}
              onClick={() => {
                setSelectedId('')
                setSelectedIds([])
                setSelectedGroupId('')
                setPanel('properties')
              }}
            >
              <IconSquare size={14} stroke={1.8} /> <span>画布</span>
              <small>
                {doc.width} × {doc.height}
              </small>
            </button>
            <div
              className="react-image-layer-list"
              onContextMenu={(event) => {
                event.preventDefault()
                setLayerMenu({ kind: 'blank', x: event.clientX, y: event.clientY })
              }}
            >
              {layerRows.map((row) =>
                row.kind === 'group' ? (
                  <div
                    key={row.group.id}
                    className="react-image-layer-row"
                    data-selected={selectedGroupId === row.group.id}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setLayerMenu({
                        kind: 'group',
                        id: row.group.id,
                        x: event.clientX,
                        y: event.clientY
                      })
                    }}
                    draggable={!context.readonly && !row.group.locked}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', row.group.id)
                      setDragItem({ kind: 'group', id: row.group.id })
                    }}
                    onDragEnd={() => setDragItem(undefined)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragItem) {
                        const bounds = event.currentTarget.getBoundingClientRect()
                        const fraction = (event.clientY - bounds.top) / bounds.height
                        update(
                          dropStudioItem(doc, dragItem, {
                            kind: 'group',
                            id: row.group.id,
                            position:
                              dragItem.kind === 'layer' && fraction >= 0.25 && fraction <= 0.75
                                ? 'inside'
                                : fraction < 0.5
                                  ? 'before'
                                  : 'after'
                          })
                        )
                      }
                      setDragItem(undefined)
                    }}
                  >
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      aria-label={row.group.collapsed ? '展开分组' : '收起分组'}
                      onClick={() => updateGroup(row.group.id, { collapsed: !row.group.collapsed })}
                    >
                      {row.group.collapsed ? '▸' : '▾'}
                    </ActionIcon>
                    <button
                      type="button"
                      className="react-image-layer-name"
                      onClick={() => {
                        setSelectedGroupId(row.group.id)
                        setSelectedId('')
                        setSelectedIds([])
                        setPanel('properties')
                      }}
                    >
                      ▱ {row.group.name}{' '}
                      <small>
                        {doc.layers.filter((layer) => layer.groupId === row.group.id).length}
                      </small>
                    </button>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      aria-label={row.group.visible ? '隐藏分组' : '显示分组'}
                      onClick={() => updateGroup(row.group.id, { visible: !row.group.visible })}
                    >
                      {row.group.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                    </ActionIcon>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      aria-label={row.group.locked ? '解锁分组' : '锁定分组'}
                      onClick={() => updateGroup(row.group.id, { locked: !row.group.locked })}
                    >
                      {row.group.locked ? <IconLock size={14} /> : <IconLockOpen size={14} />}
                    </ActionIcon>
                  </div>
                ) : (
                  <div
                    key={row.layer.id}
                    className="react-image-layer-row"
                    data-selected={selectedIds.includes(row.layer.id)}
                    data-group-child={!!row.layer.groupId}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      chooseLayer(row.layer.id)
                      setLayerMenu({
                        kind: 'layer',
                        id: row.layer.id,
                        x: event.clientX,
                        y: event.clientY
                      })
                    }}
                    draggable={!context.readonly && !studioLayerLocked(doc, row.layer)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', row.layer.id)
                      setDragItem({ kind: 'layer', id: row.layer.id })
                    }}
                    onDragEnd={() => setDragItem(undefined)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragItem) {
                        const bounds = event.currentTarget.getBoundingClientRect()
                        const position =
                          event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
                        update(
                          dropStudioItem(
                            doc,
                            dragItem,
                            row.layer.groupId &&
                              (event.clientX < bounds.left + 20 || dragItem.kind === 'group')
                              ? { kind: 'group', id: row.layer.groupId, position }
                              : { kind: 'layer', id: row.layer.id, position }
                          )
                        )
                      }
                      setDragItem(undefined)
                    }}
                  >
                    {row.layer.kind === 'image' && context.assetInfo[row.layer.path] ? (
                      <img
                        className="react-image-layer-thumb"
                        src={layerThumbnailUrl(row.layer.path, context.assetInfo[row.layer.path])}
                        alt=""
                        draggable={false}
                        onClick={() => chooseLayer(row.layer.id)}
                      />
                    ) : (
                      <span className="react-image-layer-symbol">
                        {row.layer.kind === 'image' ? '▧' : 'T'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="react-image-layer-name"
                      onClick={(event) =>
                        chooseLayer(row.layer.id, event.ctrlKey || event.metaKey || event.shiftKey)
                      }
                    >
                      {row.layer.name}
                    </button>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      aria-label={row.layer.visible ? '隐藏图层' : '显示图层'}
                      onClick={() => updateLayer(row.layer.id, { visible: !row.layer.visible })}
                    >
                      {row.layer.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                    </ActionIcon>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      aria-label={row.layer.locked ? '解锁图层' : '锁定图层'}
                      onClick={() => updateLayer(row.layer.id, { locked: !row.layer.locked })}
                    >
                      {row.layer.locked ? <IconLock size={14} /> : <IconLockOpen size={14} />}
                    </ActionIcon>
                  </div>
                )
              )}
            </div>
          </section>
          <div
            className="react-image-panel-resizer"
            role="separator"
            aria-label="调整图层区域高度"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                setLayerPaneHeight((value) =>
                  Math.max(20, Math.min(58, value + (event.key === 'ArrowDown' ? 3 : -3)))
                )
              }
            }}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId) || !inspectorRef.current)
                return
              const rect = inspectorRef.current.getBoundingClientRect()
              setLayerPaneHeight(
                Math.max(20, Math.min(58, ((event.clientY - rect.top) / rect.height) * 100))
              )
            }}
          />
          <div className="react-image-property-scroll">
            <Stack gap="md">
              <Group justify="space-between" wrap="nowrap">
                <Text fw={700}>{mediaFile ? '调整图片' : '图片制作'}</Text>
                <ActionIcon variant="subtle" aria-label="收起侧栏" onClick={() => setPanel('none')}>
                  ×
                </ActionIcon>
              </Group>
              <Group gap={4} grow>
                <Button
                  size="xs"
                  variant={panel === 'properties' ? 'light' : 'subtle'}
                  onClick={() => setPanel('properties')}
                >
                  属性
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  onClick={() => {
                    setSelectedId('')
                    setSelectedIds([])
                    setSelectedGroupId('')
                    setPanel('properties')
                  }}
                >
                  画布
                </Button>
                {!mediaFile && (
                  <Button
                    size="xs"
                    variant={panel === 'notes' ? 'light' : 'subtle'}
                    onClick={() => setPanel('notes')}
                  >
                    笔记
                  </Button>
                )}
              </Group>
              {panel === 'properties' && !selected && !selectedGroup && (
                <>
                  <div>
                    <Text fw={700} size="sm">
                      画布设置
                    </Text>
                    <div className="react-image-presets" aria-label="画布比例预设">
                      {aspectRatioPresets.map((preset) => {
                        const width =
                          preset.width < preset.height
                            ? 1080
                            : Math.round((1080 * preset.width) / preset.height)
                        const height =
                          preset.width < preset.height
                            ? Math.round((1080 * preset.height) / preset.width)
                            : 1080
                        return (
                          <Button
                            key={preset.label}
                            size="compact-xs"
                            variant={
                              doc.width * preset.height === doc.height * preset.width
                                ? 'light'
                                : 'default'
                            }
                            aria-pressed={doc.width * preset.height === doc.height * preset.width}
                            disabled={context.readonly}
                            onClick={() => update(resizeStudioCanvas(doc, width, height))}
                          >
                            {preset.label}
                          </Button>
                        )
                      })}
                    </div>
                    <Group grow mt="xs">
                      <NumberInput
                        size="xs"
                        label="宽"
                        value={doc.width}
                        onChange={(v) =>
                          update(resizeStudioCanvas(doc, numeric(v, doc.width), doc.height))
                        }
                        min={1}
                        max={16384}
                        disabled={context.readonly}
                      />
                      <NumberInput
                        size="xs"
                        label="高"
                        value={doc.height}
                        onChange={(v) =>
                          update(resizeStudioCanvas(doc, doc.width, numeric(v, doc.height)))
                        }
                        min={1}
                        max={16384}
                        disabled={context.readonly}
                      />
                    </Group>
                    <Text size="xs" fw={600} mt="md" mb={6}>
                      画布背景
                    </Text>
                    <SegmentedControl
                      size="xs"
                      fullWidth
                      aria-label="画布背景"
                      value={backgroundMode}
                      data={[
                        { value: 'checkerboard', label: '棋盘格' },
                        { value: 'transparent', label: '透明' },
                        { value: 'solid', label: '纯色' }
                      ]}
                      onChange={(value) =>
                        update({
                          ...doc,
                          background: value === 'solid' ? solidBackground : 'transparent',
                          backgroundView: value === 'checkerboard' ? 'checkerboard' : undefined
                        })
                      }
                      disabled={context.readonly}
                    />
                    {doc.background !== 'transparent' && (
                      <ColorInput
                        size="xs"
                        label="颜色"
                        mt="xs"
                        value={doc.background}
                        onChange={(value) => {
                          setSolidBackground(value)
                          update({ ...doc, background: value })
                        }}
                        disabled={context.readonly}
                      />
                    )}
                    <Text size="xs" fw={600} mt="md" mb={6}>
                      版式模板
                    </Text>
                    <div className="react-image-templates" aria-label="版式模板">
                      {imageLayouts.map((layout) => (
                        <Button
                          key={layout.key}
                          size="compact-xs"
                          variant="default"
                          disabled={context.readonly}
                          onClick={() => update(applyStudioTemplate(doc, layout.key))}
                        >
                          {layout.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Divider />
                </>
              )}
              {panel === 'properties' && selected && (
                <>
                  <Divider />
                  <Text fw={700} size="sm">
                    图层属性
                  </Text>
                  <TextInput
                    size="xs"
                    label="名称"
                    value={selected.name}
                    onChange={(event) =>
                      updateLayer(selected.id, { name: event.currentTarget.value })
                    }
                    disabled={context.readonly}
                  />
                  {selected.kind === 'image' && (
                    <Button
                      size="compact-xs"
                      variant="default"
                      disabled={context.readonly || !canReplaceImage}
                      onClick={() => {
                        setPickerMode('replace')
                        setPickerOpen(true)
                      }}
                    >
                      从媒体库替换图片
                    </Button>
                  )}
                  <Group grow>
                    <NumberInput
                      size="xs"
                      label="X"
                      value={Math.round(selected.x)}
                      onChange={(v) => updateLayer(selected.id, { x: numeric(v, selected.x) })}
                      disabled={context.readonly}
                    />
                    <NumberInput
                      size="xs"
                      label="Y"
                      value={Math.round(selected.y)}
                      onChange={(v) => updateLayer(selected.id, { y: numeric(v, selected.y) })}
                      disabled={context.readonly}
                    />
                  </Group>
                  <Group grow>
                    <NumberInput
                      size="xs"
                      label="宽"
                      value={Math.round(selected.width)}
                      min={1}
                      onChange={(v) =>
                        updateLayer(selected.id, { width: numeric(v, selected.width) })
                      }
                      disabled={context.readonly}
                    />
                    <NumberInput
                      size="xs"
                      label="高"
                      value={Math.round(selected.height)}
                      min={1}
                      onChange={(v) =>
                        updateLayer(selected.id, { height: numeric(v, selected.height) })
                      }
                      disabled={context.readonly}
                    />
                  </Group>
                  <NumberInput
                    size="xs"
                    label="旋转角度"
                    value={selected.rotation}
                    min={-360}
                    max={360}
                    onChange={(value) =>
                      updateLayer(selected.id, { rotation: numeric(value, selected.rotation) })
                    }
                    disabled={context.readonly}
                  />
                  <Select
                    size="xs"
                    label="分组"
                    value={selected.groupId || ''}
                    data={[
                      { value: '', label: '无分组' },
                      ...doc.groups.map((group) => ({ value: group.id, label: group.name }))
                    ]}
                    onChange={(value) => updateLayer(selected.id, { groupId: value || undefined })}
                    disabled={context.readonly}
                  />
                  <Text size="xs" c="dimmed">
                    不透明度 · {Math.round(selected.opacity * 100)}%
                  </Text>
                  <Slider
                    value={selected.opacity * 100}
                    onChange={(value) => updateLayer(selected.id, { opacity: value / 100 })}
                    disabled={context.readonly}
                  />
                  <Switch
                    size="xs"
                    label="锁定图层"
                    checked={selected.locked}
                    onChange={(event) =>
                      updateLayer(selected.id, { locked: event.currentTarget.checked })
                    }
                    disabled={context.readonly}
                  />
                  {selected.kind === 'image' && (
                    <>
                      <Select
                        size="xs"
                        label="图片适配"
                        value={selected.fit}
                        data={[
                          { value: 'cover', label: '填充画框' },
                          { value: 'contain', label: '完整显示' },
                          { value: 'stretch', label: '拉伸' }
                        ]}
                        onChange={(value) =>
                          updateLayer(selected.id, {
                            fit: (value || 'cover') as 'cover' | 'contain' | 'stretch'
                          })
                        }
                        disabled={context.readonly}
                      />
                      <Text size="xs" c="dimmed">
                        内容放大 · {selected.zoom.toFixed(1)}×
                      </Text>
                      <Slider
                        min={1}
                        max={8}
                        step={0.05}
                        value={selected.zoom}
                        onChange={(value) => updateLayer(selected.id, { zoom: value })}
                        disabled={context.readonly || selected.locked}
                      />
                      <Text size="xs" c="dimmed">
                        亮度 · {selected.brightness}%
                      </Text>
                      <Slider
                        min={0}
                        max={200}
                        value={selected.brightness}
                        onChange={(value) => updateLayer(selected.id, { brightness: value })}
                        disabled={context.readonly}
                      />
                      <Text size="xs" c="dimmed">
                        对比度 · {selected.contrast}%
                      </Text>
                      <Slider
                        min={0}
                        max={200}
                        value={selected.contrast}
                        onChange={(value) => updateLayer(selected.id, { contrast: value })}
                        disabled={context.readonly}
                      />
                      <Text size="xs" c="dimmed">
                        圆角 · {selected.radius}
                      </Text>
                      <Slider
                        min={0}
                        max={200}
                        value={selected.radius}
                        onChange={(value) => updateLayer(selected.id, { radius: value })}
                        disabled={context.readonly}
                      />
                    </>
                  )}
                  {selected.kind === 'text' && (
                    <>
                      <Textarea
                        size="xs"
                        label="文字"
                        value={selected.text}
                        onChange={(event) =>
                          updateLayer(selected.id, {
                            text: event.currentTarget.value
                          } as Partial<StudioLayer>)
                        }
                        autosize
                        minRows={3}
                        disabled={context.readonly}
                      />
                      <Group grow>
                        <Select
                          size="xs"
                          label="字体"
                          data={studioFonts.map((font) => ({
                            value: font.value,
                            label: font.label
                          }))}
                          value={selected.font}
                          onChange={(value) =>
                            updateLayer(selected.id, {
                              font: (value || 'system-ui') as typeof selected.font
                            })
                          }
                          disabled={context.readonly}
                        />
                        <NumberInput
                          size="xs"
                          label="字号"
                          min={1}
                          max={1000}
                          value={selected.fontSize}
                          onChange={(value) =>
                            updateLayer(selected.id, {
                              fontSize: numeric(value, selected.fontSize)
                            })
                          }
                          disabled={context.readonly}
                        />
                      </Group>
                      <Group grow>
                        <Select
                          size="xs"
                          label="对齐"
                          data={[
                            { value: 'left', label: '左' },
                            { value: 'center', label: '居中' },
                            { value: 'right', label: '右' }
                          ]}
                          value={selected.align}
                          onChange={(value) =>
                            updateLayer(selected.id, {
                              align: (value || 'center') as typeof selected.align
                            })
                          }
                          disabled={context.readonly}
                        />
                        <Switch
                          size="xs"
                          label="粗体"
                          checked={selected.bold}
                          onChange={(event) =>
                            updateLayer(selected.id, { bold: event.currentTarget.checked })
                          }
                          disabled={context.readonly}
                        />
                      </Group>
                      <ColorInput
                        size="xs"
                        label="文字颜色"
                        value={selected.color}
                        onChange={(value) => updateLayer(selected.id, { color: value })}
                        disabled={context.readonly}
                      />
                    </>
                  )}
                  <Button
                    size="xs"
                    color="red"
                    variant="subtle"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => {
                      update({
                        ...doc,
                        layers: doc.layers.filter((layer) => layer.id !== selected.id)
                      })
                      setSelectedId('')
                    }}
                    disabled={context.readonly}
                  >
                    删除图层
                  </Button>
                </>
              )}
              {panel === 'properties' && selectedGroup && (
                <>
                  <Divider />
                  <Text fw={700} size="sm">
                    分组属性
                  </Text>
                  <TextInput
                    size="xs"
                    label="名称"
                    value={selectedGroup.name}
                    onChange={(event) =>
                      updateGroup(selectedGroup.id, { name: event.currentTarget.value })
                    }
                    disabled={context.readonly}
                  />
                  <Switch
                    size="xs"
                    label="显示分组"
                    checked={selectedGroup.visible}
                    onChange={(event) =>
                      updateGroup(selectedGroup.id, { visible: event.currentTarget.checked })
                    }
                    disabled={context.readonly}
                  />
                  <Switch
                    size="xs"
                    label="锁定分组"
                    checked={selectedGroup.locked}
                    onChange={(event) =>
                      updateGroup(selectedGroup.id, { locked: event.currentTarget.checked })
                    }
                    disabled={context.readonly}
                  />
                  {!mediaFile && (
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => {
                        chooseAIScope(`group:${selectedGroup.id}`)
                        setAiOpen(true)
                      }}
                      disabled={context.readonly}
                    >
                      分组 AI 加工
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    onClick={() => {
                      update({
                        ...doc,
                        groups: doc.groups.filter((group) => group.id !== selectedGroup.id),
                        layers: doc.layers.map((layer) =>
                          layer.groupId === selectedGroup.id
                            ? { ...layer, groupId: undefined }
                            : layer
                        )
                      })
                      setSelectedGroupId('')
                    }}
                    disabled={context.readonly}
                  >
                    解散分组，保留图层
                  </Button>
                </>
              )}
              {panel === 'notes' && (
                <Textarea
                  label="制作笔记"
                  value={note}
                  onChange={(event) => setNote(event.currentTarget.value)}
                  onBlur={() => void flushChanges()}
                  autosize
                  minRows={8}
                  disabled={context.readonly}
                />
              )}
            </Stack>
          </div>
        </aside>
      </div>
      {layerMenu && (
        <div className="react-image-menu-mask" onPointerDown={() => setLayerMenu(undefined)}>
          <div
            className="react-image-context-menu"
            role="menu"
            style={{
              left: Math.max(8, Math.min(layerMenu.x, window.innerWidth - 220)),
              top: Math.max(
                8,
                Math.min(layerMenu.y, window.innerHeight - layerMenuItems.length * 34 - 16)
              )
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {layerMenuItems.map((item) => (
              <button
                type="button"
                role="menuitem"
                key={item.label}
                disabled={item.disabled}
                data-danger={item.danger || undefined}
                onClick={() => {
                  item.run()
                  setLayerMenu(undefined)
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <MaterialBar
        items={imageAssets}
        assetInfo={context.assetInfo}
        activePath={selected?.kind === 'image' ? selected.path : undefined}
        usedPaths={doc.layers.filter((layer) => layer.kind === 'image').map((layer) => layer.path)}
        onSelect={(asset) => addImage(asset.path)}
        onPreview={(asset) => setPreviewPath(asset.path)}
        onReplace={(asset) => replaceImage(asset.path)}
        onAdd={() => {
          setPickerMode('library')
          setPickerOpen(true)
        }}
        readonly={context.readonly}
        clickMode={materialMode}
        onClickModeChange={setMaterialMode}
        actions={() => [
          { key: 'add-layer', label: '新增图层', disabled: context.readonly },
          {
            key: 'replace-layer',
            label: '替换当前图层',
            disabled:
              context.readonly || selected?.kind !== 'image' || studioLayerLocked(doc, selected)
          }
        ]}
        onAction={(asset, key) => {
          if (key === 'add-layer') addImage(asset.path)
          if (key === 'replace-layer') replaceImage(asset.path)
        }}
        className="react-image-material-bar"
      />
      <WorkbenchMediaPicker
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        alreadyAdded={imageAssets.map((item) => item.path)}
        onConfirm={addLibraryAssets}
      />
      <MediaPreview
        files={previewFiles}
        index={previewPath ? previewFiles.findIndex((file) => file.fullpath === previewPath) : null}
        onClose={() => setPreviewPath('')}
        onIndexChange={(index) => setPreviewPath(previewFiles[index]?.fullpath || '')}
        readonly={context.readonly}
      />
      <Modal
        opened={discardOpen}
        onClose={() => {
          setDiscardOpen(false)
          leaveResolver.current?.(false)
          leaveResolver.current = null
        }}
        title="修改尚未保存"
        centered
      >
        <Text size="sm">离开后，本次图片调整不会保留。</Text>
        <Group justify="flex-end" mt="md">
          <Button
            variant="default"
            onClick={() => {
              setDiscardOpen(false)
              leaveResolver.current?.(false)
              leaveResolver.current = null
            }}
          >
            继续调整
          </Button>
          <Button
            color="red"
            onClick={() => {
              setDiscardOpen(false)
              leaveResolver.current?.(true)
              leaveResolver.current = null
            }}
          >
            放弃修改并返回
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={mediaSaveChoiceOpen}
        onClose={() => setMediaSaveChoiceOpen(false)}
        title="保存图片调整"
        centered
      >
        <Text size="sm">选择保存为新文件，或确认后替换当前原图。</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setMediaSaveChoiceOpen(false)}>
            取消
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              setMediaSaveChoiceOpen(false)
              void saveMedia(false)
            }}
          >
            保存副本
          </Button>
          <Button
            color="red"
            variant="light"
            onClick={() => {
              setMediaSaveChoiceOpen(false)
              setOverwriteOpen(true)
            }}
          >
            覆盖原图…
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={overwriteOpen}
        onClose={() => setOverwriteOpen(false)}
        title="覆盖原图？"
        centered
      >
        <Text size="sm">
          将替换原文件，保留标签和描述，同时保存编辑记录与素材快照。
          {activeMediaFile &&
            /\.jpe?g$/i.test(activeMediaFile.name) &&
            ' JPG 的透明区域将填充为白色。'}
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setOverwriteOpen(false)}>
            取消
          </Button>
          <Button color="red" loading={busy} onClick={() => void saveMedia(true)}>
            覆盖原图
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="重命名编辑文档"
        centered
      >
        <Stack>
          <TextInput
            label="名称"
            autoFocus
            maxLength={80}
            value={renameName}
            onChange={(event) => setRenameName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && renameName.trim()) {
                update({ ...doc, name: renameName.trim().slice(0, 80) })
                setRenameOpen(false)
              }
            }}
          />
          <Group justify="flex-end">
            <Button
              onClick={() => {
                if (!renameName.trim()) return
                update({ ...doc, name: renameName.trim().slice(0, 80) })
                setRenameOpen(false)
              }}
              disabled={!renameName.trim()}
            >
              保存
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={groupOpen} onClose={() => setGroupOpen(false)} title="将选中图层编组" centered>
        <Stack>
          <TextInput
            label="分组名称"
            value={groupName}
            onChange={(event) => setGroupName(event.currentTarget.value)}
          />
          <Text size="xs" c="dimmed">
            选中的图层会移入新分组；原分组和其他图层保留。
          </Text>
          <Button onClick={createSelectionGroup} disabled={!groupName.trim()}>
            创建分组
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={!!renameGroupId}
        onClose={() => setRenameGroupId('')}
        title="重命名分组"
        centered
      >
        <Stack>
          <TextInput
            label="分组名称"
            value={renameGroupName}
            onChange={(event) => setRenameGroupName(event.currentTarget.value)}
          />
          <Button
            disabled={!renameGroupName.trim()}
            onClick={() => {
              updateGroup(renameGroupId, { name: renameGroupName.trim() })
              setRenameGroupId('')
            }}
          >
            保存
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={!!deleteGroupId}
        onClose={() => setDeleteGroupId('')}
        title="删除分组及图层"
        centered
      >
        <Stack>
          <Text size="sm">
            该分组的 {doc.layers.filter((layer) => layer.groupId === deleteGroupId).length}{' '}
            个图层会从编辑文档移除。可撤销恢复，素材文件不会删除。
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteGroupId('')}>
              取消
            </Button>
            <Button
              color="red"
              onClick={() => {
                update({
                  ...doc,
                  groups: doc.groups.filter((group) => group.id !== deleteGroupId),
                  layers: doc.layers.filter((layer) => layer.groupId !== deleteGroupId)
                })
                setSelectedGroupId('')
                setDeleteGroupId('')
              }}
            >
              删除分组及图层
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={exportOpen} onClose={() => setExportOpen(false)} title="导出到工作区" centered>
        <Stack>
          <TextInput
            label="产物名称"
            value={exportName}
            onChange={(event) => setExportName(event.currentTarget.value)}
          />
          <Select
            label="导出范围"
            data={[
              { value: 'content', label: '可见内容' },
              { value: 'canvas', label: '整张画布' }
            ]}
            value={exportArea}
            onChange={(value) => setExportArea(value === 'canvas' ? 'canvas' : 'content')}
          />
          <Select
            label="格式"
            data={[
              { value: 'png', label: 'PNG（可透明）' },
              { value: 'jpeg', label: 'JPEG' }
            ]}
            value={exportFormat}
            onChange={(value) => setExportFormat(value === 'jpeg' ? 'jpeg' : 'png')}
          />
          <Button onClick={() => void exportArtifact()} loading={busy}>
            导出产物
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={aiOpen}
        onClose={() => {
          if (!aiBusy) setAiOpen(false)
        }}
        title="从画布建立 AI 制作文件"
        centered
        size="lg"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            可选整张画布、单个图层或分组。每次建立独立的 AI 制作文件，原画布继续保留。
          </Text>
          <Group grow align="end">
            <Select
              label="输入范围"
              value={aiScope}
              data={aiScopeChoices}
              onChange={(value) => chooseAIScope(value || 'all')}
            />
            <Select
              label="导出范围"
              value={aiArea}
              data={[
                { value: 'content', label: '可见内容' },
                { value: 'canvas', label: '整张画布尺寸' }
              ]}
              onChange={(value) => setAiArea(value === 'canvas' ? 'canvas' : 'content')}
            />
          </Group>
          <Select
            label="蒙版"
            value={aiMaskChoice}
            data={[
              { value: 'all', label: aiMasks.length ? '全部可见蒙版' : '没有可见蒙版' },
              { value: 'none', label: '不带入蒙版' },
              ...aiMasks.map((layer) => ({ value: layer.id, label: layer.name }))
            ]}
            onChange={(value) => setAiMaskChoice(value || 'all')}
            disabled={!aiMasks.length || aiBusy}
          />
          <MultiSelect
            label="额外参考图"
            description="可选，最多 13 张"
            data={imageAssets.map((item) => ({ value: item.path, label: item.name }))}
            value={aiRefs}
            onChange={setAiRefs}
            maxValues={13}
            searchable
            clearable
          />
          <Text size="xs" c="dimmed">
            将以“{aiLabel}”建立关联的 AI 制作文件。
          </Text>
          <div className="react-editor-ai-preview">
            {aiPreview ? (
              <img src={aiPreview} alt="AI 输入预览" />
            ) : aiPreviewError ? (
              <Alert color="red">{aiPreviewError}</Alert>
            ) : (
              <Loader size="sm" />
            )}
          </div>
          {!!aiBranches.length && (
            <Group gap="xs">
              <Text size="xs" c="dimmed">
                已有分支
              </Text>
              {aiBranches.map((branch) => (
                <Button
                  key={branch.id}
                  variant="light"
                  size="xs"
                  onClick={() => void openExistingAIBranch(branch.id)}
                  disabled={aiBusy || busy}
                >
                  {branch.name}
                </Button>
              ))}
            </Group>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setAiOpen(false)} disabled={aiBusy}>
              取消
            </Button>
            <Button onClick={() => void createAIBranch()} loading={aiBusy} disabled={!aiPreview}>
              建立 AI 制作文件
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}
