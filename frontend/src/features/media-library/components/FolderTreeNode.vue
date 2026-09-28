<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { RightOutlined, EllipsisOutlined } from '@ant-design/icons-vue'
import { getTargetFolderFiles, type FileNodeInfo } from '@/features/media-library/api/files'
import { useApplicationStore } from '@/features/application/public'
import { copy2clipboardI18n } from '@/shared/lib/clipboard'
import { getFileTransferDataFromDragEvent } from '@/features/media-library/model/mediaFiles'
import { navigate } from '@/features/application/public'
import { createSubfolder } from '../model/createSubfolder'
import { deleteSubfolder } from '../model/deleteSubfolder'
import { renameSubfolder } from '../model/renameSubfolder'
import { onAliasExtraPathClick, onRemoveExtraPathClick } from '../model/extraPathControlFunc'
import FolderIcon from './FolderIcon.vue'
import FolderIconPicker from './FolderIconPicker.vue'
import { folderExpansion } from '../model/folderExpansion'

const props = withDefaults(
  defineProps<{
    path: string
    name: string
    root?: boolean
    depth?: number
    ancestors?: string[]
    movingPath?: string
    query?: string
    focusPath?: string
  }>(),
  { root: false, depth: 0, ancestors: () => [], movingPath: '', query: '', focusPath: '' }
)
const emit = defineEmits<{
  changed: []
  startMove: [path: string]
  cancelMove: []
  move: [source: string, destination: string]
  opened: [path: string]
}>()
const global = useApplicationStore()
const children = ref<FileNodeInfo[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
// Fetch only the first layer initially. A wide folder tree must not fire one
// request per descendant as soon as the directory page opens.
const normalized = (path: string) => {
  const value = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return global.conf?.is_win ? value.toLowerCase() : value
}
const focused = computed(
  () => !!props.focusPath && normalized(props.focusPath) === normalized(props.path)
)
const onFocusedBranch = () =>
  !!props.focusPath && normalized(props.focusPath).startsWith(normalized(props.path) + '/')
// Revealing a focused branch is temporary; only explicit toggles change the saved layout.
const focusRevealed = ref(onFocusedBranch())
const revealed = computed(
  () =>
    focusRevealed.value ||
    (folderExpansion.get(props.path, global.conf?.is_win) ?? props.depth === 0)
)
watch(
  () => props.focusPath,
  () => (focusRevealed.value = onFocusedBranch())
)
const cardEl = ref<HTMLElement>()
const dropTarget = ref(false)
const iconPickerOpen = ref(false)
const menuOpen = ref(false)
const registered = computed(() => {
  const normalize = (path: string) => {
    const value = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return global.conf?.is_win ? value.toLowerCase() : value
  }
  return global.conf?.extra_paths.find((folder) => normalize(folder.path) === normalize(props.path))
})
const label = computed(() => registered.value?.alias || props.name)
const searchTerm = computed(() => props.query.trim().toLocaleLowerCase())
const matchOffset = computed(() =>
  searchTerm.value ? label.value.toLocaleLowerCase().indexOf(searchTerm.value) : -1
)
const pathMatched = computed(() => {
  if (!searchTerm.value) return false
  const matchAt = props.path.toLocaleLowerCase().indexOf(searchTerm.value)
  return (
    matchAt >= 0 &&
    (props.root || matchAt + searchTerm.value.length > (props.ancestors[0]?.length ?? 0))
  )
})
const highlighted = computed(
  () =>
    !!searchTerm.value &&
    (matchOffset.value >= 0 ||
      props.name.toLocaleLowerCase().includes(searchTerm.value) ||
      pathMatched.value)
)
const isMoving = computed(() => props.movingPath === props.path)
let disposed = false
onUnmounted(() => (disposed = true))

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  const path = props.path
  const windows = global.conf?.is_win
  try {
    const files = (await getTargetFolderFiles(path, true)).files
    if (disposed || path !== props.path) return
    children.value = files
      .filter((file) => file.type === 'dir')
      .sort((a, b) => a.name.localeCompare(b.name))
    // A successful complete listing proves which child branches were removed externally.
    folderExpansion.reconcileChildren(
      path,
      children.value.map((child) => child.fullpath),
      windows
    )
    loaded.value = true
  } catch {
    if (!disposed) error.value = '无法读取下级目录'
  } finally {
    loading.value = false
  }
}
async function reveal() {
  focusRevealed.value = false
  folderExpansion.set(props.path, true, global.conf?.is_win)
  if (!loaded.value) await load()
}
function toggleRevealed() {
  if (!revealed.value) {
    void reveal()
    return
  }
  focusRevealed.value = false
  folderExpansion.set(props.path, false, global.conf?.is_win)
}
async function created() {
  focusRevealed.value = false
  folderExpansion.set(props.path, true, global.conf?.is_win)
  await load()
  emit('changed')
}
watch(
  revealed,
  (expanded) => {
    if (expanded && !loaded.value) void load()
  },
  { immediate: true }
)
function openOrMove() {
  if (props.movingPath) {
    if (isMoving.value) emit('cancelMove')
    else emit('move', props.movingPath, props.path)
  } else {
    navigate('local', { path: props.path, mode: 'scanned-fixed' })
    emit('opened', props.path)
  }
}
function startDrag(event: DragEvent) {
  if (registered.value || global.conf?.is_readonly) {
    event.preventDefault()
    return
  }
  event.dataTransfer?.setData('application/x-omnigallery-folder-node', props.path)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function dragOver(event: DragEvent) {
  if (global.conf?.is_readonly || !event.dataTransfer) return
  if (
    !event.dataTransfer.types.includes('application/x-omnigallery-folder-node') &&
    !event.dataTransfer.types.includes('application/x-omnigallery-files')
  )
    return
  event.preventDefault()
  dropTarget.value = true
}
async function drop(event: DragEvent) {
  dropTarget.value = false
  if (global.conf?.is_readonly) return
  const source = event.dataTransfer?.getData('application/x-omnigallery-folder-node')
  if (source) {
    event.preventDefault()
    emit('move', source, props.path)
    return
  }
  const data = getFileTransferDataFromDragEvent(event)
  if (!data) return
  event.preventDefault()
  const { confirmFileTransfer } =
    await import('@/features/media-library/composables/useFileTransfer')
  confirmFileTransfer(data, props.path)
}
onMounted(() => {
  if (focused.value)
    void nextTick(() => cardEl.value?.scrollIntoView({ block: 'center', inline: 'center' }))
})

function onChildChanged() {
  void load()
  emit('changed')
}
</script>

<template>
  <div class="graph-branch">
    <article
      ref="cardEl"
      class="graph-card"
      :class="{
        'drop-active': dropTarget,
        'move-source': isMoving,
        'move-target': movingPath && !isMoving,
        highlighted,
        'search-muted': !!searchTerm && !highlighted,
        'menu-open': menuOpen,
        focused
      }"
      :title="path"
      :draggable="!registered && !global.conf?.is_readonly"
      @dragstart="startDrag"
      @dragover="dragOver"
      @dragleave="dropTarget = false"
      @drop.stop="drop"
    >
      <button
        class="graph-open"
        :aria-label="movingPath ? `移动到：${label}` : `在标签页打开：${label}`"
        @click="openOrMove"
      >
        <span class="folder-icon"><FolderIcon :path="path" :root="root" /></span>
        <span class="graph-copy"
          ><strong
            ><template v-if="matchOffset >= 0"
              >{{ label.slice(0, matchOffset)
              }}<mark>{{ label.slice(matchOffset, matchOffset + searchTerm.length) }}</mark
              >{{ label.slice(matchOffset + searchTerm.length) }}</template
            ><template v-else>{{ label }}</template></strong
          ><small>{{
            highlighted && matchOffset < 0 ? '路径匹配' : root ? '已添加' : '子目录'
          }}</small></span
        >
      </button>
      <a-dropdown v-model:open="menuOpen" :trigger="['click']" @overlay-click="menuOpen = false"
        ><button class="graph-more" :aria-label="`目录操作：${label}`" title="目录操作">
          <EllipsisOutlined /></button
        ><template #overlay
          ><a-menu>
            <a-menu-item :disabled="global.conf?.is_readonly" @click="iconPickerOpen = true"
              >修改图标</a-menu-item
            >
            <a-menu-item
              :disabled="global.conf?.is_readonly"
              @click="createSubfolder(path, created)"
              >新建子文件夹</a-menu-item
            >
            <a-menu-item
              v-if="!registered"
              :disabled="global.conf?.is_readonly"
              @click="renameSubfolder(path, () => emit('changed'))"
              >改名</a-menu-item
            >
            <a-menu-item
              v-if="!registered"
              :disabled="global.conf?.is_readonly"
              @click="emit('startMove', path)"
              >移动到其他节点</a-menu-item
            >
            <a-menu-item @click="copy2clipboardI18n(path)">复制路径</a-menu-item>
            <a-menu-item @click="load">刷新下级目录</a-menu-item>
            <template v-if="registered">
              <a-menu-item :disabled="global.conf?.is_readonly" @click="onAliasExtraPathClick(path)"
                >修改显示名称</a-menu-item
              >
              <a-menu-item
                danger
                :disabled="global.conf?.is_readonly"
                @click="
                  onRemoveExtraPathClick(
                    path,
                    registered.types.filter((type) => type !== 'cli_access_only')
                  )
                "
                >从媒体库移除</a-menu-item
              >
            </template>
            <a-menu-item
              v-else
              danger
              :disabled="global.conf?.is_readonly"
              @click="deleteSubfolder(path, () => emit('changed'))"
              >删除空文件夹</a-menu-item
            >
          </a-menu></template
        ></a-dropdown
      >
      <button
        v-if="!loaded || children.length || error"
        class="graph-reveal"
        :class="{ expanded: revealed }"
        :aria-label="`${revealed ? '收起' : '查看'}下级目录：${label}`"
        :aria-expanded="revealed"
        :title="revealed ? '收起下级目录' : '查看下级目录'"
        @click="toggleRevealed"
      >
        <RightOutlined />
      </button>
    </article>
    <div
      v-if="revealed && (loading || error || children.length)"
      class="graph-children"
      role="group"
      :aria-label="`${label} 的下级目录`"
    >
      <span v-if="loading" class="graph-status">读取中…</span>
      <button v-else-if="error" class="graph-status retry" @click="load">{{ error }} · 重试</button>
      <template v-else>
        <FolderTreeNode
          v-for="child in children.filter((item) => ![path, ...ancestors].includes(item.fullpath))"
          :key="child.fullpath"
          :path="child.fullpath"
          :name="child.name"
          :depth="depth + 1"
          :ancestors="[path, ...ancestors]"
          :moving-path="movingPath"
          :query="query"
          :focus-path="focusPath"
          @changed="onChildChanged"
          @start-move="emit('startMove', $event)"
          @cancel-move="emit('cancelMove')"
          @move="(source, destination) => emit('move', source, destination)"
          @opened="emit('opened', $event)"
        />
      </template>
    </div>
    <FolderIconPicker
      v-if="iconPickerOpen"
      :open="iconPickerOpen"
      :path="path"
      :name="label"
      :root="root"
      @close="iconPickerOpen = false"
    />
  </div>
