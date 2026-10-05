export interface VideoMediaInfo {
  duration: number
  width: number
  height: number
  fps: number
  video_codec: string
  has_audio: boolean
  size: number
  fingerprint: string
  hdr: boolean
  warnings: string[]
  proxy_url: string | null
}
export interface VideoProxyJob {
  id: string
  path: string
  fingerprint: string
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  progress: number
  error?: string
  proxy_url?: string | null
}

/** A path is an address, not a media version. Discard requests from before invalidation. */
export class VideoMediaCache {
  readonly infos = new Map<string, VideoMediaInfo>()
  readonly jobs = new Map<string, VideoProxyJob>()
  private readonly times = new Map<string, number>()
  private readonly epochs = new Map<string, number>()
  private readonly blocked = new Map<string, string | true>()

  epoch(path: string) {
    return this.epochs.get(path) ?? 0
  }

  cached(path: string, now = Date.now()) {
    return now - (this.times.get(path) ?? 0) < 30000 ? this.infos.get(path) : undefined
  }

  invalidate(path: string, block = true) {
    this.epochs.set(path, this.epoch(path) + 1)
    this.infos.delete(path)
    this.jobs.delete(path)
    this.times.delete(path)
    if (block) this.blocked.set(path, true)
    else this.blocked.delete(path)
  }

  acceptInfo(path: string, epoch: number, value: VideoMediaInfo) {
    if (epoch !== this.epoch(path)) return false
    const previous = this.infos.get(path)
    const job = this.jobs.get(path)
    const changed =
      (previous && previous.fingerprint !== value.fingerprint) ||
      (job && job.fingerprint !== value.fingerprint)
    const missing = !value.proxy_url && job?.state === 'succeeded'
    if (changed || missing) {
      this.jobs.delete(path)
      if (this.blocked.get(path) !== true) this.blocked.delete(path)
    }
    this.infos.set(path, value)
    this.times.set(path, Date.now())
    return true
  }

  acceptJob(path: string, epoch: number, value: VideoProxyJob, expectedId?: string) {
    if (epoch !== this.epoch(path)) return false
    if (expectedId && this.jobs.get(path)?.id !== expectedId) return false
    this.jobs.set(path, value)
    this.blocked.set(path, value.fingerprint)
    if (value.state === 'succeeded') {
      // Completion is newer than any metadata request that began before it.
      this.epochs.set(path, epoch + 1)
      this.times.delete(path)
      const info = this.infos.get(path)
      if (info?.fingerprint === value.fingerprint)
        this.infos.set(path, { ...info, proxy_url: value.proxy_url ?? null })
      else this.infos.delete(path)
    }
    return true
  }

  canPrepare(path: string, fingerprint: string, force: boolean) {
    const blocked = this.blocked.get(path)
    return force || (blocked !== true && blocked !== fingerprint)
  }

  proxyVersion(path: string) {
    const info = this.infos.get(path)
    const job = this.jobs.get(path)
    if (info?.proxy_url) return info.fingerprint
    if (job?.state === 'succeeded' && (!info || info.fingerprint === job.fingerprint))
      return job.fingerprint
    return undefined
  }
}
