<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { FolderOpenOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { WorkspaceAsset } from '../model/workspaceModel'
import { fileDisplayName } from '@/shared/lib/fileDisplayName'
import WorkspaceMaterialThumbnail from './WorkspaceMaterialThumbnail.vue'
import WorkspaceAssetPreview from './WorkspaceAssetPreview.vue'

const props = defineProps<{
  name: string
  assets: WorkspaceAsset[]
  assetInfo: Record<string, FileNodeInfo>
}>()
const open = ref(false)
const preview = ref<FileNodeInfo>()
const trigger = ref<HTMLButtonElement>()
function showPreview(asset: WorkspaceAsset) {
  const file = props.assetInfo[asset.path]
  if (!file) return
  open.value = false
  preview.value = file
}
function closePreview() {
  preview.value = undefined
  void nextTick(() => trigger.value?.focus({ preventScroll: true }))
}
</script>

<template>
  <a-popover :open="open" trigger="click" placement="topLeft" @open-change="open = $event">
    <template #title
      ><span class="materials-title" :class="{ single: assets.length <= 1 }"
        >{{ name }} · 使用素材</span
      ></template
    >
    <template #content>
      <div class="materials-content" :class="{ single: assets.length <= 1 }">
        <div v-if="assets.length" class="materials-grid" :class="{ single: assets.length === 1 }">
          <button
            v-for="asset in assets"
            :key="asset.path"
            type="button"
            class="material-entry"
            :aria-label="`预览使用素材：${asset.name}`"
            :title="asset.name"
            :disabled="!assetInfo[asset.path]"
            @click="showPreview(asset)"
          >
            <span class="material-cover"
              ><WorkspaceMaterialThumbnail :asset="asset" :file="assetInfo[asset.path]"
            /></span>
            <span class="material-name">{{ fileDisplayName(asset.name) }}</span>
            <small v-if="!assetInfo[asset.path]">文件不可用</small>
          </button>
        </div>
        <p v-else class="materials-empty">尚未使用素材</p>
      </div>
    </template>
    <button
      ref="trigger"
      type="button"
      class="materials-trigger"
      :aria-label="`查看使用素材：${name}`"
      :aria-expanded="open"
    >
      <FolderOpenOutlined />使用素材 {{ assets.length }}
    </button>
  </a-popover>
  <WorkspaceAssetPreview v-if="preview" :file="preview" @close="closePreview" />
</template>

<style scoped>
.materials-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  border: 0;
  padding: 3px 5px;
  border-radius: 6px;
  background: transparent;
  color: var(--primary-color);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.materials-trigger:hover {
  background: var(--ui-surface-soft);
}
.materials-trigger:focus-visible,
.material-entry:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.materials-title,
.materials-content {
  display: block;
  width: min(340px, calc(100vw - 64px));
}
.materials-title {
  overflow-wrap: anywhere;
}
.materials-title.single,
.materials-content.single {
  width: min(200px, calc(100vw - 64px));
}
.materials-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  max-height: min(400px, 55vh);
  overflow-y: auto;
  padding: 2px;
}
.materials-grid.single {
  grid-template-columns: minmax(0, 1fr);
}
.material-entry {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 5px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  cursor: pointer;
}
.material-entry:hover:enabled {
  border-color: var(--primary-color);
}
.material-entry:disabled {
  cursor: default;
}
.material-cover {
  display: block;
  width: 100%;
  height: 112px;
  overflow: hidden;
  border-radius: 5px;
}
.material-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 18px;
}
.materials-empty,
.material-entry small {
  margin: 0;
  color: var(--ui-muted);
  font-size: 12px;
}
.materials-empty {
  padding: 16px 0;
  text-align: center;
}
</style>
