<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { WorkspaceRecord } from '@/features/workspaces/public'
import {
  aiCreationSections,
  type AICreationSection
} from '@/features/workspaces/model/workspaceMaterials'
import AIImageEditor from './AIImageEditor.vue'
import AICreationTabs from './AICreationTabs.vue'

const props = defineProps<{
  workspace?: WorkspaceRecord
  draftScope?: string
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  active: boolean
}>()
const section = defineModel<AICreationSection>('section', { required: true })
defineEmits<{ artifactSaved: []; configure: [] }>()
const editor = ref<InstanceType<typeof AIImageEditor>>()
const materialController = computed(() => editor.value?.materialController)
const editorOpen = ref(false)
const fullscreenOpen = computed(() => !!props.workspace && props.active && editorOpen.value)
let restorePage: (() => void) | undefined
let previousFocus: HTMLElement | null = null
watch(
  () => props.active,
  (active) => {
    if (!active) editorOpen.value = false
  }
)
watch(
  fullscreenOpen,
  async (open) => {
    restorePage?.()
    restorePage = undefined
    if (!open) {
      await nextTick()
      if (previousFocus?.isConnected) previousFocus.focus()
      return
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const app = document.getElementById('omnigallery-app')
    const oldInert = app?.inert ?? false
    const oldOverflow = document.body.style.overflow
    if (app) app.inert = true
    document.body.style.overflow = 'hidden'
    restorePage = () => {
      if (app) app.inert = oldInert
      document.body.style.overflow = oldOverflow
    }
    await nextTick()
    editor.value?.focusEditor()
  },
  { immediate: true, flush: 'post' }
)
onBeforeUnmount(() => restorePage?.())
function saveBeforeLeave() {
  return editor.value?.saveBeforeLeave() ?? true
}
defineExpose({ materialController, fullscreenOpen, saveBeforeLeave })
</script>

<template>
  <div class="ai-creation-page">
    <AICreationTabs v-model="section" class="page-tabs" />
    <div
      id="ai-creation-panel-edit"
      v-show="section === 'edit'"
      role="tabpanel"
      aria-label="图片编辑"
    >
      <section class="creation-placeholder">
        <strong>图片编辑</strong>
        <p>编辑主图、参考图和蒙版，继续 AI 加工。</p>
        <button type="button" @click="editorOpen = true">打开图片编辑器</button>
      </section>
      <Teleport to="body">
        <AIImageEditor
          v-show="fullscreenOpen"
          ref="editor"
          v-model:section="section"
          :workspace="workspace"
          :draft-scope="draftScope"
          :asset-info="assetInfo"
          :readonly="readonly"
          :active="fullscreenOpen && section === 'edit'"
          @close="editorOpen = false"
          @artifact-saved="$emit('artifactSaved')"
        >
          <template #materials><slot name="materials" /></template>
        </AIImageEditor>
      </Teleport>
    </div>
    <section
      v-for="tab in aiCreationSections.filter((item) => item.id !== 'edit')"
      v-show="section === tab.id"
      :id="`ai-creation-panel-${tab.id}`"
      :key="tab.id"
      class="creation-placeholder"
      role="tabpanel"
      :aria-label="tab.label"
    >
      <strong>{{ tab.label }}</strong>
      <p>创作功能待接入，当前可浏览工作区素材。</p>
      <button type="button" @click="editorOpen = true">打开{{ tab.label }}</button>
    </section>
  </div>
</template>

<style scoped>
.page-tabs {
  margin-bottom: 10px;
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
