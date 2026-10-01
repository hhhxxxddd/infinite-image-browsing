import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  NumberInput,
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
  IconDeviceFloppy,
  IconDownload,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconPlayerSkipBack,
  IconMaximize,
  IconFlag,
  IconMusicPlus,
  IconPlayerPause,
  IconPlayerPlay,
  IconScissors,
  IconUpload,
  IconTrash,
  IconTypography
} from '@tabler/icons-react'
import { apiFetch, apiRequest } from '../../shared/apiClient'
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
  readAudioTimeline,
  setClipRate,
  setClipFades,
  splitClip,
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
  splitTextCue,
  textLimits,
  type TextCue
} from '../../../src/features/media-editor/model/textTimeline'
import {
  snapSpanStart,
  snapTime,
  timelineSnapPoints
} from '../../../src/features/media-editor/model/audioSnap'
import {
  decodeLevels,
  levelDb,
  levelLabel,
  levelStep,
  type StereoLevel
} from '../../../src/features/media-editor/model/audioLevels'
import type { EditorContext, RegisterEditorBeforeLeave } from './EditorHub'
import { EditorSaveQueue } from './editorSaveQueue'
import { editorPreviewFile, importEditorMaterials } from './editorMediaImport'
import MaterialBar from './MaterialBar'
import './AudioStudio.css'

const numeric = (value: string | number, fallback: number) =>
  typeof value === 'number' ? value : Number(value) || fallback
const clock = (value: number) =>
  `${Math.floor(value / 60)
    .toString()
    .padStart(2, '0')}:${(value % 60).toFixed(1).padStart(4, '0')}`
const json = (body: unknown) => JSON.stringify(body)
type Waveform = { duration: number; peaks: number[] }

