/** Coordinates are the cropped/fitted, untransformed document plane. */
export interface LocalVideoRegion {
  id: string
  shape: 'rectangle' | 'ellipse'
  effect: 'mask' | 'blur' | 'mosaic'
  x: number
  y: number
  width: number
  height: number
  invert: boolean
  /** Symmetric feather width, as a fraction of the shorter canvas edge. */
  feather: number
  strength: number
}

export interface LocalVideoEffects {
  exposure: number
  temperature: number
  tint: number
  gamma: number
  regions: LocalVideoRegion[]
}

export const MAX_LOCAL_VIDEO_REGIONS = 8
export const MAX_LOCAL_PREVIEW_PIXELS = 1920 * 1080
export function defaultLocalVideoEffects(): LocalVideoEffects {
  return { exposure: 0, temperature: 0, tint: 0, gamma: 1, regions: [] }
}

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value))
function finite(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
}

/** Reject bad persisted input instead of silently changing an edit during export. */
export function validateLocalVideoEffects(value: unknown): value is LocalVideoEffects {
  if (!value || typeof value !== 'object') return false
  const item = value as LocalVideoEffects
  if (
    !finite(item.exposure, -2, 2) ||
    !finite(item.temperature, -1, 1) ||
    !finite(item.tint, -1, 1) ||
    !finite(item.gamma, 0.25, 4) ||
    !Array.isArray(item.regions) ||
    item.regions.length > MAX_LOCAL_VIDEO_REGIONS
  )
    return false
  const ids = new Set<string>()
  return item.regions.every((r) => {
    if (
      !r ||
      typeof r.id !== 'string' ||
      !r.id ||
      r.id.length > 80 ||
      ids.has(r.id) ||
      !['rectangle', 'ellipse'].includes(r.shape) ||
      !['mask', 'blur', 'mosaic'].includes(r.effect) ||
      !finite(r.x, 0, 1) ||
      !finite(r.y, 0, 1) ||
      !finite(r.width, 0.001, 1) ||
      !finite(r.height, 0.001, 1) ||
      r.x + r.width > 1 + 1e-9 ||
      r.y + r.height > 1 + 1e-9 ||
      typeof r.invert !== 'boolean' ||
      !finite(r.feather, 0, 0.25) ||
      !finite(r.strength, 0, 1)
    )
      return false
    ids.add(r.id)
    return true
  })
}

export function hasLocalVideoEffects(value?: LocalVideoEffects): boolean {
  return (
    !!value &&
    (value.exposure !== 0 ||
      value.temperature !== 0 ||
      value.tint !== 0 ||
      value.gamma !== 1 ||
      value.regions.some((r) => r.effect === 'mask' || r.strength > 0))
  )
}

export function localColorChannel(value: number, channel: number, effects: LocalVideoEffects) {
  const balances = [
    1 + effects.temperature * 0.25 - effects.tint * 0.125,
    1 + effects.tint * 0.25,
    1 - effects.temperature * 0.25 - effects.tint * 0.125
  ]
  return (
    255 *
    Math.pow(
      clamp((value / 255) * Math.pow(2, effects.exposure) * balances[channel]),
      1 / effects.gamma
    )
  )
}

/** Sample at pixel centers, exactly as the FFmpeg mask expression does. */
export function localRegionCoverage(
  region: LocalVideoRegion,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const px = x + 0.5,
    py = y + 0.5
  const left = region.x * width,
    top = region.y * height
  const rw = region.width * width,
    rh = region.height * height
  const distance =
    region.shape === 'rectangle'
      ? Math.min(px - left, left + rw - px, py - top, top + rh - py)
      : ((1 - Math.hypot((px - left - rw / 2) / (rw / 2), (py - top - rh / 2) / (rh / 2))) *
          Math.min(rw, rh)) /
        2
  const feather = region.feather * Math.min(width, height)
  const inside = feather > 0 ? clamp(distance / feather + 0.5) : Number(distance >= 0)
  return region.invert ? 1 - inside : inside
}

export function localBlurRadius(region: LocalVideoRegion, width: number, height: number) {
  return Math.min(
    Math.floor(Math.min(width, height) / 2),
    Math.max(1, Math.floor(region.strength * 0.04 * Math.min(width, height) + 0.5))
  )
}
export function localMosaicSize(region: LocalVideoRegion, width: number, height: number) {
  return Math.max(2, Math.floor(region.strength * 0.08 * Math.min(width, height) + 0.5))
}

export function regionFromDrag(start: { x: number; y: number }, end: { x: number; y: number }) {
  const x = clamp(Math.min(start.x, end.x), 0, 0.999),
    y = clamp(Math.min(start.y, end.y), 0, 0.999)
  return {
    x,
    y,
    width: Math.max(0.001, clamp(Math.max(start.x, end.x)) - x),
    height: Math.max(0.001, clamp(Math.max(start.y, end.y)) - y)
  }
}

export function moveLocalRegion(
  region: LocalVideoRegion,
  dx: number,
  dy: number
): LocalVideoRegion {
  return {
    ...region,
    x: clamp(region.x + dx, 0, 1 - region.width),
    y: clamp(region.y + dy, 0, 1 - region.height)
  }
}

