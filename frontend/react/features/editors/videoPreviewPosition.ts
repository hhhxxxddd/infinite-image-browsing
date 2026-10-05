type Span = { start: number; duration: number }

/** Hold only members that actually reach the whole timeline's end; never bridge a gap. */
export function videoPreviewActive(item: Span, playhead: number, contentEnd: number) {
  const end = item.start + item.duration
  return (
    playhead >= item.start &&
    (playhead < end || (contentEnd > 0 && playhead === contentEnd && end === contentEnd))
  )
}

/** Preview sampling only. The edit cursor, audio clock and export range remain unchanged. */
export function videoPreviewTime(
  playhead: number,
  contentEnd: number,
  fps: number,
  active: Span[] = []
) {
  if (contentEnd <= 0 || playhead !== contentEnd) return playhead
  const finalFrame = Math.max(0, (Math.ceil(contentEnd * fps - 1e-8) - 1) / fps)
  // A very short final clip/caption may start inside that frame interval.
  return Math.max(finalFrame, ...active.map((item) => item.start))
}
