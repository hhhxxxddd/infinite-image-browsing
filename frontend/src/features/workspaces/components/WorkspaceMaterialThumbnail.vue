<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PictureOutlined,
  VideoCameraOutlined,
  CustomerServiceOutlined
} from '@ant-design/icons-vue'
import {
  toImageThumbnailUrl,
  toVideoCoverUrl,
  type FileNodeInfo
} from '@/features/media-library/public'
import type { WorkspaceAsset } from '../model/workspaceModel'
import WorkspaceSourceBadge from './WorkspaceSourceBadge.vue'
import MediaTypeBadge from '@/features/media-library/components/MediaTypeBadge.vue'

const props = defineProps<{ asset: WorkspaceAsset; file?: FileNodeInfo; role?: string }>()
const shortRole = computed(() =>
  props.role === '主图' ? '主' : props.role?.replace(/^参考图\s*/, '参')
)
const failed = ref(false)
const url = computed(() =>
  !props.file || props.asset.kind === 'audio'
    ? ''
    : props.asset.kind === 'video' && !props.file.workspace_artifact_id
      ? toVideoCoverUrl(props.file)
      : toImageThumbnailUrl(props.file, '160x160')
)
watch(url, () => {
  failed.value = false
})
</script>

<template>
  <span class="material-thumbnail">
    <img v-if="url && !failed" :src="url" alt="" loading="lazy" @error="failed = true" />
    <component
      v-else
      :is="
        asset.kind === 'audio'
          ? CustomerServiceOutlined
          : asset.kind === 'video'
            ? VideoCameraOutlined
            : PictureOutlined
      "
    />
    <MediaTypeBadge :kind="asset.kind" compact />
    <small v-if="role" class="material-role" :title="role" :aria-label="role">{{
      shortRole
    }}</small>
    <WorkspaceSourceBadge
      v-if="file?.workspace_artifact_id"
      :source="file.workspace_artifact_source"
      product
    />
  </span>
</template>

<style scoped>
.material-thumbnail {
  display: grid;
  position: relative;
  place-items: center;
  width: 100%;
  height: 100%;
  min-height: 0;
  border-radius: 6px;
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
  overflow: hidden;
}
img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.material-role {
  position: absolute;
  top: 3px;
  right: 3px;
  z-index: 4;
  box-sizing: border-box;
  max-width: calc(100% - 32px);
  padding: 1px 3px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 9px;
  line-height: 13px;
  font-weight: 650;
  color: var(--primary-color);
  background: var(--ui-surface);
  box-shadow: 0 1px 4px #0003;
}
</style>
