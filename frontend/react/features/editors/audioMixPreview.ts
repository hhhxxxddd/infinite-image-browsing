import type { AudioProcessing } from '../../../src/features/media-editor/model/audioProcessing.ts'

export type MixKind = 'audio' | 'video'
export interface MixPreparation {
  id: string
  revision: string
  state: 'queued' | 'running' | 'ready' | 'failed' | 'cancelled' | 'expired'
  phase: string
  progress: number
  duration: number
  error: string
}
type SoundClip = Record<string, unknown> & { trackId?: string }
interface SoundTrack {
  id?: string
  kind?: string
  muted?: boolean
  hidden?: boolean
  solo?: boolean
  processing?: Partial<AudioProcessing>
  role?: string
  duck?: boolean
  clips?: SoundClip[]
}
interface SoundDocument {
  tracks: SoundTrack[]
  sounds?: SoundClip[]
  processing?: Partial<AudioProcessing>
  masterGain?: number
}
const soundFields = [
  'path',
  'start',
  'sourceIn',
  'duration',
  'rate',
  'preservePitch',
  'gain',
  'pan',
  'gainPoints',
  'fadeIn',
  'fadeOut',
  'fadeCurve',
  'channels',
  'invertPhase',
  'envelopeOffset',
  'envelopeDuration',
  'reverse',
  'freeze',
  'audioStream'
] as const
function soundLanes(kind: MixKind, value: unknown) {
  const doc = value as SoundDocument
  const tracks =
    kind === 'video' ? doc.tracks.filter((track) => track.kind === 'audio') : doc.tracks
  const solo = tracks.some((track) => track.solo)
  return tracks
    .filter((track) => !track.muted && !track.hidden && (!solo || track.solo))
    .map((track) => ({
      track,
      clips:
        kind === 'audio'
          ? (track.clips ?? [])
          : (doc.sounds ?? []).filter(
              (clip) => (clip.trackId ?? 'audio-1') === track.id && !clip.freeze
            )
    }))
}
function statefulProcessing(value?: Partial<AudioProcessing>) {
  if (value?.bypass) return false
  const equalizer =
    value?.equalizer &&
    value.equalizer !== 'flat' &&
    (value.equalizer !== 'custom' || !!(value.eq?.low || value.eq?.mid || value.eq?.high))
  return !!(
    equalizer ||
    (value?.denoise && value.denoise !== 'off') ||
    (value?.compressor && value.compressor !== 'off') ||
    value?.deess ||
    (value?.normalize && value.normalize !== 'off') ||
    value?.limiter
  )
}
/** Stateful filters, tempo changes and dialogue ducking share finalized sound across seeks. */
export function needsCompleteMix(kind: MixKind, document: unknown) {
  const doc = document as SoundDocument
  const lanes = soundLanes(kind, doc)
  return (
    statefulProcessing(doc.processing) ||
    lanes.some(({ track }) => statefulProcessing(track.processing)) ||
    lanes.some(({ clips }) =>
      clips.some((clip) => clip.preservePitch !== false && (clip.rate ?? 1) !== 1)
    ) ||
    (lanes.some(({ track, clips }) => clips.length && track.role === 'dialogue') &&
      lanes.some(({ track, clips }) => clips.length && track.role === 'music' && track.duck))
  )
}
/** Picture/text edits and labels do not restart identical background sound preparation. */
export function mixPreviewSignature(kind: MixKind, document: unknown) {
  const doc = document as SoundDocument
  return JSON.stringify({
    kind,
    masterGain: doc.masterGain ?? 1,
    processing: doc.processing,
    lanes: soundLanes(kind, doc).map(({ track, clips }) => ({
      gain: (track as SoundTrack & { gain?: number }).gain ?? 1,
      pan: (track as SoundTrack & { pan?: number }).pan ?? 0,
      processing: track.processing,
      role: track.role,
      duck: track.duck,
      clips: clips.map((clip) => Object.fromEntries(soundFields.map((key) => [key, clip[key]])))
    }))
  })
}
function mixStatus(value: unknown): MixPreparation {
  const job = value as MixPreparation
  if (
    !job ||
    !/^[\w-]{1,128}$/.test(job.id) ||
    typeof job.revision !== 'string' ||
    !['queued', 'running', 'ready', 'failed', 'cancelled', 'expired'].includes(job.state) ||
    !Number.isFinite(job.progress) ||
    job.progress < 0 ||
    job.progress > 1 ||
    !Number.isFinite(job.duration) ||
    job.duration < 0 ||
    typeof job.error !== 'string'
  )
    throw new Error('混音准备状态无效')
  return job
}
function cancelled() {
  return new DOMException('试听已停止', 'AbortError')
}
function waitForPoll(signal: AbortSignal, delay: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled())
      return
    }
    const abort = () => {
      clearTimeout(timer)
      reject(cancelled())
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delay)
    signal.addEventListener('abort', abort, { once: true })
  })
}
type Request = (path: string, options?: RequestInit) => Promise<Response>

