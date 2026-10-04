export interface StudioImageCorrection {
  horizontal: number
  vertical: number
  center: number
  rotation: number
}

export function readImageCorrection(value: unknown): StudioImageCorrection {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const bounded = (key: string, limit: number) =>
    typeof raw[key] === 'number' && Number.isFinite(raw[key])
      ? Math.max(-limit, Math.min(limit, raw[key]))
      : 0
  return {
    horizontal: bounded('horizontal', 100),
    vertical: bounded('vertical', 100),
    center: bounded('center', 100),
    rotation: bounded('rotation', 180)
  }
}

/** Precompute one inverse mapping for both GPU and CPU sampling. */
export function imageCorrectionMapping(aspect: number, correction: StudioImageCorrection) {
  const angle = (correction.rotation * Math.PI) / 180
  const cos = Math.cos(angle),
    sin = Math.sin(angle),
    horizontal = correction.horizontal * 0.004,
    vertical = correction.vertical * 0.004,
    center = correction.center * 0.005
  // Negative radial correction expands source coordinates. Bound the pre-distortion
  // square so even its corners stay inside the source after radial correction.
  const radialLimit = center < 0 ? 2 / (1 + Math.sqrt(1 - 4 * center)) : 1
  let scale = 1
  for (const x of [-1, 1])
    for (const y of [-1, 1]) {
      const rx = cos * x + (sin * y) / aspect
      const ry = -sin * x * aspect + cos * y
      // A homography maps edges to straight lines: containing the four corners
      // contains the whole viewport. This also guarantees a positive denominator.
      scale = Math.max(
        scale,
        Math.max(Math.abs(rx), Math.abs(ry)) / radialLimit - horizontal * rx - vertical * ry
      )
    }
  return {
    xx: cos / scale,
    xy: sin / aspect / scale,
    yx: (-sin * aspect) / scale,
    yy: cos / scale,
    horizontal,
    vertical,
    center,
    radiusX: (aspect * aspect) / (aspect * aspect + 1),
    radiusY: 1 / (aspect * aspect + 1)
  }
}

/** Normalized source coordinates; crop, fill and layer transforms are applied afterwards. */
export function mapCorrectedImagePoint(
  x: number,
  y: number,
  mapping: ReturnType<typeof imageCorrectionMapping>
) {
  const px = (x - 0.5) * 2,
    py = (y - 0.5) * 2
  const rx = mapping.xx * px + mapping.xy * py,
    ry = mapping.yx * px + mapping.yy * py
  const denominator = 1 + mapping.horizontal * rx + mapping.vertical * ry
  const sx = rx / denominator,
    sy = ry / denominator
  const radial = 1 + mapping.center * (sx * sx * mapping.radiusX + sy * sy * mapping.radiusY)
  return {
    x: (sx / radial + 1) / 2,
    y: (sy / radial + 1) / 2,
    valid: denominator > 0.001 && radial > 0.001
  }
}

export function correctionSourcePoint(
  x: number,
  y: number,
  aspect: number,
  correction: StudioImageCorrection
) {
  return mapCorrectedImagePoint(x, y, imageCorrectionMapping(aspect, correction))
}
