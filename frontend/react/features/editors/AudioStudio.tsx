import EditorRecoveryPanel from './EditorRecoveryPanel'
import AudioMixPreparation from './AudioMixPreparation'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  Modal,
  Menu,
  NumberInput,
  Select,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
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
  IconMusicPlus,
  IconArrowUp,
  IconArrowDown,
  IconVolume,
  IconVolumeOff,
  IconLock,
  IconLockOpen,
  IconEye,
  IconEyeOff,
  IconScissors,
  IconWaveSine,
  IconAdjustments
} from '@tabler/icons-react'
import { apiFetch } from '../../shared/apiClient'
import { formatFileSize } from '../../shared/formatFileSize'
import { mutateWorkspaceState, readWorkspaceState } from '../../shared/workspaceState'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import { sha256Hex } from '../../../src/shared/lib/sha256'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/model/workspaceArtifactTypes'
import WorkbenchMediaPicker from '../workbench/WorkbenchMediaPicker'
import { MediaPreview } from '../media/MediaPreview'
import {
  audioTimelineKey,
  audioLimits,
  createAudioClip,
  createAudioTimeline,
  createAudioTrack,
  crossfadeClips,
  readAudioTimeline,
  setClipRate,
  setClipFades,
  visibleClipFades,
  timelineDuration,
  resizeAudioClip,
  type AudioClip,
  type AudioTimelineDocument
} from '../../../src/features/media-editor/model/audioTimeline'
import {
  createTextCue,
  createTextTrack,
  decodeTextFile,
  parseTextTrack,
  serializeTextTrack,
  textLimits,
  type TextCue
} from '../../../src/features/media-editor/model/textTimeline'
import {
  snapSpanStart,
  snapTime,
  timelineSnapPoints
} from '../../../src/features/media-editor/model/audioSnap'
import {
  levelDb,
  levelLabel,
  type StereoLevel
} from '../../../src/features/media-editor/model/audioLevels'
import type { EditorContext, RegisterEditorBeforeLeave } from './EditorHub'
import { EditorSaveQueue } from './editorSaveQueue'
import { editorPreviewFile, importEditorMaterials } from './editorMediaImport'
import MaterialBar from './MaterialBar'
import { AudioProcessingControls, AudioGainControls } from './AudioProcessingControls'
import { useContinuousAudioPreview } from './useContinuousAudioPreview'
import AudioClipWaveform, { invalidateAudioWaveforms } from './AudioClipWaveform'
import TimelineSoundEditor, {
  SoundClipFadePreview,
  type SoundEditorMode
} from './TimelineSoundEditor'
import AudioLoudnessTool from './AudioLoudnessTool'
import AudioTextTool from './AudioTextTool'
import AudioPropertyControls from './AudioPropertyControls'
import { audioContextSelection, type AudioSelection } from './audioContextSelection'
import {
  captureClipProperties,
  captureTrackProperties,
  captureMasterProperties,
  applyAudioProperties
} from '../../../src/features/media-editor/model/audioProperties'
import EditorVersions from './EditorVersionHistory'
import EditorActions from './EditorActions'
import EditorNotes from './EditorNotes'
import { useEditorNotes } from './useEditorNotes'
import SourceRangePicker from './SourceRangePicker'
import SourceRelinkDialog from './SourceRelinkDialog'
import ProjectSourcesDialog from './ProjectSourcesDialog'
import SourceRepairButton from './SourceRepairButton'
import {
  projectRelinkSources,
  projectLockedSourcePaths,
  applyProjectSourceRelinks
} from './projectSources'
import EditorDisclosure from './EditorDisclosure'
import AudioSourceStreamSelect from './AudioSourceStreamSelect'
import { applySourceRelink, sourceRelinkError, type SourceRelinkSource } from './sourceRelink'
import { sourceMetadata, sourceMetadataPath, type SourceRangeSelection } from './sourceRange'
import { mixPreviewSignature } from './audioMixPreview'
import { seamAuditionRange } from '../../../src/features/media-editor/model/audioEnvelopeEditing'
import EditorTaskList from './EditorTaskList'
import { useAudioExports } from './useAudioExports'
import TimelineTimeControls from './TimelineTimeControls'
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
import { useEditorToolAnchor } from './useEditorToolAnchor'
import {
  followTimelineViewport,
  nextTimelinePoint,
  timelineNavigationPoints
} from './timelineNavigation'
import {
  clampTimelinePosition,
  formatTimelineTime,
  normalizeTimelineRange,
  setTimelineRangeEndpoint
} from './timelineTime'
import { videoRulerTicks, videoRulerStep } from './videoTimelineView'
import {
  audioEntries,
  copyAudioSelection,
  expandAudioSelection,
  groupAudioSelection,
  moveAudioSelection,
  pasteAudioSelection,
  removeAudioSelection,
  splitAudioSelection,
  type AudioClipboard
} from '../../../src/features/media-editor/model/audioEditing'
import './AudioStudio.css'

const numeric = (value: string | number, fallback: number) =>
  typeof value === 'number' ? value : Number(value) || fallback
const clock = formatTimelineTime
const json = (body: unknown) => JSON.stringify(body)
type Waveform = { duration: number }
const soundSourceKey = (clip: Pick<AudioClip, 'path' | 'audioStream'>) =>
  JSON.stringify([clip.path, clip.audioStream ?? 0])

type Selection = AudioSelection
type DragSnapshot = {
  before: AudioTimelineDocument
  past: AudioTimelineDocument[]
  future: AudioTimelineDocument[]
}
type AudioContextMenu = {
  x: number
  y: number
  target: 'clip' | 'track' | 'blank' | 'text-cue' | 'text-track'
}

