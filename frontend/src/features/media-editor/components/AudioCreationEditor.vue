<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import {
  CloseOutlined,
  PlusOutlined,
  ScissorOutlined,
  UndoOutlined,
  RedoOutlined,
  PlayCircleOutlined,
  PauseOutlined,
  StepBackwardOutlined,
  MoreOutlined,
  SoundOutlined,
  LockOutlined,
  UnlockOutlined,
  CustomerServiceOutlined,
  ExpandOutlined,
  DownloadOutlined,
  FontSizeOutlined,
  UploadOutlined,
  FlagOutlined
} from '@ant-design/icons-vue'
import WorkspaceMaterialShelf from '@/features/workspaces/components/WorkspaceMaterialShelf.vue'
import WorkspaceAssetPreview from '@/features/workspaces/components/WorkspaceAssetPreview.vue'
import MediaLibraryPicker from '@/features/media-library/components/MediaLibraryPicker.vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { WorkspaceAsset } from '@/features/workspaces/model/workspaceModel'
import type { ProductionDraft, WorkspaceWork } from '@/features/workspaces/model/workspaceWorks'
import {
  assertProductionDraftExists,
  createWorkspaceWorksRepository
} from '@/features/workspaces/model/workspaceWorks'
import {
  ensureWorkspaceStorage,
  saveWorkspaceState,
  workspaceStorage
} from '@/features/workspaces/services/workspaceStorage'
import type {
  MaterialController,
  MaterialClickMode
} from '@/features/workspaces/model/workspaceMaterials'
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { sha256Hex } from '@/shared/lib/sha256'
import EditorHelpButton from '@/shared/components/EditorHelpButton.vue'
import { apiBase } from '@/shared/api/httpClient'
import { getAudioSource, exportAudio, type AudioSourceInfo } from '../api/audioStudio'
import {
  audioTimelineKey,
  audioLimits,
  clipRate,
  audibleTracks,
  cloneTimeline,
  createAudioClip,
  createAudioTimeline,
  createAudioTrack,
  readAudioTimeline,
  sampleTime,
  setClipFades,
  setClipRate,
  splitClip,
  timelineDuration,
  trimClip,
  type AudioClip,
  type AudioTimelineDocument,
  type AudioTrack,
  type AudioMarker
} from '../model/audioTimeline'
import { useAudioTransport } from '../composables/useAudioTransport'
import AudioWaveform from './AudioWaveform.vue'
import AudioTextTrackRow from './AudioTextTrackRow.vue'
import AudioLevelMeter from './AudioLevelMeter.vue'
import { timelineSnapPoints, snapSpanStart, snapTime } from '../model/audioSnap'
import { levelLabel } from '../model/audioLevels'
import {
  activeTextCues,
  createTextCue,
  createTextTrack,
  decodeTextFile,
  parseTextTrack,
  serializeTextTrack,
  splitTextCue,
  textLimits,
  textTime,
  type TextCue,
  type TextTrack,
  type TextFormat
} from '../model/textTimeline'
import '@/features/image-editor/styles/studioEditorShell.css'

const props = defineProps<{
  workspaceId: string
  workspaceName: string
  work: WorkspaceWork
  draft: ProductionDraft
  assets: WorkspaceAsset[]
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
}>()
const emit = defineEmits<{ closed: []; artifactSaved: []; imported: [files: FileNodeInfo[]] }>()
const shell = ref<HTMLElement>(),
  scroller = ref<HTMLElement>()
const doc = ref<AudioTimelineDocument>(createAudioTimeline())
const ready = ref(false),
  loadError = ref(''),
  saveError = ref(''),
  saving = ref(false),
  exporting = ref(false)
const selectedTrackId = ref(''),
  selectedClipId = ref(''),
  panelOpen = ref(true)
const selectedTextTrackId = ref(''),
  selectedCueId = ref(''),
  editingCueId = ref(''),
  textInput = ref<HTMLInputElement>()
const textFormat = ref<'lrc' | 'srt' | 'vtt'>('srt'),
  textExportScope = ref<'all' | 'selection'>('all')
const importingText = ref(false)
const selectedMarkerId = ref(''),
  snapping = ref(true),
  snapGuide = ref<number>()
const markers = computed(() => [...(doc.value.markers ?? [])].sort((a, b) => a.time - b.time))
const selectedMarker = computed(() =>
  markers.value.find((marker) => marker.id === selectedMarkerId.value)
)
const exportPeak = ref<number | null | undefined>()
const sources = reactive<Record<string, AudioSourceInfo | undefined>>({})
const sourceErrors = reactive<Record<string, string>>({})
const loadingSources = reactive(new Set<string>())
const waveformErrors = reactive(new Set<string>())
const waveQueue: (() => Promise<void>)[] = []
let waveWorkers = 0
function queueWave(path: string) {
  waveQueue.push(async () => {
    try {
      const wave = await getAudioSource(props.workspaceId, path, true)
      if (!disposed) {
        sources[path] = wave
        waveformErrors.delete(path)
      }
    } catch {
      if (!disposed) waveformErrors.add(path)
    }
  })
  runWaveQueue()
}
function runWaveQueue() {
  if (disposed) {
    waveQueue.length = 0
    return
  }
  while (waveWorkers < 2 && waveQueue.length) {
    const task = waveQueue.shift()
    if (!task) break
    waveWorkers++
    void task().finally(() => {
      waveWorkers--
      runWaveQueue()
    })
  }
}
const pendingSources = new Map<string, Promise<AudioSourceInfo | undefined>>()
const history = ref<AudioTimelineDocument[]>([]),
  future = ref<AudioTimelineDocument[]>([])
const zoom = ref(18),
  scrollLeft = ref(0),
  viewportWidth = ref(700)
const selection = ref<{ start: number; end: number }>(),
  loop = ref(false)
const clickMode = ref<MaterialClickMode>('add'),
  preview = ref<FileNodeInfo>(),
  pickerOpen = ref(false)
const exportFormat = ref<'wav' | 'mp3'>('wav'),
  exportScope = ref<'all' | 'selection'>('all')
const exportName = ref(props.draft.name),
  outputId = ref('')
const transport = useAudioTransport(props.workspaceId)
const { time: playhead, playing, buffering, error: playbackError } = transport
const key = audioTimelineKey(props.workspaceId, props.draft.id)
let savedRaw: string | null = null,
  saveTimer: ReturnType<typeof setTimeout> | undefined
let savePromise: Promise<boolean> | undefined,
  disposed = false
