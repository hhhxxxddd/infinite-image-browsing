<script setup lang="ts">
import { computed, inject, nextTick, ref, watch } from 'vue'
import {
  CheckCircleFilled,
  PictureOutlined,
  VideoCameraOutlined,
  CustomerServiceOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined
} from '@ant-design/icons-vue'
import {
  toImageThumbnailUrl,
  toVideoCoverUrl,
  type FileNodeInfo
} from '@/features/media-library/public'
import type { WorkspaceArtifact } from '../api/workspaceArtifacts'
import { workspaceArtifactActionsKey } from '../model/workspaceArtifactActions'
import WorkspaceAssetPreview from './WorkspaceAssetPreview.vue'
import type { ProductionDraft } from '../model/workspaceWorks'

const props = defineProps<{
  name: string
  artifacts: WorkspaceArtifact[]
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  productionId?: string
  drafts?: ProductionDraft[]
}>()
defineEmits<{ close: []; changed: [] }>()
const preview = ref<FileNodeInfo>()
const menuId = ref('')
const artifactActions = inject(workspaceArtifactActionsKey, undefined)
const busy = computed(() => artifactActions?.busy.value ?? false)
const manageDisabled = computed(
  () => !!props.readonly || !artifactActions || artifactActions.disabled.value
)
watch(
  () => artifactActions?.lastRemovedId.value,
  (id) => {
    if (id && id === preview.value?.workspace_artifact_id) closePreview()
  }
)
const broken = ref(new Set<string>())
const owner = ref('all')
const owners = computed(() => [
  ...new Set(props.artifacts.map((item) => item.document_id).filter((id): id is string => !!id))
])
function ownerName(id: string) {
  return id === props.productionId
    ? '本制作文件'
    : (props.drafts?.find((draft) => draft.id === id)?.name ?? 'AI 分支（制作文件已删除）')
}
let previewTrigger: HTMLElement | null = null
const files = computed(() =>
  props.artifacts
    .filter((artifact) => owner.value === 'all' || artifact.document_id === owner.value)
    .map((artifact) => {
      const path = `workspace-artifact:${artifact.id}`
      const file: FileNodeInfo = props.assetInfo[path] ?? {
        fullpath: path,
        name: artifact.name,
        type: 'file',
        workspace_artifact_id: artifact.id,
        workspace_artifact_source: artifact.source,
        width: artifact.width,
        height: artifact.height,
        bytes: artifact.bytes,
        size: `${Math.round(artifact.bytes / 1024)} KB`,
        date: artifact.created_at,
        created_time: artifact.created_at,
        is_under_scanned_path: false
      }
      return {
        artifact,
        file,
        thumbnail: broken.value.has(artifact.id)
          ? ''
          : artifact.kind === 'image'
            ? toImageThumbnailUrl(file, '500x300')
            : artifact.kind === 'video'
              ? toVideoCoverUrl(file)
              : ''
      }
    })
)
function openPreview(file: FileNodeInfo) {
  menuId.value = ''
  previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  preview.value = file
}
function closePreview() {
  preview.value = undefined
  void nextTick(() => previewTrigger?.isConnected && previewTrigger.focus({ preventScroll: true }))
}
function renameArtifact(file: FileNodeInfo) {
  if (manageDisabled.value) return
  menuId.value = ''
  artifactActions?.rename(file)
}
function deleteArtifact(file: FileNodeInfo) {
  if (manageDisabled.value) return
  menuId.value = ''
  artifactActions?.remove(file)
}
function dateLabel(value: string) {
  return new Date(value).toLocaleString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <a-modal
    open
    :title="`${name} · 产物`"
    :width="820"
    :footer="null"
    :closable="!busy"
    :mask-closable="!busy"
    :keyboard="!busy"
    @cancel="!busy && $emit('close')"
  >
    <p class="artifacts-description">这份制作文件历次导出及 AI 加工的结果，最新的排在前面。</p>
    <label v-if="owners.length > 1" class="artifact-filter"
      >产物来源
      <a-select
        v-model:value="owner"
        :options="[
          { value: 'all', label: '全部产物' },
          ...owners.map((id) => ({ value: id, label: ownerName(id) }))
        ]"
    /></label>
    <div v-if="files.length" class="production-artifacts">
      <article
        v-for="{ artifact, file, thumbnail } in files"
        :key="artifact.id"
        class="artifact-entry"
        @contextmenu.prevent="menuId = busy ? '' : artifact.id"
      >
        <button
          type="button"
          class="artifact-preview"
          :aria-label="`查看产物：${artifact.name}`"
          @click="openPreview(file)"
        >
          <span class="artifact-cover">
            <img
              v-if="thumbnail"
              :src="thumbnail"
              alt=""
              loading="lazy"
              @error="broken = new Set([...broken, artifact.id])"
            />
            <component
              v-else
              :is="
                artifact.kind === 'video'
                  ? VideoCameraOutlined
                  : artifact.kind === 'audio'
                    ? CustomerServiceOutlined
                    : PictureOutlined
              "
            />
            <span v-if="artifact.collected" class="artifact-collected" title="已同步到媒体库"
              ><CheckCircleFilled />已同步</span
            >
          </span>
          <span class="artifact-copy">
            <strong :title="artifact.name">{{ artifact.name }}</strong>
            <span>{{ artifact.width }} × {{ artifact.height }} · {{ file.size }}</span>
            <small>{{ dateLabel(artifact.created_at) }} 导出</small>
            <small v-if="owners.length > 1">{{ ownerName(artifact.document_id ?? '') }}</small>
          </span>
        </button>
        <a-dropdown
          :trigger="['click']"
          placement="bottomRight"
          :open="menuId === artifact.id"
          @open-change="menuId = $event && !busy ? artifact.id : ''"
        >
          <button
            type="button"
            class="artifact-more"
            :aria-label="`产物操作：${artifact.name}`"
            :disabled="busy"
            @keydown.esc.prevent.stop="menuId = ''"
          >
            <MoreOutlined />
          </button>
          <template #overlay
            ><a-menu>
              <a-menu-item @click="openPreview(file)"><EyeOutlined />预览</a-menu-item>
              <a-menu-item :disabled="manageDisabled" @click="renameArtifact(file)"
                ><EditOutlined />重命名</a-menu-item
              >
              <a-menu-divider />
              <a-menu-item danger :disabled="manageDisabled" @click="deleteArtifact(file)"
                ><DeleteOutlined />删除产物</a-menu-item
              >
            </a-menu></template
          >
        </a-dropdown>
      </article>
    </div>
    <div v-else class="artifacts-empty">
      <PictureOutlined /><strong>还没有产物</strong
      ><span>导出为产物或完成 AI 加工后，结果会展示在这里。</span>
    </div>
  </a-modal>
  <WorkspaceAssetPreview v-if="preview" :file="preview" @close="closePreview" />
