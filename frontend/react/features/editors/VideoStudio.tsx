import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
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
  IconVideo
} from '@tabler/icons-react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { formatFileSize } from '../../shared/formatFileSize'
import { mutateWorkspaceState, readWorkspaceState } from '../../shared/workspaceState'
import { assertProductionDraftExists } from '../../../src/features/workspaces/model/workspaceWorks'
import { sha256Hex } from '../../../src/shared/lib/sha256'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { WorkspaceArtifact } from '../../../src/features/workspaces/api/workspaceArtifacts'
import type { EditorContext, RegisterEditorBeforeLeave } from './EditorHub'
import { EditorSaveQueue } from './editorSaveQueue'
import { importEditorMaterials } from './editorMediaImport'
import MaterialBar from './MaterialBar'
import WorkbenchMediaPicker from '../workbench/WorkbenchMediaPicker'
import { MediaPreview } from '../media/MediaPreview'
import { editorPreviewFile } from './editorMediaImport'
import './VideoStudio.css'

type Lane = 'visual' | 'sound'
type ClipKind = 'image' | 'video' | 'audio'
type Selection = { type: Lane | 'caption' | 'marker'; id: string } | null
type DragMode = 'move' | 'left' | 'right'

interface VideoClip {
  id: string
  path: string
  name: string
  kind: ClipKind
  start: number
  sourceIn: number
  duration: number
  sourceDuration: number
  rate: number
  gain: number
}
interface Caption {
  id: string
  text: string
  start: number
  duration: number
}
interface Marker {
  id: string
  name: string
  time: number
}
interface VideoTimelineDocument {
  version: 1
  width: number
  height: number
  fps: number
  visuals: VideoClip[]
  sounds: VideoClip[]
  captions: Caption[]
  markers: Marker[]
}
interface DragState {
  id: string
  lane: Lane
  mode: DragMode
  x: number
  original: VideoClip
}

const keyFor = (workspaceId: string, draftId: string) =>
  `omnigallery:video-timeline-v1:${workspaceId}:${draftId}`
