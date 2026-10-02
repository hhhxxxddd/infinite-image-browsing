export interface MaterialScrollMotion {
  position: number
  target: number
  velocity: number
}

const MAX_PULL = 24
const EDGE_RESISTANCE = 0.2
const FOLLOW_SPEED = 22

export function materialScrollTarget(target: number, delta: number, maxScroll: number): number {
  const next = target + delta
  if (next < 0) {
    const pull =
      target < 0 ? target + delta * (delta < 0 ? EDGE_RESISTANCE : 1) : next * EDGE_RESISTANCE
    return Math.max(-MAX_PULL, pull)
  }
  if (next > maxScroll) {
    const pull =
      target > maxScroll
        ? target + delta * (delta > 0 ? EDGE_RESISTANCE : 1)
        : maxScroll + (next - maxScroll) * EDGE_RESISTANCE
    return Math.min(maxScroll + MAX_PULL, pull)
  }
  return next
}

/** A critically damped spring follows wheel distance without adding a second trackpad momentum. */
export function stepMaterialScroll(
  state: MaterialScrollMotion,
  maxScroll: number,
  elapsedSeconds: number,
  released: boolean
): MaterialScrollMotion {
  const target = released ? Math.max(0, Math.min(maxScroll, state.target)) : state.target
  const elapsed = Math.max(0, Math.min(0.064, elapsedSeconds))
  const displacement = state.position - target
  const impulse = (state.velocity + FOLLOW_SPEED * displacement) * elapsed
  const decay = Math.exp(-FOLLOW_SPEED * elapsed)
  const position = Math.max(
    -MAX_PULL,
    Math.min(maxScroll + MAX_PULL, target + (displacement + impulse) * decay)
  )
  const velocity = (state.velocity - FOLLOW_SPEED * impulse) * decay
  const next = { position, target, velocity }
  return materialScrollSettled(next) ? { position: target, target, velocity: 0 } : next
}

export function materialScrollSettled(state: MaterialScrollMotion): boolean {
  return Math.abs(state.position - state.target) < 0.05 && Math.abs(state.velocity) < 0.5
}