</template>

<style scoped>
.artifact-filter {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.artifact-filter :deep(.ant-select) {
  min-width: 0;
  width: min(400px, 75%);
}
.artifacts-description {
  margin: 0 0 16px;
  color: var(--ui-muted);
  font-size: 12px;
}
.production-artifacts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 12px;
  max-height: min(60vh, 560px);
  overflow-y: auto;
  padding: 2px;
}
.artifact-entry {
  position: relative;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface);
  color: var(--ui-text);
  text-align: left;
  cursor: pointer;
  font: inherit;
}
.artifact-preview {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.artifact-preview:focus-visible,
.artifact-more:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.artifact-more {
  position: absolute;
  right: 8px;
  bottom: 63px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
}
.artifact-more:hover {
  color: var(--primary-color);
  background: var(--ui-surface-soft);
}
.artifact-more:disabled {
  opacity: 0.5;
  cursor: default;
}
.artifact-entry:hover {
  border-color: var(--primary-color);
}
.artifact-entry:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.artifact-cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 140px;
  padding: 12px;
  background: var(--ui-surface-soft);
}
.artifact-cover img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.artifact-cover > .anticon {
  font-size: 30px;
  color: var(--ui-muted);
}
.artifact-collected {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--primary-color);
  font-size: 11px;
}
.artifact-copy {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 12px;
}
.artifact-copy strong {
  padding-right: 24px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.artifact-copy > span,
.artifact-copy small {
  color: var(--ui-muted);
  font-size: 11px;
}
.artifacts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 200px;
  color: var(--ui-muted);
  font-size: 12px;
  text-align: center;
}
.artifacts-empty > .anticon {
  font-size: 32px;
  opacity: 0.6;
}
</style>
