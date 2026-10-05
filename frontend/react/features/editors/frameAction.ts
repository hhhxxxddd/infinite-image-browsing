/** Coalesce high-rate input, but always apply the final pointer position before committing. */
export function createFrameAction(
  request: (callback: () => void) => number = requestAnimationFrame,
  cancelRequest: (id: number) => void = cancelAnimationFrame
) {
  let frame: number | null = null
  let pending: (() => void) | null = null
  const cancel = () => {
    if (frame !== null) cancelRequest(frame)
    frame = null
    pending = null
  }
  const flush = (final?: () => void) => {
    const action = final ?? pending
    cancel()
    action?.()
  }
  return {
    schedule(action: () => void) {
      pending = action
      if (frame === null) frame = request(() => flush())
    },
    flush,
    cancel
  }
}
