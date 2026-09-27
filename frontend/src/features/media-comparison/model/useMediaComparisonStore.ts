import { FileNodeInfo } from '@/features/media-library/public'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useApplicationStore } from '@/features/application/public'
export const useMediaComparisonStore = defineStore('useMediaComparisonStore', () => {
  const fileDragging = ref(false)
  const drawerVisible = ref(false)
  const opened = ref(false)
  const left = ref<FileNodeInfo>()
  const right = ref<FileNodeInfo>()
  const viewMode = ref<'compare' | 'grid'>('compare')
  const gridFiles = ref<FileNodeInfo[]>([])
  const gridSize = ref<4 | 6 | 9>(4)
  function openComparison(files?: FileNodeInfo[]) {
    if (files?.length === 2) [left.value, right.value] = files
    viewMode.value = 'compare'
    drawerVisible.value = true
  }
  function openGrid(files: FileNodeInfo[]) {
    gridFiles.value = files.slice(0, 9)
    if (gridFiles.value.length >= 2) [left.value, right.value] = gridFiles.value
    gridSize.value = files.length <= 4 ? 4 : files.length <= 6 ? 6 : 9
    viewMode.value = 'grid'
    drawerVisible.value = true
  }
  const global = useApplicationStore()
  const imgSliActived = computed(() => {
    const tabs = global.tabList
    for (const iter of tabs) {
      if (iter.panes.find((v) => v.key === iter.key)?.type === 'img-sli') {
        return true
      }
    }
    return false
  })
  return {
    drawerVisible,
    fileDragging,
    left,
    right,
    viewMode,
    gridFiles,
    gridSize,
    openComparison,
    openGrid,
    imgSliActived,
    opened
  }
})

if (import.meta.hot)
  import.meta.hot.accept(acceptHMRUpdate(useMediaComparisonStore, import.meta.hot))
