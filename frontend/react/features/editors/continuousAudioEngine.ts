import type { AudioTimelineDocument } from '../../../src/features/media-editor/model/audioTimeline'
import { needsCompleteMix } from './audioMixPreview.ts'

export interface PreviewChunk {
  buffer: AudioBuffer
  levels?: Array<[number, number]>
}
export interface AudioPlayRequest<TDocument = AudioTimelineDocument> {
  document: TDocument
  start: number
  end: number
  loop?: boolean | { start: number; end: number }
}
export interface AudioPreviewEvents {
  time: (time: number) => void
  state: (playing: boolean, buffering: boolean) => void
  levels: (left: number, right: number) => void
  ended: () => void
  error: (error: unknown) => void
}
type Scheduled = { when: number; end: number; start: number; offset: number; chunk: PreviewChunk }
type Session<TDocument> = {
  request: AudioPlayRequest<TDocument>
  document: TDocument
  signature: string
  gain: number
  bus: GainNode
  controller: AbortController
  sources: Set<AudioBufferSourceNode>
  scheduled: Scheduled[]
  cursor: number
  position: number
  filling: boolean
  finished: boolean
}

/** Master gain precedes mastering DSP in exports; only a bypassed master can use live gain. */
export function prepareAudioPreview(document: AudioTimelineDocument) {
  const processing = document.processing
  const bypass =
    !needsCompleteMix('audio', document) &&
    (processing?.bypass ||
      ((!processing?.denoise || processing.denoise === 'off') &&
        (!processing?.equalizer || processing.equalizer === 'flat') &&
        (!processing?.compressor || processing.compressor === 'off') &&
        !processing?.deess &&
        (!processing?.normalize || processing.normalize === 'off') &&
        !processing?.limiter))
  const snapshot = JSON.parse(JSON.stringify(document)) as AudioTimelineDocument
  if (bypass) snapshot.masterGain = 1
  const signature = JSON.stringify({
    tracks: snapshot.tracks,
    masterGain: snapshot.masterGain,
    processing: snapshot.processing
  })
  return { document: snapshot, signature, gain: bypass ? (document.masterGain ?? 1) : 1 }
}

