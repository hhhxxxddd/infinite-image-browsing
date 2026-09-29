<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { onClickOutside, useEventListener, useResizeObserver } from '@vueuse/core'
import { LeftOutlined, RightOutlined, CloseOutlined, PlusOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { StudioTask } from '@/features/ai-workflows/api/studioTasks'
import AITaskCard from '@/features/ai-workflows/components/AITaskCard.vue'
import type { WorkspaceAsset, MediaKind } from '../model/workspaceModel'
import type { MaterialController } from '../model/workspaceMaterials'
import {
  buildWorkspaceStrip,
  groupWorkspaceStrip,
  workspaceProductPaths,
  sliceWorkspaceStripGroups
} from '../model/workspaceAssetStrip'
import WorkspaceMaterialBar from './WorkspaceMaterialBar.vue'
import WorkspaceMaterialClickModes from './WorkspaceMaterialClickModes.vue'
import WorkspaceMaterialThumbnail from './WorkspaceMaterialThumbnail.vue'
import AssetHoverPreview from './AssetHoverPreview.vue'

const props = defineProps<{
  assets: WorkspaceAsset[]
  assetInfo: Record<string, FileNodeInfo>
  allowedKinds: MediaKind[]
  controller?: MaterialController
  tasks: StudioTask[]
  readonly?: boolean
  placement?: 'above' | 'below'
  contextKey: string
  usageHints?: Record<string, string>
  emptyState?: { title: string; description: string }
}>()
const emit = defineEmits<{ select: [asset: WorkspaceAsset, event: MouseEvent]; add: [] }>()
const browserId = useId()
const root = ref<HTMLElement>(),
  viewport = ref<HTMLElement>(),
  gridViewport = ref<HTMLElement>()
const search = ref<HTMLInputElement>()
const hover = ref<InstanceType<typeof AssetHoverPreview>>()
const menuOpen = ref(false)
const expanded = ref(false),
  query = ref(''),
  source = ref('all')
const kind = ref<MediaKind | 'all'>('image')
const defaultKind = computed(() =>
  props.allowedKinds.length > 1 ? 'all' : (props.allowedKinds[0] ?? 'image')
)
const visibleCount = ref(16),
  canLeft = ref(false),
  canRight = ref(false)
const gridTop = ref(0),
  gridWidth = ref(700),
  gridHeight = ref(300)
const browserSpace = ref(400)
function measureBrowserSpace() {
  const bounds = root.value?.getBoundingClientRect()
  if (!bounds) return
  browserSpace.value = Math.max(
    0,
    (props.placement === 'above' ? bounds.top : window.innerHeight - bounds.bottom) - 18
  )
}
useResizeObserver(root, measureBrowserSpace)
useEventListener(window, 'resize', measureBrowserSpace)
useEventListener(window, 'scroll', measureBrowserSpace, { capture: true, passive: true })
const kinds = [
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' }
] as const
const available = computed(() =>
  (props.controller?.assets ?? props.assets).filter((asset) =>
    props.allowedKinds.includes(asset.kind)
  )
)
const roles = computed(() => props.controller?.roles ?? {})
const createdPaths = computed(() => workspaceProductPaths(available.value, props.assetInfo))
const groups = computed(() =>
  groupWorkspaceStrip(
    buildWorkspaceStrip(
      available.value,
      props.controller?.recentPaths ?? [],
      Object.keys(roles.value),
      props.allowedKinds.includes('image') ? props.tasks : [],
      createdPaths.value
    ),
    createdPaths.value,
    [...(props.controller?.recentPaths ?? []), ...Object.keys(roles.value)]
  )
)
const ordered = computed(() => groups.value.flatMap((group) => group.items))
const stripItems = computed(() => ordered.value.slice(0, visibleCount.value))
const visibleGroups = computed(() => sliceWorkspaceStripGroups(groups.value, visibleCount.value))
const filtered = computed(() =>
  ordered.value.filter((item) => {
    const created =
      item.kind === 'task' ||
      (!!props.assetInfo[item.asset.path]?.workspace_artifact_id &&
        !props.assetInfo[item.asset.path]?.workspace_input_owner)
    const name = item.kind === 'task' ? item.task.name : item.asset.name
    return (
      (kind.value === 'all' ||
        (item.kind === 'task' ? kind.value === 'image' : item.asset.kind === kind.value)) &&
      name.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()) &&
      (source.value === 'all' || (source.value === 'workspace' ? created : !created))
    )
  })
)
const columns = computed(() => Math.max(1, Math.floor((gridWidth.value - 6 + 8) / 124)))
// Card width plus the filename, its gap and padding; keep virtual rows aligned
// with the square thumbnails as the panel changes width.
const gridRowHeight = computed(
  () => (gridWidth.value - 6 - (columns.value - 1) * 8) / columns.value + 21
)
const gridRowPitch = computed(() => gridRowHeight.value + 8)
const rows = computed(() => Math.ceil(filtered.value.length / columns.value))
const gridContentHeight = computed(() => Math.max(0, rows.value * gridRowPitch.value - 8 + 6))
const startRow = computed(() => Math.max(0, Math.floor(gridTop.value / gridRowPitch.value) - 2))
const endRow = computed(() =>
  Math.min(rows.value, Math.ceil((gridTop.value + gridHeight.value) / gridRowPitch.value) + 2)
)
const gridItems = computed(() =>
  filtered.value.slice(startRow.value * columns.value, endRow.value * columns.value)
)
function close(restore = false) {
  expanded.value = false
  if (restore) root.value?.querySelector<HTMLButtonElement>('.material-browse')?.focus()
}
onClickOutside(root, () => close())
watch(
  () => props.contextKey,
  () => {
    close()
    menuOpen.value = false
    hover.value?.hide()
    query.value = ''
    source.value = 'all'
    kind.value = defaultKind.value
    visibleCount.value = 16
    if (viewport.value) viewport.value.scrollLeft = 0
  }
)
watch(
  defaultKind,
  (value) => {
    kind.value = value
  },
  { immediate: true }
)
watch([query, source, kind, columns], () => {
  gridTop.value = 0
  if (gridViewport.value) gridViewport.value.scrollTop = 0
})
async function toggle() {
  measureBrowserSpace()
  expanded.value = !expanded.value
  hover.value?.hide()
  if (expanded.value) {
    await nextTick()
    search.value?.focus()
  }
}
function measure() {
  const el = viewport.value
  canLeft.value = !!el && el.scrollLeft > 1
  canRight.value =
    !!el &&
    (el.scrollLeft + el.clientWidth < el.scrollWidth - 1 ||
      visibleCount.value < ordered.value.length)
}
async function onScroll() {
  hover.value?.hide()
  const el = viewport.value
  if (
    el &&
    el.scrollLeft + el.clientWidth >= el.scrollWidth - 80 &&
    visibleCount.value < ordered.value.length
  ) {
    visibleCount.value += 16
    await nextTick()
  }
  measure()
}
useResizeObserver(viewport, measure)
useResizeObserver(gridViewport, (entries) => {
  const rect = entries[0]?.contentRect
  if (rect) {
    gridWidth.value = rect.width
    gridHeight.value = rect.height
  }
})
watch(stripItems, () => nextTick(measure), { flush: 'post' })
async function wheel(event: WheelEvent) {
  const el = viewport.value
  if (!el) return
  hover.value?.hide()
  const delta = Math.abs(event.deltaY) > Math.abs(event.deltaX) ? event.deltaY : event.deltaX
  const pixels = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1)
  if (
    pixels > 0 &&
    el.scrollLeft + el.clientWidth + pixels >= el.scrollWidth &&
    visibleCount.value < ordered.value.length
  ) {
    visibleCount.value += 16
    await nextTick()
  }
  el.scrollLeft += pixels
  measure()
}
function onMenuOpen(open: boolean) {
  menuOpen.value = open
  if (open) hover.value?.hide()
}
async function scrollMaterials(direction: -1 | 1) {
  hover.value?.hide()
  const el = viewport.value
  if (!el) return
  if (direction > 0 && visibleCount.value < ordered.value.length) {
    visibleCount.value += 16
    await nextTick()
  }
  el.scrollBy({
    left: direction * Math.max(74, el.clientWidth - 74),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
  })
}
function showPreview(asset: WorkspaceAsset, event: MouseEvent | FocusEvent) {
  const file = props.assetInfo[asset.path]
  if (!menuOpen.value && file && asset.kind === 'image')
    hover.value?.show(
      {
        file,
        name: asset.name,
        role: roles.value[asset.path] ?? '',
        description: props.usageHints?.[asset.path]
      },
      event
    )
}
function assetTitle(asset: WorkspaceAsset) {
  return [asset.name, props.usageHints?.[asset.path]].filter(Boolean).join('\n')
}
function select(asset: WorkspaceAsset, event: MouseEvent) {
  hover.value?.hide()
  close()
  emit('select', asset, event)
}
function add() {
  close()
  emit('add')
}
function actions(asset: WorkspaceAsset) {
  return props.controller?.actions(asset) ?? []
}
function runAction(asset: WorkspaceAsset, key: string) {
  hover.value?.hide()
  close()
  props.controller?.runAction(asset, key)
}
function classes(asset: WorkspaceAsset) {
  return {
    'workspace-created':
      !!props.assetInfo[asset.path]?.workspace_artifact_id &&
      !props.assetInfo[asset.path]?.workspace_input_owner,
    active: props.controller?.activePath === asset.path,
    referenced: roles.value[asset.path]?.startsWith('参考图')
  }
}
</script>

