<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { CustomerServiceOutlined } from '@ant-design/icons-vue'
import { Modal } from 'ant-design-vue'

defineProps<{
  src: string
  name: string
  kind: 'image' | 'video' | 'audio'
  wide?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
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
  const width =
    viewport.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const height =
    viewport.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
  const maxX = Math.max(0, (picture.offsetWidth * scale - width) / 2)
  const maxY = Math.max(0, (picture.offsetHeight * scale - height) / 2)
  return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
}

function onWheel(event: WheelEvent) {
  if (!image.value) return
  event.preventDefault()
  const previous = zoom.value
  const pixels =
    event.deltaY *
    (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? (stage.value?.clientHeight ?? 1) : 1)
  const step = Math.max(-180, Math.min(180, pixels))
  const next = Math.max(0.25, Math.min(8, previous * Math.exp(-step * 0.0015)))
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
  pan.value = boundedPan(
    dragStart.panX + event.clientX - dragStart.x,
    dragStart.panY + event.clientY - dragStart.y,
    zoom.value
  )
}

function endPan() {
  dragging.value = false
}
function resetView() {
  zoom.value = 1
  pan.value = { x: 0, y: 0 }
  dragging.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopImmediatePropagation()
  emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Modal
    :open="true"
    :title="`预览：${name}`"
    :width="`min(${wide ? 1100 : 800}px, calc(100vw - 48px))`"
    :footer="null"
    :z-index="1200"
    :keyboard="false"
    centered
    @cancel="emit('close')"
  >
    <slot name="toolbar" />
    <div :class="{ 'quick-look-layout': $slots.side }">
      <div class="quick-look-main">
        <slot>
          <div ref="stage" class="quick-look-stage" @wheel="onWheel">
            <p v-if="failed" class="quick-look-error">无法加载预览</p>
            <img
              v-else-if="kind === 'image'"
              ref="image"
              :src="src"
              :alt="name"
              :style="{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default'
              }"
              draggable="false"
              @error="failed = true"
              @pointerdown="startPan"
              @pointermove="movePan"
              @pointerup="endPan"
              @pointercancel="endPan"
              @lostpointercapture="endPan"
              @dblclick="resetView"
            />
            <video
              v-else-if="kind === 'video'"
              :src="src"
              controls
              preload="metadata"
              @error="failed = true"
            />
            <div v-else class="quick-look-audio">
              <CustomerServiceOutlined /><audio
                :src="src"
                controls
                preload="metadata"
                @error="failed = true"
              />
            </div>
          </div>
        </slot>
      </div>
      <aside v-if="$slots.side" class="quick-look-side"><slot name="side" /></aside>
    </div>
  </Modal>
</template>

<style scoped>
.quick-look-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 16px;
}
.quick-look-main {
  min-width: 0;
}
.quick-look-side {
  height: min(64dvh, 600px);
  overflow: auto;
  border-left: 1px solid var(--ui-border);
  padding-left: 16px;
  color: var(--ui-text);
}
@media (max-width: 760px) {
  .quick-look-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .quick-look-side {
    height: auto;
    max-height: 35dvh;
    border-left: 0;
    border-top: 1px solid var(--ui-border);
    padding: 12px 0 0;
  }
}
.quick-look-stage {
  height: min(64dvh, 600px);
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  place-items: center;
  overflow: hidden;
  padding: 12px;
  border-radius: 8px;
  background: var(--ui-surface-soft);
  box-sizing: border-box;
}
.quick-look-stage img,
.quick-look-stage video {
  display: block;
  max-width: 100%;
  max-height: calc(min(64dvh, 600px) - 24px);
  object-fit: contain;
}
.quick-look-stage img {
  touch-action: none;
  user-select: none;
  transform-origin: center;
}
.quick-look-audio {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 28px;
  width: min(100%, 420px);
  padding: 24px;
}
.quick-look-audio > .anticon {
  font-size: 64px;
  color: var(--primary-color);
}
.quick-look-audio audio {
  width: 100%;
}
.quick-look-error {
  color: var(--ui-muted);
  font-size: 13px;
}
</style>
