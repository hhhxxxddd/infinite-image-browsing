<script setup lang="ts">
defineProps<{ fileNum: number; selectedFileNum?: number }>()

</script>
<template>
  <div class="base-info">
    <span>{{ $t('items', [fileNum]) }}
      <template v-if="selectedFileNum">,  {{ $t('selectedItems', [selectedFileNum]) }}</template>
    </span>
  </div>
</template>
<style lang="scss" scoped>
.base-info {
  position: relative;
  flex-shrink: 0;
  padding: 8px 24px;
  font-size: .8em;
  background: var(--zp-primary-background);
  color: var(--zp-primary);
  border-top: 1px solid var(--zp-border);
}
</style>
