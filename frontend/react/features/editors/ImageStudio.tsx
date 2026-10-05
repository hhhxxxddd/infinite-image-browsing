import { useEditorToolAnchor } from './useEditorToolAnchor'
import ImageProcessingOverlay from './ImageProcessingOverlay'
import {
  processingChangeAllowed,
  processingProtectedIds
} from '../../../src/features/image-editor/model/imageStudioProcessing'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  ColorInput,
  Divider,
  Group,
  Modal,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
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
  IconPhotoPlus,
  IconPencil,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconSquare,
  IconTrash
} from '@tabler/icons-react'
import { apiFetch, apiRequest, apiUrl } from '../../shared/apiClient'
import {
  mutateWorkspaceState,
  readWorkspaceState,
  reloadWorkspaceState
} from '../../shared/workspaceState'
import { createPersistentImageDraftRepository } from '../../../src/features/workspaces/model/persistentImageDraftRepository'
import { createWorkspaceWorksRepository } from '../../../src/features/workspaces/model/workspaceWorks'
import {
  installAIBranch,
  prepareAdvancedAIInput,
  type AIWorkDestination
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
import { readStudioVersionDocument } from './studioVersionDocument'
import {
  createImageLayer,
  createStudioDocument,
  cropStudioImage,
  dropStudioItem,
  moveStudioGroup,
  moveStudioLayersToGroup,
  studioLayerRows,
  resizeStudioCanvas,
  resizeStudioFrame,
  studioExportDocument,
  studioLayerLocked,
  studioLayerVisible,
  type StudioDocument,
  type StudioDragItem,
  type StudioDropTarget,
  type StudioLayerRow,
  type StudioLayer
} from '../../../src/features/image-editor/model/imageStudioModel'
import {
  duplicateStudioSelection,
  studioSelectionIds,
  regroupStudioSelection,
  deleteStudioSelection,
  moveStudioSelection
} from '../../../src/features/image-editor/model/imageStudioSelection'
import {
  studioContextHits,
  studioContextTargets,
  studioContextSelection,
  studioContextLocks,
  duplicateStudioItems,
  orderStudioItems,
  type StudioMenuSelection,
  type StudioMenuTarget
} from '../../../src/features/image-editor/model/imageStudioContext'
import ImageContextMenu, { type ImageContextItem } from './ImageContextMenu'
import { renderStudioDocument } from '../../../src/features/image-editor/model/imageStudioRender'
import { exportStudioBlob } from '../../../src/features/image-editor/model/studioExport'
import { studioDocumentRevision } from '../../../src/features/image-editor/model/studioPublication'
import { blobToBase64 } from '../../../src/shared/lib/blobEncoding'
import ImageInlineTextEditor from './ImageInlineTextEditor'
import {
  createStudioTextPreset,
  type StudioTextPreset
} from '../../../src/features/image-editor/model/imageStudioText'
import ImageTextTools from './ImageTextTools'
import ImageTextTemplates, {
  SaveTextTemplateModal,
  TextTemplatePreview
} from './ImageTextTemplates'
import {
  captureTextTemplate,
  insertTextTemplate
} from '../../../src/features/image-editor/model/imageTextTemplates'
import { managedImageAssetFile } from '../../../src/shared/lib/managedImageAssets'
import { toImageThumbnailUrl } from '../../../src/shared/lib/mediaUrls'
import {
  changeStudioLayer,
  assignStudioFrame,
  removeStudioLayers,
  studioHitLayer,
  createStudioVector,
  addStudioBubble,
  studioVectorPath
} from '../../../src/features/image-editor/model/imageStudioVectors'
import ImageComicTools, { ImageVectorProperties } from './ImageComicTools'
import ImageTextProperties from './ImageTextProperties'
import ImageLayerGeometry from './ImageLayerGeometry'
import ImageGroupAssignment from './ImageGroupAssignment'
import EditorParameterSlider from './EditorParameterSlider'
import { aspectRatioPresets } from '../../../src/shared/lib/aspectRatioPresets'
import {
  applyStudioFrames,
  capturePageTemplate,
  applyPageTemplate
} from '../../../src/features/image-editor/model/imageStudioLayouts'
import type {
  CreativeTemplate,
  TextTemplate
} from '../../../src/features/image-editor/model/imageTextTemplates'
import type { EditorContext, MediaImageSession, RegisterEditorBeforeLeave } from './EditorHub'
import { EditorSaveQueue } from './editorSaveQueue'
import EditorActions from './EditorActions'
import EditorNotes from './EditorNotes'
import EditorVersions from './EditorVersionHistory'
import ImageSnapshotPreview from './ImageSnapshotPreview'
import EditorTaskList from './EditorTaskList'
import { useEditorNotes } from './useEditorNotes'
import { mergeSavedMediaAssets } from './mediaImageSession'
import ImageTransformTools, { type ImageTransformTool } from './ImageTransformTools'
import ImageAITools from './ImageAITools'
import ImageAdvancedAITools from './ImageAdvancedAITools'
import ImageCutoutTools from './ImageCutoutTools'
import ImageCutoutOverlay from './ImageCutoutOverlay'
import ImageEraseTools from './ImageEraseTools'
import ImageEraseOverlay from './ImageEraseOverlay'
import { useImageAITasks } from './useImageAITasks'
import ImageUpscaleTools from './ImageUpscaleTools'
import { sha256Hex } from '../../../src/shared/lib/sha256'
import ImageMergeModal from './ImageMergeModal'
import ImageCropFrame from './ImageCropFrame'
import { createImageCropPreview } from './imageCropPreviewStore'
import { createImageTransformPreview } from './imageTransformPreviewStore'
import {
  ImageGroupGeometry,
  ImageGroupSelection,
  ImagePreviewCanvas,
  ImageSelectionFrame
} from './ImageTransformPreview'
import {
  studioPointerRotation,
  studioCenteredCrop,
  studioMoveCrop,
  studioFramePoint,
  studioFrameWorldPoint
} from '../../../src/features/image-editor/model/imageStudioGeometry'

const numeric = (value: string | number, fallback: number) =>
  typeof value === 'number' ? value : Number(value) || fallback

function layerThumbnailUrl(path: string, file?: EditorContext['assetInfo'][string]) {
  const template = managedImageAssetFile(path)
  if (template) return toImageThumbnailUrl(template, '96x96')
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
  onBeforeLeave,
  backAction,
  helpAction
}: {
  context: EditorContext
  mediaFile?: MediaImageSession
  onMediaSaved?: (file: EditorContext['assetInfo'][string], overwrite: boolean) => void
  onBeforeLeave?: RegisterEditorBeforeLeave
  backAction?: ReactNode
  helpAction?: ReactNode
}) {
  const navigation = useEditorNavigation()
  const [repository] = useState(() =>
    mediaFile
      ? undefined
      : createPersistentImageDraftRepository(
          context.workspaceId,
          context.work.id,
          () => readWorkspaceState(context.workspaceId),
          (operation) => mutateWorkspaceState(context.workspaceId, operation)
        )
  )
  const [doc, setDoc] = useState<StudioDocument>(() => {
    if (mediaFile) return structuredClone(mediaFile.initialDocument)
    return (
      repository?.loadDocument(context.draft.id) ?? {
        ...createStudioDocument(context.draft.name),
        id: context.draft.id
      }
    )
  })
  const saverRef = useRef<EditorSaveQueue<StudioDocument> | null>(null)
  if (!mediaFile && !saverRef.current) {
    saverRef.current = new EditorSaveQueue(doc, async (snapshot) => {
      if (!repository) throw new Error('图片制作文件仓储未就绪')
      const index = repository.loadIndex() ?? { version: 2, activeId: snapshot.id, docs: [] }
      await repository.save(snapshot, index)
    })
  }
  const [selectedId, setSelectedId] = useState('')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [templateType, setTemplateType] = useState<CreativeTemplate['type']>('text')
  const [saveTemplateType, setSaveTemplateType] = useState<CreativeTemplate['type']>('text')
  const [pendingPageTemplate, setPendingPageTemplate] = useState<TextTemplate>()
  const [templateDraft, setTemplateDraft] = useState<StudioDocument>()
  useEffect(() => {
    for (const layer of doc.layers) {
      if (layer.kind !== 'image' || context.assetInfo[layer.path]) continue
      const file = managedImageAssetFile(layer.path)
      if (file) context.assetInfo[layer.path] = file
    }
  }, [doc, context.assetInfo])
  const [activeMediaFile, setActiveMediaFile] = useState(mediaFile?.file)
  const [activeMediaRecord, setActiveMediaRecord] = useState(mediaFile?.record)
  const [activeMediaRevision, setActiveMediaRevision] = useState(mediaFile?.revision)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [overwriteOpen, setOverwriteOpen] = useState(false)
  const [copySaveOpen, setCopySaveOpen] = useState(false)
  const [copyName, setCopyName] = useState('')
  const [copyError, setCopyError] = useState('')
  const [mediaSaveChoiceOpen, setMediaSaveChoiceOpen] = useState(false)
  const leaveResolver = useRef<((allowed: boolean) => void) | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([])
  const selectedGroupId =
    selectedGroupIds.length === 1 && !selectedIds.length ? selectedGroupIds[0] : ''
  function setSelectedGroupId(id: string) {
    setSelectedGroupIds(id ? [id] : [])
  }
  const selectionIds = studioSelectionIds(doc, selectedIds, selectedGroupIds)
  const multipleSelection = selectedIds.length + selectedGroupIds.length > 1

  const [notesOpen, setNotesOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [layerPaneHeight, setLayerPaneHeight] = useState(32)
  const inspectorRef = useRef<HTMLElement>(null)
  const toolRailRef = useRef<HTMLElement>(null)
  useEditorToolAnchor(toolRailRef)
  const [materialMode, setMaterialMode] = useState<MaterialClickMode>('view')
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
  const [tool, setTool] = useState<ImageTransformTool>('select')
  const [cropRatioKey, setCropRatioKey] = useState('free')
  const [cropRatio, setCropRatio] = useState(0)
  const [cropFrame, setCropFrame] = useState<{
    x: number
    y: number
    width: number
    height: number
  }>()
  const [groupOpen, setGroupOpen] = useState(false)
  const [groupName, setGroupName] = useState('')
  const dragItem = useRef<StudioDragItem>(undefined)
  const [dropHint, setDropHint] = useState<StudioDropTarget>()
  const [layerMenu, setLayerMenu] = useState<{
    selection: StudioMenuSelection
    targets: StudioMenuTarget[]
    x: number
    y: number
  }>()
  const [deleteSelection, setDeleteSelection] = useState<{
    layerIds: string[]
    groupIds: string[]
  }>()
  const [mergeTarget, setMergeTarget] = useState<{
    document: StudioDocument
    layerIds: string[]
    groupIds: string[]
  }>()
  const currentDocument = useRef(doc)
  currentDocument.current = doc
  function setDeleteGroupId(id: string) {
    setDeleteSelection(id ? { layerIds: [], groupIds: [id] } : undefined)
  }

  const clipboard = useRef<
    { document: StudioDocument; layerIds: string[]; groupId?: string } | undefined
  >(undefined)
  const [dirty, setDirty] = useState(false)
  const [transforming, setTransforming] = useState(false)
  const [transformPreview] = useState(createImageTransformPreview)
  const [cropPreview] = useState(createImageCropPreview)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const notes = useEditorNotes(context, !mediaFile)
  const [exportOpen, setExportOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameName, setRenameName] = useState(doc.name)
  const [exportName, setExportName] = useState(`${context.draft.name}.png`)
  const [exportArea, setExportArea] = useState<'content' | 'canvas'>(
    mediaFile?.record?.export_area || 'content'
  )
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg'>('png')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const inlineTextRef = useRef<HTMLTextAreaElement>(null)
  const [editingTextId, setEditingTextId] = useState('')
  const editingOriginalText = useRef('')
  const stageRef = useRef<HTMLDivElement>(null)
  const originalDoc = useRef(doc)
  const leaveHandlerRef = useRef<() => Promise<boolean>>(async () => true)
  const savedMediaDirty = useMemo(
    () => !!mediaFile && JSON.stringify(doc) !== JSON.stringify(originalDoc.current),
    [doc, mediaFile]
  )
  const mediaDirty = savedMediaDirty || transforming
  const undoStack = useRef<StudioDocument[]>([])
  const redoStack = useRef<StudioDocument[]>([])
  const [, setHistoryVersion] = useState(0)
  const pendingDragDoc = useRef<StudioDocument | undefined>(undefined)
  const dragFrame = useRef<number | undefined>(undefined)
  const dragRef = useRef<
    | {
        id: string
        groupId?: string
        pointerX: number
        pointerY: number
        selectionIds?: string[]
        mode: 'move' | 'resize' | 'rotate' | 'point'
        handle: string
        pointerId: number
        original: StudioDocument
        moved: boolean
        previewStarted: boolean
        originalDirty: boolean
      }
    | undefined
  >(undefined)
  const spaceHeld = useRef(false)
  const viewPan = useRef({ x: 0, y: 0 })
  const panRef = useRef<
    { pointerId: number; x: number; y: number; left: number; top: number } | undefined
  >(undefined)
  const selected = doc.layers.find((layer) => layer.id === selectedId)
  const selectedLocked = context.readonly || !!(selected && studioLayerLocked(doc, selected))
  const [aiToolTab, setAiToolTab] = useState('cutout')
  const cutoutLayer =
    selected?.kind === 'image' && !multipleSelection && !selectedGroupId ? selected : undefined
  const imageToolDocumentKey = sha256Hex(
    mediaFile ? `media:${mediaFile.file.fullpath}` : `workspace:${context.workspaceId}:${doc.id}`
  )
  const cutout = useImageAITasks({
    documentKey: imageToolDocumentKey,
    doc,
    layer: cutoutLayer,
    assetInfo: context.assetInfo,
    readonly: context.readonly,
    onUpdate: (next) => {
      update(next, true)
      setStatus('')
    },
    onError: setError,
    canApply: () => !busy && !dragRef.current && !editingTextId && tool !== 'crop'
  })
  const protectedProcessingIds = processingProtectedIds(doc, cutout.processingIds)
  const selectedCutoutPending = protectedProcessingIds.has(selectedId)
  const selectionProcessing = selectionIds.some((id) => protectedProcessingIds.has(id))
  const groupProcessing = (id: string) =>
    doc.layers.some((l) => l.groupId === id && protectedProcessingIds.has(l.id))
  const selectionIsProcessing = (selection: StudioMenuSelection) =>
    studioSelectionIds(doc, selection.layerIds, selection.groupIds).some((id) =>
      protectedProcessingIds.has(id)
    )
  function checkProcessing(next: StudioDocument) {
    if (processingChangeAllowed(doc, next, cutout.processingIds)) return true
    setError('AI 加工中的图层只能移动，请完成或取消后再操作')
    return false
  }
  const cutoutDisabled =
    !cutoutLayer ||
    selectedLocked ||
    compare ||
    !!(cutoutLayer && !studioLayerVisible(doc, cutoutLayer))
  const advancedSelection = useRef({ layerId: '', disabled: true })
  advancedSelection.current = {
    layerId: cutoutLayer?.id ?? '',
    disabled: cutoutDisabled || selectedCutoutPending
  }
  const cutoutFocused = tool === 'ai' && aiToolTab === 'cutout' && !cutoutDisabled && !cutout.busy
  const upscale = cutout.upscale
  const erase = cutout.erase
  const eraseFocused = tool === 'ai' && aiToolTab === 'erase' && !cutoutDisabled && !erase.busy
  const upscaleFocused =
    tool === 'ai' && aiToolTab === 'upscale' && !cutoutDisabled && !upscale.busy
  const cutoutSelecting = cutoutFocused && cutout.view === 'selection'
  const cutoutBefore =
    cutoutFocused && cutout.view === 'before'
      ? cutout.previous
      : upscaleFocused && upscale.view === 'before'
        ? upscale.previous
        : eraseFocused && erase.view !== 'after'
          ? erase.previous
          : undefined
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
  const menuSelection = layerMenu?.selection || { layerIds: [], groupIds: [] }
  const menuSingle = menuSelection.layerIds.length + menuSelection.groupIds.length === 1
  const menuGroup = menuSingle
    ? doc.groups.find((g) => g.id === menuSelection.groupIds[0])
    : undefined
  const menuLayer = menuSingle
    ? doc.layers.find((l) => l.id === menuSelection.layerIds[0])
    : undefined
  const layerRows = useMemo(() => studioLayerRows(doc), [doc])
  const groupLocked =
    !!selectedGroup &&
    (selectedGroup.locked ||
      doc.layers.some((layer) => layer.groupId === selectedGroup.id && layer.locked))
  const canReplaceImage =
    !!selected &&
    selected.kind === 'image' &&
    !studioLayerLocked(doc, selected) &&
    !selectedCutoutPending
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
  leaveHandlerRef.current = mergeTarget
    ? async () => false
    : mediaFile
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
      if (mediaFile ? !mediaDirty : !saverRef.current?.dirty && !transforming) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [mediaFile, mediaDirty, transforming])

  useLayoutEffect(() => {
    transformPreview.clear()
  }, [doc, transformPreview])

  useEffect(
    () => () => {
      if (dragFrame.current !== undefined) cancelAnimationFrame(dragFrame.current)
    },
    []
  )

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

  function update(next: StudioDocument, aiResult = false) {
    if (!aiResult && !checkProcessing(next)) return
    if (cutout.view === 'before') cutout.setView('after')
    if (upscale.view === 'before') upscale.setView('after')
    if (erase.view === 'before') erase.setView('after')
    if (dragRef.current) cancelPointer()
    undoStack.current.push(doc)
    if (undoStack.current.length > 60) undoStack.current.shift()
    redoStack.current = []
    setHistoryVersion((value) => value + 1)
    const staged = { ...next, updatedAt: new Date().toISOString() }
    currentDocument.current = staged
    saverRef.current?.update(staged)
    setDoc(staged)
    setDirty(true)
    setStatus('')
  }
  function undo() {
    if (tool === 'crop') {
      cancelTransformTool()
      return
    }
    if (dragRef.current) {
      cancelPointer()
      return
    }
    const previous = undoStack.current.at(-1)
    if (!previous || !checkProcessing(previous)) return
    undoStack.current.pop()
    // A release and immediate undo can share a render; retain the final gesture before clearing it.
    redoStack.current.push(transformPreview.document(doc))
    transformPreview.clear()
    saverRef.current?.update(previous)
    setDoc(previous)
    setDirty(true)
    setHistoryVersion((value) => value + 1)
  }
  function redo() {
    if (tool === 'crop') {
      cancelTransformTool()
      return
    }
    if (dragRef.current) {
      cancelPointer()
      return
    }
    const next = redoStack.current.at(-1)
    if (!next || !checkProcessing(next)) return
    redoStack.current.pop()
    undoStack.current.push(transformPreview.document(doc))
    transformPreview.clear()
    saverRef.current?.update(next)
    setDoc(next)
    setDirty(true)
    setHistoryVersion((value) => value + 1)
  }
  function updateLayer(id: string, change: Partial<StudioLayer>) {
    const current = transformPreview.document(doc)
    update(changeStudioLayer(current, id, change))
  }

  function addImage(path: string) {
    addImages([path])
  }
  function addImages(paths: string[], targetFrameId?: string) {
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
    const destination =
      targetFrameId === undefined
        ? selected
        : doc.layers.find((layer) => layer.id === targetFrameId)
    const frame =
      destination?.kind === 'frame' && !studioLayerLocked(doc, destination)
        ? destination
        : undefined
    if (frame)
      for (const layer of layers)
        Object.assign(layer, {
          x: frame.x,
          y: frame.y,
          width: frame.width,
          height: frame.height,
          rotation: frame.rotation,
          frameId: frame.id
        })
    update({ ...doc, layers: [...doc.layers, ...layers] })
    setSelectedId(layers.at(-1)?.id || '')
    setSelectedIds(layers.map((layer) => layer.id))
    setSelectedGroupId('')
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
      zoom: 1,
      correction: undefined
    })
  }
  function addText(preset: StudioTextPreset) {
    const frame = selected?.kind === 'frame' && !selectedLocked ? selected : undefined
    const layer = {
      ...createStudioTextPreset(
        frame ? { ...doc, width: frame.width, height: frame.height } : doc,
        preset
      ),
      frameId: frame?.id
    }
    if (frame) {
      const center = studioFrameWorldPoint(frame, {
        x: layer.x + layer.width / 2,
        y: layer.y + layer.height / 2
      })
      Object.assign(layer, {
        x: center.x - layer.width / 2,
        y: center.y - layer.height / 2,
        rotation: frame.rotation
      })
    }
    setEditingTextId('')
    setTool('select')
    update({ ...doc, layers: [...doc.layers, layer] })
    setSelectedId(layer.id)
    setSelectedIds([layer.id])
    setSelectedGroupId('')
  }
  function moveLayer(delta: number) {
    if (selectionProcessing) return
    if (selectedGroupId) {
      const rows = layerRows.filter((row) => row.kind === 'group' || !row.layer.groupId)
      const index = rows.findIndex(
        (row) => row.kind === 'group' && row.group.id === selectedGroupId
      )
      const target = rows[index - delta]
      if (!target) return
      update(
        dropStudioItem(
          doc,
          { kind: 'group', id: selectedGroupId },
          {
            kind: target.kind,
            id: target.kind === 'group' ? target.group.id : target.layer.id,
            position: delta > 0 ? 'before' : 'after'
          }
        )
      )
      return
    }
    const peers = doc.layers.filter(
      (layer) =>
        layer.frameId === selected?.frameId &&
        (!selected?.groupId || layer.groupId === selected.groupId)
    )
    const index = peers.findIndex((layer) => layer.id === selectedId)
    const target = peers[index + delta]
    if (index < 0 || !target) return
    update(
      dropStudioItem(
        doc,
        { kind: 'layer', id: selectedId },
        {
          kind: 'layer',
          id: target.id,
          position: delta > 0 ? 'before' : 'after'
        }
      )
    )
  }
  function addGroup(
    layerIds = selectedIds,
    name = `分组 ${doc.groups.length + 1}`,
    groupIds = selectedGroupIds
  ) {
    if (context.readonly || compare || selectionIsProcessing({ layerIds, groupIds })) return
    const current = transformPreview.document(doc)
    const result = regroupStudioSelection(current, layerIds, groupIds, name)
    if (result.document === current) return
    update(result.document)
    chooseGroup(result.groupId)
  }
  function assignGroup(layerIds: string[], groupId?: string) {
    if (context.readonly) return
    const current = transformPreview.document(doc)
    const next = moveStudioLayersToGroup(current, layerIds, groupId)
    if (next !== current) update(next)
    setLayerMenu(undefined)
  }
  function updateGroup(id: string, changes: Partial<StudioDocument['groups'][number]>) {
    update({
      ...doc,
      groups: doc.groups.map((group) => (group.id === id ? { ...group, ...changes } : group))
    })
  }

  function chooseLayer(id: string, toggle = false) {
    cancelTransformTool()
    let groups = toggle ? selectedGroupIds : []
    let ids = toggle ? selectedIds : []
    const layer = doc.layers.find((l) => l.id === id)
    // Toggling one member out of a selected group makes the remaining members explicit.
    if (toggle && layer?.groupId && groups.includes(layer.groupId)) {
      ids = [...ids, ...studioSelectionIds(doc, [], [layer.groupId])]
      groups = groups.filter((g) => g !== layer.groupId)
    }
    const next = toggle && ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
    setSelectedIds([...new Set(next)])
    setSelectedId(next.at(-1) || '')
    setSelectedGroupIds(groups)
  }

  function chooseGroup(id: string, toggle = false) {
    cancelTransformTool()
    const groups = toggle
      ? selectedGroupIds.includes(id)
        ? selectedGroupIds.filter((g) => g !== id)
        : [...selectedGroupIds, id]
      : [id]
    const members = studioSelectionIds(doc, [], [id])
    const ids = toggle ? selectedIds.filter((layerId) => !members.includes(layerId)) : []
    setSelectedGroupIds(groups)
    setSelectedIds(ids)
    setSelectedId(ids.at(-1) || '')
  }

  function clearSelection() {
    cancelTransformTool()
    setSelectedId('')
    setSelectedIds([])
    setSelectedGroupId('')
    setEditingTextId('')
  }

  function rowDropTarget(
    event: React.DragEvent<HTMLElement>,
    row: StudioLayerRow
  ): StudioDropTarget {
    const bounds = event.currentTarget.getBoundingClientRect()
    const fraction = (event.clientY - bounds.top) / bounds.height
    const position = fraction < 0.5 ? 'before' : 'after'
    if (row.kind === 'group')
      return {
        kind: 'group',
        id: row.group.id,
        position:
          dragItem.current?.kind === 'layer' && fraction >= 0.25 && fraction <= 0.75
            ? 'inside'
            : position
      }
    if (row.layer.kind === 'frame' && fraction >= 0.25 && fraction <= 0.75)
      return { kind: 'layer', id: row.layer.id, position: 'inside' }
    return row.layer.groupId &&
      (event.clientX < bounds.left + 20 || dragItem.current?.kind === 'group')
      ? { kind: 'group', id: row.layer.groupId, position }
      : { kind: 'layer', id: row.layer.id, position }
  }
  function showDrop(event: React.DragEvent<HTMLElement>, target: StudioDropTarget) {
    if (!dragItem.current || context.readonly) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropHint(target)
  }
  function finishDrop(event: React.DragEvent<HTMLElement>, target: StudioDropTarget) {
    event.preventDefault()
    event.stopPropagation()
    if (dragItem.current && !context.readonly) update(dropStudioItem(doc, dragItem.current, target))
    dragItem.current = undefined
    setDropHint(undefined)
  }
  function finishListDrag() {
    dragItem.current = undefined
    setDropHint(undefined)
  }

  function copySelection() {
    if (selectionProcessing) return
    if (!selectedGroupIds.length && !selectedIds.length) return
    clipboard.current = {
      document: structuredClone(doc),
      layerIds: [...selectionIds],
      groupId: selectedGroupId || undefined
    }
    setStatus(selectedGroupId ? '已复制分组' : `已复制 ${selectedIds.length} 个图层`)
  }
  function pasteSelection() {
    const copied = clipboard.current
    if (!copied || context.readonly) return
    const result = duplicateStudioSelection(copied.document, copied.layerIds, copied.groupId)
    const oldIds = new Set(copied.document.layers.map((layer) => layer.id))
    const oldGroups = new Set(copied.document.groups.map((group) => group.id))
    const newLayers = result.document.layers
      .filter((layer) => !oldIds.has(layer.id))
      .map((layer) => ({
        ...layer,
        frameId:
          layer.frameId &&
          (doc.layers.some((frame) => frame.id === layer.frameId) ||
            result.document.layers.some(
              (frame) => frame.id === layer.frameId && !oldIds.has(frame.id)
            ))
            ? layer.frameId
            : undefined,
        groupId:
          layer.groupId &&
          (doc.groups.some((g) => g.id === layer.groupId) || !oldGroups.has(layer.groupId))
            ? layer.groupId
            : undefined
      }))
    update({
      ...doc,
      groups: [
        ...doc.groups,
        ...result.document.groups.filter((group) => !oldGroups.has(group.id))
      ],
      layers: [...doc.layers, ...newLayers]
    })
    setSelectedGroupId(result.groupId || '')
    setSelectedIds(result.groupId ? [] : result.layerIds)
    setSelectedId(result.groupId ? '' : result.layerIds.at(-1) || '')
  }

  function duplicateSelection(selection: StudioMenuSelection) {
    if (context.readonly || selectionIsProcessing(selection)) return
    const current = transformPreview.document(doc)
    const copy = duplicateStudioItems(current, selection)
    if (copy.document === current) return
    cancelTransformTool()
    setEditingTextId('')
    update(copy.document)
    setSelectedGroupIds(copy.groupIds)
    setSelectedIds(copy.layerIds)
    setSelectedId(copy.layerIds.at(-1) || '')
  }

  function removeSelection(layerIds = selectedIds) {
    if (context.readonly || selectionIsProcessing({ layerIds, groupIds: [] })) return
    const ids = new Set(
      layerIds.filter((id) => {
        const layer = doc.layers.find((item) => item.id === id)
        return layer && !studioLayerLocked(doc, layer)
      })
    )
    if (!ids.size) return
    update(removeStudioLayers(doc, [...ids]))
    setSelectedId('')
    setSelectedIds([])
    setSelectedGroupIds([])
  }

  function dissolveGroup(id: string) {
    const locks = studioContextLocks(doc, { layerIds: [], groupIds: [id] })
    if (context.readonly || locks.layerIds.length || locks.groupIds.length) return
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
    if ((!selectedIds.length && !selectedGroupIds.length) || !groupName.trim()) return
    addGroup(selectedIds, groupName.trim())
    setGroupOpen(false)
  }

  function insertLibraryTemplate(template: TextTemplate) {
    if (template.type === 'image') {
      setPendingPageTemplate(template)
      return
    }
    if (template.type === 'layout') {
      update(applyPageTemplate(doc, template))
      clearSelection()
      return
    }
    const inserted = insertTextTemplate(doc, template)
    update(inserted.document)
    setSelectedGroupId(inserted.groupId)
    setSelectedId('')
    setSelectedIds([])
    setStatus(`已添加模板「${template.name}」`)
  }

  function openSaveTemplate(selection: { groupId?: string; layerId?: string }) {
    if (
      selectionIsProcessing({
        groupIds: selection.groupId ? [selection.groupId] : [],
        layerIds: selection.layerId ? [selection.layerId] : []
      })
    )
      return
    try {
      setEditingTextId('')
      cancelTransformTool()
      setSaveTemplateType('text')
      setTemplateDraft(captureTextTemplate(doc, selection))
    } catch (reason) {
      setError(String(reason))
    }
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
    const acknowledgeSavedResults = cutout.captureSave()
    const snapshot = await saver.flush()
    acknowledgeSavedResults()
    setDirty(saver.dirty)
    return snapshot
  }
  async function persistNote() {
    await notes.flush()
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
    if (busy || context.readonly) return
    if (mediaFile) {
      setMediaSaveChoiceOpen(true)
      return
    }
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
  function confirmCopySave() {
    if (!activeMediaFile || busy || context.readonly) return
    const name = activeMediaFile.name
    const dot = name.lastIndexOf('.')
    setCopyName(dot > 0 ? `${name.slice(0, dot)}_副本${name.slice(dot)}` : `${name}_副本`)
    setCopyError('')
    setCopySaveOpen(true)
  }
  async function saveMedia(overwrite: boolean) {
    const target = activeMediaFile
    if (!mediaFile || !target || busy || context.readonly) return
    if (tool === 'crop' || editingTextId || dragRef.current) {
      if (overwrite) setError('请先完成或取消当前调整')
      else setCopyError('请先完成或取消当前调整')
      return
    }
    if (!overwrite && !copyName.trim()) {
      setCopyError('请输入副本文件名')
      return
    }
    setBusy(true)
    setError('')
    setCopyError('')
    try {
      const acknowledgeSavedResults = cutout.captureSave()
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
          copy_name: overwrite ? undefined : copyName.trim(),
          editor_document: structuredClone(doc),
          export_area: exportArea,
          parent_revision: activeMediaRevision
        })
      })
      mergeSavedMediaAssets(context.assetInfo, saved.file, saved.record.asset_info, overwrite)
      if (overwrite) {
        acknowledgeSavedResults()
        setActiveMediaFile(saved.file)
        setActiveMediaRecord(saved.record)
        setActiveMediaRevision(saved.record.output_hash)
        setDoc(saved.record.document)
        originalDoc.current = structuredClone(saved.record.document)
        undoStack.current = []
        redoStack.current = []
        setHistoryVersion((value) => value + 1)
        setDirty(false)
      }
      setAddedAssets((current) =>
        addWorkspaceAssets(current, [
          { path: saved.file.fullpath, name: saved.file.name, kind: 'image' }
        ])
      )
      setStatus(overwrite ? '已覆盖原图' : '已保存副本')
      setCopySaveOpen(false)
      onMediaSaved?.(saved.file, overwrite)
      window.dispatchEvent(
        new CustomEvent('omnigallery:media-updated', {
          detail: { path: saved.file.fullpath, overwrite }
        })
      )
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '保存图片失败'
      if (overwrite) setError(message)
      else setCopyError(message)
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
  function pointFromEvent(event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: ((event.clientX - rect.left) * doc.width) / rect.width,
      y: ((event.clientY - rect.top) * doc.height) / rect.height
    }
  }
  function applyMenuSelection(selection: StudioMenuSelection) {
    cancelTransformTool()
    setSelectedIds(selection.layerIds)
    setSelectedId(selection.layerIds.at(-1) || '')
    setSelectedGroupIds(selection.groupIds)
  }
  function openObjectMenu(
    event: React.MouseEvent<HTMLElement>,
    target?: StudioMenuTarget,
    canvas = false
  ) {
    if ((event.target as HTMLElement).closest('input, textarea, [contenteditable="true"]')) return
    event.preventDefault()
    event.stopPropagation()
    if (compare || editingTextId || tool === 'crop' || busy) return
    const hits = canvas ? studioContextHits(doc, pointFromEvent(event)) : []
    const selection = studioContextSelection(
      doc,
      { layerIds: selectedIds, groupIds: selectedGroupIds },
      canvas && hits[0] ? { kind: 'layer', id: hits[0].id } : target,
      canvas,
      canvas && event.altKey
    )
    applyMenuSelection(selection)
    setLayerMenu({
      selection,
      targets: hits.length > 1 ? studioContextTargets(doc, hits) : [],
      x: event.clientX,
      y: event.clientY
    })
  }
  function fillImage(id: string) {
    const layer = doc.layers.find((l) => l.id === id)
    if (!layer || layer.kind !== 'image' || context.readonly || studioLayerLocked(doc, layer))
      return
    const frame = doc.layers.find((l) => l.id === layer.frameId && l.kind === 'frame')
    updateLayer(id, {
      x: frame?.x || 0,
      y: frame?.y || 0,
      width: frame?.width || doc.width,
      height: frame?.height || doc.height,
      rotation: frame?.rotation || 0,
      fit: 'cover',
      zoom: 1
    })
  }
  function addVector(kind: 'frame' | 'shape', shape: Parameters<typeof createStudioVector>[1]) {
    if (context.readonly) return
    const width = doc.width * 0.65,
      height = doc.height * 0.55
    const layer = createStudioVector(kind, shape, {
      x: (doc.width - width) / 2,
      y: (doc.height - height) / 2,
      width,
      height
    })
    if (shape === 'polygon')
      layer.points = [
        { x: 0.15, y: 0 },
        { x: 1, y: 0 },
        { x: 0.85, y: 1 },
        { x: 0, y: 1 }
      ]
    update({ ...doc, layers: [...doc.layers, layer] })
    chooseLayer(layer.id)
    setTool('select')
  }
  function setViewPan(x: number, y: number) {
    viewPan.current = { x, y }
    stageRef.current?.style.setProperty('--react-image-pan-x', `${x}px`)
    stageRef.current?.style.setProperty('--react-image-pan-y', `${y}px`)
  }
  function beginPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 1 && !(event.button === 0 && spaceHeld.current)) return
    event.preventDefault()
    event.stopPropagation()
    panRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: viewPan.current.x,
      top: viewPan.current.y
    }
    event.currentTarget.dataset.panning = 'true'
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function movePan(event: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current
    if (!pan || pan.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    setViewPan(pan.left + event.clientX - pan.x, pan.top + event.clientY - pan.y)
  }
  function finishPan() {
    const pan = panRef.current
    panRef.current = undefined
    if (stageRef.current) delete stageRef.current.dataset.panning
    if (pan && stageRef.current?.hasPointerCapture(pan.pointerId))
      stageRef.current.releasePointerCapture(pan.pointerId)
  }
  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    if (panRef.current?.pointerId !== event.pointerId) return
    event.stopPropagation()
    finishPan()
  }
  function finishLayerResize(event: React.PointerEvent<HTMLDivElement>) {
    delete event.currentTarget.dataset.resizeStartY
    delete event.currentTarget.dataset.resizeStartHeight
    delete event.currentTarget.dataset.resizeAreaHeight
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function beginTransform(
    event: React.PointerEvent<HTMLElement>,
    layer: StudioLayer,
    mode: 'move' | 'resize' | 'rotate' | 'point',
    handle = ''
  ) {
    if (
      event.button !== 0 ||
      compare ||
      editingTextId ||
      context.readonly ||
      studioLayerLocked(doc, layer) ||
      (mode !== 'move' && protectedProcessingIds.has(layer.id))
    )
      return
    const point = pointFromEvent(event)
    dragRef.current = {
      id: layer.id,
      pointerX: point.x,
      pointerY: point.y,
      mode,
      handle,
      pointerId: event.pointerId,
      original: doc,
      moved: false,
      previewStarted: false,
      originalDirty: dirty
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    setStatus('')
  }
  function beginGroupTransform(event: React.PointerEvent<HTMLElement>, groupId: string) {
    if (event.button !== 0 || compare || editingTextId || context.readonly || spaceHeld.current)
      return
    if (moveStudioGroup(doc, groupId, 0, 0) === doc) return
    const point = pointFromEvent(event)
    dragRef.current = {
      id: groupId,
      groupId,
      pointerX: point.x,
      pointerY: point.y,
      mode: 'move',
      handle: '',
      pointerId: event.pointerId,
      original: doc,
      moved: false,
      previewStarted: false,
      originalDirty: dirty
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    setStatus('')
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (compare || spaceHeld.current || event.button !== 0) return
    const point = pointFromEvent(event)
    const layer = studioHitLayer(doc, point, event.altKey || !!selected?.frameId)
    if (!layer) {
      clearSelection()
      return
    }
    if (tool === 'crop' || editingTextId) return
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      if (layer.groupId && !event.altKey) chooseGroup(layer.groupId, true)
      else chooseLayer(layer.id, true)
      return
    }
    if (multipleSelection && selectionIds.includes(layer.id)) {
      beginTransform(event, layer, 'move')
      if (dragRef.current) dragRef.current.selectionIds = selectionIds
      return
    }
    if (
      layer?.groupId &&
      !event.altKey &&
      (selectedGroupId === layer.groupId || selectedId !== layer.id)
    ) {
      chooseGroup(layer.groupId)
      beginGroupTransform(event, layer.groupId)
      return
    }
    setSelectedId(layer?.id || '')
    setSelectedIds(layer ? [layer.id] : [])
    setSelectedGroupId('')
    if (layer) beginTransform(event, layer, 'move')
  }
  function pointerMove(event: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = pointFromEvent(event)
    if (Math.hypot(point.x - drag.pointerX, point.y - drag.pointerY) < 0.5 && !drag.moved) return
    drag.moved = true
    pendingDragDoc.current = drag.selectionIds
      ? moveStudioSelection(
          drag.original,
          drag.selectionIds,
          Math.round(point.x - drag.pointerX),
          Math.round(point.y - drag.pointerY)
        )
      : drag.groupId
        ? moveStudioGroup(
            drag.original,
            drag.groupId,
            Math.round(point.x - drag.pointerX),
            Math.round(point.y - drag.pointerY)
          )
        : {
            ...drag.original,
            layers: drag.original.layers.map((layer) => {
              if (layer.id !== drag.id) return layer
              if (drag.mode === 'point' && (layer.kind === 'frame' || layer.kind === 'shape')) {
                const local = studioFramePoint(layer, point)
                const p = {
                  x: Math.max(0, Math.min(1, local.x / layer.width)),
                  y: Math.max(0, Math.min(1, local.y / layer.height))
                }
                return drag.handle === 'tail'
                  ? { ...layer, tail: { x: p.x, y: Math.max(0.8, p.y) } }
                  : {
                      ...layer,
                      points: layer.points.map((v, i) => (i === Number(drag.handle) ? p : v))
                    }
              }
              if (drag.mode === 'rotate')
                return {
                  ...layer,
                  rotation: studioPointerRotation(
                    layer,
                    { x: drag.pointerX, y: drag.pointerY },
                    point,
                    event.shiftKey
                  )
                }
              if (drag.mode === 'resize') {
                return {
                  ...layer,
                  ...resizeStudioFrame(
                    layer,
                    drag.handle,
                    point.x - drag.pointerX,
                    point.y - drag.pointerY,
                    drag.handle.length === 2
                      ? layer.kind === 'image'
                        ? !event.shiftKey
                        : event.shiftKey
                      : event.shiftKey
                  )
                }
              }
              return {
                ...layer,
                x: Math.round(layer.x + point.x - drag.pointerX),
                y: Math.round(layer.y + point.y - drag.pointerY)
              }
            })
          }
    if (!drag.groupId && !drag.selectionIds) {
      const changed = pendingDragDoc.current.layers.find((layer) => layer.id === drag.id)
      if (changed) pendingDragDoc.current = changeStudioLayer(drag.original, drag.id, changed)
    }
    if (dragFrame.current === undefined) dragFrame.current = requestAnimationFrame(flushDragPreview)
  }
  function flushDragPreview() {
    dragFrame.current = undefined
    const next = pendingDragDoc.current
    pendingDragDoc.current = undefined
    const drag = dragRef.current
    if (!next || !drag || !checkProcessing(next)) return
    transformPreview.publish(drag.original, next)
    if (!drag.previewStarted) {
      drag.previewStarted = true
      setTransforming(true)
      setDirty(true)
    }
  }
  function pointerUp() {
    const drag = dragRef.current
    if (dragFrame.current !== undefined) cancelAnimationFrame(dragFrame.current)
    flushDragPreview()
    if (drag?.moved) {
      const next = {
        ...transformPreview.document(drag.original),
        updatedAt: new Date().toISOString()
      }
      saverRef.current?.update(next)
      setDoc(next)
      setDirty(true)
      undoStack.current.push(drag.original)
      if (undoStack.current.length > 60) undoStack.current.shift()
      redoStack.current = []
      setHistoryVersion((value) => value + 1)
    }
    dragRef.current = undefined
    setTransforming(false)
    if (drag?.moved) window.setTimeout(() => void flushChanges(), 100)
  }
  function cancelPointer() {
    if (dragFrame.current !== undefined) cancelAnimationFrame(dragFrame.current)
    dragFrame.current = undefined
    pendingDragDoc.current = undefined
    transformPreview.clear()
    if (dragRef.current) setDirty(dragRef.current.originalDirty)
    dragRef.current = undefined
    setTransforming(false)
  }

  function cancelTransformTool() {
    setCropFrame(undefined)
    setTool('select')
  }
  function chooseTransformTool(next: ImageTransformTool) {
    if (selectedCutoutPending && ['crop', 'correct'].includes(next)) return
    setTool(next)
    setCropFrame(
      next === 'crop' && selected?.kind === 'image'
        ? studioCenteredCrop(selected.width, selected.height, cropRatio)
        : undefined
    )
  }
  function chooseCropRatio(key: string, ratio: number) {
    setCropRatioKey(key)
    setCropRatio(ratio)
    if (selected) setCropFrame(studioCenteredCrop(selected.width, selected.height, ratio))
  }

  function applyCrop() {
    const frame = cropFrame && cropPreview.frame(cropFrame)
    if (
      !frame ||
      frame.width < 1 ||
      frame.height < 1 ||
      selected?.kind !== 'image' ||
      selectedCutoutPending ||
      context.readonly ||
      studioLayerLocked(doc, selected)
    )
      return
    const file = context.assetInfo[selected.path]
    const selection = {
      x: frame.x / selected.width,
      y: frame.y / selected.height,
      width: frame.width / selected.width,
      height: frame.height / selected.height
    }
    const cropped = cropStudioImage(selected, selection, file?.width || 0, file?.height || 0)
    update({
      ...doc,
      layers: doc.layers.map((item) => (item.id === selected.id ? cropped : item))
    })
    setCropFrame(undefined)
    setTool('select')
  }
  async function createAIBranch(destination: AIWorkDestination) {
    if (aiBusy || busy || mediaFile || cutoutDisabled || selectedCutoutPending || !cutoutLayer)
      return
    setAiBusy(true)
    setAiError('')
    const branchId = crypto.randomUUID()
    const savedIds: string[] = []
    let installing = false
    try {
      const layerId = cutoutLayer.id
      if (!(await flushChanges())) throw new Error('当前图片制作文件未能保存，尚未建立 AI 分支')
      if (advancedSelection.current.layerId !== layerId || advancedSelection.current.disabled)
        throw new Error('所选图层已变化或正在加工，请重新选择')
      const source = structuredClone(currentDocument.current)
      const prepared = prepareAdvancedAIInput(source, layerId)
      const selectedSource = source.layers.find((layer) => layer.id === layerId)
      if (!selectedSource) throw new Error('所选图层已删除')
      const scope = { kind: 'layer' as const, id: layerId }
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
      const inputPath = await snapshot(prepared, selectedSource.name)
      installing = true
      await mutateWorkspaceState(context.workspaceId, (storage) => {
        installAIBranch(
          storage,
          context.workspaceId,
          context.work.id,
          source,
          scope,
          'content',
          selectedSource.name,
          branchId,
          inputPath,
          prepared,
          [],
          destination
        )
      })
      setTool('select')
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
          setAiError('无法确认 AI 分支是否已保存。输入快照已保留，请刷新工作区核对。')
          return
        }
      }
      if (installed) {
        setTool('select')
        navigation.openEditor('ai-image', branchId)
      } else {
        await Promise.allSettled(
          savedIds.map((id) =>
            apiRequest(`/workspace_artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' })
          )
        )
        setAiError(reason instanceof Error ? reason.message : '创建 AI 制作文件失败')
      }
    } finally {
      setAiBusy(false)
    }
  }
  async function openExistingAIBranch(branchId: string) {
    if (aiBusy || busy || mediaFile) return
    setAiBusy(true)
    setAiError('')
    try {
      if (!(await flushChanges())) throw new Error('当前图片制作文件未能保存，请检查错误后重试')
      const exists = createWorkspaceWorksRepository(
        context.workspaceId,
        readWorkspaceState(context.workspaceId)
      )
        .load()
        .works.some((work) =>
          work.drafts.some((draft) => draft.id === branchId && draft.kind === 'ai')
        )
      if (!exists) throw new Error('AI 制作文件已删除，请刷新作品')
      setTool('select')
      navigation.openEditor('ai-image', branchId)
    } catch (reason) {
      setAiError(reason instanceof Error ? reason.message : '打开 AI 制作文件失败')
    } finally {
      setAiBusy(false)
    }
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (mergeTarget) return
      if (layerMenu && event.key === 'Escape') {
        event.preventDefault()
        setLayerMenu(undefined)
        return
      }
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
        if (context.readonly || compare || selectionProcessing) return
        if (event.shiftKey && selectedGroupId) {
          event.preventDefault()
          dissolveGroup(selectedGroupId)
        } else if (!event.shiftKey && (selectedIds.length || selectedGroupIds.length)) {
          event.preventDefault()
          setGroupName(`分组 ${doc.groups.length + 1}`)
          setGroupOpen(true)
        }
        return
      }
      if (event.key === 'Escape') {
        if (panRef.current) {
          setViewPan(panRef.current.left, panRef.current.top)
          finishPan()
        } else if (dragRef.current) cancelPointer()
        else if (compare) setCompare(false)
        else if (tool !== 'select') {
          cancelTransformTool()
        } else clearSelection()
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
        if (tool === 'crop' && cropFrame && selectedLayer) {
          event.preventDefault()
          const origin = studioFramePoint(selectedLayer, { x: 0, y: 0 })
          const point = studioFramePoint(selectedLayer, { x: dx, y: dy })
          setCropFrame(
            studioMoveCrop(selectedLayer, cropFrame, point.x - origin.x, point.y - origin.y)
          )
          return
        }
        if (multipleSelection) {
          event.preventDefault()
          const next = moveStudioSelection(doc, selectionIds, dx, dy)
          if (next !== doc) update(next)
        } else if (selectedGroupId) {
          event.preventDefault()
          const next = moveStudioGroup(doc, selectedGroupId, dx, dy)
          if (next !== doc) update(next)
        } else if (selectedLayer && !studioLayerLocked(doc, selectedLayer)) {
          event.preventDefault()
          updateLayer(selectedLayer.id, { x: selectedLayer.x + dx, y: selectedLayer.y + dy })
        }
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !context.readonly) {
        if (compare) return
        if (selectedIds.length || selectedGroupIds.length) event.preventDefault()
        if (selectionProcessing) return
        if (selectedGroupIds.length)
          setDeleteSelection({ layerIds: selectedIds, groupIds: selectedGroupIds })
        else removeSelection()
      }
    }
    function keyup(event: KeyboardEvent) {
      if (event.code === 'Space') spaceHeld.current = false
    }
    function blur() {
      spaceHeld.current = false
      finishPan()
    }
    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      window.removeEventListener('blur', blur)
    }
  })

  const layerMenuItems: ImageContextItem[] = []
  const menuIds = studioSelectionIds(doc, menuSelection.layerIds, menuSelection.groupIds)
  const menuLayers = doc.layers.filter((l) => menuIds.includes(l.id))
  const menuLocks = studioContextLocks(doc, menuSelection)
  const menuLocked = !!(menuLocks.layerIds.length || menuLocks.groupIds.length)
  const menuDisabled =
    context.readonly || busy || menuLocked || selectionIsProcessing(menuSelection)
  const menuBlank = !menuSelection.layerIds.length && !menuSelection.groupIds.length
  const objectLabel = (target: StudioMenuTarget) => {
    if (target.kind === 'group')
      return `分组 · ${doc.groups.find((g) => g.id === target.id)?.name || ''}`
    const layer = doc.layers.find((l) => l.id === target.id)
    const type = {
      image: '图片',
      text: '文字',
      shape: '形状',
      frame: '画框',
      paint: '绘制',
      guide: '参考线',
      mask: '蒙版'
    }
    return layer ? `${type[layer.kind]} · ${layer.name}` : ''
  }
  const selectObject = (target: StudioMenuTarget) =>
    applyMenuSelection(
      target.kind === 'group'
        ? { layerIds: [], groupIds: [target.id] }
        : { layerIds: [target.id], groupIds: [] }
    )
  const openImagePicker = () => {
    setPickerMode('add')
    setPickerOpen(true)
  }
  if (menuBlank) {
    if (clipboard.current)
      layerMenuItems.push({ label: '粘贴', run: pasteSelection, disabled: context.readonly })
    layerMenuItems.push(
      {
        label: '添加',
        disabled: context.readonly,
        children: [
          { label: '图片', run: openImagePicker },
          { label: '文字', run: () => chooseTransformTool('text') },
          { label: '形状', run: () => chooseTransformTool('shapes') },
          { label: '画框', run: () => addVector('frame', 'rect') }
        ]
      },
      { label: '画布设置', run: clearSelection }
    )
  } else {
    if (menuLocked)
      layerMenuItems.push({
        label:
          menuGroup && menuLocks.groupIds.length === 1 && !menuLocks.layerIds.length
            ? '解锁分组'
            : menuLayer && menuLocks.groupIds.length === 1 && !menuLocks.layerIds.length
              ? '解锁所属分组'
              : menuLayer && menuLocks.layerIds.length === 1 && !menuLocks.groupIds.length
                ? menuLocks.layerIds[0] === menuLayer.id
                  ? '解锁图层'
                  : '解锁所属画框'
                : '解锁所选内容',
        disabled: context.readonly || busy,
        run: () =>
          update({
            ...doc,
            groups: doc.groups.map((g) =>
              menuLocks.groupIds.includes(g.id) ? { ...g, locked: false } : g
            ),
            layers: doc.layers.map((l) =>
              menuLocks.layerIds.includes(l.id) ? { ...l, locked: false } : l
            )
          })
      })
    if (menuLayer?.kind === 'image')
      layerMenuItems.push(
        {
          label: '替换图片',
          disabled: menuDisabled,
          run: () => {
            chooseLayer(menuLayer.id)
            setPickerMode('replace')
            setPickerOpen(true)
          }
        },
        {
          label: menuLayer.frameId ? '铺满所属画框' : '铺满画布',
          disabled: menuDisabled,
          run: () => fillImage(menuLayer.id)
        }
      )
    if (menuLayer?.kind === 'frame') {
      const children = doc.layers.filter((l) => l.frameId === menuLayer.id)
      if (children.length)
        layerMenuItems.push({
          label: '选择框内内容',
          children: [
            {
              label: '选择全部内容',
              run: () => applyMenuSelection({ layerIds: children.map((l) => l.id), groupIds: [] })
            },
            ...studioContextTargets(doc, [...children].reverse())
              .filter((t) =>
                t.kind === 'layer' ? t.id !== menuLayer.id : t.id !== menuLayer.groupId
              )
              .map((target) => ({ label: objectLabel(target), run: () => selectObject(target) }))
          ]
        })
      else layerMenuItems.push({ label: '添加图片', disabled: menuDisabled, run: openImagePicker })
    }
    if (menuLayer?.kind === 'text' || (menuGroup && menuLayers.some((l) => l.kind === 'text')))
      layerMenuItems.push({
        label: '保存为文字模板',
        disabled: menuDisabled,
        run: () => {
          if (menuGroup) openSaveTemplate({ groupId: menuGroup.id })
          else if (menuLayer) openSaveTemplate({ layerId: menuLayer.id })
        }
      })
    if (menuGroup)
      layerMenuItems.push({
        label: '解除分组',
        disabled: menuDisabled,
        run: () => dissolveGroup(menuGroup.id)
      })
    if (!menuSingle)
      layerMenuItems.push({
        label: '编为新分组',
        disabled: menuDisabled,
        run: () => {
          setGroupName(`分组 ${doc.groups.length + 1}`)
          setGroupOpen(true)
        }
      })
    if (menuGroup || !menuSingle || menuLayer?.kind === 'frame')
      layerMenuItems.push({
        label: '合成为图片',
        disabled: menuDisabled || !menuIds.length,
        run: () =>
          setMergeTarget({
            document: doc,
            layerIds: menuSelection.layerIds,
            groupIds: menuSelection.groupIds
          })
      })
    layerMenuItems.push({
      label: '复制一份',
      disabled: menuDisabled,
      run: () => duplicateSelection(menuSelection)
    })
    if (menuLayer && menuLayer.kind !== 'frame')
      layerMenuItems.push({
        label: '分组',
        content: (
          <ImageGroupAssignment
            groups={doc.groups}
            layers={[menuLayer]}
            disabled={menuDisabled}
            contextMenu
            onMove={(groupId) => assignGroup([menuLayer.id], groupId)}
            onCreate={() => {
              addGroup([menuLayer.id], `分组 ${doc.groups.length + 1}`, [])
              setLayerMenu(undefined)
            }}
          />
        )
      })
    layerMenuItems.push({
      label: '层级',
      disabled: menuDisabled,
      children: (
        [
          ['up', '上移一层'],
          ['down', '下移一层'],
          ['top', '置于顶层'],
          ['bottom', '置于底层']
        ] as const
      ).map(([direction, label]) => {
        const next = orderStudioItems(doc, menuSelection, direction)
        return {
          label,
          disabled: next === doc,
          run: () => {
            if (next !== doc) update(next)
          }
        }
      })
    })
    layerMenuItems.push({
      label: menuLayer?.kind === 'frame' ? '删除画框及内容' : menuGroup ? '删除分组及内容' : '删除',
      disabled: menuDisabled,
      danger: true,
      run: () => {
        if (menuSelection.groupIds.length || menuLayers.some((l) => l.kind === 'frame'))
          setDeleteSelection(menuSelection)
        else {
          const next = deleteStudioSelection(doc, menuSelection.layerIds, [])
          if (next !== doc) {
            update(next)
            clearSelection()
          }
        }
      }
    })
  }
  if (layerMenu && layerMenu.targets.length > 1)
    layerMenuItems.push({
      label: '选择对象',
      children: layerMenu.targets.map((target) => ({
        label: objectLabel(target),
        run: () => selectObject(target)
      }))
    })
  const deleteLabel = deleteSelection?.groupIds.length ? '删除分组及内容' : '删除画框及内容'

  return (
    <div className="react-editor-panel react-image-studio">
      <div className={`react-editor-toolbar ${!mediaFile ? 'has-extra-actions' : ''}`}>
        {backAction}
        <Text fw={700} size="xs" className="react-image-doc-title" title={doc.name}>
          {doc.name}
        </Text>
        {!mediaFile && (
          <Tooltip label="修改名称">
            <ActionIcon
              aria-label="修改名称"
              variant="subtle"
              disabled={context.readonly}
              onClick={() => {
                setRenameName(doc.name)
                setRenameOpen(true)
              }}
            >
              <IconPencil size={18} />
            </ActionIcon>
          </Tooltip>
        )}
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
            <Button size="xs" onClick={confirmCopySave} loading={busy} disabled={context.readonly}>
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
        {helpAction}
        <Tooltip
          label={
            status ||
            (mediaFile
              ? mediaDirty
                ? '修改未保存'
                : activeMediaRecord
                  ? '图片编辑已保存'
                  : '原图未修改'
              : dirty || notes.dirty
                ? '修改未保存'
                : '编辑文档已保存到本机')
          }
        >
          <span
            className={`react-image-save-state ${(mediaFile ? mediaDirty : dirty || notes.dirty) ? 'is-dirty' : ''} ${notes.error ? 'is-error' : ''}`}
            aria-label={
              status ||
              (mediaFile
                ? mediaDirty
                  ? '修改未保存'
                  : '已保存'
                : dirty || notes.dirty
                  ? '修改未保存'
                  : '编辑文档已保存到本机')
            }
          />
        </Tooltip>
      </div>
      <EditorActions
        notes={
          mediaFile
            ? undefined
            : {
                opened: notesOpen,
                onToggle: () => {
                  if (notesOpen)
                    void persistNote()
                      .then(() => setNotesOpen(false))
                      .catch(() => {})
                  else {
                    setTasksOpen(false)
                    setNotesOpen(true)
                  }
                }
              }
        }
        versions={
          !mediaFile && (
            <EditorVersions
              workspaceId={context.workspaceId}
              draftId={context.draft.id}
              kind="image"
              document={doc}
              readonly={context.readonly}
              disabled={
                busy ||
                transforming ||
                !!editingTextId ||
                tool === 'crop' ||
                !!mergeTarget ||
                protectedProcessingIds.size > 0
              }
              parseDocument={(raw) => {
                return readStudioVersionDocument(JSON.parse(raw), context.draft.id)
              }}
              summarize={(snapshot) =>
                `${snapshot.width} × ${snapshot.height} · ${snapshot.layers.length} 个图层`
              }
              renderPreview={(snapshot) => (
                <ImageSnapshotPreview document={snapshot} assetInfo={context.assetInfo} />
              )}
              onBeforeSave={flushChanges}
              onRestore={async (snapshot) => {
                update(snapshot)
                setSelectedId('')
                setSelectedIds([])
                setSelectedGroupIds([])
                await persist()
              }}
              onOpen={async () => {
                await persistNote()
                setNotesOpen(false)
                setTasksOpen(false)
              }}
            />
          )
        }
        tasks={{
          opened: tasksOpen,
          running: cutout.jobs.some((job) => job.state === 'queued' || job.state === 'running'),
          onToggle: () => {
            void persistNote()
              .then(() => {
                setNotesOpen(false)
                setTasksOpen((value) => !value)
              })
              .catch(() => {})
          }
        }}
      />
      {notesOpen && !mediaFile && (
        <EditorNotes
          value={notes.value}
          onChange={notes.setValue}
          readonly={context.readonly}
          saving={notes.saving}
          dirty={notes.dirty}
          error={notes.error}
          onSave={notes.flush}
          onClose={() => setNotesOpen(false)}
        />
      )}
      {tasksOpen && (
        <EditorTaskList
          context={context}
          mediaPath={mediaFile?.file.fullpath}
          imageTools={{
            documentKey: imageToolDocumentKey,
            jobs: cutout.jobs,
            cancel: cutout.cancel
          }}
          onClose={() => setTasksOpen(false)}
        />
      )}
      {error && (
        <Alert color="red" mx="md" mt="sm" withCloseButton onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      <div className="react-editor-main">
        <nav
          className="react-image-tool-rail"
          aria-label="图片编辑工具"
          ref={toolRailRef}
          onKeyDownCapture={(event) => {
            if (event.key === 'Escape' && tool !== 'select') {
              event.preventDefault()
              event.stopPropagation()
              cancelTransformTool()
            }
          }}
        >
          <Tooltip label="选择与移动">
            <ActionIcon
              aria-label="选择与移动"
              variant={tool === 'select' ? 'light' : 'subtle'}
              onClick={() => {
                cancelTransformTool()
              }}
            >
              <IconArrowsMove size={18} stroke={1.8} />
            </ActionIcon>
          </Tooltip>
          <ImageTransformTools
            selected={selected}
            canvas={doc}
            targetLabel={
              multipleSelection
                ? `多选 · ${selectedIds.length} 个图层、${selectedGroupIds.length} 个分组`
                : selectedGroup
                  ? `分组 · ${selectedGroup.name}`
                  : selected
                    ? `${selected.kind === 'image' ? '图片' : '图层'} · ${selected.name}`
                    : '画布'
            }
            onCorrection={(correction) => {
              if (selected?.kind === 'image' && !selectedLocked && !compare)
                updateLayer(selected.id, { correction })
            }}
            preview={transformPreview}
            tool={tool}
            disabled={
              !!selectedGroup ||
              selectedCutoutPending ||
              multipleSelection ||
              context.readonly ||
              compare ||
              !!editingTextId ||
              !!(
                selected &&
                (studioLayerLocked(doc, selected) || !studioLayerVisible(doc, selected))
              )
            }
            cropRatio={cropRatioKey}
            cropFrame={cropFrame}
            cropPreview={cropPreview}
            cropAspectRatio={cropRatio}
            onCropFrameChange={setCropFrame}
            onToolChange={chooseTransformTool}
            onCancel={cancelTransformTool}
            onCropRatio={chooseCropRatio}
            onCrop={applyCrop}
            onResize={(width, height) => {
              if (
                context.readonly ||
                compare ||
                selectedLocked ||
                multipleSelection ||
                selectedGroup
              )
                return
              const current = selected ? transformPreview.layer(selected) : doc
              if (current.width === width && current.height === height) return
              if (!selected) {
                update(resizeStudioCanvas(doc, width, height))
                return
              }
              const layer = transformPreview.layer(selected)
              updateLayer(selected.id, {
                x: layer.x + (layer.width - width) / 2,
                y: layer.y + (layer.height - height) / 2,
                width,
                height
              })
            }}
          />
          <Divider />
          <ImageTextTools
            opened={tool === 'text'}
            disabled={context.readonly || compare}
            onOpen={() => {
              setEditingTextId('')
              chooseTransformTool('text')
            }}
            onClose={cancelTransformTool}
            onAdd={addText}
            onInsertTemplate={insertLibraryTemplate}
          />
          <Tooltip label="素材">
            <ActionIcon
              aria-label="素材"
              variant="subtle"
              onClick={() => {
                cancelTransformTool()
                setPickerMode('add')
                setPickerOpen(true)
              }}
              disabled={context.readonly || compare}
            >
              <IconPhotoPlus size={18} />
            </ActionIcon>
          </Tooltip>
          <ImageComicTools
            onLayout={(frames) => {
              try {
                update(applyStudioFrames(doc, frames))
                clearSelection()
                setTool('select')
              } catch (reason) {
                setError(String(reason))
              }
            }}
            onLibrary={(kind) => {
              setTemplateType(kind)
              setTemplatesOpen(true)
              cancelTransformTool()
            }}
            onSave={(kind) => {
              try {
                setTemplateDraft(capturePageTemplate(doc, kind))
                setSaveTemplateType(kind)
                cancelTransformTool()
              } catch (reason) {
                setError(String(reason))
              }
            }}
            document={doc}
            tool={tool}
            disabled={context.readonly || compare}
            onTool={chooseTransformTool}
            onClose={cancelTransformTool}
            onVector={addVector}
            onBubble={(shape) => {
              const result = addStudioBubble(
                doc,
                shape,
                selected?.kind === 'frame' && !selectedLocked ? selected.id : undefined
              )
              update(result.document)
              chooseGroup(result.groupId)
              setTool('select')
            }}
          />
          <Divider />
          <ImageAITools
            opened={tool === 'ai'}
            tab={aiToolTab}
            onTabChange={setAiToolTab}
            advanced={
              mediaFile ? (
                <Text size="xs" c="dimmed">
                  媒体库高级加工暂未开放
                </Text>
              ) : (
                <ImageAdvancedAITools
                  workspaceId={context.workspaceId}
                  sourceWorkId={context.work.id}
                  active={tool === 'ai' && aiToolTab === 'advanced'}
                  name={cutoutLayer?.name}
                  disabled={cutoutDisabled || selectedCutoutPending || busy}
                  busy={aiBusy}
                  error={aiError}
                  onCreate={createAIBranch}
                  onOpen={openExistingAIBranch}
                />
              )
            }
            cutout={
              <ImageCutoutTools
                cutout={cutout}
                disabled={cutoutDisabled}
                name={cutoutLayer?.name}
              />
            }
            upscale={
              <ImageUpscaleTools
                upscale={upscale}
                layer={cutoutLayer}
                assetInfo={context.assetInfo}
                disabled={cutoutDisabled}
              />
            }
            erase={
              <ImageEraseTools erase={erase} disabled={cutoutDisabled} name={cutoutLayer?.name} />
            }
            onOpen={() => chooseTransformTool('ai')}
            onClose={cancelTransformTool}
          />
        </nav>
        <div className="react-image-stage-frame">
          <div
            className="react-editor-stage"
            ref={stageRef}
            onContextMenu={(event) => openObjectMenu(event, undefined, true)}
            onPointerDownCapture={beginPan}
            onPointerDown={(event) => {
              if (event.button !== 0 || spaceHeld.current || compare) return
              if (
                event.target === event.currentTarget ||
                event.target === canvasRef.current?.parentElement
              )
                clearSelection()
            }}
            onPointerMoveCapture={movePan}
            onPointerUpCapture={endPan}
            onPointerCancelCapture={endPan}
            onLostPointerCapture={endPan}
            onAuxClick={(event) => {
              if (event.button === 1) event.preventDefault()
            }}
            onWheel={(event) => {
              event.preventDefault()
              setViewZoom((value) =>
                Math.max(
                  0.3,
                  Math.min(
                    4,
                    value * Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.0015)
                  )
                )
              )
            }}
          >
            <div
              className="react-editor-canvas-wrap"
              onDragOver={(event) => {
                if (
                  !context.readonly &&
                  event.dataTransfer.types.includes('application/x-omnigallery-image')
                ) {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                }
              }}
              onDrop={(event) => {
                const path = event.dataTransfer.getData('application/x-omnigallery-image')
                if (context.readonly || !imageAssets.some((asset) => asset.path === path)) return
                event.preventDefault()
                const bounds = event.currentTarget.getBoundingClientRect()
                const hit = studioHitLayer(doc, {
                  x: ((event.clientX - bounds.left) / bounds.width) * doc.width,
                  y: ((event.clientY - bounds.top) / bounds.height) * doc.height
                })
                if (hit && studioLayerLocked(doc, hit)) return
                addImages([path], hit?.kind === 'frame' ? hit.id : '')
              }}
              data-checkerboard={
                doc.background === 'transparent' && doc.backgroundView === 'checkerboard'
              }
              style={{ width: displayWidth, height: displayHeight }}
            >
              <ImagePreviewCanvas
                document={doc}
                preview={transformPreview}
                original={originalDoc.current}
                compare={compare}
                cutoutBefore={cutoutBefore}
                assetInfo={context.assetInfo}
                canvasRef={canvasRef}
                displayWidth={displayWidth}
                displayHeight={displayHeight}
                onError={setError}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={cancelPointer}
                onLostPointerCapture={() => {
                  if (dragRef.current) pointerUp()
                }}
                onDoubleClick={(event) => {
                  if (tool === 'crop') return
                  const point = pointFromEvent(event)
                  const layer = studioHitLayer(doc, point, true)
                  if (!layer) return
                  chooseLayer(layer.id)
                  if (
                    layer.kind === 'image' &&
                    !studioLayerLocked(doc, layer) &&
                    !cutout.pending.some((job) => job.layer_id === layer.id)
                  ) {
                    setTool('crop')
                    setCropFrame(studioCenteredCrop(layer.width, layer.height, cropRatio))
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
                <ImageInlineTextEditor
                  textRef={inlineTextRef}
                  layer={editingTextLayer}
                  document={doc}
                  displayWidth={displayWidth}
                  displayHeight={displayHeight}
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
                />
              )}
              {multipleSelection &&
                !compare &&
                !editingTextId &&
                selectionIds.map((id) => {
                  const layer = doc.layers.find((l) => l.id === id)
                  return layer && studioLayerVisible(doc, layer) ? (
                    <ImageSelectionFrame
                      key={id}
                      document={doc}
                      preview={transformPreview}
                      selected={layer}
                    >
                      {() => null}
                    </ImageSelectionFrame>
                  ) : null
                })}
              {selectedGroup && !compare && !editingTextId && tool === 'select' && (
                <ImageGroupSelection
                  document={doc}
                  preview={transformPreview}
                  group={selectedGroup}
                  locked={context.readonly || groupLocked}
                  onPointerDown={(event) => {
                    if (spaceHeld.current || event.button !== 0) return
                    const point = pointFromEvent(event)
                    const layer = studioHitLayer(doc, point, true)
                    if (!layer) {
                      clearSelection()
                      return
                    }
                    if (event.ctrlKey || event.metaKey) {
                      if (layer.groupId && !event.altKey) chooseGroup(layer.groupId, true)
                      else chooseLayer(layer.id, true)
                      return
                    }
                    if (event.altKey) {
                      chooseLayer(layer.id)
                      return
                    }
                    if (layer.groupId !== selectedGroup.id) {
                      chooseLayer(layer.id)
                      return
                    }
                    beginGroupTransform(event, selectedGroup.id)
                  }}
                  onPointerMove={pointerMove}
                  onPointerUp={pointerUp}
                  onPointerCancel={cancelPointer}
                  onLostPointerCapture={() => {
                    if (dragRef.current) pointerUp()
                  }}
                  onDoubleClick={(event) => {
                    const point = pointFromEvent(event)
                    const layer = studioHitLayer(doc, point, true)
                    if (layer) chooseLayer(layer.id)
                  }}
                />
              )}
              {selected &&
                studioLayerVisible(doc, selected) &&
                !compare &&
                !editingTextId &&
                !multipleSelection &&
                !cutoutFocused &&
                !upscaleFocused &&
                !eraseFocused &&
                tool !== 'crop' && (
                  <ImageSelectionFrame
                    document={doc}
                    preview={transformPreview}
                    selected={selected}
                  >
                    {(selected) => (
                      <>
                        {tool === 'correct' && selected.kind === 'image' && (
                          <div className="react-image-correction-grid" aria-hidden="true" />
                        )}
                        {(selected.kind === 'frame' || selected.kind === 'shape') && (
                          <svg
                            className="react-comic-vector-outline"
                            viewBox={`0 0 ${selected.width} ${selected.height}`}
                            preserveAspectRatio="none"
                          >
                            <path
                              d={studioVectorPath(selected)}
                              fill="none"
                              stroke="#8bbdff"
                              strokeWidth="1.5"
                              vectorEffect="non-scaling-stroke"
                            />
                          </svg>
                        )}
                        {!selectedLocked &&
                          !selectedCutoutPending &&
                          (selected.kind === 'frame' || selected.kind === 'shape') &&
                          (selected.shape === 'polygon'
                            ? selected.points.map((p, i) => ({ ...p, key: String(i) }))
                            : selected.shape === 'speech' || selected.shape === 'thought'
                              ? [{ ...selected.tail, key: 'tail' }]
                              : []
                          ).map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              className="react-comic-point"
                              aria-label={
                                p.key === 'tail' ? '调整气泡尾巴' : `调整顶点 ${Number(p.key) + 1}`
                              }
                              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                              onPointerDown={(event) => {
                                event.stopPropagation()
                                beginTransform(event, selected, 'point', p.key)
                              }}
                              onPointerMove={pointerMove}
                              onPointerUp={pointerUp}
                              onPointerCancel={cancelPointer}
                              onLostPointerCapture={() => {
                                if (dragRef.current) pointerUp()
                              }}
                            />
                          ))}
                        {!context.readonly &&
                          !studioLayerLocked(doc, selected) &&
                          !selectedCutoutPending && (
                            <>
                              {(
                                [
                                  ['nw', '左上角'],
                                  ['n', '上边'],
                                  ['ne', '右上角'],
                                  ['e', '右边'],
                                  ['se', '右下角'],
                                  ['s', '下边'],
                                  ['sw', '左下角'],
                                  ['w', '左边']
                                ] as const
                              )
                                .filter(
                                  ([handle]) =>
                                    !(
                                      (selected.kind === 'frame' || selected.kind === 'shape') &&
                                      selected.shape === 'polygon' &&
                                      handle.length === 2
                                    )
                                )
                                .map(([handle, label]) => (
                                  <button
                                    key={handle}
                                    type="button"
                                    className={`react-image-transform-handle is-${handle}`}
                                    aria-label={`缩放图层：${label}`}
                                    onPointerDown={(event) => {
                                      event.stopPropagation()
                                      beginTransform(event, selected, 'resize', handle)
                                    }}
                                    onPointerMove={pointerMove}
                                    onPointerUp={pointerUp}
                                    onPointerCancel={cancelPointer}
                                    onLostPointerCapture={() => {
                                      if (dragRef.current) pointerUp()
                                    }}
                                    onKeyDown={(event) => {
                                      if (
                                        ![
                                          'ArrowLeft',
                                          'ArrowRight',
                                          'ArrowUp',
                                          'ArrowDown'
                                        ].includes(event.key)
                                      )
                                        return
                                      event.preventDefault()
                                      event.stopPropagation()
                                      const step = event.shiftKey ? 10 : 1
                                      const dx =
                                        event.key === 'ArrowLeft'
                                          ? -step
                                          : event.key === 'ArrowRight'
                                            ? step
                                            : 0
                                      const dy =
                                        event.key === 'ArrowUp'
                                          ? -step
                                          : event.key === 'ArrowDown'
                                            ? step
                                            : 0
                                      updateLayer(
                                        selected.id,
                                        resizeStudioFrame(
                                          selected,
                                          handle,
                                          dx,
                                          dy,
                                          handle.length === 2 &&
                                            selected.kind === 'image' &&
                                            !event.shiftKey
                                        )
                                      )
                                    }}
                                  />
                                ))}
                              <span className="react-image-rotation-stem" />
                              <button
                                type="button"
                                className="react-image-rotate-handle"
                                aria-label="旋转图层"
                                onPointerDown={(event) => {
                                  event.stopPropagation()
                                  beginTransform(event, selected, 'rotate')
                                }}
                                onPointerMove={pointerMove}
                                onPointerUp={pointerUp}
                                onPointerCancel={cancelPointer}
                                onLostPointerCapture={() => {
                                  if (dragRef.current) pointerUp()
                                }}
                                onKeyDown={(event) => {
                                  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
                                  event.preventDefault()
                                  event.stopPropagation()
                                  updateLayer(selected.id, {
                                    rotation:
                                      selected.rotation +
                                      (event.key === 'ArrowLeft' ? -1 : 1) *
                                        (event.shiftKey ? 15 : 1)
                                  })
                                }}
                              />
                            </>
                          )}
                      </>
                    )}
                  </ImageSelectionFrame>
                )}
              {cropFrame && selected?.kind === 'image' && tool === 'crop' && !compare && (
                <ImageCropFrame
                  key={selected.id}
                  layer={selected}
                  frame={cropFrame}
                  cropPreview={cropPreview}
                  ratio={cropRatio}
                  width={doc.width}
                  height={doc.height}
                  canvasRef={canvasRef}
                  disabled={context.readonly || studioLayerLocked(doc, selected)}
                  isPanning={() => spaceHeld.current}
                  onChange={setCropFrame}
                />
              )}
              {!compare && (
                <ImageProcessingOverlay
                  document={doc}
                  preview={transformPreview}
                  layerIds={cutout.processingIds}
                  labels={cutout.processingLabels}
                />
              )}
              {(cutoutFocused || upscaleFocused) && cutoutLayer && (
                <ImageCutoutOverlay
                  layer={cutoutLayer}
                  document={doc}
                  preview={transformPreview}
                  inputBounds={
                    cutoutFocused && cutout.view !== 'after'
                      ? cutout.previous?.result_bounds
                      : undefined
                  }
                  canvasRef={canvasRef}
                  hints={cutout.hints}
                  pointKind={cutout.pointKind}
                  onChange={cutout.setHints}
                  sourcePath={cutoutSelecting ? cutout.previous?.source.path : undefined}
                  readOnly={!cutoutSelecting || !!cutout.accepting}
                  isPanning={() => spaceHeld.current}
                />
              )}
              {eraseFocused && cutoutLayer && (
                <ImageEraseOverlay
                  layer={cutoutLayer}
                  document={doc}
                  preview={transformPreview}
                  canvasRef={canvasRef}
                  erase={erase}
                  isPanning={() => spaceHeld.current}
                />
              )}
            </div>
          </div>
          <div className="react-image-zoom">
            <EditorParameterSlider
              label="视图缩放"
              compact
              resetValue={100}
              formatValue={(value) => `${Math.round(value)}%`}
              min={30}
              max={400}
              value={viewZoom * 100}
              onChange={(value) => setViewZoom(value / 100)}
              w={250}
            />
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                setViewZoom(1)
                setViewPan(0, 0)
              }}
            >
              适应
            </Button>
            <Tooltip label="调整前对比">
              <ActionIcon
                aria-label="调整前对比"
                variant={compare ? 'light' : 'subtle'}
                onClick={() => setCompare((value) => !value)}
              >
                <IconEye size={18} />
              </ActionIcon>
            </Tooltip>
          </div>
        </div>
        <aside className="react-editor-inspector" ref={inspectorRef}>
          <section
            className="react-image-layer-pane"
            style={{ height: `${layerPaneHeight}%` }}
            aria-label="图层管理"
          >
            <Group className="react-image-layer-heading" justify="space-between" mb={8}>
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
                <Tooltip label={selectedGroupId ? '分组上移' : '图层上移'}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label={selectedGroupId ? '分组上移' : '图层上移'}
                    onClick={() => moveLayer(1)}
                    disabled={
                      context.readonly || selectionProcessing || (!selectedId && !selectedGroupId)
                    }
                  >
                    <IconArrowUp size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={selectedGroupId ? '分组下移' : '图层下移'}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label={selectedGroupId ? '分组下移' : '图层下移'}
                    onClick={() => moveLayer(-1)}
                    disabled={
                      context.readonly || selectionProcessing || (!selectedId && !selectedGroupId)
                    }
                  >
                    <IconArrowDown size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="新建分组">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="新建分组"
                    onClick={() => addGroup()}
                    disabled={
                      context.readonly ||
                      selectionProcessing ||
                      doc.layers.some(
                        (layer) => selectedIds.includes(layer.id) && studioLayerLocked(doc, layer)
                      )
                    }
                  >
                    <IconFolderPlus size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            <button
              type="button"
              className="react-image-layer-row react-image-canvas-row"
              data-selected={!selected && !selectedGroup && !multipleSelection}
              onDragOver={(event) => showDrop(event, { kind: 'top' })}
              onDrop={(event) => finishDrop(event, { kind: 'top' })}
              onClick={clearSelection}
            >
              <IconSquare size={14} stroke={1.8} /> <span>画布</span>
              <small>
                {doc.width} × {doc.height}
              </small>
            </button>
            <div
              className="react-image-layer-list"
              data-drop={
                dropHint?.kind === 'top' || dropHint?.kind === 'bottom' ? dropHint.kind : undefined
              }
              onDragOver={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                showDrop(event, {
                  kind: event.clientY < bounds.top + bounds.height / 2 ? 'top' : 'bottom'
                })
              }}
              onDrop={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect()
                finishDrop(event, {
                  kind: event.clientY < bounds.top + bounds.height / 2 ? 'top' : 'bottom'
                })
              }}
              onContextMenu={(event) => openObjectMenu(event)}
            >
              {layerRows.map((row) =>
                row.kind === 'group' ? (
                  <div
                    key={row.group.id}
                    className="react-image-layer-row"
                    data-selected={selectedGroupIds.includes(row.group.id)}
                    data-drop={
                      dropHint?.kind === 'group' && dropHint.id === row.group.id
                        ? dropHint.position
                        : undefined
                    }
                    onContextMenu={(event) =>
                      openObjectMenu(event, { kind: 'group', id: row.group.id })
                    }
                    draggable={
                      !context.readonly && !row.group.locked && !groupProcessing(row.group.id)
                    }
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', row.group.id)
                      dragItem.current = { kind: 'group', id: row.group.id }
                    }}
                    onDragEnd={finishListDrag}
                    onDragOver={(event) => showDrop(event, rowDropTarget(event, row))}
                    onDrop={(event) => finishDrop(event, rowDropTarget(event, row))}
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
                      onClick={(event) => chooseGroup(row.group.id, event.ctrlKey || event.metaKey)}
                    >
                      ▱ {row.group.name}{' '}
                      <small>
                        {doc.layers.filter((layer) => layer.groupId === row.group.id).length}
                      </small>
                    </button>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      disabled={context.readonly || groupProcessing(row.group.id)}
                      aria-label={row.group.visible ? '隐藏分组' : '显示分组'}
                      onClick={() => updateGroup(row.group.id, { visible: !row.group.visible })}
                    >
                      {row.group.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                    </ActionIcon>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      disabled={context.readonly || groupProcessing(row.group.id)}
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
                    data-group-child={!!row.layer.groupId || !!row.layer.frameId}
                    data-drop={
                      dropHint?.kind === 'layer' && dropHint.id === row.layer.id
                        ? dropHint.position
                        : undefined
                    }
                    onContextMenu={(event) =>
                      openObjectMenu(event, { kind: 'layer', id: row.layer.id })
                    }
                    draggable={
                      !context.readonly &&
                      !studioLayerLocked(doc, row.layer) &&
                      !protectedProcessingIds.has(row.layer.id)
                    }
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', row.layer.id)
                      dragItem.current = { kind: 'layer', id: row.layer.id }
                    }}
                    onDragEnd={finishListDrag}
                    onDragOver={(event) => showDrop(event, rowDropTarget(event, row))}
                    onDrop={(event) => finishDrop(event, rowDropTarget(event, row))}
                  >
                    {row.layer.kind === 'image' &&
                    (context.assetInfo[row.layer.path] || managedImageAssetFile(row.layer.path)) ? (
                      <img
                        className="react-image-layer-thumb"
                        src={layerThumbnailUrl(row.layer.path, context.assetInfo[row.layer.path])}
                        alt=""
                        draggable={false}
                        onClick={(event) =>
                          chooseLayer(row.layer.id, event.ctrlKey || event.metaKey)
                        }
                      />
                    ) : (
                      <span className="react-image-layer-symbol">
                        {row.layer.kind === 'image'
                          ? '▧'
                          : row.layer.kind === 'frame'
                            ? '▣'
                            : row.layer.kind === 'shape'
                              ? '◇'
                              : 'T'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="react-image-layer-name"
                      onClick={(event) => chooseLayer(row.layer.id, event.ctrlKey || event.metaKey)}
                    >
                      {row.layer.name}
                      {cutout.processingIds.includes(row.layer.id) && (
                        <span> · {cutout.processingLabels[row.layer.id]}</span>
                      )}
                    </button>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      disabled={context.readonly || protectedProcessingIds.has(row.layer.id)}
                      aria-label={row.layer.visible ? '隐藏图层' : '显示图层'}
                      onClick={() => updateLayer(row.layer.id, { visible: !row.layer.visible })}
                    >
                      {row.layer.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                    </ActionIcon>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      disabled={context.readonly || protectedProcessingIds.has(row.layer.id)}
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
            aria-orientation="horizontal"
            aria-valuemin={20}
            aria-valuemax={58}
            aria-valuenow={layerPaneHeight}
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                setLayerPaneHeight((value) =>
                  Math.max(20, Math.min(58, value + (event.key === 'ArrowDown' ? 3 : -3)))
                )
              }
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || !inspectorRef.current) return
              event.preventDefault()
              const inspector = inspectorRef.current
              const style = getComputedStyle(inspector)
              event.currentTarget.dataset.resizeStartY = String(event.clientY)
              event.currentTarget.dataset.resizeStartHeight = String(layerPaneHeight)
              event.currentTarget.dataset.resizeAreaHeight = String(
                inspector.clientHeight -
                  parseFloat(style.paddingTop) -
                  parseFloat(style.paddingBottom)
              )
              event.currentTarget.focus({ preventScroll: true })
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId) || !inspectorRef.current)
                return
              const { resizeStartY, resizeStartHeight, resizeAreaHeight } =
                event.currentTarget.dataset
              if (!resizeStartY || !resizeStartHeight || !resizeAreaHeight) return
              setLayerPaneHeight(
                Math.max(
                  20,
                  Math.min(
                    58,
                    Number(resizeStartHeight) +
                      ((event.clientY - Number(resizeStartY)) /
                        Math.max(1, Number(resizeAreaHeight))) *
                        100
                  )
                )
              )
            }}
            onPointerUp={finishLayerResize}
            onPointerCancel={finishLayerResize}
            onLostPointerCapture={finishLayerResize}
          />
          <div className="react-image-property-scroll">
            <Stack gap="md">
              {!selected && !selectedGroup && !multipleSelection && (
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
                  </div>
                  <Divider />
                </>
              )}
              {multipleSelection && (
                <Stack gap="sm">
                  <Text fw={700} size="sm">
                    已选 {selectedIds.length} 个图层、{selectedGroupIds.length} 个分组
                  </Text>
                  <Button
                    size="xs"
                    disabled={
                      context.readonly ||
                      compare ||
                      selectionProcessing ||
                      doc.layers.some(
                        (l) => selectionIds.includes(l.id) && studioLayerLocked(doc, l)
                      )
                    }
                    onClick={() => {
                      setGroupName(`分组 ${doc.groups.length + 1}`)
                      setGroupOpen(true)
                    }}
                  >
                    编为新分组
                  </Button>
                </Stack>
              )}
              {selected && !multipleSelection && (
                <>
                  <Group
                    justify="space-between"
                    gap="xs"
                    wrap="nowrap"
                    className="react-image-property-heading"
                  >
                    <Text fw={700} size="sm">
                      {selected.kind === 'text'
                        ? '文字属性'
                        : selected.kind === 'image'
                          ? '图片属性'
                          : selected.kind === 'frame'
                            ? '画框属性'
                            : selected.kind === 'shape'
                              ? '形状属性'
                              : '图层属性'}
                    </Text>
                    <ImageGroupAssignment
                      key={selected.id}
                      groups={doc.groups}
                      layers={doc.layers.filter((layer) => selectedIds.includes(layer.id))}
                      disabled={
                        context.readonly ||
                        selectedCutoutPending ||
                        doc.layers.some(
                          (layer) => selectedIds.includes(layer.id) && studioLayerLocked(doc, layer)
                        )
                      }
                      onMove={(groupId) => assignGroup(selectedIds, groupId)}
                      onCreate={() => addGroup()}
                    />
                  </Group>
                  <TextInput
                    size="xs"
                    label="名称"
                    value={selected.name}
                    onChange={(event) =>
                      updateLayer(selected.id, { name: event.currentTarget.value })
                    }
                    disabled={selectedLocked || selectedCutoutPending}
                  />
                  {selected.kind === 'image' && (
                    <Button
                      size="compact-xs"
                      variant="default"
                      disabled={selectedLocked || !canReplaceImage}
                      onClick={() => {
                        setPickerMode('replace')
                        setPickerOpen(true)
                      }}
                    >
                      从媒体库替换图片
                    </Button>
                  )}
                  {(selected.kind === 'frame' || selected.kind === 'shape') && (
                    <ImageVectorProperties
                      layer={selected}
                      disabled={selectedLocked || selectedCutoutPending}
                      onChange={(change) => updateLayer(selected.id, change)}
                      onAddImage={() => {
                        setPickerMode('add')
                        setPickerOpen(true)
                      }}
                    />
                  )}
                  {selected.kind !== 'frame' &&
                    doc.layers.some((layer) => layer.kind === 'frame') && (
                      <Select
                        size="xs"
                        label="所属画框"
                        value={selected.frameId || ''}
                        disabled={selectedLocked || selectedCutoutPending}
                        data={[
                          { value: '', label: '画布（不裁切）' },
                          ...doc.layers
                            .filter((layer) => layer.kind === 'frame')
                            .map((layer) => ({ value: layer.id, label: layer.name }))
                        ]}
                        onChange={(value) =>
                          update(assignStudioFrame(doc, selectedIds, value || undefined))
                        }
                      />
                    )}
                  {selected.kind === 'text' && (
                    <ImageTextProperties
                      selected={selected}
                      disabled={selectedLocked || selectedCutoutPending}
                      onChange={(change) => updateLayer(selected.id, change)}
                    />
                  )}
                  {selected.kind === 'image' && (
                    <>
                      <Button
                        size="compact-xs"
                        variant="default"
                        disabled={selectedLocked || selectedCutoutPending}
                        onClick={() => fillImage(selected.id)}
                      >
                        {selected.frameId ? '铺满所属画框' : '铺满画布'}
                      </Button>
                      <Stack gap={6}>
                        <Text size="xs" fw={500}>
                          填充方式
                        </Text>
                        <SegmentedControl
                          size="xs"
                          fullWidth
                          aria-label="填充方式"
                          value={selected.fit}
                          data={[
                            { value: 'cover', label: '填充' },
                            { value: 'contain', label: '完整' },
                            { value: 'stretch', label: '拉伸' }
                          ]}
                          onChange={(value) => {
                            if (value === 'cover' || value === 'contain' || value === 'stretch')
                              updateLayer(selected.id, { fit: value })
                          }}
                          disabled={selectedLocked || selectedCutoutPending}
                        />
                      </Stack>
                      <EditorParameterSlider
                        label="内容放大"
                        resetValue={1}
                        formatValue={(value) => `${value.toFixed(1)}×`}
                        min={1}
                        max={8}
                        step={0.05}
                        value={selected.zoom}
                        onChange={(value) => updateLayer(selected.id, { zoom: value })}
                        disabled={selectedLocked || selectedCutoutPending}
                      />
                      <EditorParameterSlider
                        label="亮度"
                        resetValue={100}
                        formatValue={(value) => `${value}%`}
                        min={0}
                        max={200}
                        value={selected.brightness}
                        onChange={(value) => updateLayer(selected.id, { brightness: value })}
                        disabled={selectedLocked || selectedCutoutPending}
                      />
                      <EditorParameterSlider
                        label="对比度"
                        resetValue={100}
                        formatValue={(value) => `${value}%`}
                        min={0}
                        max={200}
                        value={selected.contrast}
                        onChange={(value) => updateLayer(selected.id, { contrast: value })}
                        disabled={selectedLocked || selectedCutoutPending}
                      />
                      <EditorParameterSlider
                        label="圆角"
                        resetValue={0}
                        formatValue={(value) => `${value}px`}
                        min={0}
                        max={200}
                        value={selected.radius}
                        onChange={(value) => updateLayer(selected.id, { radius: value })}
                        disabled={selectedLocked || selectedCutoutPending}
                      />
                    </>
                  )}
                  <Divider />
                  <ImageLayerGeometry
                    key={selected.id}
                    preview={transformPreview}
                    document={doc}
                    selected={selected}
                    disabled={selectedLocked}
                    moveOnly={selectedCutoutPending}
                    onChange={(change) => updateLayer(selected.id, change)}
                  />
                  <EditorParameterSlider
                    className="react-image-layer-opacity"
                    label="不透明度"
                    resetValue={100}
                    formatValue={(value) => `${Math.round(value)}%`}
                    thumbLabel="图层不透明度"
                    value={selected.opacity * 100}
                    onChange={(value) => updateLayer(selected.id, { opacity: value / 100 })}
                    disabled={selectedLocked || selectedCutoutPending}
                  />
                  <Button
                    size="xs"
                    color="red"
                    variant="subtle"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => {
                      update(removeStudioLayers(doc, [selected.id]))
                      setSelectedId('')
                    }}
                    disabled={selectedLocked || selectedCutoutPending}
                  >
                    删除图层
                  </Button>
                </>
              )}
              {selectedGroup && (
                <>
                  <Text fw={700} size="sm">
                    分组属性
                  </Text>
                  <ImageGroupGeometry
                    document={doc}
                    preview={transformPreview}
                    groupId={selectedGroup.id}
                    disabled={context.readonly || groupLocked}
                    onMove={(dx, dy) => update(moveStudioGroup(doc, selectedGroup.id, dx, dy))}
                  />
                  <TextInput
                    size="xs"
                    label="名称"
                    value={selectedGroup.name}
                    onChange={(event) =>
                      updateGroup(selectedGroup.id, { name: event.currentTarget.value })
                    }
                    disabled={context.readonly || groupProcessing(selectedGroup.id)}
                  />
                  <Switch
                    size="xs"
                    label="显示分组"
                    checked={selectedGroup.visible}
                    onChange={(event) =>
                      updateGroup(selectedGroup.id, { visible: event.currentTarget.checked })
                    }
                    disabled={context.readonly || groupProcessing(selectedGroup.id)}
                  />
                  <Switch
                    size="xs"
                    label="锁定分组"
                    checked={selectedGroup.locked}
                    onChange={(event) =>
                      updateGroup(selectedGroup.id, { locked: event.currentTarget.checked })
                    }
                    disabled={context.readonly || groupProcessing(selectedGroup.id)}
                  />
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
                    disabled={context.readonly || groupProcessing(selectedGroup.id)}
                  >
                    解散分组，保留图层
                  </Button>
                </>
              )}
            </Stack>
          </div>
        </aside>
      </div>
      {mergeTarget && (
        <ImageMergeModal
          {...mergeTarget}
          assetInfo={context.assetInfo}
          onClose={() => setMergeTarget(undefined)}
          onApply={(source, result) => {
            if (context.readonly || currentDocument.current !== source)
              throw new Error('画布已变化，请关闭弹窗后重新选择合成内容')
            update(result.document)
            setSelectedId(result.layerId)
            setSelectedIds([result.layerId])
            setSelectedGroupIds([])
          }}
        />
      )}
      {layerMenu && (
        <ImageContextMenu
          x={layerMenu.x}
          y={layerMenu.y}
          items={layerMenuItems}
          onClose={() => setLayerMenu(undefined)}
        />
      )}
      <MaterialBar
        onDragStart={(asset, event) => {
          event.dataTransfer.setData('application/x-omnigallery-image', asset.path)
          event.dataTransfer.effectAllowed = 'copy'
        }}
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
            disabled: context.readonly || !canReplaceImage
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
              confirmCopySave()
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
        opened={copySaveOpen}
        onClose={() => {
          if (!busy) setCopySaveOpen(false)
        }}
        closeOnEscape={!busy}
        closeOnClickOutside={!busy}
        withCloseButton={!busy}
        title="保存副本"
        centered
      >
        <Stack gap="sm">
          <TextInput
            label="文件名"
            data-autofocus
            value={copyName}
            disabled={busy}
            error={copyError || undefined}
            onChange={(event) => {
              setCopyName(event.currentTarget.value)
              setCopyError('')
            }}
          />
          <Text size="xs" c="dimmed">
            保存在当前图片所在目录，保存后继续编辑当前原图。
            {/\.jpe?g$/i.test(copyName) && ' JPG 的透明区域将填充为白色。'}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={() => setCopySaveOpen(false)}>
              取消
            </Button>
            <Button loading={busy} onClick={() => void saveMedia(false)}>
              确认保存
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={overwriteOpen}
        onClose={() => setOverwriteOpen(false)}
        title="覆盖原图？"
        centered
      >
        <Text size="sm">
          将替换当前打开的原图「{activeMediaFile?.name}
          」，保留标签和描述，同时保存编辑记录与素材快照。
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
      <ImageTextTemplates
        key={templateType}
        type={templateType}
        opened={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        onInsert={insertLibraryTemplate}
      />
      <Modal
        opened={!!pendingPageTemplate}
        onClose={() => setPendingPageTemplate(undefined)}
        title="应用整页模板"
        centered
        size="md"
      >
        <Stack>
          {pendingPageTemplate && <TextTemplatePreview document={pendingPageTemplate.document} />}
          <Text size="sm">将替换当前画布尺寸与图层，原内容可通过撤销恢复。</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setPendingPageTemplate(undefined)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (pendingPageTemplate) {
                  update(applyPageTemplate(doc, pendingPageTemplate))
                  clearSelection()
                  setViewZoom(1)
                  setPendingPageTemplate(undefined)
                }
              }}
            >
              应用整页
            </Button>
          </Group>
        </Stack>
      </Modal>
      <SaveTextTemplateModal
        type={saveTemplateType}
        document={templateDraft}
        assetInfo={context.assetInfo}
        onClose={() => setTemplateDraft(undefined)}
        onSaved={() => setStatus('已保存到共享模板库')}
      />
      <Modal opened={groupOpen} onClose={() => setGroupOpen(false)} title="将选中图层编组" centered>
        <Stack>
          <TextInput
            label="分组名称"
            value={groupName}
            onChange={(event) => setGroupName(event.currentTarget.value)}
          />
          <Text size="xs" c="dimmed">
            选中的图层与分组成员会合并到新分组，原来的空分组会移除。
          </Text>
          <Button onClick={createSelectionGroup} disabled={!groupName.trim()}>
            创建分组
          </Button>
        </Stack>
      </Modal>
      <Modal
        opened={!!deleteSelection}
        onClose={() => setDeleteGroupId('')}
        title={deleteLabel}
        centered
      >
        <Stack>
          <Text size="sm">
            选中的分组、图层及画框内容会从编辑文档移除。可撤销恢复，素材文件不会删除。
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteGroupId('')}>
              取消
            </Button>
            <Button
              color="red"
              disabled={
                context.readonly ||
                (!!deleteSelection &&
                  (doc.groups.some((g) => deleteSelection.groupIds.includes(g.id) && g.locked) ||
                    doc.layers.some(
                      (l) =>
                        studioSelectionIds(
                          doc,
                          deleteSelection.layerIds,
                          deleteSelection.groupIds
                        ).includes(l.id) && studioLayerLocked(doc, l)
                    )))
              }
              onClick={() => {
                if (!deleteSelection || context.readonly) return
                const next = deleteStudioSelection(
                  doc,
                  deleteSelection.layerIds,
                  deleteSelection.groupIds
                )
                if (next !== doc) {
                  update(next)
                  clearSelection()
                }
                setDeleteGroupId('')
              }}
            >
              {deleteLabel}
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
    </div>
  )
}
