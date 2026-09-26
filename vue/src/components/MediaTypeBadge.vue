<script setup lang="ts">
defineProps<{ kind: 'image' | 'video' | 'audio'; compact?: boolean }>()
const labels = { image: '图片', video: '视频', audio: '音频' }
</script>

<template>
  <span class="media-type-badge" :class="{ compact }">{{ labels[kind] }}</span>
</template>

<style scoped>
.media-type-badge{position:absolute;top:8px;left:8px;z-index:4;padding:3px 7px;border-radius:6px;background:#101b2bbd;color:white;font-size:11px;line-height:16px;backdrop-filter:blur(4px);pointer-events:none;white-space:nowrap}
.media-type-badge.compact{top:3px;left:3px;padding:1px 4px;border-radius:3px;font-size:9px;line-height:13px}
</style>
