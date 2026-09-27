<script setup lang="ts">
import MediaDetailsPanel from './MediaDetailsPanel.vue'
import { usePreviewMetadata } from '../composables/usePreviewMetadata'

import {
  ref,
  computed,
  defineAsyncComponent,
  onMounted,
  onUnmounted,
  onBeforeUpdate,
  nextTick,
  watch,
  reactive
} from 'vue'
import {
  useMediaPreviewStore,
  type MediaPreviewItem
} from '@/features/media-preview/model/useMediaPreviewStore'
import { useTagStore } from '@/features/media-library/public'
import { useApplicationStore } from '@/features/application/public'
import { useLocalStorage, onLongPress } from '@vueuse/core'

import { openWithAppPicker } from '@/features/media-library/public'

const MediaImageEditor = defineAsyncComponent(() => import('./MediaImageEditor.vue'))
import '../styles/previewPanels.css'
import '../../generation-metadata/styles/generationPanel.css'

import MediaPreviewToolbar, { type PreviewToolbarAction } from './MediaPreviewToolbar.vue'
import { usePreviewImageView } from '../composables/usePreviewImageView'
import { fileToPreviewItem } from '@/features/media-preview/model/mediaPreview'
import type { FileNodeInfo } from '@/features/media-library/public'
import { globalEvents } from '@/features/application/public'
import {
  downloadFiles,
  toRawFileUrl,
  toVideoCoverUrl,
  invalidateFileUrls
} from '@/features/media-library/public'

import { message, Modal } from 'ant-design-vue'
import { deleteFiles } from '@/features/media-library/public'
import { getParentDirectory } from '@/shared/lib/path'
import GenerationInfoEditor from '@/features/generation-metadata/components/GenerationInfoEditor.vue'
import { UpOutlined, DownOutlined } from '@/shared/icons/index'

import type { StyleValue } from 'vue'
import { throttle } from 'lodash-es'
import { getShortcutStrFromEvent, matchBrowseShortcut } from '@/shared/lib/shortcut'
import { isAnimatedImage, mayBeAnimatedImage } from '@/features/media-library/public'
import { isTauri } from '@/shared/lib/env'
import {
  audioCoverUrl,
  getAudioMetadata,
  type AudioMetadata
} from '@/features/media-library/public'
import { CustomerServiceOutlined } from '@ant-design/icons-vue'

const previewStore = useMediaPreviewStore()
const tagStore = useTagStore()
const global = useApplicationStore()

// 使用 @vueuse 存储用户声音偏好
const isMuted = useLocalStorage('omnigallery:preview:muted', true) // 默认静音
const showDescriptionOverlay = useLocalStorage('omnigallery:preview:description-overlay', false)
const detailsOpen = useLocalStorage('omnigallery:preview:details-open', true)
const previewToolbar = ref<InstanceType<typeof MediaPreviewToolbar>>()
function toggleDetails() {
  detailsOpen.value = !detailsOpen.value
  controlsVisible.value = true
  void nextTick(() => {
    if (!detailsOpen.value) previewToolbar.value?.focusDetails()
    if (containerRef.value) containerRef.value.scrollLeft = 0
  })
}
type DetailsTab = 'description' | 'generation' | 'metadata'
const activeDetailsTab = ref<DetailsTab>('description')

// 引用
const containerRef = ref<HTMLElement>()
const viewportRef = ref<HTMLElement>()
const {
  imageSizes,
  zoom,
  resetImageView,
  setZoom,
  rotateImage,
  measureImage,
  imageStyle,
  startPan,
  movePan,
  endPan
} = usePreviewImageView(viewportRef)
const videoInfo = reactive(new Map<string, { width: number; height: number; duration: number }>())
const previewErrors = reactive(new Map<string, string>())
const isCurrentAnimatedImage = ref(false)
const motionResolved = ref(false)
function handleToolbarAction(action: PreviewToolbarAction) {
  if (editingImage.value) {
    if (action === 'edit' || action === 'close') mediaEditor.value?.requestExit()
    else if (action === 'fullscreen') void handleFullscreenToggle()
    return
  }
  switch (action) {
    case 'fullscreen':
      void handleFullscreenToggle()
      break
    case 'like':
      void toggleLike()
      break
    case 'download':
      downloadCurrent()
      break
    case 'edit':
      if (canEditCurrentImage.value) previewStore.viewMode = 'edit'
      break
    case 'reset':
      resetImageView()
      break
    case 'rotate-left':
      rotateImage(-90)
      break
    case 'rotate-right':
      rotateImage(90)
      break
    case 'description':
      showDescriptionOverlay.value = !showDescriptionOverlay.value
      break
    case 'details':
      toggleDetails()
      break
    case 'mute':
      toggleMute()
      break
    case 'delete':
      void deleteCurrent()
      break
    case 'close':
      previewStore.closeView()
      break
  }
}
function imageLoaded(event: Event, item: MediaPreviewItem) {
  measureImage(item.url, event)
  previewErrors.delete(item.id)
}
function downloadCurrent() {
  if (confirmingDownload.value) return
  const item = currentItem.value
  const url = item?.originalFile ? toRawFileUrl(item.originalFile, true) : item?.url
  if (!url) return
  confirmingDownload.value = true
  Modal.confirm({
    title: '下载当前文件？',
    content: item?.name || '确认下载此文件',
    okText: '下载',
    onOk: () => {
      try {
        downloadFiles([url])
      } finally {
        confirmingDownload.value = false
      }
    },
    onCancel: () => {
      confirmingDownload.value = false
    }
  })
}

