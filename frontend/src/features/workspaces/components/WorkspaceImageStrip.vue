<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import { LeftOutlined, RightOutlined, PlusOutlined, CheckOutlined } from '@ant-design/icons-vue'
import type { ImageEditorProps } from '@/features/image-editor/public'
import AssetHoverPreview from './AssetHoverPreview.vue'
import WorkspaceMaterialThumbnail from './WorkspaceMaterialThumbnail.vue'
import WorkspaceMaterialBar from './WorkspaceMaterialBar.vue'
import {
  mergeMaterialHistory,
  readMaterialHistory,
  writeMaterialHistory
} from '../model/workspaceMaterialHistory'
import {
  buildWorkspaceStrip,
  groupWorkspaceStrip,
  workspaceProductPaths,
  sliceWorkspaceStripGroups
} from '../model/workspaceAssetStrip'

const props = defineProps<{
  workspaceId: string
  assets: ImageEditorProps['assets']
  assetInfo: ImageEditorProps['assetInfo']
  selectedPath: string
  usedPaths: string[]
  canReplace: boolean
  disabled: boolean
}>()
const emit = defineEmits<{
  pick: [path: string, replace: boolean]
  browse: [mode: 'add' | 'replace']
  addAssets: []
}>()
const mode = ref<'add' | 'replace'>('add')
const viewport = ref<HTMLElement>()
const hover = ref<InstanceType<typeof AssetHoverPreview>>()
const limit = ref(16)
const canLeft = ref(false),
  canRight = ref(false)
const images = computed(() => props.assets.filter((asset) => asset.kind === 'image'))
const recentPaths = ref<string[]>([])
watch(
  [() => props.workspaceId, () => props.usedPaths],
  ([workspaceId, paths], previous) => {
    const key = `omnigallery:image-studio-recent-v1:${workspaceId}`
    if (!previous || previous[0] !== workspaceId) {
      // Reopening an editor restores history without promoting the current layers again.
      recentPaths.value = mergeMaterialHistory(paths, readMaterialHistory(key))
    } else {
      const previousPaths = new Set(previous[1])
      const added = paths.filter(
        (path) => !previousPaths.has(path) && !recentPaths.value.includes(path)
      )
      if (!added.length) return
      recentPaths.value = mergeMaterialHistory(recentPaths.value, added)
    }
    writeMaterialHistory(key, recentPaths.value)
  },
  { immediate: true }
)
const createdPaths = computed(() => workspaceProductPaths(images.value, props.assetInfo))
const groups = computed(() =>
  groupWorkspaceStrip(
    buildWorkspaceStrip(images.value, recentPaths.value, props.usedPaths, [], createdPaths.value),
    createdPaths.value,
    recentPaths.value
  )
)
const visibleGroups = computed(() => sliceWorkspaceStripGroups(groups.value, limit.value))
const used = computed(() => new Set(props.usedPaths))
watch(
  () => props.canReplace,
  (available) => {
    if (!available) mode.value = 'add'
  }
)
function measure() {
  const el = viewport.value
  canLeft.value = !!el && el.scrollLeft > 1
  canRight.value =
    !!el &&
    (el.scrollLeft < el.scrollWidth - el.clientWidth - 1 || limit.value < images.value.length)
}
async function onScroll() {
  hover.value?.hide()
  const el = viewport.value
  if (
    el &&
    el.scrollLeft + el.clientWidth >= el.scrollWidth - 80 &&
    limit.value < images.value.length
  ) {
    limit.value += 16
    await nextTick()
  }
  measure()
}
async function move(pixels: number, smooth = false) {
  const el = viewport.value
  if (!el) return
  hover.value?.hide()
  if (
    pixels > 0 &&
    el.scrollLeft + el.clientWidth + pixels >= el.scrollWidth &&
    limit.value < images.value.length
  ) {
    limit.value += 16
    await nextTick()
  }
  el.scrollBy({
    left: pixels,
    behavior:
      smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'smooth'
        : 'instant'
  })
  measure()
}
function wheel(event: WheelEvent) {
  const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
  void move(
    delta *
      (event.deltaMode === 1
        ? 16
        : event.deltaMode === 2
          ? (viewport.value?.clientWidth ?? 300)
          : 1)
  )
}
function showPreview(asset: ImageEditorProps['assets'][number], event: MouseEvent | FocusEvent) {
  const file = props.assetInfo[asset.path]
  if (file)
    hover.value?.show(
      { file, name: asset.name, role: used.value.has(asset.path) ? '已使用' : '' },
      event
    )
}
function pick(path: string) {
  if (props.disabled || (mode.value === 'replace' && !props.canReplace)) return
  hover.value?.hide()
  emit('pick', path, mode.value === 'replace')
}
useResizeObserver(viewport, measure)
watch(
  groups,
  async () => {
    await nextTick()
    measure()
  },
  { flush: 'post' }
)
</script>

