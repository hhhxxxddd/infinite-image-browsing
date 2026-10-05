export interface AudioProcessing {
  denoise: 'off' | 'light' | 'strong'
  equalizer: 'flat' | 'voice' | 'warm' | 'bright' | 'custom'
  compressor: 'off' | 'gentle' | 'voice' | 'custom'
  deess: boolean
  normalize: 'off' | 'voice' | 'music'
  limiter: boolean
  bypass?: boolean
  eq?: { low: number; mid: number; high: number }
  compression?: {
    thresholdDb: number
    ratio: number
    attack: number
    release: number
    makeupDb: number
  }
}
export type FadeCurve = 'linear' | 'smooth' | 'equalPower'
export function fadeGain(progress: number, curve: FadeCurve = 'linear') {
  const t = Math.max(0, Math.min(1, progress))
  return curve === 'smooth'
    ? t * t * (3 - 2 * t)
    : curve === 'equalPower'
      ? Math.sin((t * Math.PI) / 2)
      : t
}
export interface GainPoint {
  time: number
  gain: number
}
export const defaultAudioProcessing: AudioProcessing = {
  denoise: 'off',
  equalizer: 'flat',
  compressor: 'off',
  deess: false,
  normalize: 'off',
  limiter: false
}
export function validAudioProcessing(value: unknown): boolean {
  if (value === undefined) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const data = value as Record<string, unknown>
  return Object.entries(data).every(([key, entry]) => {
    if (key === 'deess' || key === 'limiter' || key === 'bypass') return typeof entry === 'boolean'
    if (key === 'eq' || key === 'compression') {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
      const limits =
        key === 'eq'
          ? { low: [-12, 12], mid: [-12, 12], high: [-12, 12] }
          : {
              thresholdDb: [-60, 0],
              ratio: [1, 20],
              attack: [0.1, 200],
              release: [10, 2000],
              makeupDb: [0, 24]
            }
      const values = entry as Record<string, unknown>
      return (
        Object.keys(values).length === Object.keys(limits).length &&
        Object.entries(limits).every(
          ([name, [min, max]]) =>
            typeof values[name] === 'number' &&
            Number.isFinite(values[name]) &&
            (values[name] as number) >= min &&
            (values[name] as number) <= max
        )
      )
    }
    const values: Record<string, string[]> = {
      denoise: ['off', 'light', 'strong'],
      equalizer: ['flat', 'voice', 'warm', 'bright', 'custom'],
      compressor: ['off', 'gentle', 'voice', 'custom'],
      normalize: ['off', 'voice', 'music']
    }
    return typeof entry === 'string' && !!values[key]?.includes(entry)
  })
}
export function validGainPoints(
  points: unknown,
  duration: number
): points is GainPoint[] | undefined {
  if (points === undefined) return true
  return (
    Array.isArray(points) &&
    points.length <= 128 &&
    points.every(
      (point, index) =>
        point &&
        Number.isFinite(point.time) &&
        point.time >= 0 &&
        point.time <= duration + 1 / 48000 &&
        Number.isFinite(point.gain) &&
        point.gain >= 0 &&
        point.gain <= 4 &&
        (!index || point.time > points[index - 1].time)
    )
  )
}
export function automationGain(points: GainPoint[] | undefined, time: number) {
  if (!points?.length) return 1
  if (time <= points[0].time) return points[0].gain
  for (let index = 1; index < points.length; index++) {
    const left = points[index - 1],
      right = points[index]
    if (time < right.time)
      return left.gain + ((right.gain - left.gain) * (time - left.time)) / (right.time - left.time)
  }
  return points[points.length - 1].gain
}
/** Rebase automation when editing fades resets the original envelope. */
export function rebaseGainPoints(
  points: GainPoint[] | undefined,
  offset: number,
  duration: number
) {
  if (!points?.length) return points
  const next = points
    .filter((p) => p.time >= offset && p.time <= offset + duration)
    .map((p) => ({ ...p, time: p.time - offset }))
  if (points[0].time < offset && next[0]?.time !== 0)
    next.unshift({ time: 0, gain: automationGain(points, offset) })
  if (points[points.length - 1].time > offset + duration && next.at(-1)?.time !== duration)
    next.push({ time: duration, gain: automationGain(points, offset + duration) })
  return next.length ? next : [{ time: 0, gain: automationGain(points, offset) }]
}
