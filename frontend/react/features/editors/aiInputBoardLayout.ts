export type BoardFrame = { x: number; y: number; width: number; height: number }

/** Display geometry only. Input pixels and reference order never depend on board placement. */
export function layoutAIInputs(inputs: { width: number; height: number }[]): BoardFrame[] {
  let rowY = 0
  let rowHeight = 0
  let x = 0
  return inputs.map((input, index) => {
    if (index && index % 3 === 0) {
      rowY += rowHeight + 72
      rowHeight = 0
      x = 0
    }
    const ratio = Math.min(300 / Math.max(1, input.width), 280 / Math.max(1, input.height))
    const width = Math.max(1, input.width) * ratio
    const height = Math.max(1, input.height) * ratio
    const frame = { x, y: rowY, width, height }
    rowHeight = Math.max(rowHeight, height)
    x += width + 40
    return frame
  })
}

export function fitAIInputs(frames: BoardFrame[], width: number, height: number) {
  if (!frames.length) return { zoom: 1, x: width / 2, y: height / 2 }
  const left = Math.min(...frames.map((frame) => frame.x))
  const top = Math.min(...frames.map((frame) => frame.y)) - 36
  const right = Math.max(...frames.map((frame) => frame.x + frame.width))
  const bottom = Math.max(...frames.map((frame) => frame.y + frame.height))
  const zoom = Math.max(
    0.05,
    Math.min(1.5, (width - 48) / (right - left), (height - 48) / (bottom - top))
  )
  return { zoom, x: (width - (right + left) * zoom) / 2, y: (height - (bottom + top) * zoom) / 2 }
}
