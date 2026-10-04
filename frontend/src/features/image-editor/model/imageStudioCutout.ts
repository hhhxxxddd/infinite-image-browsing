import { sha256Hex } from '../../../shared/lib/sha256.ts'
import { studioFramePoint } from './imageStudioGeometry.ts'
import type { EraseSettings, EraseStroke, PixelBox } from './imageStudioErase.ts'
import {
  studioLayerLocked,
  type StudioDocument,
  type StudioImageLayer,
  type StudioPoint
} from './imageStudioModel.ts'

export type CutoutHints = {
  mode: 'points' | 'box'
  positive: StudioPoint[]
  negative: StudioPoint[]
  box: (StudioPoint & { width: number; height: number }) | null
  refine_iterations: number
  trim_transparent: boolean
}
export const emptyCutoutHints = (refinement = 3, trimTransparent = false): CutoutHints => ({
  mode: 'points',
  positive: [],
  negative: [],
  box: null,
  refine_iterations: refinement,
  trim_transparent: trimTransparent
})
export type CutoutAsset = { path: string; width: number; height: number }
export type ImageToolRecoveryStep = {
  source_revision: string
  source_bounds?: CutoutHints['box']
  result_bounds?: CutoutHints['box']
  result: CutoutAsset
}
export type ImageToolJob = {
  id: string
  document_key: string
  layer_id: string
  layer_name?: string
  source_revision: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
  source: CutoutAsset
  result?: CutoutAsset
  source_bounds?: CutoutHints['box']
  result_bounds?: CutoutHints['box']
  handled: boolean
  accepted_at?: number
  error: string
  created_at: number
  cloud_job_id?: string
  superseded?: boolean
  recovery_steps?: ImageToolRecoveryStep[]
  tool_id?: 'image-cutout-sam3' | 'image-upscale' | 'image-erase'
}
export type CutoutJob = CutoutHints & ImageToolJob
export type UpscaleJob = ImageToolJob & {
  multiplier?: 1 | 2 | 4
  target_resolution?: 'original' | '2K' | '4K' | '8K'
}
export type EraseJob = ImageToolJob &
  EraseSettings & {
    strokes: EraseStroke[]
    context_box: PixelBox
    processing_box: PixelBox
    mask_asset: CutoutAsset & { bounds: PixelBox }
  }
export const isEraseJob = (job: ImageToolJob): job is EraseJob => job.tool_id === 'image-erase'
export const isUpscaleJob = (job: ImageToolJob): job is UpscaleJob =>
  job.tool_id === 'image-upscale'
export const isCutoutJob = (job: ImageToolJob): job is CutoutJob =>
  !job.tool_id || job.tool_id === 'image-cutout-sam3'
export const imageToolName = (job: ImageToolJob) =>
  isEraseJob(job) ? '消除' : isUpscaleJob(job) ? '高清化' : '抠图'

/** Backwards-compatible reduction of task history into each layer's current tool slot. */
export function currentCutoutJobs<T extends ImageToolJob>(jobs: T[]): T[] {
  const current = new Set<string>()
  const completed = new Set<string>()
  return [...jobs]
    .filter((job) => !job.superseded)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .filter((job) => {
      const slot = `${job.layer_id}:${job.tool_id || 'image-cutout-sam3'}`
      const success = job.state === 'completed' && !!job.result
      const keep =
        !current.has(slot) ||
        (success && !completed.has(slot)) ||
        ['queued', 'running'].includes(job.state)
      current.add(slot)
      if (success) completed.add(slot)
      return keep
    })
}

/** Keep an acknowledged adoption from being reversed by an older in-flight poll. */
export function acceptedImageToolJobs<T extends ImageToolJob>(
  jobs: T[],
  accepted: ReadonlyMap<string, number>
): T[] {
  return jobs.map((job) => {
    const at = accepted.get(job.layer_id)
    return at && job.state === 'completed' && (job.created_at || 0) <= at
      ? { ...job, accepted_at: Math.max(at, job.accepted_at || 0), handled: true }
      : job
  })
}

/** Position is excluded so moving a processing layer does not invalidate its result. */
export function cutoutRevision(layer: StudioImageLayer) {
  return sha256Hex(
    JSON.stringify({
      path: layer.path.replace(/^snapshot:/, 'editor-asset:'),
      crop: layer.crop,
      fit: layer.fit,
      zoom: layer.zoom,
      focusX: layer.focusX,
      focusY: layer.focusY,
      flipX: !!layer.flipX,
      flipY: !!layer.flipY,
      brightness: layer.brightness,
      contrast: layer.contrast,
      radius: layer.radius,
      correction: layer.correction ?? null,
      aspect: Math.round((layer.width / layer.height) * 1e6)
    })
  )
}

export function cutoutLocalPoint(layer: StudioImageLayer, world: StudioPoint) {
  const local = studioFramePoint(layer, world)
  return {
    x: Math.max(0, Math.min(1, local.x / layer.width)),
    y: Math.max(0, Math.min(1, local.y / layer.height))
  }
}

export function cutoutBox(a: StudioPoint, b: StudioPoint) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

export function cutoutResultLayer(layer: StudioImageLayer, path: string): StudioImageLayer {
  return {
    ...layer,
    path,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    fit: 'stretch',
    zoom: 1,
    focusX: 0.5,
    focusY: 0.5,
    flipX: false,
    flipY: false,
    brightness: 100,
    contrast: 100,
    radius: 0,
    correction: undefined
  }
}

