import { useElementSize } from '@vueuse/core'
import { reactive, ref, type Ref, type StyleValue } from 'vue'

/** Image-only viewport state. Navigation and playback remain owned by the viewer. */
export function usePreviewImageView(viewport: Ref<HTMLElement | undefined>, onInteract: () => void) {
  const viewportSize = useElementSize(viewport)
  const imageSizes = reactive(new Map<string, { width: number; height: number }>())
  const zoom = ref(1)
  const rotation = ref(0)
  const pan = ref({ x: 0, y: 0 })
  const panning = ref(false)
  let panStart = { x: 0, y: 0, px: 0, py: 0 }

  function resetImageView() {
    zoom.value = 1
    rotation.value = 0
    pan.value = { x: 0, y: 0 }
    panning.value = false
  }

  function setZoom(value: number) {
    zoom.value = Math.max(.25, Math.min(16, value))
    if (zoom.value <= 1) pan.value = { x: 0, y: 0 }
    onInteract()
  }

  function rotateImage(amount: number) {
    rotation.value = (rotation.value + amount) % 360
    pan.value = { x: 0, y: 0 }
    onInteract()
  }

  function measureImage(url: string, event: Event) {
    const image = event.target as HTMLImageElement
    imageSizes.set(url, { width: image.naturalWidth, height: image.naturalHeight })
  }

  function imageStyle(url: string, index: number): StyleValue {
    if (index !== 1) return {}
    const size = imageSizes.get(url)
    const quarterTurn = Math.abs(rotation.value % 180) === 90
    const availableWidth = Math.max(1, viewportSize.width.value - 48)
    const availableHeight = Math.max(1, viewportSize.height.value - 120)
    const fit = size ? Math.min(availableWidth / (quarterTurn ? size.height : size.width), availableHeight / (quarterTurn ? size.width : size.height), 1) : 1
    return {
      width: size ? `${size.width * fit}px` : '100%',
      height: size ? `${size.height * fit}px` : '100%',
      transform: `translate(${pan.value.x}px, ${pan.value.y}px) rotate(${rotation.value}deg) scale(${zoom.value})`,
      cursor: zoom.value > 1 ? (panning.value ? 'grabbing' : 'grab') : 'default'
    }
  }

  function startPan(event: PointerEvent) {
    if (zoom.value <= 1 || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onInteract()
    panning.value = true
    panStart = { x: event.clientX, y: event.clientY, px: pan.value.x, py: pan.value.y }
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }

  function movePan(event: PointerEvent) {
    if (!panning.value) return
    pan.value = { x: panStart.px + event.clientX - panStart.x, y: panStart.py + event.clientY - panStart.y }
  }

  function endPan() { panning.value = false }

  return { imageSizes, zoom, resetImageView, setZoom, rotateImage, measureImage, imageStyle, startPan, movePan, endPan }
}
