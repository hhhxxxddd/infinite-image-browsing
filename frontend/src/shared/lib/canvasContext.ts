/** Obtain the rendering context once, and fail explicitly on unsupported or exhausted canvases. */
export function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片画布')
  return context
}
