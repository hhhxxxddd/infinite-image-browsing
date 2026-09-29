<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import type { WorkspaceRecord } from '@/features/workspaces/public'
import type { AICreationSection } from '@/features/workspaces/model/workspaceMaterials'
import AIImageEditor from './AIImageEditor.vue'
import AIImageGeneration from './AIImageGeneration.vue'
import AIMediaPlaceholder from './AIMediaPlaceholder.vue'
import AICreationNavigation from './AICreationNavigation.vue'
import AIImageTaskTabs from './AIImageTaskTabs.vue'
import { message } from 'ant-design-vue'
import {
  workspaceStorage,
  saveWorkspaceState
} from '@/features/workspaces/services/workspaceStorage'
import { assertProductionDraftExists } from '@/features/workspaces/model/workspaceWorks'
import {
  readAICreationSession,
  aiCreationSessionKey,
  aiSessionMedia,
  selectAIMedia,
  selectAIImageTask,
  type AICreationSession,
  type AICreationMedia,
  type AIImageTask
} from '../model/aiCreationSession'
import type { WorkspaceArtifact } from '@/features/workspaces/api/workspaceArtifacts'
import type { ProductionSource } from '@/features/workspaces/model/workspaceWorks'

const props = defineProps<{
  workspace?: WorkspaceRecord
  draftScope?: string
  productionId?: string
  productionName?: string
  purpose?: 'image_edit' | 'image_generation'
  artifacts: WorkspaceArtifact[]
  productionSource?: ProductionSource
  sourceName?: string
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
  openSource: [id: string]
}>()
const editor = ref<InstanceType<typeof AIImageEditor>>()
const generator = ref<InstanceType<typeof AIImageGeneration>>()
const placeholder = ref<InstanceType<typeof AIMediaPlaceholder>>()
const session = ref<AICreationSession>({ version: 1, section: 'edit', imageTask: 'edit' })
const media = computed(() => aiSessionMedia(session.value))
const visited = ref({ generation: false, edit: false })
const switching = ref(false)
function applySession(value: AICreationSession) {
  session.value = value
  section.value = value.section
  if (value.section === 'generation' || value.section === 'edit')
    visited.value[value.section] = true
}
const currentEditor = computed(() =>
  section.value === 'generation'
    ? generator.value
    : section.value === 'edit'
      ? editor.value
      : placeholder.value
)
const materialController = computed(() =>
  section.value === 'generation'
    ? generator.value?.materialController
    : section.value === 'edit'
      ? editor.value?.materialController
      : undefined
)
const editorOpen = ref(false)
watch(
  () => props.openRequested,
  (requested) => {
    if (!requested) return
    if (props.workspace && props.draftScope)
      applySession(
        readAICreationSession(
          workspaceStorage(props.workspace.id),
          props.workspace.id,
          props.draftScope,
          props.purpose
        )
      )
    else
      applySession({
        version: 1,
        section: props.purpose === 'image_generation' ? 'generation' : 'edit',
        imageTask: props.purpose === 'image_generation' ? 'generation' : 'edit'
      })
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
    currentEditor.value?.focusEditor()
  },
  { immediate: true, flush: 'post' }
)
onBeforeUnmount(() => restorePage?.())
function saveBeforeLeave() {
  return currentEditor.value?.saveBeforeLeave() ?? true
}
async function closeEditor() {
  if (switching.value || !(await saveBeforeLeave())) return
  editorOpen.value = false
  await nextTick()
  emit('closed')
}
defineExpose({ materialController, fullscreenOpen, saveBeforeLeave })
async function openSource(id: string) {
  await closeEditor()
  if (editorOpen.value) return
  emit('openSource', id)
}
async function switchSession(next: AICreationSession) {
  if (switching.value || next.section === section.value) return
  switching.value = true
  try {
    if (!(await saveBeforeLeave())) return
    const workspaceId = props.workspace?.id
    if (workspaceId && props.draftScope && !props.readonly) {
      const key = aiCreationSessionKey(workspaceId, props.draftScope)
      await saveWorkspaceState(workspaceId, (storage) => {
        if (props.productionId)
          assertProductionDraftExists(storage, workspaceId, props.productionId)
        storage.setItem(key, JSON.stringify(next))
      })
    }
    applySession(next)
    await nextTick()
    currentEditor.value?.focusEditor()
  } catch (error) {
    message.error(error instanceof Error ? error.message : '当前任务尚未保存，请重试')
  } finally {
    switching.value = false
  }
}
function switchMedia(value: AICreationMedia) {
  void switchSession(selectAIMedia(session.value, value))
}
function switchImageTask(value: AIImageTask) {
  void switchSession(selectAIImageTask(session.value, value))
}
</script>

<template>
  <Teleport to="body">
    <Transition name="editor-open" appear>
      <div v-show="fullscreenOpen" class="ai-creation-layer">
        <AIImageGeneration
          v-if="visited.generation"
          v-show="section === 'generation'"
          ref="generator"
          v-model:note="note"
          :workspace="workspace"
          :draft-scope="draftScope"
          :production-id="productionId"
          :production-name="productionName"
          :artifacts="artifacts"
          :asset-info="assetInfo"
          :note-dirty="noteDirty"
          :note-saving="noteSaving"
          :readonly="readonly"
          @close="closeEditor"
          @save-note="emit('saveNote')"
        >
          <template #navigation
            ><AICreationNavigation
              :media="media"
              :disabled="switching"
              @select="switchMedia"
              @close="closeEditor"
          /></template>
          <template #image-task
            ><AIImageTaskTabs
              :task="session.imageTask"
              :disabled="switching"
              @select="switchImageTask"
          /></template>
          <template #materials><slot v-if="section === 'generation'" name="materials" /></template>
        </AIImageGeneration>
        <AIImageEditor
          v-if="visited.edit"
          v-show="section === 'edit'"
          ref="editor"
          v-model:section="section"
          v-model:note="note"
          :note-dirty="noteDirty"
          :note-saving="noteSaving"
          :workspace="workspace"
          :draft-scope="draftScope"
          :production-id="productionId"
          :production-source="productionSource"
          :source-name="sourceName"
          :asset-info="assetInfo"
          :readonly="readonly"
          :active="fullscreenOpen && section === 'edit'"
          @close="closeEditor"
          @artifact-saved="$emit('artifactSaved')"
          @save-note="emit('saveNote')"
          @open-source="openSource"
        >
          <template #navigation
            ><AICreationNavigation
              :media="media"
              :disabled="switching"
              @select="switchMedia"
              @close="closeEditor"
          /></template>
          <template #image-task
            ><AIImageTaskTabs
              :task="session.imageTask"
              :disabled="switching"
              @select="switchImageTask"
          /></template>
          <template #materials><slot v-if="section === 'edit'" name="materials" /></template>
        </AIImageEditor>
        <AIMediaPlaceholder
          v-if="media !== 'image'"
          ref="placeholder"
          v-model:note="note"
          :media="media"
          :readonly="readonly"
          :note-dirty="noteDirty"
          :note-saving="noteSaving"
          @close="closeEditor"
          @save-note="emit('saveNote')"
        >
          <template #navigation
            ><AICreationNavigation
              :media="media"
              :disabled="switching"
              @select="switchMedia"
              @close="closeEditor"
          /></template>
          <template #materials><slot name="materials" /></template>
        </AIMediaPlaceholder>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ai-creation-layer {
  position: fixed;
  inset: 0;
  z-index: 950;
}
</style>
