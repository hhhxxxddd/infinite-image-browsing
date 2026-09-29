<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceArtifact } from '../api/workspaceArtifacts'
import { workspaceArtifactSourceLabels } from '../model/workspaceArtifactSource'
const props = defineProps<{
  source?: WorkspaceArtifact['source']
  product?: boolean
  inline?: boolean
}>()
const labels = computed(() => workspaceArtifactSourceLabels(props.source))
const visibleLabels = computed(() => (props.product ? ['产物'] : labels.value))
</script>

<template>
  <span class="workspace-source-badges" :class="{ inline }" :title="`产物 · ${labels.join(' · ')}`">
    <small
      v-for="label in visibleLabels"
      :key="label"
      class="workspace-source-badge"
      :class="{ 'product-badge': product }"
      >{{ label }}</small
    >
  </span>
</template>

<style scoped>
.workspace-source-badges {
  position: absolute;
  right: 2px;
  bottom: 2px;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 3px;
  max-width: calc(100% - 4px);
  pointer-events: none;
}
.workspace-source-badge {
  flex: 0 0 auto;
  max-width: 100%;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px 4px;
  border: 1px solid #ffdfa2;
  border-radius: 4px;
  background: #f3ca76;
  color: #48300b;
  box-shadow: 0 1px 4px #0003;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  white-space: nowrap;
}
.workspace-source-badges.inline {
  position: static;
  max-width: 100%;
  justify-content: flex-start;
}
.product-badge {
  padding: 0 4px;
  font-size: 10px;
  font-weight: 650;
  line-height: 16px;
}
</style>
