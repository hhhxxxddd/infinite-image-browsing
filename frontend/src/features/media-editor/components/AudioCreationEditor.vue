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
  DownloadOutlined
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
import { apiBase } from '@/shared/api/httpClient'
import { getAudioSource, exportAudio, type AudioSourceInfo } from '../api/audioStudio'
import {
  audioTimelineKey,
  audibleTracks,
  cloneTimeline,
  createAudioClip,
  createAudioTimeline,
  createAudioTrack,
  readAudioTimeline,
  sampleTime,
  setClipFades,
  splitClip,
  timelineDuration,
  trimClip,
  type AudioClip,
  type AudioTimelineDocument,
  type AudioTrack
} from '../model/audioTimeline'
import { useAudioTransport } from '../composables/useAudioTransport'
import AudioWaveform from './AudioWaveform.vue'
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
  doc.value.tracks.find((track) => track.id === selectedTrackId.value)
)
const selectedClip = computed(() =>
  selectedTrack.value?.clips.find((clip) => clip.id === selectedClipId.value)
)
const selectedSource = computed(() =>
  selectedClip.value ? sources[selectedClip.value.path] : undefined
)
const duration = computed(() => timelineDuration(doc.value))
const end = computed(() => Math.max(60, duration.value + 5, playhead.value + 5))
const editable = computed(
  () => ready.value && !props.readonly && !loadError.value && !exporting.value
)
const clipEditable = computed(
  () => editable.value && selectedClip.value && !selectedTrack.value?.locked
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
  enqueueSave()
}
function change(operation: () => void) {
  if (!editable.value || gesture) return
  const before = cloneTimeline(doc.value)
  operation()
  commit(before)
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
  transport.stop()
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
  if (!editable.value || asset.kind !== 'audio') return
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
    const clip = createAudioClip(asset.path, asset.name, info.duration, at)
    if (!track) return
    track.clips.push(clip)
    selectedTrackId.value = track.id
    selectedClipId.value = clip.id
  })
}
function addTrack() {
  if (doc.value.tracks.length >= 32) return
  change(() => {
    const track = createAudioTrack(`声音 ${doc.value.tracks.length + 1}`)
    doc.value.tracks.push(track)
    selectedTrackId.value = track.id
    selectedClipId.value = ''
  })
}
function selectClip(track: AudioTrack, clip: AudioClip) {
  selectedTrackId.value = track.id
  selectedClipId.value = clip.id
}
function selectTrack(track: AudioTrack) {
  selectedTrackId.value = track.id
  selectedClipId.value = ''
}
function seekLane(event: PointerEvent, track: AudioTrack) {
  transport.seek(eventTime(event))
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
  const source = sources[clip.path]?.duration ?? clip.sourceIn + clip.duration
  change(() => {
    if (field === 'start')
      clip.start = sampleTime(Math.max(0, Math.min(value, 86400 - clip.duration)))
    if (field === 'gain') clip.gain = Math.max(0, Math.min(value, 4))
    if (field === 'sourceIn') {
      // Moving the source range resets fades to the current clip's range.
      clip.sourceIn = sampleTime(Math.max(0, Math.min(value, source - clip.duration)))
      Object.assign(clip, setClipFades(clip, clip.fadeIn, clip.fadeOut))
    }
    if (field === 'duration') {
      clip.duration = sampleTime(
        Math.max(1 / 48000, Math.min(value, source - clip.sourceIn, 86400 - clip.start))
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
function deleteClip() {
  const track = selectedTrack.value
  if (!clipEditable.value || !track) return
  change(() => {
    track.clips = track.clips.filter((clip) => clip.id !== selectedClipId.value)
    selectedClipId.value = ''
  })
}
function duplicateClip() {
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
function eventTime(event: PointerEvent | DragEvent) {
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
let gesture: { before: AudioTimelineDocument; target: HTMLElement; cancel: () => void } | undefined
function dragClip(
  event: PointerEvent,
  track: AudioTrack,
  clip: AudioClip,
  mode: 'move' | 'left' | 'right' = 'move'
) {
  if (event.button !== 0) return
  selectClip(track, clip)
  if (!editable.value || track.locked) return
  event.preventDefault()
  event.stopPropagation()
  transport.stop()
  menu.value = undefined
  clearTimeout(saveTimer)
  const before = cloneTimeline(doc.value),
    original = { ...clip },
    origin = event.clientX
  const element = event.currentTarget as HTMLElement
  element.setPointerCapture(event.pointerId)
  const onMove = (ev: PointerEvent) => {
    const delta = sampleTime((ev.clientX - origin) / zoom.value)
    if (mode === 'move')
      clip.start = sampleTime(
        Math.max(0, Math.min(original.start + delta, 86400 - original.duration))
      )
    if (mode === 'left')
      Object.assign(
        clip,
        trimClip(
          original,
          Math.max(0, Math.min(delta, original.duration - 0.01)),
          original.duration
        )
      )
    if (mode === 'right')
      Object.assign(
        clip,
        trimClip(
          original,
          0,
          Math.max(0.01, Math.min(original.duration + delta, original.duration))
        )
      )
  }
  const cleanup = () => {
    element.removeEventListener('pointermove', onMove)
    element.removeEventListener('pointerup', onUp)
    element.removeEventListener('pointercancel', cancel)
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
    gesture = undefined
  }
  const cancel = () => {
    cleanup()
    doc.value = before
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
  const start = eventTime(event),
    element = event.currentTarget as HTMLElement
  transport.seek(start)
  selection.value = undefined
  menu.value = undefined
  element.setPointerCapture(event.pointerId)
  const move = (ev: PointerEvent) => {
    const current = eventTime(ev)
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
const menu = ref<{ x: number; y: number; target: 'clip' | 'track' | 'blank' }>()
function showMenu(
  event: MouseEvent,
  target: 'clip' | 'track' | 'blank',
  track?: AudioTrack,
  clip?: AudioClip
) {
  event.preventDefault()
  event.stopPropagation()
  if (track) selectedTrackId.value = track.id
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
  assets: props.assets.filter((asset) => asset.kind === 'audio'),
  roles: Object.fromEntries(
    doc.value.tracks.flatMap((track) => track.clips.map((clip) => [clip.path, '已使用']))
  ),
  activePath: selectedClip.value?.path ?? '',
  recentPaths: [],
  clickMode: clickMode.value,
  clickOptions: [
    { value: 'view', label: '查看', title: '试听源音频' },
    { value: 'add', label: '添加', title: '在播放头处添加音频片段' }
  ],
  setClickMode: (mode) => {
    clickMode.value = mode
  },
  select: (asset) => {
    if (clickMode.value === 'view') preview.value = props.assetInfo[asset.path]
    else void addAudio(asset)
  },
  actions: () => [
    {
      key: 'add',
      label: '添加到当前音轨',
      disabled: !editable.value || selectedTrack.value?.locked
    },
    {
      key: 'new-track',
      label: '添加到新音轨',
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
  const asset = props.assets.find((asset) => asset.path === path && asset.kind === 'audio')
  if (asset) void addAudio(asset, false, eventTime(event), track.id)
}
async function exportProduct() {
  if (!editable.value || !duration.value || unavailable.value.length || !exportName.value.trim())
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
    emit('artifactSaved')
    message.success('音频已导出到工作区产物，可下载或继续用于其他制作文件')
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
    deleteClip()
  }
  if (event.key.toLowerCase() === 's') {
    event.preventDefault()
    splitSelected()
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
          :disabled="!editable || !duration || !!unavailable.length"
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
          :disabled="!clipEditable"
          title="在播放头分割 (S)"
          aria-label="分割片段"
          @click="splitSelected"
        >
          <ScissorOutlined />
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
            <span>{{ doc.tracks.length }} 条音轨 · {{ clipCount }} 个片段</span>
          </div>
          <span>拖动移动 · 边缘裁剪 · 右键操作</span>
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
                  :aria-label="`${clip.name}，${timeLabel(clip.start, true)} 至 ${timeLabel(clip.start + clip.duration, true)}`"
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
                  <strong>{{ clip.name }}</strong
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
                <span v-if="!track.clips.length" class="empty-lane">从下方素材区添加音频</span>
              </div>
            </div>
            <div v-if="!clipCount && !loadError" class="timeline-empty">
              <CustomerServiceOutlined /><strong>从声音开始创作</strong
              ><span>点击下方音频素材，添加到当前音轨；也可以右键新建音轨。</span
              ><button type="button" :disabled="!editable" @click="pickerOpen = true">
                从媒体库加入音频
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
        <header><strong>音频制作</strong><span>48 kHz · 双声道</span></header>
        <div class="inspector-scroll">
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
              试听源文件
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
          :allowed-kinds="['audio']"
          :controller="materialController"
          :tasks="[]"
          :readonly="!editable"
          :context-key="`${workspaceId}:${draft.id}:audio`"
          placement="above"
          :empty-state="{ title: '加入音频素材', description: '配音、音乐或声音片段' }"
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
        <template v-if="menu.target === 'clip'"
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
          加入音频素材</button
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
      <MediaLibraryPicker
        v-if="pickerOpen"
        title="加入音频素材"
        multiple
        :allowed-types="['audio']"
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
.inspector-scroll {
  min-height: 0;
  flex: 1;
  overflow: auto;
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
