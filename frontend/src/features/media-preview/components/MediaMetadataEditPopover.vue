<script setup lang="ts">
import type { UnwrapNestedRefs } from 'vue'
import type { usePreviewMetadata } from '../composables/usePreviewMetadata'
import MediaMetadataEditForm from './MediaMetadataEditForm.vue'

const props = defineProps<{
  session: UnwrapNestedRefs<ReturnType<typeof usePreviewMetadata>>
  open: boolean
  kind: 'description' | 'reference' | 'generation'
}>()
const emit = defineEmits<{ dismiss: [] }>()
function popupContainer() {
  return document.fullscreenElement instanceof HTMLElement
    ? document.fullscreenElement
    : document.body
}
function openChanged(open: boolean) {
  if (!open && props.open) emit('dismiss')
}
</script>

<template>
  <a-popover
    :open="open"
    trigger="click"
    placement="bottomRight"
    overlay-class-name="preview-metadata-edit-popover"
    :get-popup-container="popupContainer"
    :z-index="1010"
    destroy-tooltip-on-hide
    @open-change="openChanged"
  >
    <template #content>
      <MediaMetadataEditForm v-if="open" :session="session" :kind="kind" />
    </template>
    <slot />
  </a-popover>
</template>
