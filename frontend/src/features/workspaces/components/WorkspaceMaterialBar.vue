<script setup lang="ts">
import { ref } from 'vue'
import { Tooltip } from 'ant-design-vue'
import { AppstoreOutlined, PlusOutlined } from '@ant-design/icons-vue'

defineProps<{
  expanded?: boolean
  browserId?: string
  readonly?: boolean
  browseDisabled?: boolean
}>()
defineEmits<{ browse: []; add: [] }>()
const helpAllowed = ref(true)
function updateHelp(event: MouseEvent | FocusEvent) {
  helpAllowed.value = !(event.target instanceof Element && event.target.closest('button'))
}
</script>

<template>
  <div class="material-bar" :class="{ 'has-tools': !!$slots.tools }">
    <Tooltip
      :mouse-enter-delay="0.6"
      :trigger="['hover', 'focus']"
      :open="helpAllowed ? undefined : false"
    >
      <template #title>
        <div>当前工作区可继续使用的素材</div>
        <div>产物：在工作区制作并保存的内容</div>
        <div>引用：从媒体库加入的内容</div>
      </template>
      <div
        class="material-content"
        tabindex="0"
        aria-label="当前工作区素材"
        @mouseover="updateHelp"
        @focusin="updateHelp"
      >
        <slot />
      </div>
    </Tooltip>
    <div class="material-actions">
      <Tooltip title="查看全部素材">
        <button
          type="button"
          class="material-action material-browse"
          aria-label="查看全部素材"
          :aria-expanded="expanded"
          :aria-controls="browserId"
          :disabled="browseDisabled"
          @click="$emit('browse')"
        >
          <AppstoreOutlined />
        </button>
      </Tooltip>
      <Tooltip title="从媒体库加入素材">
        <button
          type="button"
          class="material-action"
          aria-label="从媒体库加入素材"
          :disabled="readonly"
          @click="$emit('add')"
        >
          <PlusOutlined />
        </button>
      </Tooltip>
    </div>
    <slot name="tools" />
    <slot name="browser" />
  </div>
</template>

<style scoped>
.material-bar {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 14px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
  color: var(--ui-text);
}
.material-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.material-bar.has-tools {
  grid-template-columns: minmax(0, 1fr) auto auto;
}
.material-action {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
  font: inherit;
  font-size: 16px;
}
.material-content {
  min-width: 0;
  border-radius: 11px;
}
.material-action:hover:not(:disabled),
.material-action[aria-expanded='true'] {
  border-color: var(--primary-color);
  color: var(--primary-color);
  background: var(--primary-color-1);
}
.material-action:disabled {
  opacity: 0.4;
  cursor: default;
}
.material-action:focus-visible,
.material-content:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
}
</style>
