<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { CloseOutlined } from '@ant-design/icons-vue'
import type { SearchFilters, Tag } from '../api/library'
import LibraryFilterFields from './LibraryFilterFields.vue'

const props = defineProps<{
  open: boolean
  modelValue: SearchFilters
  tags: Tag[]
  disabled?: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: SearchFilters]
  validity: [valid: boolean]
  close: []
  reset: []
  clear: []
  apply: []
}>()
const valid = ref(true)
const panel = ref<HTMLElement>()
let trigger: HTMLElement | null = null
watch(
  () => props.open,
  async (open) => {
    if (open) {
      trigger = document.activeElement as HTMLElement | null
      await nextTick()
      if (props.open) panel.value?.focus()
    } else if (trigger?.isConnected) {
      trigger.focus()
    }
  }
)
function updateValidity(value: boolean) {
  valid.value = value
  emit('validity', value)
}
</script>

<template>
  <Transition name="filter-panel">
    <aside
      v-show="open"
      ref="panel"
      class="library-filter-panel"
      aria-label="筛选媒体"
      tabindex="-1"
      @keydown.esc.stop="emit('close')"
    >
      <div class="filter-panel-heading">
        <strong>筛选媒体</strong>
        <a-button type="text" title="关闭筛选" aria-label="关闭筛选" @click="emit('close')">
          <CloseOutlined />
        </a-button>
      </div>
      <div class="filter-panel-scroll">
        <slot name="before" />
        <LibraryFilterFields
          :model-value="modelValue"
          :tags="tags"
          :disabled="disabled"
          @update:model-value="emit('update:modelValue', $event)"
          @validity="updateValidity"
        />
        <slot />
      </div>
      <div class="filter-panel-footer">
        <a-button :disabled="disabled" @click="emit('reset')">重置</a-button>
        <a-button type="primary" :disabled="disabled || !valid" @click="emit('apply')">
          应用筛选
        </a-button>
        <a-button class="clear-filter-button" :disabled="disabled" @click="emit('clear')">
          清空全部筛选
        </a-button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.library-filter-panel {
  position: absolute;
  inset: 12px 12px 12px auto;
  width: min(360px, calc(100% - 24px));
  z-index: 200;
  border: 1px solid var(--zp-border);
  border-radius: 10px;
  background: var(--zp-primary-background);
  box-shadow: 0 8px 32px #0002;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  outline: none;
}
.filter-panel-enter-active,
.filter-panel-leave-active {
  transition:
    opacity var(--ui-motion) var(--ui-ease),
    transform var(--ui-motion) var(--ui-ease);
}
.filter-panel-enter-from,
.filter-panel-leave-to {
  opacity: 0;
  transform: translateX(10px);
}
.filter-panel-heading {
  height: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--zp-border);
  font-size: 14px;
}
.filter-panel-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px;
}
.filter-panel-footer {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--zp-border);
  background: var(--zp-primary-background);
}
.filter-panel-footer > .ant-btn {
  min-width: 0;
}
.clear-filter-button {
  grid-column: 1/-1;
  background: var(--zp-secondary-background);
}
@container (max-width:580px) {
  .library-filter-panel {
    inset: 0 0 0 auto;
    width: min(360px, 100%);
    border-radius: var(--ui-radius-lg) 0 0 var(--ui-radius-lg);
  }
}
</style>
