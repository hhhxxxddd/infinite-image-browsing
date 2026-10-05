import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { VideoMediaCache, type VideoMediaInfo, type VideoProxyJob } from './videoMediaCache'
export type { VideoMediaInfo, VideoProxyJob } from './videoMediaCache'

export type VideoPreviewMode = 'auto' | 'smooth' | 'original'
type Source = { path: string; kind: 'image' | 'video' | 'audio' }
class StaleMediaRequest extends Error {}

export function useVideoMedia(workspaceId: string, readonly: boolean) {
  const [mode, setMode] = useState<VideoPreviewMode>('auto')
  const [infos, setInfos] = useState<Record<string, VideoMediaInfo>>({})
  const [jobs, setJobs] = useState<Record<string, VideoProxyJob>>({})
  const [error, setError] = useState('')
  const [cache] = useState(() => new VideoMediaCache())
  const loading = useRef(new Map<string, { epoch: number; promise: Promise<VideoMediaInfo> }>())
  const preparing = useRef(new Set<string>())
  const clearing = useRef(new Set<string>())
  const policy = useRef({ mode, readonly })
  policy.current = { mode, readonly }
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const sync = useCallback(() => {
    if (!live.current) return
    setInfos(Object.fromEntries(cache.infos))
    setJobs(Object.fromEntries(cache.jobs))
  }, [cache])
  const query = useCallback(
    (path: string) => new URLSearchParams({ workspace_id: workspaceId, path }).toString(),
    [workspaceId]
  )
  const invalidate = useCallback(
    (path: string) => {
      cache.invalidate(path)
      sync()
    },
    [cache, sync]
  )

  const load = useCallback(
    (source: Source, force = false): Promise<VideoMediaInfo> => {
      const cached = !force && cache.cached(source.path)
      if (cached) return Promise.resolve(cached)
      const epoch = cache.epoch(source.path)
      const current = loading.current.get(source.path)
      if (current?.epoch === epoch) return current.promise
      const promise = apiFetch<VideoMediaInfo>(
        `/video_studio/media?${query(source.path)}&kind=${source.kind}`
      )
        .then((value) => {
          if (!cache.acceptInfo(source.path, epoch, value)) throw new StaleMediaRequest()
          sync()
          return value
        })
        .finally(() => {
          if (loading.current.get(source.path)?.promise === promise)
            loading.current.delete(source.path)
        })
      loading.current.set(source.path, { epoch, promise })
      return promise
    },
    [cache, query, sync]
  )

  const prepare = useCallback(
    async (source: Source, force = false) => {
      if (source.kind === 'image' || clearing.current.has(source.path)) return
      try {
        const info = await load(source, force)
        const current = policy.current
        if (
          source.kind !== 'video' ||
          current.mode === 'original' ||
          current.readonly ||
          !live.current
        )
          return
        const needsProxy =
          force ||
          current.mode === 'smooth' ||
          Math.max(info.width, info.height) >= 2560 ||
          !['h264', 'vp8', 'vp9', 'av1'].includes(info.video_codec)
        if (
          !needsProxy ||
          info.proxy_url ||
          preparing.current.has(source.path) ||
          clearing.current.has(source.path) ||
          !cache.canPrepare(source.path, info.fingerprint, force)
        )
          return
        preparing.current.add(source.path)
        const epoch = cache.epoch(source.path)
        try {
          const job = await apiFetch<VideoProxyJob>('/video_studio/proxies', {
            method: 'POST',
            body: JSON.stringify({ workspace_id: workspaceId, path: source.path })
          })
          if (!cache.acceptJob(source.path, epoch, job)) {
            // Clear/cancel may finish before an already dispatched POST reaches the server.
            if (['queued', 'running'].includes(job.state) && !policy.current.readonly)
              await apiFetch(
                `/video_studio/proxies/${job.id}/cancel?workspace_id=${encodeURIComponent(workspaceId)}`,
                { method: 'POST' }
              )
            return
          }
          sync()
        } finally {
          preparing.current.delete(source.path)
        }
      } catch (cause) {
        if (live.current && !(cause instanceof StaleMediaRequest))
          setError(cause instanceof Error ? cause.message : '读取视频素材失败')
      }
    },
    // Changing preview policy re-prepares the active sources in VideoStudio.
    [cache, load, mode, readonly, workspaceId, sync]
  )

  useEffect(() => {
    const active = Object.values(jobs).filter((job) => ['queued', 'running'].includes(job.state))
    if (!active.length) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void Promise.allSettled(
        active.map(async (job) => {
          const epoch = cache.epoch(job.path)
          try {
            const next = await apiFetch<VideoProxyJob>(
              `/video_studio/proxies/${job.id}?workspace_id=${encodeURIComponent(workspaceId)}`
            )
            if (!cancelled && cache.acceptJob(job.path, epoch, next, job.id)) sync()
          } catch (cause) {
            if (cancelled) return
            if (typeof cause === 'object' && cause && 'status' in cause && cause.status === 404) {
              if (cache.jobs.get(job.path)?.id === job.id) {
                invalidate(job.path)
                setError('代理任务已失效，已切回原片，可重新准备代理')
              }
              return
            }
            throw cause
          }
        })
      ).then((results) => {
        if (cancelled) return
        if (results.some((result) => result.status === 'rejected')) {
          setError('代理进度暂时无法读取，正在重试')
          sync()
        }
      })
    }, 1500)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [jobs, workspaceId, cache, invalidate, sync])

  const cancel = async (path: string) => {
    const job = cache.jobs.get(path)
    if (!job || policy.current.readonly) return
    invalidate(path)
    const epoch = cache.epoch(path)
    try {
      const next = await apiFetch<VideoProxyJob>(
        `/video_studio/proxies/${job.id}/cancel?workspace_id=${encodeURIComponent(workspaceId)}`,
        { method: 'POST' }
      )
      if (cache.acceptJob(path, epoch, next)) sync()
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '取消代理失败')
    }
  }
  const clear = async (path: string) => {
    if (policy.current.readonly || clearing.current.has(path)) return
    clearing.current.add(path)
    // Stop using the file before DELETE, and invalidate all earlier metadata/poll responses.
    invalidate(path)
    try {
      await apiFetch(`/video_studio/proxy?${query(path)}`, { method: 'DELETE' })
      invalidate(path)
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : '清理代理失败')
    } finally {
      clearing.current.delete(path)
    }
  }
  const proxyUrl = (path: string) => {
    const version = cache.proxyVersion(path)
    return mode !== 'original' && version
      ? apiUrl(`/video_studio/proxy?${query(path)}&v=${encodeURIComponent(version)}`)
      : undefined
  }
  return {
    mode,
    setMode,
    infos,
    jobs,
    load,
    prepare,
    cancel,
    clear,
    invalidate,
    proxyUrl,
    error,
    clearError: () => setError('')
  }
}