/** Map a source-relative rectangle into the layer's rotated canvas coordinates. */
function cutoutFrame(layer: StudioImageLayer, bounds: NonNullable<CutoutHints['box']>) {
  const width = layer.width * bounds.width
  const height = layer.height * bounds.height
  const dx = (bounds.x + bounds.width / 2 - 0.5) * layer.width
  const dy = (bounds.y + bounds.height / 2 - 0.5) * layer.height
  const angle = (layer.rotation * Math.PI) / 180
  return {
    ...layer,
    x: layer.x + layer.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle) - width / 2,
    y: layer.y + layer.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle) - height / 2,
    width,
    height
  }
}

/** Recover the original input frame for re-selection without stretching the cropped subject. */
export function cutoutInputLayer(layer: StudioImageLayer, bounds?: CutoutHints['box']) {
  if (!bounds) return layer
  return cutoutFrame(layer, {
    x: -bounds.x / bounds.width,
    y: -bounds.y / bounds.height,
    width: 1 / bounds.width,
    height: 1 / bounds.height
  })
}

export function applyCutoutResult(
  doc: StudioDocument,
  job: ImageToolJob
): StudioDocument | undefined {
  const layer = doc.layers.find((l) => l.id === job.layer_id)
  if (
    job.state !== 'completed' ||
    !!job.accepted_at ||
    !job.result ||
    layer?.kind !== 'image' ||
    studioLayerLocked(doc, layer) ||
    cutoutRevision(layer) !== job.source_revision
  )
    return undefined
  const path = job.result.path
  const input = cutoutInputLayer(layer, job.source_bounds)
  const frame = job.result_bounds ? cutoutFrame(input, job.result_bounds) : input
  return {
    ...doc,
    layers: doc.layers.map((l) => (l.id === layer.id ? cutoutResultLayer(frame, path) : l))
  }
}

/** Explicit recovery for a receipt acknowledged before its document was saved. */
export function recoverImageToolResult(
  doc: StudioDocument,
  job: ImageToolJob,
  history: ImageToolJob[] = [job]
) {
  const layer = doc.layers.find((item) => item.id === job.layer_id)
  if (
    job.superseded ||
    job.state !== 'completed' ||
    !job.result ||
    layer?.kind !== 'image' ||
    studioLayerLocked(doc, layer) ||
    layer.path.replace(/^snapshot:/, 'editor-asset:') === job.result?.path
  )
    return undefined
  // Follow exact content revisions through unsaved results, including retired comparisons.
  // Build in memory and publish only the requested final result as one undo operation.
  const steps = new Map<string, ImageToolRecoveryStep[]>()
  for (const item of [job, ...history]) {
    if (item.layer_id !== job.layer_id || item.state !== 'completed' || item.superseded) continue
    for (const step of [...(item.recovery_steps || []), ...(item.result ? [item] : [])]) {
      if (!step.result) continue
      const group = steps.get(step.source_revision) || []
      group.push({ ...step, result: step.result })
      steps.set(step.source_revision, group)
    }
  }
  const pending = [doc]
  const seen = new Set([cutoutRevision(layer)])
  for (let i = 0; i < pending.length; i++) {
    const state = pending[i]
    const restored = applyCutoutResult(state, { ...job, accepted_at: undefined })
    if (restored) return restored
    const current = state.layers.find((item) => item.id === job.layer_id) as StudioImageLayer
    for (const step of steps.get(cutoutRevision(current)) || []) {
      const next = applyCutoutResult(state, {
        ...job,
        ...step,
        accepted_at: undefined,
        source_bounds: step.source_bounds,
        result_bounds: step.result_bounds
      })
      if (!next) continue
      const image = next.layers.find((item) => item.id === job.layer_id) as StudioImageLayer
      const revision = cutoutRevision(image)
      if (!seen.has(revision)) {
        seen.add(revision)
        pending.push(next)
      }
    }
  }
  return undefined
}

/** Return to the saved input only while the previously applied image content is unchanged. */
export function previousCutout<T extends ImageToolJob>(
  layer: StudioImageLayer | undefined,
  jobs: T[]
): T | undefined {
  if (!layer) return undefined
  const job = currentCutoutJobs(jobs).find(
    (job) => job.layer_id === layer.id && job.state === 'completed' && job.result
  )
  return !job?.accepted_at &&
    job?.result?.path === layer.path.replace(/^snapshot:/, 'editor-asset:') &&
    cutoutRevision(layer) === cutoutRevision(cutoutResultLayer(layer, layer.path))
    ? job
    : undefined
}

/** Comparison is display-only: preserve every other layer, group and frame relationship. */
export function cutoutBeforeDocument(doc: StudioDocument, job?: ImageToolJob): StudioDocument {
  if (!job) return doc
  const layer = doc.layers.find((item) => item.id === job.layer_id)
  if (layer?.kind !== 'image' || !previousCutout(layer, [job])) return doc
  const before = cutoutResultLayer(cutoutInputLayer(layer, job.result_bounds), job.source.path)
  return { ...doc, layers: doc.layers.map((item) => (item.id === layer.id ? before : item)) }
}
