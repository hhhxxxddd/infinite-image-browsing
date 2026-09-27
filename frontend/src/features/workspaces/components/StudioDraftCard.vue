<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useIntersectionObserver } from '@vueuse/core'
import { PictureOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import { studioLayerVisible, type StudioDocumentIndex } from '@/features/image-editor/public'
import { createWorkspaceDraftRepository } from '../model/workspaceDraftRepository'
import { renderStudioDocument } from '@/features/image-editor/public'

const props = defineProps<{
  workspaceId: string
  item: StudioDocumentIndex['docs'][number]
  assetInfo: Record<string, FileNodeInfo>
}>()
defineEmits<{ open: [] }>()
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
  <button
    ref="root"
    type="button"
    class="studio-draft-card"
    :aria-label="`继续编辑：${item.name}`"
    @click="$emit('open')"
  >
    <div class="draft-cover">
      <canvas ref="preview" v-show="ready" :aria-label="item.name + '作品预览'" /><PictureOutlined
        v-if="!ready"
      /><span class="draft-open">继续编辑 ↗</span>
    </div>
    <div class="draft-card-copy">
      <strong>{{ item.name }}</strong
      ><span>{{ summary }}</span
      ><small>{{ failed ? '部分预览不可用 · ' : '' }}{{ dateLabel(item.updatedAt) }} 保存</small>
    </div>
  </button>
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
  cursor: pointer;
  transition:
    border-color 0.16s,
    box-shadow 0.16s;
}
.studio-draft-card:hover {
  border-color: var(--primary-color);
  box-shadow: var(--ui-shadow-card);
}
.studio-draft-card:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
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
.studio-draft-card:is(:hover, :focus-visible) .draft-open {
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
.draft-card-copy span {
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
