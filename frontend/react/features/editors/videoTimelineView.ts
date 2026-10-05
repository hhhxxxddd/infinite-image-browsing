/** Grid spacing must not depend on how many ticks fit inside the current content. */
export function videoRulerStep(pixelsPerSecond: number, fps?: number) {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 3600
  const candidates = [
    ...(fps && Number.isFinite(fps) && fps > 0
      ? [1, 2, 5, 10, 15].map((frames) => frames / fps).filter((seconds) => seconds < 1)
      : []),
    1,
    2,
    5,
    10,
    15,
    30,
    60,
    120,
    300,
    600,
    1800,
    3600
  ]
  return (
    candidates.find((value) => value * pixelsPerSecond >= 72) ??
    Math.ceil(72 / pixelsPerSecond / 3600) * 3600
  )
}

/** Only draw ruler marks in the visible interval, even for hours of footage. */
export function videoRulerTicks(
  duration: number,
  pixelsPerSecond: number,
  left: number,
  width: number,
  fps?: number
) {
  if (
    ![duration, pixelsPerSecond, left, width].every(Number.isFinite) ||
    duration < 0 ||
    pixelsPerSecond <= 0 ||
    width < 0
  )
    return []
  const step = videoRulerStep(pixelsPerSecond, fps)
  const first = Math.max(0, Math.floor(left / pixelsPerSecond / step) * step)
  const end = Math.min(duration, (left + width) / pixelsPerSecond + step)
  const ticks: number[] = []
  for (let index = 0; first + index * step <= end; index++)
    ticks.push(Math.round((first + index * step) * 1e6) / 1e6)
  return ticks
}

export function videoClipVisible(
  start: number,
  duration: number,
  pixelsPerSecond: number,
  left: number,
  width: number
) {
  return (
    (start + duration) * pixelsPerSecond >= left - 120 &&
    start * pixelsPerSecond <= left + width + 120
  )
}

export function videoSoundActive(start: number, duration: number, time: number) {
  return time >= start && time < start + duration
}
