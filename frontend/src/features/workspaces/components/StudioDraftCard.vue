<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import {
  PictureOutlined,
  EditOutlined,
  DeleteOutlined,
  SaveOutlined,
  ExportOutlined,
  LoadingOutlined,
  CheckCircleFilled
} from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import {
  studioLayerVisible,
  studioDocumentRevision,
  type StudioDocumentIndex
} from '@/features/image-editor/public'
import type { WorkspaceArtifact } from '../api/workspaceArtifacts'
import { createWorkspaceDraftRepository } from '../model/workspaceDraftRepository'
import { renderStudioDocument } from '@/features/image-editor/public'

const props = defineProps<{
  workspaceId: string
  item: StudioDocumentIndex['docs'][number]
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  busy?: boolean
  artifacts: WorkspaceArtifact[]
}>()
defineEmits<{ open: []; rename: []; delete: []; save: []; sync: [] }>()
const documentRevision = ref('')
const savedArtifacts = computed(() =>
  props.artifacts.filter(
    (item) =>
      item.document_id === props.item.id && item.document_revision === documentRevision.value
  )
)
const collected = computed(() => savedArtifacts.value.some((item) => item.collected))
const root = ref<HTMLElement>(),
  preview = ref<HTMLCanvasElement>()
const visible = ref(false),
  ready = ref(false),
  failed = ref(false),
  summary = ref('图层草稿')
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
  [visible, () => props.item.updatedAt, () => props.assetInfo],
  async () => {
    if (!visible.value || !preview.value) return
    const token = ++revision
    try {
      const doc = createWorkspaceDraftRepository(props.workspaceId, localStorage).loadDocument(
        props.item.id
      )
      if (!doc) throw new Error('missing')
      documentRevision.value = studioDocumentRevision(doc)
      summary.value = `${doc.width} × ${doc.height} · ${doc.layers.length} 个图层`
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
      if (token === revision) failed.value = true
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
  <article ref="root" class="studio-draft-card">
    <button
      type="button"
      class="draft-cover"
      :aria-label="`继续编辑：${item.name}`"
      :disabled="busy"
      @click="$emit('open')"
    >
      <canvas ref="preview" v-show="ready" :aria-label="item.name + '草稿预览'" /><PictureOutlined
        v-if="!ready"
      /><span class="draft-open">继续编辑 ↗</span>
      <span
        v-if="savedArtifacts.length"
        class="draft-status"
        :title="
          collected
            ? '已收录：当前版本已保存为素材，并收录到媒体库'
            : '已保存：当前版本已保存为工作区素材'
        "
      >
        <CheckCircleFilled />{{ collected ? '已收录' : '已保存' }}
      </span>
    </button>
    <div class="draft-card-copy">
      <div class="draft-title-row">
        <button type="button" class="draft-title" :title="item.name" @click="$emit('open')">
          <strong>{{ item.name }}</strong>
        </button>
        <button
          type="button"
          class="draft-action"
          title="重命名草稿"
          :aria-label="`重命名草稿：${item.name}`"
          :disabled="readonly"
          @click="$emit('rename')"
        >
          <EditOutlined />
        </button>
        <button
          type="button"
          class="draft-action draft-delete"
          title="删除草稿"
          :aria-label="`删除草稿：${item.name}`"
          :disabled="readonly"
          @click="$emit('delete')"
        >
          <DeleteOutlined />
        </button>
      </div>
      <span>{{ summary }}</span
      ><small>{{ failed ? '部分预览不可用 · ' : '' }}{{ dateLabel(item.updatedAt) }} 保存</small>
      <div class="draft-publish-actions">
        <button
          type="button"
          :disabled="readonly || busy"
          :title="
            savedArtifacts.length
              ? '已保存：当前版本已有素材，再次点击会复用'
              : '保存为素材（PNG · 内容区）'
          "
          @click="$emit('save')"
        >
          <LoadingOutlined v-if="busy" /><SaveOutlined v-else />保存为素材
        </button>
        <button
          type="button"
          :disabled="readonly || busy"
          :title="collected ? '已收录：可同步到其他媒体库目录' : '保存当前版本并同步到媒体库'"
          @click="$emit('sync')"
        >
          <ExportOutlined />同步到媒体库
        </button>
      </div>
    </div>
  </article>
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
.draft-status {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 7px;
  border-radius: 6px;
  font-size: 11px;
  background: var(--ui-surface);
  color: var(--primary-color);
  box-shadow: 0 2px 6px #0001;
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
