<script setup lang="ts">
import MediaComparisonComparePane from './MediaComparisonComparePane.vue'
import { FileNodeInfo } from '@/features/media-library/public'
defineProps<{
  paneIdx: number
  tabIdx: number
  left: FileNodeInfo
  right: FileNodeInfo
}>()
</script>
<template>
  <div class="img-sli-container">
    <MediaComparisonComparePane :left="left" :right="right"> </MediaComparisonComparePane>
  </div>
</template>

<style lang="scss" scoped>
.img-sli-container {
  position: relative;
  overflow-y: auto;
  height: 100%;
}
</style>
