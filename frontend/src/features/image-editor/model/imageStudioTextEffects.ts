import type { StudioTextLayer } from './imageStudioModel.ts'

export interface StudioTextEffects {
  fill: { mode: 'solid' | 'gradient'; endColor: string; angle: number }
  stroke: { enabled: boolean; color: string; width: number }
  shadow: { enabled: boolean; color: string; angle: number; distance: number; blur: number }
  glow: { enabled: boolean; color: string; range: number }
  background: { enabled: boolean; color: string; radius: number; opacity: number }
}

export const studioTextEffectDefaults: StudioTextEffects = {
  fill: { mode: 'solid', endColor: '#60a5fa', angle: 90 },
  stroke: { enabled: false, color: '#ffffff', width: 2 },
  shadow: { enabled: false, color: '#000000', angle: 45, distance: 6, blur: 4 },
  glow: { enabled: false, color: '#60a5fa', range: 12 },
  background: { enabled: false, color: '#111827', radius: 6, opacity: 0.8 }
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const number = (value: unknown, fallback: number, max: number, min = 0) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback
const color = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback

/** Old documents keep their plain fill; effect switches never discard their settings. */
export function readStudioTextEffects(value: unknown): StudioTextEffects {
  const raw = record(value)
  const fill = record(raw.fill),
    stroke = record(raw.stroke),
    shadow = record(raw.shadow),
    glow = record(raw.glow),
    background = record(raw.background)
  const defaults = studioTextEffectDefaults
  return {
    fill: {
      mode: fill.mode === 'gradient' ? 'gradient' : 'solid',
      endColor: color(fill.endColor, defaults.fill.endColor),
      angle: number(fill.angle, defaults.fill.angle, 360, -360)
    },
    stroke: {
      enabled: stroke.enabled === true,
      color: color(stroke.color, defaults.stroke.color),
      width: number(stroke.width, defaults.stroke.width, 1000)
    },
    shadow: {
      enabled: shadow.enabled === true,
      color: color(shadow.color, defaults.shadow.color),
      angle: number(shadow.angle, defaults.shadow.angle, 360, -360),
      distance: number(shadow.distance, defaults.shadow.distance, 2000),
      blur: number(shadow.blur, defaults.shadow.blur, 1000)
    },
    glow: {
      enabled: glow.enabled === true,
      color: color(glow.color, defaults.glow.color),
      range: number(glow.range, defaults.glow.range, 1000)
    },
    background: {
      enabled: background.enabled === true,
      color: color(background.color, defaults.background.color),
      radius: number(background.radius, defaults.background.radius, 1000),
      opacity: number(background.opacity, defaults.background.opacity, 1)
    }
  }
}

/** Include soft-effect tails in the bitmap and content export, without enlarging the editable frame. */
export function studioTextEffectInsets(layer: StudioTextLayer, includeFlip = true) {
  const effects = layer.effects
  const stroke = effects?.stroke.enabled ? effects.stroke.width / 2 : 0
  const glow = effects?.glow.enabled ? effects.glow.range * 3 : 0
  const shadow = effects?.shadow
  const blur = shadow?.enabled ? shadow.blur * 3 : 0
  const angle = ((shadow?.angle ?? 0) * Math.PI) / 180
  const dx = shadow?.enabled ? Math.cos(angle) * shadow.distance : 0
  const dy = shadow?.enabled ? Math.sin(angle) * shadow.distance : 0
  let left = Math.ceil(stroke + Math.max(glow, blur - dx, 0))
  let right = Math.ceil(stroke + Math.max(glow, blur + dx, 0))
  let top = Math.ceil(stroke + Math.max(glow, blur - dy, 0))
  let bottom = Math.ceil(stroke + Math.max(glow, blur + dy, 0))
  if (includeFlip && layer.flipX) [left, right] = [right, left]
  if (includeFlip && layer.flipY) [top, bottom] = [bottom, top]
  return { left, right, top, bottom }
}

export function scaleStudioTextEffects(effects: StudioTextEffects, scale: number) {
  effects.stroke.width *= scale
  effects.shadow.distance *= scale
  effects.shadow.blur *= scale
  effects.glow.range *= scale
  effects.background.radius *= scale
}
