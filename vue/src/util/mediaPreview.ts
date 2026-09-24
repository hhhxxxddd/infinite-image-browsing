import type { FileNodeInfo } from '@/api/files'
import type { MediaPreviewItem, MediaPreviewSource } from '@/store/useMediaPreviewStore'
import { useMediaPreviewStore } from '@/store/useMediaPreviewStore'
import { isVideoFile, isImageFile, isAudioFile } from '@/util'
import { toRawFileUrl, toStreamVideoUrl, toStreamAudioUrl } from '@/util/file'

/**
 * 将 FileNodeInfo 转换为 MediaPreviewItem
 */
export const fileToPreviewItem = (file: FileNodeInfo): MediaPreviewItem => {
  const isVideo = isVideoFile(file.name)
  const isAudio = isAudioFile(file.name)
  
  let url: string
  let type: 'image' | 'video' | 'audio'
  
  if (isVideo) {
    url = toStreamVideoUrl(file)
    type = 'video'
  } else if (isAudio) {
    url = toStreamAudioUrl(file)
    type = 'audio'
  } else {
    url = toRawFileUrl(file)
    type = 'image'
  }
  
  return {
    id: file.fullpath,
    url,
    type,
    // 保留原始文件信息以供后续使用
    originalFile: file,
    name: file.name,
    fullpath: file.fullpath
  }
}

/**
 * 将 FileNodeInfo 数组转换为 MediaPreviewItem 数组，只包含媒体文件
 */
export const filesToPreviewItems = (files: FileNodeInfo[]): MediaPreviewItem[] => {
  return files
    .filter(file => file.type === 'file' && (isImageFile(file.name) || isVideoFile(file.name) || isAudioFile(file.name)))
    .map(fileToPreviewItem)
}

/**
 * 从 URL 列表直接创建 MediaPreviewItem 数组
 */
export const urlsToPreviewItems = (urls: string[]): MediaPreviewItem[] => {
  return urls.map((url) => {
    let type: 'image' | 'video' | 'audio' = 'image'
    if (isVideoFile(url)) {
      type = 'video'
    } else if (isAudioFile(url)) {
      type = 'audio'
    }
    return {
      id: url,
      url: url,
      type
    }
  })
}

/**
 * 从文件列表打开媒体预览
 */
export const openPreviewWithFiles = (files: FileNodeInfo[], startIndex = 0, source?: MediaPreviewSource, mode: 'preview' | 'edit' = 'preview') => {
  startIndex = Math.min(startIndex, files.length - 1)
  startIndex = Math.max(startIndex, 0)
  const previewStore = useMediaPreviewStore()
  const items = filesToPreviewItems(files)
  
  if (items.length === 0) {
    console.warn('没有找到可以显示的媒体文件')
    return
  }
  
  // 调整起始索引，确保对应正确的媒体文件
  let adjustedStartIndex = 0
  if (startIndex < files.length) {
    const targetFile = files[startIndex]
    adjustedStartIndex = items.findIndex(item => item.id === targetFile.fullpath)
    if (adjustedStartIndex === -1) {
      adjustedStartIndex = 0
    }
  }
  
  previewStore.openPreview(items, adjustedStartIndex, source, mode)
}

/**
 * 从 URL 列表打开媒体预览
 */
export const openPreviewWithUrls = (urls: string[], startIndex = 0) => {
  const previewStore = useMediaPreviewStore()
  const items = urlsToPreviewItems(urls)
  
  if (items.length === 0) {
    console.warn('没有找到可以显示的媒体URL')
    return
  }
  
  previewStore.openPreview(items, startIndex)
}

/**
 * 预览单个文件
 */
export const openPreviewWithFile = (file: FileNodeInfo) => {
  openPreviewWithFiles([file], 0)
}

/**
 * 预览单个 URL
 */
export const openPreviewWithUrl = (url: string) => {
  openPreviewWithUrls([url], 0)
}