export default function AudioStudio({
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
  const key = audioTimelineKey(context.workspaceId, context.draft.id)
  const notes = useEditorNotes(context)
  const [notesOpen, setNotesOpen] = useState(false)
  const liveEditor = useRef(true),
    editPolicy = useRef({ readonly: context.readonly, key })
  editPolicy.current = { readonly: context.readonly, key }
  useEffect(() => {
    liveEditor.current = true
    return () => {
      liveEditor.current = false
    }
  }, [])
  const [initial] = useState(() => {
    const raw = readWorkspaceState(context.workspaceId).getItem(key)
    try {
      return { document: readAudioTimeline(raw), loadError: '', raw }
    } catch (cause) {
      return {
        document: createAudioTimeline(),
        loadError: cause instanceof Error ? cause.message : '音频制作文件无法读取',
        raw
      }
    }
  })
  const [doc, setDoc] = useState<AudioTimelineDocument>(initial.document)
  const saverRef = useRef<EditorSaveQueue<AudioTimelineDocument> | null>(null)
  const docRef = useRef(doc)
  const signatures = useRef(new WeakMap<AudioTimelineDocument, string>())
  function documentSignature(document: AudioTimelineDocument) {
    let signature = signatures.current.get(document)
    if (signature === undefined) {
      signature = json(document)
      signatures.current.set(document, signature)
    }
    return signature
  }
  if (!saverRef.current) {
    saverRef.current = new EditorSaveQueue(doc, async (snapshot) => {
      if (initial.loadError || context.readonly)
        throw new Error('当前制作文件不可写，原始数据已保留')
      await mutateWorkspaceState(context.workspaceId, (storage) => {
        assertProductionDraftExists(storage, context.workspaceId, context.draft.id)
        storage.setItem(key, json(snapshot))
      })
    })
  }
  const [selection, setPrimarySelection] = useState<Selection>(null)
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const clipboard = useRef<AudioClipboard | null>(null)
  const [clipboardReady, setClipboardReady] = useState(false)
  const [textPreview, setTextPreview] = useState(false)
  const [trackHeight, setTrackHeight] = useState<number>(TIMELINE_STANDARD_TRACK_HEIGHT)
  const [waveAmplitude, setWaveAmplitude] = useState(1)
  const [waveStereo, setWaveStereo] = useState(false)
  const [soundEditorOpen, setSoundEditorOpen] = useState(false)
  const [soundEditorMode, setSoundEditorMode] = useState<SoundEditorMode>('fades')
  const [followPlayhead, setFollowPlayhead] = useState(true)
  const [viewport, setViewport] = useState({ left: 0, width: 1000 })
  const [selectionBox, setSelectionBox] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const boxDragRef = useRef<{
    x: number
    y: number
    ids: string[]
    moved: boolean
    before: { items: string[]; selection: Selection }
  } | null>(null)
  function setSelection(next: Selection) {
    setPrimarySelection(next)
    if (!next || !['clip', 'cue'].includes(next.kind)) setSelectedItems([])
  }
  const [contextMenu, setContextMenu] = useState<AudioContextMenu | null>(null)
  const [railTool, setRailTool] = useState<'text' | 'presets' | 'loudness' | 'markers' | null>(null)
  const [past, setPast] = useState<AudioTimelineDocument[]>([])
  const [future, setFuture] = useState<AudioTimelineDocument[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [playhead, setPlayhead] = useState(0)
  const [zoom, setZoom] = useState(22)
  const [zoomFocused, setZoomFocused] = useState(false)
  const [snapping, setSnapping] = useState(true)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [loop, setLoop] = useState(false)
  const [exportScope, setExportScope] = useState<'all' | 'selection'>('all')
  const [exportOpen, setExportOpen] = useState(false)
  const [textExportFormat, setTextExportFormat] = useState<'srt' | 'lrc' | 'vtt'>('srt')
  const [textExportScope, setTextExportScope] = useState<'all' | 'selection'>('all')
  const [editingCueId, setEditingCueId] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [rangeAsset, setRangeAsset] = useState<WorkspaceAsset | null>(null)
  const [relinkPaths, setRelinkPaths] = useState<string[] | null>(null)
  const [projectSourcesOpen, setProjectSourcesOpen] = useState(false)
  const [inspectorView, setInspectorView] = useState('properties')
  const [previewPath, setPreviewPath] = useState('')
  const [materialAssets, setMaterialAssets] = useState(context.assets)
  const [exportedArtifacts, setExportedArtifacts] = useState<WorkspaceArtifact[]>([])
  const [exportName, setExportName] = useState(`${context.draft.name}.wav`)
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav')
  const [taskListOpen, setTaskListOpen] = useState(false)
  const exports = useAudioExports({
    workspaceId: context.workspaceId,
    documentId: context.draft.id,
    opened: taskListOpen,
    readonly: context.readonly,
    onArtifact: (artifact) => {
      setExportedArtifacts((current) => [
        artifact,
        ...current.filter((item) => item.id !== artifact.id)
      ])
      const path = `workspace-artifact:${artifact.id}`
      setMaterialAssets((current) => [
        { path, name: artifact.name, kind: 'audio' },
        ...current.filter((item) => item.path !== path)
      ])
    }
  })
  const playback = useContinuousAudioPreview({
    workspaceId: context.workspaceId,
    onTime: setPlayhead,
    onError: (cause) => setError(cause instanceof Error ? cause.message : '试听失败')
  })
  const playing = playback.playing
  const levels: StereoLevel = [playback.levels.left, playback.levels.right]
  const meterPeak = playback.peak
  const overloaded = meterPeak >= 1
  const [crossfadeDuration, setCrossfadeDuration] = useState(0.5)
  const [waveforms, setWaveforms] = useState<Record<string, Waveform>>({})
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({})
  const [sourceRetry, setSourceRetry] = useState(0)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const toolRailRef = useRef<HTMLElement>(null)
  useEditorToolAnchor(toolRailRef)
  const dragRef = useRef<
    | (DragSnapshot & {
        id: string
        x: number
        original: AudioClip
        mode: 'move' | 'left' | 'right'
        ids: string[]
        points: number[]
        moved: boolean
      })
    | undefined
  >(undefined)
  const cueDragRef = useRef<
    | (DragSnapshot & {
        id: string
        x: number
        start: number
        duration: number
        mode: 'move' | 'left' | 'right'
        ids: string[]
        points: number[]
        moved: boolean
      })
    | undefined
  >(undefined)
  const dragHistoryRecordedRef = useRef(false)
  const envelopeDragRef = useRef<DragSnapshot | null>(null)
  const pointerFrames = useFrameAction()
  const boxFrames = useFrameAction()
  const viewportFrames = useFrameAction()
  const previousDuration = useRef(timelineDuration(doc))
  const contentDuration = useMemo(() => timelineDuration(doc), [doc])
  const duration = Math.max(
    30,
    Math.ceil(Math.max(contentDuration, ...(doc.markers ?? []).map((marker) => marker.time)) + 5)
  )
  const laneWidth = Math.max(900, viewport.width, duration * zoom)
  const zoomTimeline = useTimelineZoom(
    timelineScrollRef,
    zoom,
    1000,
    setZoom,
    zoomFocused ? playhead : null
  )
  const selectedIds = useMemo(
    () =>
      expandAudioSelection(
        doc,
        selectedItems.length && selection && selectedItems.includes(selection.id)
          ? selectedItems
          : selection && ['clip', 'cue'].includes(selection.kind)
            ? [selection.id]
            : []
      ),
    [doc, selectedItems, selection]
  )
  const rulerTicks = useMemo(
    () => videoRulerTicks(duration, zoom, Math.max(0, viewport.left), viewport.width),
    [duration, zoom, viewport.left, viewport.width]
  )
  const selectedTrack = doc.tracks.find((track) => track.id === selection?.id)
  const selectedTextTrack = (doc.textTracks ?? []).find((track) => track.id === selection?.id)
  const selectedClip = doc.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selection?.id)
  const selectedClipTrack = doc.tracks.find((track) =>
    track.clips.some((clip) => clip.id === selectedClip?.id)
  )
  const selectedFades = selectedClip ? visibleClipFades(selectedClip) : null
  function openSoundEditor(mode?: SoundEditorMode) {
    if (!selectedClip) return
    if (mode) setSoundEditorMode(mode)
    setSoundEditorOpen(true)
  }
  const selectedCue = (doc.textTracks ?? [])
    .flatMap((track) => track.cues)
    .find((cue) => cue.id === selection?.id)
  const selectedCueTrack = (doc.textTracks ?? []).find((track) =>
    track.cues.some((cue) => cue.id === selectedCue?.id)
  )
  const primaryLinkedIds =
    selection && ['clip', 'cue'].includes(selection.kind)
      ? expandAudioSelection(doc, [selection.id])
      : []
  const lockedLinkedTracks = [
    ...doc.tracks.filter(
      (track) => track.locked && track.clips.some((clip) => primaryLinkedIds.includes(clip.id))
    ),
    ...(doc.textTracks ?? []).filter(
      (track) => track.locked && track.cues.some((cue) => primaryLinkedIds.includes(cue.id))
    )
  ]
  const positionLocked = lockedLinkedTracks.length > 0
  const positionLockMessage = positionLocked
    ? `关联轨道已锁定：${lockedLinkedTracks.map((track) => track.name).join('、')}`
    : undefined
  const activeTextTrack = selectedTextTrack ?? selectedCueTrack
  const activeTrackId =
    selectedTrack?.id ?? activeTextTrack?.id ?? selectedClipTrack?.id ?? doc.tracks[0]?.id
  const relatedTrackIds = new Set([
    ...doc.tracks
      .filter((track) => track.clips.some((clip) => selectedIds.includes(clip.id)))
      .map((track) => track.id),
    ...(doc.textTracks ?? [])
      .filter((track) => track.cues.some((cue) => selectedIds.includes(cue.id)))
      .map((track) => track.id)
  ])
  const cueTarget = activeTextTrack ?? doc.textTracks?.[0]
  const selectedEntries = audioEntries(doc).filter((entry) => selectedIds.includes(entry.item.id))
  const selectionEditable =
    !context.readonly && !!selectedEntries.length && !selectedEntries.some((entry) => entry.locked)
  const selectionLinked = (doc.groups ?? []).some((group) =>
    group.some((id) => selectedIds.includes(id))
  )
  const selectedMarker = (doc.markers ?? []).find((marker) => marker.id === selection?.id)
  const assets = useMemo(
    () => materialAssets.filter((asset) => asset.kind === 'audio' || asset.kind === 'video'),
    [materialAssets]
  )
  const relinkSources: SourceRelinkSource[] =
    relinkPaths?.map((path) => {
      const clips = doc.tracks.flatMap((track) => track.clips).filter((clip) => clip.path === path)
      return {
        path,
        name: clips[0]?.name ?? path,
        kind: clips[0]?.sourceKind ?? 'audio',
        clips: clips.map((clip) => ({
          id: clip.id,
          sourceIn: clip.sourceIn,
          duration: clip.duration,
          rate: clip.rate,
          audioStream: clip.audioStream,
          requiresAudio: true,
          requiresVideo: false
        }))
      }
    }) ?? []
  const assetInfo = useMemo(() => {
    const current = { ...context.assetInfo }
    for (const artifact of exportedArtifacts) {
      const path = `workspace-artifact:${artifact.id}`
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
  }, [context.assetInfo, exportedArtifacts])
  const previewFiles = useMemo(
    () => assets.map((asset) => editorPreviewFile(asset, assetInfo[asset.path])),
    [assets, assetInfo]
  )
  useEffect(() => {
    if (!playing || !followPlayhead) return
    const element = timelineScrollRef.current
    if (!element) return
    element.scrollLeft = followTimelineViewport({
      position: playhead,
      pixelsPerSecond: zoom,
      scrollLeft: element.scrollLeft,
      viewportWidth: element.clientWidth,
      contentDuration: duration
    })
  }, [playhead, playing, followPlayhead, zoom, duration])
  useEffect(() => {
    const element = timelineScrollRef.current
    if (!element) return
    const measure = () => {
      const left = element.scrollLeft,
        width = element.clientWidth
      setViewport((previous) =>
        previous.left === left && previous.width === width ? previous : { left, width }
      )
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const end = timelineDuration(doc)
    const shrunk = end < previousDuration.current
    const nextRange = shrunk ? normalizeTimelineRange(range, end) : range
    if (shrunk) {
      setPlayhead((value) => clampTimelinePosition(value, end))
      if (nextRange?.start !== range?.start || nextRange?.end !== range?.end) setRange(nextRange)
      if (!nextRange) setLoop(false)
      const element = timelineScrollRef.current
      if (element) {
        const width = Math.max(1, element.clientWidth)
        const nextZoom =
          end > 0 && end * zoom < 80 && previousDuration.current > end * 4
            ? Math.max(0.03125, Math.min(1000, width / (end * 1.1)))
            : zoom
        if (nextZoom !== zoom) setZoom(nextZoom)
        element.scrollLeft = Math.min(element.scrollLeft, Math.max(0, end * nextZoom - width))
        setViewport({ left: element.scrollLeft, width: element.clientWidth })
      }
    }
    previousDuration.current = end
    void playback.update({
      document: doc,
      end: loop && nextRange ? Math.min(end, nextRange.end) : end,
      loop: loop && nextRange ? nextRange : undefined
    })
  }, [doc, range, loop, playback.update])
  function seek(value: number, focusZoom = true) {
    playback.stop()
    if (focusZoom) setZoomFocused(true)
    setPlayhead(clampTimelinePosition(value, 86400))
  }
  function fitTimeline(selected = false) {
    const entries = selected
      ? audioEntries(doc).filter((entry) => selectedIds.includes(entry.item.id))
      : []
    const start = entries.length ? Math.min(...entries.map((entry) => entry.item.start)) : 0
    const end = entries.length
      ? Math.max(...entries.map((entry) => entry.item.start + entry.item.duration))
      : timelineDuration(doc)
    const width = Math.max(1, timelineScrollRef.current?.clientWidth ?? 800)
    const nextZoom = Math.max(0.03125, Math.min(1000, width / Math.max(0.1, (end - start) * 1.1)))
    setZoom(nextZoom)
    requestAnimationFrame(() => {
      if (timelineScrollRef.current)
        timelineScrollRef.current.scrollLeft = Math.max(0, start * nextZoom - 24)
    })
  }
  function openExport() {
    setExportScope(range ? 'selection' : 'all')
    setExportOpen(true)
  }
  function selectItem(kind: 'clip' | 'cue', id: string, additive: boolean) {
    const ids = additive
      ? selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id]
      : selectedIds.includes(id)
        ? selectedIds
        : [id]
    setSelectedItems(ids)
    const primary = ids.includes(id)
      ? { kind, id }
      : audioEntries(doc)
          .filter((entry) => ids.includes(entry.item.id))
          .map((entry) => ({ kind: entry.kind, id: entry.item.id }))[0]
    setPrimarySelection(primary ?? null)
    return expandAudioSelection(doc, ids)
  }
  function copySelection(cut = false) {
    if (cut && context.readonly) return
    const next = cut ? removeAudioSelection(doc, selectedIds) : doc
    if (cut && next === doc) {
      setError('选中或关联轨道已锁定，请先解锁后剪切')
      return
    }
    clipboard.current = copyAudioSelection(doc, selectedIds)
    setClipboardReady(!!clipboard.current)
    if (cut) {
      change(next)
      setSelection(null)
    }
  }
  function pasteSelection() {
    if (context.readonly || !clipboard.current) return
    try {
      const pasted = pasteAudioSelection(doc, clipboard.current, playhead)
      change(pasted.document)
      setSelectedItems(pasted.ids)
      const first = audioEntries(pasted.document).find((entry) => entry.item.id === pasted.ids[0])
      if (first) setPrimarySelection({ kind: first.kind, id: first.item.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '粘贴失败')
    }
  }
  function deleteSelection(ripple = false) {
    if (context.readonly) return
    if (selectedIds.length) {
      const next = removeAudioSelection(doc, selectedIds, ripple)
      if (next === doc) {
        setError('选中或后续关联的轨道已锁定')
        return
      }
      change(next)
      setSelection(null)
    } else removeSelected()
  }
  function groupSelection(unlink = false) {
    if (!selectionEditable || selectedIds.length < 2) return
    try {
      change(groupAudioSelection(doc, selectedIds, unlink))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '关联失败')
    }
  }
  function pointsForSelection(document: AudioTimelineDocument, ids: string[]) {
    const selected = new Set(ids)
    return timelineSnapPoints(
      {
        ...document,
        tracks: document.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((clip) => !selected.has(clip.id))
        })),
        textTracks: document.textTracks?.map((track) => ({
          ...track,
          cues: track.cues.filter((cue) => !selected.has(cue.id))
        }))
      },
      playhead
    )
  }
  function timelineDragMode(event: ReactPointerEvent<HTMLElement>) {
    const handle = (event.target as HTMLElement).closest('[data-edge]')?.getAttribute('data-edge')
    if (handle === 'left' || handle === 'right') return handle
    const rect = event.currentTarget.getBoundingClientRect()
    const edge = Math.min(8, rect.width / 4)
    const offset = event.clientX - rect.left
    return offset < edge ? 'left' : offset > rect.width - edge ? 'right' : 'move'
  }
  function cancelTimelineDrag(event: ReactPointerEvent<HTMLElement>, kind: 'clip' | 'cue') {
    const drag = kind === 'clip' ? dragRef.current : cueDragRef.current
    if (!drag || drag.id !== event.currentTarget.dataset.timelineItem) return
    pointerFrames.cancel()
    delete event.currentTarget.dataset.dragMode
    event.currentTarget.style.cursor = ''
    if (kind === 'clip') dragRef.current = undefined
    else cueDragRef.current = undefined
    rollbackDrag(drag)
    dragHistoryRecordedRef.current = false
    window.setTimeout(() => void flushChanges(), 100)
  }
  function hoverTimelineClip(event: ReactPointerEvent<HTMLElement>, locked: boolean) {
    const element = event.currentTarget
    const active = element.dataset.dragMode
    if (active) {
      element.style.cursor = active === 'move' ? 'grabbing' : 'ew-resize'
      return
    }
    if (context.readonly || locked) {
      element.style.cursor = 'default'
      return
    }
    element.style.cursor = timelineDragMode(event) === 'move' ? 'grab' : 'ew-resize'
  }
  function moveClipPointer(id: string, clientX: number, shiftKey: boolean) {
    const drag = dragRef.current
    if (!drag || drag.id !== id) return
    if (!drag.moved && Math.abs(clientX - drag.x) < 3) return
    drag.moved = true
    const delta = (clientX - drag.x) / zoom
    const points = drag.points
    if (drag.mode === 'move') {
      const raw = Math.max(0, drag.original.start + delta)
      const next =
        snapping && !shiftKey
          ? snapSpanStart(raw, drag.original.duration, points, 8 / zoom).time
          : raw
      change(moveAudioSelection(drag.before, drag.ids, next - drag.original.start))
    } else {
      const edge = drag.mode
      const raw = drag.original.start + (edge === 'right' ? drag.original.duration : 0) + delta
      const anchor = snapping && !shiftKey ? snapTime(raw, points, 8 / zoom).time : raw
      updateClip(id, () =>
        resizeAudioClip(
          drag.original,
          edge,
          anchor,
          waveforms[soundSourceKey(drag.original)]?.duration
        )
      )
    }
  }
  function moveCuePointer(id: string, clientX: number, shiftKey: boolean) {
    const drag = cueDragRef.current
    if (!drag || drag.id !== id) return
    if (!drag.moved && Math.abs(clientX - drag.x) < 3) return
    drag.moved = true
    const delta = (clientX - drag.x) / zoom
    const points = drag.points
    if (drag.mode === 'move') {
      const raw = Math.max(0, Math.min(86400 - drag.duration, drag.start + delta))
      const next =
        snapping && !shiftKey ? snapSpanStart(raw, drag.duration, points, 8 / zoom).time : raw
      change(moveAudioSelection(drag.before, drag.ids, next - drag.start))
    } else if (drag.mode === 'left') {
      const raw = Math.max(0, Math.min(drag.start + drag.duration - 0.001, drag.start + delta))
      const next = snapping && !shiftKey ? snapTime(raw, points, 8 / zoom).time : raw
      const start = Math.max(0, Math.min(drag.start + drag.duration - 0.001, next))
      updateCue(id, {
        start: Math.round(start * 1000) / 1000,
        duration: Math.round((drag.start + drag.duration - start) * 1000) / 1000
      })
    } else {
      const raw = Math.max(drag.start + 0.001, Math.min(86400, drag.start + drag.duration + delta))
      const next = snapping && !shiftKey ? snapTime(raw, points, 8 / zoom).time : raw
      updateCue(id, {
        duration:
          Math.round((Math.max(drag.start + 0.001, Math.min(86400, next)) - drag.start) * 1000) /
          1000
      })
    }
  }
  function beginBox(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    const root = timelineScrollRef.current
    if (!root) return
    const bounds = root.getBoundingClientRect()
    const x = event.clientX - bounds.left + root.scrollLeft
    const y = event.clientY - bounds.top + root.scrollTop
    boxDragRef.current = {
      x,
      y,
      ids: event.shiftKey ? selectedIds : [],
      moved: false,
      before: { items: selectedItems, selection }
    }
    root.setPointerCapture(event.pointerId)
    event.preventDefault()
    if (!event.shiftKey) {
      setSelectedItems([])
      setPrimarySelection(null)
    }
  }
  function moveBox(
    event: Pick<ReactPointerEvent<HTMLDivElement>, 'clientX' | 'clientY' | 'currentTarget'>
  ) {
    const drag = boxDragRef.current
    if (!drag) return
    const root = event.currentTarget
    const bounds = root.getBoundingClientRect()
    if (event.clientX > bounds.right - 24) root.scrollLeft += 18
    if (event.clientX < bounds.left + 24) root.scrollLeft -= 18
    if (event.clientY > bounds.bottom - 24) root.scrollTop += 12
    if (event.clientY < bounds.top + 24) root.scrollTop -= 12
    const x = event.clientX - bounds.left + root.scrollLeft
    const y = event.clientY - bounds.top + root.scrollTop
    const box = {
      left: Math.min(x, drag.x),
      top: Math.min(y, drag.y),
      width: Math.abs(x - drag.x),
      height: Math.abs(y - drag.y)
    }
    if (box.width + box.height < 5) return
    drag.moved = true
    setSelectionBox(box)
    const ids = [...drag.ids]
    for (const element of root.querySelectorAll<HTMLElement>('[data-timeline-item]')) {
      const rect = element.getBoundingClientRect()
      const left = rect.left - bounds.left + root.scrollLeft,
        top = rect.top - bounds.top + root.scrollTop
      if (
        left < box.left + box.width &&
        left + rect.width > box.left &&
        top < box.top + box.height &&
        top + rect.height > box.top
      )
        if (element.dataset.timelineItem) ids.push(element.dataset.timelineItem)
    }
    const selected = [...new Set(ids)]
    setSelectedItems((previous) =>
      previous.length === selected.length && previous.every((id, index) => id === selected[index])
        ? previous
        : selected
    )
    const first = audioEntries(doc).find((entry) => entry.item.id === selected[0])
    setPrimarySelection((previous) =>
      previous?.id === first?.item.id
        ? previous
        : first
          ? { kind: first.kind, id: first.item.id }
          : null
    )
  }
  function endBox(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = boxDragRef.current
    if (!drag) return
    boxFrames.flush(() => moveBox(event))
    if (drag && !drag.moved) seek(Math.max(0, drag.x / zoom))
    boxDragRef.current = null
    setSelectionBox(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function cancelBox() {
    const drag = boxDragRef.current
    boxFrames.cancel()
    boxDragRef.current = null
    setSelectionBox(null)
    if (!drag) return
    setSelectedItems(drag.before.items)
    setPrimarySelection(drag.before.selection)
  }
  function changeRange(next: { start: number; end: number } | null) {
    playback.stop()
    const normalized = normalizeTimelineRange(next, timelineDuration(doc))
    setRange(normalized)
    if (!normalized) setLoop(false)
  }
  function moveTrack(id: string, direction: -1 | 1, text = false) {
    if (context.readonly) return
    if (text) {
      const tracks = [...(doc.textTracks ?? [])]
      const at = tracks.findIndex((track) => track.id === id)
      const to = at + direction
      if (at < 0 || to < 0 || to >= tracks.length) return
      ;[tracks[at], tracks[to]] = [tracks[to], tracks[at]]
      change({ ...doc, textTracks: tracks })
    } else {
      const tracks = [...doc.tracks]
      const at = tracks.findIndex((track) => track.id === id)
      const to = at + direction
      if (at < 0 || to < 0 || to >= tracks.length) return
      ;[tracks[at], tracks[to]] = [tracks[to], tracks[at]]
      change({ ...doc, tracks })
    }
  }
  useEffect(() => {
    const saver = saverRef.current
    if (!saver || context.readonly || initial.loadError) return
    saver.update(doc)
    if (!saver.dirty) return
    setDirty(true)
    const timer = window.setTimeout(() => {
      if (!dragRef.current && !cueDragRef.current && !envelopeDragRef.current) void flushChanges()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [doc, context.readonly])
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
  const waveformPaths = useMemo(
    () =>
      JSON.stringify([...new Set(doc.tracks.flatMap((track) => track.clips.map(soundSourceKey)))]),
    [doc.tracks]
  )
  const waveformSources: string[] = useMemo(() => JSON.parse(waveformPaths), [waveformPaths])
  const unavailablePaths = [
    ...new Set(
      waveformSources.filter((key) => sourceErrors[key]).map((key) => JSON.parse(key)[0] as string)
    )
  ]
  useEffect(() => {
    let live = true
    const paths: string[] = JSON.parse(waveformPaths).filter((key: string) => !waveforms[key])
    let cursor = 0
    async function worker() {
      while (live && cursor < paths.length) {
        const key = paths[cursor++]
        const [path, audioStream] = JSON.parse(key) as [string, number]
        const query = new URLSearchParams({
          workspace_id: context.workspaceId,
          path,
          audio_stream: String(audioStream),
          peaks: 'false'
        })
        try {
          const result = await apiFetch<Waveform>(`/audio_studio/source?${query}`)
          if (live) {
            setWaveforms((current) => ({ ...current, [key]: result }))
            setSourceErrors((current) => {
              const next = { ...current }
              delete next[key]
              return next
            })
          }
        } catch (cause) {
          if (live) {
            setSourceErrors((current) => ({
              ...current,
              [key]: cause instanceof Error ? cause.message : '素材无法读取'
            }))
          }
        }
      }
    }
    for (let index = 0; index < Math.min(3, paths.length); index++) void worker()
    return () => {
      live = false
    }
  }, [waveformPaths, context.workspaceId, sourceRetry])

  function change(next: AudioTimelineDocument) {
    const current = docRef.current
    if (
      context.readonly ||
      initial.loadError ||
      next === current ||
      documentSignature(next) === documentSignature(current)
    )
      return
    if (!dragRef.current && !cueDragRef.current && !envelopeDragRef.current) {
      setPast((items) => [...items.slice(-79), current])
      setFuture([])
    } else if (!dragHistoryRecordedRef.current) {
      setPast((items) => [...items.slice(-79), current])
      setFuture([])
      dragHistoryRecordedRef.current = true
    }
    saverRef.current?.update(next)
    docRef.current = next
    setDoc(next)
    setDirty(true)
    setStatus('')
  }
  function rollbackDrag(snapshot: DragSnapshot) {
    saverRef.current?.update(snapshot.before)
    docRef.current = snapshot.before
    setDoc(snapshot.before)
    setPast(snapshot.past)
    setFuture(snapshot.future)
    setDirty(saverRef.current?.dirty ?? false)
    setStatus('')
  }
  function undo(redo = false) {
    if (
      context.readonly ||
      initial.loadError ||
      envelopeDragRef.current ||
      dragRef.current ||
      cueDragRef.current
    )
      return
    const source = redo ? future : past
    const previous = source.at(-1)
    if (!previous) return
    playback.stop()
    if (
      soundEditorOpen &&
      selectedClip &&
      previous.tracks.some((track) => track.clips.some((clip) => clip.id === selectedClip.id))
    ) {
      const remaining = new Set(audioEntries(previous).map(({ item }) => item.id))
      setSelectedItems((items) => items.filter((id) => remaining.has(id)))
    } else setSelection(null)
    if (redo) {
      setFuture((items) => items.slice(0, -1))
      setPast((items) => [...items, doc])
    } else {
      setPast((items) => items.slice(0, -1))
      setFuture((items) => [...items, doc])
    }
    saverRef.current?.update(previous)
    docRef.current = previous
    setDoc(previous)
    setDirty(true)
    setStatus('')
  }
  function updateClip(id: string, transform: (clip: AudioClip) => AudioClip) {
    const current = docRef.current
    const owner = current.tracks.find((track) => track.clips.some((clip) => clip.id === id))
    const original = owner?.clips.find((clip) => clip.id === id)
    if (context.readonly || !original || owner?.locked) return
    const updated = transform(original)
    if (updated === original || json(updated) === json(original)) return
    const positionOnly = updated.start !== original.start && updated.duration === original.duration
    const next = positionOnly
      ? moveAudioSelection(current, [id], updated.start - original.start)
      : current
    if (positionOnly && next === current) {
      setError('关联片段的轨道已锁定')
      return
    }
    change({
      ...next,
      tracks: next.tracks.map((track) =>
        track.id !== owner?.id
          ? track
          : {
              ...track,
              clips: track.clips.map((clip) =>
                clip.id === id
                  ? { ...updated, ...(positionOnly ? { start: clip.start } : {}) }
                  : clip
              )
            }
      )
    })
  }
  function updateCue(id: string, changeSet: Partial<TextCue>) {
    const current = docRef.current
    if (
      context.readonly ||
      current.textTracks?.some((track) => track.locked && track.cues.some((cue) => cue.id === id))
    )
      return
    const original = current.textTracks?.flatMap((track) => track.cues).find((cue) => cue.id === id)
    if (
      original &&
      changeSet.start !== undefined &&
      changeSet.duration === undefined &&
      changeSet.start !== original.start
    ) {
      const next = moveAudioSelection(current, [id], changeSet.start - original.start)
      if (next === current) setError('关联片段的轨道已锁定')
      else change(next)
      return
    }
    change({
      ...current,
      textTracks: (current.textTracks ?? []).map((track) =>
        !track.cues.some((cue) => cue.id === id)
          ? track
          : {
              ...track,
              cues: track.cues.map((cue) => {
                if (cue.id !== id) return cue
                const start = Math.max(0, Math.min(86400 - 0.001, changeSet.start ?? cue.start))
                const duration = Math.max(
                  0.001,
                  Math.min(changeSet.duration ?? cue.duration, 86400 - start)
                )
                return {
                  ...cue,
                  ...changeSet,
                  start: Math.round(Math.min(start, 86400 - duration) * 1000) / 1000,
                  duration: Math.round(duration * 1000) / 1000,
                  text: (changeSet.text ?? cue.text).slice(0, textLimits.text)
                }
              })
            }
      )
    })
  }
  function updateTrack(id: string, changeSet: Partial<AudioTimelineDocument['tracks'][number]>) {
    if (context.readonly) return
    change({
      ...doc,
      tracks: doc.tracks.map((track) => (track.id === id ? { ...track, ...changeSet } : track))
    })
  }
  function updateTextTrack(
    id: string,
    changeSet: Partial<NonNullable<AudioTimelineDocument['textTracks']>[number]>
  ) {
    if (context.readonly) return
    change({
      ...doc,
      textTracks: (doc.textTracks ?? []).map((track) =>
        track.id === id ? { ...track, ...changeSet } : track
      )
    })
  }
  async function persist() {
    if (initial.loadError || context.readonly) throw new Error('当前制作文件不可写，原始数据已保留')
    const saver = saverRef.current
    if (!saver) throw new Error('音频制作文件保存器未就绪')
    const [snapshot] = await Promise.all([saver.flush(), notes.flush()])
    setDirty(saver.dirty)
    return snapshot
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
    setTaskListOpen(false)
    setNotesOpen(true)
  }
  async function toggleTasks() {
    if (!(await closeNotes())) return
    setTaskListOpen((open) => !open)
  }
  async function flushChanges(): Promise<boolean> {
    if (context.readonly || initial.loadError) return true
    if (dragRef.current || cueDragRef.current || envelopeDragRef.current) return false
    try {
      await persist()
      setError('')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '制作文件未能保存，请重试')
      return false
    }
  }
  async function save() {
    if (busy || notes.saving || context.readonly) return
    setBusy(true)
    setError('')
    try {
      await persist()
      setStatus('制作文件已保存')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }
  async function addAsset(
    asset: WorkspaceAsset,
    at = playhead,
    trackId?: string,
    newTrack = false,
    selectedRange?: SourceRangeSelection
  ) {
    if (context.readonly) return
    setError('')
    try {
      const query = new URLSearchParams({
        workspace_id: context.workspaceId,
        path: asset.path,
        audio_stream: String(selectedRange?.audioStream ?? 0),
        peaks: 'false'
      })
      const source = await apiFetch<{ duration: number }>(`/audio_studio/source?${query}`)
      if (!liveEditor.current || editPolicy.current.readonly || editPolicy.current.key !== key)
        throw new Error('编辑器已关闭或不可写')
      const current = docRef.current
      const track = newTrack
        ? undefined
        : (current.tracks.find((item) => item.id === trackId) ??
          current.tracks.find(
            (item) =>
              item.id === selection?.id || item.clips.some((clip) => clip.id === selection?.id)
          ) ??
          current.tracks[0])
      if (track?.locked) throw new Error('请先解锁音轨')
      if (track && track.clips.length >= 256) throw new Error('每条音轨最多支持 256 个片段')
      if (!track && current.tracks.length >= 32) throw new Error('最多支持 32 条音轨')
      const sourceIn = selectedRange?.sourceIn ?? 0,
        length = selectedRange?.duration ?? source.duration
      if (
        !Number.isFinite(sourceIn) ||
        sourceIn < 0 ||
        !Number.isFinite(length) ||
        length <= 0 ||
        sourceIn + length > source.duration + 1 / 48000
      )
        throw new Error('所选片段超出素材范围，请重新选段')
      if (at + length > 86400) throw new Error('时间线最长为 24 小时')
      const target = track ?? createAudioTrack(`声音 ${current.tracks.length + 1}`)
      const clip = createAudioClip(
        asset.path,
        asset.name,
        length,
        at,
        asset.kind === 'video' ? 'video' : 'audio'
      )
      clip.sourceIn = sourceIn
      clip.audioStream = selectedRange?.audioStream ?? 0
      change({
        ...current,
        tracks: track
          ? current.tracks.map((item) =>
              item.id === target.id ? { ...item, clips: [...item.clips, clip] } : item
            )
          : [...current.tracks, { ...target, clips: [clip] }]
      })
      setSelection({ kind: 'clip', id: clip.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取声音素材')
      if (selectedRange) throw cause
    }
  }
  async function importPicked(incoming: WorkspaceAsset[]) {
    if (incoming.some((asset) => asset.kind !== 'audio' && asset.kind !== 'video'))
      throw new Error('音频制作只能加入音频或视频素材')
    const saved = await importEditorMaterials(context.workspaceId, incoming)
    setMaterialAssets((current) => [
      ...current,
      ...saved.filter((item) => !current.some((existing) => existing.path === item.path))
    ])
    setStatus(`已加入 ${incoming.length} 项素材`)
  }
  function addTextTrack() {
    if (context.readonly || (doc.textTracks?.length ?? 0) >= textLimits.tracks) return
    const track = createTextTrack(`文字 ${(doc.textTracks?.length ?? 0) + 1}`)
    change({ ...doc, textTracks: [...(doc.textTracks ?? []), track] })
    setSelection({ kind: 'track', id: track.id })
  }
  function addAudioTrack() {
    if (context.readonly || doc.tracks.length >= 32) return
    const track = createAudioTrack(`声音 ${doc.tracks.length + 1}`)
    change({ ...doc, tracks: [...doc.tracks, track] })
    setSelection({ kind: 'track', id: track.id })
  }
  function showContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    target: AudioContextMenu['target'],
    id?: string
  ) {
    event.preventDefault()
    event.stopPropagation()
    const next = audioContextSelection(selection, selectedItems, selectedIds, target, id)
    setPrimarySelection(next.primary)
    setSelectedItems(next.items)
    setContextMenu({
      target,
      x: Math.max(
        8,
        Math.min(
          event.clientX || event.currentTarget.getBoundingClientRect().left,
          window.innerWidth - 210
        )
      ),
      y: Math.max(
        8,
        Math.min(
          event.clientY || event.currentTarget.getBoundingClientRect().bottom,
          window.innerHeight - 270
        )
      )
    })
  }
  function contextAction(action: () => void) {
    setContextMenu(null)
    action()
  }
  function addCue() {
    const target =
      doc.textTracks?.find(
        (track) => track.id === selection?.id || track.cues.some((cue) => cue.id === selection?.id)
      ) ?? doc.textTracks?.[0]
    if (context.readonly || target?.locked || (target?.cues.length ?? 0) >= textLimits.cues) return
    const cue = createTextCue(
      '请输入文字',
      playhead,
      Math.min(5, Math.max(3, timelineDuration(doc) - playhead))
    )
    if (!target) {
      const track = createTextTrack('文字 1')
      track.cues = [cue]
      change({ ...doc, textTracks: [track] })
      setSelection({ kind: 'cue', id: cue.id })
      return
    }
    change({
      ...doc,
      textTracks: (doc.textTracks ?? []).map((track) =>
        track.id === target.id ? { ...track, cues: [...track.cues, cue] } : track
      )
    })
    setSelection({ kind: 'cue', id: cue.id })
  }
  function addMarker(at = playhead) {
    if (context.readonly || (doc.markers?.length ?? 0) >= audioLimits.markers) return
    const marker = {
      id: crypto.randomUUID(),
      name: `标记 ${(doc.markers?.length ?? 0) + 1}`,
      time: Math.round(clampTimelinePosition(at, 86400) * 1000) / 1000
    }
    change({ ...doc, markers: [...(doc.markers ?? []), marker] })
    setInspectorView('properties')
    setSelection({ kind: 'marker', id: marker.id })
  }
  function duplicateSelected() {
    if (!selectionEditable) return
    try {
      const copied = copyAudioSelection(doc, selectedIds)
      if (!copied) return
      const end = Math.max(...copied.entries.map(({ item }) => item.start + item.duration))
      const pasted = pasteAudioSelection(doc, copied, end)
      change(pasted.document)
      setSelectedItems(pasted.ids)
      const first = audioEntries(pasted.document).find((entry) => entry.item.id === pasted.ids[0])
      if (first) setPrimarySelection({ kind: first.kind, id: first.item.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建副本失败')
    }
  }
  function moveSelectedToTrack(trackId: string) {
    if (context.readonly) return
    if (selectedClip && selectedClipTrack && selectedClipTrack.id !== trackId) {
      const target = doc.tracks.find((track) => track.id === trackId)
      if (!target || target.locked || selectedClipTrack.locked || target.clips.length >= 256) return
      change({
        ...doc,
        tracks: doc.tracks.map((track) =>
          track.id === selectedClipTrack.id
            ? { ...track, clips: track.clips.filter((clip) => clip.id !== selectedClip.id) }
            : track.id === target.id
              ? { ...track, clips: [...track.clips, selectedClip] }
              : track
        )
      })
    } else if (selectedCue && selectedCueTrack && selectedCueTrack.id !== trackId) {
      const target = doc.textTracks?.find((track) => track.id === trackId)
      if (
        !target ||
        target.locked ||
        selectedCueTrack.locked ||
        target.cues.length >= textLimits.cues
      )
        return
      change({
        ...doc,
        textTracks: (doc.textTracks ?? []).map((track) =>
          track.id === selectedCueTrack.id
            ? { ...track, cues: track.cues.filter((cue) => cue.id !== selectedCue.id) }
            : track.id === target.id
              ? { ...track, cues: [...track.cues, selectedCue] }
              : track
        )
      })
    }
  }
  function removeSelected() {
    if (!selection || context.readonly) return
    if (
      (selectedClip &&
        doc.tracks.some(
          (track) => track.locked && track.clips.some((clip) => clip.id === selectedClip.id)
        )) ||
      (selectedCue &&
        doc.textTracks?.some(
          (track) => track.locked && track.cues.some((cue) => cue.id === selectedCue.id)
        )) ||
      selectedTrack?.locked ||
      selectedTextTrack?.locked ||
      (selection.kind === 'track' &&
        (!!selectedTrack?.clips.length || !!selectedTextTrack?.cues.length))
    )
      return
    if (selection.kind === 'clip')
      change({
        ...doc,
        tracks: doc.tracks.map((track) => ({
          ...track,
          clips: track.clips.filter((clip) => clip.id !== selection.id)
        }))
      })
    else if (selection.kind === 'cue')
      change({
        ...doc,
        textTracks: (doc.textTracks ?? []).map((track) => ({
          ...track,
          cues: track.cues.filter((cue) => cue.id !== selection.id)
        }))
      })
    else if (selection.kind === 'marker')
      change({
        ...doc,
        markers: (doc.markers ?? []).filter((marker) => marker.id !== selection.id)
      })
    else if (selection.kind === 'track')
      change({
        ...doc,
        tracks: doc.tracks.filter((track) => track.id !== selection.id),
        textTracks: (doc.textTracks ?? []).filter((track) => track.id !== selection.id)
      })
    setSelection(null)
  }
  function splitSelected() {
    if (context.readonly || !selectedIds.length) return
    try {
      const next = splitAudioSelection(doc, selectedIds, playhead)
      const oldIds = new Set(audioEntries(doc).map((entry) => entry.item.id))
      const added = audioEntries(next).filter((entry) => !oldIds.has(entry.item.id))
      change(next)
      if (added.length) {
        setSelectedItems(added.map((entry) => entry.item.id))
        setPrimarySelection({ kind: added[0].kind, id: added[0].item.id })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '分割失败')
    }
  }
  const splitSelectedCue = splitSelected
  async function play() {
    if (playing || playback.buffering) {
      playback.pause()
      return
    }
    if (unavailablePaths.length) return
    const end = loop && range ? range.end : timelineDuration(doc)
    const start =
      loop && range && (playhead < range.start || playhead >= range.end)
        ? range.start
        : playhead >= end
          ? 0
          : playhead
    setError('')
    await playback.play({ document: doc, start, end, loop: loop && range ? range : undefined })
  }
  function audition(next: { start: number; end: number }) {
    if (next.end <= next.start || unavailablePaths.length) return
    playback.stop()
    setRange(next)
    setLoop(true)
    setPlayhead(next.start)
    void playback.play({ document: doc, start: next.start, end: next.end, loop: next })
  }
  function locateTime(time: number) {
    seek(time)
    const element = timelineScrollRef.current
    if (element)
      element.scrollLeft = followTimelineViewport({
        position: time,
        pixelsPerSecond: zoom,
        scrollLeft: element.scrollLeft,
        viewportWidth: element.clientWidth,
        contentDuration: duration
      })
  }
  function jumpPoint(direction: number) {
    const points = timelineNavigationPoints(
      audioEntries(doc).map(({ item }) => item),
      [{ time: 0 }, ...(doc.markers ?? [])]
    )
    const next = nextTimelinePoint(points, playhead, direction > 0 ? 'next' : 'previous')
    if (next !== undefined) locateTime(next)
  }
  async function exportArtifact() {
    if (
      busy ||
      context.readonly ||
      !doc.tracks.some((track) => track.clips.length) ||
      unavailablePaths.length
    )
      return
    const exportRange = exportScope === 'selection' ? range : null
    if (exportScope === 'selection' && !exportRange) return
    setBusy(true)
    setError('')
    try {
      playback.stop()
      const snapshot = await persist()
      setNotesOpen(false)
      setTaskListOpen(true)
      const result = await exports.submit({
        document: snapshot,
        revision: sha256Hex(json(snapshot)),
        name: exportName.trim() || `${context.draft.name}.${exportFormat}`,
        format: exportFormat,
        start: exportRange?.start ?? 0,
        duration: exportRange ? exportRange.end - exportRange.start : timelineDuration(snapshot)
      })
      if (result) {
        setStatus(result.deleted ? '原任务已确认，记录已删除，未重新导出' : '已加入后台导出任务')
        setExportOpen(false)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导出失败')
    } finally {
      setBusy(false)
    }
  }
  async function importText(file: File | null) {
    if (!file || context.readonly || (doc.textTracks?.length ?? 0) >= textLimits.tracks) return
    try {
      const format = file.name.toLowerCase().endsWith('.lrc')
        ? 'lrc'
        : file.name.toLowerCase().endsWith('.vtt')
          ? 'vtt'
          : file.name.toLowerCase().endsWith('.txt')
            ? 'txt'
            : 'srt'
      const cues = parseTextTrack(decodeTextFile(await file.arrayBuffer()), format, {
        duration: timelineDuration(doc)
      })
      const track = createTextTrack(file.name.replace(/\.[^.]+$/, ''))
      track.cues = cues
      change({ ...doc, textTracks: [...(doc.textTracks ?? []), track] })
      setSelection({ kind: 'track', id: track.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '歌词或字幕导入失败')
    }
  }
  function exportText() {
    const track = activeTextTrack
    if (!track) return
    if (textExportScope === 'selection' && !range) return
    try {
      const contents = serializeTextTrack(
        track,
        textExportFormat,
        textExportScope === 'selection' ? (range ?? undefined) : undefined
      )
      const url = URL.createObjectURL(new Blob([contents], { type: 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${track.name}.${textExportFormat}`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '字幕导出失败')
    }
  }
  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLElement)) return
      if (!event.target.closest('.react-audio-context-menu')) setContextMenu(null)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setContextMenu(null)
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            '.react-audio-context-menu button:not(:disabled)'
          )
        )
        if (!items.length) return
        event.preventDefault()
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : event.key === 'ArrowDown'
                ? (index + 1) % items.length
                : (index + items.length - 1) % items.length
        items[next].focus()
      }
    }
    const focus = window.requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('.react-audio-context-menu button:not(:disabled)')
        ?.focus()
    )
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', keydown)
    return () => {
      window.cancelAnimationFrame(focus)
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', keydown)
    }
  }, [contextMenu])
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (contextMenu || initial.loadError) return
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[role="dialog"], [role="menu"]')
      )
        return
      const input =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement &&
          (event.target.isContentEditable ||
            !!event.target.closest('[role="slider"], [role="spinbutton"], [role="combobox"]')))
      const command = event.ctrlKey || event.metaKey
      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
        return
      }
      if (event.defaultPrevented) return
      if (event.key === 'Escape' && (dragRef.current || cueDragRef.current || boxDragRef.current)) {
        event.preventDefault()
        pointerFrames.cancel()
        cancelBox()
        const snapshot = dragRef.current ?? cueDragRef.current
        dragRef.current = undefined
        cueDragRef.current = undefined
        dragHistoryRecordedRef.current = false
        if (snapshot) rollbackDrag(snapshot)
        for (const element of timelineScrollRef.current?.querySelectorAll<HTMLElement>(
          '[data-drag-mode]'
        ) ?? []) {
          delete element.dataset.dragMode
          element.style.cursor = ''
        }
        return
      }
      if (event.key === 'Escape' && envelopeDragRef.current) {
        event.preventDefault()
        rollbackDrag(envelopeDragRef.current)
        envelopeDragRef.current = null
        dragHistoryRecordedRef.current = false
        return
      }
      if (command && !input && ['a', 'c', 'x', 'v', 'g'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        const key = event.key.toLowerCase()
        if (key === 'a') {
          const entries = audioEntries(doc)
          setSelectedItems(entries.map((entry) => entry.item.id))
          if (entries[0]) setPrimarySelection({ kind: entries[0].kind, id: entries[0].item.id })
        }
        if (key === 'c') copySelection()
        if (key === 'x') copySelection(true)
        if (key === 'v') pasteSelection()
        if (key === 'g') groupSelection(event.shiftKey)
      } else if (!input && !command && ['[', ']'].includes(event.key)) {
        event.preventDefault()
        jumpPoint(event.key === ']' ? 1 : -1)
      } else if (!input && !command && ['i', 'o'].includes(event.key.toLowerCase())) {
        event.preventDefault()
        const next = setTimelineRangeEndpoint(
          range,
          event.key.toLowerCase() === 'i' ? 'start' : 'end',
          playhead,
          timelineDuration(doc)
        )
        if (next) changeRange(next)
      } else if (
        !input &&
        !command &&
        ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
      ) {
        event.preventDefault()
        if (event.key === 'Home') seek(0)
        else if (event.key === 'End') seek(timelineDuration(doc))
        else seek(playhead + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 1 : 0.01))
      } else if (event.key === 'Escape' && !input) {
        setSelection(null)
        changeRange(null)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !input) {
        event.preventDefault()
        undo(event.shiftKey)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !input) {
        event.preventDefault()
        undo(true)
      } else if (
        event.code === 'Space' &&
        !input &&
        (!(
          event.target instanceof HTMLElement && event.target.closest('button, [role="button"]')
        ) ||
          (event.target instanceof HTMLElement && !!event.target.closest('[data-timeline-item]')))
      ) {
        event.preventDefault()
        void play()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !input) {
        event.preventDefault()
        deleteSelection(event.shiftKey)
      } else if (
        !input &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.toLowerCase() === 's'
      ) {
        if (selectedCue && selectedIds.length <= 1) splitSelectedCue()
        else splitSelected()
      } else if (
        !input &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'm'
      ) {
        addMarker()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  if (initial.loadError)
    return (
      <EditorRecoveryPanel
        workspaceId={context.workspaceId}
        draftId={context.draft.id}
        kind="audio"
        name={context.draft.name}
        raw={initial.raw ?? ''}
        loadError={initial.loadError}
        readonly={context.readonly}
        backAction={backAction}
        helpAction={helpAction}
        onRecovered={() => window.location.reload()}
      />
    )

  const saveStateLabel =
    error ||
    notes.error ||
    (context.readonly
      ? '只读'
      : busy || notes.saving
        ? '正在处理'
        : dirty || notes.dirty
          ? '修改正在保存'
          : status || '编辑文档已保存到本机')

  return (
    <div className="react-editor-panel audio-pro-studio">
      <div className="react-editor-toolbar audio-command-pill">
        {backAction}
        <Text
          fw={700}
          size="xs"
          className="react-image-doc-title"
          title={`${context.workspace.name} · ${context.work.name} · ${context.draft.name}`}
        >
          {context.draft.name}
        </Text>
        {renameAction}
        <Button
          size="xs"
          aria-label="保存编辑"
          leftSection={<IconDeviceFloppy size={15} />}
          onClick={() => void save()}
          loading={busy || notes.saving}
          disabled={(!dirty && !notes.dirty) || context.readonly}
        >
          保存编辑
        </Button>
        <Button
          size="xs"
          aria-label="导出产物"
          variant="filled"
          leftSection={<IconDownload size={15} />}
          onClick={openExport}
          loading={busy}
          disabled={
            !doc.tracks.some((track) => track.clips.length) ||
            context.readonly ||
            !!unavailablePaths.length
          }
        >
          导出产物
        </Button>
        <Tooltip label="撤销 Ctrl+Z">
          <ActionIcon
            variant="subtle"
            aria-label="撤销"
            disabled={context.readonly || !past.length}
            onClick={() => undo()}
          >
            <IconArrowBackUp size={18} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="重做 Ctrl+Y / Ctrl+Shift+Z">
          <ActionIcon
            variant="subtle"
            aria-label="重做"
            disabled={context.readonly || !future.length}
            onClick={() => undo(true)}
          >
            <IconArrowForwardUp size={18} />
          </ActionIcon>
        </Tooltip>
        {helpAction}
        <Tooltip label={saveStateLabel}>
          <span
            className={`react-image-save-state ${error || notes.error ? 'is-error' : dirty || notes.dirty || busy || notes.saving ? 'is-dirty' : ''}`}
            aria-label={saveStateLabel}
            role="status"
          />
        </Tooltip>
      </div>
      {taskListOpen && (
        <EditorTaskList
          context={context}
          exports={exports}
          exportKind="audio"
          onClose={() => setTaskListOpen(false)}
          onRetryExport={() => {
            setTaskListOpen(false)
            openExport()
          }}
        />
      )}
      <EditorActions
        className="audio-top-actions"
        notes={{
          opened: notesOpen,
          onToggle: () => void toggleNotes()
        }}
        versions={
          <EditorVersions
            workspaceId={context.workspaceId}
            draftId={context.draft.id}
            kind="audio"
            document={doc}
            readonly={context.readonly}
            disabled={!!initial.loadError}
            parseDocument={readAudioTimeline}
            summarize={(document) =>
              `${document.tracks.length} 条音轨 · ${document.tracks.reduce((count, track) => count + track.clips.length, 0)} 个片段 · ${formatTimelineTime(timelineDuration(document))}`
            }
            onBeforeSave={flushChanges}
            onOpen={async () => {
              playback.stop()
              await notes.flush()
              setNotesOpen(false)
              setTaskListOpen(false)
            }}
            onRestore={(document) => {
              playback.stop()
              change(document)
              setSelection(null)
            }}
          />
        }
        tasks={{
          opened: taskListOpen,
          running: exports.tasks.some(
            (task) => task.state === 'queued' || task.state === 'running'
          ),
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
      <div className="react-editor-main audio-pro-main">
        <aside ref={toolRailRef} className="audio-tool-rail" aria-label="音频编辑工具">
          <Tooltip label="添加音轨" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="添加音轨"
              disabled={context.readonly || doc.tracks.length >= 32}
              onClick={addAudioTrack}
            >
              <IconMusicPlus size={19} />
            </ActionIcon>
          </Tooltip>
          <AudioTextTool
            opened={railTool === 'text'}
            onOpenedChange={(opened) => setRailTool(opened ? 'text' : null)}
            tracks={(doc.textTracks ?? []).map((track) => ({
              id: track.id,
              name: track.name,
              locked: track.locked,
              count: track.cues.length
            }))}
            activeTrackId={activeTextTrack?.id}
            readonly={context.readonly}
            canCreateTrack={(doc.textTracks?.length ?? 0) < textLimits.tracks}
            canAddCue={!cueTarget?.locked && (cueTarget?.cues.length ?? 0) < textLimits.cues}
            hasRange={!!range}
            format={textExportFormat}
            scope={textExportScope}
            onCreateTrack={addTextTrack}
            onSelectTrack={(id) => {
              setInspectorView('properties')
              setSelection({ kind: 'track', id })
            }}
            onAddCue={addCue}
            onImport={(file) => void importText(file)}
            onFormatChange={setTextExportFormat}
            onScopeChange={setTextExportScope}
            onExport={exportText}
          />
          <Divider my={4} />
          <Tooltip label="在播放头分割（S）" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="在播放头分割"
              disabled={!selectionEditable}
              onClick={splitSelected}
            >
              <IconScissors size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="声音编辑" position="right">
            <ActionIcon
              variant={soundEditorOpen && selectedClip ? 'light' : 'subtle'}
              aria-label="声音编辑"
              aria-expanded={soundEditorOpen && !!selectedClip}
              disabled={!selectedClip}
              onClick={() => (soundEditorOpen ? setSoundEditorOpen(false) : openSoundEditor())}
            >
              <IconWaveSine size={19} />
            </ActionIcon>
          </Tooltip>
          <TimelineMarkerMenu
            opened={railTool === 'markers'}
            onOpenedChange={(opened) => setRailTool(opened ? 'markers' : null)}
            markers={doc.markers ?? []}
            selectedId={selection?.kind === 'marker' ? selection.id : undefined}
            addDisabled={context.readonly || (doc.markers?.length ?? 0) >= audioLimits.markers}
            onAdd={addMarker}
            onSelect={(id, time) => {
              setInspectorView('properties')
              setSelection({ kind: 'marker', id })
              locateTime(time)
            }}
          />
          <Divider my={4} />
          <AudioPropertyControls
            opened={railTool === 'presets'}
            onOpenedChange={(opened) => setRailTool(opened ? 'presets' : null)}
            workspaceId={context.workspaceId}
            draftId={context.draft.id}
            properties={
              selectedClip
                ? captureClipProperties(selectedClip)
                : selectedTrack
                  ? captureTrackProperties(selectedTrack)
                  : captureMasterProperties(doc)
            }
            targetLabel={
              selectedClip
                ? `声音片段 · ${selectedClip.name}`
                : selectedTrack
                  ? `音轨 · ${selectedTrack.name}`
                  : `总混音 · ${context.draft.name}`
            }
            readonly={context.readonly || !!initial.loadError}
            onApply={(properties) =>
              change(
                applyAudioProperties(
                  docRef.current,
                  properties,
                  properties.kind === 'clip' ? selectedIds : selectedTrack ? [selectedTrack.id] : []
                )
              )
            }
          />
          <AudioLoudnessTool
            opened={railTool === 'loudness'}
            onOpenedChange={(opened) => setRailTool(opened ? 'loudness' : null)}
            workspaceId={context.workspaceId}
            draftId={context.draft.id}
            soundRevision={mixPreviewSignature('audio', doc)}
            readonly={context.readonly}
            document={doc}
            onSeek={locateTime}
          />
          <Divider my={4} />
          <SourceRepairButton
            workspaceId={context.workspaceId}
            draftId={context.draft.id}
            kind="audio"
            sources={projectRelinkSources(doc, 'audio')}
            repairing={projectSourcesOpen || relinkPaths !== null}
            onClick={() => {
              playback.stop()
              setProjectSourcesOpen(true)
            }}
          />
        </aside>
        <div
          className={`react-audio-workarea${soundEditorOpen && selectedClip ? ' has-sound-editor' : ''}`}
          style={
            {
              '--audio-track-height': `${trackHeight}px`,
              '--timeline-track-header-width': `${TIMELINE_TRACK_HEADER_WIDTH}px`,
              '--audio-playhead-x': `${playhead * zoom}px`,
              '--audio-tick-step': `${videoRulerStep(zoom) * zoom}px`
            } as CSSProperties
          }
        >
          <div className="audio-timeline-heading">
            <div>
              <strong>声音时间线</strong>
              <span>
                {doc.tracks.length} 条音轨 ·{' '}
                {doc.tracks.reduce((total, track) => total + track.clips.length, 0)} 个片段 ·{' '}
                {(doc.textTracks ?? []).length} 条文字轨
              </span>
            </div>
          </div>
          {textPreview && (
            <div className="react-audio-preview">
              <Text size="xs" c="dimmed" w={100}>
                文字预览
              </Text>
              <Text fw={650} ta="center">
                {(doc.textTracks ?? [])
                  .filter((track) => track.visible)
                  .flatMap((track) => track.cues)
                  .filter((cue) => cue.start <= playhead && playhead < cue.start + cue.duration)
                  .map((cue) => cue.text)
                  .join(' · ') || ' '}
              </Text>
            </div>
          )}
          <TimelineTransport
            playing={playing || playback.buffering}
            buffering={playback.buffering}
            disabled={!timelineDuration(doc) || !!unavailablePaths.length}
            playhead={playhead}
            duration={timelineDuration(doc)}
            onPlay={() => void play()}
            onSeek={seek}
            onStep={(direction) => seek(playhead + direction * 0.01)}
            stepLabels={['后退 0.01 秒', '前进 0.01 秒']}
            onNavigate={(direction) => jumpPoint(direction === 'next' ? 1 : -1)}
            zoom={zoom}
            maxZoom={1000}
            onZoom={zoomTimeline}
            onFit={fitTimeline}
            selectionDisabled={!selectedIds.length}
            snapping={snapping}
            onSnapping={() => setSnapping((value) => !value)}
            alignmentPrecision="音频采样"
            viewActions={
              <>
                <TimelineTrackHeightMenu
                  label="音轨高度"
                  value={trackHeight}
                  onChange={setTrackHeight}
                />
                <Button
                  size="compact-xs"
                  variant={textPreview ? 'light' : 'subtle'}
                  aria-pressed={textPreview}
                  onClick={() => setTextPreview((value) => !value)}
                >
                  文字预览
                </Button>
              </>
            }
            actions={
              <Button
                size="compact-xs"
                variant={loop ? 'light' : 'subtle'}
                disabled={!range}
                aria-pressed={loop}
                onClick={() => {
                  playback.stop()
                  setLoop((value) => !value)
                }}
              >
                循环选区
              </Button>
            }
            settings={
              <Menu position="bottom-start" withinPortal closeOnItemClick={false}>
                <Menu.Target>
                  <ActionIcon variant="subtle" size="sm" aria-label="播放与导航设置">
                    <IconAdjustments size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>波形</Menu.Label>
                  <Menu.Item onClick={() => setWaveStereo((value) => !value)}>
                    {waveStereo ? '✓ ' : ''}左右声道分开
                  </Menu.Item>
                  {[1, 2, 4, 8].map((value) => (
                    <Menu.Item key={value} onClick={() => setWaveAmplitude(value)}>
                      {waveAmplitude === value ? '✓ ' : ''}振幅 {value}×
                    </Menu.Item>
                  ))}
                  <Menu.Divider />
                  <Menu.Item onClick={() => setFollowPlayhead((value) => !value)}>
                    跟随播放头 {followPlayhead ? '✓' : ''}
                  </Menu.Item>
                  <Menu.Item
                    disabled={!selectedClip}
                    onClick={() => {
                      if (selectedClip) {
                        seek(selectedClip.start)
                        fitTimeline(true)
                      }
                    }}
                  >
                    定位选中片段
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            }
          />
          <TimelineTimeControls
            playhead={playhead}
            range={range}
            duration={timelineDuration(doc)}
            onSeek={seek}
            onRangeChange={changeRange}
            step={0.01}
          />
          {error && (
            <Alert
              color="red"
              className="audio-pro-error"
              withCloseButton
              onClose={() => setError('')}
            >
              {error}
            </Alert>
          )}
          {!!unavailablePaths.length && (
            <Alert
              color="yellow"
              className="audio-pro-error"
              title={`${unavailablePaths.length} 项声音素材不可用`}
            >
              <Group justify="space-between">
                <Text size="xs">恢复素材后才能试听和导出。</Text>
                <Button
                  size="compact-xs"
                  variant="light"
                  onClick={() => setSourceRetry((value) => value + 1)}
                >
                  重新读取
                </Button>
                <Button
                  size="compact-xs"
                  variant="light"
                  disabled={context.readonly}
                  onClick={() => {
                    playback.stop()
                    setProjectSourcesOpen(true)
                  }}
                >
                  修复素材
                </Button>
              </Group>
            </Alert>
          )}
          <TimelineViewport
            className="react-audio-timeline"
            width={laneWidth}
            scrollRef={timelineScrollRef}
            corner="时间线"
            ruler={
              <TimelineRuler
                className="react-audio-lane react-audio-ruler"
                width={laneWidth}
                duration={Math.min(duration, 86400)}
                contentEnd={timelineDuration(doc)}
                pixelsPerSecond={zoom}
                ticks={rulerTicks}
                viewportLeft={viewport.left}
                viewportWidth={viewport.width}
                scrollContainer={timelineScrollRef}
                playhead={playhead}
                range={range}
                step={0.01}
                showPlayhead
                markers={doc.markers}
                selectedMarkerId={selection?.kind === 'marker' ? selection.id : undefined}
                markerEditingDisabled={context.readonly || !!initial.loadError}
                markerAddingDisabled={(doc.markers?.length ?? 0) >= audioLimits.markers}
                onMarkerAdd={(time) => addMarker(time)}
                onMarkerSelect={(id, time) => {
                  setInspectorView('properties')
                  setSelection({ kind: 'marker', id })
                  locateTime(time)
                }}
                onMarkerMove={(id, time) => {
                  const current = docRef.current
                  change({
                    ...current,
                    markers: current.markers?.map((marker) =>
                      marker.id === id ? { ...marker, time } : marker
                    )
                  })
                }}
                alignMarker={(time, bypass, id) =>
                  Math.round(
                    (snapping && !bypass
                      ? snapTime(time, timelineSnapPoints(doc, playhead, id), 8 / zoom).time
                      : time) * 1000
                  ) / 1000
                }
                onSeek={(time) => seek(time, false)}
                onSeekCommit={() => setZoomFocused(true)}
                onRangeChange={changeRange}
                alignSelection={(time, bypass) =>
                  snapping && !bypass
                    ? snapTime(time, timelineSnapPoints(doc, playhead), 8 / zoom).time
                    : time
                }
              />
            }
            overlay={selectionBox && <div className="audio-marquee" style={selectionBox} />}
            canvasProps={{ onPointerDown: beginBox }}
            scrollProps={{
              onScroll: (event) => {
                const left = event.currentTarget.scrollLeft,
                  width = event.currentTarget.clientWidth
                viewportFrames.schedule(() =>
                  setViewport((previous) =>
                    previous.left === left && previous.width === width ? previous : { left, width }
                  )
                )
              },
              onPointerDown: beginBox,
              onPointerMove: (event) => {
                if (!boxDragRef.current) return
                const input = {
                  clientX: event.clientX,
                  clientY: event.clientY,
                  currentTarget: event.currentTarget
                }
                boxFrames.schedule(() => moveBox(input))
              },
              onPointerUp: endBox,
              onPointerCancel: cancelBox
            }}
          >
            {doc.tracks.map((track) => (
              <TimelineRow
                className="react-audio-row react-audio-sound-row"
                key={track.id}
                height={trackHeight}
                header={
                  <TimelineTrackHeader
                    className="react-audio-label"
                    name={track.name}
                    metadata={`${Math.round(track.gain * 100)}%`}
                    active={activeTrackId === track.id}
                    related={relatedTrackIds.has(track.id)}
                    readonly={context.readonly}
                    onSelect={() => setSelection({ kind: 'track', id: track.id })}
                    onRename={(name) => updateTrack(track.id, { name })}
                    onContextMenu={(event) => showContextMenu(event, 'track', track.id)}
                  >
                    <TimelineTrackAction
                      type="button"
                      aria-label={`${track.name} ${track.muted ? '取消静音' : '静音'}`}
                      aria-pressed={track.muted}
                      disabled={context.readonly || track.locked}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateTrack(track.id, { muted: !track.muted })
                      }}
                    >
                      {track.muted ? <IconVolumeOff size={13} /> : <IconVolume size={13} />}
                    </TimelineTrackAction>
                    <TimelineTrackAction
                      type="button"
                      aria-label={`${track.name} ${track.solo ? '取消独奏' : '独奏'}`}
                      tooltip={track.solo ? '取消独奏' : '独奏：只播放此音轨'}
                      aria-pressed={track.solo}
                      disabled={context.readonly || track.locked}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateTrack(track.id, { solo: !track.solo })
                      }}
                    >
                      S
                    </TimelineTrackAction>
                    <TimelineTrackAction
                      type="button"
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
                      type="button"
                      aria-label={`上移${track.name}`}
                      disabled={context.readonly || doc.tracks.indexOf(track) === 0}
                      onClick={(event) => {
                        event.stopPropagation()
                        moveTrack(track.id, -1)
                      }}
                    >
                      <IconArrowUp size={13} />
                    </TimelineTrackAction>
                    <TimelineTrackAction
                      type="button"
                      aria-label={`下移${track.name}`}
                      disabled={
                        context.readonly || doc.tracks.indexOf(track) === doc.tracks.length - 1
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        moveTrack(track.id, 1)
                      }}
                    >
                      <IconArrowDown size={13} />
                    </TimelineTrackAction>
                  </TimelineTrackHeader>
                }
              >
                <div
                  className="react-audio-lane timeline-track-lane"
                  data-active={activeTrackId === track.id || undefined}
                  data-related={relatedTrackIds.has(track.id) || undefined}
                  style={{ width: laneWidth }}
                  data-track-id={track.id}
                  onContextMenu={(event) => showContextMenu(event, 'blank')}
                  onPointerDown={beginBox}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes('application/x-omnigallery-editor-asset'))
                      event.preventDefault()
                  }}
                  onDrop={(event) => {
                    const path = event.dataTransfer.getData(
                      'application/x-omnigallery-editor-asset'
                    )
                    const asset = assets.find((item) => item.path === path)
                    if (!asset) return
                    event.preventDefault()
                    const raw = Math.max(
                      0,
                      (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom
                    )
                    const at =
                      snapping && !event.shiftKey
                        ? snapTime(raw, timelineSnapPoints(doc, playhead), 8 / zoom).time
                        : raw
                    void addAsset(asset, Math.round(at * 1000) / 1000, track.id)
                  }}
                >
                  {track.clips.map((clip) => (
                    <div
                      key={clip.id}
                      className="timeline-clip-item audio-timeline-item"
                      data-selected={selectedIds.includes(clip.id)}
                      data-timeline-item={clip.id}
                      style={{ left: clip.start * zoom, width: clip.duration * zoom }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return
                        event.currentTarget
                          .querySelector<HTMLElement>('button.react-audio-clip')
                          ?.focus({ preventScroll: true })
                        const ids = selectItem(
                          'clip',
                          clip.id,
                          event.shiftKey || event.ctrlKey || event.metaKey
                        )
                        if (
                          context.readonly ||
                          track.locked ||
                          event.shiftKey ||
                          event.ctrlKey ||
                          event.metaKey
                        ) {
                          event.preventDefault()
                          return
                        }
                        event.preventDefault()
                        event.stopPropagation()
                        playback.stop()
                        dragHistoryRecordedRef.current = false
                        dragRef.current = {
                          id: clip.id,
                          x: event.clientX,
                          original: clip,
                          ids,
                          points: pointsForSelection(doc, ids),
                          moved: false,
                          before: doc,
                          past,
                          future,
                          mode: timelineDragMode(event)
                        }
                        event.currentTarget.dataset.dragMode = dragRef.current.mode
                        hoverTimelineClip(event, track.locked)
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        hoverTimelineClip(event, track.locked)
                        if (!dragRef.current) return
                        const clientX = event.clientX,
                          shiftKey = event.shiftKey
                        pointerFrames.schedule(() => moveClipPointer(clip.id, clientX, shiftKey))
                      }}
                      onPointerUp={(event) => {
                        if (dragRef.current?.id !== clip.id) return
                        pointerFrames.flush(() =>
                          moveClipPointer(clip.id, event.clientX, event.shiftKey)
                        )
                        delete event.currentTarget.dataset.dragMode
                        hoverTimelineClip(event, track.locked)
                        const drag = dragRef.current
                        if (drag?.mode === 'move') {
                          const targetId = document
                            .elementFromPoint(event.clientX, event.clientY)
                            ?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId
                          const current = docRef.current
                          const target = current.tracks.find((item) => item.id === targetId)
                          const source = current.tracks.find((item) => item.id === track.id)
                          if (
                            drag.ids.length === 1 &&
                            target &&
                            source &&
                            target.id !== source.id &&
                            !target.locked &&
                            target.clips.length < 256
                          ) {
                            const moved = source.clips.find((item) => item.id === clip.id)
                            if (moved)
                              change({
                                ...current,
                                tracks: current.tracks.map((item) =>
                                  item.id === source.id
                                    ? {
                                        ...item,
                                        clips: item.clips.filter((entry) => entry.id !== clip.id)
                                      }
                                    : item.id === target.id
                                      ? { ...item, clips: [...item.clips, moved] }
                                      : item
                                )
                              })
                          }
                        }
                        dragRef.current = undefined
                        dragHistoryRecordedRef.current = false
                        setSelection({ kind: 'clip', id: clip.id })
                        window.setTimeout(() => void flushChanges(), 100)
                      }}
                      onPointerCancel={(event) => cancelTimelineDrag(event, 'clip')}
                      onLostPointerCapture={(event) => cancelTimelineDrag(event, 'clip')}
                    >
                      <button
                        type="button"
                        className="react-audio-clip"
                        data-selected={selectedIds.includes(clip.id)}
                        title={`${clip.name} · ${clock(clip.duration)} · ${clip.rate ?? 1}×`}
                        onContextMenu={(event) => showContextMenu(event, 'clip', clip.id)}
                        onClick={(event) => {
                          if (!event.shiftKey && !event.ctrlKey && !event.metaKey)
                            setSelection({ kind: 'clip', id: clip.id })
                        }}
                      >
                        <AudioClipWaveform
                          clip={clip}
                          workspaceId={context.workspaceId}
                          zoom={zoom}
                          left={viewport.left}
                          width={Math.max(0, viewport.width)}
                          retry={sourceRetry}
                          amplitude={waveAmplitude}
                          stereo={waveStereo}
                        />
                        {selectedIds.includes(clip.id) && <SoundClipFadePreview clip={clip} />}
                        <span className="timeline-sound-clip-title">
                          <span
                            style={{
                              transform: `translateX(${Math.max(0, viewport.left - clip.start * zoom)}px)`,
                              maxWidth: Math.max(
                                0,
                                Math.min(clip.duration * zoom, viewport.width - 12)
                              )
                            }}
                          >
                            {clip.name}
                          </span>
                        </span>
                      </button>
                      {selectedIds.includes(clip.id) && !context.readonly && !track.locked && (
                        <TimelineTrimHandles
                          name={clip.name}
                          viewport={{
                            start: clip.start * zoom,
                            end: (clip.start + clip.duration) * zoom,
                            left: viewport.left,
                            width: viewport.width
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </TimelineRow>
            ))}
            {(doc.textTracks ?? []).map((track) => (
              <TimelineRow
                className="react-audio-row"
                key={track.id}
                height={54}
                header={
                  <TimelineTrackHeader
                    className="react-audio-label"
                    name={track.name}
                    metadata={`${track.cues.length} 段`}
                    active={activeTrackId === track.id}
                    related={relatedTrackIds.has(track.id)}
                    readonly={context.readonly}
                    onSelect={() => setSelection({ kind: 'track', id: track.id })}
                    onRename={(name) => updateTextTrack(track.id, { name })}
                    onContextMenu={(event) => showContextMenu(event, 'text-track', track.id)}
                  >
                    <TimelineTrackAction
                      type="button"
                      aria-label={`${track.name} ${track.visible ? '隐藏' : '显示'}`}
                      aria-pressed={track.visible}
                      disabled={context.readonly}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateTextTrack(track.id, { visible: !track.visible })
                      }}
                    >
                      {track.visible ? <IconEye size={13} /> : <IconEyeOff size={13} />}
                    </TimelineTrackAction>
                    <TimelineTrackAction
                      type="button"
                      aria-label={`${track.name} ${track.locked ? '解锁' : '锁定'}`}
                      aria-pressed={track.locked}
                      disabled={context.readonly}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateTextTrack(track.id, { locked: !track.locked })
                      }}
                    >
                      {track.locked ? <IconLock size={13} /> : <IconLockOpen size={13} />}
                    </TimelineTrackAction>

                    <TimelineTrackAction
                      type="button"
                      aria-label={`上移${track.name}`}
                      disabled={context.readonly || doc.textTracks?.indexOf(track) === 0}
                      onClick={(event) => {
                        event.stopPropagation()
                        moveTrack(track.id, -1, true)
                      }}
                    >
                      <IconArrowUp size={13} />
                    </TimelineTrackAction>
                    <TimelineTrackAction
                      type="button"
                      aria-label={`下移${track.name}`}
                      disabled={
                        context.readonly ||
                        doc.textTracks?.indexOf(track) === (doc.textTracks?.length ?? 0) - 1
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        moveTrack(track.id, 1, true)
                      }}
                    >
                      <IconArrowDown size={13} />
                    </TimelineTrackAction>
                  </TimelineTrackHeader>
                }
              >
                <div
                  className="react-audio-lane timeline-track-lane"
                  data-active={activeTrackId === track.id || undefined}
                  data-related={relatedTrackIds.has(track.id) || undefined}
                  style={{ width: laneWidth }}
                  data-text-track-id={track.id}
                  onPointerDown={beginBox}
                  onContextMenu={(event) => showContextMenu(event, 'text-track', track.id)}
                >
                  {track.cues.map((cue) => (
                    <div
                      key={cue.id}
                      className="timeline-clip-item audio-timeline-item"
                      data-selected={selectedIds.includes(cue.id)}
                      data-timeline-item={cue.id}
                      style={{ left: cue.start * zoom, width: cue.duration * zoom }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return
                        if (editingCueId !== cue.id)
                          event.currentTarget
                            .querySelector<HTMLElement>('.react-audio-cue')
                            ?.focus({ preventScroll: true })
                        const ids = selectItem(
                          'cue',
                          cue.id,
                          event.shiftKey || event.ctrlKey || event.metaKey
                        )
                        if (event.shiftKey || event.ctrlKey || event.metaKey) {
                          event.preventDefault()
                          return
                        }
                        if (
                          event.button !== 0 ||
                          context.readonly ||
                          track.locked ||
                          editingCueId === cue.id
                        )
                          return
                        event.preventDefault()
                        event.stopPropagation()
                        playback.stop()
                        dragHistoryRecordedRef.current = false
                        cueDragRef.current = {
                          id: cue.id,
                          x: event.clientX,
                          start: cue.start,
                          duration: cue.duration,
                          ids,
                          points: pointsForSelection(doc, ids),
                          moved: false,
                          before: doc,
                          past,
                          future,
                          mode: timelineDragMode(event)
                        }
                        event.currentTarget.dataset.dragMode = cueDragRef.current.mode
                        hoverTimelineClip(event, track.locked)
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        if (editingCueId === cue.id) return
                        hoverTimelineClip(event, track.locked)
                        if (!cueDragRef.current) return
                        const clientX = event.clientX,
                          shiftKey = event.shiftKey
                        pointerFrames.schedule(() => moveCuePointer(cue.id, clientX, shiftKey))
                      }}
                      onPointerUp={(event) => {
                        if (cueDragRef.current?.id !== cue.id) return
                        pointerFrames.flush(() =>
                          moveCuePointer(cue.id, event.clientX, event.shiftKey)
                        )
                        delete event.currentTarget.dataset.dragMode
                        hoverTimelineClip(event, track.locked)
                        const targetId = document
                          .elementFromPoint(event.clientX, event.clientY)
                          ?.closest<HTMLElement>('[data-text-track-id]')?.dataset.textTrackId
                        const current = docRef.current
                        const source = current.textTracks?.find((item) => item.id === track.id)
                        const target = current.textTracks?.find((item) => item.id === targetId)
                        if (
                          cueDragRef.current?.mode === 'move' &&
                          cueDragRef.current.ids.length === 1 &&
                          source &&
                          target &&
                          source.id !== target.id &&
                          !target.locked &&
                          target.cues.length < textLimits.cues
                        ) {
                          const moved = source.cues.find((item) => item.id === cue.id)
                          if (moved)
                            change({
                              ...current,
                              textTracks: current.textTracks?.map((item) =>
                                item.id === source.id
                                  ? {
                                      ...item,
                                      cues: item.cues.filter((entry) => entry.id !== cue.id)
                                    }
                                  : item.id === target.id
                                    ? { ...item, cues: [...item.cues, moved] }
                                    : item
                              )
                            })
                        }
                        cueDragRef.current = undefined
                        dragHistoryRecordedRef.current = false
                        setSelection({ kind: 'cue', id: cue.id })
                        window.setTimeout(() => void flushChanges(), 100)
                      }}
                      onPointerCancel={(event) => cancelTimelineDrag(event, 'cue')}
                      onLostPointerCapture={(event) => cancelTimelineDrag(event, 'cue')}
                      onClick={(event) => {
                        if (!event.shiftKey && !event.ctrlKey && !event.metaKey)
                          setSelection({ kind: 'cue', id: cue.id })
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation()
                        const rect = event.currentTarget.getBoundingClientRect()
                        if (event.clientY < rect.top || event.clientY > rect.bottom) return
                        if (!context.readonly && !track.locked) setEditingCueId(cue.id)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && editingCueId !== cue.id) {
                          event.preventDefault()
                          setSelection({ kind: 'cue', id: cue.id })
                          if (!context.readonly && !track.locked) setEditingCueId(cue.id)
                        }
                      }}
                    >
                      <div
                        className="react-audio-cue"
                        role="button"
                        tabIndex={0}
                        aria-label={`文字：${cue.text || '请输入文字'}，${clock(cue.start)} 至 ${clock(cue.start + cue.duration)}`}
                        onContextMenu={(event) => showContextMenu(event, 'text-cue', cue.id)}
                        data-selected={selectedIds.includes(cue.id)}
                        data-editing={editingCueId === cue.id || undefined}
                      >
                        {editingCueId === cue.id ? (
                          <input
                            autoFocus
                            aria-label="直接编辑文字"
                            value={cue.text}
                            maxLength={textLimits.text}
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              updateCue(cue.id, { text: event.currentTarget.value })
                            }
                            onBlur={() => setEditingCueId(null)}
                            onKeyDown={(event) => {
                              event.stopPropagation()
                              if (event.key === 'Enter' || event.key === 'Escape')
                                setEditingCueId(null)
                            }}
                          />
                        ) : (
                          <span className="timeline-text-clip-label">
                            {cue.text || '请输入文字'}
                          </span>
                        )}
                      </div>
                      {selectedIds.includes(cue.id) &&
                        !context.readonly &&
                        !track.locked &&
                        editingCueId !== cue.id && (
                          <TimelineTrimHandles
                            name={cue.text || '请输入文字'}
                            viewport={{
                              start: cue.start * zoom,
                              end: (cue.start + cue.duration) * zoom,
                              left: viewport.left,
                              width: viewport.width
                            }}
                          />
                        )}
                    </div>
                  ))}
                </div>
              </TimelineRow>
            ))}
          </TimelineViewport>
          {soundEditorOpen && selectedClip && selectedClipTrack && (
            <TimelineSoundEditor
              key={selectedClip.id}
              clip={selectedClip}
              trackName={selectedClipTrack.name}
              headerWidth={TIMELINE_TRACK_HEADER_WIDTH}
              zoom={zoom}
              viewportLeft={viewport.left}
              viewportWidth={Math.max(0, viewport.width)}
              mode={soundEditorMode}
              onModeChange={setSoundEditorMode}
              readonly={context.readonly || selectedClipTrack.locked}
              playhead={playhead}
              onClose={() => setSoundEditorOpen(false)}
              onBegin={() => {
                playback.stop()
                envelopeDragRef.current = { before: docRef.current, past, future }
                dragHistoryRecordedRef.current = false
              }}
              onChange={(next) => updateClip(selectedClip.id, () => next)}
              onEnd={(cancel) => {
                const snapshot = envelopeDragRef.current
                envelopeDragRef.current = null
                if (cancel && snapshot) rollbackDrag(snapshot)
                dragHistoryRecordedRef.current = false
                window.setTimeout(() => void flushChanges(), 100)
              }}
              onAudition={(edge) =>
                audition(seamAuditionRange(selectedClip, edge, timelineDuration(doc)))
              }
            />
          )}
          <AudioMixPreparation
            job={playback.preparation}
            onCancel={() => {
              void playback.cancelPreparation()
            }}
          />
        </div>
        <aside className="react-editor-inspector audio-pro-inspector" aria-label="音频属性">
          <header className="audio-inspector-header">
            <strong>音频制作</strong>
            <Text size="xs" c="dimmed">
              48 kHz · 双声道
            </Text>
          </header>
          <SegmentedControl
            size="xs"
            fullWidth
            aria-label="音频属性工具"
            value={inspectorView}
            onChange={setInspectorView}
            data={[
              { value: 'properties', label: '属性' },
              { value: 'mix', label: '混音' }
            ]}
          />
          <div className="audio-inspector-scroll">
            <Stack gap="md">
              <Stack
                gap="md"
                style={{ display: inspectorView === 'properties' ? undefined : 'none' }}
              >
                {(selectedClip ||
                  selectedCue ||
                  selectedTrack ||
                  selectedTextTrack ||
                  selectedMarker) && (
                  <Text fw={700} size="sm">
                    {selectedClip
                      ? '声音片段'
                      : selectedCue
                        ? '文字片段'
                        : selectedTextTrack
                          ? '文字轨'
                          : selectedTrack
                            ? '音轨'
                            : '标记点'}
                  </Text>
                )}
                {selectedClip && (
                  <>
                    <Text size="xs" c="dimmed">
                      {selectedClip.sourceKind === 'video' ? '视频声音 · ' : ''}
                      {selectedClip.name}
                    </Text>
                    <AudioSourceStreamSelect
                      key={`${context.draft.id}:${selectedClip.id}`}
                      workspaceId={context.workspaceId}
                      path={selectedClip.path}
                      kind={selectedClip.sourceKind ?? 'audio'}
                      value={selectedClip.audioStream ?? 0}
                      sourceIn={selectedClip.sourceIn}
                      duration={selectedClip.duration}
                      rate={selectedClip.rate}
                      readonly={context.readonly || selectedClipTrack?.locked}
                      onChange={(audioStream) =>
                        updateClip(selectedClip.id, (clip) => ({ ...clip, audioStream }))
                      }
                    />
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!previewFiles.some((file) => file.fullpath === selectedClip.path)}
                      onClick={() => setPreviewPath(selectedClip.path)}
                    >
                      {selectedClip.sourceKind === 'video' ? '查看源视频' : '试听源音频'}
                    </Button>
                    <Group grow>
                      <NumberInput
                        size="xs"
                        label="开始时间"
                        description={positionLockMessage}
                        decimalScale={3}
                        value={selectedClip.start}
                        onChange={(v) =>
                          updateClip(selectedClip.id, (clip) => ({
                            ...clip,
                            start: Math.max(
                              0,
                              Math.min(86400 - clip.duration, numeric(v, clip.start))
                            )
                          }))
                        }
                        disabled={context.readonly || positionLocked}
                      />
                      <NumberInput
                        size="xs"
                        label="时长"
                        decimalScale={3}
                        value={selectedClip.duration}
                        onChange={(v) =>
                          updateClip(selectedClip.id, (clip) => {
                            const sourceDuration =
                              waveforms[soundSourceKey(clip)]?.duration ??
                              clip.sourceIn + clip.duration * (clip.rate ?? 1)
                            const duration = Math.max(
                              1 / 48000,
                              Math.min(
                                numeric(v, clip.duration),
                                (sourceDuration - clip.sourceIn) / (clip.rate ?? 1),
                                86400 - clip.start
                              )
                            )
                            return {
                              ...clip,
                              duration,
                              envelopeDuration: Math.max(
                                clip.envelopeDuration,
                                clip.envelopeOffset + duration
                              )
                            }
                          })
                        }
                        disabled={context.readonly || selectedClipTrack?.locked}
                      />
                    </Group>
                    <NumberInput
                      size="xs"
                      label="源文件起点（秒）"
                      min={0}
                      decimalScale={3}
                      value={selectedClip.sourceIn}
                      onChange={(v) =>
                        updateClip(selectedClip.id, (clip) => {
                          const sourceDuration =
                            waveforms[soundSourceKey(clip)]?.duration ??
                            clip.sourceIn + clip.duration * (clip.rate ?? 1)
                          const sourceIn = Math.max(
                            0,
                            Math.min(sourceDuration - 1 / 48000, numeric(v, clip.sourceIn))
                          )
                          const duration = Math.min(
                            clip.duration,
                            (sourceDuration - sourceIn) / (clip.rate ?? 1)
                          )
                          return {
                            ...clip,
                            sourceIn,
                            duration,
                            envelopeDuration: Math.max(
                              clip.envelopeDuration,
                              clip.envelopeOffset + duration
                            )
                          }
                        })
                      }
                      disabled={context.readonly || selectedClipTrack?.locked}
                    />
                    <EditorDisclosure title="速度与音调" inline>
                      <Stack gap="xs" pt="xs">
                        <NumberInput
                          size="xs"
                          label="变速"
                          min={0.25}
                          max={4}
                          step={0.05}
                          value={selectedClip.rate ?? 1}
                          onChange={(v) => {
                            try {
                              updateClip(selectedClip.id, (clip) =>
                                setClipRate(clip, numeric(v, 1))
                              )
                            } catch (cause) {
                              setError(cause instanceof Error ? cause.message : '变速无效')
                            }
                          }}
                          disabled={context.readonly || selectedClipTrack?.locked}
                        />
                        <Switch
                          size="xs"
                          label="保持音调"
                          checked={selectedClip.preservePitch ?? true}
                          onChange={(event) =>
                            updateClip(selectedClip.id, (clip) => ({
                              ...clip,
                              preservePitch: event.currentTarget.checked
                            }))
                          }
                          disabled={context.readonly || selectedClipTrack?.locked}
                        />
                      </Stack>
                    </EditorDisclosure>
                    <Text size="xs">片段音量 · {Math.round(selectedClip.gain * 100)}%</Text>
                    <Slider
                      value={selectedClip.gain * 100}
                      min={0}
                      max={200}
                      onChange={(value) =>
                        updateClip(selectedClip.id, (clip) => ({ ...clip, gain: value / 100 }))
                      }
                      disabled={context.readonly || selectedClipTrack?.locked}
                    />
                    <Group grow>
                      <NumberInput
                        size="xs"
                        label="淡入（秒）"
                        min={0}
                        max={selectedClip.duration}
                        step={0.1}
                        decimalScale={3}
                        value={selectedFades?.fadeIn ?? 0}
                        disabled={context.readonly || selectedClipTrack?.locked}
                        onChange={(v) =>
                          updateClip(selectedClip.id, (clip) =>
                            setClipFades(
                              clip,
                              numeric(v, visibleClipFades(clip).fadeIn),
                              visibleClipFades(clip).fadeOut
                            )
                          )
                        }
                      />
                      <NumberInput
                        size="xs"
                        label="淡出（秒）"
                        min={0}
                        max={selectedClip.duration}
                        step={0.1}
                        decimalScale={3}
                        value={selectedFades?.fadeOut ?? 0}
                        disabled={context.readonly || selectedClipTrack?.locked}
                        onChange={(v) =>
                          updateClip(selectedClip.id, (clip) =>
                            setClipFades(
                              clip,
                              visibleClipFades(clip).fadeIn,
                              numeric(v, visibleClipFades(clip).fadeOut)
                            )
                          )
                        }
                      />
                    </Group>
                    <Select
                      size="xs"
                      label="淡化曲线"
                      value={selectedClip.fadeCurve ?? 'linear'}
                      allowDeselect={false}
                      disabled={context.readonly || selectedClipTrack?.locked}
                      data={[
                        { value: 'linear', label: '直线' },
                        { value: 'smooth', label: '柔和' },
                        { value: 'equalPower', label: '等功率' }
                      ]}
                      onChange={(value) =>
                        updateClip(selectedClip.id, (clip) => ({
                          ...clip,
                          fadeCurve: value as AudioClip['fadeCurve']
                        }))
                      }
                    />
                    <Select
                      size="xs"
                      label="所在音轨"
                      value={selectedClipTrack?.id}
                      data={doc.tracks.map((track) => ({
                        value: track.id,
                        label: track.name,
                        disabled: track.locked
                      }))}
                      onChange={(value) => {
                        if (value) moveSelectedToTrack(value)
                      }}
                      disabled={context.readonly || selectedClipTrack?.locked}
                    />
                    <AudioGainControls
                      pan={selectedClip.pan}
                      duration={selectedClip.envelopeDuration}
                      readonly={context.readonly || selectedClipTrack?.locked}
                      onPanChange={(pan) =>
                        updateClip(selectedClip.id, (clip) => ({ ...clip, pan }))
                      }
                    />
                    <EditorDisclosure title="声道处理" inline>
                      <Stack gap="xs" pt="xs">
                        <Select
                          label="声道"
                          size="xs"
                          value={selectedClip.channels ?? 'stereo'}
                          allowDeselect={false}
                          disabled={context.readonly || selectedClipTrack?.locked}
                          data={[
                            { value: 'stereo', label: '原声道' },
                            { value: 'swap', label: '左右互换' },
                            { value: 'mono', label: '合并为单声道' },
                            { value: 'left', label: '只取左声道' },
                            { value: 'right', label: '只取右声道' }
                          ]}
                          onChange={(value) =>
                            updateClip(selectedClip.id, (clip) => ({
                              ...clip,
                              channels: value as AudioClip['channels']
                            }))
                          }
                        />
                        <Switch
                          label="反转相位"
                          size="xs"
                          checked={!!selectedClip.invertPhase}
                          disabled={context.readonly || selectedClipTrack?.locked}
                          onChange={(event) =>
                            updateClip(selectedClip.id, (clip) => ({
                              ...clip,
                              invertPhase: event.currentTarget.checked
                            }))
                          }
                        />
                      </Stack>
                    </EditorDisclosure>
                    <EditorDisclosure title="接缝淡化">
                      <Stack gap="xs" pt="xs">
                        <Group gap="xs" wrap="nowrap">
                          <NumberInput
                            aria-label="交叉淡化时长"
                            label="交叉淡化（秒）"
                            size="xs"
                            min={0.01}
                            max={10}
                            step={0.1}
                            decimalScale={3}
                            value={crossfadeDuration}
                            onChange={(value) => setCrossfadeDuration(numeric(value, 0.5))}
                          />
                          <Button
                            size="compact-xs"
                            variant="light"
                            disabled={context.readonly || selectedClipTrack?.locked}
                            onClick={() => {
                              if (!selectedClipTrack) return
                              const next = [...selectedClipTrack.clips]
                                .filter(
                                  (clip) =>
                                    clip.id !== selectedClip.id && clip.start >= selectedClip.start
                                )
                                .sort((a, b) => a.start - b.start)[0]
                              if (!next) {
                                setError('当前片段后没有可交叉淡化的片段')
                                return
                              }
                              const updated = crossfadeClips(
                                selectedClipTrack,
                                selectedClip.id,
                                next.id,
                                crossfadeDuration
                              )
                              const shifted = updated.clips.find((clip) => clip.id === next.id)
                              if (!shifted) return
                              const linkedIds = expandAudioSelection(doc, [next.id])
                              if (linkedIds.includes(selectedClip.id)) {
                                setError('请先解除这两个片段的关联，再调整交叉淡化')
                                return
                              }
                              const linked = moveAudioSelection(
                                doc,
                                [next.id],
                                shifted.start - next.start
                              )
                              const movedRight = audioEntries(linked).find(
                                (entry) => entry.item.id === next.id
                              )?.item
                              if (
                                !movedRight ||
                                Math.abs(movedRight.start - shifted.start) > 1 / 48000
                              ) {
                                setError('关联片段已锁定或移出了时间线，无法衔接')
                                return
                              }
                              change({
                                ...linked,
                                tracks: linked.tracks.map((track) =>
                                  track.id === updated.id
                                    ? {
                                        ...track,
                                        clips: track.clips.map(
                                          (clip) =>
                                            ([selectedClip.id, next.id].includes(clip.id)
                                              ? updated.clips.find((item) => item.id === clip.id)
                                              : undefined) ?? clip
                                        )
                                      }
                                    : track
                                )
                              })
                            }}
                          >
                            与下一段衔接
                          </Button>
                        </Group>
                      </Stack>
                    </EditorDisclosure>
                  </>
                )}
                {selectedCue && (
                  <>
                    <Textarea
                      label="文字内容"
                      value={selectedCue.text}
                      autosize
                      minRows={4}
                      onChange={(event) =>
                        updateCue(selectedCue.id, { text: event.currentTarget.value })
                      }
                      disabled={context.readonly || selectedCueTrack?.locked}
                    />
                    <Group grow>
                      <NumberInput
                        size="xs"
                        label="开始时间"
                        description={positionLockMessage}
                        decimalScale={3}
                        value={selectedCue.start}
                        onChange={(v) =>
                          updateCue(selectedCue.id, { start: numeric(v, selectedCue.start) })
                        }
                        disabled={context.readonly || positionLocked}
                      />
                      <NumberInput
                        size="xs"
                        label="持续时长"
                        decimalScale={3}
                        value={selectedCue.duration}
                        onChange={(v) =>
                          updateCue(selectedCue.id, { duration: numeric(v, selectedCue.duration) })
                        }
                        disabled={context.readonly || selectedCueTrack?.locked}
                      />
                    </Group>
                    <Select
                      size="xs"
                      label="所在文字轨"
                      value={selectedCueTrack?.id}
                      data={(doc.textTracks ?? []).map((track) => ({
                        value: track.id,
                        label: track.name,
                        disabled: track.locked
                      }))}
                      onChange={(value) => {
                        if (value) moveSelectedToTrack(value)
                      }}
                      disabled={context.readonly || selectedCueTrack?.locked}
                    />
                  </>
                )}
                {selectedTextTrack && (
                  <Text size="xs" c="dimmed">
                    {selectedTextTrack.name} · {selectedTextTrack.cues.length} 段文字
                  </Text>
                )}
                {selectedMarker && (
                  <>
                    <TextInput
                      size="xs"
                      label="名称"
                      maxLength={120}
                      value={selectedMarker.name}
                      onChange={(event) =>
                        change({
                          ...doc,
                          markers: (doc.markers ?? []).map((marker) =>
                            marker.id === selectedMarker.id
                              ? { ...marker, name: event.currentTarget.value }
                              : marker
                          )
                        })
                      }
                      disabled={context.readonly}
                    />
                    <NumberInput
                      size="xs"
                      label="时间（秒）"
                      min={0}
                      max={86400}
                      step={0.01}
                      decimalScale={3}
                      value={selectedMarker.time}
                      onChange={(v) =>
                        change({
                          ...doc,
                          markers: (doc.markers ?? []).map((marker) =>
                            marker.id === selectedMarker.id
                              ? {
                                  ...marker,
                                  time: clampTimelinePosition(numeric(v, marker.time), 86400)
                                }
                              : marker
                          )
                        })
                      }
                      disabled={context.readonly}
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
                          markers: (doc.markers ?? []).map((marker) =>
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
                      onClick={removeSelected}
                      disabled={context.readonly}
                    >
                      删除标记
                    </Button>
                  </>
                )}
                {selectedTrack && (
                  <>
                    <Text size="xs">音轨音量 · {Math.round(selectedTrack.gain * 100)}%</Text>
                    <Slider
                      value={selectedTrack.gain * 100}
                      max={200}
                      onChange={(value) =>
                        change({
                          ...doc,
                          tracks: doc.tracks.map((track) =>
                            track.id === selectedTrack.id ? { ...track, gain: value / 100 } : track
                          )
                        })
                      }
                      disabled={context.readonly}
                    />
                    <Select
                      label="音轨用途"
                      size="xs"
                      value={selectedTrack.role ?? 'sound'}
                      allowDeselect={false}
                      disabled={context.readonly || selectedTrack.locked}
                      data={[
                        { value: 'sound', label: '普通声音' },
                        { value: 'dialogue', label: '对白 / 旁白' },
                        { value: 'music', label: '背景音乐' }
                      ]}
                      onChange={(value) =>
                        updateTrack(selectedTrack.id, {
                          role: value as 'sound' | 'dialogue' | 'music'
                        })
                      }
                    />
                    {selectedTrack.role === 'music' && (
                      <Switch
                        size="xs"
                        label="对白时降低背景音乐"
                        checked={!!selectedTrack.duck}
                        disabled={context.readonly || selectedTrack.locked}
                        onChange={(event) =>
                          updateTrack(selectedTrack.id, { duck: event.currentTarget.checked })
                        }
                      />
                    )}
                    <AudioGainControls
                      pan={selectedTrack.pan}
                      duration={timelineDuration(doc)}
                      readonly={context.readonly || selectedTrack.locked}
                      onPanChange={(pan) => updateTrack(selectedTrack.id, { pan })}
                    />
                    <AudioProcessingControls
                      scope="track"
                      value={selectedTrack.processing}
                      readonly={context.readonly || selectedTrack.locked}
                      onChange={(processing) => updateTrack(selectedTrack.id, { processing })}
                    />
                  </>
                )}
              </Stack>
              <Stack gap="md" style={{ display: inspectorView === 'mix' ? undefined : 'none' }}>
                <section className="react-audio-meter" aria-label="混音音量表">
                  <Group justify="space-between" mb={8}>
                    <Text size="xs" fw={700}>
                      混音音量 · {playing ? '试听中' : '已停止'}
                    </Text>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => {
                        playback.resetPeak()
                      }}
                    >
                      重置峰值
                    </Button>
                  </Group>
                  {levels.map((value, index) => (
                    <div className="react-audio-meter-row" key={index}>
                      <Text size="xs">{index ? 'R' : 'L'}</Text>
                      <div
                        className="react-audio-meter-bar"
                        role="meter"
                        aria-label={index ? '右声道电平' : '左声道电平'}
                        aria-valuemin={-60}
                        aria-valuemax={0}
                        aria-valuenow={Math.max(-60, Math.min(0, levelDb(value)))}
                        aria-valuetext={levelLabel(levelDb(value))}
                      >
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, ((levelDb(value) + 60) / 60) * 100))}%`
                          }}
                        />
                      </div>
                      <Text size="xs" ff="monospace">
                        {levelLabel(levelDb(value))}
                      </Text>
                    </div>
                  ))}
                  <Group justify="space-between" mt={8} gap={4}>
                    <Text size="xs" c="dimmed">
                      峰值 {levelLabel(levelDb(meterPeak))}
                    </Text>
                    <Text size="xs" c={overloaded ? 'red' : 'dimmed'}>
                      {overloaded ? '过载 · 请降低音量' : '0 dBFS 为上限'}
                    </Text>
                  </Group>
                </section>{' '}
                <Divider />
                <Text size="xs" fw={700}>
                  总线处理
                </Text>
                <Text size="xs">总音量 · {Math.round(doc.masterGain * 100)}%</Text>
                <Slider
                  value={doc.masterGain * 100}
                  max={200}
                  onChange={(value) => change({ ...doc, masterGain: value / 100 })}
                  disabled={context.readonly}
                />
                <AudioProcessingControls
                  scope="master"
                  inline
                  value={doc.processing}
                  readonly={context.readonly}
                  onChange={(processing) => change({ ...doc, processing })}
                />
              </Stack>
            </Stack>
          </div>
        </aside>
      </div>
      <div className="audio-pro-materials">
        <MaterialBar
          embedded
          items={assets}
          assetInfo={assetInfo}
          usedPaths={doc.tracks.flatMap((track) => track.clips.map((clip) => clip.path))}
          activePath={selectedClip?.path}
          readonly={context.readonly}
          onPreview={(asset) => setPreviewPath(asset.path)}
          onDragStart={(asset, event) =>
            event.dataTransfer.setData('application/x-omnigallery-editor-asset', asset.path)
          }
          actions={(asset) => [
            { key: 'range', label: '选段添加', disabled: context.readonly },
            {
              key: 'current',
              label: asset.kind === 'video' ? '视频声音添加到当前音轨' : '添加到当前音轨',
              disabled: context.readonly
            },
            {
              key: 'new-track',
              label: asset.kind === 'video' ? '视频声音添加到新音轨' : '添加到新音轨',
              disabled: context.readonly || doc.tracks.length >= 32
            }
          ]}
          onAction={(asset, key) => {
            if (key === 'range') setRangeAsset(asset)
            else void addAsset(asset, playhead, undefined, key === 'new-track')
          }}
          onAdd={() => setPickerOpen(true)}
        />
      </div>
      {contextMenu && (
        <div
          className="react-audio-context-menu"
          role="menu"
          aria-label="时间线操作"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            maxHeight: `calc(100dvh - ${contextMenu.y}px - 8px)`
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {(contextMenu.target === 'clip' || contextMenu.target === 'text-cue') && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={!selectedIds.length}
                onClick={() => contextAction(() => copySelection())}
              >
                复制 <small>Ctrl+C</small>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!selectionEditable}
                onClick={() => contextAction(() => copySelection(true))}
              >
                剪切 <small>Ctrl+X</small>
              </button>
            </>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={context.readonly || !clipboardReady}
            onClick={() => contextAction(pasteSelection)}
          >
            在播放头粘贴 <small>Ctrl+V</small>
          </button>
          {(contextMenu.target === 'clip' || contextMenu.target === 'text-cue') && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={!selectionEditable}
                onClick={() => contextAction(duplicateSelected)}
              >
                创建副本
              </button>
              <hr />
              <button
                type="button"
                role="menuitem"
                disabled={
                  !selectionEditable ||
                  !selectedEntries.some(
                    ({ item }) => playhead > item.start && playhead < item.start + item.duration
                  )
                }
                onClick={() => contextAction(splitSelected)}
              >
                在播放头分割 <small>S</small>
              </button>
              {contextMenu.target === 'clip' && selectedClip && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => contextAction(() => openSoundEditor())}
                >
                  声音编辑
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={!selectionEditable || selectedIds.length < 2}
                onClick={() => contextAction(() => groupSelection())}
              >
                关联移动 <small>Ctrl+G</small>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={!selectionEditable || !selectionLinked}
                onClick={() => contextAction(() => groupSelection(true))}
              >
                解除关联 <small>Ctrl+Shift+G</small>
              </button>
              {selectedClip && (
                <button
                  type="button"
                  role="menuitem"
                  disabled={context.readonly || selectedClipTrack?.locked}
                  onClick={() => contextAction(() => setRelinkPaths([selectedClip.path]))}
                >
                  重新指定素材
                </button>
              )}
              <hr />
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={!selectionEditable}
                onClick={() => contextAction(() => deleteSelection())}
              >
                删除 <small>Delete</small>
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={!selectionEditable}
                onClick={() => contextAction(() => deleteSelection(true))}
              >
                删除并闭合空隙 <small>Shift+Delete</small>
              </button>
            </>
          )}
          {(contextMenu.target === 'track' || contextMenu.target === 'text-track') && (
            <button
              type="button"
              role="menuitem"
              className="danger"
              disabled={
                context.readonly ||
                (!!selectedTrack && (selectedTrack.locked || !!selectedTrack.clips.length)) ||
                (!!selectedTextTrack &&
                  (selectedTextTrack.locked || !!selectedTextTrack.cues.length)) ||
                (!selectedTrack && !selectedTextTrack)
              }
              onClick={() => contextAction(removeSelected)}
            >
              {selectedTextTrack ? '删除空文字轨' : '删除空音轨'}
            </button>
          )}
        </div>
      )}
      <Modal
        opened={exportOpen}
        onClose={() => setExportOpen(false)}
        title="导出音频产物"
        size="sm"
      >
        <Stack gap="sm">
          <TextInput
            label="产物名称"
            value={exportName}
            onChange={(event) => setExportName(event.currentTarget.value)}
          />
          <Select
            label="导出范围"
            value={exportScope}
            data={[
              { value: 'all', label: `完整时间线 · ${formatTimelineTime(timelineDuration(doc))}` },
              {
                value: 'selection',
                label: range
                  ? `当前选区 · ${formatTimelineTime(range.end - range.start)}`
                  : '选区未设置',
                disabled: !range
              }
            ]}
            onChange={(value) => setExportScope(value === 'selection' ? 'selection' : 'all')}
          />
          <Text size="sm" c="dimmed">
            {exportScope === 'selection' && range
              ? `${formatTimelineTime(range.start)} — ${formatTimelineTime(range.end)}`
              : `${formatTimelineTime(0)} — ${formatTimelineTime(timelineDuration(doc))}`}
          </Text>
          <Select
            label="格式"
            value={exportFormat}
            data={['wav', 'mp3']}
            onChange={(value) => {
              const format = value === 'mp3' ? 'mp3' : 'wav'
              setExportFormat(format)
              setExportName((name) => name.replace(/\.(wav|mp3)$/i, `.${format}`))
            }}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setExportOpen(false)}>
              取消
            </Button>
            <Button
              loading={busy}
              disabled={context.readonly || (exportScope === 'selection' && !range)}
              onClick={() => void exportArtifact()}
            >
              导出产物
            </Button>
          </Group>
        </Stack>
      </Modal>
      <WorkbenchMediaPicker
        opened={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={importPicked}
        alreadyAdded={assets.map((asset) => asset.path)}
      />
      <SourceRangePicker
        opened={!!rangeAsset}
        onClose={() => setRangeAsset(null)}
        workspaceId={context.workspaceId}
        asset={rangeAsset}
        readonly={context.readonly}
        modes={['sound']}
        initialMode="sound"
        maxDuration={86400}
        onConfirm={(selection) => addAsset(selection.asset, playhead, undefined, false, selection)}
      />
      <SourceRelinkDialog
        opened={!!relinkPaths}
        onClose={() => setRelinkPaths(null)}
        workspaceId={context.workspaceId}
        sources={relinkSources}
        assets={assets}
        readonly={context.readonly}
        onConfirm={async (replacement) => {
          const metadata = sourceMetadata(
            await apiFetch<unknown>(
              sourceMetadataPath(context.workspaceId, replacement.replacement)
            ),
            replacement.replacement.kind
          )
          if (
            !liveEditor.current ||
            editPolicy.current.readonly ||
            editPolicy.current.key !== key ||
            initial.loadError
          )
            throw new Error('当前制作文件不可写')
          const current = docRef.current
          const latestClips = current.tracks
            .flatMap((track) => track.clips)
            .filter((clip) => clip.path === replacement.source.path)
          if (!latestClips.length) throw new Error('原素材已不在时间线中')
          const latestSource = projectRelinkSources(current, 'audio').find(
            (item) => item.path === replacement.source.path
          )
          if (!latestSource) throw new Error('原素材已不在时间线中')
          const failure = sourceRelinkError(latestSource, replacement.replacement, metadata)
          if (failure) throw new Error(failure)
          if (
            current.tracks.some(
              (track) =>
                track.locked && track.clips.some((clip) => clip.path === replacement.source.path)
            )
          )
            throw new Error('请先解锁使用此素材的音轨')
          playback.stop()
          invalidateAudioWaveforms(replacement.source.path)
          invalidateAudioWaveforms(replacement.replacement.path)
          setWaveforms({})
          setSourceErrors({})
          change({
            ...current,
            tracks: current.tracks.map((track) => ({
              ...track,
              clips: track.clips.map((clip) => applySourceRelink(clip, replacement))
            }))
          })
          setSourceRetry((value) => value + 1)
        }}
      />
      <ProjectSourcesDialog
        opened={projectSourcesOpen}
        onClose={() => setProjectSourcesOpen(false)}
        workspaceId={context.workspaceId}
        draftId={context.draft.id}
        kind="audio"
        onChooseSource={(path) => {
          setProjectSourcesOpen(false)
          setRelinkPaths([path])
        }}
        sources={projectRelinkSources(doc, 'audio')}
        lockedPaths={projectLockedSourcePaths(doc, 'audio')}
        readonly={context.readonly || !!initial.loadError}
        onConfirm={(selections) => {
          if (!liveEditor.current || editPolicy.current.key !== key || initial.loadError)
            throw new Error('当前制作文件不可写')
          playback.stop()
          const next = applyProjectSourceRelinks(
            docRef.current,
            'audio',
            selections,
            editPolicy.current.readonly
          )
          for (const selection of selections) {
            invalidateAudioWaveforms(selection.source.path)
            invalidateAudioWaveforms(selection.replacement.path)
          }
          setWaveforms({})
          setSourceErrors({})
          setSourceRetry((value) => value + 1)
          change(next)
        }}
      />
      <MediaPreview
        files={previewFiles}
        index={previewPath ? previewFiles.findIndex((file) => file.fullpath === previewPath) : null}
        onClose={() => setPreviewPath('')}
        onIndexChange={(index) => setPreviewPath(previewFiles[index]?.fullpath || '')}
        readonly={context.readonly}
      />
    </div>
  )
}
