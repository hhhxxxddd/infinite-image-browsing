import { defineStore } from 'pinia'
import { ref, computed, watch, shallowRef } from 'vue'

export interface MediaPreviewItem {
  url: string
  type: 'image' | 'video' | 'audio'
  id: string
  [key: string]: any // 允许额外的属性
}

export interface MediaPreviewSource {
  loadMore: () => Promise<MediaPreviewItem[]>
  hasMore?: () => boolean
}

export const useMediaPreviewStore = defineStore('useMediaPreviewStore', () => {

  
  // 基本状态
  const visible = ref(false)
  const isFullscreen = ref(false)
  const viewMode = ref<'preview' | 'edit'>('preview')
  const mediaList = ref<MediaPreviewItem[]>([])
  const currentIndex = ref(0)
  const lastActiveId = ref('')
  const source = shallowRef<MediaPreviewSource>()
  const loadingMore = ref(false)
  const exhausted = ref(false)
  const removedIds = new Set<string>()
  let session = 0
  let pendingLoad: Promise<void> | undefined
  
  // 计算属性
  const currentItem = computed(() => {
    return mediaList.value[currentIndex.value] || null
  })

  watch(currentItem, (item) => {
    if (item?.id) {
      lastActiveId.value = item.id
    }
  }, { immediate: true, flush: 'sync' })
  
  const hasNext = computed(() => {
    return currentIndex.value < mediaList.value.length - 1 || (!!source.value && !exhausted.value && (source.value.hasMore?.() ?? true))
  })
  
  const hasPrev = computed(() => {
    return currentIndex.value > 0
  })
  
  // 检测是否为移动设备
  const isMobile = computed(() => {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           window.innerWidth <= 768
  })
  
  // 动作
  const openPreview = (items: MediaPreviewItem[], startIndex = 0, nextSource?: MediaPreviewSource, mode: 'preview' | 'edit' = 'preview') => {
    session++
    removedIds.clear()
    source.value = nextSource
    exhausted.value = false
    loadingMore.value = false
    pendingLoad = undefined
    mediaList.value = items
    currentIndex.value = Math.max(0, Math.min(startIndex, items.length - 1))
    visible.value = true
    viewMode.value = mode
    lastActiveId.value = items[currentIndex.value]?.id ?? lastActiveId.value
    
    // 移动设备自动全屏
    if (isMobile.value) {
      isFullscreen.value = true
    }
  }
  
  const closeView = () => {
    session++
    visible.value = false
    isFullscreen.value = false
    viewMode.value = 'preview'
    source.value = undefined
    loadingMore.value = false
    pendingLoad = undefined
    mediaList.value = []
    currentIndex.value = 0
  }

  const removeMedia = (id: string) => {
    removedIds.add(id)
    const activeId = currentItem.value?.id
    const index = currentIndex.value
    const remaining = mediaList.value.filter(item => item.id !== id)
    mediaList.value = remaining
    if (!remaining.length) { closeView(); return }
    const preservedIndex = remaining.findIndex(item => item.id === activeId)
    currentIndex.value = preservedIndex >= 0 ? preservedIndex : Math.min(index, remaining.length - 1)
  }

  const loadNextPage = (): Promise<void> => {
    if (pendingLoad) return pendingLoad
    if (!source.value || exhausted.value || !(source.value.hasMore?.() ?? true)) return Promise.resolve()
    const currentSession = session
    const loader = source.value
    loadingMore.value = true
    pendingLoad = (async () => {
      try {
        const items = (await loader.loadMore()).filter(item => !removedIds.has(item.id))
        if (currentSession !== session) return
        exhausted.value = loader.hasMore ? !loader.hasMore() : items.length <= mediaList.value.length
        const id = currentItem.value?.id
        mediaList.value = items
        if (id) currentIndex.value = Math.max(0, items.findIndex(item => item.id === id))
      } finally {
        if (currentSession === session) { loadingMore.value = false; pendingLoad = undefined }
      }
    })()
    return pendingLoad
  }
  const next = async () => {
    const currentSession = session
    if (currentIndex.value >= mediaList.value.length - 1) await loadNextPage()
    if (currentSession === session && currentIndex.value < mediaList.value.length - 1) currentIndex.value++
  }

  const prev = () => {
    if (hasPrev.value) {
      currentIndex.value--
    }
  }
  
  const goToIndex = (index: number) => {
    if (index >= 0 && index < mediaList.value.length) {
      currentIndex.value = index
    }
  }
  
  const toggleFullscreen = () => {
    isFullscreen.value = !isFullscreen.value
  }
  
  return {
    // 状态
    visible,
    loadingMore,
    loadNextPage,
    isFullscreen,
    viewMode,
    mediaList,
    currentIndex,
    lastActiveId,
    
    // 计算属性
    currentItem,
    hasNext,
    hasPrev,
    isMobile,
    
    // 动作
    openPreview,
    closeView,
    removeMedia,
    next,
    prev,
    goToIndex,
    toggleFullscreen
  }
})