let observer: ResizeObserver | undefined, restoreSurface: (() => void) | undefined
const selectedTrack = computed(() =>
  selectedTextTrackId.value
    ? undefined
    : doc.value.tracks.find((track) => track.id === selectedTrackId.value)
)
const textTracks = computed(() => doc.value.textTracks ?? [])
const selectedTextTrack = computed(() =>
  textTracks.value.find((track) => track.id === selectedTextTrackId.value)
)
const selectedCue = computed(() =>
  selectedTextTrack.value?.cues.find((cue) => cue.id === selectedCueId.value)
)
const currentText = computed(() => activeTextCues(textTracks.value, playhead.value))
const cueEditable = computed(
  () => editable.value && selectedCue.value && !selectedTextTrack.value?.locked
)
const selectedClip = computed(() =>
  selectedTrack.value?.clips.find((clip) => clip.id === selectedClipId.value)
)
const selectedSource = computed(() =>
  selectedClip.value ? sources[selectedClip.value.path] : undefined
)
const duration = computed(() => timelineDuration(doc.value))
const end = computed(() =>
  Math.max(
    60,
    duration.value + 5,
    playhead.value + 5,
    ...markers.value.map((marker) => marker.time + 5)
  )
)
const editable = computed(
  () => ready.value && !props.readonly && !loadError.value && !exporting.value
)
const clipEditable = computed(
  () => (editable.value && selectedClip.value && !selectedTrack.value?.locked) || cueEditable.value
)
const unavailable = computed(() =>
  [...new Set(doc.value.tracks.flatMap((track) => track.clips.map((clip) => clip.path)))].filter(
    (path) => sourceErrors[path]
  )
)
const clipCount = computed(() =>
  doc.value.tracks.reduce((sum, track) => sum + track.clips.length, 0)
)
const visibleStart = computed(() => scrollLeft.value / zoom.value)
const tickStep = computed(() =>
  zoom.value >= 80 ? 1 : zoom.value >= 24 ? 5 : zoom.value >= 8 ? 10 : 30
)
const ticks = computed(() => {
  const from = Math.floor(visibleStart.value / tickStep.value) * tickStep.value
  const to = Math.min(end.value, visibleStart.value + viewportWidth.value / zoom.value)
  return Array.from(
    { length: Math.max(0, Math.ceil((to - from) / tickStep.value) + 1) },
    (_, i) => from + i * tickStep.value
  )
})
function timeLabel(value: number, precise = false) {
  const minutes = Math.floor(value / 60),
    seconds = value % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(precise ? 2 : 0).padStart(precise ? 5 : 2, '0')}`
}
function enqueueSave() {
  if (!editable.value || disposed) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void flushSave(), 450)
}
async function flushSave(): Promise<boolean> {
  clearTimeout(saveTimer)
  // An uncommitted drag must never become the persisted document.
  if (gesture) return false
  if (!ready.value || props.readonly || loadError.value) return !loadError.value
  if (savePromise) {
    await savePromise
    return flushSave()
  }
  const raw = JSON.stringify(doc.value)
  if (raw === savedRaw) return true
  saving.value = true
  savePromise = (async () => {
    try {
      await saveWorkspaceState(props.workspaceId, (storage) => {
        assertProductionDraftExists(storage, props.workspaceId, props.draft.id)
        if (storage.getItem(key) !== savedRaw)
          throw new Error(
            '此制作文件已在其他窗口更新，本次修改尚未保存。请保留当前窗口并重新打开制作文件核对。'
          )
        storage.setItem(key, raw)
        const repository = createWorkspaceWorksRepository(props.workspaceId, storage)
        const state = repository.load(),
          stamp = new Date().toISOString()
        repository.save({
          ...state,
          works: state.works.map((work) =>
            work.id === props.work.id
              ? {
                  ...work,
                  updatedAt: stamp,
                  drafts: work.drafts.map((draft) =>
                    draft.id === props.draft.id ? { ...draft, updatedAt: stamp } : draft
                  )
                }
              : work
          )
        })
      })
      savedRaw = raw
      saveError.value = ''
      return true
    } catch (cause) {
      saveError.value = getErrorMessage(cause, '自动保存失败，请重试')
      return false
    } finally {
      saving.value = false
      savePromise = undefined
    }
  })()
  return savePromise
}
function commit(before: AudioTimelineDocument) {
  if (JSON.stringify(before) === JSON.stringify(doc.value)) {
    // A click or canceled movement may have paused an earlier pending save.
    enqueueSave()
    return
  }
  history.value = [...history.value.slice(-59), before]
  future.value = []
  transport.stop()
  transport.resetPeak()
  exportPeak.value = undefined
  enqueueSave()
}
function change(operation: () => void) {
  if (!editable.value || gesture) return
  const before = cloneTimeline(doc.value)
  operation()
  commit(before)
}
function restoreSelection() {
  if (!markers.value.some((marker) => marker.id === selectedMarkerId.value))
    selectedMarkerId.value = ''
  const cueTrack = textTracks.value.find((track) =>
    track.cues.some((cue) => cue.id === selectedCueId.value)
  )
  if (cueTrack) selectedTextTrackId.value = cueTrack.id
  else selectedCueId.value = ''
  if (!textTracks.value.some((track) => track.id === selectedTextTrackId.value))
    selectedTextTrackId.value = ''
  const clipTrack = doc.value.tracks.find((track) =>
    track.clips.some((clip) => clip.id === selectedClipId.value)
  )
  if (clipTrack) selectedTrackId.value = clipTrack.id
  else selectedClipId.value = ''
  if (!doc.value.tracks.some((track) => track.id === selectedTrackId.value))
    selectedTrackId.value = doc.value.tracks[0]?.id ?? ''
}
function undo(redo = false) {
  if (!editable.value || gesture) return
  const source = redo ? future : history,
    destination = redo ? history : future
  const next = source.value[source.value.length - 1]
  if (!next) return
  destination.value = [...destination.value, cloneTimeline(doc.value)]
  source.value = source.value.slice(0, -1)
  doc.value = cloneTimeline(next)
  restoreSelection()
  transport.stop()
  transport.resetPeak()
  exportPeak.value = undefined
  enqueueSave()
}
async function loadSource(path: string, refresh = false): Promise<AudioSourceInfo | undefined> {
  if (pendingSources.has(path)) return pendingSources.get(path)
  if (sources[path] && !refresh) return sources[path]
  const promise = (async () => {
    loadingSources.add(path)
    try {
      const metadata = await getAudioSource(props.workspaceId, path)
      if (disposed) return
      sources[path] = metadata
      delete sourceErrors[path]
      // The fast probe enables editing immediately; actual peaks arrive in the background.
      queueWave(path)
      return metadata
    } catch (cause) {
      if (!disposed) sourceErrors[path] = getErrorMessage(cause, '音频素材不可用')
    } finally {
      loadingSources.delete(path)
      pendingSources.delete(path)
    }
  })()
  pendingSources.set(path, promise)
  return promise
}
async function addAudio(
  asset: WorkspaceAsset,
  newTrack = false,
  at = playhead.value,
  trackId = selectedTrackId.value
) {
  if (!editable.value || (asset.kind !== 'audio' && asset.kind !== 'video')) return
  const sourceKind = asset.kind
  const info = await loadSource(asset.path)
  if (!info || !editable.value || disposed) {
    if (!info) message.error(sourceErrors[asset.path])
    return
  }
  let track = doc.value.tracks.find((track) => track.id === trackId)
  if (!newTrack && track?.locked) {
    message.warning('请先解锁音轨')
    return
  }
  if ((newTrack || !track) && doc.value.tracks.length >= 32) {
    message.warning('最多支持 32 条音轨')
    return
  }
  if (track && !newTrack && track.clips.length >= 256) {
    message.warning('每条音轨最多支持 256 个片段')
    return
  }
  if (at + info.duration > 86400) {
    message.warning('时间线最长为 24 小时')
    return
  }
  change(() => {
    if (newTrack || !track) {
      track = createAudioTrack(`声音 ${doc.value.tracks.length + 1}`)
      doc.value.tracks.push(track)
    }
    const clip = createAudioClip(asset.path, asset.name, info.duration, at, sourceKind)
    if (!track) return
    track.clips.push(clip)
    selectedMarkerId.value = ''
    selectedTextTrackId.value = ''
    selectedCueId.value = ''
    selectedTrackId.value = track.id
    selectedClipId.value = clip.id
  })
}
function selectText(track: TextTrack, cue?: TextCue) {
  selectedMarkerId.value = ''
  if (editingCueId.value !== cue?.id) editingCueId.value = ''
  selectedTextTrackId.value = track.id
  selectedCueId.value = cue?.id ?? ''
  selectedClipId.value = ''
  panelOpen.value = true
}
async function editCue(track: TextTrack, cue: TextCue) {
  selectText(track, cue)
  if (cue.duration * zoom.value < 80) zoomTimeline(80 / cue.duration)
  await nextTick()
  if (disposed || selectedCueId.value !== cue.id) return
  const row = Array.from(
    scroller.value?.querySelectorAll<HTMLElement>('[data-text-track-id]') ?? []
  ).find((element) => element.dataset.textTrackId === track.id)
  row?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  if (scroller.value) scroller.value.scrollLeft = Math.max(0, cue.start * zoom.value - 20)
  if (!track.locked && editable.value) {
    editingCueId.value = cue.id
  }
}
function finishCueEdit(id: string) {
  if (editingCueId.value === id) editingCueId.value = ''
}
function updateCueText(track: TextTrack, cue: TextCue, text: string) {
  const current = track.cues.find((item) => item.id === cue.id)
  if (!editable.value || track.locked || !current) return
  change(() => {
    current.text = text.slice(0, textLimits.text)
  })
}
function seekTextLane(event: PointerEvent, track: TextTrack) {
  transport.seek(snappedEventTime(event))
  selectText(track)
}
function addTextTrack() {
  if (textTracks.value.length >= textLimits.tracks) {
    message.warning('最多支持 8 条文字轨')
    return
  }
  change(() => {
    const track = createTextTrack(`文字 ${textTracks.value.length + 1}`)
    ;(doc.value.textTracks ??= []).push(track)
    selectText(track)
  })
}
function addCue(track = selectedTextTrack.value, event?: MouseEvent) {
  if (!editable.value || gesture || !track || track.locked || track.cues.length >= textLimits.cues)
    return
  const at = textTime(event ? eventTime(event) : playhead.value)
  if (at >= 86400) return
  const cue = createTextCue('请输入文字', at, Math.min(3, 86400 - at))
  change(() => {
    track.cues.push(cue)
    selectText(track, cue)
  })
  void editCue(track, cue)
}
function updateTextTrack(
  field: 'name' | 'visible' | 'locked',
  value: string | boolean,
  track = selectedTextTrack.value
) {
  if (!track || (track.locked && field !== 'locked')) return
  change(() =>
    Object.assign(track, {
      [field]: field === 'name' ? String(value).trim().slice(0, 120) || '文字轨' : value
    })
  )
}
function updateCue(field: 'start' | 'duration' | 'text', value: string | number) {
  const cue = selectedCue.value
  if (!cue || !cueEditable.value || (typeof value === 'number' && !Number.isFinite(value))) return
  change(() => {
    if (field === 'text') cue.text = String(value).slice(0, textLimits.text)
    if (field === 'start')
      cue.start = textTime(Math.max(0, Math.min(Number(value), 86400 - cue.duration)))
    if (field === 'duration')
      cue.duration = textTime(Math.max(0.001, Math.min(Number(value), 86400 - cue.start)))
  })
}
function deleteCue() {
  const track = selectedTextTrack.value
  if (!track || !cueEditable.value) return
  change(() => {
    track.cues = track.cues.filter((cue) => cue.id !== selectedCueId.value)
    selectedCueId.value = ''
  })
}
function duplicateCue() {
  const track = selectedTextTrack.value,
    cue = selectedCue.value
  if (
    !track ||
    !cue ||
    !cueEditable.value ||
    track.cues.length >= textLimits.cues ||
    cue.start + cue.duration * 2 > 86400
  )
    return
  change(() => {
    const copy = { ...cue, id: crypto.randomUUID(), start: textTime(cue.start + cue.duration) }
    track.cues.push(copy)
    selectText(track, copy)
  })
}
function splitCue() {
  const track = selectedTextTrack.value,
    cue = selectedCue.value
  if (!track || !cue || !cueEditable.value || track.cues.length >= textLimits.cues) return
  const parts = splitTextCue(cue, playhead.value)
  if (!parts) {
    message.info('请把播放头移到文字片段内再分割')
    return
  }
  change(() => {
    track.cues.splice(track.cues.indexOf(cue), 1, ...parts)
    selectText(track, parts[1])
  })
}
function moveCueTo(id: string) {
  const from = selectedTextTrack.value,
    cue = selectedCue.value,
    to = textTracks.value.find((track) => track.id === id)
  if (
    !from ||
    !cue ||
    !to ||
    to === from ||
    to.locked ||
    !cueEditable.value ||
    to.cues.length >= textLimits.cues
  )
    return
  change(() => {
    from.cues = from.cues.filter((item) => item.id !== cue.id)
    to.cues.push(cue)
    selectText(to, cue)
  })
}
function removeTextTrack() {
  const track = selectedTextTrack.value
  if (!track || track.locked || track.cues.length) return
  change(() => {
    doc.value.textTracks = textTracks.value.filter((item) => item.id !== track.id)
    selectedTextTrackId.value = ''
    selectedCueId.value = ''
  })
}
async function importText(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file || !editable.value || importingText.value) return
  importingText.value = true
  try {
    if (file.size > textLimits.fileBytes) throw new Error('文字文件最大为 2 MB')
    const parts = file.name.split('.')
    const format = parts[parts.length - 1]?.toLowerCase() as TextFormat
    if (!['lrc', 'srt', 'vtt', 'txt'].includes(format))
      throw new Error('请选择 LRC、SRT、VTT 或 TXT 文件')
    const cues = parseTextTrack(decodeTextFile(await file.arrayBuffer()), format, {
      duration: duration.value,
      start: playhead.value
    })
    if (disposed || !editable.value) return
    if (textTracks.value.length >= textLimits.tracks)
      throw new Error('最多支持 8 条文字轨，请先移除空轨')
    change(() => {
      const track = createTextTrack(file.name.replace(/\.[^.]+$/, '').slice(0, 120))
      track.cues = cues
      ;(doc.value.textTracks ??= []).push(track)
      selectText(track, cues[0])
    })
    transport.seek(cues[0].start)
    message.success(
      `已导入 ${cues.length} 个文字片段${format === 'txt' ? '，每行暂设 3 秒，可继续调整' : ''}`
    )
  } catch (cause) {
    message.error(getErrorMessage(cause, '文字导入失败'))
  } finally {
    importingText.value = false
  }
}
async function downloadText() {
  const track = selectedTextTrack.value
  if (!track || (textExportScope.value === 'selection' && !selection.value)) return
  if (!(await flushSave())) {
    message.error(saveError.value || loadError.value)
    return
  }
  try {
    const content = serializeTextTrack(
      track,
      textFormat.value,
      textExportScope.value === 'selection' ? selection.value : undefined
    )
    const url = URL.createObjectURL(
      new Blob([content], {
        type: textFormat.value === 'vtt' ? 'text/vtt;charset=utf-8' : 'text/plain;charset=utf-8'
      })
    )
    const link = document.createElement('a')
    link.href = url
    link.download = `${track.name.replace(/[\\/:*?"<>|]/g, '_')}.${textFormat.value}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    message.success('文字轨已下载')
  } catch (cause) {
    message.error(getErrorMessage(cause, '文字导出失败'))
  }
}
function showTextMenu(event: MouseEvent, track: TextTrack, cue?: TextCue) {
  showMenu(event, 'blank')
  selectText(track, cue)
  if (menu.value) menu.value.target = cue ? 'text-cue' : 'text-track'
}
function dragCue(
  event: PointerEvent,
  track: TextTrack,
  cue: TextCue,
  mode: 'move' | 'left' | 'right'
) {
  if (event.button !== 0) return
  selectText(track, cue)
  if (!editable.value || track.locked || gesture) return
  event.preventDefault()
  event.stopPropagation()
  transport.stop()
  menu.value = undefined
  clearTimeout(saveTimer)
  const before = cloneTimeline(doc.value),
    original = { ...cue },
    origin = event.clientX,
    points = timelineSnapPoints(before, playhead.value, cue.id)
  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  const move = (ev: PointerEvent) => {
    const delta = textTime((ev.clientX - origin) / zoom.value)
    if (mode === 'move') {
      const result = snapSpanStart(
        original.start + delta,
        original.duration,
        points,
        snapping.value && !ev.shiftKey ? 8 / zoom.value : -1
      )
      snapGuide.value = result.anchor
      cue.start = textTime(result.time)
    }
    if (mode === 'left') {
      const result = snapTime(
        original.start + delta,
        points,
        snapping.value && !ev.shiftKey ? 8 / zoom.value : -1,
        0,
        original.start + original.duration - 0.001
      )
      snapGuide.value = result.anchor
      const left = result.time
      cue.start = textTime(left)
      cue.duration = textTime(original.start + original.duration - left)
    }
    if (mode === 'right') {
      const result = snapTime(
        original.start + original.duration + delta,
        points,
        snapping.value && !ev.shiftKey ? 8 / zoom.value : -1,
        original.start + 0.001,
        86400
      )
      snapGuide.value = result.anchor
      cue.duration = textTime(result.time - original.start)
    }
  }
  const cleanup = () => {
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    gesture = undefined
    snapGuide.value = undefined
  }
  const cancel = () => {
    cleanup()
    doc.value = before
    restoreSelection()
    enqueueSave()
  }
  const up = (ev: PointerEvent) => {
    if (mode === 'move') {
      const id = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-text-track-id]')?.dataset.textTrackId
      const target = textTracks.value.find((item) => item.id === id)
      if (target && target !== track && !target.locked && target.cues.length < textLimits.cues) {
        track.cues = track.cues.filter((item) => item.id !== cue.id)
        target.cues.push(cue)
        selectText(target, cue)
      }
    }
    cleanup()
    commit(before)
  }
  gesture = { before, target: element, cancel }
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', cancel)
}
function addTrack() {
  if (doc.value.tracks.length >= 32) return
  change(() => {
    const track = createAudioTrack(`声音 ${doc.value.tracks.length + 1}`)
    doc.value.tracks.push(track)
    selectedMarkerId.value = ''
    selectedTextTrackId.value = ''
    selectedCueId.value = ''
    selectedTrackId.value = track.id
    selectedClipId.value = ''
  })
}
function selectClip(track: AudioTrack, clip: AudioClip) {
  selectedMarkerId.value = ''
  selectedTextTrackId.value = ''
  selectedCueId.value = ''
  selectedTrackId.value = track.id
  selectedClipId.value = clip.id
}
function selectTrack(track: AudioTrack) {
  selectedMarkerId.value = ''
  selectedTextTrackId.value = ''
  selectedCueId.value = ''
  selectedTrackId.value = track.id
  selectedClipId.value = ''
}
function seekLane(event: PointerEvent, track: AudioTrack) {
  transport.seek(snappedEventTime(event))
  selectTrack(track)
}
function clearRange() {
  selection.value = undefined
  loop.value = false
}
function importPicked(files: FileNodeInfo[]) {
  emit('imported', files)
  pickerOpen.value = false
}
function preserveAndClose() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(doc.value, null, 2)], { type: 'application/json' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `${props.draft.name}-未保存副本.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  emit('closed')
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (ready.value && !props.readonly && JSON.stringify(doc.value) !== savedRaw) {
    event.preventDefault()
    event.returnValue = ''
  }
}
function updateTrack(
  field: 'name' | 'gain' | 'muted' | 'solo' | 'locked',
  value: string | number | boolean,
  target = selectedTrack.value
) {
  if (!target || (target.locked && field !== 'locked')) return
  if (typeof value === 'number' && !Number.isFinite(value)) return
  change(() => {
    Object.assign(target, {
      [field]: field === 'name' ? String(value).trim().slice(0, 120) || '音轨' : value
    })
  })
}
function updateClip(
  field: 'start' | 'sourceIn' | 'duration' | 'gain' | 'fadeIn' | 'fadeOut',
  value: number
) {
  const clip = selectedClip.value
  if (!clipEditable.value || !clip || !Number.isFinite(value)) return
  const rate = clipRate(clip)
  const source = sources[clip.path]?.duration ?? clip.sourceIn + clip.duration * rate
  change(() => {
    if (field === 'start')
      clip.start = sampleTime(Math.max(0, Math.min(value, 86400 - clip.duration)))
    if (field === 'gain') clip.gain = Math.max(0, Math.min(value, 4))
    if (field === 'sourceIn') {
      // Moving the source range resets fades to the current clip's range.
      clip.sourceIn = sampleTime(Math.max(0, Math.min(value, source - clip.duration * rate)))
      Object.assign(clip, setClipFades(clip, clip.fadeIn, clip.fadeOut))
    }
    if (field === 'duration') {
      clip.duration = sampleTime(
        Math.max(1 / 48000, Math.min(value, (source - clip.sourceIn) / rate, 86400 - clip.start))
      )
      Object.assign(clip, setClipFades(clip, clip.fadeIn, clip.fadeOut))
    }
    if (field === 'fadeIn' || field === 'fadeOut')
      Object.assign(
        clip,
        setClipFades(
          clip,
          field === 'fadeIn' ? value : clip.fadeIn,
          field === 'fadeOut' ? value : clip.fadeOut
        )
      )
  })
}
function updateRate(event: Event) {
  const clip = selectedClip.value
  if (!clip || !clipEditable.value) return
  const input = event.target as HTMLInputElement
  const value = Number(input.value)
  try {
    const next = setClipRate(clip, value)
    change(() => Object.assign(clip, next))
  } catch (cause) {
    message.warning(getErrorMessage(cause, '无法调整变速'))
  }
  input.value = String(clipRate(clip))
}
function updatePitch(value: boolean) {
  const clip = selectedClip.value
  if (clip && clipEditable.value)
    change(() => {
      clip.preservePitch = value
    })
}
function selectMarker(marker: AudioMarker, reveal = true) {
  editingCueId.value = ''
  selectedMarkerId.value = marker.id
  selectedClipId.value = selectedCueId.value = selectedTextTrackId.value = ''
  selectedTrackId.value = ''
  panelOpen.value = true
  transport.seek(marker.time)
  if (reveal && scroller.value)
    scroller.value.scrollLeft = Math.max(0, marker.time * zoom.value - viewportWidth.value / 2)
}
async function addMarker() {
  if (!editable.value || gesture || markers.value.length >= audioLimits.markers) return
  change(() => {
    const marker = {
      id: crypto.randomUUID(),
      name: `标记 ${markers.value.length + 1}`,
      time: sampleTime(playhead.value)
    }
    ;(doc.value.markers ??= []).push(marker)
    selectMarker(marker)
  })
  await nextTick()
  const input = shell.value?.querySelector<HTMLInputElement>('[data-marker-name]')
  input?.focus()
  input?.select()
}
function updateMarker(field: 'time' | 'name', value: number | string) {
  const marker = selectedMarker.value
  if (!marker || (typeof value === 'number' && !Number.isFinite(value))) return
  change(() => {
    if (field === 'time') marker.time = sampleTime(Math.max(0, Math.min(86400, Number(value))))
    else marker.name = String(value).trim().slice(0, 120) || '标记'
  })
}
function deleteMarker() {
  if (!selectedMarker.value) return
  change(() => {
    doc.value.markers = markers.value.filter((marker) => marker.id !== selectedMarkerId.value)
    selectedMarkerId.value = ''
  })
}
function dragMarker(event: PointerEvent, marker: AudioMarker) {
  if (event.button !== 0) return
  selectMarker(marker, false)
  if (!editable.value || gesture) return
  event.preventDefault()
  event.stopPropagation()
  clearTimeout(saveTimer)
  const before = cloneTimeline(doc.value),
    origin = event.clientX,
    initial = marker.time,
    points = timelineSnapPoints(before, playhead.value, marker.id),
    element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  const move = (ev: PointerEvent) => {
    const result = snapTime(
      initial + (ev.clientX - origin) / zoom.value,
      points,
      snapping.value && !ev.shiftKey ? 8 / zoom.value : -1
    )
    marker.time = sampleTime(result.time)
    snapGuide.value = result.anchor
  }
  const cleanup = () => {
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', up)
    element.removeEventListener('pointercancel', cancel)
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    gesture = undefined
    snapGuide.value = undefined
  }
  const cancel = () => {
    cleanup()
    doc.value = before
    restoreSelection()
    enqueueSave()
  }
  const up = () => {
    cleanup()
    transport.seek(marker.time)
    commit(before)
  }
  gesture = { before, target: element, cancel }
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', up)
  element.addEventListener('pointercancel', cancel)
}
function deleteClip() {
  if (selectedCue.value) return deleteCue()
  const track = selectedTrack.value
  if (!clipEditable.value || !track) return
  change(() => {
    track.clips = track.clips.filter((clip) => clip.id !== selectedClipId.value)
    selectedClipId.value = ''
  })
}
function duplicateClip() {
  if (selectedCue.value) return duplicateCue()
  const clip = selectedClip.value,
    track = selectedTrack.value
  if (
    !clipEditable.value ||
    !clip ||
    !track ||
    track.clips.length >= 256 ||
    clip.start + clip.duration * 2 > 86400
  )
    return
  change(() => {
    const copy = { ...clip, id: crypto.randomUUID(), start: sampleTime(clip.start + clip.duration) }
    track.clips.push(copy)
    selectedClipId.value = copy.id
  })
}
function splitSelected() {
  if (selectedCue.value) return splitCue()
  const clip = selectedClip.value,
    track = selectedTrack.value
  if (!clipEditable.value || !clip || !track || track.clips.length >= 256) return
  const result = splitClip(clip, playhead.value)
  if (!result) {
    message.info('请把播放头移到片段内再分割')
    return
  }
  change(() => {
    track.clips.splice(track.clips.indexOf(clip), 1, ...result)
    selectedClipId.value = result[1].id
  })
}
function moveClipTo(trackId: string) {
  const from = selectedTrack.value,
    target = doc.value.tracks.find((track) => track.id === trackId),
    clip = selectedClip.value
  if (
    !clipEditable.value ||
    !clip ||
    !from ||
    !target ||
    target.locked ||
    target === from ||
    target.clips.length >= 256
  )
    return
  change(() => {
    from.clips = from.clips.filter((item) => item.id !== clip.id)
    target.clips.push(clip)
    selectedTrackId.value = target.id
  })
}
function removeTrack() {
  const track = selectedTrack.value
  if (!track || track.locked || track.clips.length) {
    message.info('请先删除音轨内的片段')
    return
  }
  change(() => {
    doc.value.tracks = doc.value.tracks.filter((item) => item.id !== track.id)
    selectedTrackId.value = doc.value.tracks[0]?.id ?? ''
  })
}
function zoomTimeline(value: number) {
  const previous = zoom.value
  zoom.value = Math.max(2, Math.min(value, 240))
  if (scroller.value) scroller.value.scrollLeft = (scrollLeft.value / previous) * zoom.value
}
function fitTimeline() {
  zoomTimeline((viewportWidth.value - 40) / Math.max(duration.value + 3, 30))
  if (scroller.value) scroller.value.scrollLeft = 0
}
function eventTime(event: MouseEvent) {
  const scroll = scroller.value
  if (!scroll) return 0
  const bounds = scroll.getBoundingClientRect()
  return sampleTime(
    Math.max(
      0,
      Math.min(86400, (event.clientX - bounds.left + scroll.scrollLeft - 136) / zoom.value)
    )
  )
}
function snappedEventTime(event: MouseEvent) {
  const result = snapTime(
    eventTime(event),
    timelineSnapPoints(doc.value),
    snapping.value && !event.shiftKey ? 8 / zoom.value : -1
  )
  return sampleTime(result.time)
}
let gesture: { before: AudioTimelineDocument; target: HTMLElement; cancel: () => void } | undefined
function dragClip(
  event: PointerEvent,
  track: AudioTrack,
  clip: AudioClip,
  mode: 'move' | 'left' | 'right' = 'move'
) {
  if (event.button !== 0) return
  selectClip(track, clip)
  if (!editable.value || track.locked || gesture) return
  event.preventDefault()
  event.stopPropagation()
  transport.stop()
  menu.value = undefined
  clearTimeout(saveTimer)
  const before = cloneTimeline(doc.value),
    original = { ...clip },
    origin = event.clientX,
    points = timelineSnapPoints(before, playhead.value, clip.id)
  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  const onMove = (ev: PointerEvent) => {
    const delta = sampleTime((ev.clientX - origin) / zoom.value)
    const tolerance = snapping.value && !ev.shiftKey ? 8 / zoom.value : -1
    if (mode === 'move') {
      const result = snapSpanStart(original.start + delta, original.duration, points, tolerance)
      snapGuide.value = result.anchor
      clip.start = sampleTime(result.time)
    }
    if (mode === 'left') {
      const result = snapTime(
        original.start + delta,
        points,
        tolerance,
        original.start,
        original.start + original.duration - 0.01
      )
      snapGuide.value = result.anchor
      Object.assign(clip, trimClip(original, result.time - original.start, original.duration))
    }
    if (mode === 'right') {
      const result = snapTime(
        original.start + original.duration + delta,
        points,
        tolerance,
        original.start + 0.01,
        original.start + original.duration
      )
      snapGuide.value = result.anchor
      Object.assign(clip, trimClip(original, 0, result.time - original.start))
    }
  }
  const cleanup = () => {
    element.removeEventListener('pointermove', onMove)
    element.removeEventListener('pointerup', onUp)
    element.removeEventListener('pointercancel', cancel)
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    gesture = undefined
    snapGuide.value = undefined
  }
  const cancel = () => {
    cleanup()
    doc.value = before
    restoreSelection()
    enqueueSave()
  }
  const onUp = (ev: PointerEvent) => {
    if (mode === 'move') {
      const targetId = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId
      const target = doc.value.tracks.find((item) => item.id === targetId)
      if (target && target !== track && !target.locked && target.clips.length < 256) {
        track.clips = track.clips.filter((item) => item.id !== clip.id)
        target.clips.push(clip)
        selectedTrackId.value = target.id
      }
    }
    cleanup()
    commit(before)
  }
  gesture = { before, target: element, cancel }
  element.addEventListener('pointermove', onMove)
  element.addEventListener('pointerup', onUp)
  element.addEventListener('pointercancel', cancel)
}
function selectRange(event: PointerEvent) {
  if (event.button !== 0) return
  const start = snappedEventTime(event),
    element = event.currentTarget as HTMLElement
  transport.seek(start)
  selection.value = undefined
  menu.value = undefined
  element.setPointerCapture(event.pointerId)
  const move = (ev: PointerEvent) => {
    const current = snappedEventTime(ev)
    if (Math.abs(current - start) > 0.05)
      selection.value = { start: Math.min(start, current), end: Math.max(start, current) }
  }
  const end = () => {
    element.removeEventListener('pointermove', move)
    element.removeEventListener('pointerup', end)
    element.removeEventListener('pointercancel', end)
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
  }
  element.addEventListener('pointermove', move)
  element.addEventListener('pointerup', end)
  element.addEventListener('pointercancel', end)
}
function togglePlay() {
  if (playing.value) {
    transport.stop()
    return
  }
  if (!duration.value || unavailable.value.length) return
  const range = loop.value ? selection.value : undefined
  const start = range?.start ?? (playhead.value >= duration.value ? 0 : playhead.value)
  void transport.play(doc.value, start, range?.end ?? duration.value, range?.start)
}
watch(playhead, (value) => {
  if (!playing.value || !scroller.value) return
  const x = value * zoom.value
  if (x > scrollLeft.value + viewportWidth.value - 180)
    scroller.value.scrollLeft = Math.max(0, x - viewportWidth.value / 3)
})
const menu = ref<{
  x: number
  y: number
  target: 'clip' | 'track' | 'blank' | 'text-cue' | 'text-track'
}>()
function showMenu(
  event: MouseEvent,
  target: 'clip' | 'track' | 'blank',
  track?: AudioTrack,
  clip?: AudioClip
) {
  event.preventDefault()
  event.stopPropagation()
  if (track) selectTrack(track)
  if (clip && track) selectClip(track, clip)
  else selectedClipId.value = ''
  const anchor = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect()
  const keyboardOrigin = event.clientX === 0 && event.clientY === 0
  menu.value = {
    x: Math.max(
      8,
      Math.min(keyboardOrigin ? (anchor?.left ?? 8) : event.clientX, window.innerWidth - 195)
    ),
    y: Math.max(
      8,
      Math.min(keyboardOrigin ? (anchor?.bottom ?? 8) : event.clientY, window.innerHeight - 230)
    ),
    target
  }
  void nextTick(() =>
    shell.value?.querySelector<HTMLElement>('.audio-menu button:not(:disabled)')?.focus()
  )
}
function menuAction(action: () => void) {
  menu.value = undefined
  action()
}
const materialController = computed<MaterialController>(() => ({
  assets: props.assets.filter((asset) => asset.kind === 'audio' || asset.kind === 'video'),
  roles: Object.fromEntries(
    doc.value.tracks.flatMap((track) => track.clips.map((clip) => [clip.path, '已使用']))
  ),
  activePath: selectedClip.value?.path ?? '',
  recentPaths: [],
  clickMode: clickMode.value,
  clickOptions: [
    { value: 'view', label: '查看', title: '预览源音频或视频' },
    { value: 'add', label: '添加', title: '在播放头处添加音频片段' }
  ],
  setClickMode: (mode) => {
    clickMode.value = mode
  },
  select: (asset) => {
    if (clickMode.value === 'view') preview.value = props.assetInfo[asset.path]
    else void addAudio(asset)
  },
  actions: (asset) => [
    {
      key: 'add',
      label: asset.kind === 'video' ? '视频声音添加到当前音轨' : '添加到当前音轨',
      disabled: !editable.value || selectedTrack.value?.locked
    },
    {
      key: 'new-track',
      label: asset.kind === 'video' ? '视频声音添加到新音轨' : '添加到新音轨',
      disabled: !editable.value || doc.value.tracks.length >= 32
    }
  ],
  runAction: (asset, action) => {
    if (action === 'add' || action === 'new-track') void addAudio(asset, action === 'new-track')
  }
}))
function dropAudio(event: DragEvent, track: AudioTrack) {
  event.preventDefault()
  const path = event.dataTransfer?.getData('text/plain')
  const asset = props.assets.find(
    (asset) => asset.path === path && (asset.kind === 'audio' || asset.kind === 'video')
  )
  if (asset) void addAudio(asset, false, snappedEventTime(event), track.id)
}
async function exportProduct() {
  if (
    !editable.value ||
    !clipCount.value ||
    !duration.value ||
    unavailable.value.length ||
    !exportName.value.trim()
  )
    return
  gesture?.cancel()
  exporting.value = true
  transport.stop()
  try {
    const paths = [
      ...new Set(doc.value.tracks.flatMap((track) => track.clips.map((clip) => clip.path)))
    ]
    await Promise.all(paths.map((path) => loadSource(path, true)))
    if (unavailable.value.length || !(await flushSave())) return
    const snapshot = cloneTimeline(doc.value)
    const range =
      exportScope.value === 'selection' ? selection.value : { start: 0, end: duration.value }
    if (!range || range.end <= range.start) return
    const revision = sha256Hex(JSON.stringify(snapshot))
    const artifact = await exportAudio(
      props.workspaceId,
      props.draft.id,
      revision,
      snapshot,
      exportName.value.trim(),
      exportFormat.value,
      range.start,
      range.end - range.start
    )
    outputId.value = artifact.id
    exportPeak.value = artifact.mix_peak_dbfs
    emit('artifactSaved')
    message.success('音频已导出到工作区产物，可下载或继续用于其他制作文件')
    if (artifact.mix_peak_dbfs !== null && artifact.mix_peak_dbfs >= 0)
      message.warning(
        `混音峰值 ${levelLabel(artifact.mix_peak_dbfs)}，已达到或超过上限；建议降低音量后重新导出`
      )
  } catch (cause) {
    message.error(getErrorMessage(cause, '音频导出失败'))
  } finally {
    exporting.value = false
  }
}
async function close() {
  if (exporting.value) return
  gesture?.cancel()
  transport.stop()
  if (!(await flushSave())) {
    message.error(saveError.value || loadError.value)
    return
  }
  emit('closed')
}
function keyboard(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('input,textarea,select,[contenteditable=true],[role=dialog]')) return
  if (!menu.value && target?.closest('[role=menu]')) return
  if (event.key === 'Escape') {
    if (gesture) gesture.cancel()
    else if (menu.value) menu.value = undefined
    else void close()
    event.preventDefault()
    return
  }
  if (menu.value && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    const items = [
      ...(shell.value?.querySelectorAll<HTMLElement>('.audio-menu button:not(:disabled)') ?? [])
    ]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
    event.preventDefault()
    return
  }
  if (menu.value) return
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault()
      undo(event.shiftKey)
    }
    if (event.key.toLowerCase() === 'y') {
      event.preventDefault()
      undo(true)
    }
    return
  }
  if (event.code === 'Space') {
    event.preventDefault()
    togglePlay()
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault()
    if (selectedMarker.value) deleteMarker()
    else deleteClip()
  }
  if (event.key.toLowerCase() === 's') {
    event.preventDefault()
    splitSelected()
  }
  if (event.key.toLowerCase() === 'm') {
    event.preventDefault()
    void addMarker()
  }
}
function wheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    zoomTimeline(zoom.value * (event.deltaY < 0 ? 1.15 : 0.87))
  }
}
onMounted(async () => {
  panelOpen.value = window.innerWidth > 720
  const app = document.getElementById('omnigallery-app'),
    trigger = document.activeElement as HTMLElement | null
  const oldInert = app?.inert,
    oldOverflow = document.body.style.overflow
  if (app) app.inert = true
  document.body.style.overflow = 'hidden'
  restoreSurface = () => {
    if (app) app.inert = !!oldInert
    document.body.style.overflow = oldOverflow
    trigger?.focus()
  }
  window.addEventListener('keydown', keyboard)
  window.addEventListener('beforeunload', beforeUnload)
  shell.value?.focus()
  observer = new ResizeObserver(() => {
    viewportWidth.value = Math.max(200, (scroller.value?.clientWidth ?? 836) - 136)
  })
  if (scroller.value) observer.observe(scroller.value)
  try {
    await ensureWorkspaceStorage(props.workspaceId)
    if (disposed) return
    savedRaw = workspaceStorage(props.workspaceId).getItem(key)
    doc.value = readAudioTimeline(savedRaw)
    selectedTrackId.value = doc.value.tracks[0]?.id ?? ''
    ready.value = true
    if (savedRaw === null) enqueueSave()
    fitTimeline()
    for (const path of new Set(
      doc.value.tracks.flatMap((track) => track.clips.map((clip) => clip.path))
    ))
      void loadSource(path)
  } catch (cause) {
    loadError.value = getErrorMessage(cause, '制作文件读取失败')
  }
})
onBeforeUnmount(() => {
  disposed = true
  clearTimeout(saveTimer)
  gesture?.cancel()
  transport.stop()
  observer?.disconnect()
  window.removeEventListener('keydown', keyboard)
  window.removeEventListener('beforeunload', beforeUnload)
  restoreSurface?.()
})
defineExpose({ flushSave })
</script>

<template>
  <Teleport to="body">
    <section
      ref="shell"
      class="studio-editor-shell audio-editor"
      :class="{ 'panel-hidden': !panelOpen }"
      role="region"
      aria-label="音频制作编辑器"
      tabindex="-1"
      @pointerdown="menu = undefined"
    >
      <header class="audio-command-bar">
        <CustomerServiceOutlined /><strong
          :title="`${workspaceName} · ${work.name} · ${draft.name}`"
          >音频制作 · {{ draft.name }}</strong
        >
        <span class="save-state" :class="{ failed: saveError }" role="status">{{
          loadError
            ? '读取失败'
            : saveError
              ? '尚未保存'
              : saving
                ? '正在保存'
                : readonly
                  ? '只读'
                  : '自动保存'
        }}</span>
        <button v-if="saveError" type="button" @click="flushSave">重试保存</button>
        <button
          type="button"
          :disabled="!editable || !clipCount || !duration || !!unavailable.length"
          class="primary"
          @click="exportProduct"
        >
          {{ exporting ? '正在导出…' : '导出产物' }}
        </button>
        <a
          v-if="outputId"
          :href="`${apiBase}/workspace_artifacts/${outputId}/file?download=true`"
          download
          ><DownloadOutlined />下载</a
        >
      </header>
      <nav class="editor-actionbar audio-actions" aria-label="编辑器窗口">
        <button
          type="button"
          :aria-pressed="panelOpen"
          aria-label="展开或收起属性"
          title="属性"
          @click="panelOpen = !panelOpen"
        >
          <SoundOutlined />
        </button>
        <button type="button" :disabled="exporting" aria-label="关闭音频编辑器" @click="close">
          <CloseOutlined />
        </button>
      </nav>
      <nav class="editor-tool-rail audio-tools" aria-label="音频编辑工具">
        <button
          type="button"
          :disabled="!editable || doc.tracks.length >= 32"
          title="添加音轨"
          aria-label="添加音轨"
          @click="addTrack"
        >
          <PlusOutlined />
        </button>
        <button
          type="button"
          :disabled="!editable || textTracks.length >= textLimits.tracks"
          title="添加文字轨"
          aria-label="添加文字轨"
          @click="addTextTrack"
        >
          <FontSizeOutlined />
        </button>
        <button
          type="button"
          :disabled="!editable || importingText || textTracks.length >= textLimits.tracks"
          title="导入歌词或字幕"
          aria-label="导入歌词或字幕"
          @click="textInput?.click()"
        >
          <UploadOutlined />
        </button>
        <button
          type="button"
          :disabled="!clipEditable"
          title="在播放头分割 (S)"
          aria-label="分割片段"
          @click="splitSelected"
        >
          <ScissorOutlined />
        </button>
        <button
          type="button"
          :disabled="!editable || markers.length >= audioLimits.markers"
          title="在播放头添加标记 (M)"
          aria-label="添加标记"
          @click="addMarker"
        >
          <FlagOutlined />
        </button>
        <i />
        <button
          type="button"
          :disabled="!editable || !history.length"
          title="撤销 (Ctrl+Z)"
          aria-label="撤销"
          @click="undo()"
        >
          <UndoOutlined />
        </button>
        <button
          type="button"
          :disabled="!editable || !future.length"
          title="重做 (Ctrl+Shift+Z)"
          aria-label="重做"
          @click="undo(true)"
        >
          <RedoOutlined />
        </button>
        <i />
        <button type="button" title="适应时间线" aria-label="适应时间线" @click="fitTimeline">
          <ExpandOutlined />
        </button>
      </nav>
      <main class="audio-center">
        <div class="timeline-heading">
          <div>
            <h1>声音时间线</h1>
            <span
              >{{ doc.tracks.length }} 条音轨 · {{ clipCount }} 个片段<span
                v-if="textTracks.length"
              >
                · {{ textTracks.length }} 条文字轨</span
              ></span
            >
          </div>
          <button
            type="button"
            :aria-pressed="snapping"
            title="边缘、播放头与标记点吸附；按住 Shift 临时关闭"
            @click="snapping = !snapping"
          >
            吸附{{ snapping ? '开启' : '关闭' }}
          </button>
        </div>
        <div v-if="textTracks.length" class="text-preview" role="region" aria-label="歌词字幕预览">
          <small>文字预览</small>
          <div v-if="currentText.length">
            <p v-for="cue in currentText" :key="cue.id">{{ cue.text }}</p>
          </div>
          <span v-else>播放或移动播放头，预览当前时间的文字</span>
        </div>
        <p v-if="loadError || saveError || playbackError" role="alert" class="audio-warning">
          {{ loadError || saveError || playbackError
          }}<button v-if="saveError" type="button" @click="preserveAndClose">
            下载未保存副本并返回</button
          ><button v-if="loadError" type="button" @click="$emit('closed')">返回工作台</button>
        </p>
        <p v-if="unavailable.length" role="alert" class="audio-warning">
          {{ unavailable.length }} 项素材不可用，恢复素材后才能试听和导出。<button
            type="button"
            @click="unavailable.forEach((path) => loadSource(path, true))"
          >
            重新读取
          </button>
        </p>
        <div
          ref="scroller"
          class="audio-timeline-scroll"
          @scroll="scrollLeft = ($event.target as HTMLElement).scrollLeft"
          @wheel="wheel"
        >
          <div
            class="audio-timeline"
            :style="{ width: 136 + end * zoom + 'px', '--tick-width': tickStep * zoom + 'px' }"
          >
            <div class="timeline-ruler" @pointerdown="selectRange" title="点击定位，拖动选择范围">
              <span class="ruler-label"
                >音轨
                <button
                  type="button"
                  aria-label="添加音轨"
                  :disabled="!editable"
                  @pointerdown.stop
                  @click="addTrack"
                >
                  ＋
                </button></span
              >
              <span
                v-for="tick in ticks"
                :key="tick"
                class="ruler-tick"
                :style="{ left: 136 + tick * zoom + 'px' }"
                >{{ timeLabel(tick) }}</span
              >
            </div>
            <div class="timeline-markers" aria-label="时间线标记点">
              <span class="markers-label"
                >标记
                <button
                  type="button"
                  aria-label="在播放头添加标记"
                  :disabled="!editable || markers.length >= audioLimits.markers"
                  @click="addMarker"
                >
                  ＋
                </button></span
              >
              <button
                v-for="marker in markers"
                :key="marker.id"
                type="button"
                class="timeline-marker"
                :class="{ selected: selectedMarkerId === marker.id }"
                :style="{ left: 136 + marker.time * zoom + 'px' }"
                :title="`${marker.name} · ${timeLabel(marker.time, true)} · 拖动调整位置`"
                :aria-label="`标记：${marker.name}，${timeLabel(marker.time, true)}`"
                @pointerdown="dragMarker($event, marker)"
                @keydown.enter="selectMarker(marker)"
                @keydown.space.prevent="selectMarker(marker)"
              >
                <FlagOutlined /><span>{{ marker.name }}</span>
              </button>
            </div>
            <div
              v-for="(track, index) in doc.tracks"
              :key="track.id"
              :data-track-id="track.id"
              class="audio-track"
              :class="{
                'track-selected': selectedTrackId === track.id,
                'track-muted': !audibleTracks(doc).includes(track)
              }"
              @contextmenu="showMenu($event, 'track', track)"
            >
              <div class="track-header" @click="selectTrack(track)">
                <div>
                  <span class="track-number">{{ (index + 1).toString().padStart(2, '0') }}</span
                  ><strong :title="track.name">{{ track.name }}</strong
                  ><button
                    type="button"
                    :aria-label="`${track.name} 更多操作`"
                    @click.stop="showMenu($event, 'track', track)"
                  >
                    <MoreOutlined />
                  </button>
                </div>
                <div class="track-controls">
                  <button
                    type="button"
                    :disabled="!editable || track.locked"
                    :aria-pressed="track.muted"
                    title="静音"
                    @click.stop="updateTrack('muted', !track.muted, track)"
                  >
                    M</button
                  ><button
                    type="button"
                    :disabled="!editable || track.locked"
                    :aria-pressed="track.solo"
                    title="独奏"
                    @click.stop="updateTrack('solo', !track.solo, track)"
                  >
                    S</button
                  ><button
                    type="button"
                    :disabled="!editable"
                    :aria-label="track.locked ? '解锁音轨' : '锁定音轨'"
                    :aria-pressed="track.locked"
                    @click.stop="updateTrack('locked', !track.locked, track)"
                  >
                    <LockOutlined v-if="track.locked" /><UnlockOutlined v-else /></button
                  ><small>{{ Math.round(track.gain * 100) }}%</small>
                </div>
              </div>
              <div
                class="track-lane"
                @pointerdown.self="seekLane($event, track)"
                @dragover.prevent
                @drop="dropAudio($event, track)"
                @contextmenu.stop="showMenu($event, 'blank', track)"
              >
                <div
                  v-for="clip in track.clips"
                  :key="clip.id"
                  class="audio-clip"
                  tabindex="0"
                  role="button"
                  :aria-label="`${clip.sourceKind === 'video' ? '视频声音：' : ''}${clip.name}，${timeLabel(clip.start, true)} 至 ${timeLabel(clip.start + clip.duration, true)}`"
                  :aria-pressed="selectedClipId === clip.id"
                  :class="{
                    selected: selectedClipId === clip.id,
                    locked: track.locked,
                    unavailable: sourceErrors[clip.path]
                  }"
                  :style="{
                    left: clip.start * zoom + 'px',
                    width: Math.max(4, clip.duration * zoom) + 'px'
                  }"
                  @pointerdown="dragClip($event, track, clip)"
                  @keydown.enter="selectClip(track, clip)"
                  @focus="selectClip(track, clip)"
                  @contextmenu.stop="showMenu($event, 'clip', track, clip)"
                >
                  <strong
                    >{{ clipRate(clip) !== 1 ? `${clipRate(clip)}× · ` : ''
                    }}{{ clip.sourceKind === 'video' ? '视频声音 · ' : '' }}{{ clip.name }}</strong
                  ><small v-if="sourceErrors[clip.path]" class="clip-status">素材不可用</small
                  ><small v-else-if="!sources[clip.path]?.peaks" class="clip-status">{{
                    waveformErrors.has(clip.path)
                      ? '波形暂不可用'
                      : loadingSources.has(clip.path)
                        ? '读取音频…'
                        : '正在解析波形…'
                  }}</small>
                  <AudioWaveform
                    :clip="clip"
                    :peaks="sources[clip.path]?.peaks"
                    :source-duration="sources[clip.path]?.duration"
                    :pixels-per-second="zoom"
                    :viewport-start="scrollLeft"
                    :viewport-width="viewportWidth"
                  />
                  <span
                    class="clip-fade fade-in"
                    :style="{ width: Math.max(0, clip.fadeIn - clip.envelopeOffset) * zoom + 'px' }"
                  />
                  <span
                    class="clip-fade fade-out"
                    :style="{
                      width:
                        Math.max(
                          0,
                          clip.fadeOut -
                            (clip.envelopeDuration - clip.envelopeOffset - clip.duration)
                        ) *
                          zoom +
                        'px'
                    }"
                  />
                  <span
                    class="clip-edge left"
                    title="裁剪片段起点"
                    @pointerdown.stop="dragClip($event, track, clip, 'left')"
                  /><span
                    class="clip-edge right"
                    title="裁剪片段终点"
                    @pointerdown.stop="dragClip($event, track, clip, 'right')"
                  />
                </div>
                <span v-if="!track.clips.length" class="empty-lane">从下方添加音频或视频声音</span>
              </div>
            </div>
            <AudioTextTrackRow
              v-for="track in textTracks"
              :key="track.id"
              :track="track"
              :selected="selectedTextTrackId === track.id"
              :selected-cue-id="selectedCueId"
              :editing-cue-id="editingCueId"
              :editable="editable"
              :zoom="zoom"
              :scroll-left="scrollLeft"
              :viewport-width="viewportWidth"
              @select="selectText(track, $event)"
              @edit="editCue(track, $event)"
              @update="(cue, text) => updateCueText(track, cue, text)"
              @finish="finishCueEdit"
              @add="addCue(track, $event)"
              @toggle="updateTextTrack($event, !track[$event], track)"
              @menu="(event, cue) => showTextMenu(event, track, cue)"
              @drag="(event, cue, mode) => dragCue(event, track, cue, mode)"
              @seek="seekTextLane($event, track)"
            />
            <div v-if="!clipCount && !textTracks.length && !loadError" class="timeline-empty">
              <CustomerServiceOutlined /><strong>从声音开始创作</strong
              ><span>点击下方音频或视频素材，添加声音到当前音轨；也可以右键新建音轨。</span
              ><button type="button" :disabled="!editable" @click="pickerOpen = true">
                从媒体库加入音频或视频
              </button>
            </div>
            <div
              v-if="selection"
              class="range-overlay"
              :style="{
                left: 136 + selection.start * zoom + 'px',
                width: (selection.end - selection.start) * zoom + 'px'
              }"
            />
            <div class="playhead" :style="{ left: 136 + playhead * zoom + 'px' }"><i /></div>
            <div
              v-if="snapGuide !== undefined"
              class="snap-guide"
              :style="{ left: 136 + snapGuide * zoom + 'px' }"
              aria-hidden="true"
            >
              <span>对齐 {{ timeLabel(snapGuide, true) }}</span>
            </div>
          </div>
        </div>
        <footer class="audio-transport">
          <div class="transport-play">
            <button type="button" aria-label="回到起点" @click="transport.seek(0)">
              <StepBackwardOutlined /></button
            ><button
              type="button"
              class="play-button"
              :disabled="!ready || !duration || !!unavailable.length"
              :aria-label="playing ? '暂停试听' : '播放试听'"
              @click="togglePlay"
            >
              <PauseOutlined v-if="playing" /><PlayCircleOutlined v-else /></button
            ><output>{{ timeLabel(playhead, true) }}</output
            ><span>/ {{ timeLabel(duration, true) }}</span
            ><small v-if="buffering" role="status">载入试听…</small>
          </div>
          <div class="transport-range">
            <button type="button" :aria-pressed="loop" :disabled="!selection" @click="loop = !loop">
              循环选区</button
            ><span v-if="selection"
              >{{ timeLabel(selection.start, true) }} — {{ timeLabel(selection.end, true) }}</span
            ><button v-if="selection" type="button" aria-label="清除选区" @click="clearRange">
              <CloseOutlined />
            </button>
          </div>
          <div class="transport-zoom">
            <button type="button" aria-label="缩小时间线" @click="zoomTimeline(zoom / 1.4)">
              −</button
            ><input
              type="range"
              min="2"
              max="240"
              :value="zoom"
              aria-label="时间线缩放"
              @input="zoomTimeline(Number(($event.target as HTMLInputElement).value))"
            /><button type="button" aria-label="放大时间线" @click="zoomTimeline(zoom * 1.4)">
              ＋
            </button>
          </div>
        </footer>
      </main>
      <aside v-show="panelOpen" class="audio-inspector" aria-label="音频属性">
        <header>
          <div class="inspector-header-title">
            <strong>音频制作</strong><EditorHelpButton kind="audio" />
          </div>
          <span>48 kHz · 双声道</span>
        </header>
        <AudioLevelMeter
          class="inspector-meter"
          :levels="transport.levels.value"
          :peak="transport.peak.value"
          :overloaded="transport.overloaded.value"
          :playing="playing"
          @reset="transport.resetPeak"
        />
        <div class="inspector-scroll">
          <section v-if="selectedMarker || markers.length" class="property-section">
            <div class="property-heading">
              <h2>
                标记点 <small>{{ markers.length }}</small>
              </h2>
              <button
                type="button"
                :disabled="!editable || markers.length >= audioLimits.markers"
                @click="addMarker"
              >
                添加标记
              </button>
            </div>
            <template v-if="selectedMarker">
              <label
                >标记名称<input
                  data-marker-name
                  :value="selectedMarker.name"
                  maxlength="120"
                  :disabled="!editable"
                  @change="updateMarker('name', ($event.target as HTMLInputElement).value)"
              /></label>
              <label
                >标记时间 (秒)<input
                  type="number"
                  min="0"
                  max="86400"
                  step="0.01"
                  :value="selectedMarker.time.toFixed(3)"
                  :disabled="!editable"
                  @change="updateMarker('time', Number(($event.target as HTMLInputElement).value))"
              /></label>
              <div class="property-actions">
                <button type="button" @click="transport.seek(selectedMarker.time)">
                  跳转到标记
                </button>
                <button type="button" class="danger" :disabled="!editable" @click="deleteMarker">
                  删除标记
                </button>
              </div>
            </template>
            <div class="marker-list">
              <button
                v-for="marker in markers"
                :key="marker.id"
                type="button"
                :aria-pressed="selectedMarkerId === marker.id"
                @click="selectMarker(marker)"
              >
                <span>{{ marker.name }}</span
                ><small>{{ timeLabel(marker.time, true) }}</small>
              </button>
            </div>
          </section>
          <section v-if="selectedTextTrack" class="property-section">
            <div class="property-heading">
              <h2>文字轨</h2>
              <button
                type="button"
                aria-label="文字轨更多操作"
                @click="showTextMenu($event, selectedTextTrack)"
              >
                <MoreOutlined />
              </button>
            </div>
            <label
              >文字轨名称<input
                :value="selectedTextTrack.name"
                maxlength="120"
                :disabled="!editable || selectedTextTrack.locked"
                @change="updateTextTrack('name', ($event.target as HTMLInputElement).value)"
            /></label>
            <div class="property-actions">
              <button
                type="button"
                :disabled="
                  !editable ||
                  selectedTextTrack.locked ||
                  selectedTextTrack.cues.length >= textLimits.cues
                "
                @click="addCue()"
              >
                添加文字
              </button>
              <button
                type="button"
                :disabled="!editable || selectedTextTrack.locked"
                :aria-pressed="selectedTextTrack.visible"
                @click="updateTextTrack('visible', !selectedTextTrack.visible)"
              >
                {{ selectedTextTrack.visible ? '隐藏' : '显示' }}
              </button>
              <button
                type="button"
                :disabled="!editable"
                :aria-pressed="selectedTextTrack.locked"
                @click="updateTextTrack('locked', !selectedTextTrack.locked)"
              >
                {{ selectedTextTrack.locked ? '解锁' : '锁定' }}
              </button>
            </div>
            <template v-if="selectedCue">
              <label
                >文字内容<textarea
                  :value="selectedCue.text"
                  :maxlength="textLimits.text"
                  :disabled="!cueEditable"
                  rows="4"
                  placeholder="输入歌词或字幕"
                  @change="updateCue('text', ($event.target as HTMLTextAreaElement).value)"
                />
              </label>
              <div class="property-grid">
                <label
                  >文字开始时间<input
                    type="number"
                    min="0"
                    :max="86400 - selectedCue.duration"
                    step="0.01"
                    :value="selectedCue.start.toFixed(3)"
                    :disabled="!cueEditable"
                    @change="updateCue('start', Number(($event.target as HTMLInputElement).value))"
                /></label>
                <label
                  >文字持续时长<input
                    type="number"
                    min="0.001"
                    step="0.01"
                    :value="selectedCue.duration.toFixed(3)"
                    :disabled="!cueEditable"
                    @change="
                      updateCue('duration', Number(($event.target as HTMLInputElement).value))
                    "
                /></label>
              </div>
              <label
                >所在文字轨<select
                  :value="selectedTextTrackId"
                  :disabled="!cueEditable"
                  @change="moveCueTo(($event.target as HTMLSelectElement).value)"
                >
                  <option
                    v-for="track in textTracks"
                    :key="track.id"
                    :value="track.id"
                    :disabled="track.locked"
                  >
                    {{ track.name }}
                  </option>
                </select></label
              >
              <div class="property-actions">
                <button type="button" :disabled="!cueEditable" @click="splitCue">分割文字</button
                ><button type="button" :disabled="!cueEditable" @click="duplicateCue">
                  复制文字</button
                ><button type="button" class="danger" :disabled="!cueEditable" @click="deleteCue">
                  删除文字
                </button>
              </div>
              <button type="button" class="text-button" @click="transport.seek(selectedCue.start)">
                定位到这段文字
              </button>
            </template>
            <small v-else
              >在播放头处添加文字，或双击文字轨空白处。拖动移动，拖动边缘调整显示时间。</small
            >
          </section>
          <section v-if="selectedTextTrack" class="property-section">
            <h2>歌词／字幕导出</h2>
            <div class="property-grid">
              <label
                >文字格式<select v-model="textFormat">
                  <option value="srt">SRT · 字幕</option>
                  <option value="vtt">VTT · 字幕</option>
                  <option value="lrc">LRC · 歌词</option>
                </select></label
              >
              <label
                >文字导出范围<select v-model="textExportScope">
                  <option value="all">整条文字轨</option>
                  <option value="selection" :disabled="!selection">选区（从零开始）</option>
                </select></label
              >
            </div>
            <small>导出当前文字轨。文字单独保存为文件，音频产物不包含歌词或字幕。</small>
            <small v-if="textFormat === 'lrc'"
              >LRC 按百分之一秒记录时间；需要精确结束时间或多行字幕时使用 SRT／VTT。</small
            >
            <button
              type="button"
              :disabled="
                !selectedTextTrack.cues.length || (textExportScope === 'selection' && !selection)
              "
              @click="downloadText"
            >
              <DownloadOutlined /> 下载文字轨
            </button>
          </section>
          <section v-if="selectedClip" class="property-section">
            <div class="property-heading">
              <h2>片段</h2>
              <button
                type="button"
                aria-label="片段更多操作"
                @click="showMenu($event, 'clip', selectedTrack, selectedClip)"
              >
                <MoreOutlined />
              </button>
            </div>
            <p class="selected-name" :title="selectedClip.name">{{ selectedClip.name }}</p>
            <small v-if="selectedClip.sourceKind === 'video'">视频声音 · 第一条音轨</small>
            <div class="property-grid">
              <label
                >时间线起点
                <input
                  type="number"
                  min="0"
                  :max="86400 - selectedClip.duration"
                  step="0.01"
                  :disabled="!clipEditable"
                  :value="selectedClip.start.toFixed(3)"
                  @change="
                    updateClip('start', Number(($event.target as HTMLInputElement).value))
                  " /></label
              ><label
                >片段时长
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  :disabled="!clipEditable"
                  :value="selectedClip.duration.toFixed(3)"
                  @change="
                    updateClip('duration', Number(($event.target as HTMLInputElement).value))
                  " /></label
              ><label
                >源音频起点
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  :disabled="!clipEditable"
                  :value="selectedClip.sourceIn.toFixed(3)"
                  @change="
                    updateClip('sourceIn', Number(($event.target as HTMLInputElement).value))
                  " /></label
              ><label
                >片段音量 (%)
                <input
                  type="number"
                  min="0"
                  max="400"
                  :disabled="!clipEditable"
                  :value="Math.round(selectedClip.gain * 100)"
                  @change="
                    updateClip('gain', Number(($event.target as HTMLInputElement).value) / 100)
                  " /></label
              ><label
                >淡入 (秒)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  :disabled="!clipEditable"
                  :value="selectedClip.fadeIn.toFixed(2)"
                  @change="
                    updateClip('fadeIn', Number(($event.target as HTMLInputElement).value))
                  " /></label
              ><label
                >淡出 (秒)
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  :disabled="!clipEditable"
                  :value="selectedClip.fadeOut.toFixed(2)"
                  @change="
                    updateClip('fadeOut', Number(($event.target as HTMLInputElement).value))
                  "
              /></label>
            </div>
            <div class="property-grid">
              <label
                >播放速度 (倍)<input
                  type="number"
                  :min="audioLimits.minRate"
                  :max="audioLimits.maxRate"
                  step="0.05"
                  :value="clipRate(selectedClip)"
                  :disabled="!clipEditable"
                  @change="updateRate($event)"
              /></label>
              <label
                >音调<select
                  :value="selectedClip.preservePitch !== false ? 'keep' : 'change'"
                  :disabled="!clipEditable"
                  @change="updatePitch(($event.target as HTMLSelectElement).value === 'keep')"
                >
                  <option value="keep">保持音调</option>
                  <option value="change">随速度改变</option>
                </select></label
              >
            </div>
            <small>变速保持源音频范围，改变片段时长；后续片段和文字位置不自动移动。</small>
            <label
              >所在音轨<select
                :disabled="!clipEditable"
                :value="selectedTrackId"
                @change="moveClipTo(($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="track in doc.tracks"
                  :key="track.id"
                  :value="track.id"
                  :disabled="track.locked"
                >
                  {{ track.name }}
                </option>
              </select></label
            >
            <div class="property-actions">
              <button type="button" :disabled="!clipEditable" @click="splitSelected">分割</button
              ><button type="button" :disabled="!clipEditable" @click="duplicateClip">复制</button
              ><button type="button" :disabled="!clipEditable" class="danger" @click="deleteClip">
                删除
              </button>
            </div>
            <small v-if="selectedSource"
              >源文件 {{ timeLabel(selectedSource.duration, true) }} ·
              {{ selectedSource.sampleRate }} Hz · {{ selectedSource.channels }} 声道</small
            >
            <button
              v-if="assetInfo[selectedClip.path]"
              type="button"
              class="text-button"
              @click="preview = assetInfo[selectedClip.path]"
            >
              {{ selectedClip.sourceKind === 'video' ? '查看源视频' : '试听源音频' }}
            </button>
          </section>
          <section v-if="selectedTrack" class="property-section">
            <h2>音轨</h2>
            <label
              >名称<input
                :disabled="!editable || selectedTrack.locked"
                :value="selectedTrack.name"
                maxlength="120"
                @change="updateTrack('name', ($event.target as HTMLInputElement).value)" /></label
            ><label class="gain-label"
              >音轨音量 <span>{{ Math.round(selectedTrack.gain * 100) }}%</span></label
            ><input
              type="range"
              min="0"
              max="200"
              :value="selectedTrack.gain * 100"
              :disabled="!editable || selectedTrack.locked"
              aria-label="音轨音量"
              @change="updateTrack('gain', Number(($event.target as HTMLInputElement).value) / 100)"
            />
            <div class="property-actions">
              <button
                type="button"
                :disabled="!editable || selectedTrack.locked"
                :aria-pressed="selectedTrack.muted"
                @click="updateTrack('muted', !selectedTrack.muted)"
              >
                静音</button
              ><button
                type="button"
                :disabled="!editable || selectedTrack.locked"
                :aria-pressed="selectedTrack.solo"
                @click="updateTrack('solo', !selectedTrack.solo)"
              >
                独奏</button
              ><button
                type="button"
                :disabled="!editable"
                :aria-pressed="selectedTrack.locked"
                @click="updateTrack('locked', !selectedTrack.locked)"
              >
                {{ selectedTrack.locked ? '解锁' : '锁定' }}
              </button>
            </div>
          </section>
          <section class="property-section">
            <h2>混音与导出</h2>
            <label class="gain-label"
              >总音量<span>{{ Math.round(doc.masterGain * 100) }}%</span></label
            ><input
              type="range"
              min="0"
              max="200"
              :value="doc.masterGain * 100"
              :disabled="!editable"
              aria-label="总音量"
              @change="
                change(() => {
                  doc.masterGain = Number(($event.target as HTMLInputElement).value) / 100
                })
              "
            /><small>叠加过响时可降低总音量。</small
            ><small
              v-if="exportPeak !== undefined"
              :class="{ 'audio-warning': exportPeak !== null && exportPeak >= 0 }"
            >
              本次导出混音峰值 {{ exportPeak === null ? '−∞ dBFS' : levelLabel(exportPeak)
              }}{{
                exportPeak !== null && exportPeak >= 0 ? ' · 已达到或超过上限，建议降低音量' : ''
              }} </small
            ><label
              >产物名称<input v-model="exportName" maxlength="120" :disabled="exporting"
            /></label>
            <div class="property-grid">
              <label
                >格式<select v-model="exportFormat" :disabled="exporting">
                  <option value="wav">WAV · 无损</option>
                  <option value="mp3">MP3 · 192 kbps</option>
                </select></label
              ><label
                >范围<select v-model="exportScope" :disabled="exporting">
                  <option value="all">整条时间线</option>
                  <option value="selection" :disabled="!selection">选区</option>
                </select></label
              >
            </div>
            <small>导出为工作区产物，原始媒体文件保留。</small>
          </section>
          <section v-if="draft.brief" class="property-section">
            <h2>制作笔记</h2>
            <p class="audio-brief">{{ draft.brief }}</p>
          </section>
        </div>
        <footer>
          <button
            type="button"
            class="primary"
            :disabled="
              !editable ||
              !clipCount ||
              !duration ||
              !!unavailable.length ||
              !exportName.trim() ||
              (exportScope === 'selection' && !selection)
            "
            @click="exportProduct"
          >
            {{ exporting ? '正在导出…' : '导出音频产物' }}
          </button>
        </footer>
      </aside>
      <div class="audio-materials">
        <WorkspaceMaterialShelf
          :assets="assets"
          :asset-info="assetInfo"
          :allowed-kinds="['audio', 'video']"
          :controller="materialController"
          :tasks="[]"
          :readonly="!editable"
          :context-key="`${workspaceId}:${draft.id}:audio`"
          placement="above"
          :empty-state="{ title: '加入音频或视频', description: '配音、音乐或视频中的声音' }"
          draggable-materials
          @select="materialController.select"
          @add="pickerOpen = true"
        />
      </div>
      <div
        v-if="menu"
        class="audio-menu"
        role="menu"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
        @pointerdown.stop
        @keydown.esc.stop="menu = undefined"
      >
        <template v-if="menu.target === 'text-cue'">
          <button
            type="button"
            role="menuitem"
            :disabled="!cueEditable"
            @click="menuAction(splitCue)"
          >
            在播放头分割文字 <small>S</small>
          </button>
          <button
            type="button"
            role="menuitem"
            :disabled="!cueEditable"
            @click="menuAction(duplicateCue)"
          >
            复制文字片段
          </button>
          <button
            type="button"
            role="menuitem"
            class="danger"
            :disabled="!cueEditable"
            @click="menuAction(deleteCue)"
          >
            删除文字片段
          </button>
        </template>
        <template v-else-if="menu.target === 'text-track'">
          <button
            type="button"
            role="menuitem"
            :disabled="!editable || selectedTextTrack?.locked"
            @click="menuAction(() => addCue())"
          >
            在播放头添加文字
          </button>
          <button
            type="button"
            role="menuitem"
            :disabled="!editable"
            @click="menuAction(() => updateTextTrack('locked', !selectedTextTrack?.locked))"
          >
            {{ selectedTextTrack?.locked ? '解锁文字轨' : '锁定文字轨' }}
          </button>
          <button
            type="button"
            role="menuitem"
            :disabled="!selectedTextTrack?.cues.length"
            @click="
              menuAction(() => {
                void downloadText()
              })
            "
          >
            下载文字轨
          </button>
          <button
            type="button"
            role="menuitem"
            class="danger"
            :disabled="!editable || selectedTextTrack?.locked || !!selectedTextTrack?.cues.length"
            @click="menuAction(removeTextTrack)"
          >
            删除空文字轨
          </button>
        </template>
        <template v-else-if="menu.target === 'clip'"
          ><button
            type="button"
            role="menuitem"
            :disabled="!clipEditable"
            @click="menuAction(splitSelected)"
          >
            在播放头处分割 <small>S</small></button
          ><button
            type="button"
            role="menuitem"
            :disabled="!clipEditable"
            @click="menuAction(duplicateClip)"
          >
            复制片段</button
          ><button
            type="button"
            role="menuitem"
            :disabled="!clipEditable"
            @click="menuAction(() => updateClip('fadeIn', 1))"
          >
            添加 1 秒淡入</button
          ><button
            type="button"
            role="menuitem"
            :disabled="!clipEditable"
            @click="menuAction(() => updateClip('fadeOut', 1))"
          >
            添加 1 秒淡出</button
          ><button
            type="button"
            role="menuitem"
            class="danger"
            :disabled="!clipEditable"
            @click="menuAction(deleteClip)"
          >
            删除片段
          </button></template
        >
        <template v-else-if="menu.target === 'track'"
          ><button
            type="button"
            role="menuitem"
            :disabled="!editable || selectedTrack?.locked"
            @click="menuAction(() => updateTrack('muted', !selectedTrack?.muted))"
          >
            {{ selectedTrack?.muted ? '取消静音' : '静音音轨' }}</button
          ><button
            type="button"
            role="menuitem"
            :disabled="!editable || selectedTrack?.locked"
            @click="menuAction(() => updateTrack('solo', !selectedTrack?.solo))"
          >
            {{ selectedTrack?.solo ? '取消独奏' : '独奏音轨' }}</button
          ><button
            type="button"
            role="menuitem"
            :disabled="!editable"
            @click="menuAction(() => updateTrack('locked', !selectedTrack?.locked))"
          >
            {{ selectedTrack?.locked ? '解锁音轨' : '锁定音轨' }}</button
          ><button
            type="button"
            role="menuitem"
            class="danger"
            :disabled="!editable || selectedTrack?.locked || !!selectedTrack?.clips.length"
            @click="menuAction(removeTrack)"
          >
            删除空音轨
          </button></template
        >
        <button
          v-else
          type="button"
          role="menuitem"
          :disabled="!editable"
          @click="
            menuAction(() => {
              pickerOpen = true
            })
          "
        >
          加入音频或视频</button
        ><button
          type="button"
          role="menuitem"
          :disabled="!editable || doc.tracks.length >= 32"
          @click="menuAction(addTrack)"
        >
          新建音轨
        </button>
      </div>
      <WorkspaceAssetPreview
        v-if="preview"
        :file="preview"
        :workspace-name="workspaceName"
        @close="preview = undefined"
      />
      <input
        ref="textInput"
        type="file"
        accept=".lrc,.srt,.vtt,.txt"
        hidden
        aria-label="导入文字文件"
        @change="importText"
      />
      <MediaLibraryPicker
        v-if="pickerOpen"
        title="加入音频或视频"
        multiple
        :allowed-types="['audio', 'video']"
        :saving="!editable"
        @close="pickerOpen = false"
        @confirm="importPicked"
      />
    </section>
  </Teleport>
</template>

<style scoped>
.audio-editor {
  --audio-inspector-width: 328px;
}
button,
input,
select {
  font: inherit;
}
textarea {
  font: inherit;
}
button {
  border: 1px solid var(--ui-control-border);
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  border-radius: 6px;
  cursor: pointer;
  padding: 6px 10px;
}
button:hover:not(:disabled) {
  background: var(--ui-hover);
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
button[aria-pressed='true'] {
  background: #94bdf626;
  border-color: #94bdf6;
  color: #b9d6ff;
}
button:focus-visible,
input:focus-visible,
select:focus-visible,
.audio-clip:focus-visible {
  outline: 2px solid #94bdf6;
  outline-offset: 2px;
}
.primary {
  background: #94bdf6;
  color: #18283d;
  border-color: transparent;
  font-weight: 600;
}
.primary:hover:not(:disabled) {
  background: #b2d0fa;
}
.danger {
  color: #ffa3a3;
}
.audio-command-bar {
  position: absolute;
  top: 16px;
  left: 16px;
  max-width: calc(100% - var(--audio-inspector-width) - 130px);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--ui-control-border);
  border-radius: 10px;
  background: #1c1f24db;
  z-index: 20;
}
.audio-command-bar strong {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 280px;
}
.audio-command-bar a {
  color: var(--primary-color);
  white-space: nowrap;
}
.save-state {
  color: #84bc99;
  font-size: 11px;
  white-space: nowrap;
}
.save-state.failed {
  color: #edbd72;
}
.audio-actions {
  position: absolute;
  top: 16px;
  right: calc(var(--audio-inspector-width) + 16px);
  z-index: 20;
}
.audio-tools {
  position: absolute;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  z-index: 20;
}
.audio-tools i {
  width: 22px;
  border-top: 1px solid var(--ui-border);
  margin: 3px;
}
.audio-center {
  position: absolute;
  top: 78px;
  left: 76px;
  right: calc(var(--audio-inspector-width) + 16px);
  bottom: 138px;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.timeline-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
  padding: 4px 0 20px;
}
.timeline-heading > div {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.timeline-heading h1 {
  font-size: 18px;
  font-weight: 500;
  margin: 0;
}
.timeline-heading span {
  color: var(--ui-muted);
  font-size: 11px;
}
.audio-timeline-scroll {
  position: relative;
  flex: 1;
  overflow: auto;
  background: #141a21;
  border: 1px solid var(--ui-border);
  border-radius: 12px 12px 0 0;
  scrollbar-color: #465366 #1b222c;
  scrollbar-width: thin;
}
.text-preview {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 48px;
  max-height: 96px;
  overflow: auto;
  flex-shrink: 0;
  box-sizing: border-box;
  margin-bottom: 12px;
  padding: 10px 16px;
  border: 1px solid #ddbb7740;
  border-radius: 9px;
  background: #211d16;
}
.text-preview small {
  color: #bba47d;
  font-size: 11px;
  white-space: nowrap;
}
.text-preview > div {
  flex: 1;
  min-width: 0;
  text-align: center;
}
.text-preview p {
  margin: 0;
  white-space: pre-line;
  overflow-wrap: anywhere;
  color: #f3e4c9;
  font-size: 15px;
  line-height: 1.5;
}
.text-preview > span {
  font-size: 11px;
  color: var(--ui-muted);
}
.audio-timeline {
  position: relative;
  min-height: 100%;
}
.timeline-ruler {
  height: 44px;
  position: sticky;
  top: 0;
  z-index: 5;
  background: #202731;
  border-bottom: 1px solid var(--ui-border);
  cursor: crosshair;
  touch-action: none;
}
.timeline-markers {
  position: sticky;
  top: 44px;
  z-index: 5;
  height: 30px;
  background: #1c2430;
  border-bottom: 1px solid var(--ui-border);
}
.markers-label {
  position: sticky;
  left: 0;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-sizing: border-box;
  width: 136px;
  height: 30px;
  padding: 0 14px;
  background: #232c37;
  color: var(--ui-muted);
  font-size: 11px;
}
.markers-label button {
  padding: 0 4px;
  border: 0;
  background: none;
}
.timeline-marker {
  position: absolute;
  top: 3px;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 125px;
  height: 24px;
  padding: 2px 6px;
  color: #f0c980;
  border-color: #c39b5759;
  background: #3e3220;
  cursor: ew-resize;
  touch-action: none;
}
.timeline-marker span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.timeline-marker.selected {
  border-color: #f0c980;
}
.snap-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 7;
  border-left: 1px dashed #f0c980;
  pointer-events: none;
}
.snap-guide span {
  position: absolute;
  top: 74px;
  left: 4px;
  padding: 3px 5px;
  border-radius: 4px;
  background: #493a24;
  color: #f0c980;
  white-space: nowrap;
  font-size: 10px;
}
.marker-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 130px;
  overflow-y: auto;
}
.marker-list button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  text-align: left;
}
.marker-list button span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.inspector-meter {
  flex-shrink: 0;
  margin: 10px 0 12px;
}
.ruler-label {
  position: sticky;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 136px;
  height: 44px;
  padding: 0 14px;
  box-sizing: border-box;
  background: #232c37;
  color: var(--ui-muted);
  z-index: 6;
}
.ruler-label button {
  padding: 1px 5px;
  font-size: 18px;
  border: 0;
  background: none;
}
.ruler-tick {
  position: absolute;
  top: 10px;
  border-left: 1px solid #526073;
  height: 34px;
  padding-left: 7px;
  font-size: 10px;
  color: var(--ui-muted);
  pointer-events: none;
}
.audio-track {
  position: relative;
  display: flex;
  min-height: 126px;
  border-bottom: 1px solid var(--ui-border);
}
.track-header {
  position: sticky;
  left: 0;
  flex: 0 0 136px;
  z-index: 4;
  background: #202731;
  border-right: 1px solid var(--ui-border);
  padding: 16px 10px;
  box-sizing: border-box;
  cursor: pointer;
}
.track-selected .track-header {
  background: #273442;
}
.track-header > div {
  display: flex;
  align-items: center;
  gap: 7px;
}
.track-header strong {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.track-number {
  color: #6e8097;
  font: 10px monospace;
}
.track-header button {
  padding: 3px;
  width: 24px;
  height: 24px;
  font-size: 11px;
  background: #141b24;
}
.track-controls {
  margin-top: 22px;
}
.track-controls small {
  margin-left: auto;
  font-size: 10px;
  color: var(--ui-muted);
}
.track-lane {
  position: relative;
  flex: 1;
  min-width: 0;
  background: repeating-linear-gradient(
    90deg,
    transparent 0,
    transparent calc(var(--tick-width) - 1px),
    #ffffff06 calc(var(--tick-width) - 1px),
    #ffffff06 var(--tick-width)
  );
}
.track-muted .audio-clip {
  opacity: 0.38;
}
.audio-clip {
  position: absolute;
  top: 10px;
  bottom: 10px;
  background: linear-gradient(#315d68, #264851);
  border: 1px solid #507f8c;
  border-radius: 6px;
  box-sizing: border-box;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}
.audio-clip.selected {
  border: 2px solid #94bdf6;
  box-shadow: 0 0 0 1px #94bdf644;
}
.audio-clip.locked {
  cursor: default;
}
.audio-clip.unavailable {
  background: #5a3339;
  border-color: #af6c72;
}
.audio-clip > strong {
  position: absolute;
  left: 9px;
  right: 7px;
  top: 5px;
  font-size: 11px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  z-index: 2;
}
.clip-status {
  display: block;
  position: absolute;
  bottom: 8px;
  left: 10px;
  font-size: 10px;
  color: #bdd0d4;
}
.clip-edge {
  position: absolute;
  width: 9px;
  top: 0;
  bottom: 0;
  z-index: 3;
  cursor: ew-resize;
}
.clip-edge:hover {
  background: #b5d5ff55;
}
.clip-edge.left {
  left: 0;
}
.clip-edge.right {
  right: 0;
}
.clip-fade {
  position: absolute;
  top: 26px;
  bottom: 4px;
  background: #cadfff18;
  pointer-events: none;
  max-width: 100%;
}
.fade-in {
  left: 0;
  clip-path: polygon(0 0, 100% 0, 0 100%);
}
.fade-out {
  right: 0;
  clip-path: polygon(0 0, 100% 0, 100% 100%);
}
.empty-lane {
  display: block;
  color: #637386;
  font-size: 11px;
  padding: 50px 20px;
}
.timeline-empty {
  position: sticky;
  left: 136px;
  width: calc(100% - 136px);
  max-width: 540px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--ui-muted);
  padding: 50px 24px;
  box-sizing: border-box;
}
.timeline-empty .anticon {
  font-size: 30px;
  color: #6d839d;
}
.timeline-empty strong {
  color: var(--ui-text);
  font-weight: 500;
  font-size: 16px;
}
.timeline-empty span {
  font-size: 12px;
  text-align: center;
}
.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #c4dbff;
  pointer-events: none;
  z-index: 3;
}
.playhead i {
  position: absolute;
  top: 31px;
  left: -5px;
  width: 11px;
  height: 13px;
  background: #c4dbff;
  clip-path: polygon(0 0, 100% 0, 100% 60%, 50% 100%, 0 60%);
}
.range-overlay {
  position: absolute;
  top: 0;
  bottom: 0;
  background: #8fbcfa16;
  border-left: 1px solid #94bdf680;
  border-right: 1px solid #94bdf680;
  pointer-events: none;
  z-index: 2;
}
.audio-transport {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 0 0 12px 12px;
  background: #202731;
}
.transport-play,
.transport-zoom,
.transport-range {
  display: flex;
  align-items: center;
  gap: 7px;
}
.transport-play button {
  display: grid;
  place-items: center;
  padding: 4px;
  width: 28px;
  height: 30px;
  border: 0;
  background: transparent;
  font-size: 16px;
}
.transport-play .play-button {
  width: 36px;
  font-size: 25px;
  color: #b9d6ff;
}
.transport-play output {
  font: 13px monospace;
  color: #dfecff;
}
.transport-play > span,
.transport-range span {
  font-size: 10px;
  color: var(--ui-muted);
}
.transport-play small {
  color: #edbd72;
  font-size: 10px;
}
.transport-range button {
  font-size: 11px;
  padding: 5px 7px;
}
.transport-zoom input {
  width: 78px;
}
.transport-zoom button {
  border: 0;
  padding: 3px 6px;
}
.audio-inspector {
  position: absolute;
  right: 12px;
  top: 12px;
  bottom: 12px;
  width: calc(var(--audio-inspector-width) - 24px);
  border: 1px solid var(--ui-border);
  border-radius: 22px;
  background: linear-gradient(155deg, #242b35, #191f28 62%);
  display: flex;
  flex-direction: column;
  padding: 18px;
  box-sizing: border-box;
}
.audio-inspector > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--ui-border);
  font-size: 13px;
}
.audio-inspector > header span {
  color: var(--ui-muted);
  font-size: 10px;
}
.inspector-header-title {
  display: flex;
  align-items: center;
  gap: 5px;
}
.inspector-scroll {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  margin-right: -12px;
  padding-right: 12px;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #465366 transparent;
}
.property-section {
  padding: 18px 0;
  border-bottom: 1px solid var(--ui-border);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.property-section h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}
.property-section p {
  margin: 0;
}
.property-section small {
  font-size: 10px;
  color: var(--ui-muted);
  line-height: 1.7;
}
.property-section label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: var(--ui-muted);
}
.property-section input:not([type='range']),
.property-section textarea,
.property-section select {
  width: 100%;
  min-width: 0;
  height: 32px;
  background: #121922;
  border: 1px solid #ffffff16;
  border-radius: 6px;
  color: var(--ui-text);
  padding: 5px 8px;
  box-sizing: border-box;
  font-size: 12px;
}
.property-section textarea {
  min-height: 90px;
  height: auto;
  resize: vertical;
  line-height: 1.6;
}
.property-section input:disabled,
.property-section select:disabled {
  opacity: 0.45;
}
input[type='range'] {
  accent-color: #94bdf6;
  cursor: pointer;
}
.property-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
}
.property-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.property-heading button {
  padding: 2px 5px;
  border: 0;
  background: none;
}
.selected-name {
  font-size: 11px;
  color: #b5cedd;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.property-section .gain-label {
  flex-direction: row;
  justify-content: space-between;
}
.property-actions {
  display: flex;
  gap: 6px;
}
.property-actions button {
  flex: 1;
  font-size: 11px;
}
.audio-inspector > footer {
  padding-top: 16px;
}
.audio-inspector > footer button {
  width: 100%;
  height: 36px;
}
.audio-brief {
  font-size: 11px;
  color: var(--ui-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.text-button {
  color: var(--primary-color);
  border: 0;
  font-size: 11px;
}
.audio-materials {
  position: absolute;
  bottom: 12px;
  left: 76px;
  right: calc(var(--audio-inspector-width) + 16px);
  height: 108px;
  z-index: 25;
}
.audio-menu {
  position: fixed;
  z-index: 60;
  width: 186px;
  background: #222c38;
  border: 1px solid #ffffff30;
  box-shadow: 0 12px 40px #0008;
  border-radius: 8px;
  padding: 5px;
  box-sizing: border-box;
}
.audio-menu button {
  display: flex;
  justify-content: space-between;
  border: 0;
  width: 100%;
  background: transparent;
  text-align: left;
  font-size: 12px;
  padding: 9px;
}
.audio-menu button small {
  color: var(--ui-muted);
}
.audio-warning {
  color: #ffd796;
  font-size: 12px;
  background: #4b361e;
  padding: 8px 12px;
  border-radius: 7px;
  margin: 0 0 10px;
}
.audio-warning button {
  margin-left: 10px;
  font-size: 11px;
}
.panel-hidden {
  --audio-inspector-width: 0px;
}
@media (max-width: 1050px) {
  .audio-editor {
    --audio-inspector-width: 286px;
  }
  .panel-hidden {
    --audio-inspector-width: 0px;
  }
  .audio-inspector {
    padding: 14px;
  }
  .timeline-heading > span {
    display: none;
  }
  .audio-command-bar strong {
    max-width: 190px;
  }
  .audio-command-bar {
    gap: 7px;
  }
  .transport-range span {
    display: none;
  }
}
@media (max-width: 720px) {
  .audio-center {
    left: 12px;
    right: 12px;
    top: 84px;
    bottom: 164px;
  }
  .audio-tools {
    top: auto;
    bottom: 125px;
    left: 12px;
    transform: none;
    flex-direction: row;
    width: auto;
  }
  .audio-tools i {
    height: 22px;
    width: 0;
    border-top: 0;
    border-left: 1px solid var(--ui-border);
  }
  .audio-materials {
    left: 12px;
    right: 12px;
    height: 96px;
  }
  .audio-inspector {
    z-index: 35;
    top: 62px;
    bottom: 166px;
    width: 276px;
    box-shadow: -20px 0 60px #000b;
  }
  .audio-actions {
    right: 12px;
  }
  .audio-command-bar {
    max-width: calc(100% - 108px);
    left: 12px;
  }
  .audio-command-bar strong {
    max-width: 130px;
  }
  .audio-command-bar .save-state,
  .audio-command-bar > a {
    display: none;
  }
  .audio-transport {
    gap: 5px;
    padding: 8px;
  }
  .timeline-heading h1 {
    font-size: 16px;
  }
  .timeline-heading > div {
    gap: 8px;
  }
  .transport-play span {
    display: none;
  }
}
</style>