const emptyDocument = (): VideoTimelineDocument => ({
  version: 1,
  width: 1280,
  height: 720,
  fps: 30,
  visuals: [],
  sounds: [],
  captions: [],
  markers: []
})
const bounded = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
const rounded = (value: number) => Math.round(value * 100) / 100
const numberValue = (value: string | number, fallback = 0) => {
  if (value === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const artifactId = (path: string) => (path.startsWith('workspace-artifact:') ? path.slice(19) : '')
const formatTime = (value: number) => {
  const tenths = Math.round(Math.max(0, value) * 10)
  const minutes = Math.floor(tenths / 600)
  const seconds = Math.floor((tenths % 600) / 10)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths % 10}`
}
const timelineEnd = (doc: VideoTimelineDocument) =>
  Math.max(
    0,
    ...doc.visuals.map((clip) => clip.start + clip.duration),
    ...doc.sounds.map((clip) => clip.start + clip.duration),
    ...doc.captions.filter((cue) => cue.text.trim()).map((cue) => cue.start + cue.duration)
  )

function readDocument(raw: string | null): VideoTimelineDocument {
  if (!raw) return emptyDocument()
  const input: unknown = JSON.parse(raw)
  if (!input || typeof input !== 'object' || !('version' in input) || input.version !== 1)
    throw new Error('视频制作文件版本无法读取，原始数据已保留')
  const item = input as Partial<VideoTimelineDocument>
  if (
    !Array.isArray(item.visuals) ||
    !Array.isArray(item.sounds) ||
    !Array.isArray(item.captions) ||
    !Array.isArray(item.markers) ||
    item.visuals.length > 256 ||
    item.sounds.length > 256 ||
    item.captions.length > 512 ||
    item.markers.length > 256
  )
    throw new Error('视频制作文件结构无法读取，原始数据已保留')
  const validClip = (clip: VideoClip) =>
    !!clip &&
    typeof clip.id === 'string' &&
    typeof clip.path === 'string' &&
    typeof clip.name === 'string' &&
    ['image', 'video', 'audio'].includes(clip.kind) &&
    Number.isFinite(clip.start) &&
    clip.start >= 0 &&
    clip.start <= 86400 &&
    Number.isFinite(clip.duration) &&
    clip.duration > 0 &&
    clip.duration <= 86400 &&
    Number.isFinite(clip.sourceIn) &&
    clip.sourceIn >= 0 &&
    Number.isFinite(clip.sourceDuration) &&
    clip.sourceDuration > 0 &&
    Number.isFinite(clip.rate) &&
    clip.rate >= 0.25 &&
    clip.rate <= 4 &&
    Number.isFinite(clip.gain) &&
    clip.gain >= 0 &&
    clip.gain <= 1
  if (
    ![...item.visuals, ...item.sounds].every(validClip) ||
    !item.captions.every(
      (cue) =>
        !!cue &&
        typeof cue.id === 'string' &&
        typeof cue.text === 'string' &&
        Number.isFinite(cue.start) &&
        cue.start >= 0 &&
        Number.isFinite(cue.duration) &&
        cue.duration > 0
    ) ||
    !item.markers.every(
      (marker) =>
        !!marker &&
        typeof marker.id === 'string' &&
        typeof marker.name === 'string' &&
        Number.isFinite(marker.time) &&
        marker.time >= 0
    )
  )
    throw new Error('视频制作文件内容损坏，原始数据已保留')
  return {
    version: 1,
    width: bounded(Number(item.width ?? 1280), 240, 7680),
    height: bounded(Number(item.height ?? 720), 240, 7680),
    fps: bounded(Number(item.fps ?? 30), 1, 120),
    visuals: item.visuals,
    sounds: item.sounds,
    captions: item.captions,
    markers: item.markers
  }
}

function mediaUrl(path: string, name: string, revision = '0') {
  const id = artifactId(path)
  if (id) return apiUrl(`/workspace_artifacts/${encodeURIComponent(id)}/file`)
  if (/\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(name))
    return apiUrl(
      `/img/${encodeURIComponent(name)}?path=${encodeURIComponent(path)}&t=${encodeURIComponent(revision)}`
    )
  return apiUrl(`/stream_video?path=${encodeURIComponent(path)}`)
}
async function probeDuration(asset: WorkspaceAsset, revision: string): Promise<number> {
  if (asset.kind === 'image') return 5
  return new Promise((resolve, reject) => {
    const element = document.createElement(asset.kind === 'audio' ? 'audio' : 'video')
    let done = false
    const finish = (value: number | null) => {
      if (done) return
      done = true
      element.removeAttribute('src')
      element.load()
      if (value !== null && Number.isFinite(value) && value > 0) resolve(bounded(value, 0.2, 21600))
      else reject(new Error(`无法读取“${asset.name}”的媒体时长`))
    }
    const timeout = window.setTimeout(() => finish(null), 10000)
    element.onloadedmetadata = () => {
      window.clearTimeout(timeout)
      finish(element.duration)
    }
    element.onerror = () => {
      window.clearTimeout(timeout)
      finish(null)
    }
    element.preload = 'metadata'
    element.src = mediaUrl(asset.path, asset.name, revision)
  })
}

export default function VideoStudio({
  context,
  onBeforeLeave
}: {
  context: EditorContext
  onBeforeLeave?: RegisterEditorBeforeLeave
}) {
  const storageKey = keyFor(context.workspaceId, context.draft.id)
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
  const [selection, setSelection] = useState<Selection>(null)
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(24)
  const [snapping, setSnapping] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportName, setExportName] = useState(`${context.draft.name || '视频成片'}.mp4`)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewPath, setPreviewPath] = useState('')
  const [materialClickMode, setMaterialClickMode] = useState<'view' | 'add'>('add')
  const [importedAssets, setImportedAssets] = useState<WorkspaceAsset[]>([])
  const [videoAddMode, setVideoAddMode] = useState<'default' | 'visual' | 'sound'>('default')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [dragPreview, setDragPreview] = useState<VideoClip | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const soundRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const dragRef = useRef<DragState | null>(null)
  const docRef = useRef(doc)
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
  const selectedClip = [...doc.visuals, ...doc.sounds].find((clip) => clip.id === selection?.id)
  const selectedCaption = doc.captions.find((cue) => cue.id === selection?.id)
  const selectedMarker = doc.markers.find((marker) => marker.id === selection?.id)
  const activeVisual = [...doc.visuals]
    .filter((clip) => playhead >= clip.start && playhead < clip.start + clip.duration)
    .sort((a, b) => a.start - b.start)
    .at(-1)
  const activeCaptions = doc.captions.filter(
    (cue) => playhead >= cue.start && playhead < cue.start + cue.duration
  )
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
        if (live) setArtifacts(items)
      })
      .catch(() => {
        /* Workspace media remains usable if artifacts are unavailable. */
      })
    return () => {
      live = false
    }
  }, [context.workspaceId])

  function change(next: VideoTimelineDocument) {
    docRef.current = next
    saverRef.current?.update(next)
    setDoc(next)
    setDirty(true)
    setStatus('')
    setError('')
  }

  async function flushChanges(): Promise<boolean> {
    if (context.readonly) return true
    if (dragRef.current) return false
    const saver = saverRef.current
    if (!saver) return false
    setSaving(true)
    try {
      await saver.flush()
      setDirty(saver.dirty)
      setStatus('制作文件已保存')
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存视频制作文件失败')
      return false
    } finally {
      setSaving(false)
    }
  }
  async function save() {
    if (context.readonly || saving) return
    await flushChanges()
  }
  async function exportVideo() {
    if (context.readonly || exporting || !exportName.trim()) return
    setExporting(true)
    setPlaying(false)
    setError('')
    setStatus('')
    try {
      if (!(await flushChanges())) return
      const snapshot = docRef.current
      const length = timelineEnd(snapshot)
      if (!length || length > 3600)
        throw new Error('视频须有画面、声音或字幕，且成片不能超过 60 分钟')
      const artifact = await apiFetch<WorkspaceArtifact>('/video_studio/export', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: context.workspaceId,
          document_id: context.draft.id,
          document_revision: sha256Hex(JSON.stringify(snapshot)),
          document: snapshot,
          name: exportName.trim()
        })
      })
      setArtifacts((current) => [artifact, ...current.filter((item) => item.id !== artifact.id)])
      setExportOpen(false)
      setStatus('MP4 成片已导出到工作区产物；可在作品成果中选用')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '视频导出失败')
    } finally {
      setExporting(false)
    }
  }
  useEffect(() => {
    if (!dirty || saving || context.readonly) return
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
      }
      if (
        event.code === 'Space' &&
        !['INPUT', 'TEXTAREA', 'BUTTON'].includes((event.target as HTMLElement).tagName)
      ) {
        event.preventDefault()
        setPlaying((value) => !value)
      }
      if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName) &&
        selection &&
        !context.readonly
      ) {
        event.preventDefault()
        removeSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc, selection, saving, context.readonly])
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min((now - previous) / 1000, 0.2)
      previous = now
      setPlayhead((current) => {
        const next = current + elapsed
        if (next >= timelineEnd(doc)) {
          setPlaying(false)
          return 0
        }
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, doc])
  useEffect(() => {
    const video = videoRef.current
    if (video && activeVisual?.kind === 'video') {
      const sourceTime = activeVisual.sourceIn + (playhead - activeVisual.start) * activeVisual.rate
      if (Math.abs(video.currentTime - sourceTime) > (playing ? 0.25 : 0.03))
        video.currentTime = sourceTime
      video.playbackRate = activeVisual.rate
      if (playing && video.paused) void video.play().catch(() => undefined)
      else if (!playing && !video.paused) video.pause()
    }
    for (const clip of doc.sounds) {
      const audio = soundRefs.current[clip.id]
      if (!audio) continue
      const active = playhead >= clip.start && playhead < clip.start + clip.duration
      if (!playing || !active) {
        if (!audio.paused) audio.pause()
        continue
      }
      const sourceTime = clip.sourceIn + (playhead - clip.start) * clip.rate
      if (Math.abs(audio.currentTime - sourceTime) > 0.25) audio.currentTime = sourceTime
      audio.playbackRate = clip.rate
      audio.volume = bounded(clip.gain, 0, 1)
      if (audio.paused) void audio.play().catch(() => undefined)
    }
  }, [activeVisual?.id, playhead, playing, doc.sounds])

  function snapTime(time: number, exceptId = '') {
    const value = rounded(Math.max(0, time))
    if (!snapping) return value
    const points = [
      0,
      playhead,
      ...doc.markers.map((marker) => marker.time),
      ...[...doc.visuals, ...doc.sounds]
        .filter((clip) => clip.id !== exceptId)
        .flatMap((clip) => [clip.start, clip.start + clip.duration])
    ]
    const closest = points.reduce(
      (best, point) => (Math.abs(point - value) < Math.abs(best - value) ? point : best),
      value
    )
    return Math.abs(closest - value) <= 0.2 ? rounded(closest) : value
  }
  function updateClip(id: string, lane: Lane, transform: (clip: VideoClip) => VideoClip) {
    change({
      ...doc,
      [lane === 'visual' ? 'visuals' : 'sounds']: doc[lane === 'visual' ? 'visuals' : 'sounds'].map(
        (clip) => (clip.id === id ? transform(clip) : clip)
      )
    })
  }
  async function addAsset(
    asset: WorkspaceAsset,
    mode: 'default' | 'visual' | 'sound' = 'default',
    at = playhead
  ) {
    if (context.readonly) return
    if (mode === 'visual' && asset.kind === 'audio') {
      setError('音频素材不能放入画面轨')
      return
    }
    if (mode === 'sound' && asset.kind === 'image') {
      setError('静态图片没有可添加的声音')
      return
    }
    setError('')
    const start = snapTime(at)
    let sourceDuration: number
    try {
      sourceDuration = await probeDuration(asset, assetInfo[asset.path]?.date ?? '0')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取媒体时长')
      return
    }
    const clip: VideoClip = {
      id: crypto.randomUUID(),
      path: asset.path,
      name: asset.name,
      kind: asset.kind,
      start,
      sourceIn: 0,
      duration: asset.kind === 'image' ? 5 : sourceDuration,
      sourceDuration,
      rate: 1,
      gain: 1
    }
    const addVisual = asset.kind !== 'audio' && mode !== 'sound'
    const addSound = asset.kind === 'audio' || (asset.kind === 'video' && mode !== 'visual')
    const soundClip = { ...clip, id: crypto.randomUUID() }
    const current = docRef.current
    if (
      (addVisual && current.visuals.length >= 256) ||
      (addSound && current.sounds.length >= 256)
    ) {
      setError('每类轨道最多支持 256 个片段')
      return
    }
    if (start + clip.duration > 3600) {
      setError('成片最长为 60 分钟，请移动播放头或缩短素材')
      return
    }
    change({
      ...current,
      visuals: addVisual ? [...current.visuals, clip] : current.visuals,
      sounds: addSound ? [...current.sounds, soundClip] : current.sounds
    })
    setSelection({ type: addVisual ? 'visual' : 'sound', id: addVisual ? clip.id : soundClip.id })
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
  function removeSelection() {
    if (!selection || context.readonly) return
    change({
      ...doc,
      visuals: doc.visuals.filter(
        (clip) => selection.type !== 'visual' || clip.id !== selection.id
      ),
      sounds: doc.sounds.filter((clip) => selection.type !== 'sound' || clip.id !== selection.id),
      captions: doc.captions.filter(
        (cue) => selection.type !== 'caption' || cue.id !== selection.id
      ),
      markers: doc.markers.filter(
        (marker) => selection.type !== 'marker' || marker.id !== selection.id
      )
    })
    setSelection(null)
  }
  function splitSelection() {
    if (
      !selection ||
      (selection.type !== 'visual' && selection.type !== 'sound') ||
      context.readonly
    )
      return
    const list = doc[selection.type === 'visual' ? 'visuals' : 'sounds']
    const clip = list.find((item) => item.id === selection.id)
    if (!clip || playhead <= clip.start + 0.1 || playhead >= clip.start + clip.duration - 0.1)
      return
    const before = rounded(playhead - clip.start)
    const first = { ...clip, duration: before }
    const second = {
      ...clip,
      id: crypto.randomUUID(),
      start: rounded(playhead),
      sourceIn: rounded(clip.sourceIn + before * clip.rate),
      duration: rounded(clip.duration - before)
    }
    change({
      ...doc,
      [selection.type === 'visual' ? 'visuals' : 'sounds']: list.flatMap((item) =>
        item.id === clip.id ? [first, second] : [item]
      )
    })
    setSelection({ ...selection, id: second.id })
  }
  function dragValue(drag: DragState, clientX: number): VideoClip {
    const clip = drag.original
    const delta = (clientX - drag.x) / pixelsPerSecond
    if (drag.mode === 'move') return { ...clip, start: snapTime(clip.start + delta, clip.id) }
    if (drag.mode === 'left') {
      const nextStart = bounded(
        snapTime(clip.start + delta, clip.id),
        Math.max(0, clip.start - clip.sourceIn / clip.rate),
        clip.start + clip.duration - 0.2
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
      clip.kind === 'image'
        ? 21600
        : Math.max(0.2, (clip.sourceDuration - clip.sourceIn) / clip.rate)
    const nextEnd = snapTime(clip.start + clip.duration + delta, clip.id)
    return { ...clip, duration: rounded(bounded(nextEnd - clip.start, 0.2, maxDuration)) }
  }
  function startDrag(event: PointerEvent<HTMLButtonElement>, clip: VideoClip, lane: Lane) {
    if (context.readonly) return
    const edge = (event.target as HTMLElement).closest('[data-edge]')?.getAttribute('data-edge')
    dragRef.current = {
      id: clip.id,
      lane,
      mode: edge === 'left' || edge === 'right' ? edge : 'move',
      x: event.clientX,
      original: clip
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelection({ type: lane, id: clip.id })
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (drag?.id) setDragPreview(dragValue(drag, event.clientX))
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag) return
    const next = dragValue(drag, event.clientX)
    dragRef.current = null
    setDragPreview(null)
    if (JSON.stringify(next) !== JSON.stringify(drag.original))
      updateClip(drag.id, drag.lane, () => next)
  }

  const sourceRevision = (clip: VideoClip) => context.assetInfo[clip.path]?.date ?? '0'
  const renderClip = (clip: VideoClip, lane: Lane) => {
    const displayed = dragPreview?.id === clip.id ? dragPreview : clip
    return (
      <button
        key={clip.id}
        type="button"
        className={`video-timeline-clip kind-${clip.kind} ${selection?.id === clip.id ? 'is-selected' : ''}`}
        style={{
          left: displayed.start * pixelsPerSecond,
          width: Math.max(46, displayed.duration * pixelsPerSecond)
        }}
        onPointerDown={(event) => startDrag(event, clip, lane)}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={() => {
          dragRef.current = null
          setDragPreview(null)
        }}
        onClick={() => setSelection({ type: lane, id: clip.id })}
        aria-label={`${lane === 'visual' ? '画面' : '声音'}：${clip.name}，${formatTime(clip.start)} 至 ${formatTime(clip.start + clip.duration)}`}
      >
        <span className="video-clip-edge" data-edge="left" aria-hidden="true" />
        <span className="video-clip-content">
          {clip.kind === 'audio' ? (
            <IconMusic size={15} />
          ) : clip.kind === 'video' ? (
            <IconVideo size={15} />
          ) : (
            <IconPhoto size={15} />
          )}
          <span>{clip.name}</span>
        </span>
        <span className="video-clip-edge" data-edge="right" aria-hidden="true" />
      </button>
    )
  }

  if (initial.loadError)
    return (
      <Alert color="red" title="制作文件无法读取" className="video-load-error">
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
              anchor.download = `${context.draft.name}-未恢复视频制作文件.json`
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
    <section className="video-studio" aria-label="视频剪辑编辑器">
      <div className="video-studio-toolbar">
        <IconVideo size={16} aria-hidden="true" />
        <strong title={`${context.workspace.name} · ${context.work.name} · ${context.draft.name}`}>
          视频剪辑 · {context.draft.name}
        </strong>
        <Text size="xs" c={dirty ? 'orange' : 'teal'} role="status">
          {saving ? '正在保存' : dirty ? '未保存' : context.readonly ? '只读' : '自动保存'}
        </Text>
        <Group gap="xs" wrap="nowrap">
          <Button
            size="compact-xs"
            variant="default"
            leftSection={<IconDeviceFloppy size={15} />}
            disabled={!dirty || context.readonly}
            loading={saving}
            onClick={() => void save()}
          >
            保存制作文件
          </Button>
          <Button
            size="compact-xs"
            disabled={context.readonly || !timelineEnd(doc)}
            loading={exporting}
            onClick={() => setExportOpen(true)}
          >
            导出视频
          </Button>
        </Group>
      </div>
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
        </aside>
        <div className="video-studio-main">
          <div className="video-studio-stage-wrap">
            <div
              className="video-studio-stage"
              style={{ aspectRatio: `${doc.width} / ${doc.height}` }}
            >
              {activeVisual?.kind === 'image' && (
                <img
                  src={mediaUrl(activeVisual.path, activeVisual.name, sourceRevision(activeVisual))}
                  alt="当前画面"
                />
              )}
              {activeVisual?.kind === 'video' && (
                <video
                  key={activeVisual.id}
                  ref={videoRef}
                  src={mediaUrl(activeVisual.path, activeVisual.name, sourceRevision(activeVisual))}
                  muted
                  playsInline
                  preload="auto"
                />
              )}
              {!activeVisual && (
                <div className="video-stage-empty">
                  <IconVideo size={42} stroke={1.2} />
                  <Text size="sm">画面预览</Text>
                  <Text size="xs">从左侧添加视频或图片</Text>
                </div>
              )}
              {!!activeCaptions.length && (
                <div className="video-stage-caption">
                  {activeCaptions.map((cue) => (
                    <span key={cue.id}>{cue.text}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="video-transport">
            <Group gap="xs">
              <ActionIcon
                variant="light"
                size="lg"
                aria-label={playing ? '暂停' : '播放'}
                onClick={() => {
                  if (timelineEnd(doc)) setPlaying((value) => !value)
                }}
              >
                {playing ? <IconPlayerPause size={19} /> : <IconPlayerPlay size={19} />}
              </ActionIcon>
              <Text size="sm" ff="monospace">
                {formatTime(playhead)} / {formatTime(timelineEnd(doc))}
              </Text>
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
                min={12}
                max={64}
                step={2}
                value={zoom}
                onChange={setZoom}
                w={90}
                aria-label="时间线缩放"
              />
              <Button
                variant={snapping ? 'light' : 'subtle'}
                size="compact-xs"
                onClick={() => setSnapping((value) => !value)}
              >
                吸附{snapping ? '开' : '关'}
              </Button>
            </Group>
          </div>
          <div className="video-timeline-scroll">
            <div className="video-timeline-canvas" style={{ width: laneWidth + 126 }}>
              <div className="video-ruler">
                <div className="video-lane-title">时间线</div>
                <div
                  className="video-ruler-ticks"
                  style={{ width: laneWidth }}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    setPlayhead(bounded((event.clientX - rect.left) / pixelsPerSecond, 0, duration))
                  }}
                >
                  {Array.from({ length: Math.ceil(duration / 5) + 1 }, (_, index) => (
                    <span key={index} style={{ left: index * 5 * pixelsPerSecond }}>
                      {formatTime(index * 5)}
                    </span>
                  ))}
                </div>
              </div>
              {(['visual', 'sound'] as const).map((lane) => (
                <div className={`video-lane lane-${lane}`} key={lane}>
                  <div className="video-lane-title">
                    {lane === 'visual' ? (
                      <>
                        <IconVideo size={16} />
                        画面
                      </>
                    ) : (
                      <>
                        <IconMusic size={16} />
                        声音
                      </>
                    )}
                  </div>
                  <div
                    className="video-lane-content"
                    style={{ width: laneWidth }}
                    onDragOver={(event) => {
                      if (
                        event.dataTransfer.types.includes('application/x-omnigallery-editor-asset')
                      )
                        event.preventDefault()
                    }}
                    onDrop={(event) => {
                      const path = event.dataTransfer.getData(
                        'application/x-omnigallery-editor-asset'
                      )
                      const asset = assets.find((item) => item.path === path)
                      if (!asset) return
                      event.preventDefault()
                      const at = Math.max(
                        0,
                        (event.clientX - event.currentTarget.getBoundingClientRect().left) /
                          pixelsPerSecond
                      )
                      void addAsset(asset, lane, at)
                    }}
                  >
                    {doc[lane === 'visual' ? 'visuals' : 'sounds'].map((clip) =>
                      renderClip(clip, lane)
                    )}
                    {!doc[lane === 'visual' ? 'visuals' : 'sounds'].length && (
                      <span className="video-lane-empty">
                        从下方添加{lane === 'visual' ? '图片或视频' : '声音'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div className="video-lane lane-caption">
                <div className="video-lane-title">
                  <IconTypography size={16} />
                  字幕
                </div>
                <div className="video-lane-content" style={{ width: laneWidth }}>
                  {doc.captions.map((cue) => (
                    <button
                      key={cue.id}
                      type="button"
                      className={`video-caption-cue ${selection?.id === cue.id ? 'is-selected' : ''}`}
                      style={{
                        left: cue.start * pixelsPerSecond,
                        width: Math.max(46, cue.duration * pixelsPerSecond)
                      }}
                      onClick={() => setSelection({ type: 'caption', id: cue.id })}
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
                    setPlayhead(marker.time)
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
            {doc.sounds.map((clip) => (
              <audio
                key={clip.id}
                ref={(node) => {
                  soundRefs.current[clip.id] = node
                }}
                src={mediaUrl(clip.path, clip.name, sourceRevision(clip))}
                preload="auto"
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
          <ScrollArea className="video-inspector-scroll" type="auto" offsetScrollbars>
            <Stack gap="sm">
              {selectedClip &&
              selection &&
              (selection.type === 'visual' || selection.type === 'sound') ? (
                <>
                  <Text size="sm" fw={650} lineClamp={2}>
                    {selectedClip.name}
                  </Text>
                  <Group grow wrap="nowrap">
                    <NumberInput
                      label="开始时间（秒）"
                      min={0}
                      max={86400}
                      step={0.1}
                      decimalScale={2}
                      value={rounded(selectedClip.start)}
                      disabled={context.readonly}
                      onChange={(value) =>
                        updateClip(selectedClip.id, selection.type as Lane, (clip) => ({
                          ...clip,
                          start: snapTime(numberValue(value), clip.id)
                        }))
                      }
                    />
                    <NumberInput
                      label="时长（秒）"
                      min={0.2}
                      max={21600}
                      step={0.1}
                      decimalScale={2}
                      value={rounded(selectedClip.duration)}
                      disabled={context.readonly}
                      onChange={(value) =>
                        updateClip(selectedClip.id, selection.type as Lane, (clip) => ({
                          ...clip,
                          duration: bounded(
                            numberValue(value, clip.duration),
                            0.2,
                            clip.kind === 'image'
                              ? 21600
                              : Math.max(0.2, (clip.sourceDuration - clip.sourceIn) / clip.rate)
                          )
                        }))
                      }
                    />
                  </Group>
                  {selectedClip.kind !== 'image' && (
                    <>
                      <Group grow wrap="nowrap">
                        <NumberInput
                          label="源文件起点（秒）"
                          min={0}
                          max={selectedClip.sourceDuration - 0.2}
                          step={0.1}
                          decimalScale={2}
                          value={rounded(selectedClip.sourceIn)}
                          disabled={context.readonly}
                          onChange={(value) =>
                            updateClip(selectedClip.id, selection.type as Lane, (clip) => {
                              const sourceIn = bounded(
                                numberValue(value),
                                0,
                                clip.sourceDuration - 0.2
                              )
                              return {
                                ...clip,
                                sourceIn,
                                duration: Math.min(
                                  clip.duration,
                                  (clip.sourceDuration - sourceIn) / clip.rate
                                )
                              }
                            })
                          }
                        />
                        <NumberInput
                          label="速度"
                          min={0.25}
                          max={4}
                          step={0.05}
                          decimalScale={2}
                          value={selectedClip.rate}
                          disabled={context.readonly}
                          onChange={(value) =>
                            updateClip(selectedClip.id, selection.type as Lane, (clip) => {
                              const rate = bounded(numberValue(value, 1), 0.25, 4)
                              return {
                                ...clip,
                                rate,
                                duration: Math.min(
                                  clip.duration,
                                  (clip.sourceDuration - clip.sourceIn) / rate
                                )
                              }
                            })
                          }
                        />
                      </Group>
                      <Text size="xs" c="dimmed">
                        源文件 {formatTime(selectedClip.sourceDuration)}；画面和声音片段可分别调整。
                      </Text>
                    </>
                  )}
                  {selection.type === 'sound' && (
                    <>
                      <Text size="xs" fw={600}>
                        片段音量 · {Math.round(selectedClip.gain * 100)}%
                      </Text>
                      <Slider
                        min={0}
                        max={1}
                        step={0.01}
                        value={selectedClip.gain}
                        disabled={context.readonly}
                        onChange={(value) =>
                          updateClip(selectedClip.id, 'sound', (clip) => ({ ...clip, gain: value }))
                        }
                      />
                    </>
                  )}
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
                      onClick={removeSelection}
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
                    <NumberInput
                      label="开始时间（秒）"
                      min={0}
                      step={0.1}
                      decimalScale={2}
                      value={selectedCaption.start}
                      disabled={context.readonly}
                      onChange={(value) =>
                        change({
                          ...doc,
                          captions: doc.captions.map((cue) =>
                            cue.id === selectedCaption.id
                              ? { ...cue, start: snapTime(numberValue(value), cue.id) }
                              : cue
                          )
                        })
                      }
                    />
                    <NumberInput
                      label="持续时长（秒）"
                      min={0.2}
                      step={0.1}
                      decimalScale={2}
                      value={selectedCaption.duration}
                      disabled={context.readonly}
                      onChange={(value) =>
                        change({
                          ...doc,
                          captions: doc.captions.map((cue) =>
                            cue.id === selectedCaption.id
                              ? {
                                  ...cue,
                                  duration: bounded(numberValue(value, cue.duration), 0.2, 21600)
                                }
                              : cue
                          )
                        })
                      }
                    />
                  </Group>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red"
                    leftSection={<IconTrash size={14} />}
                    disabled={context.readonly}
                    onClick={removeSelection}
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
                  <NumberInput
                    label="时间（秒）"
                    min={0}
                    value={selectedMarker.time}
                    disabled={context.readonly}
                    onChange={(value) =>
                      change({
                        ...doc,
                        markers: doc.markers.map((marker) =>
                          marker.id === selectedMarker.id
                            ? { ...marker, time: rounded(numberValue(value)) }
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
                    onClick={removeSelection}
                  >
                    删除标记
                  </Button>
                </>
              ) : (
                <>
                  <Text size="xs" c="dimmed">
                    画面轨、声音轨和字幕轨保存在同一份视频制作文件中。
                  </Text>
                  <Select
                    label="画面比例"
                    value={`${doc.width}x${doc.height}`}
                    data={[
                      { value: '1280x720', label: '横屏 16:9' },
                      { value: '720x1280', label: '竖屏 9:16' },
                      { value: '1080x1080', label: '正方形 1:1' }
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
                      change({ ...doc, fps: bounded(numberValue(value, 30), 1, 60) })
                    }
                  />
                  <Divider />
                  <Text size="xs" c="dimmed">
                    拖动片段可移动位置；拖动两端可裁切。靠近播放头、标记或其他片段边缘时会吸附。
                  </Text>
                  <Text size="xs" c="dimmed">
                    成片由本机 FFmpeg 输出为 H.264／AAC MP4；标记只辅助剪辑，不延长成片。
                  </Text>
                </>
              )}
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
            void addAsset(asset, asset.kind === 'video' ? videoAddMode : 'default')
          }
          onPreview={(asset) => setPreviewPath(asset.path)}
          onDragStart={(asset, event) =>
            event.dataTransfer.setData('application/x-omnigallery-editor-asset', asset.path)
          }
          onAdd={() => setPickerOpen(true)}
        />
      </div>
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
          <Text size="sm" c="dimmed">
            {doc.width} × {doc.height} · {doc.fps} fps · {formatTime(timelineEnd(doc))}
            。画面按时间叠放，声音轨混音，字幕烧录到画面。
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
              正在本机渲染视频；此过程可能需要一些时间。
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
