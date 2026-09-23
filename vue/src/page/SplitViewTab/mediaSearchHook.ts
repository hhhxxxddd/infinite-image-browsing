import { createReactiveQueue } from '@/util'
import { identity } from 'lodash-es'
import { reactive, computed } from 'vue'
import {
  useHookShareState,
  useFilesDisplay,
  useMobileOptimization,
  useFileTransfer,
  useFileItemActions,
  usePreview,
  useEventListen
} from '../fileTransfer/hook'
import { makeAsyncIterator } from 'vue3-ts-util'
import { getImagesBySubstr } from '@/api/db'

export const createImageSearchIter = (
  fetchfn: (cursor: string) => ReturnType<typeof getImagesBySubstr>
) => {
  return reactive(makeAsyncIterator(fetchfn, (v) => v.files, {
    dataUpdateStrategy: 'merge'
  }))
}

export const useImageSearch = (iter: Pick<ReturnType<typeof createImageSearchIter>, 'res' | 'load' | 'next'>, displayOptions: {fillGridWidth?: boolean; horizontalPadding?: number} = {}) => {
  const deletedImagePahts = reactive(new Set<string>())
  const images = computed(() => (iter.res ?? []).filter((v) => !deletedImagePahts.has(v.fullpath)))
  const queue = createReactiveQueue()
  const { stackViewEl, multiSelectedIdxs, stack, scroller, props } = useHookShareState({
    images: images as any
  }).toRefs()
  const { itemSize, gridItems, cellWidth, onScroll } = useFilesDisplay({ fetchNext: () => iter.next(), ...displayOptions })
  const { showMenuIdx } = useMobileOptimization()
  const { onFileDragStart, onFileDragEnd } = useFileTransfer()
  const {
    showGenInfo,
    imageGenInfo,
    q: genInfoQueue,
    onContextMenuClick,
    onFileItemClick
  } = useFileItemActions({ openNext: identity })
  const { openPreview, previewIdx } = usePreview({
    loadNext: () => iter.next(), hasMore: () => !iter.load
  })

  const onContextMenuClickU: typeof onContextMenuClick = async (e, file, idx) => {
    stack.value = [{ curr: '', files: images.value! }] // hack，for delete multi files
    await onContextMenuClick(e, file, idx)
  }

  useEventListen('removeFiles', async ({ paths }) => {
    paths.forEach((v) => deletedImagePahts.add(v))
  })

  return {
    openPreview,
    images,
    scroller,
    queue,
    iter,
    onContextMenuClickU,
    stackViewEl,
    previewIdx,
    itemSize,
    gridItems,
    showGenInfo,
    imageGenInfo,
    q: genInfoQueue,
    onContextMenuClick,
    onFileItemClick,
    showMenuIdx,
    multiSelectedIdxs,
    onFileDragStart,
    onFileDragEnd,
    cellWidth,
    onScroll,
    props
  }
}
