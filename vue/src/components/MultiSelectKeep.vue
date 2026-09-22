<script setup lang="ts">
import { useGlobalStore } from '@/store/useGlobalStore'
defineProps<{
  show: boolean
}>()
const emit = defineEmits<{
  selectAll: [],
  reverseSelect: [],
  clearAllSelected: []
}>()
const g = useGlobalStore()

const onExit = () => {
  emit('clearAllSelected')
  g.keepMultiSelect = false
}

const onKeepClick = () => {
  g.keepMultiSelect = true
}


</script>
<template>
  <div class="float-panel" v-if="show">
    <div v-if="g.keepMultiSelect" class="select-actions">
      <a-button size="small" @click="emit('selectAll')">{{ $t('select-all') }}</a-button>
      <a-button size="small" @click="emit('reverseSelect')">{{ $t('rerverse-select') }}</a-button>
      <a-button size="small" @click="emit('clearAllSelected')">{{ $t('clear-all-selected') }}</a-button>
      <a-button size="small" @click="onExit">{{ $t('exit') }}</a-button>
    </div>
    <div v-else>
      <a-button size="small" type="primary" @click="onKeepClick">{{ $t('keep-multi-selected') }}</a-button>
    </div>
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
