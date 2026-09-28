<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { persistentImageDraftRepository } from '../services/workspaceStorage'
import ImageCreationStudio from '@/features/image-editor/components/ImageCreationStudio.vue'
import type { ImageEditorProps, StudioArtifactRequest } from '@/features/image-editor/public'
import StudioAIHandoff from '@/features/ai-workflows/components/StudioAIHandoff.vue'
import WorkspaceImageStrip from './WorkspaceImageStrip.vue'
import WorkspaceAssetPreview from './WorkspaceAssetPreview.vue'
import { saveWorkspaceArtifact } from '../api/workspaceArtifacts'
const props = defineProps<
  Omit<ImageEditorProps, 'persistArtifact' | 'draftRepository'> & { workId?: string }
>()
const draftRepository = computed(() =>
  persistentImageDraftRepository(props.workspaceId, props.workId)
)
const note = defineModel<string>('note', { required: true })
const previewPath = ref('')
let previewTrigger: HTMLElement | null = null
function previewMaterial(path: string) {
  if (!props.assetInfo[path]) return
  previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  previewPath.value = path
}
function closePreview() {
  previewPath.value = ''
  void nextTick(() => {
    if (previewTrigger?.isConnected) previewTrigger.focus()
  })
}
defineEmits<{
  exit: []
  addAssets: []
  saveNote: []
  artifactSaved: []
  documentActivated: [id: string]
}>()
async function persistArtifact(request: StudioArtifactRequest) {
  await saveWorkspaceArtifact(
    request.workspaceId,
    request.name,
    request.format,
    request.imageBase64,
    'image_studio',
    '',
    request.documentId && request.documentRevision
      ? { documentId: request.documentId, documentRevision: request.documentRevision }
      : undefined
  )
}
</script>
<template>
  <ImageCreationStudio
    v-bind="props"
    v-model:note="note"
    :persist-artifact="persistArtifact"
    :draft-repository="draftRepository"
    @exit="$emit('exit')"
    @add-assets="$emit('addAssets')"
    @save-note="$emit('saveNote')"
    @artifact-saved="$emit('artifactSaved')"
    @document-activated="$emit('documentActivated', $event)"
    @preview-asset="previewMaterial"
  >
    <template #materials="session">
      <WorkspaceImageStrip
        :key="workspaceId"
        :workspace-id="workspaceId"
        :assets="assets"
        :asset-info="assetInfo"
        :selected-path="session.selectedPath"
        :used-paths="session.usedPaths"
        :can-replace="session.canReplace"
        :disabled="session.disabled"
        @pick="session.pick"
        @browse="session.browse"
        @preview="previewMaterial"
        @add-assets="$emit('addAssets')"
      />
    </template>
    <template #ai="session">
      <StudioAIHandoff
        :open="session.open"
        :doc="session.doc"
        :scope="session.scope"
        :asset-info="assetInfo"
        :assets="assets"
        :workspace-id="workspaceId"
        @update:open="session.setOpen"
      />
    </template>
  </ImageCreationStudio>
  <WorkspaceAssetPreview
    v-if="previewPath && assetInfo[previewPath]"
    :key="previewPath"
    :file="assetInfo[previewPath]"
    @close="closePreview"
  />
</template>
