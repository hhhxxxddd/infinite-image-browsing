<script setup lang="ts">
import SubstrSearch from './SubstrSearch.vue'
defineProps<{ tabIdx: number; paneIdx: number; searchScope?: string }>()
</script>
<template>
  <SubstrSearch :tab-idx="tabIdx" :pane-idx="paneIdx" :search-scope="searchScope" />
</template>
