<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { WorkspaceRecord } from '@/features/workspaces/public'
import type { AICreationSection } from '@/features/workspaces/model/workspaceMaterials'
import AIImageEditor from './AIImageEditor.vue'

const props = defineProps<{
  workspace?: WorkspaceRecord
  draftScope?: string
  productionId?: string
  openRequested?: boolean
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  active: boolean
  noteDirty: boolean
  noteSaving: boolean
}>()
const section = defineModel<AICreationSection>('section', { required: true })
const note = defineModel<string>('note', { required: true })
const emit = defineEmits<{
  artifactSaved: []
  configure: []
  opened: []
  closed: []
  saveNote: []
}>()
const editor = ref<InstanceType<typeof AIImageEditor>>()
const materialController = computed(() => editor.value?.materialController)
const editorOpen = ref(false)
watch(
  () => props.openRequested,
  (requested) => {
    if (!requested) return
    section.value = 'edit'
    editorOpen.value = true
    emit('opened')
  },
  { immediate: true }
)
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
async function closeEditor() {
  editorOpen.value = false
  await nextTick()
  emit('closed')
}
defineExpose({ materialController, fullscreenOpen, saveBeforeLeave })
</script>

<template>
  <Teleport to="body">
    <Transition name="editor-open" appear>
      <AIImageEditor
        v-show="fullscreenOpen"
        ref="editor"
        v-model:section="section"
        v-model:note="note"
        :note-dirty="noteDirty"
        :note-saving="noteSaving"
        :workspace="workspace"
        :draft-scope="draftScope"
        :production-id="productionId"
        :asset-info="assetInfo"
        :readonly="readonly"
        :active="fullscreenOpen && section === 'edit'"
        @close="closeEditor"
        @artifact-saved="$emit('artifactSaved')"
        @save-note="emit('saveNote')"
      >
        <template #materials><slot name="materials" /></template>
      </AIImageEditor>
    </Transition>
  </Teleport>
</template>
