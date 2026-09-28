<script setup lang="ts">
import { Tooltip } from 'ant-design-vue'
import type { MaterialClickMode, MaterialClickOption } from '../model/workspaceMaterials'

defineProps<{ options: MaterialClickOption[] }>()
const mode = defineModel<MaterialClickMode>({ required: true })
</script>

<template>
  <div class="material-click-modes" role="group" aria-label="素材点击操作">
    <Tooltip v-for="option in options" :key="option.value" :title="option.title">
      <button
        type="button"
        :aria-pressed="mode === option.value"
        :disabled="option.disabled"
        @click="mode = option.value"
      >
        {{ option.label }}
      </button>
    </Tooltip>
  </div>
</template>

<style scoped>
.material-click-modes {
  display: flex;
  flex-direction: column;
  flex: none;
  box-sizing: border-box;
  width: 48px;
  height: 72px;
  gap: 4px;
  padding: 2px;
  border-radius: 6px;
  background: var(--ui-surface-soft);
}
button {
  display: grid;
  place-items: center;
  flex: 1;
  min-height: 0;
  padding: 0 4px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
button:hover:enabled {
  color: var(--ui-text);
  background: var(--ui-hover);
}
button[aria-pressed='true'] {
  color: var(--primary-color);
  background: var(--primary-color-1);
}
button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
button:disabled {
  opacity: 0.35;
  cursor: default;
}
</style>
