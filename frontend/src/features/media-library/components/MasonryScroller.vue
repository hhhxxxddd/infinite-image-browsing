<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRaw, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import type { FileNodeInfo } from '@/features/media-library/api/files'
import {
  layoutMasonry,
  masonryItemIndexAt,
  masonryScrollAnchor,
  type MasonryLayout
} from '../model/masonryLayout'

const props = defineProps<{ items: FileNodeInfo[]; columnCount: number; cellWidth: number }>()
const emit = defineEmits<{ scroll: [event: Event] }>()
const root = ref<HTMLElement>()
const scrollTop = ref(0)
const measuredDimensions = new Map<string, { width: number; height: number }>()
const dimensionsRevision = ref(0)
let dimensionsFrame: number | undefined
let cachedLayout: MasonryLayout | undefined
const { height: viewportHeight } = useElementSize(root)
const layout = computed(() => {
  void dimensionsRevision.value
  void props.items.length
  cachedLayout = layoutMasonry(
    toRaw(props.items).map((item) => toRaw(item)),
    props.columnCount,
    props.cellWidth,
    measuredDimensions,
    cachedLayout
  )
  return cachedLayout
})
let layoutRevision = 0
watch(layout, (next, previous) => {
  const revision = ++layoutRevision
  const sameOrder =
    next.keys.length === previous?.keys.length &&
    next.keys.every((path, index) => path === previous?.keys[index])
  if (!sameOrder || !previous?.positions.length || !root.value) return
  const oldScroll = root.value.scrollTop
  const anchor = masonryScrollAnchor(previous.positions, oldScroll, previous.maxItemHeight)
  const destination = anchor && next.positions[anchor.index]
  if (!anchor || !destination) return
  // The top padding is not image content; keep the viewport at the top when resizing.
  const nextScroll =
    oldScroll <= 0
      ? 0
      : Math.max(
          0,
          Math.round(
            destination.top + ((oldScroll - anchor.top) * destination.height) / anchor.height
          )
        )
  void nextTick(() => {
    if (revision !== layoutRevision || !root.value) return
    root.value.scrollTop = nextScroll
    scrollTop.value = root.value.scrollTop
  })
})
watch(
  () => props.items,
  (items) => {
    const paths = new Set(toRaw(items).map((item) => toRaw(item).fullpath))
    for (const path of measuredDimensions.keys()) {
      if (!paths.has(path)) measuredDimensions.delete(path)
    }
  }
)
const visiblePositions = computed(() => {
  const overscan = Math.max(600, viewportHeight.value)
  const start = scrollTop.value - overscan
  const end = scrollTop.value + viewportHeight.value + overscan
  const { positions, maxItemHeight } = layout.value
  const visible = []
  for (
    let index = masonryItemIndexAt(positions, start - maxItemHeight);
    index < positions.length;
    index++
  ) {
    const position = positions[index]
    if (position.top > end) break
    if (position.top + position.height >= start) visible.push(position)
  }
  return visible
})

function onScroll(event: Event) {
  scrollTop.value = root.value?.scrollTop ?? 0
  emit('scroll', event)
}
function getScroll() {
  const start = root.value?.scrollTop ?? 0
  return { start, end: start + (root.value?.clientHeight ?? 0) }
}
function findItemIndex(offset: number) {
  return masonryItemIndexAt(layout.value.positions, offset)
}
function getVisibleItemIndices() {
  return visiblePositions.value.map((position) => position.index)
}
function scrollToItem(index: number) {
  const position = layout.value.positions[index]
  if (position && root.value) root.value.scrollTop = position.top
}
function setDimensions(path: string, width: number, height: number) {
  if (width <= 0 || height <= 0) return
  const previous = measuredDimensions.get(path)
  if (previous?.width === width && previous.height === height) return
  measuredDimensions.set(path, { width, height })
  if (dimensionsFrame !== undefined) return
  dimensionsFrame = requestAnimationFrame(() => {
    dimensionsFrame = undefined
    dimensionsRevision.value++
  })
}
onBeforeUnmount(() => {
  if (dimensionsFrame !== undefined) cancelAnimationFrame(dimensionsFrame)
})
defineExpose({ getScroll, findItemIndex, getVisibleItemIndices, scrollToItem, setDimensions })
</script>

<template>
  <div ref="root" class="masonry-scroller" @scroll="onScroll">
    <div class="masonry-canvas" :style="{ height: `${layout.totalHeight}px` }">
      <div
        v-for="position in visiblePositions"
        :key="items[position.index].fullpath"
        class="masonry-position"
        :style="{
          left: `${position.left}px`,
          top: `${position.top}px`,
          width: `${position.width}px`,
          height: `${position.height}px`
        }"
      >
        <slot
          :item="items[position.index]"
          :index="position.index"
          :card-height="position.height"
        />
      </div>
    </div>
    <slot name="after" />
  </div>
</template>

<style scoped>
.masonry-scroller {
  overflow: auto;
  min-height: 0;
  overflow-anchor: none;
}
.masonry-canvas {
  position: relative;
  width: 100%;
}
.masonry-position {
  position: absolute;
}
</style>
