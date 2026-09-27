<script setup lang="ts">
import { QuestionCircleOutlined } from '@ant-design/icons-vue'
import { ref } from 'vue'

defineProps<{ label: string }>()
const open = ref(false)
</script>

<template>
  <a-popover v-model:open="open" :trigger="['hover', 'click']" placement="topLeft">
    <template #content
      ><div class="settings-help-content"><slot /></div
    ></template>
    <button
      type="button"
      class="settings-help-button"
      :aria-label="`${label}说明`"
      :aria-expanded="open"
      @keydown.esc.stop="open = false"
    >
      <QuestionCircleOutlined />
    </button>
  </a-popover>
</template>

<style scoped>
.settings-help-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--zp-secondary);
  font-size: 14px;
  cursor: help;
}
.settings-help-button:hover,
.settings-help-button[aria-expanded='true'] {
  color: var(--primary-color);
  background: var(--ui-surface-soft);
}
.settings-help-button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}
.settings-help-content {
  max-width: min(320px, calc(100vw - 64px));
  font-size: 12px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.settings-help-content :deep(p) {
  margin: 0 0 8px;
}
.settings-help-content :deep(p:last-child) {
  margin-bottom: 0;
}
</style>
