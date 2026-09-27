<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { WorkspaceRecord } from '@/features/workspaces/public'
import {
  aiCreationSections,
  type AICreationSection
} from '@/features/workspaces/model/workspaceMaterials'
import AIImageEditor from './AIImageEditor.vue'

defineProps<{
  workspace?: WorkspaceRecord
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  active: boolean
}>()
const section = defineModel<AICreationSection>('section', { required: true })
defineEmits<{ artifactSaved: []; configure: [] }>()
const editor = ref<InstanceType<typeof AIImageEditor>>()
const materialController = computed(() => editor.value?.materialController)
defineExpose({ materialController })
function moveTab(event: KeyboardEvent) {
  const current = aiCreationSections.findIndex((tab) => tab.id === section.value)
  const next =
    event.key === 'ArrowRight'
      ? (current + 1) % 4
      : event.key === 'ArrowLeft'
        ? (current + 3) % 4
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? 3
            : -1
  if (next < 0) return
  event.preventDefault()
  section.value = aiCreationSections[next].id
  document.getElementById(`ai-creation-tab-${section.value}`)?.focus()
}
</script>

<template>
  <div class="ai-creation-page">
    <nav class="creation-tabs" role="tablist" aria-label="AI 创作功能" @keydown="moveTab">
      <button
        v-for="tab in aiCreationSections"
        :id="`ai-creation-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        :aria-selected="section === tab.id"
        :aria-controls="`ai-creation-panel-${tab.id}`"
        :tabindex="section === tab.id ? 0 : -1"
        @click="section = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>
    <div
      id="ai-creation-panel-edit"
      v-show="section === 'edit'"
      role="tabpanel"
      aria-labelledby="ai-creation-tab-edit"
    >
      <AIImageEditor
        ref="editor"
        :workspace="workspace"
        :asset-info="assetInfo"
        :readonly="readonly"
        :active="active && section === 'edit'"
        @artifact-saved="$emit('artifactSaved')"
      />
    </div>
    <section
      v-for="tab in aiCreationSections.filter((item) => item.id !== 'edit')"
      v-show="section === tab.id"
      :id="`ai-creation-panel-${tab.id}`"
      :key="tab.id"
      class="creation-placeholder"
      role="tabpanel"
      :aria-labelledby="`ai-creation-tab-${tab.id}`"
    >
      <strong>{{ tab.label }}</strong>
      <p>创作功能待接入，当前可浏览工作区素材。</p>
      <button type="button" @click="$emit('configure')">配置工作流</button>
    </section>
  </div>
</template>

<style scoped>
.creation-tabs {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  margin-bottom: 10px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
}
.creation-tabs button {
  border: 0;
  border-radius: 6px;
  padding: 8px 14px;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.creation-tabs button[aria-selected='true'] {
  background: var(--primary-color-1);
  color: var(--primary-color);
  font-weight: 600;
}
.creation-tabs button:focus-visible {
  outline: 2px solid var(--primary-color);
}
.creation-placeholder {
  padding: 24px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface);
  color: var(--ui-text);
}
.creation-placeholder p {
  color: var(--ui-muted);
  font-size: 13px;
}
.creation-placeholder button {
  border: 1px solid var(--ui-border);
  padding: 7px 12px;
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--primary-color);
  cursor: pointer;
}
</style>
