import EditorRecoveryPanel from './EditorRecoveryPanel'
import AudioMixPreparation from './AudioMixPreparation'
import TimelineRuler from './TimelineRuler'
import TimelineViewport, { TimelineRow } from './TimelineViewport'
import TimelineMarkerMenu from './TimelineMarkerMenu'
import TimelineTransport from './TimelineTransport'
import TimelineTrackAction from './TimelineTrackAction'
import TimelineTrackHeader from './TimelineTrackHeader'
import TimelineTrackHeightMenu from './TimelineTrackHeightMenu'
import { TIMELINE_STANDARD_TRACK_HEIGHT, TIMELINE_TRACK_HEADER_WIDTH } from './timelineLayout'
import TimelineTrimHandles from './TimelineTrimHandles'
import { useTimelineZoom } from './useTimelineZoom'
import { useFrameAction } from './useFrameAction'
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
  Popover,
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
  IconMusic,
  IconPhoto,
  IconPlus,
  IconWaveSine,
  IconFrame,
  IconCut,
  IconX,
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
  IconArrowUp,
  IconArrowDown,
  IconCopy,
  IconClipboard,
  IconAdjustments
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
  type Caption,
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
  sliceClip
} from './videoStudioModel'
import VideoClipProperties, { CaptionProperties } from './VideoClipProperties'
import VideoTimingInput from './VideoTimingInput'
import { videoPreviewActive, videoPreviewTime } from './videoPreviewPosition'
import {
  editVideoClip,
  fitVideoTimeline,
  snapVideoTime,
  trimVideoCaption,
  videoSnapPoints,
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
import SourceRepairButton from './SourceRepairButton'
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
import TimelineSoundEditor, { SoundClipFadePreview } from './TimelineSoundEditor'
import VideoSoundPanel from './VideoSoundPanel'
import VideoLinkControls from './VideoLinkControls'
import { linkSelectedVideoClips, unlinkVideoClips } from './videoLinks'
import { contextVideoSelection, videoSelectionLocked } from './videoContextSelection'
import { videoAudioClip, patchVideoSound } from './videoSoundProperties'
import { seamAuditionRange } from '../../../src/features/media-editor/model/audioEnvelopeEditing'
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
interface DragBase {
  id: string
  mode: 'move' | 'left' | 'right'
  x: number
  ids: string[]
  offsets: number[]
  snapPoints: readonly number[]
}
type DragState = DragBase &
  (
    | { lane: Lane; original: VideoClip; lastPreview?: VideoClip }
    | { lane: 'caption'; original: Caption; lastPreview?: Caption }
  )
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
  helpAction,
  renameAction
}: {
  context: EditorContext
  onBeforeLeave?: RegisterEditorBeforeLeave
  renameAction?: ReactNode
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
  const [selectedTrackId, setSelectedTrackId] = useState(
    initial.document.tracks[0]?.id ?? 'video-1'
  )
  const [addMode, setAddMode] = useState<'overlay' | 'insert' | 'overwrite'>('overlay')
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [exportRange, setExportRange] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(190)
  const [trackHeight, setTrackHeight] = useState<number>(TIMELINE_STANDARD_TRACK_HEIGHT)
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
  const [zoomFocused, setZoomFocused] = useState(false)
  const [snapping, setSnapping] = useState(true)
  const [loop, setLoop] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [inspectorView, setInspectorView] = useState('properties')
  const [toolOpen, setToolOpen] = useState<
    'picture' | 'trim' | 'presets' | 'markers' | 'tracks' | null
  >(null)
  const [pictureTab, setPictureTab] = useState('crop')
  const [cropRequest, setCropRequest] = useState<{ clipId: string; sequence: number }>()
  const [exportOpen, setExportOpen] = useState(false)
  const [exportName, setExportName] = useState(`${context.draft.name || '视频成片'}.mp4`)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sourceRangeAsset, setSourceRangeAsset] = useState<WorkspaceAsset | null>(null)
  const [relinkOpen, setRelinkOpen] = useState(false)
  const [relinkSourcePath, setRelinkSourcePath] = useState<string | null>(null)
  const [projectSourcesOpen, setProjectSourcesOpen] = useState(false)
  const [subtitlesOpen, setSubtitlesOpen] = useState(false)
  const [showSafeArea, setShowSafeArea] = useState(false)
  const [editingFrame, setEditingFrame] = useState<HTMLCanvasElement | null>(null)
  const [precisionPreview, setPrecisionPreview] = useState<VideoPrecisionPreview | null>(null)
  const [followPlayhead, setFollowPlayhead] = useState(true)
  const [soundEditorOpen, setSoundEditorOpen] = useState(false)
  const [soundEditorMode, setSoundEditorMode] = useState<'fades' | 'gain'>('fades')
  const [previewPath, setPreviewPath] = useState('')
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
  const dragFrame = useFrameAction()
  const propertyFrame = useFrameAction()
  const marqueeFrame = useFrameAction()
  const dividerFrame = useFrameAction()
  const viewportFrame = useFrameAction()
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
  const laneWidth = Math.max(900, viewport.width, duration * pixelsPerSecond)
  const zoomTimeline = useTimelineZoom(
    timelineRef,
    zoom,
    Math.max(64, Math.min(4096, 16000000 / duration)),
    setZoom,
    zoomFocused ? playhead : null
  )
  const contentEnd = timelineEnd(doc)
  const validExportRange = normalizeTimelineRange(range, contentEnd)
  const rulerTicks = videoRulerTicks(
    duration,
    pixelsPerSecond,
    viewport.left,
    viewport.width,
    doc.fps
  )
  const clipVisible = (item: { start: number; duration: number; id: string }) =>
    item.id === dragRef.current?.id ||
    videoClipVisible(item.start, item.duration, pixelsPerSecond, viewport.left, viewport.width)
  const selectedClip = [...doc.visuals, ...doc.sounds].find((clip) => clip.id === selection?.id)
  const timingLockReason =
    selectedClip && selection
      ? videoTimingLockReason(doc, selectedClip, selection.type as Lane)
      : ''
  const timingDisabled = context.readonly || !!timingLockReason
  const activeTrackId =
    selection?.type === 'caption'
      ? undefined
      : selectedClip
        ? trackIdFor(selectedClip, selection?.type === 'sound' ? 'sound' : 'visual')
        : selectedTrackId
  const inspectorTrack = !selection
    ? doc.tracks.find((track) => track.id === activeTrackId)
    : undefined
  const relatedTrackIds = new Set([
    ...doc.visuals
      .filter((clip) => selectedIds.includes(clip.id))
      .map((clip) => trackIdFor(clip, 'visual')),
    ...doc.sounds
      .filter((clip) => selectedIds.includes(clip.id))
      .map((clip) => trackIdFor(clip, 'sound'))
  ])
  const captionTrackRelated = doc.captions.some((cue) => selectedIds.includes(cue.id))
  const selectedCaption = doc.captions.find((cue) => cue.id === selection?.id)
  const selectedMarker = doc.markers.find((marker) => marker.id === selection?.id)
  const displayDoc = precisionPreview?.document ?? dragDocument ?? doc
  const propertyClip =
    selectedClip &&
    [...displayDoc.visuals, ...displayDoc.sounds].find((clip) => clip.id === selectedClip.id)
  const soundEditorClip = selection?.type === 'sound' ? propertyClip : undefined
  const soundEditorVisible = soundEditorOpen && !!soundEditorClip
  const selectionLocked = videoSelectionLocked(doc, selectedIds)
  const selectionMutable = !!selectedIds.length && !context.readonly && !selectionLocked
  const selectionSplittable =
    selectionMutable &&
    [...doc.visuals, ...doc.sounds, ...doc.captions].some(
      (item) =>
        selectedIds.includes(item.id) &&
        playhead > item.start &&
        playhead < item.start + item.duration
    )
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
  const playbackRange = loop && !precisionPreview ? normalizeTimelineRange(range, contentEnd) : null
  const playbackEnd = precisionPreview?.end ?? playbackRange?.end ?? timelineEnd(displayDoc)
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
    const request = { document: displayDoc, end: playbackEnd, loop: playbackRange ?? undefined }
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
    playbackRange?.start,
    playbackRange?.end,
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
    const measure = () =>
      setViewport((current) => {
        const left = element.scrollLeft,
          width = element.clientWidth
        return current.left === left && current.width === width ? current : { left, width }
      })
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
      propertyFrame.schedule(() => setDragDocument(next))
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
      if (!nextRange) {
        setExportRange(false)
        setLoop(false)
      }
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
    stopPlayback()
    propertyFrame.cancel()
    stageGesture.current = { before: docRef.current, next: docRef.current }
  }
  function endPropertyGesture(cancel = false) {
    propertyFrame.cancel()
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
    retainSoundSelection(previous)
    change(previous, false)
  }

  function redo() {
    if (context.readonly || initial.loadError || dragRef.current || stageGesture.current) return
    const next = history.current.future.pop()
    if (!next) return
    history.current.past.push(docRef.current)
    stopPlayback()
    retainSoundSelection(next)
    change(next, false)
  }
  function retainSoundSelection(document: VideoTimelineDocument) {
    if (
      soundEditorOpen &&
      selection?.type === 'sound' &&
      document.sounds.some((clip) => clip.id === selection.id)
    )
      setSelectedIds(linkedSelection(document, [selection.id]))
    else setSelection(null)
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
      if (!typing && (dragRef.current || marqueeRef.current)) {
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelClipDrag()
          marqueeFrame.cancel()
          marqueeRef.current = null
          setMarquee(null)
        }
        return
      }
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
          timelineItem: !!target.closest('[data-clip-id], .timeline-trim-handle'),
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
        if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault()
          seekTime(event.key === 'Home' ? 0 : contentEnd)
        }
        if (event.key.toLowerCase() === 's' && !event.altKey) {
          event.preventDefault()
          splitSelection()
        }
        if (event.key.toLowerCase() === 'm' && !event.altKey) {
          event.preventDefault()
          addMarker()
        }
        if (event.key === 'Escape') {
          setSelection(null)
          changeRange(null)
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          seekTime(
            bounded(
              playhead +
                ((event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1)) / doc.fps,
              0,
              21600
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
          event.preventDefault()
          if (next) changeRange(next)
        }
      }
      if (!typing && (event.ctrlKey || event.metaKey)) {
        if (['c', 'x'].includes(event.key.toLowerCase())) {
          event.preventDefault()
          copySelection(event.key.toLowerCase() === 'x')
        }
        if (event.key.toLowerCase() === 'v') {
          event.preventDefault()
          pasteSelection()
        }
        if (event.key.toLowerCase() === 'a') {
          event.preventDefault()
          const ids = [...doc.visuals, ...doc.sounds, ...doc.captions].map((c) => c.id)
          setSelectedIds(ids)
          const first = doc.visuals[0] ?? doc.sounds[0] ?? doc.captions[0]
          if (first)
            setSelectionState({
              id: first.id,
              type: doc.visuals.length ? 'visual' : doc.sounds.length ? 'sound' : 'caption'
            })
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
  }, [
    doc,
    selection,
    selectedIds,
    playhead,
    range,
    loop,
    saving,
    context.readonly,
    soundEditorOpen
  ])
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
        const end = playbackEnd
        if (playbackRange && next >= end)
          return playbackRange.start + ((next - playbackRange.start) % (end - playbackRange.start))
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
  }, [
    playing,
    doc,
    buffering,
    playbackEnd,
    playbackRange?.start,
    playbackRange?.end,
    hasAudibleSounds
  ])
  useEffect(() => {
    const element = timelineRef.current
    if (!playing || !followPlayhead || !element) return
    const left = followTimelineViewport({
      position: playhead,
      pixelsPerSecond,
      scrollLeft: element.scrollLeft,
      viewportWidth: element.clientWidth,
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
  const precisionSelectionRef = useRef(selection?.id)
  useEffect(() => {
    const changedSelection = precisionSelectionRef.current !== selection?.id
    precisionSelectionRef.current = selection?.id
    if (precisionPreview && (toolOpen !== 'trim' || changedSelection || timingDisabled))
      stopPlayback()
  }, [toolOpen, selection?.id, timingDisabled, precisionPreview])
  function seekTime(time: number, focusZoom = true) {
    audioSession.current = false
    audioPreview.stop()
    stopPlayback()
    setPrecisionPreview(null)
    setPlayhead(clampTimelinePosition(time, 21600))
    if (focusZoom) setZoomFocused(true)
  }
  function changeRange(next: { start: number; end: number } | null) {
    stopPlayback()
    const normalized = normalizeTimelineRange(next, contentEnd)
    setRange(normalized)
    if (!normalized) {
      setLoop(false)
      setExportRange(false)
    }
  }
  function startPlayback(force?: boolean) {
    setWaitingSources([])
    if (playing && force === undefined) {
      audioSession.current = false
      audioPreview.stop()
      setPrecisionPreview(null)
    } else if (force === undefined && !precisionPreview) {
      if (playbackRange && (playhead < playbackRange.start || playhead >= playbackRange.end))
        setPlayhead(playbackRange.start)
      else if (playhead >= timelineEnd(docRef.current)) setPlayhead(0)
    }
    setPlaying((v) => force ?? !v)
  }
  function openSoundEditor(mode: 'fades' | 'gain' = 'fades', clip?: VideoClip) {
    if (clip) setSelection({ id: clip.id, type: 'sound' })
    setSoundEditorMode(mode)
    setSoundEditorOpen(true)
  }
  function auditionSoundSeam(edge: 'start' | 'end') {
    if (!soundEditorClip) return
    const next = normalizeTimelineRange(
      seamAuditionRange(videoAudioClip(soundEditorClip), edge, contentEnd),
      contentEnd
    )
    if (!next) return
    stopPlayback()
    setRange(next)
    setLoop(true)
    setPlayhead(next.start)
    startPlayback(true)
  }
  function locateTime(time: number) {
    seekTime(time)
    const element = timelineRef.current
    if (element)
      element.scrollLeft = followTimelineViewport({
        position: time,
        pixelsPerSecond,
        scrollLeft: element.scrollLeft,
        viewportWidth: element.clientWidth,
        contentDuration: duration
      })
  }
  function navigatePoint(direction: 'next' | 'previous') {
    const next = nextTimelinePoint(
      timelineNavigationPoints(
        [...doc.visuals, ...doc.sounds, ...doc.captions],
        [{ time: 0 }, ...doc.markers]
      ),
      playhead,
      direction
    )
    if (next !== undefined) locateTime(next)
  }

  function snapTime(time: number, exceptIds: string[] = [], offsets = [0], bypass = false) {
    return snapVideoTime(time, doc, {
      pixelsPerSecond,
      playhead,
      enabled: snapping && !bypass,
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
    else if (result.document !== base) change(result.document)
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
      sourceSelection?.placementMode ?? addMode
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
  function addMarker(at = playhead) {
    if (context.readonly || doc.markers.length >= 256) return
    const marker = {
      id: crypto.randomUUID(),
      name: `标记 ${doc.markers.length + 1}`,
      time: videoFrameTime(at, doc.fps)
    }
    change({ ...doc, markers: [...doc.markers, marker] })
    setInspectorView('properties')
    setSelection({ type: 'marker', id: marker.id })
  }
  function removeSelection(ripple = false) {
    if (!selection || context.readonly) return
    let next = removeClips(doc, selectedIds, ripple)
    if (next === doc) {
      setError('选中或关联轨道已锁定，请先解锁后删除')
      return
    }
    next = {
      ...next,
      captions: next.captions.filter((c) => !selectedIds.includes(c.id)),
      markers: next.markers.filter((m) => !selectedIds.includes(m.id))
    }
    change(next)
    setSelection(null)
  }
  function splitSelection() {
    if (selectionSplittable) change(splitClips(doc, selectedIds, videoFrameTime(playhead, doc.fps)))
  }
  function copySelection(cut = false) {
    if (cut && context.readonly) return
    const next = cut ? removeClips(doc, selectedIds) : doc
    if (cut && next === doc) {
      setError('选中或关联轨道已锁定，请先解锁后剪切')
      return
    }
    clipboard.current = copyClips(doc, selectedIds)
    if (cut) {
      change(next)
      setSelection(null)
    }
    setStatus(
      `已${cut ? '剪切' : '复制'} ${clipboard.current.visuals.length + clipboard.current.sounds.length + (clipboard.current.captions?.length ?? 0)} 项`
    )
  }
  function pasteSelection(at = playhead, source = clipboard.current) {
    if (context.readonly || !source) return
    const next = pasteClips(doc, source, at)
    if (next === doc) {
      setError('粘贴内容为空、目标轨道已锁定，或粘贴位置超出时间线范围')
      return
    }
    change(next)
    if (docRef.current !== next) return
    const existing = new Set(
      [...doc.visuals, ...doc.sounds, ...doc.captions].map((item) => item.id)
    )
    const visuals = next.visuals.filter((item) => !existing.has(item.id))
    const sounds = next.sounds.filter((item) => !existing.has(item.id))
    const captions = next.captions.filter((item) => !existing.has(item.id))
    setSelectedIds([...visuals, ...sounds, ...captions].map((item) => item.id))
    const first = visuals[0] ?? sounds[0] ?? captions[0]
    setSelectionState(
      first
        ? { id: first.id, type: visuals.length ? 'visual' : sounds.length ? 'sound' : 'caption' }
        : null
    )
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
  function selectContextItem(target: NonNullable<Selection>) {
    stopPlayback()
    setSelectedIds(contextVideoSelection(docRef.current, selectedIds, target.id))
    setSelectionState(target)
    setInspectorView('properties')
  }
  function applyContextLink(unlink = false) {
    const result = unlink
      ? unlinkVideoClips(docRef.current, selectedIds, context.readonly)
      : linkSelectedVideoClips(docRef.current, selectedIds, { readonly: context.readonly })
    if (result.error) setError(result.error)
    else if (result.changedIds.length) change(result.document)
  }
  function duplicateSelection() {
    if (!selectionMutable) return
    const copy = copyClips(docRef.current, selectedIds)
    const items = [...copy.visuals, ...copy.sounds, ...(copy.captions ?? [])]
    if (items.length)
      pasteSelection(Math.max(...items.map((item) => item.start + item.duration)), copy)
  }
  function replaceSelectedSource() {
    if (
      !selectedClip ||
      context.readonly ||
      projectLockedSourcePaths(doc, 'video').includes(selectedClip.path)
    )
      return
    stopPlayback()
    setRelinkSourcePath(selectedClip.path)
    setRelinkOpen(true)
  }
  function renderTimelineMenu(blank = false) {
    const members = [...doc.visuals, ...doc.sounds].filter((clip) => selectedIds.includes(clip.id))
    const hasVisual = doc.visuals.some((clip) => selectedIds.includes(clip.id))
    const hasSound = doc.sounds.some((clip) => selectedIds.includes(clip.id))
    const hasLink = members.some((clip) => clip.linkId)
    return (
      <Menu.Dropdown>
        {!blank && (
          <>
            <Menu.Item
              leftSection={<IconCopy size={14} />}
              onClick={() => copySelection()}
              disabled={!selectedIds.length}
            >
              复制
            </Menu.Item>
            <Menu.Item
              leftSection={<IconScissors size={14} />}
              onClick={() => copySelection(true)}
              disabled={!selectionMutable}
            >
              剪切
            </Menu.Item>
            <Menu.Item onClick={duplicateSelection} disabled={!selectionMutable}>
              创建副本
            </Menu.Item>
          </>
        )}
        <Menu.Item
          leftSection={<IconClipboard size={14} />}
          onClick={() => pasteSelection(playhead)}
          disabled={context.readonly || !clipboard.current}
        >
          在播放头粘贴
        </Menu.Item>
        {!blank && (
          <>
            <Menu.Divider />
            <Menu.Item onClick={splitSelection} disabled={!selectionSplittable}>
              在播放头分割
            </Menu.Item>
            <Menu.Item color="red" onClick={() => removeSelection()} disabled={!selectionMutable}>
              删除
            </Menu.Item>
            <Menu.Item
              color="red"
              onClick={() => removeSelection(true)}
              disabled={!selectionMutable || doc.tracks.some((track) => track.locked)}
            >
              删除并闭合空隙
            </Menu.Item>
          </>
        )}
        <Menu.Item
          onClick={() => change(closeGaps(docRef.current))}
          disabled={context.readonly || doc.tracks.some((track) => track.locked)}
        >
          闭合空隙
        </Menu.Item>
        {!blank && !!members.length && (
          <>
            <Menu.Divider />
            <Menu.Item
              onClick={() => applyContextLink()}
              disabled={
                !selectionMutable ||
                !hasVisual ||
                !hasSound ||
                members.every((clip) => !!clip.linkId && clip.linkId === members[0]?.linkId)
              }
            >
              关联音画
            </Menu.Item>
            <Menu.Item
              onClick={() => applyContextLink(true)}
              disabled={!selectionMutable || !hasLink}
            >
              解除关联
            </Menu.Item>
            {selection?.type === 'sound' && (
              <Menu.Item onClick={() => openSoundEditor(soundEditorMode)}>声音编辑</Menu.Item>
            )}
            {selectedClip && (
              <Menu.Item
                onClick={replaceSelectedSource}
                disabled={
                  context.readonly ||
                  projectLockedSourcePaths(doc, 'video').includes(selectedClip.path)
                }
              >
                替换源素材
              </Menu.Item>
            )}
          </>
        )}
      </Menu.Dropdown>
    )
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
  function dragValue(drag: DragState, clientX: number, bypass: boolean) {
    const delta = (clientX - drag.x) / pixelsPerSecond
    const align = (value: number, offsets = [0]) =>
      snapVideoTime(value, doc, {
        pixelsPerSecond,
        playhead,
        enabled: snapping && !bypass,
        offsets,
        points: drag.snapPoints
      })
    if (drag.lane === 'caption') {
      const cue = drag.original
      return drag.mode === 'move'
        ? { ...cue, start: Math.min(21600 - cue.duration, align(cue.start + delta, drag.offsets)) }
        : trimVideoCaption(
            cue,
            drag.mode,
            align(cue.start + (drag.mode === 'right' ? cue.duration : 0) + delta),
            doc.fps
          )
    }
    const clip = drag.original
    if (drag.mode === 'move') {
      return { ...clip, start: align(clip.start + delta, drag.offsets) }
    }
    if (drag.mode === 'left') {
      if (clip.reverse) {
        const cut = bounded(align(clip.start + delta) - clip.start, 0, clip.duration - 1 / doc.fps)
        return sliceClip(clip, cut, clip.duration)
      }
      const nextStart = bounded(
        align(clip.start + delta),
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
    const nextEnd = align(clip.start + clip.duration + delta)
    const nextDuration = rounded(
      bounded(
        nextEnd - clip.start,
        1 / doc.fps,
        clip.reverse ? Math.min(clip.duration, 30) : maxDuration
      )
    )
    return clip.reverse ? sliceClip(clip, 0, nextDuration) : { ...clip, duration: nextDuration }
  }
  function startDrag(
    event: PointerEvent<HTMLButtonElement>,
    clip: VideoClip | Caption,
    lane: Lane | 'caption'
  ) {
    event.stopPropagation()
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    if (context.readonly || (lane !== 'caption' && clipLocked(doc, clip as VideoClip, lane))) {
      setSelection({ id: clip.id, type: lane })
      return
    }
    stopPlayback()
    const group = linkedSelection(doc, [clip.id])
    const ids =
      event.ctrlKey || event.metaKey || event.shiftKey
        ? selectedIds.includes(clip.id)
          ? selectedIds.filter((id) => !group.includes(id))
          : [...selectedIds, ...group]
        : selectedIds.includes(clip.id)
          ? selectedIds
          : group
    setSelectedIds([...new Set(ids)])
    if (!ids.includes(clip.id)) {
      const nextId = ids.at(-1)
      setSelectionState(
        nextId
          ? {
              id: nextId,
              type: doc.visuals.some((item) => item.id === nextId)
                ? 'visual'
                : doc.sounds.some((item) => item.id === nextId)
                  ? 'sound'
                  : doc.captions.some((item) => item.id === nextId)
                    ? 'caption'
                    : 'marker'
            }
          : null
      )
      return
    }
    setSelectionState({ type: lane, id: clip.id })
    if (lane !== 'caption') setSelectedTrackId(trackIdFor(clip as VideoClip, lane))
    const lock =
      (lane !== 'caption' && videoTimingLockReason(doc, clip as VideoClip, lane)) ||
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
    const mode = edge === 'left' || edge === 'right' ? edge : 'move'
    const excluded = mode === 'move' ? ids : linkedSelection(doc, [clip.id])
    const movingIds = new Set(excluded)
    const offsets =
      mode === 'move'
        ? [
            ...new Set(
              [...doc.visuals, ...doc.sounds, ...doc.captions]
                .filter((item) => movingIds.has(item.id))
                .flatMap((item) => [
                  item.start - clip.start,
                  item.start + item.duration - clip.start
                ])
            )
          ]
        : [0]
    dragFrame.cancel()
    const base: DragBase = {
      id: clip.id,
      mode,
      x: event.clientX,
      ids,
      offsets,
      snapPoints: videoSnapPoints(doc, playhead, excluded)
    }
    dragRef.current =
      lane === 'caption'
        ? { ...base, lane, original: clip as Caption }
        : { ...base, lane, original: clip as VideoClip }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || (Math.abs(event.clientX - drag.x) < 3 && !drag.lastPreview)) return
    const clientX = event.clientX,
      bypass = event.shiftKey
    dragFrame.schedule(() => {
      if (dragRef.current !== drag) return
      const next = dragValue(drag, clientX, bypass)
      const previous = drag.lastPreview
      if (
        previous &&
        next.start === previous.start &&
        (!('sourceIn' in next) ||
          ('sourceIn' in previous && next.sourceIn === previous.sourceIn)) &&
        next.duration === previous.duration
      )
        return
      if (drag.lane === 'caption') {
        const caption = next as Caption
        drag.lastPreview = caption
        setDragDocument(
          drag.mode === 'move'
            ? moveClips(doc, drag.ids, next.start - drag.original.start)
            : { ...doc, captions: doc.captions.map((cue) => (cue.id === drag.id ? caption : cue)) }
        )
        return
      }
      drag.lastPreview = next as VideoClip
      setDragPreview(next as VideoClip)
      if (drag.mode === 'move')
        setDragDocument(moveClips(doc, drag.ids, next.start - drag.original.start))
    })
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    dragFrame.cancel()
    const drag = dragRef.current
    if (!drag) return
    if (Math.abs(event.clientX - drag.x) < 3) {
      dragRef.current = null
      setDragPreview(null)
      setDragDocument(null)
      return
    }
    const next = dragValue(drag, event.clientX, event.shiftKey)
    dragRef.current = null
    setDragPreview(null)
    setDragDocument(null)
    if (drag.mode === 'move') {
      change(moveClips(doc, drag.ids, next.start - drag.original.start))
      return
    }
    if (JSON.stringify(next) !== JSON.stringify(drag.original)) {
      if (drag.lane === 'caption')
        change({
          ...doc,
          captions: doc.captions.map((cue) => (cue.id === drag.id ? (next as Caption) : cue))
        })
      else updateClip(drag.id, drag.lane, () => next as VideoClip)
    }
  }
  function cancelClipDrag() {
    dragFrame.cancel()
    dragRef.current = null
    setDragPreview(null)
    setDragDocument(null)
  }
  function resizeTimeline(clientY: number, element: HTMLDivElement) {
    setTimelineHeight(
      bounded(Number(element.dataset.height) + Number(element.dataset.startY) - clientY, 100, 600)
    )
  }
  function endTimelineResize(event: PointerEvent<HTMLDivElement>, cancel = false) {
    const element = event.currentTarget
    if (element.dataset.resizing !== 'true') return
    if (cancel) {
      dividerFrame.cancel()
      setTimelineHeight(Number(element.dataset.height))
    } else dividerFrame.flush(() => resizeTimeline(event.clientY, element))
    delete element.dataset.resizing
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  }

  const sourceRevision = (clip: VideoClip) => context.assetInfo[clip.path]?.date ?? '0'
  const renderClip = (clip: VideoClip, lane: Lane) => {
    const displayed =
      dragDocument?.[lane === 'visual' ? 'visuals' : 'sounds'].find((c) => c.id === clip.id) ??
      (dragPreview?.id === clip.id ? dragPreview : clip)
    const selected = selectedIds.includes(clip.id)
    const geometry = videoClipGeometry(displayed.duration, pixelsPerSecond)
    const nameOffset = Math.max(0, viewport.left - displayed.start * pixelsPerSecond)
    const clipButton = (
      <button
        data-clip-id={clip.id}
        type="button"
        className={`video-timeline-clip kind-${clip.kind} ${lane === 'sound' ? 'is-sound' : ''} ${selected ? 'is-selected' : ''} ${geometry.compact ? 'is-compact' : ''} ${context.readonly ? 'is-readonly' : ''} ${dragPreview?.id === clip.id && dragRef.current?.mode === 'move' ? 'is-dragging' : ''}`}
        onFocus={() => {
          if (!selected && !dragRef.current) setSelection({ id: clip.id, type: lane })
        }}
        onContextMenu={(event) => {
          event.stopPropagation()
          selectContextItem({ id: clip.id, type: lane })
        }}
        onDoubleClick={() => fitTimeline(linkedSelection(doc, [clip.id]))}
        title={`${clip.name} · ${formatTime(clip.duration)} · ${clip.rate}×；双击放大${lane === 'sound' ? '；右键打开声音编辑' : ''}`}
        onPointerDown={(event) => startDrag(event, clip, lane)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={cancelClipDrag}
        onLostPointerCapture={cancelClipDrag}
        aria-label={`${lane === 'visual' ? '画面' : '声音'}：${clip.name}，${formatTime(clip.start)} 至 ${formatTime(clip.start + clip.duration)}`}
      >
        <VideoClipStrip
          clip={displayed}
          lane={lane}
          workspaceId={context.workspaceId}
          left={viewport.left}
          width={viewport.width}
          pixelsPerSecond={pixelsPerSecond}
          imageUrl={mediaUrl(clip.path, clip.name, sourceRevision(clip))}
          sourceRevision={sourceRevision(clip)}
        />
        {!geometry.compact && (
          <span className="video-clip-edge" data-edge="left" aria-hidden="true" />
        )}
        <span className="timeline-sound-clip-title video-clip-title">
          <span
            className="video-clip-title-content"
            style={{
              transform: `translateX(${nameOffset}px)`,
              maxWidth: Math.max(0, Math.min(geometry.width - nameOffset - 12, viewport.width - 12))
            }}
          >
            {lane === 'sound' || clip.kind === 'audio' ? (
              <IconMusic size={13} aria-hidden="true" />
            ) : clip.kind === 'video' ? (
              <IconVideo size={13} aria-hidden="true" />
            ) : (
              <IconPhoto size={13} aria-hidden="true" />
            )}
            <span className="video-clip-title-name">
              {clip.linkId ? '↔ ' : ''}
              {clip.reverse ? '◀ ' : ''}
              {clip.freeze ? '▣ ' : ''}
              {clip.name}
            </span>
          </span>
        </span>
        {lane === 'sound' && selected && <SoundClipFadePreview clip={videoAudioClip(displayed)} />}
        {!geometry.compact && (
          <span className="video-clip-edge" data-edge="right" aria-hidden="true" />
        )}
      </button>
    )
    return (
      <div
        key={clip.id}
        className={`video-timeline-item ${lane === 'sound' ? 'is-sound' : ''} ${selected ? 'is-selected' : ''}`}
        style={{ left: displayed.start * pixelsPerSecond, width: geometry.width }}
      >
        <Menu
          position="bottom-start"
          floatingStrategy="fixed"
          withinPortal
          portalProps={{ target: '.react-editor-shell' }}
        >
          <Menu.ContextMenu>{clipButton}</Menu.ContextMenu>
          {renderTimelineMenu()}
        </Menu>
        {selected && !context.readonly && !videoTimingLockReason(doc, clip, lane) && (
          <TimelineTrimHandles
            name={clip.name}
            viewport={{
              start: displayed.start * pixelsPerSecond,
              end: (displayed.start + displayed.duration) * pixelsPerSecond,
              left: viewport.left,
              width: viewport.width
            }}
            onPointerDown={(event) => startDrag(event, clip, lane)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={cancelClipDrag}
            onLostPointerCapture={cancelClipDrag}
          />
        )}
      </div>
    )
  }

  const renderCaption = (cue: Caption) => {
    const selected = selectedIds.includes(cue.id)
    return (
      <div
        key={cue.id}
        className={`video-timeline-item is-caption ${selected ? 'is-selected' : ''}`}
        style={{ left: cue.start * pixelsPerSecond, width: cue.duration * pixelsPerSecond }}
      >
        <Menu
          position="bottom-start"
          floatingStrategy="fixed"
          withinPortal
          portalProps={{ target: '.react-editor-shell' }}
        >
          <Menu.ContextMenu>
            <button
              type="button"
              data-clip-id={cue.id}
              className={`video-caption-cue ${selected ? 'is-selected' : ''} ${context.readonly ? 'is-readonly' : ''}`}
              aria-pressed={selected}
              aria-label={`字幕：${cue.text}，${formatTime(cue.start)} 至 ${formatTime(cue.start + cue.duration)}`}
              onFocus={() => {
                if (!selected && !dragRef.current) setSelection({ type: 'caption', id: cue.id })
              }}
              onContextMenu={(event) => {
                event.stopPropagation()
                selectContextItem({ type: 'caption', id: cue.id })
              }}
              onDoubleClick={() => fitTimeline([cue.id])}
              onPointerDown={(event) => startDrag(event, cue, 'caption')}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={cancelClipDrag}
              onLostPointerCapture={cancelClipDrag}
            >
              <span className="timeline-text-clip-label">{cue.text}</span>
            </button>
          </Menu.ContextMenu>
          {renderTimelineMenu()}
        </Menu>
        {selected && !context.readonly && (
          <TimelineTrimHandles
            name={cue.text || '字幕'}
            viewport={{
              start: cue.start * pixelsPerSecond,
              end: (cue.start + cue.duration) * pixelsPerSecond,
              left: viewport.left,
              width: viewport.width
            }}
            onPointerDown={(event) => startDrag(event, cue, 'caption')}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={cancelClipDrag}
            onLostPointerCapture={cancelClipDrag}
          />
        )}
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
        {renameAction}
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
              setLoop(false)
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
          <Menu
            opened={toolOpen === 'tracks'}
            onChange={(open) => setToolOpen(open ? 'tracks' : null)}
            position="right-start"
            withinPortal
          >
            <Menu.Target>
              <Tooltip label="添加轨道" position="right">
                <ActionIcon
                  variant="subtle"
                  aria-label="添加轨道"
                  disabled={context.readonly || doc.tracks.length >= 32}
                >
                  <IconPlus size={19} />
                </ActionIcon>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={() => addTrack('video')}>画面轨</Menu.Item>
              <Menu.Item onClick={() => addTrack('audio')}>声音轨</Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Tooltip label="字幕" position="right">
            <ActionIcon
              variant={subtitlesOpen ? 'light' : 'subtle'}
              aria-label="字幕"
              onClick={() => {
                stopPlayback()
                setToolOpen(null)
                setSubtitlesOpen(true)
              }}
            >
              <IconTypography size={19} />
            </ActionIcon>
          </Tooltip>
          <Divider my={4} />
          <Tooltip label="在播放头分割（S）" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="在播放头分割"
              disabled={!selectionSplittable}
              onClick={splitSelection}
            >
              <IconScissors size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="声音编辑" position="right">
            <ActionIcon
              variant={soundEditorVisible ? 'light' : 'subtle'}
              aria-label="声音编辑"
              aria-pressed={soundEditorVisible}
              disabled={!soundEditorClip}
              onClick={() =>
                soundEditorVisible ? setSoundEditorOpen(false) : openSoundEditor(soundEditorMode)
              }
            >
              <IconWaveSine size={19} />
            </ActionIcon>
          </Tooltip>
          <TimelineMarkerMenu
            opened={toolOpen === 'markers'}
            onOpenedChange={(opened) => setToolOpen(opened ? 'markers' : null)}
            markers={doc.markers}
            selectedId={selection?.type === 'marker' ? selection.id : undefined}
            addDisabled={context.readonly || doc.markers.length >= 256}
            onAdd={addMarker}
            onSelect={(id, time) => {
              locateTime(time)
              setInspectorView('properties')
              setSelection({ type: 'marker', id })
            }}
          />
          <Divider my={4} />
          <Popover
            opened={toolOpen === 'picture'}
            onChange={(open) => setToolOpen(open ? 'picture' : null)}
            position="right-start"
            width={460}
            withinPortal
            portalProps={{ target: '.react-editor-shell' }}
            zIndex={64}
          >
            <Popover.Target>
              <Tooltip label="画面" position="right">
                <ActionIcon
                  variant={toolOpen === 'picture' ? 'light' : 'subtle'}
                  aria-label="画面"
                  disabled={selection?.type !== 'visual' || !selectedClip}
                  onClick={() => {
                    stopPlayback()
                    setToolOpen(toolOpen === 'picture' ? null : 'picture')
                  }}
                >
                  <IconFrame size={19} />
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown className="react-editor-tool-popover react-editor-rail-popover video-tool-popover">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text size="sm" fw={700}>
                    画面
                  </Text>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="关闭画面工具"
                    onClick={() => setToolOpen(null)}
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </Group>
                {selectedClip && selection?.type === 'visual' && (
                  <>
                    <Text size="xs" c="dimmed" lineClamp={1}>
                      {selectedClip.name}
                    </Text>
                    <VideoClipProperties
                      section="refine"
                      clip={propertyClip ?? selectedClip}
                      visual
                      disabled={context.readonly || clipLocked(doc, selectedClip, 'visual')}
                      timingDisabled={timingDisabled}
                      playhead={playhead}
                      doc={displayDoc}
                      fps={doc.fps}
                      onSeek={seekTime}
                      onChangeDocument={change}
                      onInteractionStart={beginPropertyGesture}
                      onInteractionEnd={endPropertyGesture}
                      onChange={(next) => updateClip(selectedClip.id, 'visual', () => next)}
                      refineTab={pictureTab}
                      onRefineTabChange={(value) => setPictureTab(value ?? 'crop')}
                      onVisualCrop={
                        editingFrame
                          ? () => {
                              setToolOpen(null)
                              setCropRequest((previous) => ({
                                clipId: selectedClip.id,
                                sequence: (previous?.sequence ?? 0) + 1
                              }))
                            }
                          : undefined
                      }
                      localPanel={
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
                      }
                    />
                  </>
                )}
              </Stack>
            </Popover.Dropdown>
          </Popover>
          <Popover
            opened={toolOpen === 'trim'}
            onChange={(open) => setToolOpen(open ? 'trim' : null)}
            position="right-start"
            width={400}
            withinPortal
            portalProps={{ target: '.react-editor-shell' }}
            zIndex={64}
          >
            <Popover.Target>
              <Tooltip label="精剪" position="right">
                <ActionIcon
                  variant={toolOpen === 'trim' ? 'light' : 'subtle'}
                  aria-label="精剪"
                  disabled={!selectedClip}
                  onClick={() => {
                    stopPlayback()
                    setToolOpen(toolOpen === 'trim' ? null : 'trim')
                  }}
                >
                  <IconCut size={19} />
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown className="react-editor-tool-popover react-editor-rail-popover video-tool-popover">
              <Stack gap="sm">
                <Group justify="space-between">
                  <Text size="sm" fw={700}>
                    精剪
                  </Text>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="关闭精剪"
                    onClick={() => setToolOpen(null)}
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </Group>
                {selectedClip &&
                  selection &&
                  (selection.type === 'visual' || selection.type === 'sound') && (
                    <VideoPrecisionTrim
                      document={doc}
                      clipId={selectedClip.id}
                      lane={selection.type}
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
                  )}
              </Stack>
            </Popover.Dropdown>
          </Popover>
          <VideoPropertyControls
            targetLabel={selectedClip?.name ?? selectedCaption?.text}
            opened={toolOpen === 'presets'}
            onOpenedChange={(opened) => setToolOpen(opened ? 'presets' : null)}
            workspaceId={context.workspaceId}
            draftId={context.draft.id}
            properties={currentProperties}
            readonly={context.readonly}
            onApply={(properties) => {
              const result = applyVideoProperties(docRef.current, selectedIds, properties, {
                readonly: context.readonly
              })
              if (result.appliedIds.length) change(result.document)
              return result
            }}
          />
          <Divider my={4} />
          <SourceRepairButton
            workspaceId={context.workspaceId}
            draftId={context.draft.id}
            kind="video"
            sources={projectRelinkSources(doc, 'video')}
            repairing={projectSourcesOpen || relinkOpen}
            onClick={() => {
              stopPlayback()
              setProjectSourcesOpen(true)
            }}
          />
        </aside>
        <div
          className={`video-studio-main video-workarea ${soundEditorVisible ? 'has-sound-editor' : ''}`}
        >
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
                cropRequest={cropRequest}
                onEditingFrame={setEditingFrame}
                onSelectCaption={(id) => setSelection({ id, type: 'caption' })}
                onInteractionStart={beginPropertyGesture}
                onChangeClip={(clip) => {
                  const base = stageGesture.current?.next ?? docRef.current
                  const next = {
                    ...base,
                    visuals: base.visuals.map((item) => (item.id === clip.id ? clip : item))
                  }
                  change(next)
                }}
                onChangeCaption={(caption) => {
                  const base = stageGesture.current?.next ?? docRef.current
                  const next = {
                    ...base,
                    captions: base.captions.map((item) => (item.id === caption.id ? caption : item))
                  }
                  change(next)
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
              if (e.button !== 0) return
              dividerFrame.cancel()
              e.currentTarget.setPointerCapture(e.pointerId)
              e.currentTarget.dataset.startY = String(e.clientY)
              e.currentTarget.dataset.height = String(timelineHeight)
              e.currentTarget.dataset.resizing = 'true'
            }}
            onPointerMove={(e) => {
              const element = e.currentTarget,
                clientY = e.clientY,
                pointerId = e.pointerId
              if (element.hasPointerCapture(pointerId))
                dividerFrame.schedule(() => {
                  if (element.hasPointerCapture(pointerId)) resizeTimeline(clientY, element)
                })
            }}
            onPointerUp={(e) => endTimelineResize(e)}
            onPointerCancel={(e) => endTimelineResize(e, true)}
            onLostPointerCapture={(e) => endTimelineResize(e, true)}
          />
          <AudioMixPreparation
            job={audioPreview.preparation}
            onCancel={() => {
              stopPlayback()
              void audioPreview.cancelPreparation()
            }}
          />
          <TimelineTransport
            playing={playing}
            buffering={buffering && playing}
            disabled={!timelineEnd(doc)}
            playhead={playhead}
            duration={contentEnd}
            onPlay={() => startPlayback()}
            onSeek={seekTime}
            onStep={(direction) => seekTime(playhead + direction / doc.fps)}
            stepLabels={['上一帧', '下一帧']}
            onNavigate={navigatePoint}
            zoom={zoom}
            maxZoom={Math.max(64, Math.min(4096, 16000000 / duration))}
            onZoom={zoomTimeline}
            onFit={(selected) => fitTimeline(selected ? selectedIds : undefined)}
            selectionDisabled={!selectedIds.length}
            snapping={snapping}
            onSnapping={() => setSnapping((value) => !value)}
            alignmentPrecision="视频帧"
            viewActions={
              <>
                <TimelineTrackHeightMenu
                  label="音画轨高度"
                  value={trackHeight}
                  onChange={setTrackHeight}
                />
                <Popover position="bottom-end" width={300} withinPortal>
                  <Popover.Target>
                    <Button size="compact-xs" variant="subtle">
                      预览设置
                    </Button>
                  </Popover.Target>
                  <Popover.Dropdown style={{ maxHeight: 'min(70vh, 480px)', overflowY: 'auto' }}>
                    <Stack gap="xs">
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
                    </Stack>
                  </Popover.Dropdown>
                </Popover>
              </>
            }
            settings={
              <Menu position="bottom-start" withinPortal>
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
            }
            actions={
              <>
                <Button
                  size="compact-xs"
                  variant={loop ? 'light' : 'subtle'}
                  disabled={!range}
                  aria-pressed={loop}
                  onClick={() => {
                    stopPlayback()
                    setLoop((value) => !value)
                  }}
                >
                  循环选区
                </Button>
              </>
            }
          />
          <TimelineTimeControls
            playhead={playhead}
            range={range}
            duration={timelineEnd(doc)}
            onSeek={seekTime}
            onRangeChange={changeRange}
            step={1 / doc.fps}
            max={21600}
          />
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
          <Menu
            position="bottom-start"
            floatingStrategy="fixed"
            withinPortal
            portalProps={{ target: '.react-editor-shell' }}
          >
            <TimelineViewport
              className="video-timeline-scroll"
              style={
                {
                  height: timelineHeight,
                  '--video-track-height': `${trackHeight}px`
                } as CSSProperties
              }
              width={laneWidth}
              scrollRef={timelineRef}
              corner="时间线"
              ruler={
                <TimelineRuler
                  className="video-ruler-ticks"
                  width={laneWidth}
                  duration={Math.min(duration, 21600)}
                  contentEnd={contentEnd}
                  pixelsPerSecond={pixelsPerSecond}
                  fps={doc.fps}
                  ticks={rulerTicks}
                  viewportLeft={viewport.left}
                  viewportWidth={viewport.width}
                  scrollContainer={timelineRef}
                  playhead={playhead}
                  showPlayhead
                  range={range}
                  step={1 / doc.fps}
                  markers={doc.markers}
                  selectedMarkerId={selection?.type === 'marker' ? selection.id : undefined}
                  markerEditingDisabled={context.readonly || !!initial.loadError}
                  markerAddingDisabled={doc.markers.length >= 256}
                  onMarkerAdd={(time) => addMarker(time)}
                  onMarkerSelect={(id, time) => {
                    setInspectorView('properties')
                    setSelection({ type: 'marker', id })
                    locateTime(time)
                  }}
                  onMarkerMove={(id, time) => {
                    const current = docRef.current
                    change({
                      ...current,
                      markers: current.markers.map((marker) =>
                        marker.id === id ? { ...marker, time } : marker
                      )
                    })
                  }}
                  alignMarker={(time, bypass, id) => snapTime(time, [id], [0], bypass)}
                  onSeek={(time) => seekTime(time, false)}
                  onSeekCommit={() => setZoomFocused(true)}
                  onRangeChange={changeRange}
                  alignSelection={(time, bypass) => snapTime(time, [], [0], bypass)}
                />
              }
              scrollProps={{
                onScroll: (event) => {
                  const element = event.currentTarget
                  viewportFrame.schedule(() => {
                    const left = element.scrollLeft,
                      width = element.clientWidth
                    setViewport((current) =>
                      current.left === left && current.width === width ? current : { left, width }
                    )
                  })
                }
              }}
              canvasProps={{
                className: `video-timeline-canvas ${marquee ? 'is-marquee-selecting' : ''}`,
                style: {
                  '--video-grid-step': `${videoRulerStep(pixelsPerSecond, doc.fps) * pixelsPerSecond}px`
                } as CSSProperties,
                onContextMenu: () => {
                  stopPlayback()
                  setSelection(null)
                },
                onPointerDown: (e) => {
                  if (
                    e.button !== 0 ||
                    (e.target as HTMLElement).closest('button,input,.video-lane-title,.video-ruler')
                  )
                    return
                  const rect = e.currentTarget.getBoundingClientRect(),
                    x = e.clientX - rect.left,
                    y = e.clientY - rect.top
                  marqueeFrame.cancel()
                  marqueeRef.current = {
                    x,
                    y,
                    ids: e.shiftKey || e.ctrlKey || e.metaKey ? selectedIds : []
                  }
                  setMarquee({ x, y, endX: x, endY: y })
                  e.currentTarget.setPointerCapture(e.pointerId)
                },
                onPointerMove: (e) => {
                  const drag = marqueeRef.current
                  if (!drag) return
                  const element = e.currentTarget,
                    clientX = e.clientX,
                    clientY = e.clientY
                  marqueeFrame.schedule(() => {
                    if (marqueeRef.current !== drag) return
                    const rect = element.getBoundingClientRect()
                    setMarquee({
                      x: drag.x,
                      y: drag.y,
                      endX: clientX - rect.left,
                      endY: clientY - rect.top
                    })
                  })
                },
                onPointerUp: (e) => {
                  marqueeFrame.cancel()
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
                    doc.sounds.find((c) => all.includes(c.id)) ??
                    doc.captions.find((c) => all.includes(c.id))
                  setSelectionState(
                    first
                      ? {
                          id: first.id,
                          type: doc.visuals.some((c) => c.id === first.id)
                            ? 'visual'
                            : doc.sounds.some((c) => c.id === first.id)
                              ? 'sound'
                              : 'caption'
                        }
                      : null
                  )
                  marqueeRef.current = null
                  setMarquee(null)
                },
                onPointerCancel: () => {
                  marqueeFrame.cancel()
                  marqueeRef.current = null
                  setMarquee(null)
                },
                onLostPointerCapture: () => {
                  marqueeFrame.cancel()
                  marqueeRef.current = null
                  setMarquee(null)
                }
              }}
              wrapCanvas={(canvas) => <Menu.ContextMenu>{canvas}</Menu.ContextMenu>}
              overlay={
                <>
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
                        left: range.start * pixelsPerSecond,
                        width: (range.end - range.start) * pixelsPerSecond
                      }}
                    />
                  )}
                  <div
                    className="video-timeline-head"
                    style={{ left: playhead * pixelsPerSecond }}
                    aria-hidden="true"
                  />
                </>
              }
            >
              {doc.tracks.map((track) => {
                const lane: Lane = track.kind === 'video' ? 'visual' : 'sound',
                  clips = doc[lane === 'visual' ? 'visuals' : 'sounds'].filter(
                    (c) => trackIdFor(c, lane) === track.id
                  )
                return (
                  <TimelineRow
                    key={track.id}
                    className={`video-lane lane-${lane} ${track.locked ? 'is-locked' : ''}`}
                    height={trackHeight}
                    header={
                      <TimelineTrackHeader
                        className="video-lane-title"
                        name={track.name}
                        metadata={
                          track.kind === 'audio'
                            ? `${Math.round((track.gain ?? 1) * 100)}%`
                            : undefined
                        }
                        active={activeTrackId === track.id}
                        related={relatedTrackIds.has(track.id)}
                        readonly={context.readonly}
                        onSelect={() => {
                          setSelectedTrackId(track.id)
                          setSelection(null)
                        }}
                        onRename={(name) => updateTrack(track.id, { name })}
                      >
                        {track.kind === 'video' ? (
                          <TimelineTrackAction
                            aria-label={`${track.name} ${track.hidden ? '显示' : '隐藏'}`}
                            aria-pressed={!track.hidden}
                            disabled={context.readonly}
                            onClick={(event) => {
                              event.stopPropagation()
                              updateTrack(track.id, { hidden: !track.hidden })
                            }}
                          >
                            {track.hidden ? <IconEyeOff size={13} /> : <IconEye size={13} />}
                          </TimelineTrackAction>
                        ) : (
                          <>
                            <TimelineTrackAction
                              aria-label={`${track.name} ${track.muted || track.hidden ? '取消静音' : '静音'}`}
                              aria-pressed={!!(track.muted || track.hidden)}
                              disabled={context.readonly || track.locked}
                              onClick={(event) => {
                                event.stopPropagation()
                                updateTrack(track.id, {
                                  muted: !(track.muted || track.hidden),
                                  hidden: false
                                })
                              }}
                            >
                              {track.muted || track.hidden ? (
                                <IconVolumeOff size={13} />
                              ) : (
                                <IconVolume size={13} />
                              )}
                            </TimelineTrackAction>
                            <TimelineTrackAction
                              aria-label={`${track.name} ${track.solo ? '取消独奏' : '独奏'}`}
                              tooltip={track.solo ? '取消独奏' : '独奏：只播放此音轨'}
                              aria-pressed={!!track.solo}
                              disabled={context.readonly || track.locked}
                              onClick={(event) => {
                                event.stopPropagation()
                                updateTrack(track.id, { solo: !track.solo })
                              }}
                            >
                              S
                            </TimelineTrackAction>
                          </>
                        )}
                        <TimelineTrackAction
                          aria-label={`${track.name} ${track.locked ? '解锁' : '锁定'}`}
                          aria-pressed={track.locked}
                          disabled={context.readonly}
                          onClick={(event) => {
                            event.stopPropagation()
                            updateTrack(track.id, { locked: !track.locked })
                          }}
                        >
                          {track.locked ? <IconLock size={13} /> : <IconLockOpen size={13} />}
                        </TimelineTrackAction>
                        <TimelineTrackAction
                          aria-label={`上移${track.name}`}
                          disabled={context.readonly || doc.tracks.indexOf(track) === 0}
                          onClick={(event) => {
                            event.stopPropagation()
                            reorderTrack(track.id, -1)
                          }}
                        >
                          <IconArrowUp size={13} />
                        </TimelineTrackAction>
                        <TimelineTrackAction
                          aria-label={`下移${track.name}`}
                          disabled={
                            context.readonly || doc.tracks.indexOf(track) === doc.tracks.length - 1
                          }
                          onClick={(event) => {
                            event.stopPropagation()
                            reorderTrack(track.id, 1)
                          }}
                        >
                          <IconArrowDown size={13} />
                        </TimelineTrackAction>
                      </TimelineTrackHeader>
                    }
                  >
                    <div
                      className="video-lane-content timeline-track-lane"
                      data-active={activeTrackId === track.id || undefined}
                      data-related={relatedTrackIds.has(track.id) || undefined}
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
                  </TimelineRow>
                )
              })}
              <TimelineRow
                className="video-lane lane-caption"
                height={54}
                header={
                  <TimelineTrackHeader
                    className="video-lane-title"
                    name="字幕"
                    metadata={`${doc.captions.length} 段`}
                    active={selection?.type === 'caption'}
                    related={captionTrackRelated}
                    readonly
                  />
                }
              >
                <div
                  className="video-lane-content timeline-track-lane"
                  data-active={selection?.type === 'caption' || undefined}
                  data-related={captionTrackRelated || undefined}
                  style={{ width: laneWidth }}
                >
                  {(dragDocument ?? doc).captions.filter(clipVisible).map(renderCaption)}
                  {!doc.captions.length && <span className="video-lane-empty">暂无字幕</span>}
                </div>
              </TimelineRow>
            </TimelineViewport>
            {renderTimelineMenu(true)}
          </Menu>
          {soundEditorVisible && soundEditorClip && (
            <div
              className="video-sound-editor"
              style={
                {
                  '--video-tick-step': `${videoRulerStep(pixelsPerSecond, doc.fps) * pixelsPerSecond}px`
                } as CSSProperties
              }
            >
              <TimelineSoundEditor
                key={soundEditorClip.id}
                clip={videoAudioClip(soundEditorClip)}
                trackName={clipTrack(doc, soundEditorClip, 'sound')?.name ?? '声音轨'}
                headerWidth={TIMELINE_TRACK_HEADER_WIDTH}
                zoom={pixelsPerSecond}
                viewportLeft={viewport.left}
                viewportWidth={Math.max(0, viewport.width)}
                mode={soundEditorMode}
                onModeChange={setSoundEditorMode}
                readonly={context.readonly || clipLocked(doc, soundEditorClip, 'sound')}
                playhead={playhead}
                onClose={() => setSoundEditorOpen(false)}
                onBegin={() => {
                  stopPlayback()
                  beginPropertyGesture()
                }}
                onChange={(next) =>
                  updateClip(soundEditorClip.id, 'sound', (current) =>
                    patchVideoSound(current, next)
                  )
                }
                onEnd={endPropertyGesture}
                onAudition={auditionSoundSeam}
              />
            </div>
          )}
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
              { value: 'mix', label: '混音' }
            ]}
          />
          <ScrollArea className="video-inspector-scroll" type="auto" offsetScrollbars>
            <Stack gap="sm">
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
                  display: inspectorView === 'properties' ? undefined : 'none'
                }}
              >
                {inspectorTrack?.kind === 'audio' && (
                  <>
                    <Text size="xs">轨道音量</Text>
                    <Slider
                      min={0}
                      max={4}
                      step={0.01}
                      value={inspectorTrack.gain ?? 1}
                      disabled={context.readonly || inspectorTrack.locked}
                      label={(v) => `${Math.round(v * 100)}%`}
                      onChange={(gain) => updateTrack(inspectorTrack.id, { gain })}
                      onPointerDown={beginPropertyGesture}
                      onPointerCancel={() => endPropertyGesture(true)}
                      onChangeEnd={() => endPropertyGesture()}
                    />
                    <AudioGainControls
                      pan={inspectorTrack.pan}
                      duration={contentEnd}
                      readonly={context.readonly || inspectorTrack.locked}
                      onPanChange={(pan) => updateTrack(inspectorTrack.id, { pan })}
                      onInteractionStart={beginPropertyGesture}
                      onInteractionEnd={endPropertyGesture}
                    />
                    <AudioProcessingControls
                      scope="track"
                      value={inspectorTrack.processing}
                      readonly={context.readonly || inspectorTrack.locked}
                      onChange={(processing) => updateTrack(inspectorTrack.id, { processing })}
                    />
                  </>
                )}
                {selectedIds.length > 1 && (
                  <Text size="xs">已选 {selectedIds.length} 个片段 · Ctrl / Shift 多选</Text>
                )}
                {!!selectedClip && (
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
                      section="basic"
                      clip={propertyClip ?? selectedClip}
                      visual={selection.type === 'visual'}
                      disabled={
                        context.readonly || clipLocked(doc, selectedClip, selection.type as Lane)
                      }
                      timingDisabled={timingDisabled}
                      playhead={playhead}
                      onChange={(next) =>
                        updateClip(selectedClip.id, selection.type as Lane, () => next)
                      }
                    />
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
                    <Textarea
                      size="xs"
                      label="备注"
                      placeholder="记录剪辑提醒或内容说明"
                      autosize
                      minRows={2}
                      maxRows={5}
                      maxLength={2000}
                      value={selectedMarker.note ?? ''}
                      disabled={context.readonly}
                      onChange={(event) =>
                        change({
                          ...doc,
                          markers: doc.markers.map((marker) =>
                            marker.id === selectedMarker.id
                              ? { ...marker, note: event.currentTarget.value }
                              : marker
                          )
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
                      删除标记
                    </Button>
                  </>
                ) : (
                  <Text size="xs" c="dimmed">
                    在时间线上选择片段、字幕或标记。
                  </Text>
                )}
                {inspectorView === 'properties' && !selection && (
                  <Stack gap="xs" mt="xs">
                    <Divider />
                    <Text size="xs" fw={650}>
                      成片设置
                    </Text>
                    <Select
                      size="xs"
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
                      size="xs"
                      label="帧率"
                      min={1}
                      max={60}
                      value={doc.fps}
                      disabled={context.readonly}
                      onChange={(value) =>
                        change({ ...doc, fps: Math.round(bounded(numberValue(value, 30), 1, 60)) })
                      }
                    />
                  </Stack>
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
          actions={(asset) =>
            asset.kind === 'image'
              ? [{ key: 'source-range', label: '添加到画面轨', disabled: context.readonly }]
              : [{ key: 'source-range', label: '选段添加', disabled: context.readonly }]
          }
          onAction={(asset, key) => {
            if (context.readonly) return
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
        initialMode={
          sourceRangeAsset?.kind === 'image'
            ? 'visual'
            : sourceRangeAsset?.kind === 'video'
              ? videoAddMode
              : 'sound'
        }
        modes={sourceRangeAsset?.kind === 'image' ? ['visual'] : undefined}
        placementMode={addMode}
        maxDuration={Math.max(0.001, 21600 - playhead)}
        onConfirm={async (selection) => {
          setVideoAddMode(selection.mode)
          if (selection.placementMode) setAddMode(selection.placementMode)
          if (!(await addAsset(selection.asset, selection.mode, playhead, undefined, selection)))
            throw new Error('未能添加选段，请检查目标轨道、片段数量和成片时长')
        }}
      />
      <SourceRelinkDialog
        opened={relinkOpen}
        onClose={() => {
          setRelinkOpen(false)
          setRelinkSourcePath(null)
        }}
        workspaceId={context.workspaceId}
        sources={videoRelinkSources(doc).filter(
          (source) => !relinkSourcePath || source.path === relinkSourcePath
        )}
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
        onChooseSource={(path) => {
          setProjectSourcesOpen(false)
          setRelinkSourcePath(path)
          setRelinkOpen(true)
        }}
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
        onAdd={addCaption}
        onImport={() => subtitleInput.current?.click()}
        onExport={exportSubtitles}
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
