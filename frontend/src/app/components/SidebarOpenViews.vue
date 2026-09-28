<script setup lang="ts">
import { CloseOutlined, HistoryOutlined } from '@ant-design/icons-vue'
import type { TabPane } from '@/features/application/public'
import FolderIcon from '@/features/media-library/components/FolderIcon.vue'

defineProps<{
  entries: { pane: TabPane; tabIdx: number; label: string; root: boolean }[]
  activeKey?: string
  dropTarget: string
  tabDrop?: { key: string; side: 'before' | 'after' }
}>()
const emit = defineEmits<{
  select: [key: string]
  close: [tabIdx: number, key: string]
  startDrag: [event: DragEvent, key: string]
  overTab: [event: DragEvent, key: string]
  dropTab: [event: DragEvent, key: string]
  endDrag: []
  leaveTab: [event: DragEvent, key: string]
  folderDragOver: [event: DragEvent, path: string]
  folderLeave: []
  folderDrop: [event: DragEvent, path: string, key: string]
}>()
</script>

<template>
  <div class="open-view-list" role="group" aria-label="已打开标签页">
    <div
      v-for="entry in entries"
      :key="entry.pane.key"
      class="open-view"
      :class="{
        'tab-drop-before': tabDrop?.key === entry.pane.key && tabDrop.side === 'before',
        'tab-drop-after': tabDrop?.key === entry.pane.key && tabDrop.side === 'after'
      }"
      draggable="true"
      :title="`拖动调整标签页位置：${entry.label}`"
      @dragstart="emit('startDrag', $event, entry.pane.key)"
      @dragover="emit('overTab', $event, entry.pane.key)"
      @drop="emit('dropTab', $event, entry.pane.key)"
      @dragend="emit('endDrag')"
      @dragleave="emit('leaveTab', $event, entry.pane.key)"
    >
      <button
        class="view-button"
        type="button"
        :class="{ selected: activeKey === entry.pane.key }"
        :aria-current="activeKey === entry.pane.key ? 'page' : undefined"
        :data-drop-active="entry.pane.type === 'local' && dropTarget === entry.pane.path"
        :title="
          entry.pane.type === 'local'
            ? `${entry.label}\n${entry.pane.path}\n拖动文件到此目录`
            : entry.label
        "
        :aria-label="entry.root ? `根目录：${entry.label}` : entry.label"
        @dragover="
          entry.pane.type === 'local' &&
          entry.pane.path &&
          emit('folderDragOver', $event, entry.pane.path)
        "
        @dragleave="emit('folderLeave')"
        @drop="
          entry.pane.type === 'local' &&
          entry.pane.path &&
          emit('folderDrop', $event, entry.pane.path, entry.pane.key)
        "
        @click="emit('select', entry.pane.key)"
      >
        <FolderIcon
          v-if="entry.pane.type === 'local' && entry.pane.path"
          :path="entry.pane.path"
          :root="entry.root"
        />
        <HistoryOutlined v-else />
        <span class="tab-label">{{ entry.label }}</span>
      </button>
      <button
        class="close-view"
        type="button"
        :aria-label="`关闭标签页：${entry.label}`"
        :title="`关闭标签页：${entry.label}`"
        @dragstart.stop.prevent
        @click="emit('close', entry.tabIdx, entry.pane.key)"
      >
        <CloseOutlined />
      </button>
    </div>
  </div>
</template>

<style scoped>
.open-view-list {
  display: grid;
  gap: 2px;
}
.open-view {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 2px;
  cursor: grab;
}
.open-view:active {
  cursor: grabbing;
}
.view-button {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  min-height: 32px;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--zp-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.view-button :deep(.anticon) {
  flex: none;
  font-size: 15px;
}
.tab-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.view-button:hover,
.close-view:hover {
  background: var(--primary-color-1);
  color: var(--primary-color);
}
.view-button.selected {
  background: var(--primary-color-2);
  color: var(--primary-color);
  font-weight: 600;
}
.view-button.selected::before {
  content: '';
  position: absolute;
  left: 0;
  width: 3px;
  height: 16px;
  border-radius: 3px;
  background: var(--primary-color);
}
.close-view {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--zp-secondary);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.view-button:focus-visible,
.close-view:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.open-view.tab-drop-before::before,
.open-view.tab-drop-after::after {
  content: '';
  position: absolute;
  left: 6px;
  right: 6px;
  height: 2px;
  border-radius: 2px;
  background: var(--primary-color);
  z-index: 2;
  pointer-events: none;
}
.open-view.tab-drop-before::before {
  top: 0;
}
.open-view.tab-drop-after::after {
  bottom: 0;
}
</style>
