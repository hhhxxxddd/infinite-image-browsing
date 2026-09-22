<script setup lang="ts">
defineProps<{ show: boolean }>()
const emit = defineEmits<{ selectAll: []; reverseSelect: []; clearAllSelected: [] }>()
</script>
<template>
  <div class="float-panel select-actions" v-if="show">
    <a-button size="small" @click="emit('selectAll')">全选已加载</a-button>
    <a-button size="small" @click="emit('reverseSelect')">反选</a-button>
    <a-button size="small" @click="emit('clearAllSelected')">取消选择</a-button>
  </div>
</template>
<style lang="scss" scoped>
.select-actions > :not(:last-child)  {
  margin-right: 4px;
}
.float-panel {
  position: relative;
  flex-shrink: 0;
  background: var(--zp-primary-background);
  border-radius: 4px;
  padding: 8px 24px;
  border-bottom: 1px solid var(--zp-border);
}
.select-actions {display:flex;flex-wrap:wrap;gap:8px;}
</style>
