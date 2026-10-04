import type {
  EraseStroke,
  PixelBox
} from '../../../src/features/image-editor/model/imageStudioErase'

export function drawEraseStrokes(
  canvas: HTMLCanvasElement,
  strokes: EraseStroke[],
  size: { width: number; height: number },
  preview = false
) {
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建消除遮罩画布')
  if (!preview) {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.width, size.height)
  }
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    if (!stroke.points.length) continue
    ctx.globalCompositeOperation = preview && stroke.erase ? 'destination-out' : 'source-over'
    ctx.strokeStyle = ctx.fillStyle =
      stroke.erase && !preview ? '#000' : preview ? '#fa9973' : '#fff'
    ctx.lineWidth = Math.max(0.01, stroke.size * Math.min(size.width, size.height))
    const p = stroke.points[0]
    ctx.beginPath()
    if (stroke.points.length === 1) {
      ctx.arc(p.x * size.width, p.y * size.height, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.moveTo(p.x * size.width, p.y * size.height)
      for (const point of stroke.points.slice(1))
        ctx.lineTo(point.x * size.width, point.y * size.height)
      ctx.stroke()
    }
  }
}

export function eraseMask(strokes: EraseStroke[], size: { width: number; height: number }) {
  const canvas = document.createElement('canvas')
  drawEraseStrokes(canvas, strokes, size)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法读取涂抹遮罩')
  let left = size.width,
    right = -1,
    top = size.height,
    bottom = -1
  // Scan strips so a high-resolution image does not require a second full RGBA copy.
  for (let y = 0; y < size.height; y += 64) {
    const h = Math.min(64, size.height - y)
    const pixels = ctx.getImageData(0, y, size.width, h).data
    for (let row = 0; row < h; row++) {
      for (let x = 0; x < size.width; x++) {
        if (!pixels[(row * size.width + x) * 4]) continue
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y + row)
        bottom = Math.max(bottom, y + row)
      }
    }
  }
  const bounds: PixelBox | null =
    right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
  return { canvas, bounds }
}