const videoRefs = ref<(HTMLVideoElement | null)[]>([null, null, null]) // 视频元素引用
const audioRefs = ref<(HTMLAudioElement | null)[]>([null, null, null]) // 音频元素引用
const audioDetails = ref<AudioMetadata>()
const audioArtworkAvailable = ref(false)
const currentAudioTime = ref(0)
const lyricList = ref<HTMLElement>()

// 3位buffer状态管理
const bufferItems = ref<(MediaPreviewItem | null)[]>([null, null, null]) // [prev, current, next]

const currentItem = computed(() => bufferItems.value[1]) // 中间位置是当前显示的项目
const metadata = usePreviewMetadata(currentItem)
const metadataView = reactive(metadata)
const {
  imageGenInfo,
  promptLoading,
  promptError,
  editorOpen,
  editTarget,
  imageDescription,
  descriptionEditing,
  aiDescriptionOpen,
  aiPromptEditing,
  aiPromptOpen,
  inlineField,
  addGenerationFieldOpen,
  imageExif,
  likeTag,
  isLiked,
  toggleLike,
  onTagClick,
  loadCurrentArtifactMetadata,
  loadCurrentItemTags,
  loadCurrentItemPrompt,
  loadCurrentItemDescription,
  loadCurrentItemMetadata,
  loadInferredPrompt,
  refreshAiPromptDefault,
  resetMetadataSession,
  isWorkspaceArtifact
} = metadata
const bufferTransform = ref(0) // 当前显示位置的偏移
let navigationRequest = 0
const isAnimating = ref(false) // 是否正在动画中
const touchStartY = ref(0)
const touchCurrentY = ref(0)
const isDragging = ref(false)
const dragOffset = ref(0) // 拖拽偏移量

// TAG 相关状态
const confirmingDelete = ref(false)
const confirmingDownload = ref(false)
const editingImage = computed(
  () =>
    previewStore.viewMode === 'edit' &&
    previewStore.currentItem?.type === 'image' &&
    !!previewStore.currentItem.originalFile &&
    !previewStore.currentItem.originalFile.workspace_artifact_id
)
const mediaEditor = ref<InstanceType<typeof MediaImageEditor>>()
const interactionBlocked = computed(
  () =>
    editorOpen.value ||
    descriptionEditing.value ||
    aiPromptEditing.value ||
    !!inlineField.value ||
    addGenerationFieldOpen.value ||
    aiPromptOpen.value ||
    aiDescriptionOpen.value ||
    confirmingDelete.value ||
    confirmingDownload.value ||
    editingImage.value
)

// 控件可见性状态（长按切换）
const controlsVisible = ref(true)

// 长按切换控件可见性
const toggleControlsVisibility = () => {
  controlsVisible.value = !controlsVisible.value
}