<template>
  <div ref="root" @keydown.esc.stop="close(true)">
    <WorkspaceMaterialBar
      :expanded="expanded"
      :browser-id="browserId"
      :readonly="readonly"
      @browse="toggle"
      @add="add"
    >
      <div
        v-if="stripItems.length"
        class="asset-carousel"
        :class="{ scrollable: canLeft || canRight }"
        @wheel.prevent="wheel"
      >
        <div ref="viewport" class="asset-list" aria-label="工作区素材" @scroll="onScroll">
          <section
            v-for="group in visibleGroups"
            :key="group.key"
            class="material-strip-group"
            :class="group.key"
            :aria-label="`${group.label} ${group.assetCount}`"
          >
            <template v-for="item in group.items" :key="`${contextKey}:${item.key}`">
              <AITaskCard v-if="item.kind === 'task'" :task="item.task" compact />
              <a-dropdown
                v-else
                :trigger="actions(item.asset).length ? ['contextmenu'] : []"
                @open-change="onMenuOpen"
              >
                <button
                  type="button"
                  class="asset-strip-card"
                  :class="classes(item.asset)"
                  :title="assetTitle(item.asset)"
                  :aria-label="`${item.asset.name}${roles[item.asset.path] ? ` · ${roles[item.asset.path]}` : ''}`"
                  :aria-pressed="
                    roles[item.asset.path] ? controller?.activePath === item.asset.path : undefined
                  "
                  @click="select(item.asset, $event)"
                  @mouseenter="showPreview(item.asset, $event)"
                  @mouseleave="hover?.hide()"
                  @focus="showPreview(item.asset, $event)"
                  @blur="hover?.hide()"
                >
                  <WorkspaceMaterialThumbnail
                    :asset="item.asset"
                    :file="assetInfo[item.asset.path]"
                    :role="roles[item.asset.path]"
                  />
                </button>
                <template #overlay
                  ><a-menu @click="runAction(item.asset, String($event.key))"
                    ><a-menu-item
                      v-for="action in actions(item.asset)"
                      :key="action.key"
                      :disabled="action.disabled"
                      :danger="action.danger"
                      >{{ action.label }}</a-menu-item
                    ></a-menu
                  ></template
                >
              </a-dropdown>
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
            @click="scrollMaterials(-1)"
          >
            <LeftOutlined />
          </button>
          <button
            type="button"
            class="asset-scroll-arrow right"
            aria-label="向右滚动素材"
            title="向右滚动素材"
            :disabled="!canRight"
            @click="scrollMaterials(1)"
          >
            <RightOutlined />
          </button>
        </template>
      </div>
      <div v-else class="asset-carousel material-empty">
        <button
          type="button"
          class="empty-material-add"
          aria-label="从媒体库加入素材"
          :disabled="readonly"
          @click="add"
        >
          <PlusOutlined />
        </button>
        <div>
          <span>{{ emptyState?.title ?? '暂无素材' }}</span
          ><small v-if="emptyState">{{ emptyState.description }}</small
          ><small v-else
            >{{ readonly ? '当前工作区没有可用素材' : '从媒体库加入'
            }}{{
              allowedKinds
                .map((value) => kinds.find((item) => item.value === value)?.label)
                .join('、')
            }}</small
          >
        </div>
      </div>
      <template v-if="controller?.clickOptions?.length" #tools>
        <WorkspaceMaterialClickModes
          :model-value="controller.clickMode ?? 'view'"
          :options="controller.clickOptions"
          @update:model-value="controller?.setClickMode?.($event)"
        />
      </template>
      <template #browser>
        <Transition name="material-browser">
          <div
            v-if="expanded"
            :id="browserId"
            class="material-browser"
            :class="{ above: placement === 'above' }"
            :style="{ maxHeight: `${browserSpace}px` }"
            role="dialog"
            aria-label="浏览工作区素材"
          >
            <header>
              <strong>全部素材</strong><span>{{ available.length }}</span
              ><input
                ref="search"
                v-model="query"
                type="search"
                aria-label="搜索工作区素材"
                placeholder="搜索工作区素材"
              /><button type="button" aria-label="关闭素材浏览" @click="close(true)">
                <CloseOutlined />
              </button>
            </header>
            <div class="browser-tools">
              <a-segmented
                v-model:value="kind"
                :options="[
                  ...(allowedKinds.length > 1 ? [{ value: 'all', label: '全部类型' }] : []),
                  ...kinds.map((item) => ({
                    ...item,
                    disabled: !allowedKinds.includes(item.value)
                  }))
                ]"
                aria-label="素材类型"
              />
              <a-segmented
                v-model:value="source"
                :options="[
                  { value: 'all', label: '全部' },
                  { value: 'library', label: '引用' },
                  { value: 'workspace', label: '产物' }
                ]"
                aria-label="素材来源"
              />
            </div>
            <div
              v-if="filtered.length"
              ref="gridViewport"
              class="grid-viewport"
              :style="{ '--material-grid-height': `${Math.min(300, gridContentHeight)}px` }"
              @scroll="gridTop = ($event.target as HTMLElement).scrollTop"
            >
              <div :style="{ height: `${gridContentHeight}px`, position: 'relative' }">
                <div
                  class="browser-grid"
                  :style="{
                    transform: `translateY(${startRow * gridRowPitch}px)`,
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gridAutoRows: `${gridRowHeight}px`
                  }"
                >
                  <template v-for="item in gridItems" :key="`${contextKey}:${item.key}`">
                    <AITaskCard v-if="item.kind === 'task'" :task="item.task" compact />
                    <a-dropdown
                      v-else
                      :trigger="actions(item.asset).length ? ['contextmenu'] : []"
                      @open-change="onMenuOpen"
                    >
                      <button
                        type="button"
                        class="material-grid-card"
                        :class="classes(item.asset)"
                        :title="assetTitle(item.asset)"
                        @click="select(item.asset, $event)"
                      >
                        <span class="browser-thumbnail"
                          ><WorkspaceMaterialThumbnail
                            :asset="item.asset"
                            :file="assetInfo[item.asset.path]"
                            :role="roles[item.asset.path]"
                        /></span>
                        <span class="browser-name">{{ item.asset.name }}</span>
                      </button>
                      <template #overlay
                        ><a-menu @click="runAction(item.asset, String($event.key))"
                          ><a-menu-item
                            v-for="action in actions(item.asset)"
                            :key="action.key"
                            :disabled="action.disabled"
                            :danger="action.danger"
                            >{{ action.label }}</a-menu-item
                          ></a-menu
                        ></template
                      >
                    </a-dropdown>
                  </template>
                </div>
              </div>
            </div>
            <p v-else class="browser-empty">没有匹配的素材。</p>
          </div>
        </Transition>
      </template>
    </WorkspaceMaterialBar>
    <AssetHoverPreview ref="hover" />
  </div>
