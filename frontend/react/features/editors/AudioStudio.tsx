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
  IconPlayerSkipBack,
  IconMaximize,
  IconFlag,
  IconMusicPlus,
  IconCopy,
  IconClipboard,
  IconLink,
  IconUnlink,
  IconArrowUp,
  IconArrowDown,
  IconPlayerPause,
  IconPlayerPlay,
  IconScissors,
  IconUpload,
  IconTrash,
  IconTypography,
  IconAdjustments,
  IconPlayerTrackNext,
  IconPlayerTrackPrev
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
  timelineDuration,
  trimClip,
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
import AudioClipEnvelope from './AudioClipEnvelope'
import AudioLoudnessAnalysis from './AudioLoudnessAnalysis'
import AudioPropertyControls from './AudioPropertyControls'
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
import {
  clampTimelineRange,
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
const clock = (value: number) =>
  `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${(value % 60).toFixed(1).padStart(4, '0')}`
const json = (body: unknown) => JSON.stringify(body)
type Waveform = { duration: number }
const soundSourceKey = (clip: Pick<AudioClip, 'path' | 'audioStream'>) =>
  JSON.stringify([clip.path, clip.audioStream ?? 0])

type Selection = { kind: 'clip' | 'cue' | 'track' | 'marker'; id: string } | null
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
  helpAction
}: {
  context: EditorContext
  onBeforeLeave?: RegisterEditorBeforeLeave
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
  const [trackHeight, setTrackHeight] = useState(76)
  const [waveAmplitude, setWaveAmplitude] = useState(1)
  const [waveStereo, setWaveStereo] = useState(false)
  const [editGain, setEditGain] = useState(false)
  const [followPlayhead, setFollowPlayhead] = useState(true)
  const [viewport, setViewport] = useState({ left: 0, width: 1000 })
  const [selectionBox, setSelectionBox] = useState<{
    left: number
    top: number
    width: number
    height: number
  } | null>(null)
  const boxDragRef = useRef<{ x: number; y: number; ids: string[]; moved: boolean } | null>(null)
  function setSelection(next: Selection) {
    setPrimarySelection(next)
    if (!next || !['clip', 'cue'].includes(next.kind)) setSelectedItems([])
  }
  const [contextMenu, setContextMenu] = useState<AudioContextMenu | null>(null)
  const [past, setPast] = useState<AudioTimelineDocument[]>([])
  const [future, setFuture] = useState<AudioTimelineDocument[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [playhead, setPlayhead] = useState(0)
  const [zoom, setZoom] = useState(22)
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
  const [materialClickMode, setMaterialClickMode] = useState<'view' | 'add'>('view')
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
  const textFileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<
    | (DragSnapshot & {
        id: string
        x: number
        original: AudioClip
        mode: 'move' | 'left' | 'right'
        ids: string[]
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
      })
    | undefined
  >(undefined)
  const rulerDragRef = useRef<{
    start: number
    x: number
    edge?: 'start' | 'end'
    original?: { start: number; end: number }
  } | null>(null)
  const markerDragRef = useRef<(DragSnapshot & { id: string; x: number; time: number }) | null>(
    null
  )
  const dragHistoryRecordedRef = useRef(false)
  const envelopeDragRef = useRef<DragSnapshot | null>(null)
  const previousDuration = useRef(timelineDuration(doc))
  const duration = Math.max(30, Math.ceil(timelineDuration(doc) + 5))
  const laneWidth = Math.max(900, duration * zoom)
  const selectedIds = expandAudioSelection(
    doc,
    selectedItems.length && selection && selectedItems.includes(selection.id)
      ? selectedItems
      : selection && ['clip', 'cue'].includes(selection.kind)
        ? [selection.id]
        : []
  )
  const rulerTicks = videoRulerTicks(duration, zoom, Math.max(0, viewport.left), viewport.width)
  const selectedTrack = doc.tracks.find((track) => track.id === selection?.id)
  const selectedTextTrack = (doc.textTracks ?? []).find((track) => track.id === selection?.id)
  const selectedClip = doc.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selection?.id)
  const selectedClipTrack = doc.tracks.find((track) =>
    track.clips.some((clip) => clip.id === selectedClip?.id)
  )
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
  const previewFiles = assets.map((asset) => editorPreviewFile(asset, assetInfo[asset.path]))
  useEffect(() => {
    if (!playing || !followPlayhead) return
    const element = timelineScrollRef.current
    if (!element) return
    const available = Math.max(1, element.clientWidth - 142),
      position = playhead * zoom
    if (position < element.scrollLeft || position > element.scrollLeft + available - 32)
      element.scrollLeft = Math.max(0, position - available * 0.2)
  }, [playhead, playing, followPlayhead, zoom])
  useEffect(() => {
    const element = timelineScrollRef.current
    if (!element) return
    const measure = () => setViewport({ left: element.scrollLeft, width: element.clientWidth })
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
        const width = Math.max(1, element.clientWidth - 142)
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
  function seek(value: number) {
    playback.stop()
    setPlayhead(Math.max(0, Math.min(86400, value)))
  }
  function fitTimeline(selected = false) {
    const entries = selected
      ? audioEntries(doc).filter((entry) => selectedIds.includes(entry.item.id))
      : []
    const start = entries.length ? Math.min(...entries.map((entry) => entry.item.start)) : 0
    const end = entries.length
      ? Math.max(...entries.map((entry) => entry.item.start + entry.item.duration))
      : timelineDuration(doc)
    const width = Math.max(1, (timelineScrollRef.current?.clientWidth ?? 800) - 142)
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
    clipboard.current = copyAudioSelection(doc, selectedIds)
    setClipboardReady(!!clipboard.current)
    if (cut && !context.readonly) {
      change(removeAudioSelection(doc, selectedIds))
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
    if (context.readonly || selectedIds.length < 2) return
    try {
      change(groupAudioSelection(doc, selectedIds, unlink))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '关联失败')
    }
  }
  function beginBox(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    const root = timelineScrollRef.current
    if (!root) return
    const bounds = root.getBoundingClientRect()
    const x = event.clientX - bounds.left + root.scrollLeft
    const y = event.clientY - bounds.top + root.scrollTop
    boxDragRef.current = { x, y, ids: event.shiftKey ? selectedIds : [], moved: false }
    root.setPointerCapture(event.pointerId)
    event.preventDefault()
    if (!event.shiftKey) {
      setSelectedItems([])
      setPrimarySelection(null)
    }
  }
  function moveBox(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = boxDragRef.current
    if (!drag) return
    const root = event.currentTarget
    const bounds = root.getBoundingClientRect()
    if (event.clientX > bounds.right - 24) root.scrollLeft += 18
    if (event.clientX < bounds.left + 166) root.scrollLeft -= 18
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
    setSelectedItems(selected)
    const first = audioEntries(doc).find((entry) => entry.item.id === selected[0])
    setPrimarySelection(first ? { kind: first.kind, id: first.item.id } : null)
  }
  function endBox(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = boxDragRef.current
    if (drag && !drag.moved) seek(Math.max(0, (drag.x - 142) / zoom))
    boxDragRef.current = null
    setSelectionBox(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  function changeRange(next: { start: number; end: number } | null) {
    playback.stop()
    setRange(next && next.end > next.start ? next : null)
    if (!next) setLoop(false)
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
      if (
        !dragRef.current &&
        !cueDragRef.current &&
        !markerDragRef.current &&
        !envelopeDragRef.current
      )
        void flushChanges()
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
  const waveformPaths = JSON.stringify([
    ...new Set(doc.tracks.flatMap((track) => track.clips.map(soundSourceKey)))
  ])
  const waveformSources: string[] = JSON.parse(waveformPaths)
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
    if (context.readonly || initial.loadError || JSON.stringify(next) === JSON.stringify(doc))
      return
    if (
      !dragRef.current &&
      !cueDragRef.current &&
      !markerDragRef.current &&
      !envelopeDragRef.current
    ) {
      setPast((items) => [...items.slice(-79), doc])
      setFuture([])
    } else if (!dragHistoryRecordedRef.current) {
      setPast((items) => [...items.slice(-79), doc])
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
    if (context.readonly || initial.loadError) return
    const source = redo ? future : past
    const previous = source.at(-1)
    if (!previous) return
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
    const owner = doc.tracks.find((track) => track.clips.some((clip) => clip.id === id))
    const original = owner?.clips.find((clip) => clip.id === id)
    if (context.readonly || !original || owner?.locked) return
    const updated = transform(original)
    const positionOnly = updated.start !== original.start && updated.duration === original.duration
    const next = positionOnly ? moveAudioSelection(doc, [id], updated.start - original.start) : doc
    if (positionOnly && next === doc) {
      setError('关联片段的轨道已锁定')
      return
    }
    change({
      ...next,
      tracks: next.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) =>
          clip.id === id ? { ...updated, ...(positionOnly ? { start: clip.start } : {}) } : clip
        )
      }))
    })
  }
  function updateCue(id: string, changeSet: Partial<TextCue>) {
    if (
      context.readonly ||
      doc.textTracks?.some((track) => track.locked && track.cues.some((cue) => cue.id === id))
    )
      return
    const original = doc.textTracks?.flatMap((track) => track.cues).find((cue) => cue.id === id)
    if (
      original &&
      changeSet.start !== undefined &&
      changeSet.duration === undefined &&
      changeSet.start !== original.start
    ) {
      const next = moveAudioSelection(doc, [id], changeSet.start - original.start)
      if (next === doc) setError('关联片段的轨道已锁定')
      else change(next)
      return
    }
    change({
      ...doc,
      textTracks: (doc.textTracks ?? []).map((track) => ({
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
      }))
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
    if (dragRef.current || cueDragRef.current || markerDragRef.current || envelopeDragRef.current)
      return false
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
    setSelection(
      id ? { kind: target === 'clip' ? 'clip' : target === 'text-cue' ? 'cue' : 'track', id } : null
    )
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
  function addMarker() {
    if (context.readonly || (doc.markers?.length ?? 0) >= audioLimits.markers) return
    const marker = {
      id: crypto.randomUUID(),
      name: `标记 ${(doc.markers?.length ?? 0) + 1}`,
      time: playhead
    }
    change({ ...doc, markers: [...(doc.markers ?? []), marker] })
    setSelection({ kind: 'marker', id: marker.id })
  }
  function duplicateSelected() {
    if (context.readonly) return
    if (
      selectedClip &&
      selectedClipTrack &&
      !selectedClipTrack.locked &&
      selectedClipTrack.clips.length < 256
    ) {
      const start = selectedClip.start + selectedClip.duration
      if (start + selectedClip.duration > 86400) return
      const copy = { ...selectedClip, id: crypto.randomUUID(), start }
      change({
        ...doc,
        tracks: doc.tracks.map((track) =>
          track.id === selectedClipTrack.id ? { ...track, clips: [...track.clips, copy] } : track
        )
      })
      setSelection({ kind: 'clip', id: copy.id })
    } else if (
      selectedCue &&
      selectedCueTrack &&
      !selectedCueTrack.locked &&
      selectedCueTrack.cues.length < textLimits.cues
    ) {
      const start = selectedCue.start + selectedCue.duration
      if (start + selectedCue.duration > 86400) return
      const copy = { ...selectedCue, id: crypto.randomUUID(), start }
      change({
        ...doc,
        textTracks: (doc.textTracks ?? []).map((track) =>
          track.id === selectedCueTrack.id ? { ...track, cues: [...track.cues, copy] } : track
        )
      })
      setSelection({ kind: 'cue', id: copy.id })
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
  function jumpPoint(direction: number) {
    const points = [
      0,
      timelineDuration(doc),
      ...(doc.markers ?? []).map((marker) => marker.time),
      ...audioEntries(doc).flatMap(({ item }) => [item.start, item.start + item.duration])
    ].sort((a, b) => a - b)
    seek(
      direction > 0
        ? (points.find((time) => time > playhead + 1 / 48000) ?? timelineDuration(doc))
        : ([...points].reverse().find((time) => time < playhead - 1 / 48000) ?? 0)
    )
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
        <aside className="audio-tool-rail" aria-label="音频编辑工具">
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
          <Tooltip label="添加文字轨" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="添加文字轨"
              disabled={context.readonly || (doc.textTracks?.length ?? 0) >= textLimits.tracks}
              onClick={addTextTrack}
            >
              <IconTypography size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="导入歌词或字幕" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="导入歌词或字幕"
              disabled={context.readonly || (doc.textTracks?.length ?? 0) >= textLimits.tracks}
              onClick={() => textFileInputRef.current?.click()}
            >
              <IconUpload size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="分割片段 (S)" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="分割片段"
              disabled={!selectedIds.length || context.readonly}
              onClick={splitSelected}
            >
              <IconScissors size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="添加标记 (M)" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="添加标记"
              disabled={context.readonly || (doc.markers?.length ?? 0) >= audioLimits.markers}
              onClick={addMarker}
            >
              <IconFlag size={19} />
            </ActionIcon>
          </Tooltip>
          <Divider my={4} />
          <Tooltip label="适应时间线" position="right">
            <ActionIcon variant="subtle" aria-label="适应时间线" onClick={() => fitTimeline()}>
              <IconMaximize size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="适应选中片段" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="适应选中片段"
              disabled={!selectedIds.length}
              onClick={() => fitTimeline(true)}
            >
              <IconMaximize size={15} />
            </ActionIcon>
          </Tooltip>
          <input
            ref={textFileInputRef}
            type="file"
            accept=".lrc,.srt,.vtt,.txt"
            hidden
            aria-label="导入文字文件"
            onChange={(event) => {
              void importText(event.currentTarget.files?.[0] ?? null)
              event.currentTarget.value = ''
            }}
          />
        </aside>
        <div
          className="react-audio-workarea"
          style={
            {
              '--audio-track-height': `${trackHeight}px`,
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
            <Group gap={6} wrap="nowrap">
              <Select
                size="xs"
                w={84}
                aria-label="音轨高度"
                value={String(trackHeight)}
                data={[
                  { value: '54', label: '紧凑' },
                  { value: '76', label: '标准' },
                  { value: '110', label: '展开' }
                ]}
                onChange={(value) => setTrackHeight(Number(value) || 76)}
              />
              <Button
                size="compact-xs"
                variant={textPreview ? 'light' : 'subtle'}
                onClick={() => setTextPreview((value) => !value)}
              >
                文字预览
              </Button>
              <Button
                size="compact-xs"
                variant={snapping ? 'light' : 'default'}
                aria-pressed={snapping}
                onClick={() => setSnapping((value) => !value)}
              >
                吸附{snapping ? '开启' : '关闭'}
              </Button>
            </Group>
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
          <div className="audio-selection-tools" role="toolbar" aria-label="片段选择操作">
            <Tooltip label="复制 (Ctrl/Cmd+C)">
              <ActionIcon
                aria-label="复制所选片段"
                variant="subtle"
                disabled={!selectedIds.length}
                onClick={() => copySelection()}
              >
                <IconCopy size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="粘贴 (Ctrl/Cmd+V)">
              <ActionIcon
                aria-label="粘贴片段"
                variant="subtle"
                disabled={!clipboardReady || context.readonly}
                onClick={pasteSelection}
              >
                <IconClipboard size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="关联移动 (Ctrl/Cmd+G)">
              <ActionIcon
                aria-label="关联所选片段"
                variant="subtle"
                disabled={selectedIds.length < 2 || context.readonly}
                onClick={() => groupSelection()}
              >
                <IconLink size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="解除关联 (Ctrl/Cmd+Shift+G)">
              <ActionIcon
                aria-label="解除片段关联"
                variant="subtle"
                disabled={selectedIds.length < 2 || context.readonly}
                onClick={() => groupSelection(true)}
              >
                <IconUnlink size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="删除并闭合空隙 (Shift+Delete)">
              <ActionIcon
                aria-label="删除并闭合空隙"
                variant="subtle"
                disabled={!selectedIds.length || context.readonly}
                onClick={() => deleteSelection(true)}
              >
                <IconTrash size={15} />
              </ActionIcon>
            </Tooltip>
            <Text size="xs" c="dimmed">
              {selectedIds.length ? `已选 ${selectedIds.length} 项` : '拖动空白框选 · Shift 多选'}
            </Text>
          </div>
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
                  onClick={() => setRelinkPaths(unavailablePaths)}
                >
                  重新指定素材
                </Button>
              </Group>
            </Alert>
          )}
          <div
            className="react-audio-timeline"
            ref={timelineScrollRef}
            onScroll={(event) =>
              setViewport({
                left: event.currentTarget.scrollLeft,
                width: event.currentTarget.clientWidth
              })
            }
            onPointerDown={beginBox}
            onPointerMove={moveBox}
            onPointerUp={endBox}
            onPointerCancel={() => {
              boxDragRef.current = null
              setSelectionBox(null)
            }}
            onWheel={(event) => {
              if (!event.ctrlKey && !event.metaKey) return
              event.preventDefault()
              setZoom((value) =>
                Math.max(0.03125, Math.min(1000, value * (event.deltaY < 0 ? 1.15 : 0.87)))
              )
            }}
          >
            <div className="react-audio-label">
              <Text size="xs" fw={700}>
                时间
              </Text>
            </div>
            <div
              className="react-audio-lane react-audio-ruler"
              style={{ width: laneWidth }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.stopPropagation()
                const raw = Math.max(
                  0,
                  (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom
                )
                const time =
                  snapping && !event.shiftKey
                    ? snapTime(raw, timelineSnapPoints(doc, playhead), 6 / zoom).time
                    : raw
                const edge = (event.target as HTMLElement).dataset.rangeEdge as
                  'start' | 'end' | undefined
                rulerDragRef.current = {
                  start: time,
                  x: event.clientX,
                  edge,
                  original: range ?? undefined
                }
                if (!edge) seek(time)
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const drag = rulerDragRef.current
                if (!drag) return
                const root = timelineScrollRef.current
                if (root) {
                  const rect = root.getBoundingClientRect()
                  if (event.clientX > rect.right - 22) root.scrollLeft += 18
                  if (event.clientX < rect.left + 164) root.scrollLeft -= 18
                }
                const raw = Math.max(
                  0,
                  (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom
                )
                const time =
                  snapping && !event.shiftKey
                    ? snapTime(raw, timelineSnapPoints(doc, playhead), 6 / zoom).time
                    : raw
                if (drag.edge && drag.original)
                  changeRange(
                    clampTimelineRange(
                      drag.edge === 'start' ? time : drag.original.start,
                      drag.edge === 'end' ? time : drag.original.end,
                      86400
                    )
                  )
                else if (Math.abs(event.clientX - drag.x) > 4)
                  changeRange(clampTimelineRange(drag.start, time, 86400))
              }}
              onPointerUp={(event) => {
                rulerDragRef.current = null
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={() => {
                rulerDragRef.current = null
              }}
            >
              {rulerTicks.map((time) => (
                <span key={time} style={{ left: time * zoom }}>
                  {clock(time)}
                </span>
              ))}
              <i style={{ left: playhead * zoom, height: 46 }} />
              {range && (
                <div
                  className="audio-range-selection"
                  style={{ left: range.start * zoom, width: (range.end - range.start) * zoom }}
                  aria-label={`选区 ${clock(range.start)} 至 ${clock(range.end)}`}
                >
                  <button type="button" aria-label="拖动入点" data-range-edge="start" />
                  <button type="button" aria-label="拖动出点" data-range-edge="end" />
                </div>
              )}
            </div>
            <div className="react-audio-label">
              <Text size="xs" fw={700}>
                标记
              </Text>
            </div>
            <div className="react-audio-lane" style={{ width: laneWidth }}>
              {(doc.markers ?? []).map((marker) => (
                <button
                  key={marker.id}
                  className="react-audio-marker"
                  style={{ left: marker.time * zoom }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || context.readonly) return
                    event.preventDefault()
                    event.stopPropagation()
                    dragHistoryRecordedRef.current = false
                    markerDragRef.current = {
                      id: marker.id,
                      x: event.clientX,
                      time: marker.time,
                      before: doc,
                      past,
                      future
                    }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={(event) => {
                    const drag = markerDragRef.current
                    if (!drag || drag.id !== marker.id) return
                    const raw = Math.max(
                      0,
                      Math.min(86400, drag.time + (event.clientX - drag.x) / zoom)
                    )
                    const time =
                      snapping && !event.shiftKey
                        ? snapTime(raw, timelineSnapPoints(doc, playhead, marker.id), 8 / zoom).time
                        : raw
                    change({
                      ...doc,
                      markers: (doc.markers ?? []).map((item) =>
                        item.id === marker.id
                          ? { ...item, time: Math.round(time * 1000) / 1000 }
                          : item
                      )
                    })
                  }}
                  onPointerUp={() => {
                    markerDragRef.current = null
                    dragHistoryRecordedRef.current = false
                    setSelection({ kind: 'marker', id: marker.id })
                    window.setTimeout(() => void flushChanges(), 100)
                  }}
                  onPointerCancel={() => {
                    const drag = markerDragRef.current
                    markerDragRef.current = null
                    if (drag) rollbackDrag(drag)
                    dragHistoryRecordedRef.current = false
                    window.setTimeout(() => void flushChanges(), 100)
                  }}
                  onClick={() => {
                    setSelection({ kind: 'marker', id: marker.id })
                    setPlayhead(marker.time)
                  }}
                  title={marker.name}
                >
                  ◆
                </button>
              ))}
            </div>
            {doc.tracks.map((track) => (
              <div className="react-audio-row react-audio-sound-row" key={track.id}>
                <div
                  className="react-audio-label"
                  onClick={() => setSelection({ kind: 'track', id: track.id })}
                  onContextMenu={(event) => showContextMenu(event, 'track', track.id)}
                >
                  <Text size="xs" fw={700} truncate>
                    {track.name}
                  </Text>
                  <div className="audio-track-actions">
                    <button
                      type="button"
                      aria-label={`${track.name} ${track.muted ? '取消静音' : '静音'}`}
                      aria-pressed={track.muted}
                      disabled={context.readonly || track.locked}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateTrack(track.id, { muted: !track.muted })
                      }}
                    >
                      M
                    </button>
                    <button
                      type="button"
                      aria-label={`${track.name} ${track.solo ? '取消独奏' : '独奏'}`}
                      aria-pressed={track.solo}
                      disabled={context.readonly || track.locked}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateTrack(track.id, { solo: !track.solo })
                      }}
                    >
                      S
                    </button>
                    <button
                      type="button"
                      aria-label={`${track.name} ${track.locked ? '解锁' : '锁定'}`}
                      aria-pressed={track.locked}
                      disabled={context.readonly}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateTrack(track.id, { locked: !track.locked })
                      }}
                    >
                      {track.locked ? '◆' : '◇'}
                    </button>
                    <button
                      type="button"
                      aria-label={`上移${track.name}`}
                      disabled={context.readonly}
                      onClick={(event) => {
                        event.stopPropagation()
                        moveTrack(track.id, -1)
                      }}
                    >
                      <IconArrowUp size={11} />
                    </button>
                    <button
                      type="button"
                      aria-label={`下移${track.name}`}
                      disabled={context.readonly}
                      onClick={(event) => {
                        event.stopPropagation()
                        moveTrack(track.id, 1)
                      }}
                    >
                      <IconArrowDown size={11} />
                    </button>
                    <small>{Math.round(track.gain * 100)}%</small>
                  </div>
                </div>
                <div
                  className="react-audio-lane"
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
                    <button
                      type="button"
                      key={clip.id}
                      className="react-audio-clip"
                      data-selected={selectedIds.includes(clip.id)}
                      data-timeline-item={clip.id}
                      onContextMenu={(event) => showContextMenu(event, 'clip', clip.id)}
                      style={{ left: clip.start * zoom, width: clip.duration * zoom }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return
                        event.currentTarget.focus({ preventScroll: true })
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
                        const rect = event.currentTarget.getBoundingClientRect()
                        const offset = event.clientX - rect.left
                        dragRef.current = {
                          id: clip.id,
                          x: event.clientX,
                          original: clip,
                          ids,
                          before: doc,
                          past,
                          future,
                          mode:
                            offset < Math.min(8, rect.width / 4)
                              ? 'left'
                              : offset > rect.width - Math.min(8, rect.width / 4)
                                ? 'right'
                                : 'move'
                        }
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        const drag = dragRef.current
                        if (!drag || drag.id !== clip.id) return
                        const delta = (event.clientX - drag.x) / zoom
                        const points = timelineSnapPoints(
                          {
                            ...drag.before,
                            tracks: drag.before.tracks.map((track) => ({
                              ...track,
                              clips: track.clips.filter((item) => !drag.ids.includes(item.id))
                            })),
                            textTracks: drag.before.textTracks?.map((track) => ({
                              ...track,
                              cues: track.cues.filter((item) => !drag.ids.includes(item.id))
                            }))
                          },
                          playhead
                        )
                        if (drag.mode === 'move') {
                          const raw = Math.max(0, drag.original.start + delta)
                          const next =
                            snapping && !event.shiftKey
                              ? snapSpanStart(raw, drag.original.duration, points, 8 / zoom).time
                              : raw
                          change(
                            moveAudioSelection(drag.before, drag.ids, next - drag.original.start)
                          )
                        } else if (drag.mode === 'left') {
                          const raw = Math.max(
                            drag.original.start,
                            Math.min(
                              drag.original.start + drag.original.duration - 0.1,
                              drag.original.start + delta
                            )
                          )
                          const anchor =
                            snapping && !event.shiftKey ? snapTime(raw, points, 8 / zoom).time : raw
                          const from = Math.max(
                            0,
                            Math.min(drag.original.duration - 0.1, anchor - drag.original.start)
                          )
                          updateClip(clip.id, () =>
                            trimClip(drag.original, from, drag.original.duration)
                          )
                        } else {
                          const raw = Math.max(
                            drag.original.start + 0.1,
                            Math.min(
                              drag.original.start + drag.original.duration,
                              drag.original.start + drag.original.duration + delta
                            )
                          )
                          const anchor =
                            snapping && !event.shiftKey ? snapTime(raw, points, 8 / zoom).time : raw
                          const to = Math.max(
                            0.1,
                            Math.min(drag.original.duration, anchor - drag.original.start)
                          )
                          updateClip(clip.id, () => trimClip(drag.original, 0, to))
                        }
                      }}
                      onPointerUp={(event) => {
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
                      onPointerCancel={() => {
                        const drag = dragRef.current
                        dragRef.current = undefined
                        if (drag) rollbackDrag(drag)
                        dragHistoryRecordedRef.current = false
                        window.setTimeout(() => void flushChanges(), 100)
                      }}
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
                        width={Math.max(0, viewport.width - 142)}
                        retry={sourceRetry}
                        amplitude={waveAmplitude}
                        stereo={waveStereo}
                      />
                      {selectedIds.includes(clip.id) && (
                        <AudioClipEnvelope
                          clip={clip}
                          zoom={zoom}
                          left={viewport.left}
                          width={Math.max(0, viewport.width - 142)}
                          editGain={editGain}
                          readonly={context.readonly || track.locked}
                          onBegin={() => {
                            envelopeDragRef.current = { before: docRef.current, past, future }
                            dragHistoryRecordedRef.current = false
                          }}
                          onChange={(next) => updateClip(clip.id, () => next)}
                          onEnd={(cancel) => {
                            const snapshot = envelopeDragRef.current
                            envelopeDragRef.current = null
                            if (cancel && snapshot) rollbackDrag(snapshot)
                            dragHistoryRecordedRef.current = false
                            window.setTimeout(() => void flushChanges(), 100)
                          }}
                        />
                      )}
                      <span>{clip.name}</span>
                      <small>
                        {clock(clip.duration)} · {clip.rate ?? 1}×
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {(doc.textTracks ?? []).map((track) => (
              <div className="react-audio-row" key={track.id}>
                <div
                  className="react-audio-label"
                  onClick={() => setSelection({ kind: 'track', id: track.id })}
                  onContextMenu={(event) => showContextMenu(event, 'text-track', track.id)}
                >
                  <Text size="xs" fw={700} truncate>
                    {track.name}
                  </Text>
                  <div className="audio-track-actions">
                    <button
                      type="button"
                      aria-label={`${track.name} ${track.visible ? '隐藏' : '显示'}`}
                      aria-pressed={track.visible}
                      disabled={context.readonly}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateTextTrack(track.id, { visible: !track.visible })
                      }}
                    >
                      {track.visible ? '◉' : '○'}
                    </button>
                    <button
                      type="button"
                      aria-label={`${track.name} ${track.locked ? '解锁' : '锁定'}`}
                      aria-pressed={track.locked}
                      disabled={context.readonly}
                      onClick={(event) => {
                        event.stopPropagation()
                        updateTextTrack(track.id, { locked: !track.locked })
                      }}
                    >
                      {track.locked ? '◆' : '◇'}
                    </button>
                    <button
                      type="button"
                      aria-label={`在${track.name}添加文字`}
                      disabled={
                        context.readonly || track.locked || track.cues.length >= textLimits.cues
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelection({ kind: 'track', id: track.id })
                        const cue = createTextCue('请输入文字', playhead, 3)
                        change({
                          ...doc,
                          textTracks: (doc.textTracks ?? []).map((item) =>
                            item.id === track.id ? { ...item, cues: [...item.cues, cue] } : item
                          )
                        })
                        setSelection({ kind: 'cue', id: cue.id })
                      }}
                    >
                      ＋
                    </button>
                    <button
                      type="button"
                      aria-label={`上移${track.name}`}
                      disabled={context.readonly}
                      onClick={(event) => {
                        event.stopPropagation()
                        moveTrack(track.id, -1, true)
                      }}
                    >
                      <IconArrowUp size={11} />
                    </button>
                    <button
                      type="button"
                      aria-label={`下移${track.name}`}
                      disabled={context.readonly}
                      onClick={(event) => {
                        event.stopPropagation()
                        moveTrack(track.id, 1, true)
                      }}
                    >
                      <IconArrowDown size={11} />
                    </button>
                    <small>{track.cues.length} 段</small>
                  </div>
                </div>
                <div
                  className="react-audio-lane"
                  style={{ width: laneWidth }}
                  data-text-track-id={track.id}
                  onPointerDown={beginBox}
                  onContextMenu={(event) => showContextMenu(event, 'text-track', track.id)}
                >
                  {track.cues.map((cue) => (
                    <div
                      key={cue.id}
                      className="react-audio-cue"
                      role="button"
                      tabIndex={0}
                      aria-label={`文字：${cue.text || '请输入文字'}，${clock(cue.start)} 至 ${clock(cue.start + cue.duration)}`}
                      onContextMenu={(event) => showContextMenu(event, 'text-cue', cue.id)}
                      data-selected={selectedIds.includes(cue.id)}
                      data-timeline-item={cue.id}
                      style={{ left: cue.start * zoom, width: cue.duration * zoom }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return
                        if (editingCueId !== cue.id)
                          event.currentTarget.focus({ preventScroll: true })
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
                        const rect = event.currentTarget.getBoundingClientRect()
                        const offset = event.clientX - rect.left
                        cueDragRef.current = {
                          id: cue.id,
                          x: event.clientX,
                          start: cue.start,
                          duration: cue.duration,
                          ids,
                          before: doc,
                          past,
                          future,
                          mode:
                            offset < Math.min(8, rect.width / 4)
                              ? 'left'
                              : offset > rect.width - Math.min(8, rect.width / 4)
                                ? 'right'
                                : 'move'
                        }
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        const drag = cueDragRef.current
                        if (!drag || drag.id !== cue.id) return
                        const delta = (event.clientX - drag.x) / zoom
                        const points = timelineSnapPoints(
                          {
                            ...drag.before,
                            tracks: drag.before.tracks.map((track) => ({
                              ...track,
                              clips: track.clips.filter((item) => !drag.ids.includes(item.id))
                            })),
                            textTracks: drag.before.textTracks?.map((track) => ({
                              ...track,
                              cues: track.cues.filter((item) => !drag.ids.includes(item.id))
                            }))
                          },
                          playhead
                        )
                        if (drag.mode === 'move') {
                          const raw = Math.max(
                            0,
                            Math.min(86400 - drag.duration, drag.start + delta)
                          )
                          const next =
                            snapping && !event.shiftKey
                              ? snapSpanStart(raw, drag.duration, points, 8 / zoom).time
                              : raw
                          change(moveAudioSelection(drag.before, drag.ids, next - drag.start))
                        } else if (drag.mode === 'left') {
                          const raw = Math.max(
                            0,
                            Math.min(drag.start + drag.duration - 0.001, drag.start + delta)
                          )
                          const next =
                            snapping && !event.shiftKey ? snapTime(raw, points, 8 / zoom).time : raw
                          const start = Math.max(
                            0,
                            Math.min(drag.start + drag.duration - 0.001, next)
                          )
                          updateCue(cue.id, {
                            start: Math.round(start * 1000) / 1000,
                            duration: Math.round((drag.start + drag.duration - start) * 1000) / 1000
                          })
                        } else {
                          const raw = Math.max(
                            drag.start + 0.001,
                            Math.min(86400, drag.start + drag.duration + delta)
                          )
                          const next =
                            snapping && !event.shiftKey ? snapTime(raw, points, 8 / zoom).time : raw
                          updateCue(cue.id, {
                            duration:
                              Math.round(
                                (Math.max(drag.start + 0.001, Math.min(86400, next)) - drag.start) *
                                  1000
                              ) / 1000
                          })
                        }
                      }}
                      onPointerUp={(event) => {
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
                      onPointerCancel={() => {
                        const drag = cueDragRef.current
                        cueDragRef.current = undefined
                        if (drag) rollbackDrag(drag)
                        dragHistoryRecordedRef.current = false
                        window.setTimeout(() => void flushChanges(), 100)
                      }}
                      onClick={(event) => {
                        if (!event.shiftKey && !event.ctrlKey && !event.metaKey)
                          setSelection({ kind: 'cue', id: cue.id })
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation()
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
                        cue.text || '请输入文字'
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {selectionBox && <div className="audio-marquee" style={selectionBox} />}
          </div>
          <AudioMixPreparation
            job={playback.preparation}
            onCancel={() => {
              void playback.cancelPreparation()
            }}
          />
          <div className="react-audio-controls">
            <Group gap="xs" wrap="nowrap">
              <ActionIcon variant="subtle" aria-label="回到起点" onClick={() => seek(0)}>
                <IconPlayerSkipBack size={17} />
              </ActionIcon>
              <ActionIcon
                variant="light"
                aria-label={playing || playback.buffering ? '暂停试听' : '播放试听'}
                disabled={!timelineDuration(doc) || !!unavailablePaths.length}
                onClick={() => void play()}
              >
                {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
              </ActionIcon>
              {playback.buffering && (
                <Text size="xs" c="dimmed">
                  准备试听…
                </Text>
              )}
              <Text size="xs" ff="monospace" className="audio-transport-time">
                {clock(playhead)} / {clock(timelineDuration(doc))}
              </Text>
              <Tooltip label="上一剪辑点或标记">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label="上一剪辑点或标记"
                  onClick={() => jumpPoint(-1)}
                >
                  <IconPlayerTrackPrev size={15} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="下一剪辑点或标记">
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label="下一剪辑点或标记"
                  onClick={() => jumpPoint(1)}
                >
                  <IconPlayerTrackNext size={15} />
                </ActionIcon>
              </Tooltip>
            </Group>
            <Group gap="xs" wrap="nowrap" className="audio-transport-range">
              <Button
                size="compact-xs"
                variant={loop ? 'light' : 'default'}
                disabled={!range}
                aria-pressed={loop}
                onClick={() => {
                  playback.stop()
                  setLoop((value) => !value)
                }}
              >
                循环选区
              </Button>
              {range && (
                <>
                  <Text size="xs" ff="monospace">
                    {clock(range.start)} — {clock(range.end)}
                  </Text>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label="清除选区"
                    onClick={() => {
                      changeRange(null)
                    }}
                  >
                    ×
                  </ActionIcon>
                </>
              )}
            </Group>
            <Group gap={5} wrap="nowrap" className="audio-transport-zoom">
              <Menu position="top-end" closeOnItemClick={false}>
                <Menu.Target>
                  <ActionIcon variant="subtle" size="sm" aria-label="波形和试听设置">
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
                  <Menu.Item onClick={() => setEditGain((value) => !value)}>
                    {editGain ? '✓ ' : ''}直接编辑音量曲线
                  </Menu.Item>
                  <Menu.Item onClick={() => setFollowPlayhead((value) => !value)}>
                    {followPlayhead ? '✓ ' : ''}播放时跟随
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
                  <Menu.Item
                    disabled={!range}
                    onClick={() => {
                      if (range) audition(range)
                    }}
                  >
                    循环试听选区
                  </Menu.Item>
                  <Menu.Item
                    disabled={!selectedClip}
                    onClick={() => {
                      if (selectedClip)
                        audition(seamAuditionRange(selectedClip, 'start', timelineDuration(doc)))
                    }}
                  >
                    试听片头接缝
                  </Menu.Item>
                  <Menu.Item
                    disabled={!selectedClip}
                    onClick={() => {
                      if (selectedClip)
                        audition(seamAuditionRange(selectedClip, 'end', timelineDuration(doc)))
                    }}
                  >
                    试听片尾接缝
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label="缩小时间线"
                onClick={() => setZoom((value) => Math.max(0.03125, value / 1.4))}
              >
                −
              </ActionIcon>
              <Slider
                value={Math.log2(zoom)}
                min={-5}
                max={Math.log2(1000)}
                step={0.1}
                w={76}
                aria-label="时间线缩放"
                onChange={(value) => setZoom(2 ** value)}
              />
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label="放大时间线"
                onClick={() => setZoom((value) => Math.min(1000, value * 1.4))}
              >
                ＋
              </ActionIcon>
            </Group>
          </div>
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
              { value: 'mix', label: '混音' },
              { value: 'project', label: '工程' }
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
                        decimalScale={2}
                        value={selectedClip.fadeIn}
                        disabled={context.readonly || selectedClipTrack?.locked}
                        onChange={(v) =>
                          updateClip(selectedClip.id, (clip) =>
                            setClipFades(clip, numeric(v, clip.fadeIn), clip.fadeOut)
                          )
                        }
                      />
                      <NumberInput
                        size="xs"
                        label="淡出（秒）"
                        min={0}
                        max={selectedClip.duration}
                        step={0.1}
                        decimalScale={2}
                        value={selectedClip.fadeOut}
                        disabled={context.readonly || selectedClipTrack?.locked}
                        onChange={(v) =>
                          updateClip(selectedClip.id, (clip) =>
                            setClipFades(clip, clip.fadeIn, numeric(v, clip.fadeOut))
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
                    <Button
                      size="compact-xs"
                      variant={editGain ? 'light' : 'subtle'}
                      disabled={context.readonly || selectedClipTrack?.locked}
                      onClick={() => setEditGain((value) => !value)}
                    >
                      {editGain ? '完成音量曲线' : '编辑音量曲线'}
                    </Button>
                    <AudioGainControls
                      pan={selectedClip.pan}
                      gainPoints={selectedClip.gainPoints}
                      duration={selectedClip.envelopeDuration}
                      readonly={context.readonly || selectedClipTrack?.locked}
                      onPanChange={(pan) =>
                        updateClip(selectedClip.id, (clip) => ({ ...clip, pan }))
                      }
                      onGainPointsChange={(gainPoints) =>
                        updateClip(selectedClip.id, (clip) => ({ ...clip, gainPoints }))
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
                        <Group grow>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() =>
                              audition(
                                seamAuditionRange(selectedClip, 'start', timelineDuration(doc))
                              )
                            }
                          >
                            试听片头
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            onClick={() =>
                              audition(
                                seamAuditionRange(selectedClip, 'end', timelineDuration(doc))
                              )
                            }
                          >
                            试听片尾
                          </Button>
                        </Group>
                      </Stack>
                    </EditorDisclosure>
                    <Group>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconScissors size={14} />}
                        onClick={splitSelected}
                        disabled={context.readonly || selectedClipTrack?.locked}
                      >
                        在播放头分割
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={duplicateSelected}
                        disabled={
                          context.readonly ||
                          selectedClipTrack?.locked ||
                          (selectedClipTrack?.clips.length ?? 0) >= 256
                        }
                      >
                        复制
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        onClick={removeSelected}
                        disabled={context.readonly || selectedClipTrack?.locked}
                      >
                        删除
                      </Button>
                    </Group>
                  </>
                )}
                {selectedCue && (
                  <>
                    <Text size="xs" c="dimmed">
                      双击时间线文字片段可直接编辑。
                    </Text>
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
                    <Group grow>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconScissors size={14} />}
                        onClick={splitSelectedCue}
                        disabled={
                          context.readonly ||
                          selectedCueTrack?.locked ||
                          playhead <= selectedCue.start ||
                          playhead >= selectedCue.start + selectedCue.duration
                        }
                      >
                        在播放头分割
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        onClick={duplicateSelected}
                        disabled={
                          context.readonly ||
                          selectedCueTrack?.locked ||
                          (selectedCueTrack?.cues.length ?? 0) >= textLimits.cues
                        }
                      >
                        复制文字
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        leftSection={<IconTrash size={14} />}
                        onClick={removeSelected}
                        disabled={context.readonly || selectedCueTrack?.locked}
                      >
                        删除文字
                      </Button>
                    </Group>
                  </>
                )}
                {selectedMarker && (
                  <>
                    <TextInput
                      size="xs"
                      label="名称"
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
                      label="时间"
                      value={selectedMarker.time}
                      onChange={(v) =>
                        change({
                          ...doc,
                          markers: (doc.markers ?? []).map((marker) =>
                            marker.id === selectedMarker.id
                              ? { ...marker, time: numeric(v, marker.time) }
                              : marker
                          )
                        })
                      }
                      disabled={context.readonly}
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
                    <TextInput
                      size="xs"
                      label="音轨名称"
                      value={selectedTrack.name}
                      onChange={(event) =>
                        change({
                          ...doc,
                          tracks: doc.tracks.map((track) =>
                            track.id === selectedTrack.id
                              ? { ...track, name: event.currentTarget.value }
                              : track
                          )
                        })
                      }
                      disabled={context.readonly}
                    />
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
                    <Switch
                      size="xs"
                      label="静音"
                      checked={selectedTrack.muted}
                      onChange={(event) =>
                        change({
                          ...doc,
                          tracks: doc.tracks.map((track) =>
                            track.id === selectedTrack.id
                              ? { ...track, muted: event.currentTarget.checked }
                              : track
                          )
                        })
                      }
                      disabled={context.readonly || selectedTrack.locked}
                    />
                    <Switch
                      size="xs"
                      label="独奏"
                      checked={selectedTrack.solo}
                      disabled={context.readonly || selectedTrack.locked}
                      onChange={(event) =>
                        updateTrack(selectedTrack.id, { solo: event.currentTarget.checked })
                      }
                    />
                    <Switch
                      size="xs"
                      label="锁定音轨"
                      checked={selectedTrack.locked}
                      disabled={context.readonly}
                      onChange={(event) =>
                        updateTrack(selectedTrack.id, { locked: event.currentTarget.checked })
                      }
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
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      disabled={
                        context.readonly || selectedTrack.locked || !!selectedTrack.clips.length
                      }
                      onClick={removeSelected}
                    >
                      删除空音轨
                    </Button>
                  </>
                )}
                {activeTextTrack && (
                  <>
                    <TextInput
                      size="xs"
                      label="文字轨名称"
                      value={activeTextTrack.name}
                      onChange={(event) =>
                        change({
                          ...doc,
                          textTracks: (doc.textTracks ?? []).map((track) =>
                            track.id === activeTextTrack.id
                              ? { ...track, name: event.currentTarget.value }
                              : track
                          )
                        })
                      }
                      disabled={context.readonly}
                    />
                    <Switch
                      size="xs"
                      label="显示文字"
                      checked={activeTextTrack.visible}
                      onChange={(event) =>
                        change({
                          ...doc,
                          textTracks: (doc.textTracks ?? []).map((track) =>
                            track.id === activeTextTrack.id
                              ? { ...track, visible: event.currentTarget.checked }
                              : track
                          )
                        })
                      }
                      disabled={context.readonly}
                    />
                    <Switch
                      size="xs"
                      label="锁定文字轨"
                      checked={activeTextTrack.locked}
                      onChange={(event) =>
                        change({
                          ...doc,
                          textTracks: (doc.textTracks ?? []).map((track) =>
                            track.id === activeTextTrack.id
                              ? { ...track, locked: event.currentTarget.checked }
                              : track
                          )
                        })
                      }
                      disabled={context.readonly}
                    />
                    <Button
                      size="xs"
                      variant="light"
                      onClick={addCue}
                      disabled={context.readonly || activeTextTrack.locked}
                    >
                      添加文字
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      onClick={removeSelected}
                      disabled={
                        context.readonly ||
                        activeTextTrack.locked ||
                        !!activeTextTrack.cues.length ||
                        !selectedTextTrack
                      }
                    >
                      删除空文字轨
                    </Button>
                    <Select
                      size="xs"
                      label="下载文字轨格式"
                      value={textExportFormat}
                      data={[
                        { value: 'srt', label: 'SRT 字幕' },
                        { value: 'lrc', label: 'LRC 歌词' },
                        { value: 'vtt', label: 'WebVTT 字幕' }
                      ]}
                      onChange={(value) =>
                        setTextExportFormat(value === 'lrc' || value === 'vtt' ? value : 'srt')
                      }
                    />
                    <Select
                      size="xs"
                      label="文字导出范围"
                      value={textExportScope}
                      data={[
                        { value: 'all', label: '整条文字轨' },
                        { value: 'selection', label: '选区', disabled: !range }
                      ]}
                      onChange={(value) =>
                        setTextExportScope(value === 'selection' ? 'selection' : 'all')
                      }
                    />
                    <Text size="xs" c="dimmed">
                      文字单独下载，音频产物不包含歌词或字幕。
                    </Text>
                    <Button
                      size="xs"
                      variant="light"
                      disabled={
                        !activeTextTrack.cues.length || (textExportScope === 'selection' && !range)
                      }
                      onClick={exportText}
                    >
                      下载文字轨
                    </Button>
                  </>
                )}
                <AudioPropertyControls
                  workspaceId={context.workspaceId}
                  draftId={context.draft.id}
                  properties={
                    selectedClip
                      ? captureClipProperties(selectedClip)
                      : selectedTrack
                        ? captureTrackProperties(selectedTrack)
                        : captureMasterProperties(doc)
                  }
                  readonly={context.readonly || !!initial.loadError}
                  onApply={(properties) =>
                    change(
                      applyAudioProperties(
                        docRef.current,
                        properties,
                        properties.kind === 'clip'
                          ? selectedIds
                          : selectedTrack
                            ? [selectedTrack.id]
                            : []
                      )
                    )
                  }
                />
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
                <AudioLoudnessAnalysis
                  workspaceId={context.workspaceId}
                  draftId={context.draft.id}
                  soundRevision={mixPreviewSignature('audio', doc)}
                  readonly={context.readonly}
                  document={doc}
                  onSeek={seek}
                />
              </Stack>
              {inspectorView === 'project' && (
                <Stack gap="md">
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => {
                      playback.stop()
                      setProjectSourcesOpen(true)
                    }}
                  >
                    工程素材 · 检查与重新定位
                  </Button>
                  {!!doc.markers?.length && (
                    <section className="audio-marker-list" aria-label="时间线标记点">
                      <Text size="xs" fw={700} mb={6}>
                        标记点 · {doc.markers?.length}
                      </Text>
                      {[...(doc.markers ?? [])]
                        .sort((a, b) => a.time - b.time)
                        .map((marker) => (
                          <button
                            type="button"
                            key={marker.id}
                            aria-pressed={selection?.id === marker.id}
                            onClick={() => {
                              setSelection({ kind: 'marker', id: marker.id })
                              setPlayhead(marker.time)
                            }}
                          >
                            <span>{marker.name}</span>
                            <small>{clock(marker.time)}</small>
                          </button>
                        ))}
                    </section>
                  )}
                  <Text size="xs" c="dimmed">
                    {range
                      ? `当前选区 ${formatTimelineTime(range.end - range.start)}`
                      : `完整时间线 ${formatTimelineTime(timelineDuration(doc))}`}{' '}
                    · 导出前确认范围与名称
                  </Text>
                </Stack>
              )}
            </Stack>
          </div>
          <footer className="audio-inspector-footer">
            <Button
              fullWidth
              disabled={
                context.readonly ||
                !doc.tracks.some((track) => track.clips.length) ||
                !!unavailablePaths.length
              }
              loading={busy}
              onClick={openExport}
            >
              导出音频产物
            </Button>
          </footer>
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
          selectAction="add"
          clickMode={materialClickMode}
          onClickModeChange={(mode) => setMaterialClickMode(mode === 'view' ? 'view' : 'add')}
          onSelect={(asset) => void addAsset(asset)}
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
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextMenu.target === 'text-cue' && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={context.readonly || selectedCueTrack?.locked || !selectedCue}
                onClick={() => contextAction(splitSelectedCue)}
              >
                在播放头分割文字 <small>S</small>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={
                  context.readonly ||
                  selectedCueTrack?.locked ||
                  !selectedCue ||
                  (selectedCueTrack?.cues.length ?? 0) >= textLimits.cues
                }
                onClick={() => contextAction(duplicateSelected)}
              >
                复制文字片段
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={context.readonly || selectedCueTrack?.locked || !selectedCue}
                onClick={() => contextAction(removeSelected)}
              >
                删除文字片段
              </button>
            </>
          )}
          {contextMenu.target === 'text-track' && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={
                  context.readonly ||
                  selectedTextTrack?.locked ||
                  (selectedTextTrack?.cues.length ?? 0) >= textLimits.cues
                }
                onClick={() => contextAction(addCue)}
              >
                在播放头添加文字
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={context.readonly || !selectedTextTrack}
                onClick={() =>
                  contextAction(
                    () =>
                      selectedTextTrack &&
                      updateTextTrack(selectedTextTrack.id, { locked: !selectedTextTrack.locked })
                  )
                }
              >
                {selectedTextTrack?.locked ? '解锁文字轨' : '锁定文字轨'}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={
                  !selectedTextTrack?.cues.length || (textExportScope === 'selection' && !range)
                }
                onClick={() => contextAction(exportText)}
              >
                下载文字轨
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={
                  context.readonly ||
                  selectedTextTrack?.locked ||
                  !selectedTextTrack ||
                  !!selectedTextTrack.cues.length
                }
                onClick={() => contextAction(removeSelected)}
              >
                删除空文字轨
              </button>
            </>
          )}
          {contextMenu.target === 'clip' && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={context.readonly || selectedClipTrack?.locked || !selectedClip}
                onClick={() =>
                  contextAction(() => {
                    if (selectedClip) setRelinkPaths([selectedClip.path])
                  })
                }
              >
                重新指定素材
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={context.readonly || selectedClipTrack?.locked || !selectedClip}
                onClick={() => contextAction(splitSelected)}
              >
                在播放头处分割 <small>S</small>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={
                  context.readonly ||
                  selectedClipTrack?.locked ||
                  !selectedClip ||
                  (selectedClipTrack?.clips.length ?? 0) >= 256
                }
                onClick={() => contextAction(duplicateSelected)}
              >
                复制片段
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={context.readonly || selectedClipTrack?.locked || !selectedClip}
                onClick={() =>
                  contextAction(
                    () =>
                      selectedClip &&
                      updateClip(selectedClip.id, (clip) => setClipFades(clip, 1, clip.fadeOut))
                  )
                }
              >
                添加 1 秒淡入
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={context.readonly || selectedClipTrack?.locked || !selectedClip}
                onClick={() =>
                  contextAction(
                    () =>
                      selectedClip &&
                      updateClip(selectedClip.id, (clip) => setClipFades(clip, clip.fadeIn, 1))
                  )
                }
              >
                添加 1 秒淡出
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={context.readonly || selectedClipTrack?.locked || !selectedClip}
                onClick={() => contextAction(removeSelected)}
              >
                删除片段
              </button>
            </>
          )}
          {contextMenu.target === 'track' && (
            <>
              <button
                type="button"
                role="menuitem"
                disabled={context.readonly || selectedTrack?.locked || !selectedTrack}
                onClick={() =>
                  contextAction(
                    () =>
                      selectedTrack &&
                      updateTrack(selectedTrack.id, { muted: !selectedTrack.muted })
                  )
                }
              >
                {selectedTrack?.muted ? '取消静音' : '静音音轨'}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={context.readonly || selectedTrack?.locked || !selectedTrack}
                onClick={() =>
                  contextAction(
                    () =>
                      selectedTrack && updateTrack(selectedTrack.id, { solo: !selectedTrack.solo })
                  )
                }
              >
                {selectedTrack?.solo ? '取消独奏' : '独奏音轨'}
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={context.readonly || !selectedTrack}
                onClick={() =>
                  contextAction(
                    () =>
                      selectedTrack &&
                      updateTrack(selectedTrack.id, { locked: !selectedTrack.locked })
                  )
                }
              >
                {selectedTrack?.locked ? '解锁音轨' : '锁定音轨'}
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                disabled={
                  context.readonly ||
                  selectedTrack?.locked ||
                  !selectedTrack ||
                  !!selectedTrack.clips.length
                }
                onClick={() => contextAction(removeSelected)}
              >
                删除空音轨
              </button>
            </>
          )}
          {contextMenu.target === 'blank' && (
            <button
              type="button"
              role="menuitem"
              disabled={context.readonly}
              onClick={() => contextAction(() => setPickerOpen(true))}
            >
              加入音频或视频
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={context.readonly || doc.tracks.length >= 32}
            onClick={() => contextAction(addAudioTrack)}
          >
            新建音轨
          </button>
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
