import { createReactiveQueue } from '@/shared/composables/useReactiveQueue'
import { identity } from 'lodash-es'
import { reactive, computed } from 'vue'
import {
  useHookShareState,
  useMobileOptimization,
  useEventListen
} from '@/features/media-library/composables/folderBrowserContext'
import { useFilesDisplay } from '@/features/media-library/composables/useFilesDisplay'
import { useFileTransfer } from '@/features/media-library/composables/useFileTransfer'
import { useFileItemActions } from '@/features/media-library/composables/useFileItemActions'
import { usePreview } from '@/features/media-library/composables/usePreview'
import { makeAsyncIterator } from 'vue3-ts-util'
import { getImagesBySubstr } from '@/features/media-library/api/library'

export const createImageSearchIter = (
  fetchfn: (cursor: string) => ReturnType<typeof getImagesBySubstr>
) => {
  return reactive(
    makeAsyncIterator(fetchfn, (v) => v.files, {
      dataUpdateStrategy: 'merge'
    })
  )
}

export const useImageSearch = (
  iter: Pick<ReturnType<typeof createImageSearchIter>, 'res' | 'load' | 'next'>,
  displayOptions: { fillGridWidth?: boolean; horizontalPadding?: number } = {}
) => {
  const deletedImagePaths = reactive(new Set<string>())
  const images = computed(() => (iter.res ?? []).filter((v) => !deletedImagePaths.has(v.fullpath)))
  const queue = createReactiveQueue()
  const { stackViewEl, multiSelectedIdxs, stack, scroller, props } = useHookShareState({
    images
  }).toRefs()
  const { itemSize, gridItems, cellWidth, onScroll } = useFilesDisplay({
    fetchNext: () => iter.next(),
    ...displayOptions
  })
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
    loadNext: () => iter.next(),
    hasMore: () => !iter.load
  })

  const onContextMenuClickU: typeof onContextMenuClick = async (e, file, idx) => {
    stack.value = [{ curr: '', files: images.value }] // hack，for delete multi files
    await onContextMenuClick(e, file, idx)
  }

  useEventListen('removeFiles', async ({ paths }) => {
    paths.forEach((v) => deletedImagePaths.add(v))
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
