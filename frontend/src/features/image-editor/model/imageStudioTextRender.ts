import { canvasContext } from '../../../shared/lib/canvasContext.ts'
import type { StudioTextLayer } from './imageStudioModel.ts'
import { layoutStudioText, studioTextWidth, studioTextCharacters } from './imageStudioText.ts'
import { studioTextEffectInsets } from './imageStudioTextEffects.ts'

/** Coordinates are local to the unrotated text frame; density converts Canvas shadow units to pixels. */
export function paintStudioText(
  ctx: CanvasRenderingContext2D,
  layer: StudioTextLayer,
  density = 1
) {
  const effects = layer.effects
  const layout = layoutStudioText(ctx, layer)
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  const top =
    -layer.height / 2 + Math.max(4, (layer.height - layout.lines.length * layout.lineHeight) / 2)
  const spacing = layer.letterSpacing ?? 0
  const lines = layout.lines.map((text, index) => {
    const width = studioTextWidth(ctx, text, spacing)
    const x =
      layer.align === 'left'
        ? -layer.width / 2 + 4
        : layer.align === 'right'
          ? layer.width / 2 - 4 - width
          : -width / 2
    return { text, width, x, y: top + index * layout.lineHeight }
  })
  let fill: string | CanvasGradient = layer.color
  if (effects?.fill.mode === 'gradient') {
    const angle = (effects.fill.angle * Math.PI) / 180
    const extent =
      (Math.abs(Math.cos(angle)) * layer.width + Math.abs(Math.sin(angle)) * layer.height) / 2
    const dx = Math.cos(angle) * extent,
      dy = Math.sin(angle) * extent
    fill = ctx.createLinearGradient(-dx, -dy, dx, dy)
    fill.addColorStop(0, layer.color)
    fill.addColorStop(1, effects.fill.endColor)
  }
  const clearShadow = () => {
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  }
  clearShadow()
  if (effects?.background.enabled && effects.background.opacity > 0) {
    ctx.save()
    ctx.globalAlpha *= effects.background.opacity
    ctx.fillStyle = effects.background.color
    ctx.beginPath()
    ctx.roundRect(
      -layer.width / 2,
      -layer.height / 2,
      layer.width,
      layer.height,
      Math.min(effects.background.radius, layer.width / 2, layer.height / 2)
    )
    ctx.fill()
    ctx.restore()
  }
  const insets = studioTextEffectInsets(layer, false)
  ctx.beginPath()
  ctx.rect(
    -layer.width / 2 - insets.left,
    -layer.height / 2 - insets.top,
    layer.width + insets.left + insets.right,
    layer.height + insets.top + insets.bottom
  )
  ctx.clip()
  const draw = (outline: boolean) => {
    ctx.fillStyle = fill
    ctx.strokeStyle = outline ? (effects?.stroke.color ?? layer.color) : fill
    ctx.lineWidth = outline ? (effects?.stroke.width ?? 0) : Math.max(1, layout.fontSize / 18)
    ctx.lineJoin = 'round'
    for (const line of lines) {
      const glyph = (text: string, x: number) =>
        outline ? ctx.strokeText(text, x, line.y) : ctx.fillText(text, x, line.y)
      if (!spacing) glyph(line.text, line.x)
      else {
        let prefix = ''
        for (const [index, char] of studioTextCharacters(line.text).entries()) {
          const advance = ctx.measureText(prefix + char).width - ctx.measureText(char).width
          glyph(char, line.x + advance + index * spacing)
          prefix += char
        }
      }
      for (const offset of [layer.underline ? 1.05 : null, layer.strike ? 0.55 : null]) {
        if (offset === null || !line.text) continue
        ctx.beginPath()
        ctx.moveTo(line.x, line.y + layout.fontSize * offset)
        ctx.lineTo(line.x + line.width, line.y + layout.fontSize * offset)
        ctx.stroke()
      }
    }
  }
  if (effects?.glow.enabled && effects.glow.range > 0) {
    ctx.shadowColor = effects.glow.color
    ctx.shadowBlur = effects.glow.range * density
    draw(false)
    clearShadow()
  }
  if (effects?.shadow.enabled) {
    const angle = (effects.shadow.angle * Math.PI) / 180
    ctx.shadowColor = effects.shadow.color
    ctx.shadowBlur = effects.shadow.blur * density
    ctx.shadowOffsetX = Math.cos(angle) * effects.shadow.distance * density
    ctx.shadowOffsetY = Math.sin(angle) * effects.shadow.distance * density
    draw(false)
    clearShadow()
  }
  if (effects?.stroke.enabled && effects.stroke.width > 0) draw(true)
  draw(false)
}

type Bitmap = { key: string; canvas: HTMLCanvasElement; pixels: number }
let textCaches = new WeakMap<HTMLCanvasElement, Map<string, Bitmap>>()
export function clearStudioTextCache() {
  textCaches = new WeakMap()
}
export function retainStudioTextCache(target: HTMLCanvasElement, ids: Set<string>) {
  const cache = textCaches.get(target)
  if (cache) for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id)
}

/** Cache expensive effects independently of position, rotation, mirroring and layer opacity. */
export function paintStudioTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: StudioTextLayer,
  target: HTMLCanvasElement,
  density: number,
  preview: boolean
) {
  ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1)
  const effects = layer.effects
  if (
    !effects ||
    (effects.fill.mode === 'solid' &&
      !effects.stroke.enabled &&
      !effects.shadow.enabled &&
      !effects.glow.enabled &&
      !effects.background.enabled)
  ) {
    paintStudioText(ctx, layer)
    return
  }
  const insets = studioTextEffectInsets(layer, false)
  const width = layer.width + insets.left + insets.right
  const height = layer.height + insets.top + insets.bottom
  const ratio = preview
    ? Math.min(density, 4096 / Math.max(width, height), Math.sqrt(8388608 / (width * height)))
    : density
  const pixelWidth = Math.max(1, Math.ceil(width * ratio)),
    pixelHeight = Math.max(1, Math.ceil(height * ratio))
  const key = JSON.stringify([
    pixelWidth,
    pixelHeight,
    layer.width,
    layer.height,
    layer.text,
    layer.font,
    layer.fontSize,
    layer.bold,
    layer.italic,
    layer.underline,
    layer.strike,
    layer.lineHeight,
    layer.letterSpacing,
    layer.align,
    layer.color,
    effects
  ])
  const cache = textCaches.get(target) ?? new Map<string, Bitmap>()
  if (preview) textCaches.set(target, cache)
  let bitmap = preview ? cache.get(layer.id) : undefined
  if (!bitmap || bitmap.key !== key) {
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const paint = canvasContext(canvas)
    paint.scale(pixelWidth / width, pixelHeight / height)
    paint.translate(layer.width / 2 + insets.left, layer.height / 2 + insets.top)
    paintStudioText(paint, layer, ratio)
    bitmap = { key, canvas, pixels: pixelWidth * pixelHeight }
  }
  if (preview) {
    cache.delete(layer.id)
    cache.set(layer.id, bitmap)
    let pixels = Array.from(cache.values()).reduce((sum, entry) => sum + entry.pixels, 0)
    for (const [id, entry] of cache) {
      if (pixels <= 33554432) break
      cache.delete(id)
      pixels -= entry.pixels
    }
  }
  ctx.drawImage(
    bitmap.canvas,
    -layer.width / 2 - insets.left,
    -layer.height / 2 - insets.top,
    width,
    height
  )
}
