<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useElementSize } from '@vueuse/core'
import type { FileNodeInfo } from '@/api/files'
import { layoutMasonry, masonryItemIndexAt, masonryScrollAnchor } from './masonryLayout'

const props = defineProps<{ items: FileNodeInfo[]; columnCount: number; cellWidth: number }>()
const emit = defineEmits<{ scroll: [event: Event] }>()
const root = ref<HTMLElement>()
const scrollTop = ref(0)
const measuredDimensions = reactive(new Map<string, { width: number; height: number }>())
const { height: viewportHeight } = useElementSize(root)
const layout = computed(() => layoutMasonry(props.items, props.columnCount, props.cellWidth, measuredDimensions))
let previousPaths = props.items.map(item => item.fullpath)
let layoutRevision = 0
watch(layout, (next, previous) => {
  const revision = ++layoutRevision
  const nextPaths = props.items.map(item => item.fullpath)
  const sameOrder = nextPaths.length === previousPaths.length && nextPaths.every((path, index) => path === previousPaths[index])
  previousPaths = nextPaths
  if (!sameOrder || !previous?.positions.length || !root.value) return
  const oldScroll = root.value.scrollTop
  const anchor = masonryScrollAnchor(previous.positions, oldScroll, previous.maxItemHeight)
  const destination = anchor && next.positions[anchor.index]
  if (!anchor || !destination) return
  const nextScroll = Math.max(0, Math.round(destination.top + (oldScroll - anchor.top) * destination.height / anchor.height))
  void nextTick(() => {
    if (revision !== layoutRevision || !root.value) return
    root.value.scrollTop = nextScroll
    scrollTop.value = root.value.scrollTop
  })
})
watch(() => props.items, items => {
  const paths = new Set(items.map(item => item.fullpath))
  for (const path of measuredDimensions.keys()) {
    if (!paths.has(path)) measuredDimensions.delete(path)
  }
})
const visiblePositions = computed(() => {
  const overscan = Math.max(600, viewportHeight.value)
  const start = scrollTop.value - overscan
  const end = scrollTop.value + viewportHeight.value + overscan
  const { positions, maxItemHeight } = layout.value
  const visible = []
  for (let index = masonryItemIndexAt(positions, start - maxItemHeight); index < positions.length; index++) {
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
function findItemIndex(offset: number) { return masonryItemIndexAt(layout.value.positions, offset) }
function getVisibleItemIndices() { return visiblePositions.value.map(position => position.index) }
function scrollToItem(index: number) {
  const position = layout.value.positions[index]
  if (position && root.value) root.value.scrollTop = position.top
}
function setDimensions(path: string, width: number, height: number) {
  if (width <= 0 || height <= 0) return
  const previous = measuredDimensions.get(path)
  if (previous?.width === width && previous.height === height) return
  measuredDimensions.set(path, { width, height })
}
defineExpose({ getScroll, findItemIndex, getVisibleItemIndices, scrollToItem, setDimensions })
</script>

<template>
  <div ref="root" class="masonry-scroller" @scroll="onScroll">
    <div class="masonry-canvas" :style="{ height: `${layout.totalHeight}px` }">
      <div v-for="position in visiblePositions" :key="items[position.index].fullpath" class="masonry-position"
        :style="{ left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`, height: `${position.height}px` }">
        <slot :item="items[position.index]" :index="position.index" :card-height="position.height" />
      </div>
    </div>
    <slot name="after" />
  </div>
</template>

<style scoped>
.masonry-scroller{overflow:auto;min-height:0}
.masonry-canvas{position:relative;width:100%}
.masonry-position{position:absolute}
</style>