</template>

<style scoped src="./workspaceMaterialCarousel.css"></style>
<style scoped src="./workspaceMaterialCardMotion.css"></style>
<style scoped>
.material-empty {
  box-sizing: border-box;
  min-height: 76px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 8px;
  background: var(--ui-surface-soft);
  font-size: 12px;
}
.material-empty small {
  display: block;
  margin-top: 4px;
  color: var(--ui-muted);
  font-size: 11px;
}
.empty-material-add {
  display: grid;
  place-items: center;
  flex: none;
  width: 64px;
  height: 64px;
  border: 1px dashed var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  color: var(--primary-color);
  font-size: 22px;
  cursor: pointer;
}
.empty-material-add:hover:not(:disabled),
.empty-material-add:focus-visible {
  border-color: var(--primary-color);
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.empty-material-add:disabled {
  opacity: 0.45;
  cursor: default;
}
.material-browser.above {
  top: auto;
  bottom: calc(100% + 6px);
}
.material-browser {
  --material-slide: -10px;
  position: absolute;
  z-index: 25;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
  box-shadow: 0 12px 32px #0003;
  transform-origin: top right;
}
.material-browser.above {
  --material-slide: 10px;
  transform-origin: bottom right;
}
.material-browser-enter-active {
  transition:
    opacity 0.22s ease,
    transform 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.material-browser-leave-active {
  pointer-events: none;
  transition:
    opacity 0.14s ease,
    transform 0.16s ease;
}
.material-browser-enter-from,
.material-browser-leave-to {
  opacity: 0;
  transform: translateY(var(--material-slide)) scale(0.96);
}
header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  font-size: 12px;
}
header > span {
  color: var(--ui-muted);
  font-size: 11px;
}
header input {
  flex: 1;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--ui-text);
  caret-color: currentColor;
  font: inherit;
}
header button {
  border: 0;
  background: none;
  color: var(--ui-muted);
  cursor: pointer;
}
.browser-tools {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.grid-viewport {
  flex: 0 1 var(--material-grid-height);
  min-height: 0;
  height: var(--material-grid-height);
  max-height: 45vh;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.browser-grid {
  position: absolute;
  inset: 0 0 auto;
  display: grid;
  gap: 8px;
  padding: 3px;
}
.browser-grid button {
  display: grid;
  grid-template-rows: minmax(0, 1fr) 16px;
  gap: 5px;
  width: 100%;
  height: 100%;
  min-width: 0;
  padding: 5px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
  box-sizing: border-box;
}
.browser-grid :deep(.ai-task-card.ai-task-card.compact) {
  width: 100%;
  height: 100%;
  min-width: 0;
  max-width: none;
}
.browser-thumbnail {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 1;
  min-height: 0;
}
.browser-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 16px;
}
.browser-empty {
  padding: 24px;
  text-align: center;
  color: var(--ui-muted);
}
.asset-list button.active,
.browser-grid button.active {
  border-color: var(--primary-color);
  box-shadow: inset 0 0 0 1px var(--primary-color);
}
.asset-list button.referenced:not(.active),
.browser-grid button.referenced:not(.active) {
  border-color: var(--primary-color);
  border-style: dashed;
}
.browser-grid button.workspace-created {
  border-color: color-mix(in srgb, #f6d27a 78%, var(--ui-border));
  background: color-mix(in srgb, #f6d27a 22%, var(--ui-surface));
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}
@media (prefers-reduced-motion: reduce) {
  .material-browser-enter-active,
  .material-browser-leave-active {
    transition: none;
  }
  .material-browser-enter-from,
  .material-browser-leave-to {
    transform: none;
  }
}
</style>
