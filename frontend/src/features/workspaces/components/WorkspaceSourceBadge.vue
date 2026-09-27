<script setup lang="ts">
defineProps<{ source?: 'ai_image_edit' | 'image_studio' }>()
</script>

<template>
  <small class="workspace-source-badge">{{
    source === 'ai_image_edit' ? 'AI 加工' : source === 'image_studio' ? '图片制作' : '工作区'
  }}</small>
</template>

<style scoped>
.workspace-source-badge {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 2;
  max-width: calc(100% - 4px);
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 3px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--ui-surface) 94%, transparent);
  color: #956a16;
  box-shadow: 0 1px 4px #0003;
  font-size: 9px;
  line-height: 14px;
  white-space: nowrap;
  pointer-events: none;
}
</style>