function ClipWaveform({ clip, waveform }: { clip: AudioClip; waveform?: Waveform }) {
  if (!waveform?.peaks.length || !waveform.duration) return null
  const bars = Array.from({ length: 70 }, (_, index) => {
    const start =
      (clip.sourceIn + (clip.duration * (clip.rate ?? 1) * index) / 70) / waveform.duration
    const end =
      (clip.sourceIn + (clip.duration * (clip.rate ?? 1) * (index + 1)) / 70) / waveform.duration
    const from = Math.max(0, Math.floor(start * waveform.peaks.length))
    const to = Math.min(
      waveform.peaks.length,
      Math.max(from + 1, Math.ceil(end * waveform.peaks.length))
    )
    return Math.max(0, ...waveform.peaks.slice(from, to))
  })
  return (
    <svg
      className="react-audio-waveform"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {bars.map((peak, index) => {
        const height = Math.max(1, Math.min(30, peak * 28))
        return (
          <rect
            key={index}
            x={(index * 100) / bars.length}
            y={(32 - height) / 2}
            width={Math.max(0.7, 100 / bars.length - 0.3)}
            height={height}
          />
        )
      })}
    </svg>
  )
}

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
  onBeforeLeave
}: {
  context: EditorContext
  onBeforeLeave?: RegisterEditorBeforeLeave
}) {
  const key = audioTimelineKey(context.workspaceId, context.draft.id)
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
      await mutateWorkspaceState(context.workspaceId, (storage) => {
        assertProductionDraftExists(storage, context.workspaceId, context.draft.id)
        storage.setItem(key, json(snapshot))
      })
    })
  }
  const [selection, setSelection] = useState<Selection>(null)
  const [contextMenu, setContextMenu] = useState<AudioContextMenu | null>(null)
  const [past, setPast] = useState<AudioTimelineDocument[]>([])
  const [future, setFuture] = useState<AudioTimelineDocument[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(22)
  const [snapping, setSnapping] = useState(true)
  const [range, setRange] = useState<{ start: number; end: number } | null>(null)
  const [loop, setLoop] = useState(false)
  const [exportScope, setExportScope] = useState<'all' | 'selection'>('all')
  const [textExportFormat, setTextExportFormat] = useState<'srt' | 'lrc' | 'vtt'>('srt')
  const [textExportScope, setTextExportScope] = useState<'all' | 'selection'>('all')
  const [editingCueId, setEditingCueId] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewPath, setPreviewPath] = useState('')
  const [materialClickMode, setMaterialClickMode] = useState<'view' | 'add'>('add')
  const [materialAssets, setMaterialAssets] = useState(context.assets)
  const [exportedArtifacts, setExportedArtifacts] = useState<WorkspaceArtifact[]>([])
  const [exportName, setExportName] = useState(`${context.draft.name}.wav`)
  const [exportFormat, setExportFormat] = useState<'wav' | 'mp3'>('wav')
  const [peak, setPeak] = useState<number | null>()
  const [levels, setLevels] = useState<StereoLevel>([0, 0])
  const [meterPeak, setMeterPeak] = useState(0)
  const [overloaded, setOverloaded] = useState(false)
  const [waveforms, setWaveforms] = useState<Record<string, Waveform>>({})
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({})
  const [sourceRetry, setSourceRetry] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)
  const textFileInputRef = useRef<HTMLInputElement>(null)
  const playbackUrl = useRef('')
  const playbackOffset = useRef(0)
  const playbackGeneration = useRef(0)
  const meterLevels = useRef<StereoLevel[]>([])
  const meterRead = useRef(0)
  const dragRef = useRef<
    | (DragSnapshot & {
        id: string
        x: number
        original: AudioClip
        mode: 'move' | 'left' | 'right'
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
      })
    | undefined
  >(undefined)
  const rulerDragRef = useRef<{ start: number; x: number } | null>(null)
  const markerDragRef = useRef<(DragSnapshot & { id: string; x: number; time: number }) | null>(
    null
  )
  const dragHistoryRecordedRef = useRef(false)
  const duration = Math.max(30, Math.ceil(timelineDuration(doc) + 5))
  const laneWidth = Math.max(900, duration * zoom)
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
  const activeTextTrack = selectedTextTrack ?? selectedCueTrack
  const selectedMarker = (doc.markers ?? []).find((marker) => marker.id === selection?.id)
  const assets = useMemo(
    () => materialAssets.filter((asset) => asset.kind === 'audio' || asset.kind === 'video'),
    [materialAssets]
  )
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
    const saver = saverRef.current
    if (!saver || context.readonly) return
    saver.update(doc)
    if (!saver.dirty) return
    setDirty(true)
    const timer = window.setTimeout(() => {
      if (!dragRef.current && !cueDragRef.current && !markerDragRef.current) void flushChanges()
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
  const waveformPaths = [
    ...new Set(doc.tracks.flatMap((track) => track.clips.map((clip) => clip.path)))
  ].join('\u0001')
  const unavailablePaths = waveformPaths.split('\u0001').filter((path) => sourceErrors[path])
  useEffect(() => {
    let live = true
    const paths = waveformPaths.split('\u0001').filter((path) => path && !waveforms[path])
    let cursor = 0
    async function worker() {
      while (live && cursor < paths.length) {
        const path = paths[cursor++]
        const query = new URLSearchParams({
          workspace_id: context.workspaceId,
          path,
          peaks: 'true'
        })
        try {
          const result = await apiFetch<Waveform>(`/audio_studio/source?${query}`)
          if (live) {
            setWaveforms((current) => ({ ...current, [path]: result }))
            setSourceErrors((current) => {
              const next = { ...current }
              delete next[path]
              return next
            })
          }
        } catch (cause) {
          if (live) {
            setSourceErrors((current) => ({
              ...current,
              [path]: cause instanceof Error ? cause.message : '素材无法读取'
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
    if (JSON.stringify(next) === JSON.stringify(doc)) return
    if (!dragRef.current && !cueDragRef.current && !markerDragRef.current) {
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
    if (context.readonly) return
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
    if (
      context.readonly ||
      doc.tracks.some((track) => track.locked && track.clips.some((clip) => clip.id === id))
    )
      return
    change({
      ...doc,
      tracks: doc.tracks.map((track) => ({
        ...track,
        clips: track.clips.map((clip) => (clip.id === id ? transform(clip) : clip))
      }))
    })
  }
  function updateCue(id: string, changeSet: Partial<TextCue>) {
    if (
      context.readonly ||
      doc.textTracks?.some((track) => track.locked && track.cues.some((cue) => cue.id === id))
    )
      return
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
    const saver = saverRef.current
    if (!saver) throw new Error('音频制作文件保存器未就绪')
    const snapshot = await saver.flush()
    setDirty(saver.dirty)
    return snapshot
  }
  async function flushChanges(): Promise<boolean> {
    if (context.readonly) return true
    if (dragRef.current || cueDragRef.current || markerDragRef.current) return false
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
    if (busy || context.readonly) return
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
    newTrack = false
  ) {
    if (context.readonly) return
    setError('')
    try {
      const query = new URLSearchParams({
        workspace_id: context.workspaceId,
        path: asset.path,
        peaks: 'false'
      })
      const source = await apiFetch<{ duration: number }>(`/audio_studio/source?${query}`)
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
      if (at + source.duration > 86400) throw new Error('时间线最长为 24 小时')
      const target = track ?? createAudioTrack(`声音 ${current.tracks.length + 1}`)
      const clip = createAudioClip(
        asset.path,
        asset.name,
        source.duration,
        at,
        asset.kind === 'video' ? 'video' : 'audio'
      )
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
    if (!selectedClip || context.readonly) return
    if (
      doc.tracks.some(
        (track) => track.locked && track.clips.some((clip) => clip.id === selectedClip.id)
      )
    )
      return
    const parts = splitClip(selectedClip, playhead)
    if (!parts) return
    change({
      ...doc,
      tracks: doc.tracks.map((track) => ({
        ...track,
        clips: track.clips.flatMap((clip) => (clip.id === selectedClip.id ? parts : [clip]))
      }))
    })
    setSelection({ kind: 'clip', id: parts[1].id })
  }
  function splitSelectedCue() {
    if (!selectedCue || context.readonly) return
    const owner = doc.textTracks?.find((track) =>
      track.cues.some((cue) => cue.id === selectedCue.id)
    )
    if (!owner || owner.locked) return
    const parts = splitTextCue(selectedCue, playhead)
    if (!parts) return
    change({
      ...doc,
      textTracks: (doc.textTracks ?? []).map((track) =>
        track.id === owner.id
          ? {
              ...track,
              cues: track.cues.flatMap((cue) => (cue.id === selectedCue.id ? parts : [cue]))
            }
          : track
      )
    })
    setSelection({ kind: 'cue', id: parts[1].id })
  }
  async function playSegment(from: number, generation: number) {
    const end = loop && range ? range.end : timelineDuration(doc)
    const segmentDuration = Math.min(12, end - from)
    if (segmentDuration <= 0.05) {
      if (loop && range && from > range.start + 0.001 && range.end - range.start > 0.05) {
        await playSegment(range.start, generation)
        return
      }
      setPlaying(false)
      return
    }
    setError('')
    try {
      const response = await apiRequest('/audio_studio/preview', {
        method: 'POST',
        body: json({
          workspace_id: context.workspaceId,
          document: doc,
          start: from,
          duration: segmentDuration
        })
      })
      if (generation !== playbackGeneration.current) return
      meterLevels.current = decodeLevels(response.headers.get('X-Audio-Level-Peaks') ?? '')
      meterRead.current = 0
      const url = URL.createObjectURL(await response.blob())
      if (generation !== playbackGeneration.current) {
        URL.revokeObjectURL(url)
        return
      }
      if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current)
      playbackUrl.current = url
      playbackOffset.current = from
      if (!audioRef.current) return
      audioRef.current.src = url
      await audioRef.current.play()
      setPlaying(true)
    } catch (cause) {
      if (generation !== playbackGeneration.current) return
      setPlaying(false)
      setError(cause instanceof Error ? cause.message : '预览播放失败')
    }
  }
  async function play() {
    if (playing) {
      playbackGeneration.current += 1
      audioRef.current?.pause()
      setPlaying(false)
      return
    }
    if (unavailablePaths.length) return
    const from =
      loop && range
        ? playhead < range.start || playhead >= range.end - 0.05
          ? range.start
          : playhead
        : playhead >= timelineDuration(doc) - 0.05
          ? 0
          : playhead
    if (from === 0) setPlayhead(0)
    await playSegment(from, ++playbackGeneration.current)
  }
  useEffect(
    () => () => {
      playbackGeneration.current += 1
      audioRef.current?.pause()
      if (playbackUrl.current) URL.revokeObjectURL(playbackUrl.current)
    },
    []
  )
  useEffect(() => {
    if (!playing) {
      setLevels([0, 0])
      return
    }
    const timer = window.setInterval(() => {
      const audio = audioRef.current
      if (!audio) return
      const index = Math.min(
        meterLevels.current.length - 1,
        Math.floor(audio.currentTime / levelStep)
      )
      if (index < 0) return
      for (let cursor = meterRead.current; cursor <= index; cursor += 1) {
        const value = meterLevels.current[cursor]
        if (!value) continue
        setMeterPeak((previous) => Math.max(previous, value[0], value[1]))
        if (value[0] >= 1 || value[1] >= 1) setOverloaded(true)
      }
      meterRead.current = index + 1
      setLevels(meterLevels.current[index] ?? [0, 0])
    }, 50)
    return () => window.clearInterval(timer)
  }, [playing])
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
      audioRef.current?.pause()
      playbackGeneration.current += 1
      setPlaying(false)
      const snapshot = await persist()
      const result = await apiFetch<WorkspaceArtifact & { mix_peak_dbfs: number | null }>(
        '/audio_studio/export',
        {
          method: 'POST',
          body: json({
            workspace_id: context.workspaceId,
            document_id: context.draft.id,
            document_revision: sha256Hex(json(snapshot)),
            document: snapshot,
            name: exportName.trim() || `${context.draft.name}.${exportFormat}`,
            format: exportFormat,
            start: exportRange?.start ?? 0,
            duration: exportRange ? exportRange.end - exportRange.start : timelineDuration(snapshot)
          })
        }
      )
      setPeak(result.mix_peak_dbfs)
      setExportedArtifacts((current) => [result, ...current])
      setMaterialAssets((current) => [
        { path: `workspace-artifact:${result.id}`, name: result.name, kind: 'audio' },
        ...current
      ])
      setStatus('音频产物已导出到工作区')
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
      if (contextMenu) return
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('[role="dialog"], [role="menu"]')
      )
        return
      const input =
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !input) {
        event.preventDefault()
        undo(event.shiftKey)
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !input) {
        event.preventDefault()
        undo(true)
      } else if (event.code === 'Space' && !input) {
        event.preventDefault()
        void play()
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !input) {
        event.preventDefault()
        removeSelected()
      } else if (
        !input &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.toLowerCase() === 's'
      ) {
        splitSelected()
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
      <Alert color="red" title="制作文件无法读取" className="audio-load-error">
        <Text size="sm">{initial.loadError}。原始数据仍保留在本机，未被覆盖。</Text>
        {initial.raw && (
          <Button
            size="xs"
            mt="sm"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([initial.raw ?? ''], { type: 'application/json' })
              )
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = `${context.draft.name}-未恢复音频制作文件.json`
              anchor.click()
              window.setTimeout(() => URL.revokeObjectURL(url), 60000)
            }}
          >
            下载原始副本
          </Button>
        )}
      </Alert>
    )

  return (
    <div className={`react-editor-panel audio-pro-studio${panelOpen ? '' : ' is-panel-hidden'}`}>
      <div className="react-editor-toolbar audio-command-pill">
        <IconMusicPlus size={16} stroke={1.8} aria-hidden="true" />
        <strong title={`${context.workspace.name} · ${context.work.name} · ${context.draft.name}`}>
          音频制作 · {context.draft.name}
        </strong>
        <Text size="xs" c={error ? 'red' : dirty ? 'orange' : 'teal'} role="status">
          {error
            ? '尚未保存'
            : busy
              ? '正在处理'
              : dirty
                ? '正在保存'
                : context.readonly
                  ? '只读'
                  : '自动保存'}
        </Text>
        {status && (
          <Text size="xs" c="teal" className="audio-command-status">
            {status}
          </Text>
        )}
        <Button
          size="compact-xs"
          variant="subtle"
          aria-pressed={panelOpen}
          onClick={() => setPanelOpen((value) => !value)}
        >
          {panelOpen ? '收起属性' : '展开属性'}
        </Button>
        <Button
          size="compact-xs"
          leftSection={<IconDeviceFloppy size={15} />}
          onClick={() => void save()}
          loading={busy}
          disabled={!dirty || context.readonly}
        >
          保存制作文件
        </Button>
        <Button
          size="compact-xs"
          variant="filled"
          leftSection={<IconDownload size={15} />}
          onClick={() => void exportArtifact()}
          loading={busy}
          disabled={
            !doc.tracks.some((track) => track.clips.length) ||
            context.readonly ||
            !!unavailablePaths.length
          }
        >
          导出产物
        </Button>
      </div>
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
              disabled={!selectedClip || context.readonly}
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
          <Tooltip label="撤销 (Ctrl+Z)" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="撤销"
              disabled={context.readonly || !past.length}
              onClick={() => undo()}
            >
              <IconArrowBackUp size={19} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="重做 (Ctrl+Shift+Z)" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="重做"
              disabled={context.readonly || !future.length}
              onClick={() => undo(true)}
            >
              <IconArrowForwardUp size={19} />
            </ActionIcon>
          </Tooltip>
          <Divider my={4} />
          <Tooltip label="适应时间线" position="right">
            <ActionIcon
              variant="subtle"
              aria-label="适应时间线"
              onClick={() =>
                setZoom(
                  Math.max(
                    2,
                    Math.min(
                      240,
                      (timelineScrollRef.current?.clientWidth ?? 800) / Math.max(duration, 1)
                    )
                  )
                )
              }
            >
              <IconMaximize size={19} />
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
        <div className="react-audio-workarea">
          <div className="audio-timeline-heading">
            <div>
              <strong>声音时间线</strong>
              <span>
                {doc.tracks.length} 条音轨 ·{' '}
                {doc.tracks.reduce((total, track) => total + track.clips.length, 0)} 个片段 ·{' '}
                {(doc.textTracks ?? []).length} 条文字轨
              </span>
            </div>
            <Button
              size="compact-xs"
              variant={snapping ? 'light' : 'default'}
              aria-pressed={snapping}
              onClick={() => setSnapping((value) => !value)}
            >
              吸附{snapping ? '开启' : '关闭'}
            </Button>
          </div>
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
              </Group>
            </Alert>
          )}
          <div
            className="react-audio-timeline"
            ref={timelineScrollRef}
            onWheel={(event) => {
              if (!event.ctrlKey && !event.metaKey) return
              event.preventDefault()
              setZoom((value) =>
                Math.max(2, Math.min(240, value * (event.deltaY < 0 ? 1.15 : 0.87)))
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
                const time = Math.max(
                  0,
                  (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom
                )
                rulerDragRef.current = { start: time, x: event.clientX }
                setPlayhead(time)
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const drag = rulerDragRef.current
                if (!drag) return
                const time = Math.max(
                  0,
                  (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom
                )
                if (Math.abs(event.clientX - drag.x) > 5)
                  setRange({ start: Math.min(drag.start, time), end: Math.max(drag.start, time) })
              }}
              onPointerUp={() => {
                rulerDragRef.current = null
              }}
              onPointerCancel={() => {
                rulerDragRef.current = null
              }}
            >
              {Array.from({ length: Math.ceil(duration / 5) + 1 }, (_, index) => (
                <span key={index} style={{ left: index * 5 * zoom }}>
                  {clock(index * 5)}
                </span>
              ))}
              <i style={{ left: playhead * zoom }} />
              {range && (
                <div
                  className="audio-range-selection"
                  style={{ left: range.start * zoom, width: (range.end - range.start) * zoom }}
                  aria-label={`选区 ${clock(range.start)} 至 ${clock(range.end)}`}
                />
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
                    <small>{Math.round(track.gain * 100)}%</small>
                  </div>
                </div>
                <div
                  className="react-audio-lane"
                  style={{ width: laneWidth }}
                  data-track-id={track.id}
                  onContextMenu={(event) => showContextMenu(event, 'blank')}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.target !== event.currentTarget) return
                    setSelection({ kind: 'track', id: track.id })
                    setPlayhead(
                      Math.max(
                        0,
                        (event.clientX - event.currentTarget.getBoundingClientRect().left) / zoom
                      )
                    )
                  }}
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
                      data-selected={selection?.id === clip.id}
                      onContextMenu={(event) => showContextMenu(event, 'clip', clip.id)}
                      style={{ left: clip.start * zoom, width: Math.max(36, clip.duration * zoom) }}
                      onPointerDown={(event) => {
                        if (event.button !== 0 || context.readonly || track.locked) return
                        event.preventDefault()
                        event.stopPropagation()
                        playbackGeneration.current += 1
                        audioRef.current?.pause()
                        setPlaying(false)
                        dragHistoryRecordedRef.current = false
                        const rect = event.currentTarget.getBoundingClientRect()
                        const offset = event.clientX - rect.left
                        dragRef.current = {
                          id: clip.id,
                          x: event.clientX,
                          original: clip,
                          before: doc,
                          past,
                          future,
                          mode: offset < 8 ? 'left' : offset > rect.width - 8 ? 'right' : 'move'
                        }
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        const drag = dragRef.current
                        if (!drag || drag.id !== clip.id) return
                        const delta = (event.clientX - drag.x) / zoom
                        const points = timelineSnapPoints(doc, playhead, clip.id)
                        if (drag.mode === 'move') {
                          const raw = Math.max(0, drag.original.start + delta)
                          const next =
                            snapping && !event.shiftKey
                              ? snapSpanStart(raw, drag.original.duration, points, 8 / zoom).time
                              : raw
                          updateClip(clip.id, (current) => ({
                            ...current,
                            start: Math.round(next * 1000) / 1000
                          }))
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
                      onClick={() => setSelection({ kind: 'clip', id: clip.id })}
                    >
                      <ClipWaveform clip={clip} waveform={waveforms[clip.path]} />
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
                    <small>{track.cues.length} 段</small>
                  </div>
                </div>
                <div
                  className="react-audio-lane"
                  style={{ width: laneWidth }}
                  data-text-track-id={track.id}
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
                      data-selected={selection?.id === cue.id}
                      style={{ left: cue.start * zoom, width: Math.max(44, cue.duration * zoom) }}
                      onPointerDown={(event) => {
                        if (
                          event.button !== 0 ||
                          context.readonly ||
                          track.locked ||
                          editingCueId === cue.id
                        )
                          return
                        event.preventDefault()
                        event.stopPropagation()
                        playbackGeneration.current += 1
                        audioRef.current?.pause()
                        setPlaying(false)
                        dragHistoryRecordedRef.current = false
                        const rect = event.currentTarget.getBoundingClientRect()
                        const offset = event.clientX - rect.left
                        cueDragRef.current = {
                          id: cue.id,
                          x: event.clientX,
                          start: cue.start,
                          duration: cue.duration,
                          before: doc,
                          past,
                          future,
                          mode: offset < 8 ? 'left' : offset > rect.width - 8 ? 'right' : 'move'
                        }
                        event.currentTarget.setPointerCapture(event.pointerId)
                      }}
                      onPointerMove={(event) => {
                        const drag = cueDragRef.current
                        if (!drag || drag.id !== cue.id) return
                        const delta = (event.clientX - drag.x) / zoom
                        const points = timelineSnapPoints(doc, playhead, cue.id)
                        if (drag.mode === 'move') {
                          const raw = Math.max(
                            0,
                            Math.min(86400 - drag.duration, drag.start + delta)
                          )
                          const next =
                            snapping && !event.shiftKey
                              ? snapSpanStart(raw, drag.duration, points, 8 / zoom).time
                              : raw
                          updateCue(cue.id, { start: Math.round(next * 1000) / 1000 })
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
                      onClick={() => {
                        setSelection({ kind: 'cue', id: cue.id })
                        setPlayhead(cue.start)
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
          </div>
          <div className="react-audio-controls">
            <Group gap="xs" wrap="nowrap">
              <ActionIcon variant="subtle" aria-label="回到起点" onClick={() => setPlayhead(0)}>
                <IconPlayerSkipBack size={17} />
              </ActionIcon>
              <ActionIcon
                variant="light"
                aria-label={playing ? '暂停试听' : '播放试听'}
                disabled={!timelineDuration(doc) || !!unavailablePaths.length}
                onClick={() => void play()}
              >
                {playing ? <IconPlayerPause size={18} /> : <IconPlayerPlay size={18} />}
              </ActionIcon>
              <Text size="xs" ff="monospace" className="audio-transport-time">
                {clock(playhead)} / {clock(timelineDuration(doc))}
              </Text>
            </Group>
            <Group gap="xs" wrap="nowrap" className="audio-transport-range">
              <Button
                size="compact-xs"
                variant={loop ? 'light' : 'default'}
                disabled={!range}
                aria-pressed={loop}
                onClick={() => setLoop((value) => !value)}
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
                      setRange(null)
                      setLoop(false)
                    }}
                  >
                    ×
                  </ActionIcon>
                </>
              )}
            </Group>
            <Group gap={5} wrap="nowrap" className="audio-transport-zoom">
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label="缩小时间线"
                onClick={() => setZoom((value) => Math.max(2, value / 1.4))}
              >
                −
              </ActionIcon>
              <Slider
                value={zoom}
                min={2}
                max={240}
                w={76}
                aria-label="时间线缩放"
                onChange={setZoom}
              />
              <ActionIcon
                size="sm"
                variant="subtle"
                aria-label="放大时间线"
                onClick={() => setZoom((value) => Math.min(240, value * 1.4))}
              >
                ＋
              </ActionIcon>
            </Group>
          </div>
          <audio
            ref={audioRef}
            hidden
            onTimeUpdate={(event) =>
              setPlayhead(playbackOffset.current + event.currentTarget.currentTime)
            }
            onEnded={(event) => {
              const next = playbackOffset.current + event.currentTarget.duration
              const end = loop && range ? range.end : timelineDuration(doc)
              if (next < end - 0.05) {
                void playSegment(next, playbackGeneration.current)
              } else if (loop && range) {
                setPlayhead(range.start)
                void playSegment(range.start, playbackGeneration.current)
              } else {
                setPlaying(false)
              }
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
          <div className="audio-inspector-scroll">
            <Stack gap="md">
              <section className="react-audio-meter" aria-label="混音音量表">
                <Group justify="space-between" mb={8}>
                  <Text size="xs" fw={700}>
                    混音音量 · {playing ? '试听中' : '已停止'}
                  </Text>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() => {
                      setMeterPeak(0)
                      setOverloaded(false)
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
              </section>
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
                      disabled={context.readonly || selectedClipTrack?.locked}
                    />
                    <NumberInput
                      size="xs"
                      label="时长"
                      decimalScale={3}
                      value={selectedClip.duration}
                      onChange={(v) =>
                        updateClip(selectedClip.id, (clip) => {
                          const sourceDuration =
                            waveforms[clip.path]?.duration ??
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
                          waveforms[clip.path]?.duration ??
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
                  <NumberInput
                    size="xs"
                    label="变速"
                    min={0.25}
                    max={4}
                    step={0.05}
                    value={selectedClip.rate ?? 1}
                    onChange={(v) => {
                      try {
                        updateClip(selectedClip.id, (clip) => setClipRate(clip, numeric(v, 1)))
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
                      decimalScale={3}
                      value={selectedCue.start}
                      onChange={(v) =>
                        updateCue(selectedCue.id, { start: numeric(v, selectedCue.start) })
                      }
                      disabled={context.readonly || selectedCueTrack?.locked}
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
              <Divider />
              <Text size="xs" fw={700}>
                混音与导出
              </Text>
              <Text size="xs">总音量 · {Math.round(doc.masterGain * 100)}%</Text>
              <Slider
                value={doc.masterGain * 100}
                max={200}
                onChange={(value) => change({ ...doc, masterGain: value / 100 })}
                disabled={context.readonly}
              />
              <TextInput
                size="xs"
                label="产物名称"
                value={exportName}
                onChange={(event) => setExportName(event.currentTarget.value)}
              />
              <Select
                size="xs"
                label="格式"
                value={exportFormat}
                data={[
                  { value: 'wav', label: 'WAV' },
                  { value: 'mp3', label: 'MP3' }
                ]}
                onChange={(value) => setExportFormat(value === 'mp3' ? 'mp3' : 'wav')}
              />
              <Select
                size="xs"
                label="范围"
                value={exportScope}
                data={[
                  { value: 'all', label: '整条时间线' },
                  { value: 'selection', label: '选区', disabled: !range }
                ]}
                onChange={(value) => setExportScope(value === 'selection' ? 'selection' : 'all')}
              />
              {peak !== undefined && (
                <Alert color={peak !== null && peak >= 0 ? 'red' : 'teal'} title="混音峰值">
                  {peak === null ? '尚无峰值数据' : `${peak.toFixed(1)} dBFS`}
                </Alert>
              )}
            </Stack>
          </div>
          <footer className="audio-inspector-footer">
            <Button
              fullWidth
              disabled={
                context.readonly ||
                !doc.tracks.some((track) => track.clips.length) ||
                !!unavailablePaths.length ||
                (exportScope === 'selection' && !range)
              }
              loading={busy}
              onClick={() => void exportArtifact()}
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
          onAction={(asset, key) => void addAsset(asset, playhead, undefined, key === 'new-track')}
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
    </div>
  )
}
