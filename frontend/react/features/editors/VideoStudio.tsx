import EditorRecoveryPanel from './EditorRecoveryPanel'
import AudioMixPreparation from './AudioMixPreparation'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode
} from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  Menu,
  Modal,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Progress,
  Select,
  Slider,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip
} from '@mantine/core'
import {
  IconDeviceFloppy,
  IconDownload,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconFlag,
  IconMusic,
  IconPhoto,
  IconMusicPlus,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconScissors,
  IconTrash,
  IconTypography,
  IconVideo,
  IconEye,
  IconEyeOff,
  IconVolume,
  IconVolumeOff,
  IconLock,
  IconLockOpen,
  IconChevronUp,
  IconChevronDown,
  IconCopy,
  IconClipboard,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconChevronLeft,
  IconChevronRight,
  IconAdjustments,
  IconLink
} from '@tabler/icons-react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { formatFileSize } from '../../shared/formatFileSize'
import { mutateWorkspaceState, readWorkspaceState } from '../../shared/workspaceState'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import { sha256Hex } from '../../../src/shared/lib/sha256'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import type { EditorContext, RegisterEditorBeforeLeave } from './EditorHub'
import { EditorSaveQueue } from './editorSaveQueue'
import { importEditorMaterials } from './editorMediaImport'
import MaterialBar from './MaterialBar'
import WorkbenchMediaPicker from '../workbench/WorkbenchMediaPicker'
import { MediaPreview } from '../media/MediaPreview'
import { editorPreviewFile } from './editorMediaImport'
import {
  videoRulerTicks,
  videoRulerStep,
  videoClipVisible,
  videoSoundActive
} from './videoTimelineView'
import { useVideoMedia, type VideoPreviewMode } from './useVideoMedia'
import { useVideoExports } from './useVideoExports'
import EditorTaskList from './EditorTaskList'
import {
  type Lane,
  type VideoClip,
  type VideoTimelineDocument,
  type VideoClipboard,
  type VideoTrack,
  bounded,
  rounded,
  emptyDocument,
  readDocument,
  timelineEnd,
  trackIdFor,
  clipTrack,
  clipLocked,
  trackAudible,
  previewSourceTime,
  linkedSelection,
  moveClips,
  splitClips,
  removeClips,
  closeGaps,
  copyClips,
  pasteClips,
  addClips,
  mapClips,
  sliceClip
} from './videoStudioModel'
import VideoClipProperties, { CaptionProperties } from './VideoClipProperties'
import VideoTimingInput from './VideoTimingInput'
import { videoPreviewActive, videoPreviewTime } from './videoPreviewPosition'
import {
  editVideoClip,
  fitVideoTimeline,
  snapVideoTime,
  videoClipGeometry,
  videoContentScrollLimit,
  videoFrameTime,
  videoSpaceControlsPlayback,
  videoTimingLockReason
} from './videoTimelineInteraction'
import VideoClipStrip from './VideoClipStrip'
import VideoStage from './VideoStage'
import SourceRangePicker from './SourceRangePicker'
import SourceRelinkDialog from './SourceRelinkDialog'
import ProjectSourcesDialog from './ProjectSourcesDialog'
import {
  projectRelinkSources,
  projectLockedSourcePaths,
  applyProjectSourceRelinks
} from './projectSources'
import AudioSourceStreamSelect from './AudioSourceStreamSelect'
import EditorVersions from './EditorVersionHistory'
import EditorActions from './EditorActions'
import EditorNotes from './EditorNotes'
import { useEditorNotes } from './useEditorNotes'
import type { SourceRangeSelection } from './sourceRange'
import { videoRelinkSources, relinkVideoSources } from './videoSources'
import VideoSubtitleWorkspace from './VideoSubtitleWorkspace'
import { sourceMetadata } from './sourceRange'
import { sourceAudioStreamError } from './sourceAudioStreams'
import { sourceRelinkSelection } from './sourceRelink'
import VideoPrecisionTrim from './VideoPrecisionTrim'
import VideoLocalEffects from './VideoLocalEffectsPanel'
import VideoPropertyControls from './VideoPropertyControls'
import { useVideoAudioPreview } from './useVideoAudioPreview'
import { prepareVideoAudioPreview } from './videoAudioPreview'
import { AudioGainControls, AudioProcessingControls } from './AudioProcessingControls'
import AudioClipEnvelope from './AudioClipEnvelope'
import VideoSoundPanel from './VideoSoundPanel'
import VideoLinkControls from './VideoLinkControls'
import { videoAudioClip, patchVideoSound } from './videoSoundProperties'
import { levelDb, levelLabel } from '../../../src/features/media-editor/model/audioLevels'
import {
  applyVideoProperties,
  captureCaptionProperties,
  captureVideoProperties,
  type VideoProperties
} from './videoProperties'
import type { VideoPrecisionPreview } from './videoPrecisionEditing'
import {
  followTimelineViewport,
  nextTimelinePoint,
  timelineNavigationPoints
} from './timelineNavigation'
import TimelineTimeControls from './TimelineTimeControls'
import {
  formatTimelineTime,
  clampTimelinePosition,
  normalizeTimelineRange,
  setTimelineRangeEndpoint
} from './timelineTime'
import {
  parseTextTrack,
  serializeTextTrack,
  decodeTextFile
} from '../../../src/features/media-editor/model/textTimeline'
import './VideoStudio.css'

type Selection = { type: Lane | 'caption' | 'marker'; id: string } | null
interface DragState {
  id: string
  lane: Lane
  mode: 'move' | 'left' | 'right'
  x: number
  original: VideoClip
  ids: string[]
}
const keyFor = (workspaceId: string, draftId: string) =>
  `omnigallery:video-timeline-v1:${workspaceId}:${draftId}`
const numberValue = (value: string | number, fallback = 0) =>
  value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value)
const artifactId = (path: string) => (path.startsWith('workspace-artifact:') ? path.slice(19) : '')
const formatTime = (value: number) => formatTimelineTime(value)

function mediaUrl(path: string, name: string, revision = '0') {
  const id = artifactId(path)
  if (id) return apiUrl(`/workspace_artifacts/${encodeURIComponent(id)}/file`)
  if (/\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(name))
    return apiUrl(
      `/img/${encodeURIComponent(name)}?path=${encodeURIComponent(path)}&t=${encodeURIComponent(revision)}`
    )
  return apiUrl(`/stream_video?path=${encodeURIComponent(path)}`)
}

