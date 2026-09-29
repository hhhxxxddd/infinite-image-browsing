import { onBeforeUnmount, ref } from 'vue'
import { previewAudio } from '../api/audioStudio'
import { cloneTimeline, sampleTime, type AudioTimelineDocument } from '../model/audioTimeline'
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { levelStep, type StereoLevel } from '../model/audioLevels'

/** Keep only a short mixed window in memory; preview never decodes a whole long source. */
export function useAudioTransport(workspaceId: string) {
  const time = ref(0),
    playing = ref(false),
    buffering = ref(false),
    error = ref('')
  const levels = ref<StereoLevel>([0, 0]),
    peak = ref(0),
    overloaded = ref(false)
  const meterWindows: { at: number; duration: number; levels: StereoLevel[]; read: number }[] = []
  function resetPeak() {
    peak.value = 0
    overloaded.value = false
  }
  let context: AudioContext | undefined
  let abort: AbortController | undefined
  let generation = 0,
    frame = 0
  const nodes = new Set<AudioBufferSourceNode>()
  function stop() {
    generation++
    abort?.abort()
    cancelAnimationFrame(frame)
    for (const node of nodes) {
      node.onended = null
      node.stop()
    }
    nodes.clear()
    meterWindows.length = 0
    levels.value = [0, 0]
    playing.value = false
    buffering.value = false
  }
  async function play(
    document: AudioTimelineDocument,
    from: number,
    end: number,
    loopStart?: number
  ) {
    stop()
    error.value = ''
    if (from >= end) return
    const token = generation
    try {
      context ??= new AudioContext({ sampleRate: 48000 })
      await context.resume()
    } catch (cause) {
      if (token === generation) error.value = getErrorMessage(cause, '当前环境无法启用音频试听')
      return
    }
    if (token !== generation) return
    const snapshot = cloneTimeline(document)
    abort = new AbortController()
    let cursor = sampleTime(from),
      scheduled = context.currentTime,
      timelineStart = cursor
    let clockStart = scheduled,
      loaded = false,
      finished = false
    playing.value = true
    buffering.value = true
    time.value = cursor
    const tick = () => {
      if (token !== generation || !context) return
      if (loaded)
        time.value = Math.min(
          cursor,
          end,
          timelineStart + Math.max(0, context.currentTime - clockStart)
        )
      const now = context.currentTime
      levels.value = [0, 0]
      for (const window of meterWindows) {
        const until = Math.min(window.levels.length - 1, Math.floor((now - window.at) / levelStep))
        // Consume all elapsed bins, including brief peaks between animation frames.
        while (window.read <= until) {
          const value = window.levels[window.read++]
          peak.value = Math.max(peak.value, ...value)
          if (value.some((channel) => channel >= 1)) overloaded.value = true
        }
        if (now >= window.at && now < window.at + window.duration)
          levels.value = window.levels[Math.max(0, until)] ?? [0, 0]
      }
      while (meterWindows[0] && now >= meterWindows[0].at + meterWindows[0].duration)
        meterWindows.shift()
      if (finished && context.currentTime >= scheduled) {
        time.value = end
        stop()
        if (loopStart !== undefined) void play(snapshot, loopStart, end, loopStart)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    try {
      while (cursor < end && token === generation) {
        const duration = sampleTime(Math.min(10, end - cursor))
        const preview = await previewAudio(workspaceId, snapshot, cursor, duration, abort.signal)
        if (token !== generation) return
        const buffer = await context.decodeAudioData(preview.data)
        if (token !== generation) return
        if (!loaded || context.currentTime > scheduled) {
          // Pause the visual clock during underrun instead of skipping source samples.
          scheduled = context.currentTime + 0.06
          clockStart = scheduled
          timelineStart = cursor
        }
        const node = context.createBufferSource()
        node.buffer = buffer
        node.connect(context.destination)
        nodes.add(node)
        node.onended = () => nodes.delete(node)
        node.start(scheduled)
        meterWindows.push({
          at: scheduled,
          duration: buffer.duration,
          levels: preview.levels,
          read: 0
        })
        scheduled += buffer.duration
        cursor = sampleTime(cursor + duration)
        loaded = true
        buffering.value = false
        // Fetch the next window with four seconds of headroom, retaining at most two windows.
        while (cursor < end && scheduled - context.currentTime > 4 && token === generation)
          await new Promise((resolve) => setTimeout(resolve, 100))
        if (context.currentTime > scheduled) buffering.value = true
      }
      finished = true
    } catch (cause) {
      if (token !== generation) return
      stop()
      error.value = getErrorMessage(cause, '试听失败，请检查素材和 FFmpeg 运行环境')
    }
  }
  function seek(value: number) {
    stop()
    time.value = sampleTime(Math.max(0, value))
  }
  onBeforeUnmount(() => {
    stop()
    void context?.close()
  })
  return { time, playing, buffering, error, levels, peak, overloaded, resetPeak, play, stop, seek }
}
