<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import {
  PictureOutlined,
  VideoCameraOutlined,
  CustomerServiceOutlined,
  RobotOutlined,
  ArrowRightOutlined,
  EditOutlined,
  DeleteOutlined,
  SaveOutlined,
  LoadingOutlined,
  AppstoreOutlined
} from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import {
  studioLayerVisible,
  readStudioDocument,
  type StudioDocumentIndex
} from '@/features/image-editor/public'
import type { WorkspaceArtifact } from '../api/workspaceArtifacts'
import { createWorkspaceDraftRepository } from '../model/workspaceDraftRepository'
import { workspaceStorage, workspaceStorageRevision } from '../services/workspaceStorage'
import { renderStudioDocument } from '@/features/image-editor/public'
import { draftKindLabel, type ProductionKind } from '../model/workspaceWorks'
import ProductionArtifactsDialog from './ProductionArtifactsDialog.vue'

const props = defineProps<{
  workspaceId: string
  workId?: string
  kind?: ProductionKind
  selected?: boolean
  item: StudioDocumentIndex['docs'][number]
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  busy?: boolean
  artifacts: WorkspaceArtifact[]
}>()
defineEmits<{ open: []; rename: []; delete: []; save: []; artifactsChanged: [] }>()
const artifactsOpen = ref(false)
const kind = computed(() => props.kind ?? 'image')
const icons = {
  image: PictureOutlined,
  video: VideoCameraOutlined,
  audio: CustomerServiceOutlined,
  ai: RobotOutlined
}
const emptySummary = computed(() =>
  kind.value === 'ai' ? '尚未设置主图' : `${draftKindLabel(kind.value)}制作文件`
)
const productionArtifacts = computed(() =>
  props.artifacts
    .filter((item) => item.workspace_id === props.workspaceId && item.document_id === props.item.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
)
const root = ref<HTMLElement>(),
  preview = ref<HTMLCanvasElement>()
const visible = ref(false),
  ready = ref(false),
  failed = ref(false),
  summary = ref('')
const updatedAt = ref('')
let revision = 0
const { stop } = useIntersectionObserver(
  root,
  ([entry]) => {
    if (entry.isIntersecting) {
      visible.value = true
      stop()
    }
  },
  { rootMargin: '120px' }
)
watch(
  [
    visible,
    () => props.item.updatedAt,
    () => props.assetInfo,
    workspaceStorageRevision,
    () => props.workspaceId,
    () => props.workId,
    () => props.item.id,
    kind
  ],
  async () => {
    if (!visible.value || !preview.value) return
    const token = ++revision
    try {
      const storage = workspaceStorage(props.workspaceId)
      let doc,
        referenceCount = 0
      if (kind.value === 'image')
        doc = createWorkspaceDraftRepository(props.workspaceId, storage).loadDocument(props.item.id)
      else if (kind.value === 'ai' && props.workId) {
        const scope = `${props.workspaceId}:${props.workId}:${props.item.id}`
        const path = storage.getItem(`omnigallery:ai-image-edit-asset-v1:${scope}`)
        if (path) {
          doc = readStudioDocument(
            JSON.parse(
              storage.getItem(
                `omnigallery:ai-image-edit-v1:${scope}:${encodeURIComponent(path)}`
              ) ?? 'null'
            )
          )
          try {
            const refs: unknown = JSON.parse(
              storage.getItem(
                `omnigallery:ai-image-refs-v1:${scope}:${encodeURIComponent(path)}`
              ) ?? '[]'
            )
            if (Array.isArray(refs))
              referenceCount = new Set(refs.filter((value) => typeof value === 'string' && value))
                .size
          } catch {
            /* A damaged reference list does not hide the saved main image. */
          }
        }
      }
      if (!doc) {
        ready.value = false
        failed.value = kind.value === 'image'
        summary.value = ''
        updatedAt.value = ''
        return
      }
      summary.value = `${doc.width} × ${doc.height} · ${kind.value === 'ai' ? `${referenceCount} 张参考图` : `${doc.layers.length} 个图层`}`
      updatedAt.value = doc.updatedAt > props.item.updatedAt ? doc.updatedAt : props.item.updatedAt
      const target = document.createElement('canvas')
      const errors = await renderStudioDocument(
        target,
        doc,
        props.assetInfo,
        true,
        { kind: 'all' },
        400
      )
      if (token !== revision || !preview.value) return
      preview.value.width = target.width
      preview.value.height = target.height
      preview.value.getContext('2d')?.drawImage(target, 0, 0)
      const emptySlots = doc.layers.filter(
        (layer) => layer.kind === 'image' && !layer.path && studioLayerVisible(doc, layer)
      ).length
      ready.value = true
      failed.value = errors.length > emptySlots
    } catch {
      if (token === revision) {
        ready.value = false
        failed.value = true
        summary.value = ''
      }
    }
  },
  { flush: 'post' }
)
onBeforeUnmount(() => {
  revision++
  stop()
})
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
  <article ref="root" class="studio-draft-card" :class="{ selected }">
    <button
      type="button"
      class="draft-cover"
      :aria-label="`继续编辑：${item.name}`"
      :disabled="busy"
      @click="$emit('open')"
    >
      <canvas ref="preview" v-show="ready" :aria-label="item.name + '制作预览'" /><component
        v-if="!ready"
        :is="icons[kind]"
      /><span class="draft-open">继续编辑 ↗</span>
      <span class="draft-kind"><component :is="icons[kind]" />{{ draftKindLabel(kind) }}</span>
    </button>
    <div class="draft-card-copy">
      <div class="draft-title-row">
        <button type="button" class="draft-title" :title="item.name" @click="$emit('open')">
          <strong>{{ item.name }}</strong>
        </button>
        <button
          type="button"
          class="draft-action"
          title="修改制作信息"
          :aria-label="`修改制作信息：${item.name}`"
          :disabled="readonly"
          @click="$emit('rename')"
        >
          <EditOutlined />
        </button>
        <button
          type="button"
          class="draft-action draft-delete"
          title="删除制作文件"
          :aria-label="`删除制作文件：${item.name}`"
          :disabled="readonly"
          @click="$emit('delete')"
        >
          <DeleteOutlined />
        </button>
      </div>
      <span>{{ summary || emptySummary }}</span>
      <div class="draft-meta-row">
        <small
          >{{ failed ? '预览不可用 · ' : ''
          }}{{ dateLabel(updatedAt || item.updatedAt) }} 更新</small
        >
        <button
          type="button"
          class="draft-artifacts"
          :aria-label="`查看制作产物：${item.name}`"
          title="查看这份制作文件的历次产物"
          @click="artifactsOpen = true"
        >
          <AppstoreOutlined />产物 {{ productionArtifacts.length }}
        </button>
      </div>
      <div v-if="kind === 'image'" class="draft-publish-actions">
        <button
          type="button"
          :disabled="readonly || busy"
          title="导出为产物（PNG · 内容区），相同版本会复用已有产物"
          @click="$emit('save')"
        >
          <LoadingOutlined v-if="busy" /><SaveOutlined v-else />导出为产物
        </button>
      </div>
      <div v-else class="draft-publish-actions">
        <button type="button" :disabled="busy" @click="$emit('open')">
          继续编辑<ArrowRightOutlined />
        </button>
      </div>
    </div>
  </article>
  <ProductionArtifactsDialog
    v-if="artifactsOpen"
    :name="item.name"
    :artifacts="productionArtifacts"
    :asset-info="assetInfo"
    :readonly="readonly"
    @close="artifactsOpen = false"
    @changed="$emit('artifactsChanged')"
  />
</template>

<style scoped>
.studio-draft-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 18px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  transition:
    border-color 0.16s,
    box-shadow 0.16s;
}
.studio-draft-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--ui-shadow-card);
}
.studio-draft-card.selected {
  border-color: color-mix(in srgb, var(--primary-color) 50%, var(--ui-border));
}
.draft-kind {
  position: absolute;
  right: 10px;
  top: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ui-surface) 92%, transparent);
  color: var(--ui-muted);
  font-size: 11px;
}
.draft-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 22px;
}
.studio-draft-card .draft-artifacts {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 3px 5px;
  border-radius: 6px;
  font-size: 11px;
  background: transparent;
  color: var(--primary-color);
}
.studio-draft-card .draft-artifacts:hover {
  background: var(--ui-surface-soft);
}
.draft-publish-actions {
  display: flex;
  gap: 6px;
  padding-top: 10px;
  margin-top: 3px;
  border-top: 1px solid var(--ui-border);
}
.studio-draft-card .draft-publish-actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1;
  padding: 7px 3px;
  min-height: 32px;
  border-radius: 6px;
  background: var(--ui-surface-soft);
  color: var(--primary-color);
  font-size: 11px;
}
.studio-draft-card button:disabled {
  opacity: 0.45;
  cursor: default;
}
.studio-draft-card button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.studio-draft-card button {
  border: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
.draft-title-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.draft-title {
  flex: 1;
  min-width: 0;
  padding: 0;
  text-align: left;
  background: transparent;
}
.draft-title strong {
  display: block;
}
.draft-action {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border-radius: 6px;
  background: transparent;
}
.draft-action:hover:enabled {
  background: var(--ui-surface-soft);
  color: var(--primary-color);
}
.draft-delete:hover:enabled {
  color: var(--ant-color-error, #d9363e);
}
.draft-action:disabled {
  opacity: 0.4;
  cursor: default;
}
.draft-cover {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 190px;
  padding: 18px;
  box-sizing: border-box;
  background: var(--ui-surface-soft);
  overflow: hidden;
}
.draft-cover canvas {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 3px 12px #0002;
}
.draft-cover > .anticon {
  font-size: 32px;
  color: var(--ui-muted);
  opacity: 0.4;
}
.draft-open {
  position: absolute;
  bottom: 12px;
  right: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  background: #182330dd;
  color: #fff;
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.16s;
}
.studio-draft-card:is(:hover, :focus-within) .draft-open {
  opacity: 1;
}
.draft-card-copy {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 16px;
}
.draft-card-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
}
.draft-card-copy > span {
  color: var(--ui-muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.draft-card-copy small {
  color: var(--ui-muted);
  font-size: 11px;
  opacity: 0.8;
}
@media (prefers-reduced-motion: reduce) {
  .studio-draft-card,
  .draft-open {
    transition: none;
  }
}
</style>
