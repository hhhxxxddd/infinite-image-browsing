export type StereoLevel = [number, number]
export const levelStep = 0.05
export const levelDb = (value: number) => (value > 0 ? 20 * Math.log10(value) : -Infinity)
export const levelLabel = (db: number) =>
  Number.isFinite(db) ? `${db.toFixed(1)} dBFS` : '−∞ dBFS'

/** Pre-encoder floating-point peaks keep values above 0 dBFS visible after PCM clipping. */
export function decodeLevels(encoded: string): StereoLevel[] {
  if (!encoded || encoded.length > 4096) return []
  try {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0))
    if (bytes.length % 8 || bytes.length > 240 * 8) return []
    const view = new DataView(bytes.buffer)
    const levels: StereoLevel[] = []
    for (let offset = 0; offset < bytes.length; offset += 8) {
      const left = view.getFloat32(offset, true),
        right = view.getFloat32(offset + 4, true)
      if (![left, right].every((value) => Number.isFinite(value) && value >= 0)) return []
      levels.push([left, right])
    }
    return levels
  } catch {
    return []
  }
}
