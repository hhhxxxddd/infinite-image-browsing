import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageFrame } from '../../shared/PageFrame'
import { PageState } from '../../shared/PageState'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  Menu,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton
} from '@mantine/core'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconFileMusic,
  IconFileText,
  IconFolders,
  IconLayoutGrid,
  IconPhoto,
  IconPlus,
  IconTools,
  IconVideo
} from '@tabler/icons-react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { formatFileSize } from '../../shared/formatFileSize'
import { useEditorNavigation } from '../../design/navigation'
import { subscribeWorkspaceState, readWorkspaceState } from '../../shared/workspaceState'
import {
  readWorkbenchEditorReturn,
  workbenchEditorDestination,
  workbenchEditorHistoryState,
  type WorkbenchEditorReturn
} from './workbenchEditorReturn'
import {
  addWorkspaceAssets,
  readWorkspaceRecords,
  type WorkspaceAsset,
  type WorkspaceRecord,
  type WorkspaceStatus
} from '../../../src/features/workspaces/model/workspaceModel'
import {
  createProductionDraft,
  createWorkspaceWork,
  createWorkspaceWorksRepository,
  createWorkImageDraftRepository,
  draftKindLabel,
  draftTool,
  type ProductionDraft,
  type ProductionKind,
  type WorkspaceWork,
  type WorkspaceWorkState
} from '../../../src/features/workspaces/model/workspaceWorks'
import { createStudioDocument } from '../../../src/features/image-editor/public/document'
import { createWorkspaceDraftRepository } from '../../../src/features/workspaces/model/workspaceDraftRepository'
import {
  collectWorkspaceMaterials,
  collectWorkUsedAssets
} from '../../../src/features/workspaces/model/workspaceMaterialsPool'
import { removeWorkspaceAIDrafts } from '../../../src/features/workspaces/model/workspaceReferences'
import { audioTimelineKey } from '../../../src/features/media-editor/model/audioTimeline'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import { workspaceArtifactSourceLabels } from '../../../src/features/workspaces/model/workspaceArtifactSource'
import {
  changeWorkspaceWorks,
  deleteWorkspaceWorks,
  loadWorkspaceWorks,
  reloadWorkspaceWorks
} from './workbenchData'
import WorkbenchMediaPicker from './WorkbenchMediaPicker'
import WorkbenchEditDialog, { type EditDialog } from './WorkbenchEditDialog'
import WorkbenchSkyBackdrop from './WorkbenchSkyBackdrop'
import { workbenchAccentProps } from './workbenchColors'
import { sortWorkbenchCards } from './workbenchCardOrder'
import WorkbenchSortControl, { WorkbenchCardDate, useWorkbenchSort } from './WorkbenchSortControl'
import { readWorkspaceColor } from '../../../src/features/workspaces/model/workspaceColor'
import MaterialBar from '../editors/MaterialBar'
import { MediaPreview } from '../media/MediaPreview'
import { mediaKind, type MediaFile as PreviewFile } from '../media/mediaApi'
import ProductionDraftCard from './ProductionDraftCard'
import { exportStudioBlob } from '../../../src/features/image-editor/model/studioExport'
import { studioDocumentRevision } from '../../../src/features/image-editor/model/studioPublication'
import { studioExportDocument } from '../../../src/features/image-editor/model/imageStudioModel'
import { blobToBase64 } from '../../../src/shared/lib/blobEncoding'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import '../settings/settings.css'
import './WorkbenchPage.css'

const WorkflowSettings = lazy(() => import('../settings/ToolSettings'))

type EditorKind = 'image' | 'video' | 'audio' | 'ai-image' | 'ai-audio' | 'ai-video'
type Screen = 'home' | 'workspace' | 'work'
type DraftChoice = ProductionKind | 'ai-generation'
type MaterialView = 'all' | 'used'
type WorkTab = 'drafts' | 'outputs'

interface GlobalSetting {
  app_fe_setting?: { workbench_projects?: unknown }
  is_readonly?: boolean
  extra_paths?: { path: string; alias?: string; types?: string[] }[]
}
interface WorkspaceOverview {
  workspace_id: string
  work_count: number
  draft_count: number
  recent_work: { id: string; name: string } | null
  recent_draft: { id: string; name: string } | null
  preview_artifacts: string[]
}
interface ConfirmDialog {
  title: string
  message: string
  action: () => Promise<void>
}
interface MediaFile {
  name: string
  path: string
  kind: WorkspaceAsset['kind']
}

const emptyWorks: WorkspaceWorkState = { version: 2, activeId: '', works: [] }
const activeWorkKey = 'omnigallery:workbench-current-work'
const kindLabel = { image: '图片', video: '视频', audio: '音频' }
const draftChoices: { kind: DraftChoice; label: string; description: string }[] = [
  { kind: 'image', label: '图片画布', description: '图层、排版与合成' },
  { kind: 'video', label: '视频剪辑', description: '画面、声音与字幕' },
  { kind: 'audio', label: '音频制作', description: '声音时间线与混音' },
  { kind: 'ai-generation', label: 'AI 生成', description: '智能生成与加工' }
]

function dateLabel(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}
function errorText(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback
}
function artifactPath(id: string) {
  return `workspace-artifact:${id}`
}
function artifactFromPath(path: string) {
  return path.startsWith('workspace-artifact:') ? path.slice(19) : ''
}
function assetThumbnail(asset: WorkspaceAsset, revision = '0') {
  const id = artifactFromPath(asset.path)
  if (id) return apiUrl(`/workspace_artifacts/${encodeURIComponent(id)}/thumbnail?size=420`)
  if (asset.kind === 'image')
    return apiUrl(
      `/image-thumbnail?path=${encodeURIComponent(asset.path)}&size=420x420&t=${encodeURIComponent(revision)}`
    )
  if (asset.kind === 'video')
    return apiUrl(
      `/video_cover?path=${encodeURIComponent(asset.path)}&mt=${encodeURIComponent(revision)}`
    )
  return apiUrl(`/audio_cover?path=${encodeURIComponent(asset.path)}`)
}
function artifactThumbnail(id: string) {
  return apiUrl(`/workspace_artifacts/${encodeURIComponent(id)}/thumbnail?size=640`)
}
function workCover(
  work: WorkspaceWork,
  artifacts: WorkspaceArtifact[],
  revisions: Record<string, string>
) {
  const asset = [...work.outputs, ...work.assets].find((item) => item.kind !== 'audio')
  if (asset) return assetThumbnail(asset, revisions[asset.path])
  const recent = artifacts.find(
    (item) => work.drafts.some((draft) => draft.id === item.document_id) && item.kind !== 'audio'
  )
  return recent ? artifactThumbnail(recent.id) : ''
}

export interface WorkbenchPageProps {
  onOpenEditor?: (kind: EditorKind, draftId?: string) => void
}