// 计算属性
const currentLyricIndex = computed(() => {
  const lyrics = audioDetails.value?.lyrics
  if (!lyrics?.timed) return -1
  let active = -1
  lyrics.lines.forEach((line, index) => {
    if ((line.time ?? Infinity) <= currentAudioTime.value) active = index
  })
  return active
})
watch(
  () => currentItem.value?.id,
  async (_, __, onCleanup) => {
    audioDetails.value = undefined
    audioArtworkAvailable.value = false
    currentAudioTime.value = 0
    const file = currentItem.value?.originalFile
    if (currentItem.value?.type !== 'audio' || !file) return
    let canceled = false
    onCleanup(() => {
      canceled = true
    })
    try {
      const details = await getAudioMetadata(file.fullpath)
      if (!canceled) {
        audioDetails.value = details
        audioArtworkAvailable.value = details.has_cover
      }
    } catch {
      /* Audio playback remains available without parsed tags. */
    }
  },
  { immediate: true }
)
watch(currentLyricIndex, async (index) => {
  if (index < 0) return
  await nextTick()
  const list = lyricList.value
  const line = list?.querySelector<HTMLElement>(`[data-lyric-index="${index}"]`)
  if (list && line)
    list.scrollTo({
      top: line.offsetTop - list.offsetTop - list.clientHeight / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    })
})
function seekAudio(time?: number) {
  const audio = audioRefs.value[1]
  if (audio && time !== undefined && Number.isFinite(time)) audio.currentTime = time
}
const currentPreviewError = computed(() => previewErrors.get(currentItem.value?.id ?? '') ?? '')
const canEditCurrentImage = computed(
  () =>
    currentItem.value?.type === 'image' &&
    !!currentItem.value.originalFile &&
    !isWorkspaceArtifact.value &&
    /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(currentItem.value.name || '') &&
    !global.conf?.is_readonly &&
    (!mayBeAnimatedImage(currentItem.value.name || '') ||
      (motionResolved.value && !isCurrentAnimatedImage.value))
)
watch(
  () => currentItem.value?.id,
  async (_id, _, onCleanup) => {
    isCurrentAnimatedImage.value = false
    motionResolved.value = false
    const item = currentItem.value
    if (
      item?.type !== 'image' ||
      !item.originalFile ||
      item.originalFile.workspace_artifact_id ||
      !mayBeAnimatedImage(item.name || '')
    )
      return
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    try {
      const animated = await isAnimatedImage(item.originalFile)
      if (!cancelled) isCurrentAnimatedImage.value = animated
    } catch {
      /* Keep ordinary image viewing available if the probe fails. */
    } finally {
      if (!cancelled) motionResolved.value = true
    }
  },
  { immediate: true }
)
function onVideoMetadata(item: MediaPreviewItem, event: Event) {
  const video = event.target as HTMLVideoElement
  videoInfo.set(item.id, {
    width: video.videoWidth,
    height: video.videoHeight,
    duration: video.duration
  })
  previewErrors.delete(item.id)
}
function onPreviewError(item: MediaPreviewItem) {
  previewErrors.set(
    item.id,
    `${item.type === 'video' ? '视频' : item.type === 'audio' ? '音频' : '图片'}无法在内置预览中解码或读取。`
  )
}
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return ''
  const total = Math.floor(seconds)
  return `${Math.floor(total / 3600) ? `${Math.floor(total / 3600)}:` : ''}${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
async function openCurrentInLocalApp() {
  const path = currentItem.value?.originalFile?.fullpath
  if (!path || isWorkspaceArtifact.value) return
  try {
    await openWithAppPicker(path)
  } catch {
    message.error('无法使用本机应用打开此文件')
  }
}
function editorSaved(file: FileNodeInfo, overwrite: boolean) {
  const index = previewStore.currentIndex + (overwrite ? 0 : 1)
  if (overwrite) invalidateFileUrls(file.fullpath)
  const item = fileToPreviewItem(file)
  previewStore.mediaList.splice(index, overwrite ? 1 : 0, item)
  previewStore.goToIndex(index)
  if (overwrite) {
    resetImageView()
    void loadCurrentItemMetadata(true)
    void tagStore.refreshTags([file.fullpath])
  }
  globalEvents.emit('imageCreated', file.fullpath)
  globalEvents.emit('refreshFileView', { paths: [getParentDirectory(file.fullpath)] })
}
const fileDetails = computed(() => {
  const item = currentItem.value
  if (!item) return []
  const file = item.originalFile || item
  const artifact = !!file.workspace_artifact_id
  const imageSize = imageSizes.get(item.url)
  const video = videoInfo.get(item.id)
  return [
    {
      label: '媒体类型',
      value:
        item.type === 'video'
          ? '视频'
          : item.type === 'audio'
            ? '音频'
            : isCurrentAnimatedImage.value
              ? '动图'
              : '图片'
    },
    ...(item.type === 'audio'
      ? [
          { label: '标题', value: audioDetails.value?.title || '' },
          { label: '艺术家', value: audioDetails.value?.artist || '' },
          { label: '专辑', value: audioDetails.value?.album || '' }
        ]
      : []),
    { label: '文件名', value: item.name || file.name },
    ...(artifact
      ? [
          {
            label: '来源',
            value:
              file.workspace_artifact_source === 'ai_image_edit'
                ? '工作区 · AI 加工'
                : file.workspace_artifact_source === 'image_studio'
                  ? '工作区 · 图片制作'
                  : '工作区创建'
          }
        ]
      : [{ label: '文件路径', value: item.fullpath || file.fullpath || item.id }]),
    { label: '文件大小', value: file.size || (file.bytes ? `${file.bytes} B` : '') },
    ...(!artifact ? [{ label: '修改时间', value: file.date || '' }] : []),
    {
      label: '创建时间',
      value:
        artifact && file.created_time && !Number.isNaN(Date.parse(file.created_time))
          ? new Date(file.created_time).toLocaleString('zh-CN')
          : file.created_time || ''
    },
    {
      label: item.type === 'video' ? '视频尺寸' : '图片尺寸',
      value:
        item.type === 'audio'
          ? ''
          : video?.width && video?.height
            ? `${video.width} × ${video.height}`
            : imageSize
              ? `${imageSize.width} × ${imageSize.height}`
              : ''
    },
    {
      label: '时长',
      value: video
        ? formatDuration(video.duration)
        : item.type === 'audio' && audioDetails.value?.duration
          ? formatDuration(audioDetails.value.duration)
          : ''
    }
  ].filter((entry) => entry.value)
})
const exifDetails = computed(() =>
  Object.entries(imageExif.value).map(([label, value]) => ({ label, value }))
)

const containerClass = computed(() => {
  return {
    'preview-viewer': true,
    'preview-viewer--cropping': editingImage.value,
    'preview-viewer--details-collapsed': !detailsOpen.value,
    'preview-viewer--fullscreen': previewStore.isFullscreen,
    'preview-viewer--floating': !previewStore.isFullscreen,
    'preview-viewer--mobile': previewStore.isMobile
  }
})

// 计算每个buffer项的样式
const getItemStyle = (index: number): StyleValue => {
  const baseTransform = (index - 1) * 100 // -100%, 0%, 100%
  const currentTransform = bufferTransform.value + dragOffset.value
  const totalTransform = baseTransform + currentTransform

  return {
    transform: `translateY(${totalTransform}%)`,
    transition:
      isAnimating.value && !isDragging.value
        ? 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
        : 'none'
  }
}

// 控制视频播放
const controlVideoPlayback = async () => {
  if (!previewStore.visible) return
  // 控制视频
  for (let index = 0; index < videoRefs.value.length; index++) {
    const video = videoRefs.value[index]
    if (!video) continue

    try {
      if (index === 1) {
        // 当前显示的视频：自动播放
        video.currentTime = 0 // 重置到开头
        video.muted = isMuted.value // 根据用户偏好设置静音状态

        await video.play()
      } else {
        // 相邻视频只保留切换所需的节点，不触发额外的媒体读取。
        video.pause()
      }
    } catch (err) {
      console.warn(`视频播放控制失败 (index: ${index}):`, err)
    }
  }

  // 控制音频
  for (let index = 0; index < audioRefs.value.length; index++) {
    const audio = audioRefs.value[index]
    if (!audio) continue

    try {
      if (index === 1) {
        // 当前显示的音频：自动播放
        audio.currentTime = 0 // 重置到开头
        audio.muted = isMuted.value // 根据用户偏好设置静音状态

        await audio.play()
      } else {
        // 相邻音频不预读，切换为当前项时再从头播放。
        audio.pause()
      }
    } catch (err) {
      console.warn(`音频播放控制失败 (index: ${index}):`, err)
    }
  }
}

// 更新buffer内容
const updateBuffer = () => {
  const previousId = currentItem.value?.id
  const currentIndex = previewStore.currentIndex
  const list = previewStore.mediaList

  bufferItems.value = [
    currentIndex > 0 ? list[currentIndex - 1] : null, // prev
    list[currentIndex] || null, // current
    currentIndex < list.length - 1 ? list[currentIndex + 1] : null // next
  ]

  // Only keep the current item and its immediate neighbours in memory.
  const urls = new Set(bufferItems.value.map((item) => item?.url))
  for (const url of imageSizes.keys()) if (!urls.has(url)) imageSizes.delete(url)
  if (previousId !== currentItem.value?.id)
    nextTick(() => {
      void controlVideoPlayback()
    })
}

// TAG 相关功能
async function openMetadataEditor() {
  if (
    interactionBlocked.value ||
    isAnimating.value ||
    promptLoading.value ||
    promptError.value ||
    global.conf?.is_readonly ||
    !currentItem.value
  )
    return
  const item = currentItem.value
  editTarget.value = {
    path: item.fullpath || item.id,
    name: item.name || '',
    raw: imageGenInfo.value,
    artifactId: item.originalFile?.workspace_artifact_id
  }
  editorOpen.value = true
  await exitFullscreen()
}
function metadataSaved(path: string) {
  if ((currentItem.value?.fullpath || currentItem.value?.id) === path)
    void loadCurrentItemPrompt(true)
}
async function deleteCurrent() {
  if (
    isWorkspaceArtifact.value ||
    interactionBlocked.value ||
    isAnimating.value ||
    !currentItem.value ||
    global.conf?.is_readonly
  )
    return
  const item = currentItem.value
  const path = item.fullpath || item.id
  confirmingDelete.value = true
  await exitFullscreen()
  const remove = async () => {
    try {
      const { events } = await import('@/features/media-library/composables/folderBrowserContext')
      await deleteFiles([path])
      previewStore.removeMedia(item.id)
      events.emit('removeFiles', { paths: [path], loc: getParentDirectory(path) })
      message.success('已删除')
    } catch (error) {
      message.error('删除失败，请重试')
      throw error
    }
  }
  if (global.ignoredConfirmActions.deleteOneOnly) {
    try {
      await remove()
    } catch {
      /* The failure is reported above. */
    } finally {
      confirmingDelete.value = false
    }
    return
  }
  Modal.confirm({
    title: '删除当前文件？',
    content: `将从本机删除「${item.name || path}」。`,
    okText: '删除',
    cancelText: '取消',
    okType: 'danger',
    afterClose: () => {
      confirmingDelete.value = false
    },
    onOk: remove
  })
}

// Both keyboard and touch navigation share the same media list.
const goToPrev = () => {
  if (interactionBlocked.value || isAnimating.value || !previewStore.hasPrev) return
  dragOffset.value = bufferTransform.value = 0
  previewStore.prev()
}
const goToNext = async () => {
  if (interactionBlocked.value || isAnimating.value || !previewStore.hasNext) return
  isAnimating.value = true
  dragOffset.value = bufferTransform.value = 0
  const request = ++navigationRequest
  try {
    await previewStore.next()
  } catch {
    if (request === navigationRequest) message.error('下一页加载失败，请重试')
  } finally {
    if (request === navigationRequest) isAnimating.value = false
  }
}
// 触摸事件处理
const handleTouchStart = (e: TouchEvent) => {
  if (
    zoom.value > 1 ||
    (e.target as HTMLElement).closest(
      'button, input, textarea, video, audio, .audio-lyrics, .preview-tags-panel'
    )
  )
    return
  if (isAnimating.value) {
    e.preventDefault()
    return
  }

  touchStartY.value = e.touches[0].clientY
  touchCurrentY.value = e.touches[0].clientY
  isDragging.value = true
  dragOffset.value = 0

  // 确保 transform 状态正确
  if (bufferTransform.value !== 0) {
    bufferTransform.value = 0
  }
}

const handleTouchMove = (e: TouchEvent) => {
  if (isAnimating.value) {
    e.preventDefault()
    return
  }

  if (!isDragging.value) return

  touchCurrentY.value = e.touches[0].clientY
  const deltaY = touchCurrentY.value - touchStartY.value
  const viewportHeight = window.innerHeight

  // 直接将移动距离转换为容器的百分比，完全线性映射
  const movePercent = (deltaY / viewportHeight) * 100

  // 简单的线性移动，不使用阻尼
  dragOffset.value = movePercent

  // 阻止页面滚动
  e.preventDefault()
}

const handleTouchEnd = () => {
  if (!isDragging.value) return

  const deltaY = touchCurrentY.value - touchStartY.value
  const viewportHeight = window.innerHeight
  const movePercent = (deltaY / viewportHeight) * 100

  // 重置拖拽状态
  isDragging.value = false

  if (isAnimating.value) {
    // 如果正在动画中，强制重置到正确位置
    dragOffset.value = 0
    return
  }

  // Short intentional swipes are enough to switch media.
  if (Math.abs(deltaY) > Math.min(80, viewportHeight * 0.15)) {
    if (movePercent > 0 && previewStore.hasPrev) {
      // 向下滑动，上一个
      goToPrev()
    } else if (movePercent < 0 && previewStore.hasNext) {
      // 向上滑动，下一个
      goToNext()
    } else {
      // 回弹动画
      resetToCenter()
    }
  } else {
    // 回弹动画
    resetToCenter()
  }
}

// 添加触摸取消处理
const handleTouchCancel = () => {
  if (!isDragging.value) return

  isDragging.value = false

  if (!isAnimating.value) {
    resetToCenter()
  }
}

// 重置到中心位置的函数
const resetToCenter = () => {
  if (isAnimating.value) return

  isAnimating.value = true
  dragOffset.value = 0

  // 确保 bufferTransform 也是正确的
  bufferTransform.value = 0

  setTimeout(() => {
    isAnimating.value = false
  }, 300) // 与 CSS 过渡时间一致
}

// // 错位检测和修复函数
// const fixMisalignment = () => {
//   if (isDragging.value) return

//   // 检测是否存在错位
//   if (bufferTransform.value !== 0 || dragOffset.value !== 0) {
//     // 强制重置到正确位置
//     bufferTransform.value = 0
//     dragOffset.value = 0

//     // 重新更新 buffer 确保内容正确
//     updateBuffer()
//   }

//   // 检查动画状态是否卡住
//   if (isAnimating.value) {
//     isAnimating.value = false
//   }
// }

// Wheel zooms images; Ctrl/Command + wheel switches media.
const switchByWheel = throttle(
  (delta: number) => {
    if (delta > 0) void goToNext()
    else if (delta < 0) goToPrev()
  },
  250,
  { trailing: false }
)
const handleWheel = (event: WheelEvent) => {
  if (editingImage.value) return
  if (
    (event.target as HTMLElement).closest(
      '.preview-tags-panel, .audio-lyrics, audio, button, input'
    )
  )
    return
  event.preventDefault()
  if (event.ctrlKey || event.metaKey) switchByWheel(event.deltaY)
  else if (currentItem.value?.type === 'image') {
    setZoom(zoom.value * Math.exp(-event.deltaY * 0.002))
  } else switchByWheel(event.deltaY)
}
const handleKeydown = (event: KeyboardEvent) => {
  if (!previewStore.visible) return
  if (editingImage.value) return
  if (interactionBlocked.value) return
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, [contenteditable="true"], .ant-modal-wrap')) return
  if (target.closest('video, audio') && event.key !== 'Escape') return
  const shortcut = getShortcutStrFromEvent(event)
  const action = matchBrowseShortcut(shortcut)
  const tag = action === 'toggle_tag_like' ? likeTag.value : undefined
  if (action === 'download' || action === 'delete' || tag) {
    if (event.repeat) {
      event.preventDefault()
      event.stopImmediatePropagation()
      return
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (action === 'download') downloadCurrent()
    else if (action === 'delete') void deleteCurrent()
    else if (tag) void onTagClick(tag.id)
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const keys = [
    'ArrowUp',
    'ArrowLeft',
    'ArrowDown',
    'ArrowRight',
    'Escape',
    '+',
    '=',
    '-',
    '0',
    'r',
    'R'
  ]
  if (!keys.includes(event.key)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.key === 'Escape') {
    previewStore.closeView()
    return
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') goToPrev()
  else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') void goToNext()
  else if (currentItem.value?.type === 'image') {
    if (event.key === '+' || event.key === '=') setZoom(zoom.value * 1.25)
    if (event.key === '-') setZoom(zoom.value / 1.25)
    if (event.key === '0') resetImageView()
    if (event.key.toLowerCase() === 'r') rotateImage(90)
  }
}

// 全屏切换处理
const handleFullscreenToggle = async () => {
  if (previewStore.isFullscreen) {
    await exitFullscreen()
  } else {
    await requestFullscreen()
  }
}

// 请求全屏
const requestFullscreen = async () => {
  if (containerRef.value && !document.fullscreenElement) {
    try {
      await containerRef.value.requestFullscreen()
      previewStore.isFullscreen = true
    } catch (err) {
      console.warn('无法进入全屏模式:', err)
    }
  }
}

// 退出全屏
const exitFullscreen = async () => {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen()
      previewStore.isFullscreen = false
    } catch (err) {
      console.warn('无法退出全屏模式:', err)
    }
  }
}

// 切换声音
const toggleMute = () => {
  isMuted.value = !isMuted.value

  // 立即应用到当前播放的视频
  const currentVideo = videoRefs.value[1]
  if (currentVideo) {
    currentVideo.muted = isMuted.value
  }

  // 立即应用到当前播放的音频
  const currentAudio = audioRefs.value[1]
  if (currentAudio) {
    currentAudio.muted = isMuted.value
  }
}

// 监听全屏状态变化
const handleFullscreenChange = () => {
  previewStore.isFullscreen = !!document.fullscreenElement
}
// 加载当前项的标签
// 长按切换控件可见性
onLongPress(viewportRef, toggleControlsVisibility, { delay: 500 })

// 生命周期
onMounted(() => {
  document.addEventListener('keydown', handleKeydown, true)
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  updateBuffer()
  void refreshAiPromptDefault()
})

onBeforeUpdate(() => {
  videoRefs.value = [null, null, null]
  audioRefs.value = [null, null, null]
})
onUnmounted(() => {
  resetMetadataSession()
  document.removeEventListener('keydown', handleKeydown, true)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  switchByWheel.cancel()
  for (const media of [...videoRefs.value, ...audioRefs.value]) media?.pause()
})

// 监听当前项变化
watch(
  () => previewStore.currentItem?.id,
  (id) => {
    resetMetadataSession()
    resetImageView()
    updateBuffer()
    if (!id || !previewStore.visible) return
    if (previewStore.currentItem?.originalFile?.workspace_artifact_id) {
      void loadCurrentArtifactMetadata()
      return
    }
    nextTick(() => {
      if (!previewStore.visible || previewStore.currentItem?.id !== id) return
      loadCurrentItemTags()
      void loadCurrentItemPrompt()
      void loadCurrentItemDescription()
      void loadInferredPrompt()
      if (activeDetailsTab.value === 'metadata' || activeDetailsTab.value === 'generation')
        void loadCurrentItemMetadata()
    })
  },
  { immediate: true }
)
watch(activeDetailsTab, (tab) => {
  addGenerationFieldOpen.value = false
  aiPromptOpen.value = false
  aiDescriptionOpen.value = false
  if (tab === 'metadata' || tab === 'generation') void loadCurrentItemMetadata()
})

// 监听媒体列表变化
watch(() => previewStore.mediaList.map((item) => item.id), updateBuffer)

// 监听组件可见性变化
watch(
  () => previewStore.visible,
  (visible) => {
    if (visible) void refreshAiPromptDefault()
    if (!visible) {
      resetMetadataSession()
      editorOpen.value = false
      navigationRequest++
      isAnimating.value = false
      isDragging.value = false
      dragOffset.value = bufferTransform.value = 0
      imageSizes.clear()
      previewErrors.clear()
      switchByWheel.cancel()
      // 组件隐藏时停止并清理所有视频
      videoRefs.value.forEach((video) => {
        if (video) {
          video.pause()
          video.src = ''
          video.load()
        }
      })
      videoRefs.value = [null, null, null]

      // 组件隐藏时停止并清理所有音频
      audioRefs.value.forEach((audio) => {
        if (audio) {
          audio.pause()
          audio.src = ''
          audio.load()
        }
      })
      audioRefs.value = [null, null, null]

      // 清空缓冲区
      bufferItems.value = [null, null, null]

      // 如果当前是全屏状态，退出全屏
      if (document.fullscreenElement) {
        exitFullscreen()
      }
    } else {
      // 组件显示时重置控件可见性
      controlsVisible.value = true
      resetImageView()

      // 组件显示时重新更新缓冲区并控制播放
      nextTick(() => {
        updateBuffer()
      })
    }
  }
)

// 监听静音状态变化，同步所有视频和音频
watch(
  () => isMuted.value,
  (muted) => {
    videoRefs.value.forEach((video) => {
      if (video) {
        video.muted = muted
      }
    })
    audioRefs.value.forEach((audio) => {
      if (audio) {
        audio.muted = muted
      }
    })
  }
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="previewStore.visible"
      ref="containerRef"
      :class="containerClass"
      @touchstart="handleTouchStart"
      @touchmove="handleTouchMove"
      @touchend="handleTouchEnd"
      @touchcancel="handleTouchCancel"
      @wheel="handleWheel"
    >
      <!-- 媒体预览 -->
      <!-- 媒体内容区域 -->
      <div
        ref="viewportRef"
        class="preview-viewport"
        :style="editingImage ? { visibility: 'hidden' } : undefined"
      >
        <!-- 3位buffer渲染 -->

        <div
          v-for="(item, index) in bufferItems"
          :key="item?.id || `empty-${index}`"
          class="preview-media-item"
          :style="getItemStyle(index)"
        >
          <div v-if="item" class="media-content">
            <!-- 视频 -->
            <video
              v-if="item.type === 'video' && previewStore.visible"
              class="preview-media preview-video"
              :src="index === 1 ? item.url : undefined"
              :poster="item.originalFile ? toVideoCoverUrl(item.originalFile) : undefined"
              :controls="index === 1"
              :loop="index === 1"
              playsinline
              :preload="index === 1 ? 'metadata' : 'none'"
              :key="item.url"
              :ref="
                (el) => {
                  if (el) videoRefs[index] = el as HTMLVideoElement
                }
              "
              @loadedmetadata="onVideoMetadata(item, $event)"
              @error="onPreviewError(item)"
            />
            <!-- 音频 -->
            <div
              v-else-if="item.type === 'audio' && previewStore.visible"
              class="preview-media preview-audio-container"
            >
              <div class="audio-stage">
                <div class="audio-cover-frame">
                  <img
                    v-if="index === 1 && item.originalFile && audioArtworkAvailable"
                    :src="audioCoverUrl(item.originalFile)"
                    alt="音频封面"
                    @error="audioArtworkAvailable = false"
                  />
                  <CustomerServiceOutlined v-else class="audio-cover-fallback" />
                </div>
                <div class="audio-text">
                  <h2>
                    {{
                      index === 1 ? audioDetails?.title || item.name || '音频' : item.name || '音频'
                    }}
                  </h2>
                  <p v-if="index === 1 && (audioDetails?.artist || audioDetails?.album)">
                    {{ [audioDetails?.artist, audioDetails?.album].filter(Boolean).join(' · ') }}
                  </p>
                  <div
                    v-if="index === 1 && audioDetails?.lyrics?.lines.length"
                    ref="lyricList"
                    class="audio-lyrics"
                    :class="{ timed: audioDetails.lyrics.timed }"
                    aria-label="歌词或台词"
                    @wheel.stop
                    @touchmove.stop
                  >
                    <component
                      :is="audioDetails.lyrics.timed ? 'button' : 'p'"
                      v-for="(line, lineIndex) in audioDetails.lyrics.lines"
                      :key="lineIndex"
                      :data-lyric-index="lineIndex"
                      :class="{ active: lineIndex === currentLyricIndex }"
                      :type="audioDetails.lyrics.timed ? 'button' : undefined"
                      @click.stop="audioDetails.lyrics.timed && seekAudio(line.time)"
                      >{{ line.text }}</component
                    >
                  </div>
                  <p v-else-if="index === 1" class="audio-lyrics-empty">
                    此文件没有可显示的歌词或台词
                  </p>
                </div>
              </div>
              <audio
                class="preview-audio"
                :src="index === 1 ? item.url : undefined"
                :controls="index === 1"
                :loop="index === 1"
                :preload="index === 1 ? 'metadata' : 'none'"
                :key="item.url"
                :ref="
                  (el) => {
                    if (el) audioRefs[index] = el as HTMLAudioElement
                  }
                "
                @loadedmetadata="previewErrors.delete(item.id)"
                @timeupdate="
                  index === 1 &&
                  (currentAudioTime = ($event.target as HTMLAudioElement).currentTime)
                "
                @error="onPreviewError(item)"
              />
            </div>

            <!-- 图片 -->
            <img
              v-else
              class="preview-media preview-image"
              :src="item.url"
              :alt="item.name || '图片'"
              :style="imageStyle(item.url, index)"
              :draggable="false"
              @load="imageLoaded($event, item)"
              @error="onPreviewError(item)"
              @pointerdown="startPan"
              @pointermove="movePan"
              @pointerup="endPan"
              @pointercancel="endPan"
              @dblclick.stop="resetImageView"
            />
            <div v-if="index === 1 && currentPreviewError" class="preview-unavailable" role="alert">
              <strong>无法预览此文件</strong>
              <p>
                {{ currentPreviewError
                }}{{
                  isTauri && item.originalFile?.fullpath && !item.originalFile.workspace_artifact_id
                    ? ' 可用本机应用打开原文件。'
                    : ' 可下载原文件后用本机应用打开。'
                }}
              </p>
              <div>
                <button
                  v-if="
                    isTauri &&
                    item.originalFile?.fullpath &&
                    !item.originalFile.workspace_artifact_id
                  "
                  @click="openCurrentInLocalApp"
                >
                  {{ global.conf?.is_win ? '选择本机应用打开' : '用默认应用打开' }}</button
                ><button @click="downloadCurrent">下载原文件</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <MediaPreviewToolbar
        ref="previewToolbar"
        :visible="controlsVisible || editingImage"
        :details-open="detailsOpen && !editingImage"
        :editing="editingImage"
        :saving="!!mediaEditor?.saving"
        :fullscreen="previewStore.isFullscreen"
        :has-like-tag="!!likeTag"
        :liked="isLiked"
        :is-image="currentItem?.type === 'image'"
        :can-edit-image="canEditCurrentImage"
        :muted="isMuted"
        :description-visible="showDescriptionOverlay"
        :show-delete="!isWorkspaceArtifact"
        :delete-disabled="!!global.conf?.is_readonly || interactionBlocked || isAnimating"
        @action="handleToolbarAction"
      />

      <!-- 导航指示器 -->
      <div v-show="controlsVisible && !editingImage" class="preview-navigation">
        <!-- 上一个指示器 -->
        <button
          v-if="previewStore.hasPrev"
          class="nav-indicator nav-prev"
          aria-label="上一项"
          title="上一项（↑）"
          @click="goToPrev()"
        >
          <UpOutlined />
        </button>

        <!-- 下一个指示器 -->
        <button
          v-if="previewStore.hasNext"
          class="nav-indicator nav-next"
          aria-label="下一项"
          title="下一项（↓）"
          :disabled="previewStore.loadingMore"
          @click="goToNext()"
        >
          <DownOutlined />
        </button>
      </div>

      <div v-if="previewStore.loadingMore" class="preview-loading" role="status">
        正在加载下一页…
      </div>
      <!-- 底部渐变遮罩和文件名 -->
      <div v-show="controlsVisible && !editingImage" class="preview-bottom-overlay">
        <div class="filename-display" v-if="currentItem?.name">
          <span class="preview-filename">{{ currentItem.name }}</span>
        </div>
      </div>
      <div
        v-if="!editingImage && showDescriptionOverlay && imageDescription"
        class="preview-description-overlay"
        role="note"
        aria-label="媒体描述"
        @wheel.stop
        @touchmove.stop
      >
        {{ imageDescription }}
      </div>

      <!-- 进度指示器 -->
      <div v-show="controlsVisible && !editingImage" class="preview-progress">
        <div class="progress-bar-row">
          <div class="progress-bar">
            <div
              class="progress-fill"
              :style="{
                width: `${((previewStore.currentIndex + 1) / previewStore.mediaList.length) * 100}%`
              }"
            />
          </div>
          <span class="progress-text">
            {{ previewStore.currentIndex + 1 }} / {{ previewStore.mediaList.length }}
          </span>
        </div>
      </div>

      <MediaDetailsPanel
        :session="metadataView"
        :current-item="currentItem"
        :details-open="detailsOpen"
        :editing-image="editingImage"
        :is-animating="isAnimating"
        :file-details="fileDetails"
        :exif-details="exifDetails"
        v-model:active-tab="activeDetailsTab"
        @toggle-details="toggleDetails"
        @edit-metadata="openMetadataEditor"
      />
      <Transition name="studio-open" appear>
        <MediaImageEditor
          ref="mediaEditor"
          v-if="editingImage && currentItem?.originalFile"
          :file="currentItem.originalFile"
          :readonly="!!global.conf?.is_readonly"
          @exit="previewStore.viewMode = 'preview'"
          @saved="editorSaved"
        />
      </Transition>
    </div>
  </Teleport>
  <GenerationInfoEditor
    :open="editorOpen"
    :path="editTarget.path"
    :name="editTarget.name"
    :raw="editTarget.raw"
    :artifact-id="editTarget.artifactId"
    raw-only
    @close="editorOpen = false"
    @saved="metadataSaved"
  />
</template>

<style lang="scss" src="../styles/previewViewer.scss"></style>
