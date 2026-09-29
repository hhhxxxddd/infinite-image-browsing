<script setup lang="ts">
import { CloseOutlined } from '@ant-design/icons-vue'
import AICreationTabs from './AICreationTabs.vue'
import type { AICreationMedia } from '../model/aiCreationSession'
defineProps<{ media: AICreationMedia; disabled?: boolean }>()
defineEmits<{ select: [media: AICreationMedia]; close: [] }>()
</script>
<template>
  <div class="editor-navigation editor-actionbar">
    <AICreationTabs
      :model-value="media"
      :disabled="disabled"
      compact
      @update:model-value="$emit('select', $event)"
    />
    <button
      type="button"
      aria-label="关闭编辑"
      title="返回工作台，保留当前制作会话"
      :disabled="disabled"
      @click="$emit('close')"
    >
      <CloseOutlined />
    </button>
  </div>
</template>
<style scoped>
.editor-navigation {
  position: absolute;
  top: 16px;
  right: calc(var(--ai-panel-width) + 28px);
  z-index: 5;
}
</style>
