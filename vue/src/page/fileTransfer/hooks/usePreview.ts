import { provide, watch } from 'vue'
import { mediaPreviewKey } from '@/util/mediaPreviewContext'
import { filesToPreviewItems, openPreviewWithFiles } from '@/util/mediaPreview'
import { useMediaPreviewStore } from '@/store/useMediaPreviewStore'
import { useHookShareState } from '.'

/**
 * 连接列表与统一媒体预览，并在关闭时恢复列表位置。
 */
export function usePreview (spec?: { loadNext?: () => unknown; hasMore?: () => boolean }) {
  const {
    previewIdx,
    canLoadNext,
    sortedFiles: files,
    scroller
  } = useHookShareState().toRefs()
  const { state } = useHookShareState()
  const viewer = useMediaPreviewStore()
  let ownsPreview = false
  const openPreview = (idx = 0, mode: 'preview' | 'edit' = 'preview') => {
    ownsPreview = true
    const canLoad = !!spec?.loadNext || !!state.walker
    openPreviewWithFiles(files.value, idx, canLoad ? {
      hasMore: spec?.hasMore ?? (() => canLoadNext.value),
      loadMore: async () => {
        if (spec?.loadNext) await spec.loadNext()
        else await state.walker?.next()
        return filesToPreviewItems(files.value)
      }
    } : undefined, mode)
  }
  provide(mediaPreviewKey, openPreview)
  watch(() => viewer.visible, visible => {
    if (visible || !ownsPreview) return
    ownsPreview = false
    const idx = files.value.findIndex(file => file.fullpath === viewer.lastActiveId)
    if (idx >= 0) { previewIdx.value = idx; scrollToIndex(idx) }
  })
  const scrollToIndex = (idx: number) => {
    const s = scroller.value
    if (!s || idx < 0) return
    if (!(idx >= s.findItemIndex(s.getScroll().start) && idx <= s.findItemIndex(s.getScroll().end))) {
      s.scrollToItem(idx)
    }
  }

  const scrollToFileId = (fullpath: string) => {
    if (!fullpath) return
    const idx = files.value.findIndex(v => v.fullpath === fullpath)
    if (idx >= 0) {
      scrollToIndex(idx)
    }
  }

  return {
    openPreview,
    previewIdx,
    scrollToIndex,
    scrollToFileId
  }
}