export default function VideoStudio({
  context,
  onBeforeLeave,
  backAction,
  helpAction
}: {
  context: EditorContext
  onBeforeLeave?: RegisterEditorBeforeLeave
  backAction?: ReactNode
  helpAction?: ReactNode
}) {
  const storageKey = keyFor(context.workspaceId, context.draft.id)
  const notes = useEditorNotes(context)
  const [notesOpen, setNotesOpen] = useState(false)
  const media = useVideoMedia(context.workspaceId, context.readonly)
  const [waitingSources, setWaitingSources] = useState<string[]>([])
  const [initial] = useState(() => {
    const raw = readWorkspaceState(context.workspaceId).getItem(storageKey)
    try {
      return { document: readDocument(raw), loadError: '', raw }
    } catch (cause) {
      return {
        document: emptyDocument(),
        loadError: cause instanceof Error ? cause.message : '视频制作文件无法读取',
        raw
      }
    }
  })
  const [doc, setDoc] = useState<VideoTimelineDocument>(initial.document)
  const [artifacts, setArtifacts] = useState<WorkspaceArtifact[]>([])
  const [selection, setSelectionState] = useState<Selection>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const setSelection = (next: Selection) => {
    setSelectionState(next)
    setSelectedIds(next ? linkedSelection(docRef.current, [next.id]) : [])
  }
  const [selectedTrackId, setSelectedTrackId] = useState('video-1')
  const [addMode, setAddMode] = useState<'overlay' | 'insert' | 'overwrite'>('overlay')
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [exportRange, setExportRange] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(190)
  const clipboard = useRef<VideoClipboard | null>(null)
  const subtitleInput = useRef<HTMLInputElement>(null)
  const [marquee, setMarquee] = useState<{
    x: number
    y: number
    endX: number
    endY: number
  } | null>(null)
  const marqueeRef = useRef<{ x: number; y: number; ids: string[] } | null>(null)
  const [dragDocument, setDragDocument] = useState<VideoTimelineDocument | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(24)
  const [snapping, setSnapping] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [inspectorView, setInspectorView] = useState('properties')
  const [exportOpen, setExportOpen] = useState(false)
  const [exportName, setExportName] = useState(`${context.draft.name || '视频成片'}.mp4`)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sourceRangeAsset, setSourceRangeAsset] = useState<WorkspaceAsset | null>(null)
  const [relinkOpen, setRelinkOpen] = useState(false)
  const [projectSourcesOpen, setProjectSourcesOpen] = useState(false)
  const [subtitlesOpen, setSubtitlesOpen] = useState(false)
  const [showSafeArea, setShowSafeArea] = useState(false)
  const [editingFrame, setEditingFrame] = useState<HTMLCanvasElement | null>(null)
  const [precisionPreview, setPrecisionPreview] = useState<VideoPrecisionPreview | null>(null)
  const [followPlayhead, setFollowPlayhead] = useState(true)
  const [editSoundGain, setEditSoundGain] = useState(false)
  const [previewPath, setPreviewPath] = useState('')
  const [materialClickMode, setMaterialClickMode] = useState<'view' | 'add'>('view')
  const [importedAssets, setImportedAssets] = useState<WorkspaceAsset[]>([])
  const [videoAddMode, setVideoAddMode] = useState<'default' | 'visual' | 'sound'>('default')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const videoExports = useVideoExports({
    workspaceId: context.workspaceId,
    documentId: context.draft.id,
    readonly: context.readonly,
    opened: tasksOpen,
    onArtifact: (artifact) =>
      setArtifacts((current) => [artifact, ...current.filter((item) => item.id !== artifact.id)])
  })
  const [dragPreview, setDragPreview] = useState<VideoClip | null>(null)
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const failedOriginalPreviews = useRef(new Set<string>())
  const dragRef = useRef<DragState | null>(null)
  const docRef = useRef(doc)
  const stageGesture = useRef<{
    before: VideoTimelineDocument
    next: VideoTimelineDocument
  } | null>(null)
  const sourceAddPolicy = useRef({ readonly: context.readonly, live: true })
  sourceAddPolicy.current.readonly = context.readonly
  useEffect(() => {
    sourceAddPolicy.current.live = true
    return () => {
      sourceAddPolicy.current.live = false
    }
  }, [])
  const history = useRef<{ past: VideoTimelineDocument[]; future: VideoTimelineDocument[] }>({
    past: [],
    future: []
  })
  const timelineRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ left: 0, width: 1200 })
  const saverRef = useRef<EditorSaveQueue<VideoTimelineDocument> | null>(null)
  if (!saverRef.current) {
    saverRef.current = new EditorSaveQueue(doc, async (snapshot) => {
      await mutateWorkspaceState(context.workspaceId, (storage) => {
        assertProductionDraftExists(storage, context.workspaceId, context.draft.id)
        storage.setItem(storageKey, JSON.stringify(snapshot))
      })
    })
  }
  const duration = Math.max(
    30,
    Math.ceil(Math.max(timelineEnd(doc), ...doc.markers.map((marker) => marker.time), 0) + 5)
  )
  const pixelsPerSecond = zoom
  const laneWidth = Math.max(900, duration * pixelsPerSecond)
  const contentEnd = timelineEnd(doc)
  const validExportRange = normalizeTimelineRange(range, contentEnd)
  const rulerTicks = videoRulerTicks(
    duration,
    pixelsPerSecond,
    Math.max(0, viewport.left - 126),
    viewport.width,
    doc.fps
  )
  const clipVisible = (item: { start: number; duration: number; id: string }) =>
    item.id === dragRef.current?.id ||
    videoClipVisible(
      item.start,
      item.duration,
      pixelsPerSecond,
      Math.max(0, viewport.left - 126),
      viewport.width
    )
  const selectedClip = [...doc.visuals, ...doc.sounds].find((clip) => clip.id === selection?.id)
  const timingLockReason =
    selectedClip && selection
      ? videoTimingLockReason(doc, selectedClip, selection.type as Lane)
      : ''
  const timingDisabled = context.readonly || !!timingLockReason
  const selectedCaption = doc.captions.find((cue) => cue.id === selection?.id)
  const selectedMarker = doc.markers.find((marker) => marker.id === selection?.id)
  const displayDoc = precisionPreview?.document ?? dragDocument ?? doc
  const propertyClip =
    selectedClip &&
    [...displayDoc.visuals, ...displayDoc.sounds].find((clip) => clip.id === selectedClip.id)
  let currentProperties: VideoProperties | null = null
  try {
    if (selectedClip && selection?.type === 'visual')
      currentProperties = captureVideoProperties(selectedClip)
    else if (selectedCaption) currentProperties = captureCaptionProperties(selectedCaption)
  } catch {
    // A damaged saved attribute must not prevent opening the editor to repair it.
  }
  const activeVisuals = [...displayDoc.visuals]
    .filter(
      (clip) =>
        videoPreviewActive(clip, playhead, contentEnd) && !clipTrack(doc, clip, 'visual')?.hidden
    )
    .sort(
      (a, b) =>
        doc.tracks.findIndex((t) => t.id === trackIdFor(a, 'visual')) -
          doc.tracks.findIndex((t) => t.id === trackIdFor(b, 'visual')) || a.start - b.start
    )
  const activeVisual = activeVisuals.at(-1)
  const activeCaptions = displayDoc.captions.filter((cue) =>
    videoPreviewActive(cue, playhead, contentEnd)
  )
  const previewTime = videoPreviewTime(playhead, contentEnd, doc.fps, [
    ...activeVisuals,
    ...activeCaptions
  ])
  const activeSources = [
    ...new Map(
      [
        ...activeVisuals,
        ...displayDoc.sounds.filter((clip) => videoSoundActive(clip.start, clip.duration, playhead))
      ].map((clip) => [clip.path, clip])
    ).values()
  ]
  const activeSourceKey = activeSources.map((clip) => `${clip.kind}:${clip.path}`).join('|')
  useEffect(() => {
    for (const source of activeSources) void media.prepare(source)
  }, [activeSourceKey, media.prepare])
  const visualBuffering = waitingSources.some((id) => activeVisuals.some((clip) => clip.id === id))
  const hasAudibleSounds = displayDoc.sounds.some((clip) => trackAudible(displayDoc, clip))
  const playbackEnd = precisionPreview?.end ?? timelineEnd(displayDoc)
  const playbackPosition = useRef(playhead)
  playbackPosition.current = playhead
  const playbackPolicy = useRef({ playing, visualBuffering, hasAudibleSounds })
  playbackPolicy.current = { playing, visualBuffering, hasAudibleSounds }
  const audioSession = useRef(false)
  const audioPreview = useVideoAudioPreview({
    workspaceId: context.workspaceId,
    onTime: (time) => {
      const policy = playbackPolicy.current
      if (policy.playing && !policy.visualBuffering && policy.hasAudibleSounds) setPlayhead(time)
    },
    onEnded: () => {
      audioSession.current = false
      stopPlayback()
      setPrecisionPreview(null)
      setPlayhead(playbackEnd)
    },
    onError: (cause) => {
      audioSession.current = false
      stopPlayback()
      setPrecisionPreview(null)
      setError(cause instanceof Error ? cause.message : '视频声音试听失败')
    }
  })
  const buffering = visualBuffering || (playing && hasAudibleSounds && audioPreview.buffering)
  const audioSignature = useMemo(() => prepareVideoAudioPreview(displayDoc).signature, [displayDoc])
  useEffect(() => {
    const request = { document: displayDoc, end: playbackEnd }
    audioPreview.update(request)
    if (!playing || visualBuffering || !hasAudibleSounds) {
      audioSession.current = false
      audioPreview.stop()
      return
    }
    if (!audioSession.current) {
      audioSession.current = true
      void audioPreview.play({ ...request, start: playbackPosition.current })
    }
  }, [
    playing,
    visualBuffering,
    hasAudibleSounds,
    audioSignature,
    playbackEnd,
    audioPreview.play,
    audioPreview.stop,
    audioPreview.update
  ])
  function markWaiting(id: string, waiting: boolean) {
    setWaitingSources((current) =>
      waiting
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.includes(id)
          ? current.filter((item) => item !== id)
          : current
    )
  }
  const previewSource =
    activeVisual?.kind === 'video'
      ? activeVisual
      : selectedClip?.kind === 'video'
        ? selectedClip
        : undefined
  const previewInfo = previewSource ? media.infos[previewSource.path] : undefined
  const previewJob = previewSource ? media.jobs[previewSource.path] : undefined
  const playbackUrl = (clip: VideoClip) =>
    (clip.kind === 'video' ? media.proxyUrl(clip.path) : undefined) ??
    mediaUrl(clip.path, clip.name, sourceRevision(clip))
  function previewError(clip: VideoClip) {
    stopPlayback()
    markWaiting(clip.id, false)
    if (clip.kind === 'video' && media.proxyUrl(clip.path)) {
      media.invalidate(clip.path)
      setError('代理预览不可用，已切回原片，可重新准备代理')
    } else if (
      clip.kind === 'video' &&
      media.mode !== 'original' &&
      !failedOriginalPreviews.current.has(clip.path)
    ) {
      failedOriginalPreviews.current.add(clip.path)
      void media.prepare(clip, true)
    } else setError(`无法预览：${clip.name}，请检查原片或重新准备代理`)
  }
  const assets = useMemo(
    () => [
      ...new Map(
        [
          ...context.assets,
          ...importedAssets,
          ...artifacts
            .filter((item) => !item.input_owner)
            .map((item) => ({
              path: `workspace-artifact:${item.id}`,
              name: item.name,
              kind: item.kind
            }))
        ].map((asset) => [asset.path, asset as WorkspaceAsset])
      ).values()
    ],
    [context.assets, importedAssets, artifacts]
  )
  const assetInfo = useMemo(() => {
    const current = { ...context.assetInfo }
    for (const artifact of artifacts) {
      const path = `workspace-artifact:${artifact.id}`
      if (current[path]) continue
      current[path] = {
        workspace_artifact_id: artifact.id,
        workspace_artifact_source: artifact.source,
        fullpath: path,
        name: artifact.name,
        type: 'file',
        size: formatFileSize(artifact.bytes),
        bytes: artifact.bytes,
        date: artifact.created_at,
        created_time: artifact.created_at,
        is_under_scanned_path: false,
        width: artifact.width,
        height: artifact.height
      }
    }
    return current
  }, [context.assetInfo, artifacts])
  const previewFiles = assets.map((asset) => editorPreviewFile(asset, assetInfo[asset.path]))

  async function importPicked(incoming: WorkspaceAsset[]) {
    const saved = await importEditorMaterials(context.workspaceId, incoming)
    setImportedAssets((current) => [
      ...current,
      ...saved.filter(
        (item) =>
          !context.assets.some((existing) => existing.path === item.path) &&
          !current.some((existing) => existing.path === item.path)
      )
    ])
    setStatus(`已加入 ${incoming.length} 项素材`)
  }

  useEffect(() => {
    let live = true
    void apiFetch<WorkspaceArtifact[]>(
      `/workspace_artifacts?workspace_id=${encodeURIComponent(context.workspaceId)}`
    )
      .then((items) => {
        if (live)
          setArtifacts((current) => [
            ...new Map([...items, ...current].map((item) => [item.id, item])).values()
          ])
      })
      .catch(() => {
        /* Workspace media remains usable if artifacts are unavailable. */
      })
    return () => {
      live = false
    }
  }, [context.workspaceId])

  useEffect(() => {
    const element = timelineRef.current
    if (!element) return
    const measure = () => setViewport({ left: element.scrollLeft, width: element.clientWidth })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])

  const previousContentEnd = useRef(contentEnd)
  useEffect(() => {
    if (contentEnd < previousContentEnd.current) {
      const element = timelineRef.current
      if (element) {
        const left = Math.min(
          element.scrollLeft,
          videoContentScrollLimit(contentEnd, zoom, element.clientWidth)
        )
        element.scrollLeft = left
        setViewport({ left, width: element.clientWidth })
      }
    }
    previousContentEnd.current = contentEnd
  }, [contentEnd, zoom])

  function change(next: VideoTimelineDocument, recordHistory = true) {
    if (context.readonly || initial.loadError || next === docRef.current) return
    if (next.visuals.length > 256 || next.sounds.length > 256 || next.captions.length > 4096) {
      setError('片段或字幕数量达到上限')
      return
    }
    if (recordHistory && stageGesture.current) {
      stageGesture.current.next = next
      setDragDocument(next)
      return
    }
    if (recordHistory) {
      history.current.past.push(docRef.current)
      if (history.current.past.length > 60) history.current.past.shift()
      history.current.future = []
    }
    if (precisionPreview) {
      setPrecisionPreview(null)
      stopPlayback()
    }
    const end = timelineEnd(next)
    if (end < timelineEnd(docRef.current)) {
      setPlayhead((current) => clampTimelinePosition(current, end))
      const nextRange = normalizeTimelineRange(range, end)
      setRange(nextRange)
      if (!nextRange) setExportRange(false)
      if (playhead >= end) stopPlayback()
    }
    docRef.current = next
    saverRef.current?.update(next)
    setDoc(next)
    setDirty(true)
    setStatus('')
    setError('')
  }
  function beginPropertyGesture() {
    if (context.readonly || stageGesture.current) return
    audioSession.current = false
    audioPreview.stop()
    stopPlayback()
    setPrecisionPreview(null)
    stageGesture.current = { before: docRef.current, next: docRef.current }
  }
  function endPropertyGesture(cancel = false) {
    const gesture = stageGesture.current
    stageGesture.current = null
    setDragDocument(null)
    if (!cancel && gesture && JSON.stringify(gesture.before) !== JSON.stringify(gesture.next))
      change(gesture.next)
  }

  function undo() {
    if (context.readonly || initial.loadError || dragRef.current || stageGesture.current) return
    const previous = history.current.past.pop()
    if (!previous) return
    history.current.future.push(docRef.current)
    stopPlayback()
    change(previous, false)
  }

  function redo() {
    if (context.readonly || initial.loadError || dragRef.current || stageGesture.current) return
    const next = history.current.future.pop()
    if (!next) return
    history.current.past.push(docRef.current)
    stopPlayback()
    change(next, false)
  }

  async function closeNotes() {
    try {
      await notes.flush()
      setNotesOpen(false)
      return true
    } catch {
      return false
    }
  }
  async function toggleNotes() {
    if (notesOpen) {
      await closeNotes()
      return
    }
    setTasksOpen(false)
    setNotesOpen(true)
  }
  async function toggleTasks() {
    if (!(await closeNotes())) return
    setTasksOpen((open) => !open)
  }
  async function flushChanges(): Promise<boolean> {
    if (initial.loadError) return true
    if (context.readonly) return true
    if (dragRef.current || stageGesture.current) return false
    const saver = saverRef.current
    if (!saver) return false
    setSaving(true)
    try {
      await Promise.all([saver.flush(), notes.flush()])
      setDirty(saver.dirty)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存视频制作文件失败')
      return false
    } finally {
      setSaving(false)
    }
  }
  async function save() {
    if (context.readonly || initial.loadError || saving || notes.saving) return
    await flushChanges()
  }
  async function exportVideo() {
    if (context.readonly || initial.loadError || exporting || !exportName.trim()) return
    setExporting(true)
    stopPlayback()
    setError('')
    setStatus('')
    try {
      if (!(await flushChanges())) return
      const snapshot = docRef.current
      const length = timelineEnd(snapshot)
      if (!length || length > 21600)
        throw new Error('视频须有画面、声音或字幕，且成片不能超过 6 小时')
      if (exportRange && (!range || range.end <= range.start || range.end > length))
        throw new Error('请将入点和出点设在当前时间线内，且出点晚于入点')
      const task = await videoExports.submit({
        document: snapshot,
        revision: sha256Hex(JSON.stringify(snapshot)),
        name: exportName.trim(),
        ...(exportRange && range ? { range } : {})
      })
      setExportOpen(false)
      setNotesOpen(false)
      setTasksOpen(true)
      if (task)
        setStatus(
          task.deleted ? '原任务已确认，记录已删除，未重新导出' : '导出任务已提交，可继续编辑'
        )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '视频导出失败')
    } finally {
      setExporting(false)
    }
  }
  useEffect(() => {
    if (!dirty || saving || context.readonly || initial.loadError) return
    const timer = window.setTimeout(() => void save(), 900)
    return () => window.clearTimeout(timer)
  }, [doc, dirty, saving, context.readonly])
  useEffect(() => {
    onBeforeLeave?.(async () => flushChanges())
    return () => onBeforeLeave?.(null)
  }, [onBeforeLeave])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!saverRef.current?.dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (initial.loadError || event.defaultPrevented) return
      const focus = event.target instanceof HTMLElement ? event.target : null
      if (focus?.closest('[role="dialog"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
        return
      }
      const target = event.target instanceof HTMLElement ? event.target : null
      if (
        !target ||
        event.defaultPrevented ||
        target.closest('[role="slider"], [role="combobox"], [role="spinbutton"]')
      )
        return
      const typing =
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      if (
        !typing &&
        (event.ctrlKey || event.metaKey) &&
        ['z', 'y'].includes(event.key.toLowerCase())
      ) {
        event.preventDefault()
        if (event.key.toLowerCase() === 'y' || event.shiftKey) redo()
        else undo()
        return
      }
      if (
        event.code === 'Space' &&
        videoSpaceControlsPlayback({
          typing,
          timelineItem: !!target.closest('[data-clip-id], .video-selected-trim'),
          interactive: !!target.closest('button, [role="button"], input, select, textarea')
        })
      ) {
        event.preventDefault()
        if (!event.repeat) startPlayback()
      }
      if (!typing && !(event.ctrlKey || event.metaKey)) {
        if (event.key === '[' || event.key === ']') {
          event.preventDefault()
          navigatePoint(event.key === ']' ? 'next' : 'previous')
          return
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          seekTime(
            bounded(
              playhead +
                ((event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1)) / doc.fps,
              0,
              timelineEnd(doc)
            )
          )
        }
        if (['i', 'o'].includes(event.key.toLowerCase())) {
          const next = setTimelineRangeEndpoint(
            range,
            event.key.toLowerCase() === 'i' ? 'start' : 'end',
            playhead,
            contentEnd
          )
          if (next) setRange(next)
        }
      }
      if (!typing && (event.ctrlKey || event.metaKey)) {
        if (event.key.toLowerCase() === 'c') {
          event.preventDefault()
          copySelection()
        }
        if (event.key.toLowerCase() === 'v') {
          event.preventDefault()
          pasteSelection()
        }
        if (event.key.toLowerCase() === 'a') {
          event.preventDefault()
          const ids = [...doc.visuals, ...doc.sounds].map((c) => c.id)
          setSelectedIds(ids)
          const first = doc.visuals[0] ?? doc.sounds[0]
          if (first)
            setSelectionState({ id: first.id, type: doc.visuals.length ? 'visual' : 'sound' })
        }
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !typing &&
        selection &&
        !context.readonly
      ) {
        event.preventDefault()
        removeSelection(event.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, selection, selectedIds, playhead, range, saving, context.readonly])
  useEffect(() => {
    if (!playing || hasAudibleSounds) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min((now - previous) / 1000, 0.2)
      previous = now
      setPlayhead((current) => {
        if (buffering) return current
        const next = current + elapsed
        const end = precisionPreview?.end ?? timelineEnd(doc)
        if (next >= end) {
          stopPlayback()
          setPrecisionPreview(null)
          return end
        }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, doc, buffering, precisionPreview, hasAudibleSounds])
  useEffect(() => {
    const element = timelineRef.current
    if (!playing || !followPlayhead || !element) return
    const left = followTimelineViewport({
      position: playhead,
      pixelsPerSecond,
      scrollLeft: element.scrollLeft,
      viewportWidth: element.clientWidth,
      headerWidth: 126,
      contentDuration: duration
    })
    if (Math.abs(left - element.scrollLeft) > 1) element.scrollLeft = left
  }, [playing, followPlayhead, playhead, pixelsPerSecond, duration])
  useEffect(() => {
    for (const clip of activeVisuals) {
      const video = videoRefs.current[clip.id]
      if (!video) continue
      const target = previewSourceTime(
        clip,
        previewTime,
        doc.fps,
        media.infos[clip.path]?.fps ?? doc.fps
      )
      if (
        Math.abs(video.currentTime - target) >
        (playing && !clip.reverse && !clip.freeze ? 0.15 : 0.5 / doc.fps)
      ) {
        if (!video.seeking) {
          if (playing && clip.reverse) markWaiting(clip.id, true)
          video.currentTime = target
        }
      }
      video.playbackRate = clip.rate
      if (playing && !buffering && !clip.reverse && !clip.freeze && video.paused)
        void video.play().catch(() => undefined)
      else if ((!playing || buffering || clip.reverse || clip.freeze) && !video.paused)
        video.pause()
    }
  }, [
    activeVisuals.map((c) => c.id).join('|'),
    playhead,
    playing,
    doc,
    displayDoc,
    media.infos,
    buffering
  ])
  function stopPlayback() {
    audioSession.current = false
    audioPreview.stop()
    setPlaying(false)
    setPrecisionPreview(null)
  }
  function seekTime(time: number) {
    audioSession.current = false
    audioPreview.stop()
    stopPlayback()
    setPrecisionPreview(null)
    setPlayhead(clampTimelinePosition(time, timelineEnd(docRef.current)))
  }
  function startPlayback(force?: boolean) {
    setWaitingSources([])
    if (playing && force === undefined) {
      audioSession.current = false
      audioPreview.stop()
      setPrecisionPreview(null)
    } else if (playhead >= timelineEnd(docRef.current) && !precisionPreview && force === undefined)
      setPlayhead(0)
    setPlaying((v) => force ?? !v)
  }
  function navigatePoint(direction: 'next' | 'previous') {
    const next = nextTimelinePoint(
      timelineNavigationPoints([...doc.visuals, ...doc.sounds, ...doc.captions], doc.markers),
      playhead,
      direction
    )
    if (next === undefined) return
    seekTime(next)
    const element = timelineRef.current
    if (element)
      element.scrollLeft = followTimelineViewport({
        position: next,
        pixelsPerSecond,
        scrollLeft: element.scrollLeft,
        viewportWidth: element.clientWidth,
        headerWidth: 126,
        contentDuration: duration
      })
  }

  function snapTime(time: number, exceptIds: string[] = [], offsets = [0]) {
    return snapVideoTime(time, doc, {
      pixelsPerSecond,
      playhead,
      enabled: snapping,
      exceptIds,
      offsets
    })
  }
  function fitTimeline(ids?: string[]) {
    const clips = [...doc.visuals, ...doc.sounds, ...doc.captions].filter(
      (clip) => !ids || ids.includes(clip.id)
    )
    const start = ids && clips.length ? Math.min(...clips.map((clip) => clip.start)) : 0
    const end = clips.length
      ? Math.max(...clips.map((clip) => clip.start + clip.duration))
      : Math.max(1, contentEnd)
    const fit = fitVideoTimeline(
      start,
      end,
      viewport.width,
      Math.max(64, Math.min(4096, 16000000 / duration))
    )
    setZoom(fit.zoom)
    requestAnimationFrame(() => timelineRef.current?.scrollTo({ left: fit.left }))
  }
  function openExport() {
    setExportRange(!!validExportRange)
    setExportOpen(true)
  }
  function updateClip(id: string, lane: Lane, transform: (clip: VideoClip) => VideoClip) {
    const base = stageGesture.current?.next ?? docRef.current
    const result = editVideoClip(base, id, lane, transform)
    if (result.error) setError(result.error)
    else if (JSON.stringify(result.document) !== JSON.stringify(base)) change(result.document)
    return result.clip
  }
  async function addAsset(
    asset: WorkspaceAsset,
    mode: 'default' | 'visual' | 'sound' = 'default',
    at = playhead,
    targetTrackId?: string,
    sourceSelection?: SourceRangeSelection
  ) {
    if (context.readonly) return false
    if (mode === 'visual' && asset.kind === 'audio') {
      setError('音频素材不能放入画面轨')
      return false
    }
    if (mode === 'sound' && asset.kind === 'image') {
      setError('静态图片没有可添加的声音')
      return false
    }
    setError('')
    const start = snapTime(at)
    let sourceDuration: number
    let hasAudio = false
    let metadata: ReturnType<typeof sourceMetadata> | undefined
    try {
      if (asset.kind === 'image') sourceDuration = 5
      else {
        const info = await media.load(asset, !!sourceSelection)
        sourceDuration = info.duration
        hasAudio = info.has_audio
        metadata = sourceMetadata(info, asset.kind)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取媒体时长')
      return false
    }
    if (!sourceAddPolicy.current.live || sourceAddPolicy.current.readonly) return false
    if (
      sourceSelection &&
      (sourceSelection.asset.path !== asset.path ||
        sourceSelection.sourceIn < 0 ||
        sourceSelection.duration <= 0 ||
        sourceSelection.sourceIn + sourceSelection.duration > sourceDuration + 1e-6)
    ) {
      setError('所选区间超出当前源素材，请重新选段')
      return false
    }
    if (!sourceSelection && asset.kind !== 'image' && start + sourceDuration > 21600) {
      setSourceRangeAsset(asset)
      return false
    }
    const clip: VideoClip = {
      id: crypto.randomUUID(),
      path: asset.path,
      name: asset.name,
      kind: asset.kind,
      start,
      sourceIn: sourceSelection?.sourceIn ?? 0,
      duration: sourceSelection?.duration ?? (asset.kind === 'image' ? 5 : sourceDuration),
      sourceDuration,
      rate: 1,
      gain: 1
    }
    const addVisual = asset.kind !== 'audio' && mode !== 'sound'
    const addSound =
      asset.kind === 'audio' || (asset.kind === 'video' && mode !== 'visual' && hasAudio)
    if (addSound && metadata) {
      const failure = sourceAudioStreamError(
        metadata.audioStreams,
        sourceSelection?.audioStream ?? 0,
        clip.sourceIn,
        clip.duration,
        clip.rate
      )
      if (failure) {
        setError(`${failure}，请选段添加或仅添加画面`)
        return false
      }
    }
    if (!addVisual && !addSound) {
      setError('这个视频没有音轨')
      return false
    }
    const visualTrack =
      docRef.current.tracks.find(
        (t) => t.id === (targetTrackId ?? selectedTrackId) && t.kind === 'video'
      ) ?? docRef.current.tracks.find((t) => t.kind === 'video')
    const soundTrack =
      docRef.current.tracks.find(
        (t) => t.id === (targetTrackId ?? selectedTrackId) && t.kind === 'audio'
      ) ?? docRef.current.tracks.find((t) => t.kind === 'audio')
    if ((addVisual && visualTrack?.locked) || (addSound && soundTrack?.locked)) {
      setError('目标轨道已锁定')
      return false
    }
    clip.trackId = visualTrack?.id ?? 'video-1'
    if (addVisual && addSound) clip.linkId = crypto.randomUUID()
    const soundClip = {
      ...clip,
      audioStream: sourceSelection?.audioStream ?? 0,
      sourceDuration:
        metadata?.audioStreams?.find(
          (stream) => stream.ordinal === (sourceSelection?.audioStream ?? 0)
        )?.duration ?? clip.sourceDuration,
      id: crypto.randomUUID(),
      trackId: soundTrack?.id ?? 'audio-1'
    }
    const current = docRef.current
    if (
      (addVisual && current.visuals.length >= 256) ||
      (addSound && current.sounds.length >= 256)
    ) {
      setError('每类轨道最多支持 256 个片段')
      return false
    }
    if (start + clip.duration > 21600) {
      setError('成片最长为 6 小时，请移动播放头或缩短素材')
      return false
    }
    const next = addClips(
      current,
      { visuals: addVisual ? [clip] : [], sounds: addSound ? [soundClip] : [] },
      addMode
    )
    if (next === current) {
      setError('目标轨道已锁定，无法添加')
      return false
    }
    if (timelineEnd(next) > 21600) {
      setError('成片最长为 6 小时')
      return false
    }
    change(next)
    setSelection({ type: addVisual ? 'visual' : 'sound', id: addVisual ? clip.id : soundClip.id })
    return true
  }
  function addCaption() {
    if (context.readonly) return
    const cue = {
      id: crypto.randomUUID(),
      text: '输入字幕或歌词',
      start: snapTime(playhead),
      duration: 3
    }
    change({ ...doc, captions: [...doc.captions, cue] })
    setSelection({ type: 'caption', id: cue.id })
  }
  function addMarker() {
    if (context.readonly) return
    const marker = {
      id: crypto.randomUUID(),
      name: `标记 ${doc.markers.length + 1}`,
      time: rounded(playhead)
    }
    change({ ...doc, markers: [...doc.markers, marker] })
    setSelection({ type: 'marker', id: marker.id })
  }
  function removeSelection(ripple = false) {
    if (!selection || context.readonly) return
    let next = removeClips(doc, selectedIds, ripple)
    next = {
      ...next,
      captions: next.captions.filter((c) => !selectedIds.includes(c.id)),
      markers: next.markers.filter((m) => !selectedIds.includes(m.id))
    }
    change(next)
    setSelection(null)
  }
  function splitSelection() {
    if (!context.readonly) change(splitClips(doc, selectedIds, playhead))
  }
  function copySelection() {
    clipboard.current = copyClips(doc, selectedIds)
    setStatus(`已复制 ${clipboard.current.visuals.length + clipboard.current.sounds.length} 个片段`)
  }
  function pasteSelection() {
    if (!context.readonly && clipboard.current) change(pasteClips(doc, clipboard.current, playhead))
  }
  function addTrack(kind: 'video' | 'audio') {
    if (context.readonly || doc.tracks.length >= 32) return
    const track = {
      id: crypto.randomUUID(),
      kind,
      name: `${kind === 'video' ? '画面' : '声音'} ${doc.tracks.filter((t) => t.kind === kind).length + 1}`,
      gain: 1
    }
    change({ ...doc, tracks: [...doc.tracks, track] })
    setSelectedTrackId(track.id)
  }
  function updateTrack(id: string, patch: Partial<VideoTrack>) {
    const base = stageGesture.current?.next ?? docRef.current
    change({ ...base, tracks: base.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
  }
  function reorderTrack(id: string, delta: number) {
    const tracks = [...doc.tracks],
      i = tracks.findIndex((t) => t.id === id),
      j = bounded(i + delta, 0, tracks.length - 1)
    ;[tracks[i], tracks[j]] = [tracks[j], tracks[i]]
    change({ ...doc, tracks })
  }
  function unlink() {
    const link = selectedClip?.linkId
    if (
      !link ||
      [...doc.visuals, ...doc.sounds].some(
        (c) => c.linkId === link && doc.tracks.find((t) => t.id === c.trackId)?.locked
      )
    )
      return
    change(mapClips(doc, (c) => (c.linkId === link ? { ...c, linkId: undefined } : c)))
  }
  async function importSubtitles(file: File) {
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('字幕文件最大为 2 MB')
      const cues = parseTextTrack(
        decodeTextFile(await file.arrayBuffer()),
        file.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt'
      )
      if (
        cues.some((c) => c.start + c.duration > 21600) ||
        doc.captions.length + cues.length > 4096
      )
        throw new Error('字幕超出时间线或数量限制')
      change({ ...docRef.current, captions: [...docRef.current.captions, ...cues] })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法导入字幕')
    }
  }
  function exportSubtitles(format: 'srt' | 'vtt') {
    try {
      const content = serializeTextTrack(
          { id: 'video-captions', name: '字幕', visible: true, locked: false, cues: doc.captions },
          format,
          range ?? undefined
        ),
        url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${context.draft.name || '字幕'}.${format}`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法导出字幕')
    }
  }
  function dragValue(drag: DragState, clientX: number): VideoClip {
    const clip = drag.original
    const delta = (clientX - drag.x) / pixelsPerSecond
    const excluded = drag.mode === 'move' ? drag.ids : linkedSelection(doc, [clip.id])
    if (drag.mode === 'move') {
      const moving = [...doc.visuals, ...doc.sounds].filter((item) => excluded.includes(item.id))
      const offsets = moving.flatMap((item) => [
        item.start - clip.start,
        item.start + item.duration - clip.start
      ])
      return { ...clip, start: snapTime(clip.start + delta, excluded, offsets) }
    }
    if (drag.mode === 'left') {
      if (clip.reverse) {
        const cut = bounded(
          snapTime(clip.start + delta, excluded) - clip.start,
          0,
          clip.duration - 1 / doc.fps
        )
        return sliceClip(clip, cut, clip.duration)
      }
      const nextStart = bounded(
        snapTime(clip.start + delta, excluded),
        Math.max(0, clip.start - clip.sourceIn / clip.rate),
        clip.start + clip.duration - 1 / doc.fps
      )
      const shift = nextStart - clip.start
      return {
        ...clip,
        start: rounded(nextStart),
        sourceIn: rounded(clip.sourceIn + shift * clip.rate),
        duration: rounded(clip.duration - shift)
      }
    }
    const maxDuration =
      clip.kind === 'image' || clip.freeze
        ? 21600
        : Math.max(1 / doc.fps, (clip.sourceDuration - clip.sourceIn) / clip.rate)
    const nextEnd = snapTime(clip.start + clip.duration + delta, excluded)
    const nextDuration = rounded(
      bounded(
        nextEnd - clip.start,
        1 / doc.fps,
        clip.reverse ? Math.min(clip.duration, 30) : maxDuration
      )
    )
    return clip.reverse ? sliceClip(clip, 0, nextDuration) : { ...clip, duration: nextDuration }
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>, clip: VideoClip, lane: Lane) {
    event.stopPropagation()
    if (context.readonly || clipLocked(doc, clip, lane)) {
      setSelection({ id: clip.id, type: lane })
      return
    }
    stopPlayback()
    const ids =
      event.ctrlKey || event.metaKey || event.shiftKey
        ? selectedIds.includes(clip.id)
          ? selectedIds.filter((id) => id !== clip.id)
          : [...selectedIds, ...linkedSelection(doc, [clip.id])]
        : selectedIds.includes(clip.id)
          ? selectedIds
          : linkedSelection(doc, [clip.id])
    setSelectedIds([...new Set(ids)])
    setSelectionState({ type: lane, id: clip.id })
    setSelectedTrackId(trackIdFor(clip, lane))
    const lock =
      videoTimingLockReason(doc, clip, lane) ||
      [...doc.visuals, ...doc.sounds]
        .filter((item) => ids.includes(item.id))
        .map((item) =>
          videoTimingLockReason(doc, item, doc.visuals.includes(item) ? 'visual' : 'sound')
        )
        .find(Boolean)
    if (lock) {
      setStatus(lock)
      return
    }
    const edge = (event.target as HTMLElement).closest('[data-edge]')?.getAttribute('data-edge')
    dragRef.current = {
      id: clip.id,
      lane,
      mode: edge === 'left' || edge === 'right' ? edge : 'move',
      x: event.clientX,
      original: clip,
      ids
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (drag?.id) {
      if (Math.abs(event.clientX - drag.x) < 3) return
      const next = dragValue(drag, event.clientX)
      setDragPreview(next)
      if (drag.mode === 'move')
        setDragDocument(moveClips(doc, drag.ids, next.start - drag.original.start))
    }
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag) return
    if (Math.abs(event.clientX - drag.x) < 3) {
      dragRef.current = null
      setDragPreview(null)
      setDragDocument(null)
      return
    }
    const next = dragValue(drag, event.clientX)
    dragRef.current = null
    setDragPreview(null)
    setDragDocument(null)
    if (drag.mode === 'move') {
      change(moveClips(doc, drag.ids, next.start - drag.original.start))
      return
    }
    if (JSON.stringify(next) !== JSON.stringify(drag.original))
      updateClip(drag.id, drag.lane, () => next)
  }

  const sourceRevision = (clip: VideoClip) => context.assetInfo[clip.path]?.date ?? '0'
  const renderClip = (clip: VideoClip, lane: Lane) => {
    const displayed =
      dragDocument?.[lane === 'visual' ? 'visuals' : 'sounds'].find((c) => c.id === clip.id) ??
      (dragPreview?.id === clip.id ? dragPreview : clip)
    const selected = selectedIds.includes(clip.id)
    const geometry = videoClipGeometry(displayed.duration, pixelsPerSecond)
    const cancelDrag = () => {
      dragRef.current = null
      setDragPreview(null)
      setDragDocument(null)
    }
    return (
      <div
        key={clip.id}
        className={`video-timeline-item ${selected ? 'is-selected' : ''}`}
        style={{ left: displayed.start * pixelsPerSecond, width: geometry.width }}
      >
        <button
          data-clip-id={clip.id}
          type="button"
          className={`video-timeline-clip kind-${clip.kind} ${selected ? 'is-selected' : ''} ${geometry.compact ? 'is-compact' : ''}`}
          onFocus={() => {
            if (!selected && !dragRef.current) setSelection({ id: clip.id, type: lane })
          }}
          onDoubleClick={() => fitTimeline(linkedSelection(doc, [clip.id]))}
          title={`${clip.name} · ${formatTime(clip.duration)}；双击放大`}
          onPointerDown={(event) => startDrag(event, clip, lane)}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={cancelDrag}
          aria-label={`${lane === 'visual' ? '画面' : '声音'}：${clip.name}，${formatTime(clip.start)} 至 ${formatTime(clip.start + clip.duration)}`}
        >
          <VideoClipStrip
            clip={displayed}
            lane={lane}
            workspaceId={context.workspaceId}
            left={Math.max(0, viewport.left - 126)}
            width={viewport.width}
            pixelsPerSecond={pixelsPerSecond}
            imageUrl={mediaUrl(clip.path, clip.name, sourceRevision(clip))}
          />
          {!geometry.compact && (
            <span className="video-clip-edge" data-edge="left" aria-hidden="true" />
          )}
          <span className="video-clip-content">
            {clip.kind === 'audio' ? (
              <IconMusic size={15} />
            ) : clip.kind === 'video' ? (
              <IconVideo size={15} />
            ) : (
              <IconPhoto size={15} />
            )}
            <span>
              {clip.linkId ? '↔ ' : ''}
              {clip.reverse ? '◀ ' : ''}
              {clip.freeze ? '▣ ' : ''}
              {clip.name}
            </span>
          </span>
          {!geometry.compact && (
            <span className="video-clip-edge" data-edge="right" aria-hidden="true" />
          )}
        </button>
        {lane === 'sound' && selected && (
          <AudioClipEnvelope
            clip={videoAudioClip(displayed)}
            zoom={pixelsPerSecond}
            left={Math.max(0, viewport.left - 126)}
            width={viewport.width}
            editGain={editSoundGain}
            readonly={context.readonly || clipLocked(doc, clip, 'sound')}
            onBegin={beginPropertyGesture}
            onChange={(next) =>
              updateClip(clip.id, 'sound', (current) => patchVideoSound(current, next))
            }
            onEnd={endPropertyGesture}
          />
        )}
        {selected &&
          !context.readonly &&
          !videoTimingLockReason(doc, clip, lane) &&
          (['left', 'right'] as const).map((edge) => (
            <button
              key={edge}
              type="button"
              className={`video-selected-trim edge-${edge}`}
              data-edge={edge}
              aria-label={`${edge === 'left' ? '裁剪片段起点' : '裁剪片段终点'}：${clip.name}`}
              onPointerDown={(event) => startDrag(event, clip, lane)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={cancelDrag}
            />
          ))}
      </div>
    )
  }

  if (initial.loadError)
    return (
      <EditorRecoveryPanel
        workspaceId={context.workspaceId}
        draftId={context.draft.id}
        kind="video"
        name={context.draft.name}
        raw={initial.raw ?? ''}
        loadError={initial.loadError}
        readonly={context.readonly}
        backAction={backAction}
        helpAction={helpAction}
        onRecovered={() => window.location.reload()}
      />
    )

  return (
    <section className="video-studio" aria-label="视频剪辑编辑器">
      <div className="video-studio-toolbar">
        {backAction}
        <strong title={`${context.workspace.name} · ${context.work.name} · ${context.draft.name}`}>
          {context.draft.name}
        </strong>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="compact-xs"
            aria-label="保存编辑"
            leftSection={<IconDeviceFloppy size={15} />}
            disabled={(!dirty && !notes.dirty) || context.readonly}
            loading={saving || notes.saving}
            onClick={() => void save()}
          >
            保存编辑
          </Button>
          <Button
            size="compact-xs"
            disabled={context.readonly || !timelineEnd(doc)}
            aria-label="导出产物"
            leftSection={<IconDownload size={15} />}
            loading={exporting}
            onClick={openExport}
          >
            导出产物
          </Button>
        </Group>
        <Tooltip label="撤销（Ctrl+Z）">
          <ActionIcon
            variant="subtle"
            aria-label="撤销"
            disabled={context.readonly || !history.current.past.length}
            onClick={undo}
          >
            <IconArrowBackUp size={16} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="重做（Ctrl+Shift+Z）">
          <ActionIcon
            variant="subtle"
            aria-label="重做"
            disabled={context.readonly || !history.current.future.length}
            onClick={redo}
          >
            <IconArrowForwardUp size={16} />
          </ActionIcon>
        </Tooltip>
        {helpAction}
        <Tooltip
          label={
            error || notes.error
              ? '操作失败，请查看错误提示'
              : saving || notes.saving
                ? '正在保存'
                : dirty || notes.dirty
                  ? '有未保存的修改'
                  : context.readonly
                    ? '只读'
                    : '编辑文档已保存到本机'
          }
        >
          <span
            role="status"
            aria-label={
              error || notes.error
                ? '操作失败'
                : saving || notes.saving
                  ? '正在保存'
                  : dirty || notes.dirty
                    ? '有未保存的修改'
                    : context.readonly
                      ? '只读'
                      : '编辑文档已保存到本机'
            }
            className={`react-image-save-state ${error || notes.error ? 'is-error' : dirty || notes.dirty || saving || notes.saving ? 'is-dirty' : ''}`}
          />
        </Tooltip>
      </div>
      <EditorActions
        className="video-top-actions"
        notes={{
          opened: notesOpen,
          onToggle: () => void toggleNotes()
        }}
        versions={
          <EditorVersions
            workspaceId={context.workspaceId}
            draftId={context.draft.id}
            kind="video"
            document={doc}
            readonly={context.readonly}
            disabled={!!initial.loadError || !!dragDocument}
            parseDocument={(raw) => readDocument(raw)}
            summarize={(snapshot) =>
              `${snapshot.width} × ${snapshot.height} · ${snapshot.fps} fps · ${formatTime(timelineEnd(snapshot))}；${snapshot.visuals.length} 个画面、${snapshot.sounds.length} 个声音、${snapshot.captions.length} 条字幕`
            }
            onBeforeSave={flushChanges}
            onOpen={async () => {
              stopPlayback()
              await notes.flush()
              setNotesOpen(false)
              setTasksOpen(false)
            }}
            onRestore={(snapshot) => {
              stopPlayback()
              setSelection(null)
              change(snapshot)
              setPlayhead(0)
              setRange(null)
            }}
          />
        }
        tasks={{
          opened: tasksOpen,
          running:
            Object.values(media.jobs).some(
              (job) => job.state === 'queued' || job.state === 'running'
            ) ||
            videoExports.tasks.some((task) => task.state === 'queued' || task.state === 'running'),
          onToggle: () => void toggleTasks()
        }}
      />
      {notesOpen && (
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
          exports={videoExports}
          exportKind="video"
          videoProxies={{ jobs: Object.values(media.jobs), cancel: media.cancel }}
          onClose={() => setTasksOpen(false)}
          onRetryExport={() => {
            setTasksOpen(false)
            openExport()
          }}
        />
      )}
      {error && (
        <Alert
          color="red"
          withCloseButton
          onClose={() => setError('')}
          className="video-studio-alert"
        >
          {error}
        </Alert>
      )}
      {status && (
        <Text role="status" className="video-studio-status" size="xs" c="teal">
          {status}
        </Text>
      )}
      <div className="video-studio-layout">
        <aside className="video-tool-rail" aria-label="视频编辑工具">
          <Tooltip label="从媒体库加入素材" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="从媒体库加入素材"
              disabled={context.readonly}
              onClick={() => setPickerOpen(true)}
            >
              <IconPlus size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="添加字幕" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="添加字幕"
              disabled={context.readonly}
              onClick={addCaption}
            >
              <IconTypography size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="添加标记" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="添加标记"
              disabled={context.readonly}
              onClick={addMarker}
            >
              <IconFlag size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="在播放头拆分" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="在播放头拆分"
              disabled={!selectedClip || context.readonly}
              onClick={splitSelection}
            >
              <IconScissors size={19} />
            </ActionIcon>
          </Tooltip>
          <Divider my={4} />
          <Menu position="right-start" withinPortal>
            <Menu.Target>
              <Tooltip label="视频素材加入方式" position="right">
                <ActionIcon variant="subtle" aria-label="视频素材加入方式">
                  <IconMusicPlus size={19} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>点击底部视频素材时</Menu.Label>
              <Menu.Item onClick={() => setVideoAddMode('default')}>
                画面和声音 {videoAddMode === 'default' ? '✓' : ''}
              </Menu.Item>
              <Menu.Item onClick={() => setVideoAddMode('visual')}>
                仅画面 {videoAddMode === 'visual' ? '✓' : ''}
              </Menu.Item>
              <Menu.Item onClick={() => setVideoAddMode('sound')}>
                仅声音 {videoAddMode === 'sound' ? '✓' : ''}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Tooltip label="重新指定素材" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="重新指定素材"
              disabled={context.readonly || (!doc.visuals.length && !doc.sounds.length)}
              onClick={() => {
                stopPlayback()
                setRelinkOpen(true)
              }}
            >
              <IconLink size={19} />
            </ActionIcon>
          </Tooltip>
        </aside>
        <div className="video-studio-main">
          <div className="video-studio-stage-wrap">
            <div
              className="video-studio-stage"
              style={{ aspectRatio: `${doc.width} / ${doc.height}` }}
            >
              <VideoStage
                doc={displayDoc}
                clips={activeVisuals}
                captions={activeCaptions}
                time={previewTime}
                playing={playing}
                videos={videoRefs.current}
                url={(clip) => mediaUrl(clip.path, clip.name, sourceRevision(clip))}
                onSelect={(id) => setSelection({ id, type: 'visual' })}
                selectedId={selection?.id}
                readonly={context.readonly}
                showSafeArea={showSafeArea}
                onEditingFrame={setEditingFrame}
                onSelectCaption={(id) => setSelection({ id, type: 'caption' })}
                onInteractionStart={beginPropertyGesture}
                onChangeClip={(clip) => {
                  const base = stageGesture.current?.next ?? docRef.current
                  const next = {
                    ...base,
                    visuals: base.visuals.map((item) => (item.id === clip.id ? clip : item))
                  }
                  if (stageGesture.current) {
                    stageGesture.current.next = next
                    setDragDocument(next)
                  } else change(next)
                }}
                onChangeCaption={(caption) => {
                  const base = stageGesture.current?.next ?? docRef.current
                  const next = {
                    ...base,
                    captions: base.captions.map((item) => (item.id === caption.id ? caption : item))
                  }
                  if (stageGesture.current) {
                    stageGesture.current.next = next
                    setDragDocument(next)
                  } else change(next)
                }}
                onInteractionEnd={endPropertyGesture}
              />
              {!activeVisuals.length && !activeCaptions.length && (
                <div className="video-stage-empty">
                  <IconVideo size={32} />
                  <Text size="sm">画面预览</Text>
                </div>
              )}
            </div>
          </div>
          <div
            className="video-stage-divider"
            role="separator"
            aria-label="调整预览与时间线高度"
            aria-orientation="horizontal"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                setTimelineHeight((v) => bounded(v + (e.key === 'ArrowUp' ? 20 : -20), 100, 600))
              }
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              e.currentTarget.dataset.startY = String(e.clientY)
              e.currentTarget.dataset.height = String(timelineHeight)
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                setTimelineHeight(
                  bounded(
                    Number(e.currentTarget.dataset.height) +
                      Number(e.currentTarget.dataset.startY) -
                      e.clientY,
                    100,
                    600
                  )
                )
            }}
            onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
          />
          <AudioMixPreparation
            job={audioPreview.preparation}
            onCancel={() => {
              stopPlayback()
              void audioPreview.cancelPreparation()
            }}
          />
          <div className="video-transport">
            <Group gap="xs">
              <ActionIcon
                variant="light"
                size="lg"
                aria-label={playing ? '暂停' : '播放'}
                onClick={() => {
                  if (timelineEnd(doc)) {
                    startPlayback()
                  }
                }}
              >
                {playing ? <IconPlayerPause size={19} /> : <IconPlayerPlay size={19} />}
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                aria-label="上一帧"
                onClick={() => {
                  seekTime(Math.max(0, playhead - 1 / doc.fps))
                }}
              >
                <IconPlayerSkipBack size={15} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                aria-label="下一帧"
                onClick={() => {
                  seekTime(Math.min(timelineEnd(doc), playhead + 1 / doc.fps))
                }}
              >
                <IconPlayerSkipForward size={15} />
              </ActionIcon>
              {buffering && playing && <Text size="xs">缓冲中</Text>}
              <Tooltip label="上一剪辑点或标记（[）">
                <ActionIcon
                  variant="subtle"
                  aria-label="上一剪辑点或标记"
                  onClick={() => navigatePoint('previous')}
                >
                  <IconChevronLeft size={16} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="下一剪辑点或标记（]）">
                <ActionIcon
                  variant="subtle"
                  aria-label="下一剪辑点或标记"
                  onClick={() => navigatePoint('next')}
                >
                  <IconChevronRight size={16} />
                </ActionIcon>
              </Tooltip>
              <Menu position="top-start" withinPortal>
                <Menu.Target>
                  <ActionIcon variant="subtle" aria-label="播放与导航设置">
                    <IconAdjustments size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => setFollowPlayhead((value) => !value)}>
                    跟随播放头 {followPlayhead ? '✓' : ''}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
            <Group gap="xs">
              <Tooltip label="在播放头加入字幕">
                <ActionIcon
                  variant="subtle"
                  disabled={context.readonly}
                  aria-label="添加字幕"
                  onClick={addCaption}
                >
                  <IconTypography size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="在播放头添加标记">
                <ActionIcon
                  variant="subtle"
                  disabled={context.readonly}
                  aria-label="添加标记"
                  onClick={addMarker}
                >
                  <IconFlag size={18} />
                </ActionIcon>
              </Tooltip>
              <Text size="xs" c="dimmed">
                缩放
              </Text>
              <Slider
                min={-5}
                max={Math.log2(Math.max(64, Math.min(4096, 16000000 / duration)))}
                step={0.1}
                value={Math.log2(zoom)}
                onChange={(value) => setZoom(2 ** value)}
                label={(value) => `${(2 ** value).toFixed(1)} px/s`}
                w={90}
                aria-label="时间线缩放"
              />
              <Button size="compact-xs" variant="subtle" onClick={() => fitTimeline()}>
                适应内容
              </Button>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={!selectedIds.length}
                onClick={() => fitTimeline(selectedIds)}
              >
                适应选中
              </Button>
              <Button
                variant={snapping ? 'light' : 'subtle'}
                size="compact-xs"
                onClick={() => setSnapping((value) => !value)}
              >
                吸附{snapping ? '开' : '关'}
              </Button>
            </Group>
          </div>
          <TimelineTimeControls
            playhead={playhead}
            range={range}
            duration={timelineEnd(doc)}
            onSeek={seekTime}
            onRangeChange={(next) => {
              const normalized = normalizeTimelineRange(next, contentEnd)
              setRange(normalized)
              if (!normalized) setExportRange(false)
            }}
            step={1 / doc.fps}
            max={21600}
          />
          <div className="video-timeline-actions">
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={context.readonly}
              onClick={() => addTrack('video')}
            >
              ＋画面轨
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={context.readonly}
              onClick={() => addTrack('audio')}
            >
              ＋声音轨
            </Button>
            <Select
              aria-label="添加方式"
              size="xs"
              w={105}
              value={addMode}
              onChange={(v) => setAddMode(v as typeof addMode)}
              data={[
                { value: 'overlay', label: '叠加添加' },
                { value: 'insert', label: '插入添加' },
                { value: 'overwrite', label: '覆盖添加' }
              ]}
            />
            <Tooltip label="复制（Ctrl+C）">
              <ActionIcon
                variant="subtle"
                aria-label="复制片段"
                disabled={!selectedIds.length}
                onClick={copySelection}
              >
                <IconCopy size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="粘贴（Ctrl+V）">
              <ActionIcon
                variant="subtle"
                aria-label="粘贴片段"
                disabled={context.readonly || !clipboard.current}
                onClick={pasteSelection}
              >
                <IconClipboard size={16} />
              </ActionIcon>
            </Tooltip>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={context.readonly || !selectedIds.length}
              onClick={() => removeSelection(true)}
            >
              波纹删除
            </Button>
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={context.readonly || doc.tracks.some((t) => t.locked)}
              onClick={() => change(closeGaps(doc))}
            >
              闭合空隙
            </Button>
            <Menu>
              <Menu.Target>
                <Button size="compact-xs" variant="subtle">
                  字幕
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item
                  onClick={() => {
                    stopPlayback()
                    setSubtitlesOpen(true)
                  }}
                >
                  管理字幕
                </Menu.Item>
                <Menu.Item onClick={() => setShowSafeArea((show) => !show)}>
                  字幕安全区 {showSafeArea ? '✓' : ''}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item
                  disabled={context.readonly}
                  onClick={() => subtitleInput.current?.click()}
                >
                  导入 SRT / VTT
                </Menu.Item>
                <Menu.Item onClick={() => exportSubtitles('srt')}>导出 SRT</Menu.Item>
                <Menu.Item onClick={() => exportSubtitles('vtt')}>导出 VTT</Menu.Item>
              </Menu.Dropdown>
            </Menu>
            <input
              ref={subtitleInput}
              type="file"
              accept=".srt,.vtt"
              hidden
              onChange={(e) => {
                const file = e.currentTarget.files?.[0]
                if (file) void importSubtitles(file)
                e.currentTarget.value = ''
              }}
            />
          </div>
          <div
            style={{ height: timelineHeight }}
            className="video-timeline-scroll"
            ref={timelineRef}
            onScroll={(event) =>
              setViewport({
                left: event.currentTarget.scrollLeft,
                width: event.currentTarget.clientWidth
              })
            }
          >
            <div
              className="video-timeline-canvas"
              style={
                {
                  width: laneWidth + 126,
                  '--video-grid-step': `${videoRulerStep(pixelsPerSecond, doc.fps) * pixelsPerSecond}px`
                } as CSSProperties
              }
              onPointerDown={(e) => {
                if (
                  (e.target as HTMLElement).closest('button,input,.video-lane-title,.video-ruler')
                )
                  return
                const rect = e.currentTarget.getBoundingClientRect(),
                  x = e.clientX - rect.left,
                  y = e.clientY - rect.top
                marqueeRef.current = { x, y, ids: e.shiftKey ? selectedIds : [] }
                setMarquee({ x, y, endX: x, endY: y })
                e.currentTarget.setPointerCapture(e.pointerId)
              }}
              onPointerMove={(e) => {
                const drag = marqueeRef.current
                if (!drag) return
                const rect = e.currentTarget.getBoundingClientRect()
                setMarquee({
                  x: drag.x,
                  y: drag.y,
                  endX: e.clientX - rect.left,
                  endY: e.clientY - rect.top
                })
              }}
              onPointerUp={(e) => {
                const drag = marqueeRef.current
                if (!drag) return
                const rect = e.currentTarget.getBoundingClientRect(),
                  x = e.clientX - rect.left,
                  y = e.clientY - rect.top,
                  ids = [...drag.ids]
                for (const node of e.currentTarget.querySelectorAll<HTMLElement>(
                  '[data-clip-id]'
                )) {
                  const r = node.getBoundingClientRect()
                  if (
                    r.right >= rect.left + Math.min(x, drag.x) &&
                    r.left <= rect.left + Math.max(x, drag.x) &&
                    r.bottom >= rect.top + Math.min(y, drag.y) &&
                    r.top <= rect.top + Math.max(y, drag.y)
                  )
                    ids.push(node.dataset.clipId ?? '')
                }
                const all = linkedSelection(doc, ids)
                setSelectedIds(all)
                const first =
                  doc.visuals.find((c) => all.includes(c.id)) ??
                  doc.sounds.find((c) => all.includes(c.id))
                setSelectionState(
                  first
                    ? { id: first.id, type: doc.visuals.includes(first) ? 'visual' : 'sound' }
                    : null
                )
                marqueeRef.current = null
                setMarquee(null)
              }}
              onPointerCancel={() => {
                marqueeRef.current = null
                setMarquee(null)
              }}
            >
              {marquee && (
                <div
                  className="video-marquee"
                  style={{
                    left: Math.min(marquee.x, marquee.endX),
                    top: Math.min(marquee.y, marquee.endY),
                    width: Math.abs(marquee.endX - marquee.x),
                    height: Math.abs(marquee.endY - marquee.y)
                  }}
                />
              )}
              {range && (
                <div
                  className="video-range-overlay"
                  style={{
                    left: 126 + range.start * pixelsPerSecond,
                    width: (range.end - range.start) * pixelsPerSecond
                  }}
                />
              )}
              <div className="video-ruler">
                <div className="video-lane-title">时间线</div>
                <div
                  className="video-ruler-ticks"
                  style={{ width: laneWidth }}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    seekTime(bounded((event.clientX - rect.left) / pixelsPerSecond, 0, duration))
                  }}
                >
                  {rulerTicks.map((time) => (
                    <span key={time} style={{ left: time * pixelsPerSecond }}>
                      {pixelsPerSecond > doc.fps * 24
                        ? `${formatTime(time)} · ${Math.round((time % 1) * doc.fps)}f`
                        : formatTime(time)}
                    </span>
                  ))}
                </div>
              </div>
              {doc.tracks.map((track) => {
                const lane: Lane = track.kind === 'video' ? 'visual' : 'sound',
                  clips = doc[lane === 'visual' ? 'visuals' : 'sounds'].filter(
                    (c) => trackIdFor(c, lane) === track.id
                  )
                return (
                  <div
                    className={`video-lane lane-${lane} ${track.locked ? 'is-locked' : ''}`}
                    key={track.id}
                  >
                    <div
                      className={`video-lane-title ${selectedTrackId === track.id ? 'is-selected' : ''}`}
                      onClick={() => {
                        setSelectedTrackId(track.id)
                        setSelection(null)
                      }}
                    >
                      <input
                        aria-label="轨道名称"
                        value={track.name}
                        disabled={context.readonly}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          updateTrack(track.id, { name: e.currentTarget.value.slice(0, 120) })
                        }
                      />
                      <div className="video-track-buttons">
                        <button
                          type="button"
                          title={track.hidden ? '显示轨道' : '隐藏轨道'}
                          aria-label={track.hidden ? '显示轨道' : '隐藏轨道'}
                          disabled={context.readonly}
                          onClick={(e) => {
                            e.stopPropagation()
                            updateTrack(track.id, { hidden: !track.hidden })
                          }}
                        >
                          {track.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
                        </button>
                        {track.kind === 'audio' && (
                          <>
                            <button
                              type="button"
                              title="静音"
                              aria-label="轨道静音"
                              className={track.muted ? 'is-active' : ''}
                              disabled={context.readonly}
                              onClick={(e) => {
                                e.stopPropagation()
                                updateTrack(track.id, { muted: !track.muted })
                              }}
                            >
                              {track.muted ? <IconVolumeOff size={13} /> : <IconVolume size={13} />}
                            </button>
                            <button
                              type="button"
                              title="独奏"
                              aria-label="轨道独奏"
                              className={track.solo ? 'is-active' : ''}
                              disabled={context.readonly}
                              onClick={(e) => {
                                e.stopPropagation()
                                updateTrack(track.id, { solo: !track.solo })
                              }}
                            >
                              S
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          title="锁定"
                          aria-label="锁定轨道"
                          disabled={context.readonly}
                          onClick={(e) => {
                            e.stopPropagation()
                            updateTrack(track.id, { locked: !track.locked })
                          }}
                        >
                          {track.locked ? <IconLock size={13} /> : <IconLockOpen size={13} />}
                        </button>
                        <button
                          type="button"
                          title="轨道上移"
                          aria-label="轨道上移"
                          disabled={context.readonly || doc.tracks.indexOf(track) === 0}
                          onClick={(e) => {
                            e.stopPropagation()
                            reorderTrack(track.id, -1)
                          }}
                        >
                          <IconChevronUp size={12} />
                        </button>
                        <button
                          type="button"
                          title="轨道下移"
                          aria-label="轨道下移"
                          disabled={
                            context.readonly || doc.tracks.indexOf(track) === doc.tracks.length - 1
                          }
                          onClick={(e) => {
                            e.stopPropagation()
                            reorderTrack(track.id, 1)
                          }}
                        >
                          <IconChevronDown size={12} />
                        </button>
                      </div>
                    </div>
                    <div
                      className="video-lane-content"
                      style={{ width: laneWidth }}
                      onDragOver={(e) => {
                        if (
                          !track.locked &&
                          e.dataTransfer.types.includes('application/x-omnigallery-editor-asset')
                        )
                          e.preventDefault()
                      }}
                      onDrop={(e) => {
                        if (track.locked) return
                        const path = e.dataTransfer.getData(
                            'application/x-omnigallery-editor-asset'
                          ),
                          asset = assets.find((a) => a.path === path)
                        if (!asset) return
                        e.preventDefault()
                        void addAsset(
                          asset,
                          lane,
                          Math.max(
                            0,
                            (e.clientX - e.currentTarget.getBoundingClientRect().left) /
                              pixelsPerSecond
                          ),
                          track.id
                        )
                      }}
                    >
                      {clips.filter(clipVisible).map((c) => renderClip(c, lane))}
                      {!clips.length && (
                        <span className="video-lane-empty">
                          拖入{lane === 'visual' ? '图片或视频' : '声音'}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
              <div className="video-lane lane-caption">
                <div className="video-lane-title">
                  <IconTypography size={16} />
                  字幕
                </div>
                <div className="video-lane-content" style={{ width: laneWidth }}>
                  {doc.captions.filter(clipVisible).map((cue) => (
                    <button
                      key={cue.id}
                      type="button"
                      className={`video-caption-cue ${selectedIds.includes(cue.id) ? 'is-selected' : ''}`}
                      aria-pressed={selectedIds.includes(cue.id)}
                      style={{
                        left: cue.start * pixelsPerSecond,
                        width: cue.duration * pixelsPerSecond
                      }}
                      onClick={(event) => {
                        if (event.ctrlKey || event.metaKey || event.shiftKey) {
                          setSelectedIds((current) =>
                            current.includes(cue.id)
                              ? current.filter((id) => id !== cue.id)
                              : [...current, cue.id]
                          )
                          setSelectionState({ type: 'caption', id: cue.id })
                        } else setSelection({ type: 'caption', id: cue.id })
                      }}
                    >
                      {cue.text}
                    </button>
                  ))}
                  {!doc.captions.length && (
                    <span className="video-lane-empty">用上方文字按钮添加字幕</span>
                  )}
                </div>
              </div>
              <div
                className="video-timeline-head"
                style={{ left: 126 + playhead * pixelsPerSecond }}
                aria-hidden="true"
              />
              {doc.markers.map((marker) => (
                <button
                  key={marker.id}
                  className="video-timeline-marker"
                  type="button"
                  style={{ left: 126 + marker.time * pixelsPerSecond }}
                  onClick={() => {
                    seekTime(marker.time)
                    setSelection({ type: 'marker', id: marker.id })
                  }}
                  title={marker.name}
                >
                  <IconFlag size={15} />
                </button>
              ))}
            </div>
          </div>
          <div className="video-studio-hidden-audio" aria-hidden="true">
            {activeVisuals
              .filter((c) => c.kind === 'video')
              .map((clip) => (
                <video
                  key={clip.id}
                  ref={(node) => {
                    videoRefs.current[clip.id] = node
                  }}
                  src={playbackUrl(clip)}
                  muted
                  playsInline
                  preload="metadata"
                  onLoadStart={() => markWaiting(clip.id, true)}
                  onLoadedMetadata={(e) => {
                    e.currentTarget.currentTime = previewSourceTime(
                      clip,
                      previewTime,
                      doc.fps,
                      media.infos[clip.path]?.fps ?? doc.fps
                    )
                  }}
                  onWaiting={() => markWaiting(clip.id, true)}
                  onCanPlay={() => markWaiting(clip.id, false)}
                  onSeeked={() => markWaiting(clip.id, false)}
                  onPlaying={() => markWaiting(clip.id, false)}
                  onError={() => previewError(clip)}
                />
              ))}
          </div>
        </div>
        <aside className="video-studio-inspector">
          <Text fw={750} size="sm">
            {selectedClip
              ? selection?.type === 'visual'
                ? '画面片段'
                : '声音片段'
              : selectedCaption
                ? '字幕'
                : selectedMarker
                  ? '标记'
                  : '视频设置'}
          </Text>
          <Divider my="sm" />
          <SegmentedControl
            size="xs"
            fullWidth
            aria-label="视频属性工具"
            value={inspectorView}
            onChange={setInspectorView}
            data={[
              { value: 'properties', label: '属性' },
              { value: 'refine', label: '精修' },
              { value: 'mix', label: '混音' },
              { value: 'project', label: '工程' }
            ]}
          />
          <ScrollArea className="video-inspector-scroll" type="auto" offsetScrollbars>
            <Stack gap="sm">
              {inspectorView === 'project' && (
                <Stack gap={6}>
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => {
                      stopPlayback()
                      setProjectSourcesOpen(true)
                    }}
                  >
                    工程素材 · 检查与重新定位
                  </Button>
                  <Text size="xs" fw={650}>
                    预览画质
                  </Text>
                  <SegmentedControl
                    size="xs"
                    fullWidth
                    value={media.mode}
                    onChange={(value) => media.setMode(value as VideoPreviewMode)}
                    data={[
                      { value: 'auto', label: '自动' },
                      { value: 'smooth', label: '流畅' },
                      { value: 'original', label: '原画' }
                    ]}
                  />
                  <Text size="xs" c="dimmed">
                    流畅预览使用 720p 代理，导出始终使用原片。
                  </Text>
                  {previewInfo && (
                    <Text size="xs" c="dimmed">
                      {previewInfo.width} × {previewInfo.height} · {previewInfo.video_codec} ·{' '}
                      {formatFileSize(previewInfo.size)}
                    </Text>
                  )}
                  {previewSource && media.proxyUrl(previewSource.path) && (
                    <Text size="xs" c="teal">
                      正在使用代理预览
                    </Text>
                  )}
                  {previewJob && ['queued', 'running'].includes(previewJob.state) && (
                    <>
                      <Progress value={previewJob.progress * 100} />
                      <Group justify="space-between">
                        <Text size="xs">
                          {previewJob.state === 'queued'
                            ? '代理排队中'
                            : `准备代理 ${Math.round(previewJob.progress * 100)}%`}
                        </Text>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          disabled={context.readonly}
                          onClick={() => void media.cancel(previewJob.path)}
                        >
                          取消
                        </Button>
                      </Group>
                    </>
                  )}
                  {previewJob?.error && (
                    <Text size="xs" c="red">
                      {previewJob.error}
                    </Text>
                  )}
                  {previewInfo?.warnings?.map((warning) => (
                    <Text key={warning} size="xs" c="orange">
                      {warning}
                    </Text>
                  ))}
                  {previewSource && (
                    <Group gap="xs">
                      <Button
                        size="compact-xs"
                        variant="default"
                        disabled={
                          context.readonly ||
                          media.mode === 'original' ||
                          ['queued', 'running'].includes(previewJob?.state ?? '')
                        }
                        onClick={() => void media.prepare(previewSource, true)}
                      >
                        准备代理
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        disabled={
                          context.readonly ||
                          !(previewInfo?.proxy_url || previewJob?.state === 'succeeded')
                        }
                        onClick={() => void media.clear(previewSource.path)}
                      >
                        清理代理
                      </Button>
                    </Group>
                  )}
                  {media.error && (
                    <Alert color="red" withCloseButton onClose={media.clearError}>
                      {media.error}
                    </Alert>
                  )}
                  <Divider />
                  <Text size="xs" c="dimmed">
                    画面轨、声音轨和字幕轨保存在同一份视频制作文件中。
                  </Text>
                  <Select
                    label="输出尺寸"
                    value={`${doc.width}x${doc.height}`}
                    data={[
                      { value: '1280x720', label: '横屏 720p · 1280 × 720' },
                      { value: '1920x1080', label: '横屏 1080p · 1920 × 1080' },
                      { value: '3840x2160', label: '横屏 4K · 3840 × 2160' },
                      { value: '720x1280', label: '竖屏 720p · 720 × 1280' },
                      { value: '1080x1920', label: '竖屏 1080p · 1080 × 1920' },
                      { value: '2160x3840', label: '竖屏 4K · 2160 × 3840' },
                      { value: '1080x1080', label: '正方形 · 1080 × 1080' },
                      ...(![
                        '1280x720',
                        '1920x1080',
                        '3840x2160',
                        '720x1280',
                        '1080x1920',
                        '2160x3840',
                        '1080x1080'
                      ].includes(`${doc.width}x${doc.height}`)
                        ? [
                            {
                              value: `${doc.width}x${doc.height}`,
                              label: `当前尺寸 · ${doc.width} × ${doc.height}`
                            }
                          ]
                        : [])
                    ]}
                    disabled={context.readonly}
                    onChange={(value) => {
                      if (!value) return
                      const [width, height] = value.split('x').map(Number)
                      change({ ...doc, width, height })
                    }}
                  />
                  <NumberInput
                    label="帧率"
                    min={1}
                    max={60}
                    value={doc.fps}
                    disabled={context.readonly}
                    onChange={(value) =>
                      change({ ...doc, fps: Math.round(bounded(numberValue(value, 30), 1, 60)) })
                    }
                  />
                  <Divider />
                  <Text size="xs" c="dimmed">
                    拖动片段可移动位置；拖动两端可裁切。靠近播放头、标记或其他片段边缘时会吸附。
                  </Text>
                  <Text size="xs" c="dimmed">
                    成片由本机 FFmpeg 输出为 H.264／AAC MP4；标记只辅助剪辑，不延长成片。
                  </Text>
                </Stack>
              )}
              {inspectorView === 'mix' && (
                <>
                  <Stack gap="xs" pt="xs">
                    {(['left', 'right'] as const).map((channel) => (
                      <Group key={channel} gap="xs" wrap="nowrap">
                        <Text size="xs">{channel === 'left' ? 'L' : 'R'}</Text>
                        <Progress
                          style={{ flex: 1 }}
                          value={Math.max(
                            0,
                            ((levelDb(audioPreview.levels[channel]) + 60) / 60) * 100
                          )}
                          color={audioPreview.levels[channel] >= 1 ? 'red' : 'teal'}
                          aria-label={`${channel === 'left' ? '左' : '右'}声道电平`}
                        />
                        <Text size="xs" w={80} style={{ whiteSpace: 'nowrap' }}>
                          {levelLabel(levelDb(audioPreview.levels[channel]))}
                        </Text>
                      </Group>
                    ))}
                    <NumberInput
                      label="总音量 %"
                      min={0}
                      max={200}
                      step={1}
                      value={(displayDoc.masterGain ?? 1) * 100}
                      disabled={context.readonly}
                      onChange={(value) => {
                        if (typeof value === 'number')
                          change({ ...docRef.current, masterGain: value / 100 })
                      }}
                    />
                    <AudioProcessingControls
                      scope="master"
                      inline
                      value={displayDoc.processing}
                      readonly={context.readonly}
                      onChange={(processing) => change({ ...docRef.current, processing })}
                    />
                  </Stack>
                </>
              )}
              <Stack
                gap="sm"
                style={{
                  display:
                    inspectorView === 'properties' || inspectorView === 'refine'
                      ? undefined
                      : 'none'
                }}
              >
                {!selectedClip &&
                  doc.tracks.find((t) => t.id === selectedTrackId)?.kind === 'audio' && (
                    <>
                      <Text size="xs">轨道音量</Text>
                      <Slider
                        min={0}
                        max={4}
                        step={0.01}
                        value={doc.tracks.find((t) => t.id === selectedTrackId)?.gain ?? 1}
                        disabled={
                          context.readonly ||
                          !!doc.tracks.find((t) => t.id === selectedTrackId)?.locked
                        }
                        label={(v) => `${Math.round(v * 100)}%`}
                        onChange={(gain) => updateTrack(selectedTrackId, { gain })}
                        onPointerDown={beginPropertyGesture}
                        onPointerCancel={() => endPropertyGesture(true)}
                        onChangeEnd={() => endPropertyGesture()}
                      />
                      <AudioGainControls
                        pan={doc.tracks.find((t) => t.id === selectedTrackId)?.pan}
                        duration={contentEnd}
                        readonly={
                          context.readonly ||
                          !!doc.tracks.find((t) => t.id === selectedTrackId)?.locked
                        }
                        onPanChange={(pan) => updateTrack(selectedTrackId, { pan })}
                        onInteractionStart={beginPropertyGesture}
                        onInteractionEnd={endPropertyGesture}
                      />
                      <AudioProcessingControls
                        scope="track"
                        value={doc.tracks.find((t) => t.id === selectedTrackId)?.processing}
                        readonly={
                          context.readonly ||
                          !!doc.tracks.find((t) => t.id === selectedTrackId)?.locked
                        }
                        onChange={(processing) => updateTrack(selectedTrackId, { processing })}
                      />
                    </>
                  )}
                {selectedIds.length > 1 && (
                  <Text size="xs">已选 {selectedIds.length} 个片段 · Ctrl / Shift 多选</Text>
                )}
                {inspectorView === 'refine' &&
                  [...doc.visuals, ...doc.sounds].some((clip) => selectedIds.includes(clip.id)) && (
                    <VideoLinkControls
                      document={doc}
                      selectedIds={selectedIds}
                      readonly={context.readonly}
                      onApply={(next, ids) => {
                        stopPlayback()
                        change(next)
                        setSelectedIds(ids)
                      }}
                    />
                  )}
                {inspectorView === 'refine' &&
                  (selection?.type === 'visual' || selectedCaption) && (
                    <VideoPropertyControls
                      workspaceId={context.workspaceId}
                      draftId={context.draft.id}
                      properties={currentProperties}
                      readonly={context.readonly}
                      onApply={(properties) => {
                        const result = applyVideoProperties(
                          docRef.current,
                          selectedIds,
                          properties,
                          {
                            readonly: context.readonly
                          }
                        )
                        if (result.appliedIds.length) change(result.document)
                        return result
                      }}
                    />
                  )}
                {selectedClip &&
                selection &&
                (selection.type === 'visual' || selection.type === 'sound') ? (
                  <>
                    <Text size="sm" fw={650} lineClamp={2}>
                      {selectedClip.name}
                    </Text>
                    {timingLockReason && (
                      <Text size="xs" c="dimmed" role="status">
                        {timingLockReason}
                      </Text>
                    )}
                    <Stack
                      gap="sm"
                      style={{ display: inspectorView === 'properties' ? undefined : 'none' }}
                    >
                      <Group grow wrap="nowrap">
                        <VideoTimingInput
                          key={`${selectedClip.id}:start`}
                          label="开始时间（秒）"
                          min={0}
                          max={21600 - selectedClip.duration}
                          step={1 / doc.fps}
                          decimalScale={6}
                          value={selectedClip.start}
                          disabled={timingDisabled}
                          onCommit={(value) =>
                            updateClip(selectedClip.id, selection.type as Lane, (clip) => ({
                              ...clip,
                              start: videoFrameTime(value, doc.fps, 0, 21600 - clip.duration)
                            }))?.start ?? selectedClip.start
                          }
                        />
                        <VideoTimingInput
                          key={`${selectedClip.id}:duration`}
                          label="时长（秒）"
                          min={1 / doc.fps}
                          max={21600 - selectedClip.start}
                          step={1 / doc.fps}
                          decimalScale={6}
                          value={selectedClip.duration}
                          disabled={timingDisabled}
                          onCommit={(value) =>
                            updateClip(selectedClip.id, selection.type as Lane, (clip) => ({
                              ...clip,
                              duration: videoFrameTime(
                                value,
                                doc.fps,
                                1 / doc.fps,
                                Math.min(
                                  21600 - clip.start,
                                  clip.reverse ? 30 : 21600,
                                  clip.kind === 'image' || clip.freeze
                                    ? 21600
                                    : (clip.sourceDuration - clip.sourceIn) / clip.rate
                                )
                              )
                            }))?.duration ?? selectedClip.duration
                          }
                        />
                      </Group>
                      {selectedClip.kind !== 'image' && (
                        <>
                          <Group grow wrap="nowrap">
                            <VideoTimingInput
                              key={`${selectedClip.id}:sourceIn`}
                              label="源文件起点（秒）"
                              min={0}
                              max={Math.max(0, selectedClip.sourceDuration - 1 / doc.fps)}
                              step={1 / doc.fps}
                              decimalScale={6}
                              value={selectedClip.sourceIn}
                              disabled={timingDisabled}
                              onCommit={(value) =>
                                updateClip(selectedClip.id, selection.type as Lane, (clip) => {
                                  const sourceIn = videoFrameTime(
                                    value,
                                    doc.fps,
                                    0,
                                    Math.max(0, clip.sourceDuration - clip.rate / doc.fps)
                                  )
                                  return {
                                    ...clip,
                                    sourceIn,
                                    duration: clip.freeze
                                      ? clip.duration
                                      : Math.min(
                                          clip.duration,
                                          (clip.sourceDuration - sourceIn) / clip.rate
                                        )
                                  }
                                })?.sourceIn ?? selectedClip.sourceIn
                              }
                            />
                            <VideoTimingInput
                              key={`${selectedClip.id}:rate`}
                              label="速度"
                              min={0.25}
                              max={4}
                              step={0.05}
                              decimalScale={2}
                              value={selectedClip.rate}
                              disabled={timingDisabled}
                              onCommit={(value) =>
                                updateClip(selectedClip.id, selection.type as Lane, (clip) => {
                                  const rate = bounded(value, 0.25, 4)
                                  return {
                                    ...clip,
                                    rate,
                                    duration: clip.freeze
                                      ? clip.duration
                                      : Math.min(
                                          clip.duration,
                                          (clip.sourceDuration - clip.sourceIn) / rate
                                        )
                                  }
                                })?.rate ?? selectedClip.rate
                              }
                            />
                          </Group>
                          <Text size="xs" c="dimmed">
                            源文件 {formatTime(selectedClip.sourceDuration)}
                            {selectedClip.linkId
                              ? '；时间调整同步到关联片段。'
                              : '；画面和声音片段可分别调整。'}
                          </Text>
                        </>
                      )}
                      {selection.type === 'sound' && (
                        <>
                          <AudioSourceStreamSelect
                            key={`${context.draft.id}:${selectedClip.id}`}
                            workspaceId={context.workspaceId}
                            path={selectedClip.path}
                            kind={selectedClip.kind === 'video' ? 'video' : 'audio'}
                            value={selectedClip.audioStream ?? 0}
                            sourceIn={selectedClip.sourceIn}
                            duration={selectedClip.duration}
                            rate={selectedClip.rate}
                            freeze={selectedClip.freeze}
                            readonly={context.readonly || clipLocked(doc, selectedClip, 'sound')}
                            onChange={(audioStream, sourceDuration) => {
                              stopPlayback()
                              updateClip(selectedClip.id, 'sound', (clip) => ({
                                ...clip,
                                audioStream,
                                sourceDuration
                              }))
                            }}
                          />
                          <Text size="xs" fw={600}>
                            片段音量 · {Math.round(selectedClip.gain * 100)}%
                          </Text>
                          <Slider
                            min={0}
                            max={4}
                            step={0.01}
                            value={(propertyClip ?? selectedClip).gain}
                            disabled={context.readonly || clipLocked(doc, selectedClip, 'sound')}
                            onChange={(value) =>
                              updateClip(selectedClip.id, 'sound', (clip) => ({
                                ...clip,
                                gain: value
                              }))
                            }
                            onPointerDown={beginPropertyGesture}
                            onPointerCancel={() => endPropertyGesture(true)}
                            onChangeEnd={() => endPropertyGesture()}
                          />
                          <VideoSoundPanel
                            clip={propertyClip ?? selectedClip}
                            disabled={context.readonly || clipLocked(doc, selectedClip, 'sound')}
                            editGain={editSoundGain}
                            onEditGainChange={setEditSoundGain}
                            onInteractionStart={beginPropertyGesture}
                            onInteractionEnd={endPropertyGesture}
                            onChange={(next) => updateClip(selectedClip.id, 'sound', () => next)}
                          />
                        </>
                      )}
                      <Select
                        label="所在轨道"
                        value={trackIdFor(selectedClip, selection.type as Lane)}
                        disabled={
                          context.readonly || clipLocked(doc, selectedClip, selection.type as Lane)
                        }
                        data={doc.tracks
                          .filter(
                            (t) => t.kind === (selection.type === 'visual' ? 'video' : 'audio')
                          )
                          .map((t) => ({ value: t.id, label: t.name, disabled: !!t.locked }))}
                        onChange={(value) => {
                          if (value)
                            updateClip(selectedClip.id, selection.type as Lane, (c) => ({
                              ...c,
                              trackId: value
                            }))
                        }}
                      />
                    </Stack>
                    <VideoClipProperties
                      localPanel={
                        selection.type === 'visual' ? (
                          <VideoLocalEffects
                            key={selectedClip.id}
                            value={(propertyClip ?? selectedClip).localEffects}
                            readonly={context.readonly || clipLocked(doc, selectedClip, 'visual')}
                            frame={editingFrame}
                            aspectRatio={doc.width / doc.height}
                            onInteractionStart={beginPropertyGesture}
                            onInteractionEnd={endPropertyGesture}
                            onChange={(localEffects) =>
                              updateClip(selectedClip.id, 'visual', (clip) => ({
                                ...clip,
                                localEffects
                              }))
                            }
                          />
                        ) : undefined
                      }
                      trimPanel={
                        <VideoPrecisionTrim
                          document={doc}
                          clipId={selectedClip.id}
                          lane={selection.type as Lane}
                          readonly={context.readonly}
                          onApply={(next) => {
                            stopPlayback()
                            setPrecisionPreview(null)
                            change(next)
                          }}
                          onPreview={(request) => {
                            setPrecisionPreview(request)
                            setPlayhead(request.start)
                            startPlayback(true)
                          }}
                        />
                      }
                      section={inspectorView === 'refine' ? 'refine' : 'basic'}
                      clip={propertyClip ?? selectedClip}
                      visual={selection.type === 'visual'}
                      disabled={
                        context.readonly || clipLocked(doc, selectedClip, selection.type as Lane)
                      }
                      timingDisabled={timingDisabled}
                      playhead={playhead}
                      doc={displayDoc}
                      fps={doc.fps}
                      onSeek={seekTime}
                      onChangeDocument={change}
                      onInteractionStart={beginPropertyGesture}
                      onInteractionEnd={endPropertyGesture}
                      onChange={(next) =>
                        updateClip(selectedClip.id, selection.type as Lane, () => next)
                      }
                      onUnlink={unlink}
                    />
                    <Group justify="space-between" mt="xs">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconScissors size={14} />}
                        onClick={splitSelection}
                        disabled={
                          context.readonly ||
                          playhead <= selectedClip.start + 0.1 ||
                          playhead >= selectedClip.start + selectedClip.duration - 0.1
                        }
                      >
                        拆分片段
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={() => removeSelection()}
                        disabled={context.readonly}
                      >
                        删除
                      </Button>
                    </Group>
                  </>
                ) : selectedCaption ? (
                  <>
                    <Textarea
                      label="文字内容"
                      autosize
                      minRows={3}
                      maxRows={8}
                      maxLength={5000}
                      value={selectedCaption.text}
                      disabled={context.readonly}
                      onChange={(event) =>
                        change({
                          ...doc,
                          captions: doc.captions.map((cue) =>
                            cue.id === selectedCaption.id
                              ? { ...cue, text: event.currentTarget.value }
                              : cue
                          )
                        })
                      }
                    />
                    <Group grow wrap="nowrap">
                      <VideoTimingInput
                        key={`${selectedCaption.id}:start`}
                        label="开始时间（秒）"
                        min={0}
                        step={1 / doc.fps}
                        decimalScale={6}
                        value={selectedCaption.start}
                        disabled={context.readonly}
                        onCommit={(value) => {
                          const start = videoFrameTime(
                            value,
                            doc.fps,
                            0,
                            21600 - selectedCaption.duration
                          )
                          change({
                            ...doc,
                            captions: doc.captions.map((cue) =>
                              cue.id === selectedCaption.id ? { ...cue, start } : cue
                            )
                          })
                          return start
                        }}
                      />
                      <VideoTimingInput
                        key={`${selectedCaption.id}:duration`}
                        label="持续时长（秒）"
                        min={1 / doc.fps}
                        step={1 / doc.fps}
                        decimalScale={6}
                        value={selectedCaption.duration}
                        disabled={context.readonly}
                        onCommit={(value) => {
                          const duration = videoFrameTime(
                            value,
                            doc.fps,
                            1 / doc.fps,
                            21600 - selectedCaption.start
                          )
                          change({
                            ...doc,
                            captions: doc.captions.map((cue) =>
                              cue.id === selectedCaption.id ? { ...cue, duration } : cue
                            )
                          })
                          return duration
                        }}
                      />
                    </Group>
                    <CaptionProperties
                      cue={selectedCaption}
                      disabled={context.readonly}
                      onChange={(next) =>
                        change({
                          ...doc,
                          captions: doc.captions.map((c) => (c.id === next.id ? next : c))
                        })
                      }
                    />
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      disabled={context.readonly}
                      onClick={() => removeSelection()}
                    >
                      删除字幕
                    </Button>
                  </>
                ) : selectedMarker ? (
                  <>
                    <TextInput
                      label="标记名称"
                      value={selectedMarker.name}
                      maxLength={120}
                      disabled={context.readonly}
                      onChange={(event) =>
                        change({
                          ...doc,
                          markers: doc.markers.map((marker) =>
                            marker.id === selectedMarker.id
                              ? { ...marker, name: event.currentTarget.value }
                              : marker
                          )
                        })
                      }
                    />
                    <VideoTimingInput
                      key={`${selectedMarker.id}:time`}
                      label="时间（秒）"
                      min={0}
                      max={21600}
                      step={1 / doc.fps}
                      decimalScale={6}
                      value={selectedMarker.time}
                      disabled={context.readonly}
                      onCommit={(value) => {
                        const time = videoFrameTime(value, doc.fps)
                        change({
                          ...doc,
                          markers: doc.markers.map((marker) =>
                            marker.id === selectedMarker.id ? { ...marker, time } : marker
                          )
                        })
                        return time
                      }}
                    />
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      disabled={context.readonly}
                      onClick={() => removeSelection()}
                    >
                      删除标记
                    </Button>
                  </>
                ) : (
                  <Text size="xs" c="dimmed">
                    在时间线上选择片段、字幕或标记。
                  </Text>
                )}
              </Stack>
            </Stack>
          </ScrollArea>
        </aside>
      </div>
      <div className="video-studio-materials">
        <MaterialBar
          embedded
          items={assets}
          assetInfo={assetInfo}
          activePath={selectedClip?.path}
          usedPaths={[...doc.visuals, ...doc.sounds].map((clip) => clip.path)}
          readonly={context.readonly}
          selectAction="add"
          clickMode={materialClickMode}
          onClickModeChange={(mode) => setMaterialClickMode(mode === 'view' ? 'view' : 'add')}
          onSelect={(asset) =>
            asset.kind === 'image'
              ? void addAsset(asset)
              : (stopPlayback(), setSourceRangeAsset(asset))
          }
          actions={(asset) =>
            asset.kind === 'image'
              ? []
              : [{ key: 'source-range', label: '选段添加', disabled: context.readonly }]
          }
          onAction={(asset, key) => {
            if (key === 'source-range') {
              stopPlayback()
              setSourceRangeAsset(asset)
            }
          }}
          onPreview={(asset) => setPreviewPath(asset.path)}
          onDragStart={(asset, event) =>
            event.dataTransfer.setData('application/x-omnigallery-editor-asset', asset.path)
          }
          onAdd={() => setPickerOpen(true)}
        />
      </div>
      <SourceRangePicker
        opened={!!sourceRangeAsset}
        onClose={() => setSourceRangeAsset(null)}
        workspaceId={context.workspaceId}
        asset={sourceRangeAsset}
        readonly={context.readonly}
        initialMode={sourceRangeAsset?.kind === 'video' ? videoAddMode : 'sound'}
        maxDuration={Math.max(0.001, 21600 - playhead)}
        onConfirm={async (selection) => {
          if (!(await addAsset(selection.asset, selection.mode, playhead, undefined, selection)))
            throw new Error('未能添加选段，请检查目标轨道、片段数量和成片时长')
        }}
      />
      <SourceRelinkDialog
        opened={relinkOpen}
        onClose={() => setRelinkOpen(false)}
        workspaceId={context.workspaceId}
        sources={videoRelinkSources(doc)}
        assets={assets}
        readonly={context.readonly}
        onConfirm={async (selection) => {
          stopPlayback()
          media.invalidate(selection.replacement.path)
          media.clearError()
          failedOriginalPreviews.current.clear()
          const info = await media.load(selection.replacement, true)
          if (!sourceAddPolicy.current.live || sourceAddPolicy.current.readonly) return
          const source = videoRelinkSources(docRef.current).find(
            (item) => item.path === selection.source.path
          )
          if (!source) throw new Error('原素材的片段已变化，请重新选择')
          change(
            relinkVideoSources(
              docRef.current,
              sourceRelinkSelection(
                source,
                selection.replacement,
                sourceMetadata(info, selection.replacement.kind)
              )
            )
          )
        }}
      />
      <ProjectSourcesDialog
        opened={projectSourcesOpen}
        onClose={() => setProjectSourcesOpen(false)}
        workspaceId={context.workspaceId}
        draftId={context.draft.id}
        kind="video"
        sources={projectRelinkSources(doc, 'video')}
        lockedPaths={projectLockedSourcePaths(doc, 'video')}
        readonly={context.readonly || !!initial.loadError}
        onConfirm={(selections) => {
          if (!sourceAddPolicy.current.live || initial.loadError)
            throw new Error('当前制作文件不可写')
          stopPlayback()
          const next = applyProjectSourceRelinks(
            docRef.current,
            'video',
            selections,
            sourceAddPolicy.current.readonly
          )
          for (const selection of selections) media.invalidate(selection.replacement.path)
          media.clearError()
          failedOriginalPreviews.current.clear()
          change(next)
        }}
      />
      <VideoSubtitleWorkspace
        opened={subtitlesOpen}
        onClose={() => setSubtitlesOpen(false)}
        captions={doc.captions}
        selectedId={selection?.type === 'caption' ? selection.id : undefined}
        fps={doc.fps}
        readonly={context.readonly}
        showSafeArea={showSafeArea}
        onSafeAreaChange={setShowSafeArea}
        onSelect={(id, time) => {
          stopPlayback()
          setSelection({ id, type: 'caption' })
          setPlayhead(time)
        }}
        onChange={(captions) => change({ ...docRef.current, captions })}
      />
      <WorkbenchMediaPicker
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={importPicked}
        alreadyAdded={assets.map((asset) => asset.path)}
      />
      <MediaPreview
        files={previewFiles}
        index={previewPath ? previewFiles.findIndex((file) => file.fullpath === previewPath) : null}
        onClose={() => setPreviewPath('')}
        onIndexChange={(index) => setPreviewPath(previewFiles[index]?.fullpath || '')}
        readonly={context.readonly}
      />
      <Modal
        opened={exportOpen}
        onClose={() => {
          if (!exporting) setExportOpen(false)
        }}
        closeOnClickOutside={!exporting}
        closeOnEscape={!exporting}
        withCloseButton={!exporting}
        title="导出 MP4 成片"
        centered
      >
        <Stack gap="md">
          <SegmentedControl
            value={exportRange && validExportRange ? 'range' : 'all'}
            onChange={(v) => setExportRange(v === 'range')}
            data={[
              { value: 'all', label: '整条时间线' },
              { value: 'range', label: '入点至出点', disabled: !validExportRange }
            ]}
          />
          <Text size="sm" c="dimmed">
            {doc.width} × {doc.height} · {doc.fps} fps ·{' '}
            {formatTime(
              exportRange && validExportRange
                ? validExportRange.end - validExportRange.start
                : contentEnd
            )}
            。画面按时间叠放，声音轨混音，字幕烧录到画面。
          </Text>
          <Text size="sm" fw={600}>
            {exportRange && validExportRange
              ? `导出选区：${formatTime(validExportRange.start)} – ${formatTime(validExportRange.end)}`
              : `导出整条时间线：00:00.000 – ${formatTime(contentEnd)}`}
          </Text>
          <TextInput
            label="产物名称"
            value={exportName}
            maxLength={120}
            disabled={exporting}
            onChange={(event) => setExportName(event.currentTarget.value)}
          />
          {error && <Alert color="red">{error}</Alert>}
          {exporting && (
            <Text size="xs" c="dimmed">
              正在提交导出任务…
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={exporting} onClick={() => setExportOpen(false)}>
              取消
            </Button>
            <Button
              loading={exporting}
              disabled={!exportName.trim()}
              onClick={() => void exportVideo()}
            >
              导出到工作区
            </Button>
          </Group>
        </Stack>
      </Modal>
    </section>
  )
}
