export function parseTimelineTime(value: string): number | undefined {
  const text = value.trim()
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,6})?$/.test(text)) return
  const parts = text.split(':').map(Number)
  if (parts.length > 1 && parts.slice(1).some((part) => part >= 60)) return
  const result = parts.reduce((total, part) => total * 60 + part, 0)
  return Number.isFinite(result) ? result : undefined
}

export function formatTimelineTime(seconds: number): string {
  const milliseconds = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000)
  const hours = Math.floor(milliseconds / 3600000)
  const minutes = Math.floor((milliseconds % 3600000) / 60000)
  const remainder = ((milliseconds % 60000) / 1000).toFixed(3).padStart(6, '0')
  return `${hours ? `${hours}:` : ''}${String(minutes).padStart(2, '0')}:${remainder}`
}

export function clampTimelineRange(start: number, end: number, maximum: number) {
  const first = clampTimelinePosition(Math.min(start, end), maximum)
  const last = Math.max(first, clampTimelinePosition(Math.max(start, end), maximum))
  return { start: first, end: last }
}

export interface TimelineRange {
  start: number
  end: number
}

export function clampTimelinePosition(value: number, duration: number) {
  const maximum = Number.isFinite(duration) ? Math.max(0, duration) : 0
  return Math.min(maximum, Math.max(0, Number.isFinite(value) ? value : 0))
}

/** A collapsed or invalid selection is unset, never a zero-length export range. */
export function normalizeTimelineRange(
  range: TimelineRange | null,
  duration: number
): TimelineRange | null {
  if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end)) return null
  const next = clampTimelineRange(range.start, range.end, duration)
  return next.end > next.start ? next : null
}

/** First I/O uses the content boundary; crossing the other end extends to that boundary. */
export function setTimelineRangeEndpoint(
  range: TimelineRange | null,
  endpoint: 'start' | 'end',
  value: number,
  duration: number
): TimelineRange | undefined {
  if (!Number.isFinite(value) || value < 0 || value > duration) return
  const current = normalizeTimelineRange(range, duration)
  const next =
    endpoint === 'start'
      ? { start: value, end: current && current.end > value ? current.end : duration }
      : { start: current && current.start < value ? current.start : 0, end: value }
  return normalizeTimelineRange(next, duration) ?? undefined
}

export function timelineTimeInputText(value: number | null) {
  return value === null ? '' : formatTimelineTime(value)
}

/** Enter and blur commit identically; Escape returns the current controlled value. */
export function resolveTimelineTimeInput(
  text: string,
  current: number | null,
  maximum: number,
  { clearable = false, cancel = false } = {}
): { valid: boolean; value: number | null } {
  if (cancel) return { valid: true, value: current }
  if (!text.trim() && clearable) return { valid: true, value: null }
  // Focusing and confirming a rounded frame label must not change its exact time.
  const value = text.trim() === timelineTimeInputText(current) ? current : parseTimelineTime(text)
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(maximum) ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > maximum
  )
    return { valid: false, value: current }
  return { valid: true, value }
}

export function nudgeTimelineTimeInput(
  text: string,
  current: number | null,
  maximum: number,
  delta: number
) {
  const base = resolveTimelineTimeInput(text, current, maximum).value ?? 0
  return clampTimelinePosition(base + delta, maximum)
}
