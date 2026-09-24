<script setup lang="ts">
import { computed } from 'vue'
import { FolderOutlined, HddOutlined } from '@ant-design/icons-vue'
import { useGlobalStore } from '@/store/useGlobalStore'
import { iconChoices, storedFolderIcon } from './folderIconChoices'

const props = defineProps<{ path: string; root?: boolean }>()
const global = useGlobalStore()
const selected = computed(() => storedFolderIcon(global.folderIcons, props.path, global.conf?.is_win))
const image = computed(() => selected.value?.startsWith('data:image/png;base64,') ? selected.value : '')
const icon = computed(() => iconChoices.find(choice => choice.id === selected.value)?.icon || (props.root ? HddOutlined : FolderOutlined))
</script>

<template>
  <img v-if="image" class="custom-folder-icon" :src="image" alt="" draggable="false" />
  <component :is="icon" v-else />
</template>

<style scoped>
.custom-folder-icon { width: 1.35em; height: 1.35em; object-fit: contain; vertical-align: middle; flex: none; }
</style>