export default function WorkbenchPage({ onOpenEditor }: WorkbenchPageProps) {
  const editorNavigation = useEditorNavigation()
  const [editorReturn] = useState(() => readWorkbenchEditorReturn(window.history.state))
  const returnDestination = useRef(editorReturn)
  const returnScroll = useRef(editorReturn?.scrollTop)
  const [records, setRecords] = useState<WorkspaceRecord[]>([])
  const recordsRef = useRef<WorkspaceRecord[]>([])
  const [globalSetting, setGlobalSetting] = useState<GlobalSetting>()
  const [overviews, setOverviews] = useState<Record<string, WorkspaceOverview>>({})
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(
    () =>
      editorReturn?.workspaceId ??
      localStorage.getItem('omnigallery:workbench-current-workspace') ??
      ''
  )
  const [screen, setScreen] = useState<Screen>(editorReturn?.screen ?? 'home')
  const [pageTab, setPageTab] = useState(editorReturn?.pageTab ?? 'workspace')
  const [configVisited, setConfigVisited] = useState(editorReturn?.pageTab === 'config')
  const workspaceRequest = useRef<AbortController>(null)
  const overviewRequest = useRef<AbortController>(null)
  useEffect(
    () => () => {
      workspaceRequest.current?.abort()
      overviewRequest.current?.abort()
    },
    []
  )
  const [statusView, setStatusView] = useState<WorkspaceStatus>(
    editorReturn?.statusView ?? 'active'
  )
  const [workspaceSort, setWorkspaceSort] = useWorkbenchSort('workspaces')
  const [workSort, setWorkSort] = useWorkbenchSort('works')
  const [worksState, setWorksState] = useState<WorkspaceWorkState>(emptyWorks)
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([])
  const [inputArtifacts, setInputArtifacts] = useState<WorkspaceArtifact[]>([])
  const [mediaRevisions, setMediaRevisions] = useState<Record<string, string>>({})
  const [mediaInfo, setMediaInfo] = useState<Record<string, FileNodeInfo>>({})
  const [materialsView, setMaterialsView] = useState<MaterialView>(
    editorReturn?.materialsView ?? 'all'
  )
  const [workTab, setWorkTab] = useState<WorkTab>(editorReturn?.workTab ?? 'drafts')
  const [draftFilter, setDraftFilter] = useState<ProductionKind | 'all'>(
    editorReturn?.draftFilter ?? 'all'
  )
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [workLoading, setWorkLoading] = useState(false)
  const [error, setError] = useState('')
  const [editDialog, setEditDialog] = useState<EditDialog | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [outputsOpen, setOutputsOpen] = useState(false)
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([])
  const [preview, setPreview] = useState<MediaFile | null>(null)
  const [draftCollection, setDraftCollection] = useState<{
    draft: ProductionDraft
    mode: 'materials' | 'artifacts'
  } | null>(null)
  const [collectionOwner, setCollectionOwner] = useState('all')
  const [syncArtifact, setSyncArtifact] = useState<WorkspaceArtifact | null>(null)
  const [syncRoot, setSyncRoot] = useState('')
  const [syncDirectory, setSyncDirectory] = useState('')
  const [syncFolders, setSyncFolders] = useState<string[]>([])
  const [syncBusy, setSyncBusy] = useState(false)
  const [artifactRename, setArtifactRename] = useState<WorkspaceArtifact | null>(null)
  const [artifactName, setArtifactName] = useState('')
  const [shownArtifacts, setShownArtifacts] = useState(60)
  const fileUploadRef = useRef<HTMLInputElement>(null)
  const [coverTarget, setCoverTarget] = useState('')
  const [savingCover, setSavingCover] = useState('')

  const readonly = !!globalSetting?.is_readonly
  const currentWorkspace = records.find((item) => item.id === currentWorkspaceId)
  const currentWork = worksState.works.find((item) => item.id === worksState.activeId)
  function captureEditorReturn(): WorkbenchEditorReturn {
    return {
      version: 1,
      workspaceId: currentWorkspaceId,
      workId: screen === 'work' ? (currentWork?.id ?? '') : '',
      screen,
      pageTab,
      statusView,
      materialsView,
      workTab,
      draftFilter,
      scrollTop: document.querySelector('.wb-frame .omni-page-body')?.scrollTop ?? 0
    }
  }
  useEffect(() => {
    if (loading || workLoading) return
    window.history.replaceState(
      workbenchEditorHistoryState(window.history.state, captureEditorReturn()),
      ''
    )
  }, [
    loading,
    workLoading,
    currentWorkspaceId,
    currentWork?.id,
    screen,
    pageTab,
    statusView,
    materialsView,
    workTab,
    draftFilter
  ])
  useEffect(() => {
    if (loading || workLoading || returnScroll.current === undefined) return
    const scrollTop = returnScroll.current
    returnScroll.current = undefined
    const frame = requestAnimationFrame(() => {
      document.querySelector('.wb-frame .omni-page-body')?.scrollTo({ top: scrollTop })
    })
    return () => cancelAnimationFrame(frame)
  }, [loading, workLoading])
  const createdAssets: WorkspaceAsset[] = useMemo(
    () =>
      artifacts.map((item) => ({ path: artifactPath(item.id), name: item.name, kind: item.kind })),
    [artifacts]
  )
  const materials = useMemo(
    () =>
      collectWorkspaceMaterials(
        currentWorkspace ?? { assets: [], outputs: [] },
        worksState.works,
        createdAssets
      ),
    [currentWorkspace, worksState, createdAssets]
  )
  const mediaPaths = materials
    .filter((item) => !artifactFromPath(item.path))
    .map((item) => item.path)
    .join('\u0000')
  useEffect(() => {
    const paths = mediaPaths ? mediaPaths.split('\u0000') : []
    if (!paths.length) {
      setMediaInfo({})
      setMediaRevisions({})
      return
    }
    let live = true
    const request = new AbortController()
    void apiFetch<Record<string, FileNodeInfo>>('/batch_get_files_info', {
      method: 'POST',
      signal: request.signal,
      body: JSON.stringify({ paths })
    })
      .then((result) => {
        if (live) setMediaInfo(result)
        if (live)
          setMediaRevisions(
            Object.fromEntries(
              Object.entries(result).map(([path, info]) => [path, info.date ?? '0'])
            )
          )
      })
      .catch(() => {
        if (live) setMediaRevisions({})
      })
    return () => {
      live = false
      request.abort()
    }
  }, [mediaPaths])
  const usedMaterials = useMemo(() => {
    if (!currentWorkspaceId || !currentWork) return []
    try {
      return collectWorkUsedAssets(
        currentWorkspaceId,
        currentWork,
        readWorkspaceState(currentWorkspaceId),
        materials
      )
    } catch {
      return []
    }
  }, [currentWorkspaceId, currentWork, materials])
  const usedMaterialPaths = useMemo(() => usedMaterials.map((item) => item.path), [usedMaterials])
  const visibleMaterials = useMemo(() => {
    if (materialsView !== 'used') return materials
    const used = new Set(usedMaterialPaths)
    return materials.filter((item) => used.has(item.path))
  }, [materials, materialsView, usedMaterialPaths])
  const sourceAssets = useMemo(
    () => materials.filter((item) => !artifactFromPath(item.path)),
    [materials]
  )
  const materialInfo = useMemo(() => {
    const info = { ...mediaInfo }
    const allArtifacts = [...artifacts, ...inputArtifacts]
    allArtifacts.forEach((artifact) => {
      const path = artifactPath(artifact.id)
      info[path] = {
        type: 'file',
        name: artifact.name,
        fullpath: path,
        size: formatFileSize(artifact.bytes),
        bytes: artifact.bytes,
        date: artifact.created_at,
        created_time: artifact.created_at,
        is_under_scanned_path: false,
        workspace_artifact_id: artifact.id,
        workspace_artifact_source: artifact.source,
        width: artifact.width,
        height: artifact.height
      }
    })
    return info
  }, [mediaInfo, artifacts, inputArtifacts])
  const previewFiles = useMemo(() => {
    const assets =
      preview && !materials.some((asset) => asset.path === preview.path)
        ? [preview, ...materials]
        : materials
    return assets.map((asset): PreviewFile => ({
      ...(materialInfo[asset.path] ?? {}),
      type: 'file',
      fullpath: asset.path,
      name: asset.name,
      date: materialInfo[asset.path]?.date ?? '',
      created_time: materialInfo[asset.path]?.created_time ?? '',
      bytes: materialInfo[asset.path]?.bytes ?? 0,
      size: materialInfo[asset.path]?.size ?? '',
      workspace_artifact_id: artifactFromPath(asset.path) || undefined
    }))
  }, [preview, materials, materialInfo])
  const roots = (globalSetting?.extra_paths ?? [])
    .filter((item) => item.types?.some((type) => type.startsWith('scanned')))
    .map((item) => ({
      value: item.path,
      label: item.alias ? `${item.alias} · ${item.path}` : item.path
    }))

  const refreshOverviews = useCallback(async (items: WorkspaceRecord[]) => {
    overviewRequest.current?.abort()
    const request = new AbortController()
    overviewRequest.current = request
    if (!items.length) {
      setOverviews({})
      return
    }
    try {
      const query = new URLSearchParams()
      items.forEach((item) => query.append('workspace_ids', item.id))
      const result = await apiFetch<WorkspaceOverview[]>(`/workspace_overviews?${query}`, {
        signal: request.signal
      })
      if (request.signal.aborted) return
      setOverviews(Object.fromEntries(result.map((item) => [item.workspace_id, item])))
    } catch {
      if (!request.signal.aborted) setOverviews({})
    }
  }, [])

  const refreshWorkspace = useCallback(async (id: string, readOnly = false, reload = false) => {
    workspaceRequest.current?.abort()
    const request = new AbortController()
    workspaceRequest.current = request
    setWorkLoading(true)
    try {
      const [state, result, inputs] = await Promise.all([
        reload ? reloadWorkspaceWorks(id, readOnly) : loadWorkspaceWorks(id, readOnly),
        apiFetch<WorkspaceArtifact[]>(
          `/workspace_artifacts?workspace_id=${encodeURIComponent(id)}`,
          { signal: request.signal }
        ),
        apiFetch<WorkspaceArtifact[]>(`/workspace_inputs?workspace_id=${encodeURIComponent(id)}`, {
          signal: request.signal
        })
      ])
      if (request.signal.aborted) return
      const origin = returnDestination.current
      const destination = origin
        ? workbenchEditorDestination(
            origin,
            id,
            state.works.map((item) => item.id)
          )
        : null
      const rememberedWork = sessionStorage.getItem(activeWorkKey)
      const workId = destination
        ? destination.workId
        : rememberedWork?.startsWith(`${id}:`)
          ? rememberedWork.slice(id.length + 1)
          : ''
      const work = state.works.find((item) => item.id === workId)
      setWorksState(work ? { ...state, activeId: work.id } : state)
      if (destination) {
        returnDestination.current = null
        setScreen(destination.screen)
        if (work) sessionStorage.setItem(activeWorkKey, `${id}:${work.id}`)
        else sessionStorage.removeItem(activeWorkKey)
      } else if (work) setScreen('work')
      else if (rememberedWork) sessionStorage.removeItem(activeWorkKey)
      setArtifacts(result.filter((item) => !item.input_owner))
      setInputArtifacts(inputs)
      setError('')
    } catch (cause) {
      if (!request.signal.aborted) setError(errorText(cause, '无法读取工作区，请重试'))
    } finally {
      if (!request.signal.aborted) setWorkLoading(false)
    }
  }, [])

  useEffect(() => {
    let live = true
    setLoading(true)
    void apiFetch<GlobalSetting>('/global_setting')
      .then((setting) => {
        if (!live) return
        const items = readWorkspaceRecords(setting.app_fe_setting?.workbench_projects)
        recordsRef.current = items
        setRecords(items)
        setGlobalSetting(setting)
        void refreshOverviews(items)
        if (currentWorkspaceId && items.some((item) => item.id === currentWorkspaceId)) {
          if (!returnDestination.current) setScreen('workspace')
          localStorage.setItem('omnigallery:workbench-current-workspace', currentWorkspaceId)
          void refreshWorkspace(currentWorkspaceId, !!setting.is_readonly)
        } else if (currentWorkspaceId) {
          setCurrentWorkspaceId('')
          setScreen('home')
          returnDestination.current = null
          localStorage.removeItem('omnigallery:workbench-current-workspace')
        }
      })
      .catch((cause) => {
        if (live) setError(errorText(cause, '工作台无法读取'))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!currentWorkspaceId) return
    return subscribeWorkspaceState(currentWorkspaceId, () => {
      try {
        setWorksState(
          createWorkspaceWorksRepository(
            currentWorkspaceId,
            readWorkspaceState(currentWorkspaceId)
          ).load()
        )
      } catch {
        /* The active load will report any damaged state. */
      }
    })
  }, [currentWorkspaceId])

  async function saveRecords(next: WorkspaceRecord[]) {
    if (readonly) throw new Error('只读模式不能修改工作区')
    await apiFetch<void>('/app_fe_setting', {
      method: 'POST',
      body: JSON.stringify({
        name: 'workbench_projects',
        value: JSON.stringify({ version: 2, items: next })
      })
    })
    recordsRef.current = next
    setRecords(next)
    setGlobalSetting((current) =>
      current
        ? {
            ...current,
            app_fe_setting: {
              ...current.app_fe_setting,
              workbench_projects: { version: 2, items: next }
            }
          }
        : current
    )
    void refreshOverviews(next)
  }

  async function commitWork<T>(operation: (storage: Storage, current: WorkspaceWorkState) => T) {
    if (!currentWorkspaceId || readonly) throw new Error('当前工作区不可编辑')
    const changed = await changeWorkspaceWorks(currentWorkspaceId, operation)
    setWorksState(changed.state)
    void refreshOverviews(recordsRef.current)
    return changed.result
  }

  async function run(operation: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(errorText(cause, '保存失败，请重试'))
    } finally {
      setBusy(false)
    }
  }

  function selectWorkspace(id: string) {
    setCurrentWorkspaceId(id)
    localStorage.setItem('omnigallery:workbench-current-workspace', id)
    sessionStorage.removeItem(activeWorkKey)
    setWorksState(emptyWorks)
    setArtifacts([])
    setInputArtifacts([])
    setScreen('workspace')
    setWorkTab('drafts')
    setMaterialsView('all')
    void refreshWorkspace(id, readonly)
  }
  async function openWorkspace(item: WorkspaceRecord) {
    if (!readonly) {
      const now = new Date().toISOString()
      await saveRecords(
        recordsRef.current.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: 'active',
                lastOpenedAt: now,
                updatedAt: row.status === 'paused' ? now : row.updatedAt
              }
            : row
        )
      )
    }
    selectWorkspace(item.id)
  }
  function toHome() {
    workspaceRequest.current?.abort()
    setWorkLoading(false)
    setScreen('home')
    setCurrentWorkspaceId('')
    localStorage.removeItem('omnigallery:workbench-current-workspace')
    sessionStorage.removeItem(activeWorkKey)
    setWorksState(emptyWorks)
    setArtifacts([])
    setInputArtifacts([])
  }
  function toWorkspace() {
    setScreen('workspace')
    sessionStorage.removeItem(activeWorkKey)
  }
  async function openWork(work: WorkspaceWork, enterEditor = false) {
    const origin = enterEditor ? captureEditorReturn() : undefined
    if (readonly) setWorksState((current) => ({ ...current, activeId: work.id }))
    else
      await commitWork((storage, current) => {
        if (!current.works.some((item) => item.id === work.id)) throw new Error('作品已不存在')
        createWorkspaceWorksRepository(currentWorkspaceId, storage).save({
          ...current,
          activeId: work.id,
          works: current.works.map((item) =>
            item.id === work.id ? { ...item, lastOpenedAt: new Date().toISOString() } : item
          )
        })
      })
    setScreen('work')
    sessionStorage.setItem(activeWorkKey, `${currentWorkspaceId}:${work.id}`)
    setWorkTab('drafts')
    setMaterialsView('all')
    if (enterEditor) {
      const draft = work.drafts.find((item) => item.id === work.activeDraftId) ?? work.drafts[0]
      if (draft) await openDraft(draft, work, origin)
    }
  }
  async function openDraft(
    draft: ProductionDraft,
    work = currentWork,
    origin = captureEditorReturn()
  ) {
    if (!work) return
    if (readonly)
      setWorksState((current) => ({
        ...current,
        activeId: work.id,
        works: current.works.map((item) =>
          item.id === work.id ? { ...item, activeDraftId: draft.id } : item
        )
      }))
    else
      await commitWork((storage, current) => {
        const latest = current.works.find((item) => item.id === work.id)
        if (!latest?.drafts.some((item) => item.id === draft.id))
          throw new Error('制作文件已不存在')
        createWorkspaceWorksRepository(currentWorkspaceId, storage).save({
          ...current,
          activeId: work.id,
          works: current.works.map((item) =>
            item.id === work.id
              ? {
                  ...item,
                  activeDraftId: draft.id,
                  lastTool: draftTool(draft.kind),
                  lastOpenedAt: new Date().toISOString()
                }
              : item
          )
        })
      })
    const kind: EditorKind = draft.kind === 'ai' ? 'ai-image' : draft.kind
    sessionStorage.setItem(activeWorkKey, `${currentWorkspaceId}:${work.id}`)
    window.history.replaceState(workbenchEditorHistoryState(window.history.state, origin), '')
    ;(onOpenEditor ?? editorNavigation.openEditor)(kind, draft.id)
  }

  function editWorkspace(item?: WorkspaceRecord) {
    setError('')
    setEditDialog({
      entity: 'workspace',
      id: item?.id,
      newId: item ? undefined : crypto.randomUUID(),
      name: item?.name ?? '',
      brief: item?.brief ?? '',
      color: item?.color
    })
  }
  function editWork(item?: WorkspaceWork) {
    setError('')
    setEditDialog({
      entity: 'work',
      id: item?.id,
      newId: item ? undefined : crypto.randomUUID(),
      name: item?.name ?? '',
      brief: item?.brief ?? '',
      color: item?.color
    })
  }
  function editDraft(item?: ProductionDraft, kind?: DraftChoice) {
    setError('')
    setEditDialog({
      entity: 'draft',
      id: item?.id,
      name: item?.name ?? '',
      brief: item?.brief ?? '',
      kind: kind ?? (item?.kind === 'ai' ? 'ai-generation' : (item?.kind ?? 'image'))
    })
  }

  async function saveEdit(dialog: EditDialog) {
    const name = dialog.name.trim()
    if (!name) {
      setError('请填写名称')
      return
    }
    const color = readWorkspaceColor(dialog.color)
    if (dialog.entity !== 'draft' && dialog.color && !color) {
      setError('请选择有效颜色')
      return
    }
    await run(async () => {
      const now = new Date().toISOString()
      if (dialog.entity === 'workspace') {
        if (!dialog.id && recordsRef.current.length >= 100) throw new Error('工作区数量已达到上限')
        const next = dialog.id
          ? recordsRef.current.map((item) =>
              item.id === dialog.id
                ? { ...item, name, brief: dialog.brief.trim(), color, updatedAt: now }
                : item
            )
          : [
              {
                id: dialog.newId ?? crypto.randomUUID(),
                name,
                brief: dialog.brief.trim(),
                color,
                status: 'active' as const,
                createdAt: now,
                updatedAt: now,
                lastTool: 'image' as const,
                assets: [],
                outputs: [],
                notes: {}
              },
              ...recordsRef.current
            ]
        await saveRecords(next)
        setStatusView('active')
      } else if (dialog.entity === 'work') {
        if (!currentWorkspaceId) throw new Error('请选择工作区')
        await commitWork((storage, current) => {
          if (!dialog.id && current.works.length >= 200) throw new Error('作品数量已达到上限')
          const newWork = {
            ...createWorkspaceWork(name, dialog.newId),
            brief: dialog.brief.trim(),
            color
          }
          createWorkspaceWorksRepository(currentWorkspaceId, storage).save(
            dialog.id
              ? {
                  ...current,
                  works: current.works.map((item) =>
                    item.id === dialog.id
                      ? { ...item, name, brief: dialog.brief.trim(), color, updatedAt: now }
                      : item
                  )
                }
              : { ...current, activeId: newWork.id, works: [newWork, ...current.works] }
          )
        })
        if (!dialog.id) setScreen('work')
      } else {
        const work = currentWork
        if (!work || !currentWorkspaceId) throw new Error('请选择作品')
        const choice = dialog.kind ?? 'image'
        const kind: ProductionKind = choice === 'ai-generation' ? 'ai' : choice
        let createdDraft: ProductionDraft | undefined
        await commitWork((storage, current) => {
          const latest = current.works.find((item) => item.id === work.id)
          if (!latest) throw new Error('作品已不存在')
          if (dialog.id) {
            const previous = latest.drafts.find((item) => item.id === dialog.id)
            if (!previous) throw new Error('制作文件已不存在')
            if (previous.kind === 'image')
              createWorkspaceDraftRepository(currentWorkspaceId, storage).rename(previous.id, name)
            const reloaded = createWorkspaceWorksRepository(currentWorkspaceId, storage).load()
            createWorkspaceWorksRepository(currentWorkspaceId, storage).save({
              ...reloaded,
              works: reloaded.works.map((item) =>
                item.id === work.id
                  ? {
                      ...item,
                      drafts: item.drafts.map((draft) =>
                        draft.id === dialog.id
                          ? { ...draft, name, brief: dialog.brief.trim(), updatedAt: now }
                          : draft
                      )
                    }
                  : item
              )
            })
          } else {
            if (latest.drafts.length >= 200) throw new Error('制作文件数量已达到上限')
            const draft = {
              ...createProductionDraft(kind, name),
              brief: dialog.brief.trim(),
              ...(choice === 'ai-generation' ? { aiPurpose: 'image_generation' as const } : {})
            }
            createdDraft = draft
            if (kind === 'image') {
              const document = createStudioDocument(name)
              document.id = draft.id
              const imageRepo = createWorkImageDraftRepository(currentWorkspaceId, work.id, storage)
              const index = imageRepo.loadIndex()
              if (!index || index.docs.length >= 100) throw new Error('图片制作文件数量已达到上限')
              imageRepo.save(document, {
                ...index,
                activeId: document.id,
                docs: [...index.docs, { id: document.id, name, updatedAt: document.updatedAt }]
              })
            }
            const reloaded = createWorkspaceWorksRepository(currentWorkspaceId, storage).load()
            createWorkspaceWorksRepository(currentWorkspaceId, storage).save({
              ...reloaded,
              works: reloaded.works.map((item) =>
                item.id === work.id
                  ? {
                      ...item,
                      drafts:
                        kind === 'image'
                          ? item.drafts.map((existing) =>
                              existing.id === draft.id ? draft : existing
                            )
                          : [...item.drafts, draft],
                      activeDraftId: draft.id,
                      lastTool: draftTool(kind),
                      updatedAt: now
                    }
                  : item
              )
            })
          }
        })
        if (createdDraft) {
          setEditDialog(null)
          await openDraft(createdDraft, work)
        }
      }
      setEditDialog(null)
    })
  }

  function askRemoveWorkspace(item: WorkspaceRecord) {
    setConfirmDialog({
      title: `删除工作区“${item.name}”？`,
      message: '这会删除工作区记录、作品、制作文件与工作区产物。已同步到媒体库的文件会保留。',
      action: async () => {
        await saveRecords(recordsRef.current.filter((row) => row.id !== item.id))
        if (currentWorkspaceId === item.id) toHome()
        await deleteWorkspaceWorks(item.id)
        await apiFetch<void>(`/workspace_artifacts?workspace_id=${encodeURIComponent(item.id)}`, {
          method: 'DELETE'
        })
      }
    })
  }
  function askRemoveWork(work: WorkspaceWork) {
    setConfirmDialog({
      title: `删除作品“${work.name}”？`,
      message: '作品与其中的制作文件将被删除。原素材及已保存的成果文件会保留。',
      action: async () => {
        let aiDraftIds: string[] = []
        await commitWork((storage, current) => {
          const latest = current.works.find((item) => item.id === work.id)
          if (!latest) throw new Error('作品已不存在')
          aiDraftIds = latest.drafts.filter((draft) => draft.kind === 'ai').map((draft) => draft.id)
          const images = createWorkspaceDraftRepository(currentWorkspaceId, storage)
          for (const draft of latest.drafts) {
            if (draft.kind === 'image') images.deleteEntry(draft.id)
            if (draft.kind === 'ai')
              removeWorkspaceAIDrafts(storage, `${currentWorkspaceId}:${work.id}:${draft.id}`)
            if (draft.kind === 'audio')
              storage.removeItem(audioTimelineKey(currentWorkspaceId, draft.id))
            if (draft.kind === 'video')
              storage.removeItem(`omnigallery:video-timeline-v1:${currentWorkspaceId}:${draft.id}`)
          }
          createWorkspaceWorksRepository(currentWorkspaceId, storage).save({
            ...current,
            activeId: current.activeId === work.id ? '' : current.activeId,
            works: current.works.filter((item) => item.id !== work.id)
          })
        })
        setScreen('workspace')
        sessionStorage.removeItem(activeWorkKey)
        if (aiDraftIds.length) {
          const cleanup = await Promise.allSettled(
            aiDraftIds.map((draftId) =>
              apiFetch<void>(
                `/workspace_inputs?workspace_id=${encodeURIComponent(currentWorkspaceId)}&production_id=${encodeURIComponent(draftId)}`,
                { method: 'DELETE' }
              )
            )
          )
          if (cleanup.some((result) => result.status === 'rejected'))
            setError('作品已删除，部分 AI 输入快照暂未清理')
        }
      }
    })
  }
  function askRemoveDraft(draft: ProductionDraft) {
    const work = currentWork
    if (!work) return
    setConfirmDialog({
      title: `删除制作文件“${draft.name}”？`,
      message: '仅删除这份制作文件，作品、原素材和已保存的产物会保留。',
      action: async () => {
        await commitWork((storage, current) => {
          const latest = current.works.find((item) => item.id === work.id)
          if (!latest?.drafts.some((item) => item.id === draft.id))
            throw new Error('制作文件已不存在')
          if (draft.kind === 'image')
            createWorkImageDraftRepository(currentWorkspaceId, work.id, storage).remove(draft.id)
          else {
            createWorkspaceWorksRepository(currentWorkspaceId, storage).save({
              ...current,
              works: current.works.map((item) =>
                item.id === work.id
                  ? {
                      ...item,
                      drafts: item.drafts.filter((row) => row.id !== draft.id),
                      activeDraftId: item.activeDraftId === draft.id ? '' : item.activeDraftId
                    }
                  : item
              )
            })
            if (draft.kind === 'ai')
              removeWorkspaceAIDrafts(storage, `${currentWorkspaceId}:${work.id}:${draft.id}`)
            if (draft.kind === 'audio')
              storage.removeItem(audioTimelineKey(currentWorkspaceId, draft.id))
            if (draft.kind === 'video')
              storage.removeItem(`omnigallery:video-timeline-v1:${currentWorkspaceId}:${draft.id}`)
          }
        })
        if (draft.kind === 'ai')
          await apiFetch<void>(
            `/workspace_inputs?workspace_id=${encodeURIComponent(currentWorkspaceId)}&production_id=${encodeURIComponent(draft.id)}`,
            { method: 'DELETE' }
          )
      }
    })
  }

  async function saveCover(file: File | null, targetId: string) {
    if (!file || !targetId) return
    if (file.size > 50 * 1024 * 1024) {
      setError('请选择 50 MB 以内的图片')
      return
    }
    setSavingCover(targetId)
    try {
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.onerror = () => reject(new Error('图片读取失败'))
        reader.readAsDataURL(file)
      })
      const result = await apiFetch<{ version: string }>(
        `/workspace_covers/${encodeURIComponent(targetId)}`,
        {
          method: 'POST',
          body: JSON.stringify({ image_base64: imageBase64 })
        }
      )
      await saveRecords(
        recordsRef.current.map((item) =>
          item.id === targetId ? { ...item, cover: result.version } : item
        )
      )
    } catch (cause) {
      setError(errorText(cause, '封面保存失败'))
    } finally {
      setSavingCover('')
    }
  }

  async function toggleWorkspace(item: WorkspaceRecord) {
    await run(async () => {
      const status: WorkspaceStatus = item.status === 'active' ? 'paused' : 'active'
      await saveRecords(
        recordsRef.current.map((row) =>
          row.id === item.id ? { ...row, status, updatedAt: new Date().toISOString() } : row
        )
      )
    })
  }
  async function addMaterials(incoming: WorkspaceAsset[]) {
    if (!currentWorkspace) throw new Error('请选择工作区')
    const updated = {
      ...currentWorkspace,
      assets: addWorkspaceAssets(currentWorkspace.assets, incoming),
      updatedAt: new Date().toISOString()
    }
    await saveRecords(
      recordsRef.current.map((item) => (item.id === currentWorkspace.id ? updated : item))
    )
  }
  async function removeMaterial(path: string) {
    if (!currentWorkspace) return
    await run(async () => {
      await saveRecords(
        recordsRef.current.map((item) =>
          item.id === currentWorkspace.id
            ? {
                ...item,
                assets: item.assets.filter((asset) => asset.path !== path),
                outputs: item.outputs.filter((asset) => asset.path !== path),
                updatedAt: new Date().toISOString()
              }
            : item
        )
      )
      if (worksState.works.some((work) => work.assets.some((asset) => asset.path === path))) {
        await commitWork((storage, current) =>
          createWorkspaceWorksRepository(currentWorkspaceId, storage).save({
            ...current,
            works: current.works.map((work) => ({
              ...work,
              assets: work.assets.filter((asset) => asset.path !== path)
            }))
          })
        )
      }
    })
  }
  async function saveOutputs() {
    const work = currentWork
    if (!work) return
    await run(async () => {
      const selected = new Set(selectedOutputs)
      await commitWork((storage, current) => {
        const latest = current.works.find((item) => item.id === work.id)
        if (!latest) throw new Error('作品已不存在')
        const available = new Set(createdAssets.map((item) => item.path))
        const outputs = [
          ...latest.outputs.filter((item) => !available.has(item.path)),
          ...createdAssets.filter((item) => selected.has(item.path))
        ]
        createWorkspaceWorksRepository(currentWorkspaceId, storage).save({
          ...current,
          works: current.works.map((item) =>
            item.id === work.id ? { ...item, outputs, updatedAt: new Date().toISOString() } : item
          )
        })
      })
      setOutputsOpen(false)
    })
  }
  async function removeOutput(path: string) {
    const work = currentWork
    if (!work) return
    await run(async () => {
      await commitWork((storage, current) =>
        createWorkspaceWorksRepository(currentWorkspaceId, storage).save({
          ...current,
          works: current.works.map((item) =>
            item.id === work.id
              ? { ...item, outputs: item.outputs.filter((asset) => asset.path !== path) }
              : item
          )
        })
      )
    })
  }
  async function refreshArtifacts() {
    if (!currentWorkspaceId) return
    const result = await apiFetch<WorkspaceArtifact[]>(
      `/workspace_artifacts?workspace_id=${encodeURIComponent(currentWorkspaceId)}`
    )
    setArtifacts(result.filter((item) => !item.input_owner))
  }
  async function exportImageDraft(draft: ProductionDraft) {
    await run(async () => {
      const document = createWorkspaceDraftRepository(
        currentWorkspaceId,
        readWorkspaceState(currentWorkspaceId)
      ).loadDocument(draft.id)
      if (!document) throw new Error('制作文档不可用，请进入编辑器核对')
      const exportDocument = studioExportDocument(document, true)
      const blob = await exportStudioBlob(exportDocument, materialInfo)
      await apiFetch('/workspace_artifacts', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: currentWorkspaceId,
          name: `${document.name || draft.name}.png`,
          source: 'image_studio',
          format: 'png',
          image_base64: await blobToBase64(blob),
          document_id: draft.id,
          document_revision: studioDocumentRevision(exportDocument)
        })
      })
      await refreshArtifacts()
    })
  }
  async function renameArtifact() {
    const item = artifactRename
    if (!item || !artifactName.trim()) return
    await run(async () => {
      await apiFetch(`/workspace_artifacts/${encodeURIComponent(item.id)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: artifactName.trim() })
      })
      await refreshArtifacts()
      setArtifactRename(null)
    })
  }
  function askRemoveArtifact(item: WorkspaceArtifact) {
    setConfirmDialog({
      title: `删除产物“${item.name}”？`,
      message: '此产物会永久删除；已同步到媒体库的副本保留。引用它的制作文件可能显示素材不可用。',
      action: async () => {
        await apiFetch<void>(`/workspace_artifacts/${encodeURIComponent(item.id)}`, {
          method: 'DELETE'
        })
        await refreshArtifacts()
      }
    })
  }

  async function browseDirectory(path: string) {
    setSyncDirectory(path)
    setSyncBusy(true)
    try {
      const result = await apiFetch<{ files: { fullpath: string; type: string }[] }>(
        `/files?folder_path=${encodeURIComponent(path)}&directories_only=true`
      )
      setSyncFolders(
        result.files.filter((item) => item.type === 'dir').map((item) => item.fullpath)
      )
    } catch (cause) {
      setError(errorText(cause, '目录读取失败'))
      setSyncFolders([])
    } finally {
      setSyncBusy(false)
    }
  }
  async function syncOutput(overwriteMediaId?: number, target = syncArtifact) {
    if (!target || !currentWork || (!overwriteMediaId && !syncDirectory)) return
    setSyncBusy(true)
    try {
      await apiFetch(`/workspace_artifacts/${encodeURIComponent(target.id)}/sync`, {
        method: 'POST',
        body: JSON.stringify({
          work_id: currentWork.id,
          directory: overwriteMediaId ? '' : syncDirectory,
          overwrite_media_id: overwriteMediaId
        })
      })
      await refreshArtifacts()
      setSyncArtifact(null)
    } catch (cause) {
      setError(errorText(cause, '同步到媒体库失败'))
    } finally {
      setSyncBusy(false)
    }
  }

  const visibleWorkspaces = useMemo(
    () =>
      sortWorkbenchCards(
        records.filter((item) => item.status === statusView),
        workspaceSort
      ),
    [records, statusView, workspaceSort]
  )
  const recentWorkspaceId = useMemo(
    () =>
      sortWorkbenchCards(
        records.filter((item) => item.status === statusView && item.lastOpenedAt),
        'recent'
      )[0]?.id,
    [records, statusView]
  )
  const visibleWorks = useMemo(
    () => sortWorkbenchCards(worksState.works, workSort),
    [worksState.works, workSort]
  )
  const filteredDrafts = (currentWork?.drafts ?? []).filter(
    (item) => draftFilter === 'all' || item.kind === draftFilter
  )
  const artifactsForDraft = (draft: ProductionDraft) =>
    artifacts
      .filter(
        (item) =>
          item.document_id === draft.id ||
          (draft.kind === 'image' &&
            item.lineage &&
            'documentId' in item.lineage &&
            item.lineage.documentId === draft.id)
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at))

  if (loading) return <PageState pageTitle="工作台" loading title="正在载入工作台…" />
  return (
    <PageFrame
      className="wb-frame"
      scrollKey={`${pageTab}:${screen}`}
      header={
        <header className="wb-topbar">
          <nav className="wb-location" aria-label="工作台位置">
            <UnstyledButton
              className="wb-crumb wb-crumb-root"
              aria-current={pageTab === 'workspace' && !currentWorkspace ? 'page' : undefined}
              disabled={busy}
              onClick={() => {
                setPageTab('workspace')
                toHome()
              }}
            >
              <IconLayoutGrid size={20} />
              <span>工作台</span>
            </UnstyledButton>
            {pageTab === 'config' ? (
              <>
                <IconChevronRight size={15} aria-hidden />
                <Text component="span" className="wb-crumb-current" aria-current="page">
                  工具配置
                </Text>
              </>
            ) : currentWorkspace && screen !== 'home' ? (
              <>
                <IconChevronRight size={15} aria-hidden />
                {screen === 'work' && currentWork ? (
                  <>
                    <UnstyledButton
                      className="wb-crumb wb-crumb-parent"
                      aria-label={`返回工作区：${currentWorkspace.name}`}
                      title={currentWorkspace.name}
                      disabled={busy}
                      onClick={toWorkspace}
                    >
                      <span>{currentWorkspace.name}</span>
                    </UnstyledButton>
                    <IconChevronRight size={15} aria-hidden />
                    <Text
                      component="span"
                      className="wb-crumb-current"
                      aria-current="page"
                      title={currentWork.name}
                    >
                      {currentWork.name}
                    </Text>
                  </>
                ) : (
                  <Text
                    component="span"
                    className="wb-crumb-current"
                    aria-current="page"
                    title={currentWorkspace.name}
                  >
                    {currentWorkspace.name}
                  </Text>
                )}
              </>
            ) : null}
          </nav>
          <Tooltip label={pageTab === 'config' ? '返回配置前的工作台页面' : '配置制作工作流与参数'}>
            <Button
              className="wb-tool-config-button"
              variant={pageTab === 'config' ? 'light' : 'subtle'}
              vars={() => ({
                root: {
                  '--button-color': 'var(--omni-ink)',
                  '--button-bg': pageTab === 'config' ? 'var(--omni-nav-selected)' : 'transparent',
                  '--button-hover': 'var(--omni-surface-soft)'
                }
              })}
              size="compact-sm"
              leftSection={<IconTools size={18} />}
              aria-expanded={pageTab === 'config'}
              aria-controls="wb-tool-config"
              disabled={busy}
              onClick={() => {
                setConfigVisited(true)
                setPageTab((value) => (value === 'config' ? 'workspace' : 'config'))
              }}
            >
              工具配置
            </Button>
          </Tooltip>
        </header>
      }
    >
      <div className="wb-page">
        <div className="wb-shell">
          <div
            id="wb-tool-config"
            hidden={pageTab !== 'config'}
            className="wb-tool-config"
            role="region"
            aria-label="工具配置"
          >
            {configVisited && (
              <Suspense
                fallback={
                  <Center py="xl" role="status" aria-label="正在加载工具配置">
                    <Loader size="sm" />
                  </Center>
                }
              >
                <WorkflowSettings />
              </Suspense>
            )}
          </div>
          <div hidden={pageTab !== 'workspace'} role="region" aria-label="工作区">
            {error && (
              <Alert
                color="red"
                title="操作未完成"
                withCloseButton
                onClose={() => setError('')}
                mb="md"
              >
                {error}
              </Alert>
            )}
            {screen === 'home' || !currentWorkspace ? (
              <div className="wb-enter wb-home" key="home">
                <div className="wb-section-head wb-home-hero">
                  <WorkbenchSkyBackdrop active={pageTab === 'workspace'} />
                  <div className="wb-home-copy">
                    <Title order={1}>你的创作空间</Title>
                    <Text size="sm">将多个作品和素材整理在同一创作任务中。</Text>
                  </div>
                  <Button
                    leftSection={<IconPlus size={17} />}
                    onClick={() => editWorkspace()}
                    disabled={readonly || busy}
                  >
                    新建工作区
                  </Button>
                </div>
                <div className="wb-list-toolbar">
                  <SegmentedControl
                    aria-label="工作区状态"
                    value={statusView}
                    onChange={(value) => setStatusView(value as WorkspaceStatus)}
                    data={[
                      {
                        value: 'active',
                        label: `进行中 ${records.filter((item) => item.status === 'active').length}`
                      },
                      {
                        value: 'paused',
                        label: `已搁置 ${records.filter((item) => item.status === 'paused').length}`
                      }
                    ]}
                  />
                  <WorkbenchSortControl
                    label="工作区"
                    value={workspaceSort}
                    onChange={setWorkspaceSort}
                  />
                </div>
                {visibleWorkspaces.length ? (
                  <SimpleGrid
                    className="wb-item-grid"
                    cols={{ base: 1, sm: 2, lg: 3 }}
                    spacing="lg"
                  >
                    {visibleWorkspaces.map((item) => {
                      const overview = overviews[item.id]
                      const covers = item.cover
                        ? [
                            apiUrl(
                              `/workspace_covers/${encodeURIComponent(item.id)}/${encodeURIComponent(item.cover)}`
                            )
                          ]
                        : (overview?.preview_artifacts ?? []).slice(0, 3).map(artifactThumbnail)
                      return (
                        <Card
                          className="wb-workspace-card"
                          {...workbenchAccentProps(item.id, item.color)}
                          key={item.id}
                          padding={0}
                          radius={8}
                          withBorder
                        >
                          <UnstyledButton
                            className="wb-workspace-main"
                            onClick={() => void run(() => openWorkspace(item))}
                            aria-label={`进入工作区：${item.name}`}
                          >
                            <div className="wb-workspace-cover">
                              {covers.length ? (
                                <div
                                  className={`wb-cover-collage ${covers.length > 1 ? 'is-multiple' : ''}`}
                                >
                                  {covers.map((url) => (
                                    <img key={url} src={url} alt="" loading="lazy" />
                                  ))}
                                </div>
                              ) : (
                                <div className="wb-cover-placeholder">
                                  <IconFolders size={48} stroke={1.1} />
                                  <span>{item.name.slice(0, 2)}</span>
                                </div>
                              )}
                              {statusView === 'active' && item.id === recentWorkspaceId && (
                                <Badge
                                  className="wb-cover-badge"
                                  variant="filled"
                                  color="dark"
                                  size="sm"
                                >
                                  最近使用
                                </Badge>
                              )}
                            </div>
                            <div className="wb-workspace-copy">
                              <Text fw={750} size="lg" lineClamp={1}>
                                {item.name}
                              </Text>
                              <Text size="sm" c="dimmed" lineClamp={2}>
                                {overview?.recent_work?.name ||
                                  item.brief ||
                                  '从这里开始一个新作品'}
                              </Text>
                              <Group gap={6} mt="md">
                                <Badge variant="light" className="wb-metric-badge">
                                  {overview?.work_count ?? 0} 个作品
                                </Badge>
                                <Badge variant="light" className="wb-metric-badge">
                                  {overview?.draft_count ?? 0} 个制作文件
                                </Badge>
                              </Group>
                            </div>
                          </UnstyledButton>
                          <div className="wb-card-footer">
                            <Button
                              variant="subtle"
                              rightSection={<IconArrowRight size={16} />}
                              onClick={() =>
                                void run(async () => {
                                  await openWorkspace(item)
                                  const recent = overview?.recent_work
                                  if (recent) {
                                    const state = await loadWorkspaceWorks(item.id, readonly)
                                    const work = state.works.find((entry) => entry.id === recent.id)
                                    if (work) {
                                      if (readonly) setWorksState({ ...state, activeId: work.id })
                                      else {
                                        const opened = await changeWorkspaceWorks(
                                          item.id,
                                          (storage, current) => {
                                            if (
                                              !current.works.some((entry) => entry.id === work.id)
                                            )
                                              throw new Error('作品已不存在')
                                            createWorkspaceWorksRepository(item.id, storage).save({
                                              ...current,
                                              activeId: work.id,
                                              works: current.works.map((entry) =>
                                                entry.id === work.id
                                                  ? {
                                                      ...entry,
                                                      lastOpenedAt: new Date().toISOString()
                                                    }
                                                  : entry
                                              )
                                            })
                                          }
                                        )
                                        setWorksState(opened.state)
                                      }
                                      setScreen('work')
                                      sessionStorage.setItem(activeWorkKey, `${item.id}:${work.id}`)
                                    }
                                  }
                                })
                              }
                            >
                              {overview?.recent_work ? '继续创作' : '进入工作区'}
                            </Button>
                            <WorkbenchCardDate item={item} order={workspaceSort} />
                          </div>
                          <Menu shadow="md" width={210} position="bottom-end">
                            <Menu.Target>
                              <ActionIcon
                                className="wb-workspace-menu"
                                variant="light"
                                color="gray"
                                aria-label={`工作区操作：${item.name}`}
                              >
                                <IconDots size={18} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              <Menu.Item onClick={() => editWorkspace(item)} disabled={readonly}>
                                修改信息
                              </Menu.Item>
                              <Menu.Item
                                onClick={() => {
                                  setCoverTarget(item.id)
                                  fileUploadRef.current?.click()
                                }}
                                disabled={readonly || !!savingCover}
                              >
                                {item.cover ? '更换封面' : '上传封面'}
                              </Menu.Item>
                              {item.cover && (
                                <Menu.Item
                                  onClick={() =>
                                    void run(() =>
                                      saveRecords(
                                        recordsRef.current.map((row) =>
                                          row.id === item.id ? { ...row, cover: undefined } : row
                                        )
                                      )
                                    )
                                  }
                                  disabled={readonly}
                                >
                                  恢复自动封面
                                </Menu.Item>
                              )}
                              <Menu.Divider />
                              <Menu.Item
                                onClick={() => void toggleWorkspace(item)}
                                disabled={readonly}
                              >
                                {item.status === 'active' ? '搁置工作区' : '恢复工作区'}
                              </Menu.Item>
                              <Menu.Item
                                color="red"
                                onClick={() => askRemoveWorkspace(item)}
                                disabled={readonly}
                              >
                                删除工作区
                              </Menu.Item>
                            </Menu.Dropdown>
                          </Menu>
                        </Card>
                      )
                    })}
                  </SimpleGrid>
                ) : (
                  <EmptyState
                    icon={<IconFolders size={28} />}
                    title={statusView === 'active' ? '还没有进行中的工作区' : '没有已搁置的工作区'}
                    description={
                      statusView === 'active'
                        ? '先创建工作区，再开始组织作品和素材。'
                        : '搁置的工作区会出现在这里。'
                    }
                    action={
                      statusView === 'active' && !readonly ? (
                        <Button
                          leftSection={<IconPlus size={16} />}
                          onClick={() => editWorkspace()}
                        >
                          新建工作区
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              </div>
            ) : screen === 'workspace' ? (
              <div className="wb-enter wb-workspace" key={`workspace-${currentWorkspace.id}`}>
                <section
                  className="wb-hero"
                  {...workbenchAccentProps(currentWorkspace.id, currentWorkspace.color)}
                >
                  <UnstyledButton
                    className="wb-hero-back"
                    aria-label="返回工作台首页"
                    disabled={busy}
                    onClick={toHome}
                  >
                    <IconArrowLeft size={15} aria-hidden />
                    <span>返回</span>
                  </UnstyledButton>
                  <Text size="xs" fw={750} c="var(--wb-accent-ink)">
                    创作任务 · {dateLabel(currentWorkspace.updatedAt)} 更新
                  </Text>
                  <Group align="end" justify="space-between" wrap="wrap">
                    <div>
                      <Title order={1}>{currentWorkspace.name}</Title>
                      <Text c="dimmed" mt={4}>
                        {currentWorkspace.brief || '在这里组织作品与素材。'}
                      </Text>
                    </div>
                    <Group gap="xs">
                      <Button
                        variant="default"
                        onClick={() => editWorkspace(currentWorkspace)}
                        disabled={readonly}
                      >
                        修改信息
                      </Button>
                      {currentWork && (
                        <Button onClick={() => void run(() => openWork(currentWork, true))}>
                          继续上次作品
                        </Button>
                      )}
                    </Group>
                  </Group>
                </section>
                {workLoading && (
                  <Center py="lg">
                    <Loader size="sm" />
                  </Center>
                )}
                {Object.values(currentWorkspace.notes).some(Boolean) && (
                  <details className="wb-workspace-notes">
                    <summary>工作区笔记</summary>
                    {Object.entries(currentWorkspace.notes)
                      .filter(([, note]) => note)
                      .map(([tool, note]) => (
                        <section key={tool}>
                          <Text fw={600} size="sm">
                            {tool === 'image'
                              ? '图片制作'
                              : tool === 'ai'
                                ? 'AI 生成'
                                : '音视频制作'}
                          </Text>
                          <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>
                            {note}
                          </Text>
                        </section>
                      ))}
                  </details>
                )}
                <section className="wb-section">
                  <div className="wb-section-head compact">
                    <div>
                      <Title order={2}>
                        作品{' '}
                        <Text component="span" c="dimmed" fw={400} size="sm">
                          {worksState.works.length}
                        </Text>
                      </Title>
                      <Text size="sm" c="dimmed">
                        每个作品可以包含多份制作文件和成果。
                      </Text>
                    </div>
                    <Group gap="xs" className="wb-work-list-actions">
                      <WorkbenchSortControl label="作品" value={workSort} onChange={setWorkSort} />
                      <Button
                        leftSection={<IconPlus size={16} />}
                        onClick={() => editWork()}
                        disabled={readonly || workLoading}
                      >
                        新建作品
                      </Button>
                    </Group>
                  </div>
                  {worksState.works.length ? (
                    <SimpleGrid
                      className="wb-item-grid"
                      cols={{ base: 1, sm: 2, xl: 3 }}
                      spacing="lg"
                    >
                      {visibleWorks.map((work) => {
                        const cover = workCover(work, artifacts, mediaRevisions)
                        return (
                          <Card
                            className="wb-work-card"
                            {...workbenchAccentProps(work.id, work.color)}
                            key={work.id}
                            padding={0}
                            radius={8}
                            withBorder
                          >
                            <UnstyledButton
                              className="wb-work-main"
                              onClick={() => void run(() => openWork(work))}
                              aria-label={`打开作品：${work.name}`}
                            >
                              <div className="wb-work-cover">
                                <IconFileText size={34} stroke={1.2} />
                                {cover && (
                                  <img
                                    src={cover}
                                    alt=""
                                    loading="lazy"
                                    onError={(event) => {
                                      event.currentTarget.style.display = 'none'
                                    }}
                                  />
                                )}
                              </div>
                              <div className="wb-work-copy">
                                <Text
                                  className="wb-work-title"
                                  title={work.name}
                                  fw={750}
                                  size="md"
                                  lineClamp={2}
                                >
                                  {work.name}
                                </Text>
                                <Text c="dimmed" size="sm" lineClamp={2}>
                                  {work.brief || '还没有填写创作目标'}
                                </Text>
                                <Text c="dimmed" size="xs">
                                  {work.drafts.length} 个制作文件 · {work.outputs.length} 份成果
                                </Text>
                              </div>
                            </UnstyledButton>
                            <Menu shadow="md" width={180} position="bottom-end">
                              <Menu.Target>
                                <ActionIcon
                                  variant="subtle"
                                  color="gray"
                                  className="wb-work-menu"
                                  aria-label={`作品操作：${work.name}`}
                                >
                                  <IconDots size={18} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item onClick={() => editWork(work)} disabled={readonly}>
                                  修改信息
                                </Menu.Item>
                                <Menu.Item
                                  color="red"
                                  onClick={() => askRemoveWork(work)}
                                  disabled={readonly}
                                >
                                  删除作品
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                            <div className="wb-work-continue">
                              <Button
                                variant="subtle"
                                size="xs"
                                rightSection={<IconArrowRight size={14} />}
                                onClick={() => void run(() => openWork(work))}
                              >
                                进入作品
                              </Button>
                              <WorkbenchCardDate item={work} order={workSort} />
                            </div>
                          </Card>
                        )
                      })}
                    </SimpleGrid>
                  ) : (
                    <EmptyState
                      icon={<IconLayoutGrid size={28} />}
                      title="创建一项想完成的作品"
                      description="例如旅行短片、图片系列或一段声音作品。"
                      action={
                        !readonly ? (
                          <Button leftSection={<IconPlus size={16} />} onClick={() => editWork()}>
                            新建作品
                          </Button>
                        ) : undefined
                      }
                    />
                  )}
                </section>
                <section className="wb-section wb-material-section">
                  <div className="wb-section-head compact">
                    <div>
                      <Title order={2}>工作区素材</Title>
                      <Text c="dimmed" size="sm">
                        本工作区共用，来自媒体库的引用与工作区制作产物。
                      </Text>
                    </div>
                  </div>
                  <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
                    <Paper className="wb-material-panel" withBorder radius={8}>
                      <Group justify="space-between">
                        <Group gap="xs">
                          <Text fw={700}>引用</Text>
                          <Badge variant="light" color="gray">
                            {sourceAssets.length}
                          </Badge>
                        </Group>
                        <Button
                          size="xs"
                          variant="subtle"
                          leftSection={<IconPlus size={15} />}
                          onClick={() => setPickerOpen(true)}
                          disabled={readonly}
                        >
                          从媒体库加入
                        </Button>
                      </Group>
                      {sourceAssets.length ? (
                        <>
                          <div className="wb-asset-list">
                            {sourceAssets.slice(0, shownArtifacts).map((asset) => (
                              <AssetRow
                                key={asset.path}
                                asset={asset}
                                revision={mediaRevisions[asset.path]}
                                onPreview={() => setPreview(asset)}
                                menu={
                                  <>
                                    <Menu.Item onClick={() => setPreview(asset)}>预览</Menu.Item>
                                    <Menu.Item
                                      leftSection={<IconCopy size={14} />}
                                      onClick={() => void navigator.clipboard.writeText(asset.path)}
                                    >
                                      复制路径
                                    </Menu.Item>
                                    <Menu.Divider />
                                    <Menu.Item
                                      color="red"
                                      disabled={readonly}
                                      onClick={() => void removeMaterial(asset.path)}
                                    >
                                      移出引用
                                    </Menu.Item>
                                  </>
                                }
                              />
                            ))}
                          </div>
                          {sourceAssets.length > shownArtifacts && (
                            <Button
                              variant="subtle"
                              fullWidth
                              mt="sm"
                              onClick={() => setShownArtifacts((value) => value + 60)}
                            >
                              显示更多
                            </Button>
                          )}
                        </>
                      ) : (
                        <Text className="wb-panel-empty" size="sm" c="dimmed">
                          从媒体库加入图片、视频或音频，供作品引用。
                        </Text>
                      )}
                    </Paper>
                    <Paper className="wb-material-panel wb-product-panel" withBorder radius={8}>
                      <Group gap="xs">
                        <Text fw={700} c="var(--omni-product-ink)">
                          产物
                        </Text>
                        <Badge variant="light" color="product">
                          {artifacts.length}
                        </Badge>
                      </Group>
                      {artifacts.length ? (
                        <>
                          <div className="wb-asset-list">
                            {artifacts.slice(0, shownArtifacts).map((item) => (
                              <AssetRow
                                key={item.id}
                                asset={{
                                  path: artifactPath(item.id),
                                  name: item.name,
                                  kind: item.kind
                                }}
                                subtitle={workspaceArtifactSourceLabels(item.source).join(' · ')}
                                onPreview={() =>
                                  setPreview({
                                    path: artifactPath(item.id),
                                    name: item.name,
                                    kind: item.kind
                                  })
                                }
                                menu={
                                  <>
                                    <Menu.Item
                                      onClick={() =>
                                        setPreview({
                                          path: artifactPath(item.id),
                                          name: item.name,
                                          kind: item.kind
                                        })
                                      }
                                    >
                                      预览
                                    </Menu.Item>
                                    <Menu.Item
                                      disabled={readonly}
                                      onClick={() => {
                                        setArtifactRename(item)
                                        setArtifactName(item.name)
                                      }}
                                    >
                                      重命名
                                    </Menu.Item>
                                    <Menu.Divider />
                                    <Menu.Item
                                      color="red"
                                      disabled={readonly}
                                      onClick={() => askRemoveArtifact(item)}
                                    >
                                      删除产物
                                    </Menu.Item>
                                  </>
                                }
                              />
                            ))}
                          </div>
                          {artifacts.length > shownArtifacts && (
                            <Button
                              variant="subtle"
                              fullWidth
                              mt="sm"
                              onClick={() => setShownArtifacts((value) => value + 60)}
                            >
                              显示更多
                            </Button>
                          )}
                        </>
                      ) : (
                        <Text className="wb-panel-empty" size="sm" c="dimmed">
                          图片制作、AI 创作等工具产生的内容会出现在这里。
                        </Text>
                      )}
                    </Paper>
                  </SimpleGrid>
                </section>
              </div>
            ) : currentWork ? (
              <div className="wb-enter wb-work" key={`work-${currentWork.id}`}>
                <section
                  className="wb-hero wb-work-heading"
                  {...workbenchAccentProps(currentWork.id, currentWork.color)}
                >
                  <UnstyledButton
                    className="wb-hero-back"
                    aria-label="返回所属工作区"
                    disabled={busy}
                    onClick={toWorkspace}
                  >
                    <IconArrowLeft size={15} aria-hidden />
                    <span>返回</span>
                  </UnstyledButton>
                  <Group align="end" justify="space-between" wrap="wrap">
                    <div>
                      <Text size="xs" fw={750} c="var(--wb-accent-ink)">
                        作品
                      </Text>
                      <Title order={1}>{currentWork.name}</Title>
                      <Text c="dimmed">{currentWork.brief || '还没有填写创作目标'}</Text>
                    </div>
                    <Button
                      variant="default"
                      onClick={() => editWork(currentWork)}
                      disabled={readonly}
                    >
                      修改信息
                    </Button>
                  </Group>
                </section>
                <div className="wb-material-shelf">
                  <Group justify="space-between" mb="sm">
                    <Group gap="xs">
                      <Text fw={700} size="sm">
                        素材
                      </Text>
                      <Badge variant="light" color="gray">
                        {visibleMaterials.length}
                      </Badge>
                    </Group>
                    <SegmentedControl
                      size="xs"
                      aria-label="素材范围"
                      value={materialsView}
                      onChange={(value) => setMaterialsView(value as MaterialView)}
                      data={[
                        { value: 'all', label: '全部素材' },
                        { value: 'used', label: `已使用 ${usedMaterials.length}` }
                      ]}
                    />
                  </Group>
                  <MaterialBar
                    embedded
                    items={materials}
                    assetInfo={materialInfo}
                    placement="below"
                    onPreview={(asset) => setPreview(asset)}
                    usedPaths={usedMaterialPaths}
                    scope={materialsView}
                    clickMode="view"
                    readonly={readonly}
                    onSelect={(asset) => setPreview(asset)}
                    onAdd={() => setPickerOpen(true)}
                    actions={(asset) => {
                      const artifact = artifacts.find(
                        (item) => item.id === artifactFromPath(asset.path)
                      )
                      return [
                        { key: 'preview', label: '查看详情' },
                        ...(artifact
                          ? [
                              { key: 'rename', label: '修改产物名称', disabled: readonly },
                              {
                                key: 'delete',
                                label: '删除产物',
                                disabled: readonly,
                                danger: true
                              }
                            ]
                          : [
                              {
                                key: 'remove',
                                label: '移出引用',
                                disabled: readonly,
                                danger: true
                              }
                            ])
                      ]
                    }}
                    onAction={(asset, action) => {
                      const artifact = artifacts.find(
                        (item) => item.id === artifactFromPath(asset.path)
                      )
                      if (action === 'preview') setPreview(asset)
                      else if (action === 'rename' && artifact) {
                        setArtifactRename(artifact)
                        setArtifactName(artifact.name)
                      } else if (action === 'delete' && artifact) askRemoveArtifact(artifact)
                      else if (action === 'remove') void removeMaterial(asset.path)
                    }}
                  />
                </div>
                <div className="wb-work-toolbar">
                  <Tabs
                    variant="pills"
                    value={workTab}
                    onChange={(value) => setWorkTab(value as WorkTab)}
                  >
                    <Tabs.List aria-label="作品内容">
                      <Tabs.Tab value="drafts">
                        制作 <span className="wb-work-tab-count">{currentWork.drafts.length}</span>
                      </Tabs.Tab>
                      <Tabs.Tab value="outputs">
                        成果 <span className="wb-work-tab-count">{currentWork.outputs.length}</span>
                      </Tabs.Tab>
                    </Tabs.List>
                  </Tabs>
                  {workTab === 'drafts' ? (
                    <Menu shadow="md" width={235} position="bottom-end">
                      <Menu.Target>
                        <Button leftSection={<IconPlus size={16} />} disabled={readonly}>
                          新建制作文件
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {draftChoices.map((item) => (
                          <Menu.Item
                            key={item.kind}
                            onClick={() => editDraft(undefined, item.kind)}
                          >
                            <Text fw={650} size="sm">
                              {item.label}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {item.description}
                            </Text>
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  ) : (
                    <Button
                      leftSection={<IconPlus size={16} />}
                      onClick={() => {
                        setSelectedOutputs(currentWork.outputs.map((item) => item.path))
                        setOutputsOpen(true)
                      }}
                      disabled={readonly}
                    >
                      选择产物
                    </Button>
                  )}
                </div>
                {workTab === 'drafts' ? (
                  <section className="wb-drafts">
                    <Tabs
                      className="wb-draft-filter"
                      value={draftFilter}
                      onChange={(value) => setDraftFilter(value as ProductionKind | 'all')}
                    >
                      <Tabs.List aria-label="制作类型">
                        <Tabs.Tab value="all">全部 {currentWork.drafts.length}</Tabs.Tab>
                        {(['image', 'video', 'audio', 'ai'] as const).map((kind) => (
                          <Tabs.Tab key={kind} value={kind}>
                            {draftKindLabel(kind)}{' '}
                            {currentWork.drafts.filter((item) => item.kind === kind).length}
                          </Tabs.Tab>
                        ))}
                      </Tabs.List>
                    </Tabs>
                    {filteredDrafts.length ? (
                      <SimpleGrid
                        className="wb-item-grid"
                        cols={{ base: 1, sm: 2, lg: 3 }}
                        spacing="lg"
                      >
                        {filteredDrafts.map((draft) => (
                          <ProductionDraftCard
                            key={draft.id}
                            workspaceId={currentWorkspaceId}
                            work={currentWork}
                            draft={draft}
                            assetInfo={materialInfo}
                            available={materials}
                            artifacts={artifacts}
                            readonly={readonly}
                            busy={busy}
                            onOpen={(item) => void run(() => openDraft(item))}
                            onEdit={editDraft}
                            onRemove={askRemoveDraft}
                            onExport={(item) => void exportImageDraft(item)}
                            onMaterials={(item) => {
                              setDraftCollection({ draft: item, mode: 'materials' })
                              setCollectionOwner('all')
                            }}
                            onArtifacts={(item) => {
                              setDraftCollection({ draft: item, mode: 'artifacts' })
                              setCollectionOwner('all')
                            }}
                            onPreview={setPreview}
                          />
                        ))}
                      </SimpleGrid>
                    ) : (
                      <EmptyState
                        icon={<IconPhoto size={28} />}
                        title="还没有制作文件"
                        description="在同一作品里制作画面、声音、视频和 AI 内容。"
                        action={
                          !readonly ? (
                            <Menu shadow="md">
                              <Menu.Target>
                                <Button leftSection={<IconPlus size={16} />}>新建制作文件</Button>
                              </Menu.Target>
                              <Menu.Dropdown>
                                {draftChoices.map((item) => (
                                  <Menu.Item
                                    key={item.kind}
                                    onClick={() => editDraft(undefined, item.kind)}
                                  >
                                    {item.label}
                                  </Menu.Item>
                                ))}
                              </Menu.Dropdown>
                            </Menu>
                          ) : undefined
                        }
                      />
                    )}
                  </section>
                ) : (
                  <section className="wb-outputs">
                    <Text c="dimmed" size="sm" mb="md">
                      选定用于交付或展示的结果，可保留多个版本。只有成果可以同步回媒体库。
                    </Text>
                    {currentWork.outputs.length ? (
                      <SimpleGrid
                        className="wb-draft-grid"
                        cols={{ base: 1, sm: 2, lg: 3, xl: 4 }}
                        spacing="md"
                      >
                        {currentWork.outputs.map((asset) => {
                          const item = artifacts.find((row) => artifactPath(row.id) === asset.path)
                          const synced = item?.synced_media ?? []
                          return (
                            <Card
                              key={asset.path}
                              className="wb-output-card"
                              withBorder
                              radius={8}
                              padding={0}
                            >
                              <UnstyledButton
                                className="wb-output-entry"
                                onClick={() => setPreview(asset)}
                              >
                                <AssetArt asset={asset} revision={mediaRevisions[asset.path]} />
                                <Text fw={650} size="sm" lineClamp={2}>
                                  {asset.name}
                                </Text>
                              </UnstyledButton>
                              <Group
                                className="wb-output-footer"
                                justify="space-between"
                                wrap="nowrap"
                              >
                                <Badge
                                  color={synced.length ? 'teal' : 'gray'}
                                  variant="light"
                                  size="sm"
                                  leftSection={synced.length ? <IconCheck size={11} /> : undefined}
                                >
                                  {synced.length ? '已同步' : '待同步'}
                                </Badge>
                                <Menu shadow="md" position="bottom-end">
                                  <Menu.Target>
                                    <ActionIcon
                                      variant="subtle"
                                      aria-label={`成果操作：${asset.name}`}
                                    >
                                      <IconDots size={17} />
                                    </ActionIcon>
                                  </Menu.Target>
                                  <Menu.Dropdown>
                                    <Menu.Item onClick={() => setPreview(asset)}>预览</Menu.Item>
                                    {item && (
                                      <Menu.Item
                                        disabled={readonly}
                                        onClick={() => {
                                          setSyncArtifact(item)
                                          setSyncRoot(roots[0]?.value ?? '')
                                          setSyncDirectory(roots[0]?.value ?? '')
                                          if (roots[0]) void browseDirectory(roots[0].value)
                                        }}
                                      >
                                        同步到媒体库
                                      </Menu.Item>
                                    )}
                                    {synced.map((file) => (
                                      <Menu.Item
                                        key={file.id}
                                        disabled={readonly}
                                        onClick={() => {
                                          void syncOutput(file.id, item ?? null)
                                        }}
                                      >
                                        覆盖已同步文件：{file.name}
                                      </Menu.Item>
                                    ))}
                                    <Menu.Divider />
                                    <Menu.Item
                                      color="red"
                                      disabled={readonly}
                                      onClick={() => void removeOutput(asset.path)}
                                    >
                                      移出成果
                                    </Menu.Item>
                                  </Menu.Dropdown>
                                </Menu>
                              </Group>
                            </Card>
                          )
                        })}
                      </SimpleGrid>
                    ) : (
                      <EmptyState
                        icon={<IconCheck size={28} />}
                        title="还没有选定成果"
                        description="从工作区产物中选择交付版本，随后可以同步到媒体库。"
                        action={
                          !readonly ? (
                            <Button
                              onClick={() => {
                                setSelectedOutputs([])
                                setOutputsOpen(true)
                              }}
                            >
                              选择产物
                            </Button>
                          ) : undefined
                        }
                      />
                    )}
                  </section>
                )}
              </div>
            ) : (
              <Center py="xl">
                <Button
                  variant="subtle"
                  onClick={() => {
                    setScreen('workspace')
                    sessionStorage.removeItem(activeWorkKey)
                  }}
                >
                  返回全部作品
                </Button>
              </Center>
            )}
          </div>
        </div>

        <input
          ref={fileUploadRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            void saveCover(event.currentTarget.files?.[0] ?? null, coverTarget)
            event.currentTarget.value = ''
          }}
        />
        <WorkbenchMediaPicker
          opened={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onConfirm={addMaterials}
          alreadyAdded={currentWorkspace?.assets.map((item) => item.path) ?? []}
        />

        {editDialog && (
          <WorkbenchEditDialog
            initial={editDialog}
            busy={busy}
            error={error}
            choices={draftChoices.map((item) => ({ label: item.label, value: item.kind }))}
            onClose={() => setEditDialog(null)}
            onSave={saveEdit}
          />
        )}
        <Modal
          opened={!!confirmDialog}
          onClose={() => setConfirmDialog(null)}
          title={confirmDialog?.title}
          centered
          size="sm"
        >
          <Stack>
            <Text size="sm" c="dimmed">
              {confirmDialog?.message}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirmDialog(null)}>
                取消
              </Button>
              <Button
                color="red"
                loading={busy}
                onClick={() => {
                  const action = confirmDialog?.action
                  if (action)
                    void run(async () => {
                      await action()
                      setConfirmDialog(null)
                    })
                }}
              >
                删除
              </Button>
            </Group>
          </Stack>
        </Modal>
        <Modal
          opened={outputsOpen}
          onClose={() => setOutputsOpen(false)}
          title="选择成果"
          centered
          size="lg"
        >
          <Stack>
            <Text size="sm" c="dimmed">
              选择本作品用于交付的产物，可保留多个版本。
            </Text>
            <ScrollArea h="min(54vh, 520px)" offsetScrollbars>
              {artifacts.length ? (
                <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
                  {artifacts.map((item) => (
                    <UnstyledButton
                      key={item.id}
                      className={`wb-choice-card ${selectedOutputs.includes(artifactPath(item.id)) ? 'is-selected' : ''}`}
                      onClick={() =>
                        setSelectedOutputs((current) =>
                          current.includes(artifactPath(item.id))
                            ? current.filter((path) => path !== artifactPath(item.id))
                            : [...current, artifactPath(item.id)]
                        )
                      }
                      aria-pressed={selectedOutputs.includes(artifactPath(item.id))}
                    >
                      <AssetArt
                        asset={{ path: artifactPath(item.id), name: item.name, kind: item.kind }}
                      />
                      <Checkbox
                        checked={selectedOutputs.includes(artifactPath(item.id))}
                        readOnly
                        tabIndex={-1}
                      />
                      <Text size="xs" fw={600} lineClamp={1}>
                        {item.name}
                      </Text>
                    </UnstyledButton>
                  ))}
                </SimpleGrid>
              ) : (
                <Text c="dimmed" ta="center" py="xl">
                  暂无产物。先在制作文件中生成内容。
                </Text>
              )}
            </ScrollArea>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setOutputsOpen(false)}>
                取消
              </Button>
              <Button loading={busy} onClick={() => void saveOutputs()}>
                保存成果
              </Button>
            </Group>
          </Stack>
        </Modal>
        <Modal
          opened={!!artifactRename}
          onClose={() => setArtifactRename(null)}
          title="重命名产物"
          centered
          size="sm"
        >
          <Stack>
            <TextInput
              autoFocus
              label="产物名称"
              value={artifactName}
              onChange={(event) => setArtifactName(event.currentTarget.value)}
              maxLength={200}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void renameArtifact()
              }}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setArtifactRename(null)}>
                取消
              </Button>
              <Button
                loading={busy}
                disabled={!artifactName.trim()}
                onClick={() => void renameArtifact()}
              >
                保存
              </Button>
            </Group>
          </Stack>
        </Modal>
        <MediaPreview
          files={previewFiles}
          index={preview ? previewFiles.findIndex((file) => file.fullpath === preview.path) : null}
          readonly={readonly}
          onClose={() => setPreview(null)}
          onIndexChange={(index) => {
            const file = previewFiles[index]
            if (file) {
              const kind = mediaKind(file)
              if (kind !== 'other') setPreview({ path: file.fullpath, name: file.name, kind })
            }
          }}
        />
        <Modal
          opened={!!draftCollection}
          onClose={() => setDraftCollection(null)}
          centered
          size="lg"
          title={
            draftCollection
              ? `${draftCollection.draft.name} · ${draftCollection.mode === 'materials' ? '使用素材' : '产物'}`
              : ''
          }
        >
          {draftCollection &&
            (() => {
              const produced = artifactsForDraft(draftCollection.draft)
              const owners = [
                ...new Set(
                  produced.map((item) => item.document_id).filter((id): id is string => !!id)
                )
              ]
              const collection =
                draftCollection.mode === 'materials'
                  ? collectWorkUsedAssets(
                      currentWorkspaceId,
                      { id: currentWork?.id ?? '', drafts: [draftCollection.draft] },
                      readWorkspaceState(currentWorkspaceId),
                      materials
                    )
                  : produced
                      .filter(
                        (item) => collectionOwner === 'all' || item.document_id === collectionOwner
                      )
                      .map((item) => ({
                        path: artifactPath(item.id),
                        name: item.name,
                        kind: item.kind
                      }))
              return (
                <Stack>
                  {draftCollection.mode === 'artifacts' && (
                    <Text size="sm" c="dimmed">
                      历次导出及关联 AI 分支的结果，最新的排在前面。
                    </Text>
                  )}
                  {draftCollection.mode === 'artifacts' && owners.length > 1 && (
                    <Select
                      label="产物来源"
                      value={collectionOwner}
                      onChange={(value) => setCollectionOwner(value ?? 'all')}
                      data={[
                        { value: 'all', label: '全部产物' },
                        ...owners.map((id) => ({
                          value: id,
                          label:
                            id === draftCollection.draft.id
                              ? '本制作文件'
                              : (currentWork?.drafts.find((item) => item.id === id)?.name ??
                                'AI 分支（制作文件已删除）')
                        }))
                      ]}
                    />
                  )}
                  {collection.length ? (
                    <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
                      {collection.map((asset) => {
                        const artifact = artifacts.find(
                          (item) => item.id === artifactFromPath(asset.path)
                        )
                        return (
                          <Card
                            key={asset.path}
                            padding="xs"
                            withBorder
                            radius={8}
                            className={`wb-collection-card${artifact ? ' wb-product-card' : ''}`}
                          >
                            <UnstyledButton
                              onClick={() => setPreview(asset)}
                              aria-label={`预览${draftCollection.mode === 'materials' ? '使用素材' : '产物'}：${asset.name}`}
                            >
                              <AssetArt asset={asset} revision={mediaRevisions[asset.path]} />
                              <Text size="xs" mt="xs" lineClamp={2} title={asset.name}>
                                {asset.name}
                              </Text>
                            </UnstyledButton>
                            {artifact && (
                              <Group justify="space-between" gap={4} mt={6}>
                                <Text size="xs" c="dimmed">
                                  {dateLabel(artifact.created_at)}
                                </Text>
                                <Menu position="bottom-end">
                                  <Menu.Target>
                                    <ActionIcon
                                      variant="subtle"
                                      aria-label={`产物操作：${asset.name}`}
                                    >
                                      <IconDots size={16} />
                                    </ActionIcon>
                                  </Menu.Target>
                                  <Menu.Dropdown>
                                    <Menu.Item
                                      disabled={readonly}
                                      onClick={() => {
                                        setArtifactRename(artifact)
                                        setArtifactName(artifact.name)
                                      }}
                                    >
                                      重命名
                                    </Menu.Item>
                                    <Menu.Item
                                      disabled={readonly}
                                      color="red"
                                      onClick={() => askRemoveArtifact(artifact)}
                                    >
                                      删除产物
                                    </Menu.Item>
                                  </Menu.Dropdown>
                                </Menu>
                              </Group>
                            )}
                          </Card>
                        )
                      })}
                    </SimpleGrid>
                  ) : (
                    <Text c="dimmed" ta="center" py="xl">
                      {draftCollection.mode === 'materials' ? '尚未使用素材' : '还没有产物'}
                    </Text>
                  )}
                </Stack>
              )
            })()}
        </Modal>
        <Modal
          opened={!!syncArtifact}
          onClose={() => setSyncArtifact(null)}
          title="同步成果到媒体库"
          centered
          size="md"
        >
          <Stack>
            <Text size="sm" c="dimmed">
              选择媒体库中的目录。只有作品成果可同步，原产物仍留在工作区。
            </Text>
            <Select
              label="媒体库目录"
              data={roots}
              value={syncRoot || null}
              placeholder="选择扫描目录"
              onChange={(value) => {
                setSyncRoot(value ?? '')
                if (value) void browseDirectory(value)
              }}
              searchable
            />
            <TextInput
              label="目标目录"
              value={syncDirectory}
              onChange={(event) => setSyncDirectory(event.currentTarget.value)}
              description="可在下方浏览子目录"
            />
            <ScrollArea h={180} className="wb-directory-list">
              {syncBusy ? (
                <Center py="lg">
                  <Loader size="sm" />
                </Center>
              ) : syncFolders.length ? (
                syncFolders.map((folder) => (
                  <Button
                    key={folder}
                    variant="subtle"
                    fullWidth
                    justify="start"
                    leftSection={<IconFolders size={16} />}
                    rightSection={<IconChevronRight size={14} />}
                    onClick={() => void browseDirectory(folder)}
                  >
                    {folder.split(/[\\/]/).pop()}
                  </Button>
                ))
              ) : (
                <Text c="dimmed" size="sm" ta="center" py="lg">
                  当前目录没有子目录
                </Text>
              )}
            </ScrollArea>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setSyncArtifact(null)}>
                取消
              </Button>
              <Button
                loading={syncBusy}
                disabled={!syncDirectory}
                onClick={() => void syncOutput()}
              >
                同步到此目录
              </Button>
            </Group>
          </Stack>
        </Modal>
      </div>
    </PageFrame>
  )
}

function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <Paper className="wb-empty" radius="lg" withBorder>
      <ThemeIcon size="xl" variant="light" radius="md">
        {icon}
      </ThemeIcon>
      <Text fw={700} mt="sm">
        {title}
      </Text>
      <Text c="dimmed" size="sm" mt={4}>
        {description}
      </Text>
      {action && <Box mt="md">{action}</Box>}
    </Paper>
  )
}
function AssetArt({ asset, revision }: { asset: WorkspaceAsset; revision?: string }) {
  const Icon =
    asset.kind === 'audio' ? IconFileMusic : asset.kind === 'video' ? IconVideo : IconPhoto
  return (
    <span
      className={`wb-asset-art kind-${asset.kind}${artifactFromPath(asset.path) ? ' is-product' : ''}`}
    >
      <img
        src={assetThumbnail(asset, revision)}
        alt=""
        loading="lazy"
        onError={(event) => {
          event.currentTarget.style.display = 'none'
        }}
      />
      <Icon size={26} stroke={1.4} />
    </span>
  )
}
function AssetRow({
  asset,
  revision,
  subtitle,
  onPreview,
  menu
}: {
  asset: WorkspaceAsset
  revision?: string
  subtitle?: string
  onPreview: () => void
  menu: React.ReactNode
}) {
  return (
    <div className="wb-asset-row">
      <UnstyledButton
        className="wb-asset-row-main"
        onClick={onPreview}
        aria-label={`预览：${asset.name}`}
      >
        <AssetArt asset={asset} revision={revision} />
        <span>
          <Text fw={650} size="sm" lineClamp={2} title={asset.name}>
            {asset.name}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1} title={subtitle || kindLabel[asset.kind]}>
            {subtitle || kindLabel[asset.kind]}
          </Text>
        </span>
      </UnstyledButton>
      <Menu shadow="md" position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" aria-label={`素材操作：${asset.name}`}>
            <IconDots size={17} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>{menu}</Menu.Dropdown>
      </Menu>
    </div>
  )
}