/** One playback clock, bounded render-ahead, and cancellable replacement snapshots. */
export class ContinuousPreviewEngine<TDocument> {
  private current?: Session<TDocument>
  private pending?: Session<TDocument>
  private retired = new Set<Session<TDocument>>()
  private timer?: ReturnType<typeof setInterval>
  private cache = new Map<string, PreviewChunk>()
  private context: AudioContext
  private load: (
    document: TDocument,
    start: number,
    duration: number,
    signal: AbortSignal
  ) => Promise<PreviewChunk>
  private events: AudioPreviewEvents
  private prepare: (document: TDocument) => { document: TDocument; signature: string; gain: number }
  constructor(
    context: AudioContext,
    load: ContinuousPreviewEngine<TDocument>['load'],
    events: AudioPreviewEvents,
    prepare: ContinuousPreviewEngine<TDocument>['prepare']
  ) {
    this.context = context
    this.load = load
    this.events = events
    this.prepare = prepare
  }
  private create(request: AudioPlayRequest<TDocument>): Session<TDocument> {
    const prepared = this.prepare(request.document)
    const bus = this.context.createGain()
    bus.connect(this.context.destination)
    bus.gain.setValueAtTime(prepared.gain, this.context.currentTime)
    return {
      ...prepared,
      request: { ...request, document: prepared.document },
      bus,
      controller: new AbortController(),
      sources: new Set(),
      scheduled: [],
      cursor: request.start,
      position: request.start,
      filling: false,
      finished: false
    }
  }
  private valid(request: AudioPlayRequest<TDocument>) {
    return (
      Number.isFinite(request.start) &&
      Number.isFinite(request.end) &&
      request.start >= 0 &&
      request.end > request.start &&
      request.end <= 86400 &&
      (typeof request.loop !== 'object' ||
        (Number.isFinite(request.loop.start) &&
          Number.isFinite(request.loop.end) &&
          request.loop.start >= 0 &&
          request.loop.end > request.loop.start &&
          request.loop.end === request.end))
    )
  }
  private release(session: Session<TDocument>, fade = false, when = this.context.currentTime) {
    session.controller.abort()
    const now = this.context.currentTime
    if (fade) {
      session.bus.gain.cancelScheduledValues(now)
      session.bus.gain.setValueAtTime(session.bus.gain.value, now)
      session.bus.gain.setValueAtTime(session.bus.gain.value, when)
      session.bus.gain.linearRampToValueAtTime(0, when + 0.025)
    }
    for (const source of session.sources) {
      try {
        source.stop(fade ? when + 0.025 : 0)
      } catch {
        /* Already ended. */
      }
      if (!fade) {
        source.onended = null
        source.disconnect()
      }
    }
    if (fade) {
      this.retired.add(session)
      setTimeout(() => {
        this.release(session)
        this.retired.delete(session)
      }, 80)
    } else {
      session.sources.clear()
      session.bus.disconnect()
    }
  }
  stop() {
    if (this.current) this.release(this.current)
    if (this.pending) this.release(this.pending)
    for (const session of this.retired) this.release(session)
    this.retired.clear()
    this.current = this.pending = undefined
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.events.state(false, false)
    this.events.levels(0, 0)
  }
  private position(session: Session<TDocument>, when = this.context.currentTime) {
    const chunk = session.scheduled.find((entry) => entry.when <= when && entry.end > when)
    if (chunk) return Math.min(session.request.end, chunk.start + when - chunk.when)
    const last = session.scheduled.filter((entry) => entry.end <= when).at(-1)
    return last
      ? Math.min(session.request.end, last.start + last.end - last.when)
      : session.position
  }
  private boundedPosition(request: AudioPlayRequest<TDocument>, position: number) {
    const start = typeof request.loop === 'object' ? request.loop.start : request.start
    if (request.loop && (position < start || position >= request.end))
      return start + (Math.max(0, position - start) % (request.end - start))
    return Math.max(0, Math.min(request.end, position))
  }
  private async chunk(session: Session<TDocument>, start: number, duration: number) {
    const controller = session.controller
    const key = `${session.signature}:${start}:${duration}`
    let chunk = this.cache.get(key)
    if (!chunk) {
      chunk = await this.load(session.document, start, duration, controller.signal)
      if (controller.signal.aborted) return undefined
      if (chunk.buffer.duration < duration - 0.002) throw new Error('试听返回的音频不完整')
      this.cache.set(key, chunk)
      while (this.cache.size > 8) {
        const oldest = this.cache.keys().next().value
        if (oldest === undefined) break
        this.cache.delete(oldest)
      }
    }
    return chunk
  }
  private schedule(
    session: Session<TDocument>,
    chunk: PreviewChunk,
    start: number,
    duration: number,
    when: number,
    offset = 0
  ) {
    const source = this.context.createBufferSource()
    source.buffer = chunk.buffer
    source.connect(session.bus)
    source.onended = () => {
      session.sources.delete(source)
      source.disconnect()
    }
    session.sources.add(source)
    session.scheduled.push({ when, end: when + duration, start, offset, chunk })
    source.start(when, offset, duration)
    session.cursor = start + duration
  }
  private async fill(session: Session<TDocument>) {
    if (
      session.filling ||
      this.current !== session ||
      this.pending ||
      session.finished ||
      session.controller.signal.aborted
    )
      return
    session.filling = true
    const controller = session.controller
    try {
      while (this.current === session && !this.pending && !controller.signal.aborted) {
        const last = session.scheduled.at(-1)
        if (last && last.end - this.context.currentTime >= 18) break
        if (session.cursor >= session.request.end - 1 / 48000) {
          if (!session.request.loop) {
            session.finished = true
            break
          }
          session.cursor =
            typeof session.request.loop === 'object'
              ? session.request.loop.start
              : session.request.start
        }
        const start = session.cursor,
          duration = Math.min(12, session.request.end - start)
        const chunk = await this.chunk(session, start, duration)
        if (!chunk || this.current !== session || this.pending || controller.signal.aborted) break
        const when = Math.max(this.context.currentTime + 0.025, session.scheduled.at(-1)?.end ?? 0)
        this.schedule(session, chunk, start, duration, when)
      }
    } catch (error) {
      if (this.current === session && !controller.signal.aborted) {
        this.stop()
        this.events.error(error)
      }
    } finally {
      session.filling = false
    }
  }
  private tick() {
    const session = this.current
    if (!session) return
    const now = this.context.currentTime
    session.position = this.position(session)
    while (session.scheduled[0]?.end <= now) session.scheduled.shift()
    const chunk = session.scheduled[0]
    this.events.time(session.position)
    if (chunk && chunk.when <= now) {
      this.events.state(true, !!this.pending)
      const level = chunk.chunk.levels?.[Math.floor((chunk.offset + now - chunk.when) * 20)] ?? [
        0, 0
      ]
      this.events.levels(level[0] * session.gain, level[1] * session.gain)
    } else if (!chunk && session.finished && !this.pending) {
      this.stop()
      this.events.ended()
      return
    } else {
      this.events.state(true, true)
      this.events.levels(0, 0)
    }
    void this.fill(session)
  }
  async play(request: AudioPlayRequest<TDocument>) {
    this.stop()
    // Each new playback rechecks on-disk source versions through the preview service.
    this.cache.clear()
    if (!this.valid(request)) return
    const session = this.create(request)
    this.current = session
    this.events.state(true, true)
    try {
      await this.context.resume()
      if (this.current !== session) return
      this.timer = setInterval(() => this.tick(), 40)
      await this.fill(session)
    } catch (error) {
      if (this.current === session) {
        this.stop()
        this.events.error(error)
      }
    }
  }
  /** Keep the clock/loop running; only the newest rendered snapshot may replace it. */
  async update(change: Omit<AudioPlayRequest<TDocument>, 'start'>) {
    const current = this.current
    if (!current) return
    const request = { ...change, start: current.request.start }
    if (request.end <= 0) {
      this.stop()
      this.events.time(0)
      return
    }
    request.start = Math.min(request.start, Math.max(0, request.end - 1 / 48000))
    if (!this.valid(request)) return
    const prepared = this.prepare(change.document)
    const same = (session: Session<TDocument>) =>
      session.signature === prepared.signature &&
      session.request.end === request.end &&
      JSON.stringify(session.request.loop) === JSON.stringify(request.loop)
    const latest = this.pending ?? current
    if (same(latest)) {
      latest.gain = prepared.gain
      if (latest === current) {
        const now = this.context.currentTime
        latest.bus.gain.cancelScheduledValues(now)
        latest.bus.gain.setTargetAtTime(prepared.gain, now, 0.01)
      }
      return
    }
    if (this.pending) this.release(this.pending)
    this.pending = undefined
    if (same(current)) {
      current.gain = prepared.gain
      current.bus.gain.setTargetAtTime(prepared.gain, this.context.currentTime, 0.01)
      current.controller = new AbortController()
      void this.fill(current)
      return
    }
    const session = this.create(request)
    this.pending = session
    current.controller.abort()
    this.events.state(true, true)
    try {
      while (this.pending === session) {
        const position = this.boundedPosition(request, this.position(current))
        if (position >= request.end) {
          this.stop()
          this.events.time(request.end)
          this.events.ended()
          return
        }
        const loopStart = typeof request.loop === 'object' ? request.loop.start : request.start
        // A complete short loop survives wrapping while the replacement renders asynchronously.
        const start = request.loop && request.end - loopStart <= 12 ? loopStart : position
        const duration = Math.min(12, request.end - start)
        const chunk = await this.chunk(session, start, duration)
        if (!chunk || this.pending !== session) return
        const when = this.context.currentTime + 0.025
        const next = this.boundedPosition(request, this.position(current, when))
        if (next >= request.end) {
          this.stop()
          this.events.time(request.end)
          this.events.ended()
          return
        }
        if (next < start || next >= start + duration - 1 / 48000) continue
        session.bus.gain.setValueAtTime(0, when)
        session.bus.gain.linearRampToValueAtTime(session.gain, when + 0.025)
        this.schedule(session, chunk, next, start + duration - next, when, next - start)
        session.position = next
        this.current = session
        this.pending = undefined
        this.release(current, true, when)
        this.timer ??= setInterval(() => this.tick(), 40)
        this.events.time(next)
        void this.fill(session)
      }
    } catch (error) {
      if (this.pending === session && !session.controller.signal.aborted) {
        this.stop()
        this.events.error(error)
      }
    }
  }
  dispose() {
    this.stop()
    this.cache.clear()
    void this.context.close()
  }
}

/** Audio and video production share scheduling, cancellation and snapshot replacement. */
export class ContinuousAudioEngine extends ContinuousPreviewEngine<AudioTimelineDocument> {
  constructor(
    context: AudioContext,
    load: (
      document: AudioTimelineDocument,
      start: number,
      duration: number,
      signal: AbortSignal
    ) => Promise<PreviewChunk>,
    events: AudioPreviewEvents
  ) {
    super(context, load, events, prepareAudioPreview)
  }
}
