import type { StudioTextLayer } from './imageStudioModel'
import { studioFontFamily } from './imageStudioFonts.ts'

export interface StudioTextLayout { fontSize: number; lineHeight: number; lines: string[] }

/** Fit the complete text inside its layer, using the same measurements for preview and export. */
export function layoutStudioText(ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  layer: StudioTextLayer, text = layer.text): StudioTextLayout {
  const availableWidth = Math.max(1, layer.width - 8)
  const availableHeight = Math.max(1, layer.height - 8)
  const family = studioFontFamily(layer.font)
  const wrap = (size: number): StudioTextLayout => {
    ctx.font = `${layer.bold ? 700 : 400} ${size}px ${family}`
    const lines: string[] = []
    for (const paragraph of text.split('\n')) {
      let line = ''
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > availableWidth) { lines.push(line); line = char }
        else line += char
      }
      lines.push(line)
    }
    return { fontSize: size, lineHeight: size * 1.24, lines }
  }
  let low = 1, high = Math.max(1, Math.floor(layer.fontSize))
  let result = wrap(1)
  while (low <= high) {
    const size = Math.floor((low + high) / 2)
    const candidate = wrap(size)
    const fitsWidth = candidate.lines.every(line => ctx.measureText(line).width <= availableWidth)
    if (fitsWidth && candidate.lines.length * candidate.lineHeight <= availableHeight) {
      result = candidate
      low = size + 1
    } else high = size - 1
  }
  ctx.font = `${layer.bold ? 700 : 400} ${result.fontSize}px ${family}`
  return result
}
