<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { clipEnvelope, type AudioClip } from '../model/audioTimeline'
const props = defineProps<{
  clip: AudioClip
  peaks?: number[]
  sourceDuration?: number
  pixelsPerSecond: number
  viewportStart: number
  viewportWidth: number
}>()
const canvas = ref<HTMLCanvasElement>()
let observer: ResizeObserver | undefined
function paint() {
  const element = canvas.value
  if (!element || !props.peaks?.length || !props.sourceDuration) return
  const left = Math.max(0, props.viewportStart - props.clip.start * props.pixelsPerSecond)
  const width = Math.max(
    0,
    Math.min(props.clip.duration * props.pixelsPerSecond - left, props.viewportWidth)
  )
  element.style.left = left + 'px'
  element.style.width = width + 'px'
  const height = element.clientHeight
  const ratio = devicePixelRatio || 1
  element.width = Math.ceil(width * ratio)
  element.height = Math.ceil(height * ratio)
  const ctx = element.getContext('2d')
  if (!ctx) return
  ctx.scale(ratio, ratio)
  ctx.fillStyle = '#b4ded9'
  const perPixel = 1 / props.pixelsPerSecond
  for (let x = 0; x < width; x += 2) {
    const local = (left + x) / props.pixelsPerSecond
    const from = Math.floor(
      ((props.clip.sourceIn + local) / props.sourceDuration) * props.peaks.length
    )
    const to = Math.ceil(
      ((props.clip.sourceIn + local + perPixel * 2) / props.sourceDuration) * props.peaks.length
    )
    let peak = 0
    for (let i = from; i <= to && i < props.peaks.length; i++)
      peak = Math.max(peak, props.peaks[i] ?? 0)
    const amplitude = Math.min(1, peak * clipEnvelope(props.clip, local)) * height * 0.46
    ctx.fillRect(x, height / 2 - amplitude, 1.5, Math.max(1, amplitude * 2))
  }
}
onMounted(() => {
  observer = new ResizeObserver(paint)
  if (canvas.value) observer.observe(canvas.value)
  paint()
})
watch(
  () => [
    props.clip,
    props.peaks,
    props.sourceDuration,
    props.pixelsPerSecond,
    props.viewportStart,
    props.viewportWidth
  ],
  paint,
  { deep: true, flush: 'post' }
)
onBeforeUnmount(() => observer?.disconnect())
</script>
<template><canvas ref="canvas" class="audio-waveform" aria-hidden="true" /></template>
<style scoped>
.audio-waveform {
  position: absolute;
  top: 28px;
  height: calc(100% - 40px);
  pointer-events: none;
}
</style>
