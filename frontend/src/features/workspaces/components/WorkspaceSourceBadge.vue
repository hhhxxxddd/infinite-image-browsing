<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ source?: 'ai_image_edit' | 'image_studio'; product?: boolean }>()
const sourceLabel = computed(() =>
  props.source === 'ai_image_edit'
    ? 'AI 加工'
    : props.source === 'image_studio'
      ? '图片制作'
      : '工作区'
)
</script>

<template>
  <small
    class="workspace-source-badge"
    :class="{ 'product-badge': product }"
    :title="`产物 · ${sourceLabel}`"
    >{{ product ? '产物' : sourceLabel }}</small
  >
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
.product-badge {
  background: #f3ca76;
  color: #48300b;
  border: 1px solid #ffdfa2;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 650;
  line-height: 16px;
}
</style>
