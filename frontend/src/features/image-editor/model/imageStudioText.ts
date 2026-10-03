import { createTextLayer, type StudioTextLayer } from './imageStudioModel.ts'
import { studioFontFamily } from './imageStudioFonts.ts'

export interface StudioTextLayout {
  fontSize: number
  lineHeight: number
  lines: string[]
}

export type StudioTextPreset = 'title' | 'subtitle' | 'body'

const textSegments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export const studioTextCharacters = (text: string): string[] =>
  Array.from(textSegments.segment(text), ({ segment }) => segment)

export function createStudioTextPreset(
  canvas: { width: number; height: number },
  preset: StudioTextPreset
): StudioTextLayer {
  const name = { title: '标题', subtitle: '副标题', body: '正文' }[preset]
  const size = Math.min(canvas.width, canvas.height)
  const width = Math.max(1, Math.min(canvas.width, canvas.width * 0.7))
  const height = Math.max(1, Math.min(canvas.height, size * (preset === 'body' ? 0.3 : 0.2)))
  return {
    ...createTextLayer(
      {
        x: (canvas.width - width) / 2,
        y: (canvas.height - height) / 2,
        width,
        height
      },
      preset === 'body' ? '在这里输入正文' : name
    ),
    name,
    fontSize: Math.max(
      1,
      Math.min(1000, Math.round(size * { title: 0.12, subtitle: 0.08, body: 0.05 }[preset]))
    ),
    bold: preset === 'title',
    align: preset === 'body' ? 'left' : 'center'
  }
}

export function studioTextWidth(
  ctx: Pick<CanvasRenderingContext2D, 'measureText'>,
  text: string,
  spacing = 0,
  characters?: number
) {
  return Math.max(
    0,
    ctx.measureText(text).width +
      (spacing ? Math.max(0, (characters ?? studioTextCharacters(text).length) - 1) * spacing : 0)
  )
}

/** Fit the complete text inside its layer, using the same measurements for preview and export. */
export function layoutStudioText(
  ctx: Pick<CanvasRenderingContext2D, 'font' | 'measureText'>,
  layer: StudioTextLayer,
  text = layer.text
): StudioTextLayout {
  const availableWidth = Math.max(1, layer.width - 8)
  const availableHeight = Math.max(1, layer.height - 8)
  const family = studioFontFamily(layer.font)
  const spacing = layer.letterSpacing ?? 0
  const paragraphs = text.split('\n').map(studioTextCharacters)
  const font = (size: number) =>
    `${layer.italic ? 'italic ' : ''}${layer.bold ? 700 : 400} ${size}px ${family}`
  const wrap = (size: number): StudioTextLayout => {
    ctx.font = font(size)
    const lines: string[] = []
    for (const paragraph of paragraphs) {
      let line = ''
      let characters = 0
      for (const char of paragraph) {
        if (line && studioTextWidth(ctx, line + char, spacing, characters + 1) > availableWidth) {
          lines.push(line)
          line = char
          characters = 1
        } else {
          line += char
          characters++
        }
      }
      lines.push(line)
    }
    return { fontSize: size, lineHeight: size * (layer.lineHeight ?? 1.24), lines }
  }
  let low = 1,
    high = Math.max(1, Math.floor(layer.fontSize))
  let result = wrap(1)
  while (low <= high) {
    const size = Math.floor((low + high) / 2)
    const candidate = wrap(size)
    const fitsWidth = candidate.lines.every(
      (line) => studioTextWidth(ctx, line, spacing) <= availableWidth
    )
    if (fitsWidth && candidate.lines.length * candidate.lineHeight <= availableHeight) {
      result = candidate
      low = size + 1
    } else high = size - 1
  }
  ctx.font = font(result.fontSize)
  return result
}
