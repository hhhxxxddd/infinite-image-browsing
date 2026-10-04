import {
  imageCorrectionMapping,
  mapCorrectedImagePoint,
  readImageCorrection,
  type StudioImageCorrection
} from './imageStudioCorrection.ts'
import { canvasContext } from '../../../shared/lib/canvasContext.ts'

let cache = new WeakMap<HTMLImageElement, { key: string; canvas: HTMLCanvasElement }>()
export function clearImageCorrectionCache() {
  cache = new WeakMap()
}

function createRenderer() {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', {
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    depth: false,
    antialias: false
  })
  if (!gl) return null
  const shader = (type: number, source: string) => {
    const result = gl.createShader(type)
    if (!result) throw new Error('校正着色器初始化失败')
    gl.shaderSource(result, source)
    gl.compileShader(result)
    if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error('校正着色器初始化失败')
    return result
  }
  const program = gl.createProgram()
  if (!program) return null
  const vertex = shader(
    gl.VERTEX_SHADER,
    `attribute vec2 position; varying vec2 uv; void main(){gl_Position=vec4(position,0.,1.);uv=vec2((position.x+1.)*.5,(1.-position.y)*.5);}`
  )
  const fragment = shader(
    gl.FRAGMENT_SHADER,
    `precision highp float;
    varying vec2 uv; uniform sampler2D source;
    uniform vec4 transform; uniform vec3 perspective; uniform vec2 radius;
    void main(){
      vec2 p=uv*2.-1.;
      vec2 r=vec2(dot(transform.xy,p),dot(transform.zw,p));
      float d=1.+dot(perspective.xy,r); vec2 s=r/d;
      float radial=1.+perspective.z*dot(s*s,radius);
      vec2 q=(s/radial+1.)*.5;
      gl_FragColor=d<=.001||radial<=.001||q.x<-.00001||q.y<-.00001||q.x>1.00001||q.y>1.00001
        ?vec4(0.):texture2D(source,clamp(q,0.,1.));
    }`
  )
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
  const transformLocation = gl.getUniformLocation(program, 'transform')
  const perspectiveLocation = gl.getUniformLocation(program, 'perspective')
  const radiusLocation = gl.getUniformLocation(program, 'radius')
  let current: HTMLImageElement | undefined
  const maxSize = Math.min(
    gl.getParameter(gl.MAX_TEXTURE_SIZE),
    gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)
  )
  return (
    image: HTMLImageElement,
    correction: StudioImageCorrection,
    target: HTMLCanvasElement
  ) => {
    if (gl.isContextLost() || Math.max(image.naturalWidth, image.naturalHeight) > maxSize)
      return false
    if (canvas.width !== target.width || canvas.height !== target.height) {
      canvas.width = target.width
      canvas.height = target.height
      gl.viewport(0, 0, target.width, target.height)
    }
    if (current !== image) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      current = image
    }
    const mapping = imageCorrectionMapping(image.naturalWidth / image.naturalHeight, correction)
    gl.uniform4f(transformLocation, mapping.xx, mapping.xy, mapping.yx, mapping.yy)
    gl.uniform3f(perspectiveLocation, mapping.horizontal, mapping.vertical, mapping.center)
    gl.uniform2f(radiusLocation, mapping.radiusX, mapping.radiusY)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    canvasContext(target).drawImage(canvas, 0, 0)
    return true
  }
}

let renderer: ReturnType<typeof createRenderer> | undefined

/** CPU fallback also preserves native resolution when a source exceeds the GPU texture limit. */
function renderFallback(
  image: HTMLImageElement,
  correction: StudioImageCorrection,
  target: HTMLCanvasElement
) {
  const ctx = canvasContext(target),
    w = target.width,
    h = target.height
  ctx.drawImage(image, 0, 0)
  const source = ctx.getImageData(0, 0, w, h).data,
    output = ctx.createImageData(w, h),
    dst = output.data
  const mapping = imageCorrectionMapping(w / h, correction)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = mapCorrectedImagePoint((x + 0.5) / w, (y + 0.5) / h, mapping)
      if (!p.valid || p.x < -0.00001 || p.y < -0.00001 || p.x > 1.00001 || p.y > 1.00001) continue
      const sx = Math.max(0, Math.min(w - 1, p.x * w - 0.5)),
        sy = Math.max(0, Math.min(h - 1, p.y * h - 0.5))
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy),
        fx = sx - x0,
        fy = sy - y0
      const indices = [
        (y0 * w + x0) * 4,
        (y0 * w + Math.min(w - 1, x0 + 1)) * 4,
        (Math.min(h - 1, y0 + 1) * w + x0) * 4,
        (Math.min(h - 1, y0 + 1) * w + Math.min(w - 1, x0 + 1)) * 4
      ]
      const weights = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy],
        offset = (y * w + x) * 4
      let alpha = 0
      for (let i = 0; i < 4; i++) alpha += source[indices[i] + 3] * weights[i]
      dst[offset + 3] = alpha
      if (alpha)
        for (let channel = 0; channel < 3; channel++) {
          let color = 0
          for (let i = 0; i < 4; i++)
            color += source[indices[i] + channel] * source[indices[i] + 3] * weights[i]
          dst[offset + channel] = color / alpha
        }
    }
  ctx.putImageData(output, 0, 0)
}

export function correctedStudioImage(
  image: HTMLImageElement,
  value?: StudioImageCorrection
): HTMLImageElement | HTMLCanvasElement {
  const correction = readImageCorrection(value)
  if (!Object.values(correction).some(Boolean)) return image
  const key = JSON.stringify(correction),
    cached = cache.get(image)
  if (cached?.key === key) return cached.canvas
  const canvas = cached?.canvas ?? document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  if (renderer === undefined) {
    try {
      renderer = createRenderer()
    } catch {
      renderer = null
    }
  }
  if (!renderer?.(image, correction, canvas)) renderFallback(image, correction, canvas)
  cache.set(image, { key, canvas })
  return canvas
}
