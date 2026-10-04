import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../shared/apiClient'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import type {
  StudioDocument,
  StudioImageLayer
} from '../../../src/features/image-editor/model/imageStudioModel'
import { studioLayerLocked } from '../../../src/features/image-editor/model/imageStudioModel'
import {
  applyCutoutResult,
  recoverImageToolResult,
  acceptedImageToolJobs,
  cutoutRevision,
  currentCutoutJobs,
  emptyCutoutHints,
  previousCutout,
  imageToolName,
  isCutoutJob,
  isUpscaleJob,
  isEraseJob,
  type CutoutHints,
  type ImageToolJob
} from '../../../src/features/image-editor/model/imageStudioCutout'
import { cutoutInput, imageToolDimensions } from './imageCutoutInput'
import { ImageToolReceipts } from './imageToolReceipts'
import { submitImageToolRequest } from './imageToolSubmission'
import { sha256Hex } from '../../../src/shared/lib/sha256'
import { eraseMask } from './imageEraseInput'
import {
  emptyEraseDraft,
  erasePlan,
  type EraseDraft,
  type EraseSettings
} from '../../../src/features/image-editor/model/imageStudioErase'
import type { UpscaleResolution } from '../../../src/features/image-editor/model/imageStudioUpscale'

export function useImageAITasks({
  documentKey,
  doc,
  layer,
  assetInfo,
  readonly,
  onUpdate,
  onError,
  canApply
}: {
  documentKey: string
  doc: StudioDocument
  layer?: StudioImageLayer
  assetInfo: Record<string, FileNodeInfo>
  readonly: boolean
  onUpdate: (doc: StudioDocument) => void
  onError: (error: string) => void
  canApply: () => boolean
}) {
  const [jobs, setJobs] = useState<ImageToolJob[]>([])
  const [config, setConfig] = useState<{
    ready: boolean
    workflow_name: string
    defaults: { refine_iterations: number; trim_transparent: boolean }
  }>()
  const [connectionError, setConnectionError] = useState('')
  const [upscaleConfig, setUpscaleConfig] = useState<{
    ready: boolean
    workflow_name: string
    defaults: { target_resolution: UpscaleResolution }
  }>()
  const [resolutions, setResolutions] = useState<Record<string, UpscaleResolution>>({})
  const [eraseConfig, setEraseConfig] = useState<{
    ready: boolean
    workflow_name: string
    defaults: EraseSettings
    factory_defaults: EraseSettings
  }>()
  const [eraseDrafts, setEraseDrafts] = useState<
    Record<string, { key: string; draft: EraseDraft }>
  >({})
  const [erasePreview, setErasePreview] = useState<{
    layerId: string
    jobId?: string
    view: 'selection' | 'before' | 'after'
  }>()
  const [eraseMode, setEraseMode] = useState<'paint' | 'erase'>('paint')
  const [eraseBrush, setEraseBrush] = useState(24)
  const [eraseDimensions, setEraseDimensions] = useState<{
    key: string
    width: number
    height: number
  }>()
  const [eraseDimensionError, setEraseDimensionError] = useState('')
  const [upscalePreview, setUpscalePreview] = useState<{
    layerId: string
    jobId?: string
    view: 'before' | 'after'
  }>()
  const [drafts, setDrafts] = useState<Record<string, { key: string; hints: CutoutHints }>>({})
  const [accepting, setAccepting] = useState('')
  const [preparing, setPreparing] = useState('')
  const [preparingTool, setPreparingTool] = useState<'cutout' | 'upscale' | 'erase'>('cutout')
  const [preview, setPreview] = useState<{
    layerId: string
    jobId?: string
    view: 'selection' | 'before' | 'after'
  }>()
  const [pointKind, setPointKind] = useState<'positive' | 'negative'>('positive')
  const [receipts] = useState(() => new ImageToolReceipts())
  const handled = useRef(receipts.handled)
  const canceled = useRef(new Set<string>())
  const accepted = useRef(new Map<string, number>())
  const posting = useRef(false)
  const mounted = useRef(true)
  const latest = useRef({ doc, readonly, onUpdate, onError, canApply })
  latest.current = { doc, readonly, onUpdate, onError, canApply }
  const cutoutJobs = jobs.filter(isCutoutJob)
  const upscaleJobs = jobs.filter(isUpscaleJob)
  const eraseJobs = jobs.filter(isEraseJob)
  const previousErase = previousCutout(layer, eraseJobs)
  const acceptedAt = Math.max(
    0,
    ...jobs.filter((job) => job.layer_id === layer?.id).map((job) => job.accepted_at || 0)
  )
  const currentTask = (job: ImageToolJob) =>
    job.layer_id === layer?.id && !job.accepted_at && (!acceptedAt || job.created_at > acceptedAt)
  const currentErase = eraseJobs.find(currentTask)
  const eraseKey = layer
    ? `${layer.id}:${previousErase?.source.path || cutoutRevision(layer)}:${acceptedAt}`
    : ''
  const savedErase = layer && eraseDrafts[layer.id]
  const eraseDraft =
    savedErase && savedErase.key === eraseKey
      ? savedErase.draft
      : previousErase
        ? {
            ...emptyEraseDraft(previousErase),
            strokes: previousErase.strokes,
            bounds: previousErase.mask_asset.bounds,
            context: previousErase.context_box,
            range: 'manual' as const,
            linked: false
          }
        : emptyEraseDraft(eraseConfig?.defaults)
  const eraseView =
    erasePreview?.layerId === layer?.id && erasePreview?.jobId === previousErase?.id
      ? (erasePreview?.view ?? 'selection')
      : previousErase
        ? 'after'
        : 'selection'
  function setEraseView(view: 'selection' | 'before' | 'after') {
    if (layer) setErasePreview({ layerId: layer.id, jobId: previousErase?.id, view })
  }
  function setEraseDraft(draft: EraseDraft) {
    if (layer) setEraseDrafts((values) => ({ ...values, [layer.id]: { key: eraseKey, draft } }))
  }
  useEffect(() => {
    let active = true
    setEraseDimensionError('')
    if (layer)
      void imageToolDimensions(layer, assetInfo, previousErase)
        .then((size) => {
          if (active) setEraseDimensions({ ...size, key: eraseKey })
        })
        .catch(() => {
          if (active) setEraseDimensionError('无法读取消除输入尺寸')
        })
    return () => {
      active = false
    }
  }, [eraseKey, assetInfo])
  const eraseSize = eraseDimensions?.key === eraseKey ? eraseDimensions : undefined
  const previous = previousCutout(layer, cutoutJobs)
  const previousUpscale = previousCutout(layer, upscaleJobs)
  const currentJob = cutoutJobs.find(currentTask)
  const currentUpscale = upscaleJobs.find(currentTask)
  const cutoutKey = layer
    ? `${layer.id}:${previous?.source.path || cutoutRevision(layer)}:${acceptedAt}`
    : ''
  const resolution =
    (layer && resolutions[layer.id]) ||
    previousUpscale?.target_resolution ||
    (previousUpscale?.multiplier === 1 ? 'original' : undefined) ||
    upscaleConfig?.defaults.target_resolution ||
    '4K'
  const upscaleView =
    upscalePreview?.layerId === layer?.id && upscalePreview?.jobId === previousUpscale?.id
      ? (upscalePreview?.view ?? 'after')
      : 'after'
  function setUpscaleView(view: 'before' | 'after') {
    if (layer) setUpscalePreview({ layerId: layer.id, jobId: previousUpscale?.id, view })
  }
  const view =
    preview?.layerId === layer?.id && preview?.jobId === previous?.id
      ? (preview?.view ?? 'selection')
      : previous
        ? 'after'
        : 'selection'
  function setView(view: 'selection' | 'before' | 'after') {
    if (layer) setPreview({ layerId: layer.id, jobId: previous?.id, view })
  }
  const savedHints = layer && drafts[layer.id]
  const hints =
    (savedHints && savedHints.key === cutoutKey ? savedHints.hints : undefined) ||
    previous ||
    emptyCutoutHints(config?.defaults.refine_iterations, config?.defaults.trim_transparent)
  const pending = jobs.filter((job) => ['queued', 'running'].includes(job.state))
  const processingIds = [
    ...new Set([
      ...(preparing ? [preparing] : []),
      ...jobs
        .filter(
          (job) =>
            !canceled.current.has(job.id) &&
            (['queued', 'running'].includes(job.state) ||
              (job.state === 'completed' && !job.handled && !handled.current.has(job.id)))
        )
        .map((job) => job.layer_id)
    ])
  ]
  const busy = !!layer && processingIds.includes(layer.id)
  const processingLabels = Object.fromEntries(
    processingIds.map((id) => {
      const job = jobs.find(
        (job) => job.layer_id === id && (['queued', 'running'].includes(job.state) || !job.handled)
      )
      const name =
        id === preparing
          ? preparingTool === 'upscale'
            ? '高清化'
            : preparingTool === 'erase'
              ? '消除'
              : '抠图'
          : job
            ? imageToolName(job)
            : '处理'
      return [id, `正在${name}…`]
    })
  )
  const receiptKey = `omnigallery:image-tool-receipts-v2:${documentKey}`
  function remember() {
    try {
      localStorage.setItem(
        receiptKey,
        JSON.stringify({ handled: [...receipts.durable], canceled: [...canceled.current] })
      )
    } catch {
      /* Server acknowledgements remain authoritative when browser storage is unavailable. */
    }
  }

  function setHints(next: CutoutHints) {
    if (layer) setDrafts((values) => ({ ...values, [layer.id]: { key: cutoutKey, hints: next } }))
  }
  async function acknowledge(
    job: Pick<ImageToolJob, 'id'>,
    action: 'handled' | 'cancel' | 'accept'
  ) {
    return apiFetch<ImageToolJob>(
      `/image-ai-tools/tasks/${job.id}/${action}?document_key=${documentKey}`,
      { method: 'POST' }
    )
  }

  function captureSave() {
    const saved = receipts.captureSave()
    return () => {
      const ids = saved()
      remember()
      for (const id of ids) void acknowledge({ id }, 'handled').catch(() => {})
    }
  }

  useEffect(() => {
    mounted.current = true
    try {
      const stored = JSON.parse(localStorage.getItem(receiptKey) || '{}')
      for (const id of stored.handled || []) {
        if (typeof id !== 'string') continue
        handled.current.add(id)
        receipts.durable.add(id)
      }
      const legacy = JSON.parse(
        localStorage.getItem(`omnigallery:cutout-receipts:${documentKey}`) || '{}'
      )
      for (const id of [...(stored.canceled || []), ...(legacy.canceled || [])])
        if (typeof id === 'string') canceled.current.add(id)
    } catch {
      /* Ignore obsolete local receipts; server task state and content revisions still protect edits. */
    }
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    let errors = 0
    async function poll() {
      try {
        const result = await apiFetch<{ items: ImageToolJob[] }>(
          `/image-ai-tools/tasks?document_key=${documentKey}`
        )
        if (stopped) return
        errors = 0
        setConnectionError('')
        const items = currentCutoutJobs(acceptedImageToolJobs(result.items, accepted.current))
        setJobs(items)
        const state = latest.current
        if (!state.readonly && state.canApply()) {
          let next = state.doc
          for (const job of items) {
            if (job.state === 'failed' && !handled.current.has(job.id)) {
              state.onError(`${job.layer_name || '图片'}${imageToolName(job)}失败：${job.error}`)
              handled.current.add(job.id)
              remember()
            }
            if (canceled.current.has(job.id) && job.state !== 'canceled') {
              void acknowledge(job, 'cancel').catch(() => {})
              continue
            }
            if (job.state !== 'completed' || job.handled || canceled.current.has(job.id)) continue
            if (!handled.current.has(job.id)) {
              const alreadyApplied = next.layers.some(
                (l) =>
                  l.kind === 'image' &&
                  l.id === job.layer_id &&
                  l.path.replace(/^snapshot:/, 'editor-asset:') === job.result?.path
              )
              const updated = alreadyApplied ? undefined : applyCutoutResult(next, job)
              if (updated) next = updated
              else if (!alreadyApplied)
                state.onError(
                  `${imageToolName(job)}已完成，但目标图层已变化或被删除，结果未自动应用。请重新选择图片后处理。`
                )
              handled.current.add(job.id)
              remember()
            }
            // A failed/unfinished document save must leave this result recoverable on reopen.
            if (receipts.durable.has(job.id)) void acknowledge(job, 'handled').catch(() => {})
          }
          if (next !== state.doc) {
            latest.current.doc = next
            state.onUpdate(next)
          }
        }
      } catch {
        if (stopped) return
        errors++
        setConnectionError('无法获取 AI 处理状态，正在重连…')
      }
      if (!stopped) timer = setTimeout(poll, Math.min(15000, errors ? 3000 * errors : 2000))
    }
    void poll()
    const refreshConfig = () => {
      void apiFetch<NonNullable<typeof eraseConfig>>('/image-erase/config')
        .then((value) => {
          if (!stopped) setEraseConfig(value)
        })
        .catch(() => {
          if (!stopped) setConnectionError('无法读取消除配置')
        })
      void apiFetch<NonNullable<typeof upscaleConfig>>('/image-upscale/config')
        .then((value) => {
          if (!stopped) setUpscaleConfig(value)
        })
        .catch(() => {
          if (!stopped) setConnectionError('无法读取高清化配置')
        })
      void apiFetch<NonNullable<typeof config>>('/image-cutout/config')
        .then((value) => {
          if (!stopped) setConfig(value)
        })
        .catch(() => {
          if (!stopped) setConnectionError('无法读取抠图配置')
        })
    }
    refreshConfig()
    const configChannel = new BroadcastChannel('omnigallery:builtin-tools')
    configChannel.onmessage = refreshConfig
    window.addEventListener('focus', refreshConfig)
    return () => {
      stopped = true
      mounted.current = false
      clearTimeout(timer)
      configChannel.close()
      window.removeEventListener('focus', refreshConfig)
    }
  }, [documentKey])

  function recovery(toolJobs: ImageToolJob[]) {
    const job = toolJobs.find((item) => item.layer_id === layer?.id && item.state === 'completed')
    return {
      recoverable: !!job && !!recoverImageToolResult(doc, job, jobs),
      recover: () => {
        const state = latest.current
        if (!job || state.readonly || busy || posting.current || !state.canApply()) return
        const next = recoverImageToolResult(state.doc, job, jobs)
        if (!next) return
        handled.current.add(job.id)
        latest.current.doc = next
        state.onUpdate(next)
      }
    }
  }

  async function start(operation: 'cutout' | 'upscale' | 'erase' = 'cutout') {
    if (!layer || readonly || busy || posting.current) return
    posting.current = true
    setPreparingTool(operation)
    setPreparing(layer.id)
    const name = operation === 'erase' ? '消除' : operation === 'upscale' ? '高清化' : '抠图'
    const source = structuredClone(layer)
    const sourceRevision = cutoutRevision(source)
    try {
      const png = await cutoutInput(
        doc,
        source,
        assetInfo,
        operation === 'erase'
          ? previousErase
          : operation === 'upscale'
            ? previousUpscale
            : previous,
        operation === 'upscale' ? resolution : undefined,
        operation === 'cutout'
      )
      let eraseRequest = {}
      if (operation === 'erase') {
        if (!eraseSize) throw new Error('无法读取图片尺寸')
        const mask = eraseMask(eraseDraft.strokes, eraseSize)
        if (!mask.bounds) throw new Error('请先涂抹需要消除的区域')
        const plan = erasePlan({ ...eraseDraft, bounds: mask.bounds }, eraseSize)
        eraseRequest = {
          prompt: eraseDraft.prompt,
          blend_pixels: eraseDraft.blend_pixels,
          output_width: plan.target.width,
          output_height: plan.target.height,
          context_box: plan.context,
          processing_box: plan.processing,
          strokes: eraseDraft.strokes,
          mask_png_base64: mask.canvas.toDataURL('image/png').split(',')[1]
        }
        mask.canvas.width = mask.canvas.height = 0
      }
      if (!mounted.current) return
      const current = latest.current.doc.layers.find((l) => l.id === source.id)
      if (
        current?.kind !== 'image' ||
        studioLayerLocked(latest.current.doc, current) ||
        cutoutRevision(current) !== sourceRevision
      )
        throw new Error(`图片已变化，请重新开始${name}`)
      const request = {
        document_key: documentKey,
        layer_id: source.id,
        layer_name: source.name,
        source_revision: sourceRevision,
        png_base64: png,
        ...(operation === 'erase'
          ? eraseRequest
          : operation === 'upscale'
            ? { target_resolution: resolution }
            : {
                mode: hints.mode,
                positive: hints.mode === 'points' ? hints.positive : [],
                negative: hints.mode === 'points' ? hints.negative : [],
                box: hints.mode === 'box' ? hints.box : null,
                refine_iterations: hints.refine_iterations,
                trim_transparent: hints.trim_transparent ?? false,
                source_bounds: previous?.result_bounds ?? null
              })
      }
      const job = await submitImageToolRequest(
        localStorage,
        sha256Hex(JSON.stringify({ operation, request })),
        (id) =>
          apiFetch<ImageToolJob>(`/image-${operation}/tasks`, {
            method: 'POST',
            body: JSON.stringify({ ...request, id })
          })
      )
      if (mounted.current)
        setJobs((values) => currentCutoutJobs([job, ...values.filter((v) => v.id !== job.id)]))
    } catch (reason) {
      if (mounted.current) onError(String(reason))
    } finally {
      posting.current = false
      if (mounted.current) setPreparing('')
    }
  }
  async function cancel(job: ImageToolJob) {
    // Stop local application immediately, including a result racing this request.
    canceled.current.add(job.id)
    remember()
    try {
      const canceledJob = await acknowledge(job, 'cancel')
      if (mounted.current)
        setJobs((values) => values.map((value) => (value.id === job.id ? canceledJob : value)))
    } catch (reason) {
      if (mounted.current) onError(`取消请求未确认，请重试。${String(reason)}`)
    }
  }
  async function accept(job?: ImageToolJob) {
    if (!job || readonly || busy || posting.current) return
    const state = latest.current
    const target = state.doc.layers.find((item) => item.id === job.layer_id)
    if (
      state.readonly ||
      !state.canApply() ||
      target?.kind !== 'image' ||
      studioLayerLocked(state.doc, target) ||
      !previousCutout(target, [job])
    )
      return
    posting.current = true
    setAccepting(job.id)
    try {
      // Adopting is an explicit decision even in a media session that has not saved the file.
      for (const sibling of jobs)
        if (sibling.layer_id === job.layer_id && handled.current.has(sibling.id))
          await acknowledge(sibling, 'handled')
      const receipt = await acknowledge(job, 'accept')
      if (!mounted.current || !receipt.accepted_at) return
      accepted.current.set(
        job.layer_id,
        Math.max(accepted.current.get(job.layer_id) || 0, receipt.accepted_at)
      )
      handled.current.add(job.id)
      remember()
      setJobs((values) => acceptedImageToolJobs(values, accepted.current))
      setPreview(undefined)
      setUpscalePreview(undefined)
      setErasePreview(undefined)
      setPointKind('positive')
      setEraseMode('paint')
    } catch (reason) {
      if (mounted.current) onError(`采用结果失败，请重试。${String(reason)}`)
    } finally {
      posting.current = false
      if (mounted.current) setAccepting('')
    }
  }
  return {
    captureSave,
    ...recovery(cutoutJobs),
    hints,
    setHints,
    pointKind,
    setPointKind,
    previous,
    currentJob,
    view,
    setView,
    pending,
    jobs,
    busy,
    preparing,
    processingIds,
    processingLabels,
    config,
    connectionError,
    start,
    cancel,
    accepting,
    accept: () => accept(previous),
    erase: {
      ...recovery(eraseJobs),
      draft: eraseDraft,
      setDraft: setEraseDraft,
      mode: eraseMode,
      setMode: setEraseMode,
      brush: eraseBrush,
      setBrush: setEraseBrush,
      size: eraseSize,
      dimensionError: eraseDimensionError,
      previous: previousErase,
      currentJob: currentErase,
      view: eraseView,
      setView: setEraseView,
      busy,
      preparing: preparingTool === 'erase' ? preparing : '',
      config: eraseConfig,
      connectionError,
      start: () => start('erase'),
      cancel,
      accepting,
      accept: () => accept(previousErase)
    },
    upscale: {
      ...recovery(upscaleJobs),
      resolution,
      setResolution: (value: UpscaleResolution) => {
        if (layer) setResolutions((values) => ({ ...values, [layer.id]: value }))
      },
      previous: previousUpscale,
      currentJob: currentUpscale,
      view: upscaleView,
      setView: setUpscaleView,
      busy,
      preparing: preparingTool === 'upscale' ? preparing : '',
      config: upscaleConfig,
      connectionError,
      start: () => start('upscale'),
      cancel,
      accepting,
      accept: () => accept(previousUpscale)
    }
  }
}
