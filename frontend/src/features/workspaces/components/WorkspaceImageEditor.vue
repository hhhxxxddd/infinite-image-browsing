<script setup lang="ts">
import { computed } from 'vue'
import { createWorkspaceDraftRepository } from '../model/workspaceDraftRepository'
import { message } from 'ant-design-vue'
import ImageCreationStudio from '@/features/image-editor/components/ImageCreationStudio.vue'
import type { ImageEditorProps, StudioArtifactRequest } from '@/features/image-editor/public'
import StudioAIHandoff from '@/features/ai-workflows/components/StudioAIHandoff.vue'
import WorkspaceImageStrip from './WorkspaceImageStrip.vue'
import { saveWorkspaceArtifact, syncWorkspaceArtifact } from '../api/workspaceArtifacts'
const props = defineProps<Omit<ImageEditorProps, 'persistArtifact' | 'draftRepository'>>()
const draftRepository = computed(() =>
  createWorkspaceDraftRepository(props.workspaceId, localStorage)
)
const note = defineModel<string>('note', { required: true })
defineEmits<{ exit: []; addAssets: []; saveNote: []; artifactSaved: [] }>()
async function persistArtifact(request: StudioArtifactRequest) {
  const saved = await saveWorkspaceArtifact(
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
  if (!request.syncDirectory) return { synced: false }
  try {
    await syncWorkspaceArtifact(saved.id, request.syncDirectory)
    return { synced: true }
  } catch {
    message.warning('素材已保存，但未能同步到媒体库')
    return { synced: false }
  }
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
</template>
