<script setup lang="ts">
import type { AIImageTask } from '../model/aiCreationSession'
defineProps<{ task: AIImageTask; disabled?: boolean }>()
defineEmits<{ select: [task: AIImageTask] }>()
</script>
<template>
  <div class="image-task-heading">
    <strong>AI 图片</strong>
    <div class="image-task-tabs" role="group" aria-label="AI 图片任务">
      <button
        v-for="item in [
          { id: 'generation' as const, label: '生成' },
          { id: 'edit' as const, label: '编辑' }
        ]"
        :key="item.id"
        type="button"
        :aria-pressed="task === item.id"
        :disabled="disabled"
        @click="$emit('select', item.id)"
      >
        {{ item.label }}
      </button>
    </div>
  </div>
</template>
<style scoped>
.image-task-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}
.image-task-tabs {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid var(--ui-control-border);
  border-radius: 9px;
  background: var(--ui-surface-soft);
}
.image-task-tabs button {
  border: 0;
  border-radius: 6px;
  padding: 5px 14px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  cursor: pointer;
}
.image-task-tabs button[aria-pressed='true'] {
  background: var(--primary-color-1);
  color: var(--primary-color);
}
.image-task-tabs button:focus-visible {
  outline: 2px solid var(--primary-color);
}
.image-task-tabs button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
