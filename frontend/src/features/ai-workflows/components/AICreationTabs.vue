<script setup lang="ts">
import { Tooltip } from 'ant-design-vue'
import {
  PictureOutlined,
  EditOutlined,
  AudioOutlined,
  VideoCameraOutlined
} from '@ant-design/icons-vue'

import {
  aiCreationSections,
  type AICreationSection
} from '@/features/workspaces/model/workspaceMaterials'
defineProps<{ disabled?: boolean; compact?: boolean }>()
const icons = {
  generation: PictureOutlined,
  edit: EditOutlined,
  audio: AudioOutlined,
  video: VideoCameraOutlined
}

const section = defineModel<AICreationSection>({ required: true })
function moveTab(event: KeyboardEvent) {
  const current = aiCreationSections.findIndex((tab) => tab.id === section.value)
  const count = aiCreationSections.length
  const next =
    event.key === 'ArrowRight'
      ? (current + 1) % count
      : event.key === 'ArrowLeft'
        ? (current + count - 1) % count
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? count - 1
            : -1
  if (next < 0) return
  event.preventDefault()
  const button = (event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')[
    next
  ]
  if (!button || button.disabled) return
  section.value = aiCreationSections[next].id
  button.focus()
}
</script>
<template>
  <nav
    class="creation-tabs"
    :class="{ 'is-compact': compact }"
    role="tablist"
    aria-label="AI 创作功能"
    @keydown="moveTab"
  >
    <Tooltip
      v-for="tab in aiCreationSections"
      :key="tab.id"
      :title="compact ? tab.label : undefined"
    >
      <button
        type="button"
        role="tab"
        :aria-label="tab.label"
        :aria-selected="section === tab.id"
        :tabindex="section === tab.id ? 0 : -1"
        :disabled="disabled"
        @click="section = tab.id"
      >
        <component :is="icons[tab.id]" v-if="compact" />
        <template v-else>{{ tab.label }}</template>
      </button>
    </Tooltip>
  </nav>
</template>
<style scoped>
.creation-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
}
.creation-tabs button {
  border: 0;
  border-radius: 6px;
  padding: 8px 12px;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
}
.creation-tabs button[aria-selected='true'] {
  background: var(--primary-color-1);
  color: var(--primary-color);
  font-weight: 600;
}
.creation-tabs button:focus-visible {
  outline: 2px solid var(--primary-color);
}
.creation-tabs button:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (max-width: 650px) {
  .creation-tabs button {
    padding: 8px 6px;
  }
}
.creation-tabs.is-compact {
  gap: 4px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.creation-tabs.is-compact button {
  width: 32px;
  height: 32px;
  padding: 0;
  font-size: 16px;
}
</style>
