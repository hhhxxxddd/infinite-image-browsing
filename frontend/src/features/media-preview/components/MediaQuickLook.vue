<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { CustomerServiceOutlined } from '@ant-design/icons-vue'
import { Modal } from 'ant-design-vue'

defineProps<{
  src: string
  name: string
  kind: 'image' | 'video' | 'audio'
  wide?: boolean
  title?: string
  canvas?: boolean
}>()
const emit = defineEmits<{
  close: []
  loaded: [info: { width?: number; height?: number; duration?: number }]
}>()
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
function imageLoaded(event: Event) {
  const image = event.target as HTMLImageElement
  emit('loaded', { width: image.naturalWidth, height: image.naturalHeight })
}
function mediaLoaded(event: Event) {
  const media = event.target as HTMLVideoElement
  emit('loaded', {
    width: media.videoWidth,
    height: media.videoHeight,
    duration: Number.isFinite(media.duration) ? media.duration : undefined
  })
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
    :title="title || `预览：${name}`"
    :width="`min(${wide ? 1100 : 800}px, calc(100vw - 48px))`"
    :footer="null"
    :z-index="1200"
    :keyboard="false"
    centered
    @cancel="emit('close')"
  >
    <slot name="toolbar" />
    <div :class="{ 'quick-look-layout': $slots.side }">
      <div class="quick-look-main" :class="{ 'canvas-surface': canvas }">
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
              @load="imageLoaded"
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
              @loadedmetadata="mediaLoaded"
              @error="failed = true"
            />
            <div v-else class="quick-look-audio">
              <CustomerServiceOutlined /><audio
                :src="src"
                controls
                preload="metadata"
                @loadedmetadata="mediaLoaded"
                @error="failed = true"
              />
            </div>
          </div>
        </slot>
      </div>
      <aside v-if="$slots.side" class="quick-look-side">
        <div class="quick-look-side-scroll"><slot name="side" /></div>
        <footer v-if="$slots.actions" class="quick-look-actions"><slot name="actions" /></footer>
      </aside>
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
.canvas-surface {
  height: min(64dvh, 600px);
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-border) 65%, var(--ui-text));
  border-radius: 10px;
  background: color-mix(in srgb, var(--ui-surface-soft) 88%, var(--ui-text));
  box-shadow: inset 0 1px 4px #15283a14;
}
.canvas-surface .quick-look-stage,
.canvas-surface :deep(.result-detail) {
  height: 100%;
  background: transparent;
}
.canvas-surface .quick-look-stage img,
.canvas-surface .quick-look-stage video {
  box-shadow: 0 3px 16px #15283a30;
}
.quick-look-side {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: min(64dvh, 600px);
  overflow: hidden;
  border-left: 1px solid var(--ui-border);
  padding-left: 16px;
  color: var(--ui-text);
}
.quick-look-side-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding-right: 8px;
}
.quick-look-actions {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 12px;
  margin-top: 12px;
  border-top: 1px solid var(--ui-border);
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
