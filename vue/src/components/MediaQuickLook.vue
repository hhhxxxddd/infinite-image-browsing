<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { CloseOutlined, CustomerServiceOutlined } from '@ant-design/icons-vue'

defineProps<{
  src: string
  name: string
  kind: 'image' | 'video' | 'audio'
}>()
const emit = defineEmits<{ close: [] }>()
const closeButton = ref<HTMLButtonElement>()
const stage = ref<HTMLDivElement>()
const image = ref<HTMLImageElement>()
const failed = ref(false)
const zoom = ref(1)
const pan = ref({ x: 0, y: 0 })
const dragging = ref(false)
let dragStart = { x: 0, y: 0, panX: 0, panY: 0 }

function boundedPan(x: number, y: number, scale: number) {
  const picture = image.value
  const viewport = stage.value
  if (!picture || !viewport || scale <= 1) return { x: 0, y: 0 }
  const style = getComputedStyle(viewport)
  const width = viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const height = viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  const maxX = Math.max(0, (picture.offsetWidth * scale - width) / 2)
  const maxY = Math.max(0, (picture.offsetHeight * scale - height) / 2)
  return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
}

function onWheel(event: WheelEvent) {
  if (!image.value) return
  event.preventDefault()
  const previous = zoom.value
  const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.value?.clientHeight ?? 1 : 1)
  const step = Math.max(-180, Math.min(180, pixels))
  const next = Math.max(.25, Math.min(8, previous * Math.exp(-step * .0015)))
  if (next === previous) return
  const rect = image.value.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  pan.value = boundedPan(
    pan.value.x + (event.clientX - centerX) * (1 - next / previous),
    pan.value.y + (event.clientY - centerY) * (1 - next / previous),
    next
  )
  zoom.value = next
}

function startPan(event: PointerEvent) {
  if (zoom.value <= 1 || event.button !== 0) return
  event.preventDefault()
  dragging.value = true
  dragStart = { x: event.clientX, y: event.clientY, panX: pan.value.x, panY: pan.value.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function movePan(event: PointerEvent) {
  if (!dragging.value) return
  pan.value = boundedPan(dragStart.panX + event.clientX - dragStart.x,
    dragStart.panY + event.clientY - dragStart.y, zoom.value)
}

function endPan() { dragging.value = false }
function resetView() { zoom.value = 1; pan.value = { x: 0, y: 0 }; dragging.value = false }

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
  void nextTick(() => closeButton.value?.focus())
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div class="media-quick-look" role="dialog" aria-modal="true" :aria-label="`预览：${name}`" @click.self="emit('close')">
      <header class="quick-look-header">
        <strong :title="name">{{ name }}</strong>
        <button ref="closeButton" type="button" aria-label="关闭大图" title="关闭（Esc）" @click="emit('close')"><CloseOutlined /></button>
      </header>
      <div ref="stage" class="quick-look-stage" @click.self="emit('close')" @wheel="onWheel">
        <p v-if="failed" class="quick-look-error">无法加载预览</p>
        <img v-else-if="kind === 'image'" ref="image" :src="src" :alt="name"
          :style="{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? dragging ? 'grabbing' : 'grab' : 'default' }"
          draggable="false" @error="failed = true" @pointerdown="startPan" @pointermove="movePan"
          @pointerup="endPan" @pointercancel="endPan" @lostpointercapture="endPan" @dblclick="resetView" />
        <video v-else-if="kind === 'video'" :src="src" controls preload="metadata" @error="failed = true" />
        <div v-else class="quick-look-audio"><CustomerServiceOutlined /><audio :src="src" controls preload="metadata" @error="failed = true" /></div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.media-quick-look{position:fixed;inset:0;z-index:1200;display:flex;flex-direction:column;background:#0b1019ed;color:#fff;backdrop-filter:blur(10px)}
.quick-look-header{height:56px;flex:none;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 20px;background:#101720bb}
.quick-look-header strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:550}
.quick-look-header button{width:32px;height:32px;flex:none;border:1px solid #ffffff30;border-radius:7px;background:#ffffff12;color:inherit;font-size:14px;cursor:pointer}
.quick-look-header button:hover{background:#ffffff28}.quick-look-header button:focus-visible{outline:2px solid #9ccfff;outline-offset:2px}
.quick-look-stage{flex:1;min-width:0;min-height:0;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;overflow:hidden;padding:24px}
.quick-look-stage img,.quick-look-stage video{display:block;max-width:calc(100vw - 48px);max-height:calc(100dvh - 104px);object-fit:contain}
.quick-look-stage img{touch-action:none;user-select:none;transform-origin:center}
.quick-look-audio{display:flex;flex-direction:column;align-items:center;gap:28px;width:min(100%,420px);padding:42px 24px;border:1px solid #ffffff28;border-radius:16px;background:#ffffff0d}
.quick-look-audio>.anticon{font-size:64px;color:#a6c9ff}.quick-look-audio audio{width:100%}
.quick-look-error{color:#dfe6ef;font-size:13px}
@media(max-width:600px){.quick-look-stage{padding:12px}.quick-look-stage img,.quick-look-stage video{max-width:calc(100vw - 24px);max-height:calc(100dvh - 80px)}.quick-look-header{padding:0 12px}}
</style>