interface Scratch {
  base: Uint8ClampedArray
  blurred: Uint8ClampedArray
  line: Uint8ClampedArray
}
const scratchByCanvas = new WeakMap<HTMLCanvasElement, Scratch>()
function reflect(index: number, length: number) {
  if (index < 0) return -index - 1
  if (index >= length) return length * 2 - index - 1
  return index
}

/** Two separable box passes; scratch is O(frame pixels), independent of region count. */
function boxBlur(
  base: Uint8ClampedArray,
  result: Uint8ClampedArray,
  line: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
) {
  result.set(base)
  if (radius <= 0) return
  const divisor = radius * 2 + 1
  for (let channel = 0; channel < 3; channel++) {
    for (let y = 0; y < height; y++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++)
        sum += base[(y * width + reflect(k, width)) * 4 + channel]
      for (let x = 0; x < width; x++) {
        line[y * width + x] = Math.floor(sum / divisor + 0.5)
        sum +=
          base[(y * width + reflect(x + radius + 1, width)) * 4 + channel] -
          base[(y * width + reflect(x - radius, width)) * 4 + channel]
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) sum += line[reflect(k, height) * width + x]
      for (let y = 0; y < height; y++) {
        result[(y * width + x) * 4 + channel] = Math.floor(sum / divisor + 0.5)
        sum +=
          line[reflect(y + radius + 1, height) * width + x] -
          line[reflect(y - radius, height) * width + x]
      }
    }
  }
}

/** Exposure/balance/gamma, then regions in list order; alpha is never flattened. */
export function processLocalVideoPixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  effects: LocalVideoEffects,
  reusable?: Scratch
) {
  if (!validateLocalVideoEffects(effects)) throw new Error('局部效果参数无效')
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_LOCAL_PREVIEW_PIXELS ||
    data.length !== width * height * 4
  )
    throw new Error('局部效果预览帧尺寸无效')
  if (!hasLocalVideoEffects(effects)) return
  const scratch = reusable ?? {
    base: new Uint8ClampedArray(data.length),
    blurred: new Uint8ClampedArray(data.length),
    line: new Uint8ClampedArray(width * height)
  }
  const colored =
    effects.exposure !== 0 || effects.temperature !== 0 || effects.tint !== 0 || effects.gamma !== 1
  if (colored) {
    const tables = [0, 1, 2].map((channel) =>
      Uint8Array.from({ length: 256 }, (_, value) =>
        Math.floor(localColorChannel(value, channel, effects))
      )
    )
    for (let index = 0; index < data.length; index += 4)
      for (let c = 0; c < 3; c++) data[index + c] = tables[c][data[index + c]]
  }
  for (const region of effects.regions) {
    if (region.effect !== 'mask' && region.strength === 0) continue
    if (region.effect !== 'mask') scratch.base.set(data)
    if (region.effect === 'blur')
      boxBlur(
        scratch.base,
        scratch.blurred,
        scratch.line,
        width,
        height,
        localBlurRadius(region, width, height)
      )
    const block = localMosaicSize(region, width, height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let coverage = localRegionCoverage(region, x, y, width, height)
        if (coverage <= 0) continue
        const offset = (y * width + x) * 4
        if (region.effect === 'mask') {
          data[offset + 3] = Math.floor(data[offset + 3] * (1 - coverage))
          continue
        }
        // FFmpeg maskedmerge uses an 8-bit mask; mosaic geq uses the continuous weight.
        if (region.effect === 'blur') coverage = Math.floor(coverage * 255) / 255
        const sample =
          region.effect === 'blur'
            ? offset
            : (Math.min(height - 1, Math.floor(y / block) * block + Math.floor(block / 2)) * width +
                Math.min(width - 1, Math.floor(x / block) * block + Math.floor(block / 2))) *
              4
        const processed = region.effect === 'blur' ? scratch.blurred : scratch.base
        for (let c = 0; c < 3; c++)
          data[offset + c] = Math.floor(
            scratch.base[offset + c] * (1 - coverage) +
              processed[sample + c] * coverage +
              (region.effect === 'blur' ? 0.5 : 0)
          )
      }
  }
}

export function applyLocalVideoEffects(canvas: HTMLCanvasElement, effects?: LocalVideoEffects) {
  if (!effects || !hasLocalVideoEffects(effects)) return
  if (canvas.width * canvas.height > MAX_LOCAL_PREVIEW_PIXELS)
    throw new Error('请使用当前画面的小尺寸预览帧')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法读取预览画面')
  const frame = context.getImageData(0, 0, canvas.width, canvas.height)
  let scratch = scratchByCanvas.get(canvas)
  if (!scratch || scratch.base.length !== frame.data.length) {
    scratch = {
      base: new Uint8ClampedArray(frame.data.length),
      blurred: new Uint8ClampedArray(frame.data.length),
      line: new Uint8ClampedArray(canvas.width * canvas.height)
    }
    scratchByCanvas.set(canvas, scratch)
  }
  processLocalVideoPixels(frame.data, canvas.width, canvas.height, effects, scratch)
  context.putImageData(frame, 0, 0)
}
