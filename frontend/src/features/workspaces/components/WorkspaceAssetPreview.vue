<script setup lang="ts">
import type { FileNodeInfo } from '@/features/media-library/api/files'
import WorkspacePreviewShell from './WorkspacePreviewShell.vue'
import AIResultPreview from '@/features/ai-workflows/components/AIResultPreview.vue'

defineProps<{ file: FileNodeInfo; workspaceName?: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <AIResultPreview
    v-if="file.workspace_artifact_source === 'ai_image_edit' && file.workspace_artifact_id"
    :key="file.workspace_artifact_id"
    :file="file"
    :workspace-name="workspaceName"
    @close="$emit('close')"
  >
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </AIResultPreview>
  <WorkspacePreviewShell
    v-else
    :key="file.fullpath"
    :file="file"
    :workspace-name="workspaceName"
    @close="$emit('close')"
  >
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </WorkspacePreviewShell>
</template>