</template>

<style scoped>
.graph-branch {
  display: flex;
  align-items: flex-start;
  flex: none;
  min-width: 96px;
  position: relative;
}
.graph-card {
  position: relative;
  width: 96px;
  height: 96px;
  flex: none;
  border: 1px solid var(--zp-border);
  border-radius: var(--ui-radius);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-card);
  transition:
    border-color var(--ui-motion-fast) var(--ui-ease),
    box-shadow var(--ui-motion-fast) var(--ui-ease);
}
.graph-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--ui-shadow);
}
.graph-card.focused,
.graph-card.move-source {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px var(--primary-color-1);
}
.graph-card.highlighted {
  border-color: var(--primary-color);
  background: var(--ui-accent-soft);
  box-shadow:
    0 0 0 4px var(--primary-color-2),
    var(--ui-shadow-card);
}
.graph-card.search-muted:not(.focused):not(.move-source) {
  opacity: 0.62;
}
.graph-card.move-target:hover,
.graph-card.drop-active {
  outline: 2px dashed var(--primary-color);
  outline-offset: 3px;
}
.graph-open {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  min-width: 0;
  border: 0;
  border-radius: inherit;
  background: none;
  color: var(--zp-primary);
  text-align: center;
  cursor: pointer;
  padding: 12px 6px 8px;
}
.graph-open:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
}
.folder-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: var(--ui-radius);
  background: var(--primary-color-1);
  color: var(--primary-color);
  font-size: 22px;
}
.graph-copy {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
  gap: 2px;
}
.graph-copy strong {
  font-size: 12px;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph-copy small {
  font-size: 10px;
  color: var(--zp-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.graph-copy mark {
  padding: 1px 2px;
  border-radius: 3px;
  background: var(--primary-color);
  color: #fff;
}
.graph-more {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  color: var(--zp-secondary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--ui-motion-fast) var(--ui-ease);
}
.graph-card:hover .graph-more,
.graph-card:focus-within .graph-more,
.graph-card.menu-open .graph-more {
  opacity: 1;
}
@media (hover: none) {
  .graph-more {
    opacity: 1;
  }
}
.graph-more:hover,
.graph-more:focus-visible {
  background: var(--primary-color-1);
  color: var(--primary-color);
}
.graph-children {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  position: relative;
  padding-left: 32px;
}
/* All connectors meet the card centre, not the expanding subtree centre. */
.graph-children::before,
.graph-children > .graph-branch::before {
  content: '';
  position: absolute;
  top: 48px;
  width: 16px;
  border-top: 1px solid var(--primary-color);
}
.graph-children::before {
  left: 0;
}
.graph-children > .graph-branch::before {
  left: -16px;
}
.graph-children > .graph-branch:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 48px;
  left: -16px;
  height: calc(100% + 10px);
  border-left: 1px solid var(--primary-color);
}
.graph-status {
  margin-top: 34px;
  padding: 8px;
  font-size: 11px;
  color: var(--zp-secondary);
  background: none;
  border: 0;
  white-space: nowrap;
}
.graph-reveal {
  position: absolute;
  top: 36px;
  right: -12px;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--ui-border);
  border-radius: 50%;
  background: var(--ui-surface);
  color: var(--zp-secondary);
  font-size: 10px;
  cursor: pointer;
}
.graph-reveal.expanded > .anticon {
  transform: rotate(180deg);
}
.graph-reveal:hover,
.retry:hover {
  color: var(--primary-color);
}
.graph-reveal:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .graph-card,
  .graph-more {
    transition: none;
  }
}
</style>