interface PreparationEntry {
  clientId: string
  controller: AbortController
  promise?: Promise<MixPreparation>
  job?: MixPreparation
  pending: boolean
  released: boolean
}
function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(cancelled())
      return
    }
    const abort = () => reject(cancelled())
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) reject(cancelled())
        else resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
  })
}
/** A pause keeps background preparation observable; edits release only this viewer's interest. */
export class AudioMixPreviewClient {
  private kind: MixKind
  private workspaceId: string
  private request: Request
  private onStatus: (job: MixPreparation | null) => void
  private pollMs: number
  private clientId: string
  private preparations = new Map<string, PreparationEntry>()
  private activeSignature = ''
  private last?: MixPreparation
  private disposed = false
  constructor(
    kind: MixKind,
    workspaceId: string,
    request: Request,
    onStatus: (job: MixPreparation | null) => void,
    pollMs = 600,
    clientId = crypto.randomUUID()
  ) {
    this.kind = kind
    this.workspaceId = workspaceId
    this.request = request
    this.onStatus = onStatus
    this.pollMs = pollMs
    this.clientId = clientId
  }
  private path(job: MixPreparation, clientId: string, action = '') {
    return `/audio_mix_cache/${encodeURIComponent(job.id)}${action}?workspace_id=${encodeURIComponent(this.workspaceId)}&client_id=${encodeURIComponent(clientId)}`
  }
  private publish(signature: string, job: MixPreparation | null) {
    if (!this.disposed && signature === this.activeSignature && this.last !== (job ?? undefined)) {
      this.last = job ?? undefined
      this.onStatus(job)
    }
  }
  private async release(entry: PreparationEntry) {
    if (entry.released) return
    entry.released = true
    // A start can already have created a server job; obtain its id before releasing interest.
    if (!entry.job) return
    entry.controller.abort()
    if (entry.pending)
      await this.request(this.path(entry.job, entry.clientId, '/cancel'), { method: 'POST' })
  }
  private async ready(signature: string, document: unknown, signal: AbortSignal) {
    let entry = this.preparations.get(signature)
    if (!entry) {
      entry = {
        clientId: this.clientId,
        controller: new AbortController(),
        pending: true,
        released: false
      }
      this.clientId = crypto.randomUUID()
      const current = entry
      current.promise = (async () => {
        try {
          let job = mixStatus(
            await (
              await this.request('/audio_mix_cache/start', {
                method: 'POST',
                signal: current.controller.signal,
                body: JSON.stringify({
                  workspace_id: this.workspaceId,
                  kind: this.kind,
                  document,
                  client_id: current.clientId
                })
              })
            ).json()
          )
          current.job = job
          if (current.released || this.disposed) {
            await this.request(this.path(job, current.clientId, '/cancel'), { method: 'POST' })
            throw cancelled()
          }
          while (true) {
            if (current.controller.signal.aborted) throw cancelled()
            this.publish(signature, job)
            if (job.state === 'ready') return job
            if (job.state !== 'queued' && job.state !== 'running')
              throw new Error(
                job.error ||
                  (job.state === 'cancelled' ? '混音准备已取消' : '混音缓存已过期，请重新试听')
              )
            await waitForPoll(current.controller.signal, this.pollMs)
            job = mixStatus(
              await (
                await this.request(this.path(job, current.clientId), {
                  signal: current.controller.signal
                })
              ).json()
            )
            current.job = job
          }
        } catch (error) {
          if (!current.released && !current.controller.signal.aborted) {
            this.publish(signature, {
              id: current.job?.id ?? 'preparation',
              revision: current.job?.revision ?? '',
              duration: current.job?.duration ?? 0,
              progress: current.job?.progress ?? 0,
              state: 'failed',
              phase: 'failed',
              error: error instanceof Error ? error.message : '混音准备失败，请重试'
            })
            await this.release(current).catch(() => {})
          }
          throw error
        } finally {
          current.pending = false
        }
      })()
      current.promise.catch(() => {
        if (this.preparations.get(signature) === current) this.preparations.delete(signature)
      })
      this.preparations.set(signature, current)
      while (this.preparations.size > 4) {
        const oldest = this.preparations.keys().next().value
        if (oldest !== undefined) {
          const removed = this.preparations.get(oldest)
          if (removed) void this.release(removed).catch(() => {})
          this.preparations.delete(oldest)
        }
      }
    }
    if (!entry.promise) throw new Error('混音准备状态已失效，请重试')
    const job = await awaitWithSignal(entry.promise, signal)
    this.publish(signature, job)
    return { job, clientId: entry.clientId }
  }
  observeDocument(document: unknown) {
    const signature = mixPreviewSignature(this.kind, document)
    if (this.disposed) return signature
    if (signature !== this.activeSignature) {
      for (const [key, entry] of this.preparations) {
        if (key !== signature && entry.pending) {
          void this.release(entry).catch(() => {})
          this.preparations.delete(key)
        }
      }
      this.activeSignature = signature
      this.publish(signature, this.preparations.get(signature)?.job ?? null)
    }
    return signature
  }
  async load(document: unknown, start: number, duration: number, signal: AbortSignal) {
    if (signal.aborted || this.disposed) throw cancelled()
    const signature = this.observeDocument(document)
    if (!needsCompleteMix(this.kind, document)) {
      this.publish(signature, null)
      return this.request(
        this.kind === 'audio' ? '/audio_studio/preview' : '/video_studio/preview-mix',
        {
          method: 'POST',
          signal,
          body: JSON.stringify({ workspace_id: this.workspaceId, document, start, duration })
        }
      )
    }
    const { job, clientId } = await this.ready(signature, document, signal)
    if (signal.aborted || this.disposed) throw cancelled()
    try {
      return await this.request(
        `${this.path(job, clientId, '/chunk')}&start=${start}&duration=${duration}`,
        {
          signal
        }
      )
    } catch (error) {
      this.preparations.delete(signature)
      throw error
    }
  }
  async cancelPreparation() {
    const signature = this.activeSignature,
      entry = this.preparations.get(signature)
    if (!entry?.pending) return
    this.preparations.delete(signature)
    this.activeSignature = ''
    this.last = undefined
    if (!this.disposed) this.onStatus(null)
    await this.release(entry)
  }
  dispose() {
    this.disposed = true
    for (const entry of this.preparations.values()) void this.release(entry).catch(() => {})
    this.preparations.clear()
  }
}