<template>
  <section class="workspace-image-strip" aria-label="工作区图片素材">
    <WorkspaceMaterialBar
      :readonly="disabled"
      :browse-disabled="disabled"
      @browse="emit('browse', mode)"
      @add="emit('addAssets')"
    >
      <div
        v-if="images.length"
        class="asset-carousel"
        :class="{ scrollable: canLeft || canRight }"
        @wheel.prevent.stop="wheel"
      >
        <div ref="viewport" class="asset-list" @scroll="onScroll">
          <section
            v-for="group in visibleGroups"
            :key="group.key"
            class="material-strip-group"
            :class="group.key"
            :aria-label="group.label"
          >
            <template v-for="item in group.items" :key="item.key">
              <button
                v-if="item.kind === 'asset'"
                type="button"
                class="asset-strip-card"
                :class="{
                  active: selectedPath === item.asset.path,
                  'workspace-created': assetInfo[item.asset.path]?.workspace_artifact_id
                }"
                :disabled="disabled"
                :aria-label="`${mode === 'replace' ? '替换为' : '添加图层'}：${item.asset.name}${used.has(item.asset.path) ? ' · 已使用' : ''}`"
                :title="item.asset.name"
                @click="pick(item.asset.path)"
                @mouseenter="showPreview(item.asset, $event)"
                @mouseleave="hover?.hide()"
                @focus="showPreview(item.asset, $event)"
                @blur="hover?.hide()"
              >
                <WorkspaceMaterialThumbnail
                  :asset="item.asset"
                  :file="assetInfo[item.asset.path]"
                />
                <small
                  v-if="used.has(item.asset.path)"
                  class="strip-used"
                  title="已使用"
                  aria-label="已使用"
                  ><CheckOutlined
                /></small>
              </button>
            </template>
          </section>
        </div>
        <template v-if="canLeft || canRight">
          <button
            type="button"
            class="asset-scroll-arrow left"
            aria-label="向左滚动素材"
            title="向左滚动素材"
            :disabled="!canLeft"
            @click="move(-Math.max(74, (viewport?.clientWidth ?? 374) - 74), true)"
          >
            <LeftOutlined />
          </button>
          <button
            type="button"
            class="asset-scroll-arrow right"
            aria-label="向右滚动素材"
            title="向右滚动素材"
            :disabled="!canRight"
            @click="move(Math.max(74, (viewport?.clientWidth ?? 374) - 74), true)"
          >
            <RightOutlined />
          </button>
        </template>
      </div>
      <div v-else class="asset-carousel strip-empty">
        <button
          type="button"
          class="empty-add"
          aria-label="从媒体库加入素材"
          :disabled="disabled"
          @click="emit('addAssets')"
        >
          <PlusOutlined />
        </button>
        <div>暂无图片素材<small>从媒体库加入图片，用于添加图层或替换</small></div>
      </div>
      <template #tools>
        <div class="strip-modes" role="group" aria-label="素材点击操作">
          <button
            type="button"
            :aria-pressed="mode === 'add'"
            :disabled="disabled"
            @click="mode = 'add'"
          >
            添加图层
          </button>
          <button
            type="button"
            :aria-pressed="mode === 'replace'"
            :disabled="disabled || !canReplace"
            :title="canReplace ? '点击素材替换当前图片图层' : '先选中未锁定的图片图层'"
            @click="mode = 'replace'"
          >
            替换图片
          </button>
        </div>
      </template>
    </WorkspaceMaterialBar>
    <AssetHoverPreview ref="hover" />
  </section>
</template>

<style scoped src="./workspaceMaterialCarousel.css"></style>
<style scoped>
.workspace-image-strip {
  height: 100%;
  min-width: 0;
}
.workspace-image-strip :deep(.material-bar) {
  height: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  gap: 10px;
}
.strip-modes button {
  height: 32px;
  padding: 0 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
button:hover:enabled {
  color: var(--ui-text);
  background: var(--ui-hover);
}
button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
.strip-modes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--ui-surface-soft);
  border-radius: 6px;
  padding: 2px;
}
.strip-modes button[aria-pressed='true'] {
  color: var(--primary-color);
  background: var(--primary-color-1);
}
.asset-list button.active {
  box-shadow: inset 0 0 0 2px var(--primary-color);
  border-color: var(--primary-color);
}
.strip-used {
  position: absolute;
  z-index: 5;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  font-size: 10px;
  background: var(--primary-color);
  color: var(--ui-surface-soft);
  border-radius: 4px;
  box-shadow: 0 1px 4px #0003;
}
.strip-empty {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 76px;
  padding: 4px 8px;
  color: var(--ui-muted);
  font-size: 12px;
}
.strip-empty small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
}
.empty-add {
  flex: none;
  width: 64px;
  height: 64px;
  border: 1px dashed var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
  color: var(--primary-color);
  font-size: 22px;
  cursor: pointer;
}
</style>
