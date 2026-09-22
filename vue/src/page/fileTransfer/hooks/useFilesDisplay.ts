import { useElementSize } from '@vueuse/core'
import { ref, computed, watch, reactive } from 'vue'
import { Top4MediaInfo, batchGetDirTop4MediaInfo } from '@/api'
import {
  delay} from 'vue3-ts-util'
import { sortMethodConv } from '../fileSort'
import { debounce } from 'lodash-es'
import { isMediaFile } from '@/util/file'
import { useHookShareState, global, tagStore } from '.'
import { makeAsyncFunctionSingle } from '@/util'

export function useFilesDisplay ({ fetchNext }: {fetchNext?: () => Promise<any>} = {  }) {
  const {
    scroller,
    sortedFiles,
    sortMethod,
    currLocation,
    currPage,
    stackViewEl,
    canLoadNext,
    props,
    walker,
    getViewableAreaFiles
  } = useHookShareState().toRefs()
  const { state } = useHookShareState()
  const moreActionsDropdownShow = ref(false)
  const requestedCellWidth = ref(global.defaultGridCellWidth)
  const { width } = useElementSize(stackViewEl)
  const { width: listWidth } = useElementSize(computed(() => scroller.value?.$el as HTMLElement | undefined))
  // Measure the grid itself: the page also contains padding, sidebars and scrollbars.
  const availableWidth = computed(() => listWidth.value || Math.max(0, width.value - 48))
  const cellWidth = computed({
    get: () => Math.min(requestedCellWidth.value, Math.max(64, availableWidth.value - 16)),
    set: (value: number) => { requestedCellWidth.value = value }
  })
  const gridSize = computed(() => cellWidth.value + 16) // margin 8
  const gridItems = computed(() => Math.max(1, Math.floor(availableWidth.value / gridSize.value)))
  const dirCoverCache = reactive(new Map<string, Top4MediaInfo[]>())

  const itemSize = computed(() => {
    const second = gridSize.value
    const first = second

    return {
      first,
      second
    }
  })

  const loadNextDirLoading = ref(false)

  const loadNextDir = async () => {
    if (loadNextDirLoading.value || props.value.mode !== 'walk' || !canLoadNext.value) {
      return
    }
    try {
      loadNextDirLoading.value = true
      await walker.value?.next()
    } finally {
      loadNextDirLoading.value = false
    }
  }

  // 填充够一页，直到不行为止
  const fetchDataUntilViewFilled = async () => {
    const s = scroller.value
    const currIdx = () => ((s ? s.findItemIndex(s.getScroll().end) : undefined) ?? 0)
    const needLoad = () => {
      const len = sortedFiles.value.length
      const preload = 50
      if (!len) {
        return true
      }
      if (fetchNext) {
        return currIdx() > len - preload
      }
      return currIdx() > len - preload && canLoadNext.value // canLoadNext 是walker的，表示加载完成
    }
    while (needLoad()) {
      await delay(30)
      const ret = await (fetchNext ?? loadNextDir)()
      if (typeof ret === 'boolean' && !ret) {
        return // 返回false同样表示加载完成
      }
    }
  }

  state.useEventListen('loadNextDir', makeAsyncFunctionSingle(async () => {
    await fetchDataUntilViewFilled()
    if (props.value.mode === 'walk') {
      onViewableAreaChangeDebounced()
    }
  }))

  state.useEventListen('viewableAreaFilesChange', () => {
    const files = getViewableAreaFiles.value()
    const fetchTagPaths = files
      .filter(v => v.is_under_scanned_path && isMediaFile(v.name))
      .map(v => v.fullpath)
    tagStore.fetchImageTags(fetchTagPaths)
    const fetchDirTop4MediaPaths = files
      .filter(v => v.is_under_scanned_path && v.type === 'dir' && !dirCoverCache.has(v.fullpath))
      .map(v => v.fullpath)
    if (fetchDirTop4MediaPaths.length) {
      batchGetDirTop4MediaInfo(fetchDirTop4MediaPaths).then(v => {
        for (const key in v) {
          if (Object.prototype.hasOwnProperty.call(v, key)) {
            const element = v[key];
            dirCoverCache.set(key, element)
          }
        }
      })
    }
  })

  state.useEventListen('refresh', async () => {
    state.eventEmitter.emit('viewableAreaFilesChange')
  })

  const onViewableAreaChangeDebounced = debounce(() => state.eventEmitter.emit('viewableAreaFilesChange'), 300)
  watch(currLocation, onViewableAreaChangeDebounced)

  const onScroll = debounce(async () => {
    const s = scroller.value
    if (s && currPage.value) {
      currPage.value.scrollIndex = s.findItemIndex(s.getScroll().start)
    }
    await fetchDataUntilViewFilled()
    onViewableAreaChangeDebounced()
  }, 150)

  return {
    gridItems,
    sortedFiles,
    sortMethodConv,
    moreActionsDropdownShow,
    gridSize,
    sortMethod,
    onScroll,
    loadNextDir,
    loadNextDirLoading,
    canLoadNext,
    itemSize,
    cellWidth,
    dirCoverCache
  }
}
