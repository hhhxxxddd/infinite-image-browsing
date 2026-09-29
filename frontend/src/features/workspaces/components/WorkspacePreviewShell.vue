<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FileNodeInfo } from '@/features/media-library/api/files'
import {
  isAudioFile,
  isVideoFile,
  toImageUrl,
  toStreamAudioUrl,
  toStreamVideoUrl
} from '@/features/media-library/model/mediaFiles'
import { fileDisplayName } from '@/shared/lib/fileDisplayName'
import MediaQuickLook from '@/features/media-preview/components/MediaQuickLook.vue'

const props = defineProps<{ file: FileNodeInfo; workspaceName?: string }>()
defineEmits<{ close: [] }>()
const mediaInfo = ref<{ width?: number; height?: number; duration?: number }>({})
const width = computed(() => props.file.width || mediaInfo.value.width)
const height = computed(() => props.file.height || mediaInfo.value.height)
const duration = computed(() => {
  const seconds = mediaInfo.value.duration
  if (seconds === undefined) return ''
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
})
const kind = computed(() =>
  isAudioFile(props.file.name) ? 'audio' : isVideoFile(props.file.name) ? 'video' : 'image'
)
const src = computed(() =>
  kind.value === 'audio'
    ? toStreamAudioUrl(props.file)
    : kind.value === 'video'
      ? toStreamVideoUrl(props.file)
      : toImageUrl(props.file)
)
const source = computed(() =>
  props.file.workspace_artifact_source === 'ai_image_generation'
    ? 'AI 图片生成'
    : props.file.workspace_artifact_source === 'ai_image_edit'
      ? 'AI 加工'
      : props.file.workspace_artifact_source === 'image_studio'
        ? '图片制作'
        : '媒体库引用'
)
</script>

<template>
  <MediaQuickLook
    :src="src"
    :name="fileDisplayName(file.name)"
    :title="fileDisplayName(file.name)"
    :kind="kind"
    wide
    canvas
    @close="$emit('close')"
    @loaded="mediaInfo = $event"
  >
    <template #toolbar>
      <div class="workspace-preview-context">
        <span class="source-badge">{{ source }}</span>
        <span v-if="workspaceName">{{ workspaceName }}</span>
      </div>
      <slot name="toolbar" />
    </template>
    <template v-if="$slots.default" #default><slot /></template>
    <template #side>
      <section class="workspace-preview-info">
        <h3>素材信息</h3>
        <dl>
          <dt>名称</dt>
          <dd>{{ file.name }}</dd>
          <dt>类型</dt>
          <dd>{{ kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频' }}</dd>
          <dt>来源</dt>
          <dd>{{ source }}</dd>
          <template v-if="width && height"
            ><dt>尺寸</dt>
            <dd>{{ width }} × {{ height }}</dd></template
          >
          <template v-if="duration"
            ><dt>时长</dt>
            <dd>{{ duration }}</dd></template
          >
          <template v-if="file.size"
            ><dt>大小</dt>
            <dd>{{ file.size }}</dd></template
          >
        </dl>
      </section>
      <section v-if="$slots.side" class="workspace-preview-extra"><slot name="side" /></section>
    </template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </MediaQuickLook>
</template>

<style scoped>
.workspace-preview-context {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  color: var(--ui-muted);
  font-size: 12px;
}
.source-badge {
  padding: 3px 8px;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-accent-soft);
  color: var(--primary-color);
}
.workspace-preview-info h3 {
  margin: 0 0 16px;
  font-size: 14px;
}
.workspace-preview-info dl {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  gap: 12px 14px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}
.workspace-preview-info dt {
  color: var(--ui-muted);
}
.workspace-preview-info dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.workspace-preview-extra {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--ui-border);
}
</style>
