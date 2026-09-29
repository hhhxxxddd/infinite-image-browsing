<script setup lang="ts">
import type { FileNodeInfo } from '@/features/media-library/api/files'
import MediaAssetPreview from '@/features/media-preview/components/MediaAssetPreview.vue'

defineProps<{ file: FileNodeInfo; workspaceName?: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <MediaAssetPreview :file="file" :workspace-name="workspaceName" @close="$emit('close')">
    <template v-if="$slots.actions" #actions="context"
      ><slot name="actions" v-bind="context"
    /></template>
    <template v-if="$slots['more-actions']" #more-actions="context">
      <slot name="more-actions" v-bind="context" />
    </template>
  </MediaAssetPreview>
</template>
