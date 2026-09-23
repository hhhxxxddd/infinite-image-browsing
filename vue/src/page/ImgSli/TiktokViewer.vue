<script setup lang="ts">
import { tagLabel } from '@/util/tagLabel'
import { ref, computed, onMounted, onUnmounted, onBeforeUpdate, nextTick, watch, reactive } from 'vue'
import { useTiktokStore, type TiktokMediaItem } from '@/store/useTiktokStore'
import { useTagStore } from '@/store/useTagStore'
import { useGlobalStore } from '@/store/useGlobalStore'
import { useLocalStorage, onLongPress, useElementSize } from '@vueuse/core'
import { copy2clipboardI18n } from '@/util'
import { getImageDescription, toggleCustomTagToImg, updateImageDescription } from '@/api/db'
import { getImageExif, getImageGenerationInfo } from '@/api'
import { getInferredPrompt, saveInferredPrompt } from '@/api/qwen3vl'
import { DEFAULT_IMAGE_PROMPT_EN, DEFAULT_IMAGE_PROMPT_ZH, generateImageAIText, getImageAIConfig, type ImageAITask } from '@/api/imageAi'
import { DeleteOutlined, EditOutlined, RotateLeftOutlined, RotateRightOutlined, DownloadOutlined, BorderOutlined, FileTextOutlined } from '@ant-design/icons-vue'
import { downloadFiles, toRawFileUrl } from '@/util/file'
import { parse } from '@/util/stable-diffusion-image-metadata'
import { message, Modal } from 'ant-design-vue'
import { deleteFiles } from '@/api/files'
import { getParentDirectory } from '@/util/path'
import GenerationInfoEditor from '@/components/GenerationInfoEditor.vue'
import {
  CloseOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  UpOutlined,
  DownOutlined,
  TagsOutlined,
  SoundOutlined,
  SoundFilled,
  HeartOutlined,
  HeartFilled,
  PlayCircleOutlined,
  CopyOutlined,
  InfoCircleOutlined,
} from '@/icon'
import { t } from '@/i18n'
import type { StyleValue } from 'vue'
import { throttle } from 'lodash-es'
import { getShortcutStrFromEvent, shortcutRestriction } from '@/util/shortcut'

const tiktokStore = useTiktokStore()
const tagStore = useTagStore()
const global = useGlobalStore()

// 使用 @vueuse 存储用户声音偏好
const isMuted = useLocalStorage('tiktok-viewer-muted', true) // 默认静音
const showDescriptionOverlay = useLocalStorage('tiktok-viewer-description-overlay', false)
type DetailsTab = 'description' | 'generation' | 'metadata'
const activeDetailsTab = ref<DetailsTab>('description')

// 自动轮播设置
type AutoPlayMode = 'off' | '5s' | '10s' | '20s'
const autoPlayMode = ref('off' as AutoPlayMode) // useLocalStorage<AutoPlayMode>('iib://tiktok-viewer-autoplay', 'off')
const autoPlayTimer = ref<number | null>(null)

// 自动轮播模式配置
const autoPlayOptions: AutoPlayMode[] = ['off', '5s', '10s', '20s']
const autoPlayLabels = computed(() => ({
  off: '轮播未开启',
  '5s': '轮播 5 秒',
  '10s': '轮播 10 秒',
  '20s': '轮播 20 秒'
}))

// 获取自动轮播延迟时间（毫秒）
const getAutoPlayDelay = (mode: AutoPlayMode): number => {
  switch (mode) {
    case '5s': return 5000
    case '10s': return 10000
    case '20s': return 20000
    default: return 0
  }
}

// 引用
const containerRef = ref<HTMLElement>()
const viewportRef = ref<HTMLElement>()
const viewportSize = useElementSize(viewportRef)
const imageSizes = reactive(new Map<string, { width: number; height: number }>())
const zoom = ref(1)
const rotation = ref(0)
const pan = ref({ x: 0, y: 0 })
const panning = ref(false)
let panStart = { x: 0, y: 0, px: 0, py: 0 }
function resetImageView() { zoom.value = 1; rotation.value = 0; pan.value = { x: 0, y: 0 }; panning.value = false }
function setZoom(value: number) {
  zoom.value = Math.max(.25, Math.min(16, value))
  if (zoom.value <= 1) pan.value = { x: 0, y: 0 }
  clearAutoPlayTimer()
}
function rotateImage(amount: number) { rotation.value = (rotation.value + amount) % 360; pan.value = { x: 0, y: 0 }; clearAutoPlayTimer() }
function imageLoaded(event: Event, url: string) {
  const image = event.target as HTMLImageElement
  imageSizes.set(url, { width: image.naturalWidth, height: image.naturalHeight })
}
function imageStyle(item: TiktokMediaItem, index: number): StyleValue {
  if (index !== 1) return {}
  const size = imageSizes.get(item.url)
  const quarterTurn = Math.abs(rotation.value % 180) === 90
  const availableWidth = Math.max(1, viewportSize.width.value - 48)
  const availableHeight = Math.max(1, viewportSize.height.value - 120)
  const fit = size ? Math.min(availableWidth / (quarterTurn ? size.height : size.width), availableHeight / (quarterTurn ? size.width : size.height), 1) : 1
  return {
    width: size ? `${size.width * fit}px` : '100%', height: size ? `${size.height * fit}px` : '100%',
    transform: `translate(${pan.value.x}px, ${pan.value.y}px) rotate(${rotation.value}deg) scale(${zoom.value})`,
    cursor: zoom.value > 1 ? (panning.value ? 'grabbing' : 'grab') : 'default'
  }
}
function startPan(event: PointerEvent) {
  if (zoom.value <= 1 || event.button !== 0) return
  event.preventDefault(); event.stopPropagation()
  clearAutoPlayTimer()
  panning.value = true
  panStart = { x: event.clientX, y: event.clientY, px: pan.value.x, py: pan.value.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function movePan(event: PointerEvent) {
  if (!panning.value) return
  pan.value = { x: panStart.px + event.clientX - panStart.x, y: panStart.py + event.clientY - panStart.y }
}
function endPan() { panning.value = false }
function downloadCurrent() {
  const file = currentItem.value?.originalFile
  if (file) downloadFiles([toRawFileUrl(file, true)])
  else if (currentItem.value?.url) downloadFiles([currentItem.value.url])
}

const videoRefs = ref<(HTMLVideoElement | null)[]>([null, null, null]) // 视频元素引用
const audioRefs = ref<(HTMLAudioElement | null)[]>([null, null, null]) // 音频元素引用

// 3位buffer状态管理
const bufferItems = ref<(TiktokMediaItem | null)[]>([null, null, null]) // [prev, current, next]
const bufferTransform = ref(0) // 当前显示位置的偏移
let navigationRequest = 0
const isAnimating = ref(false) // 是否正在动画中
const touchStartY = ref(0)
const touchCurrentY = ref(0)
const isDragging = ref(false)
const dragOffset = ref(0) // 拖拽偏移量

// TAG 相关状态
const imageGenInfo = ref('')
const promptLoading = ref(false)
const promptError = ref(false)
const editorOpen = ref(false)
const editTarget = ref({path:'', name:'', raw:''})
const imageDescription = ref('')
const descriptionDraft = ref('')
const descriptionLoading = ref(false)
const descriptionSaving = ref(false)
const descriptionEditing = ref(false)
const descriptionAvailable = ref(true)
const descriptionError = ref(false)
const aiDescriptionLength = ref(120)
const aiDescriptionDraft = ref('')
const aiPromptDraft = ref('')
const aiPromptSaved = ref('')
const aiPromptTemplate = useLocalStorage('tiktok-viewer-ai-prompt-template', DEFAULT_IMAGE_PROMPT_EN)
const aiPromptDefault = ref(DEFAULT_IMAGE_PROMPT_EN)
const aiTagSuggestions = ref<string[]>([])
const aiLoadingTask = ref<ImageAITask>()
const aiSavingPrompt = ref(false)
const aiError = ref('')
let aiRequestId = 0
const imageExif = ref<Record<string, string>>({})
const metadataLoading = ref(false)
const metadataError = ref(false)
let metadataRequestId = 0
const confirmingDelete = ref(false)
const interactionBlocked = computed(() => editorOpen.value || descriptionEditing.value || confirmingDelete.value)
let promptRequestId = 0
let descriptionRequestId = 0

// 控件可见性状态（长按切换）
const controlsVisible = ref(true)

// 长按切换控件可见性
const toggleControlsVisibility = () => {
  controlsVisible.value = !controlsVisible.value
}

// 计算属性
const currentItem = computed(() => bufferItems.value[1]) // 中间位置是当前显示的项目
const fileDetails = computed(() => {
  const item = currentItem.value
  if (!item) return []
  const file = item.originalFile || item
  const imageSize = imageSizes.get(item.url)
  return [
    { label: '文件名', value: item.name || file.name },
    { label: '文件路径', value: item.fullpath || file.fullpath || item.id },
    { label: '文件大小', value: file.size || (file.bytes ? `${file.bytes} B` : '') },
    { label: '修改时间', value: file.date || '' },
    { label: '创建时间', value: file.created_time || file.created_date || '' },
    { label: '图片尺寸', value: imageSize ? `${imageSize.width} × ${imageSize.height}` : '' },
  ].filter(entry => entry.value)
})
const exifDetails = computed(() => Object.entries(imageExif.value).map(([label, value]) => ({ label, value })))

const containerClass = computed(() => {
  return {
    'tiktok-viewer': true,
    'tiktok-viewer--fullscreen': tiktokStore.isFullscreen,
    'tiktok-viewer--floating': !tiktokStore.isFullscreen,
    'tiktok-viewer--mobile': tiktokStore.isMobile
  }
})

// 计算每个buffer项的样式
const getItemStyle = (index: number): StyleValue => {
  const baseTransform = (index - 1) * 100 // -100%, 0%, 100%
  const currentTransform = bufferTransform.value + dragOffset.value
  const totalTransform = baseTransform + currentTransform

  return {
    transform: `translateY(${totalTransform}%)`,
    transition: isAnimating.value && !isDragging.value ? 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none'
  }
}

// 清除自动轮播计时器
const clearAutoPlayTimer = () => {
  if (autoPlayTimer.value) {
    clearTimeout(autoPlayTimer.value)
    autoPlayTimer.value = null
  }
}

// 启动自动轮播计时器
const startAutoPlayTimer = () => {
  clearAutoPlayTimer()

  if (interactionBlocked.value || autoPlayMode.value === 'off' || !tiktokStore.visible || zoom.value !== 1) return

  const currentItem = bufferItems.value[1]
  if (!currentItem) return

  // 如果是视频，不需要启动计时器（会在视频结束时自动切换）
  if (currentItem.type === 'video') return

  const delay = getAutoPlayDelay(autoPlayMode.value)
  if (delay > 0) {
    autoPlayTimer.value = window.setTimeout(() => {
      if (!isAnimating.value && !isDragging.value) {
        if (tiktokStore.hasNext) {
          goToNext()
        } else {
          // 到达最后一个时跳回第一个
          goToFirst()
        }
      }
    }, delay)
  }
}

// 处理视频播放结束事件
const handleVideoEnded = (index: number) => {
  // 只处理当前显示的视频（index === 1）
  if (index === 1 && autoPlayMode.value !== 'off' && !isAnimating.value) {
    const id = currentItem.value?.id
    setTimeout(() => {
      if (!tiktokStore.visible || currentItem.value?.id !== id || autoPlayMode.value === 'off') return
      if (tiktokStore.hasNext) {
        goToNext()
      } else {
        // 到达最后一个时跳回第一个
        goToFirst()
      }
    }, 500) // 延迟500ms后切换，避免过于突兀
  }
}

// 处理音频播放结束事件
const handleAudioEnded = (index: number) => {
  // 只处理当前显示的音频（index === 1）
  if (index === 1 && autoPlayMode.value !== 'off' && !isAnimating.value) {
    const id = currentItem.value?.id
    setTimeout(() => {
      if (!tiktokStore.visible || currentItem.value?.id !== id || autoPlayMode.value === 'off') return
      if (tiktokStore.hasNext) {
        goToNext()
      } else {
        // 到达最后一个时跳回第一个
        goToFirst()
      }
    }, 500) // 延迟500ms后切换，避免过于突兀
  }
}

// 控制视频播放
const controlVideoPlayback = async () => {
  if (!tiktokStore.visible) return
  // 控制视频
  for (let index = 0; index < videoRefs.value.length; index++) {
    const video = videoRefs.value[index]
    if (!video) continue

    try {
      if (index === 1) {
        // 当前显示的视频：自动播放
        video.currentTime = 0 // 重置到开头
        video.muted = isMuted.value // 根据用户偏好设置静音状态

        // 添加视频结束事件监听
        video.onended = () => handleVideoEnded(index)

        await video.play()
      } else {
        // 非当前显示的视频：暂停并重置
        video.pause()
        video.currentTime = 0
        video.onended = null // 清除事件监听
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

        // 添加音频结束事件监听
        audio.onended = () => handleAudioEnded(index)

        await audio.play()
      } else {
        // 非当前显示的音频：暂停并重置
        audio.pause()
        audio.currentTime = 0
        audio.onended = null // 清除事件监听
      }
    } catch (err) {
      console.warn(`音频播放控制失败 (index: ${index}):`, err)
    }
  }
}

// 更新buffer内容
const updateBuffer = () => {
  const previousId = currentItem.value?.id
  const currentIndex = tiktokStore.currentIndex
  const list = tiktokStore.mediaList

  bufferItems.value = [
    currentIndex > 0 ? list[currentIndex - 1] : null, // prev
    list[currentIndex] || null, // current
    currentIndex < list.length - 1 ? list[currentIndex + 1] : null // next
  ]

  // Only keep the current item and its immediate neighbours in memory.
  const urls = new Set(bufferItems.value.map(item => item?.url))
  for (const url of imageSizes.keys()) if (!urls.has(url)) imageSizes.delete(url)
  if (previousId !== currentItem.value?.id) nextTick(() => {
    void controlVideoPlayback()
    startAutoPlayTimer()
  })
}

// TAG 相关功能
const isTagSelected = (tagId: string | number) => {
  const currentUrl = currentItem.value?.url
  if (!currentUrl) return false

  const fullpath = (currentItem.value as any)?.fullpath || currentItem.value?.id
  return !!tagStore.tagMap.get(fullpath)?.some(v => v.id === tagId)
}

// Like 标签相关
const likeTag = computed(() => {
  return global.conf?.all_custom_tags?.find(v => v.type === 'custom' && v.name === 'like')
})

const isLiked = computed(() => {
  if (!likeTag.value) return false
  return isTagSelected(likeTag.value.id)
})

const toggleLike = async () => {
  if (!likeTag.value) return
  await onTagClick(likeTag.value.id)
}

const onTagClick = async (tagId: string | number) => {
  const currentUrl = currentItem.value?.url
  if (!currentUrl || global.conf?.is_readonly) return

  try {
    const fullpath = (currentItem.value as any)?.fullpath || currentItem.value?.id

    const { is_remove } = await toggleCustomTagToImg({
      tag_id: Number(tagId),
      img_path: fullpath
    })

    const tag = global.conf?.all_custom_tags.find((v) => v.id === tagId)?.name || t('tag')
    await tagStore.refreshTags([fullpath])

    message.success(t(is_remove ? 'removedTagFromImage' : 'addedTagToImage', { tag }))
  } catch (error) {
    console.error('Toggle tag error:', error)
    message.error(t('tagOperationFailed'))
  }
}

const tagBaseStyle: StyleValue = {
  margin: '4px',
  padding: '8px 16px',
  borderRadius: '20px',
  display: 'inline-block',
  cursor: 'pointer',
  fontWeight: 'bold',
  transition: '0.3s all ease',
  userSelect: 'none',
  fontSize: '14px'
}

const geninfoStruct = computed(() => parse(imageGenInfo.value || ''))
const formatMetadata = (value: unknown) => value == null || value === '' ? '' : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
const primaryParams = computed(() => {
  const meta = geninfoStruct.value
  return [
    ['Sampler', meta.sampler], ['Steps', meta.steps], ['CFG scale', meta.cfgScale],
    ['Seed', meta.seed], ['Size', meta.size || (meta.width && meta.height ? `${meta.width} × ${meta.height}` : '')],
    ['Clip skip', meta.clipSkip]
  ].map(([key, value]) => ({key:String(key), value:formatMetadata(value)}))
})
const modelResources = computed(() => {
  const meta = geninfoStruct.value
  const resources = [...(meta.resources ?? [])]
  if (meta.Model && !resources.some(resource => resource.type === 'model')) resources.unshift({type:'model',name:String(meta.Model),hash:meta['Model hash']})
  return resources
})
const generationParams = computed(() => Object.entries(geninfoStruct.value)
  .filter(([key, value]) => !['prompt','negativePrompt','steps','sampler','cfgScale','seed','size','Size','width','height','clipSkip','Model','Model hash','resources','hashes'].includes(key) && value != null && value !== '')
  .map(([key, value]) => ({ key: key === 'extraJsonMetaInfo' ? '补充信息' : key, value:formatMetadata(value) })))
async function openMetadataEditor() {
  if (interactionBlocked.value || isAnimating.value || promptLoading.value || promptError.value || global.conf?.is_readonly || !currentItem.value) return
  const item = currentItem.value
  editTarget.value = {path:item.fullpath || item.id, name:item.name || '', raw:imageGenInfo.value}
  autoPlayMode.value = 'off'
  clearAutoPlayTimer()
  editorOpen.value = true
  await exitFullscreen()
}
function metadataSaved(path: string) {
  if ((currentItem.value?.fullpath || currentItem.value?.id) === path) void loadCurrentItemPrompt()
}
async function deleteCurrent() {
  if (interactionBlocked.value || isAnimating.value || !currentItem.value || global.conf?.is_readonly) return
  const item = currentItem.value
  const path = item.fullpath || item.id
  confirmingDelete.value = true
  autoPlayMode.value = 'off'
  clearAutoPlayTimer()
  await exitFullscreen()
  const remove = async () => {
    try {
      const { events } = await import('@/page/fileTransfer/hooks')
      await deleteFiles([path])
      tiktokStore.removeMedia(item.id)
      events.emit('removeFiles', {paths:[path], loc:getParentDirectory(path)})
      message.success('已删除')
    } catch (error) { message.error('删除失败，请重试'); throw error }
  }
  if (global.ignoredConfirmActions.deleteOneOnly) {
    try { await remove() } catch { /* The failure is reported above. */ }
    finally { confirmingDelete.value = false }
    return
  }
  Modal.confirm({
    title:'删除当前文件？', content:`将从本机删除「${item.name || path}」。`,
    okText:'删除', cancelText:'取消', okType:'danger',
    afterClose:() => { confirmingDelete.value = false },
    onOk: remove
  })
}

// 切换自动轮播模式
const toggleAutoPlay = () => {
  const currentIndex = autoPlayOptions.indexOf(autoPlayMode.value)
  const nextIndex = (currentIndex + 1) % autoPlayOptions.length
  autoPlayMode.value = autoPlayOptions[nextIndex]

  // 重新启动计时器
  startAutoPlayTimer()

  message.success(t('autoPlayStatus', { mode: autoPlayLabels.value[autoPlayMode.value] }))
}

// Both keyboard and touch navigation share the same media list.
const goToPrev = () => {
  if (interactionBlocked.value || isAnimating.value || !tiktokStore.hasPrev) return
  clearAutoPlayTimer()
  dragOffset.value = bufferTransform.value = 0
  tiktokStore.prev()
}
const goToNext = async () => {
  if (interactionBlocked.value || isAnimating.value || !tiktokStore.hasNext) return
  clearAutoPlayTimer()
  isAnimating.value = true
  dragOffset.value = bufferTransform.value = 0
  const request = ++navigationRequest
  try { await tiktokStore.next() }
  catch { if (request === navigationRequest) message.error('下一页加载失败，请重试') }
  finally { if (request === navigationRequest) isAnimating.value = false }
}
const goToFirst = () => {
  if (interactionBlocked.value) return
  clearAutoPlayTimer()
  dragOffset.value = bufferTransform.value = 0
  tiktokStore.goToIndex(0)
  startAutoPlayTimer()
}

// 触摸事件处理
const handleTouchStart = (e: TouchEvent) => {
  if (zoom.value > 1 || (e.target as HTMLElement).closest('button, input, textarea, video, audio, .tiktok-tags-panel')) return
  if (isAnimating.value) {
    e.preventDefault()
    return
  }

  // 清除自动轮播计时器
  clearAutoPlayTimer()

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
  if (Math.abs(deltaY) > Math.min(80, viewportHeight * .15)) {
    if (movePercent > 0 && tiktokStore.hasPrev) {
      // 向下滑动，上一个
      goToPrev()
    } else if (movePercent < 0 && tiktokStore.hasNext) {
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
    // 重新启动自动轮播计时器
    startAutoPlayTimer()
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
const switchByWheel = throttle((delta: number) => {
  if (delta > 0) void goToNext()
  else if (delta < 0) goToPrev()
}, 250, { trailing: false })
const handleWheel = (event: WheelEvent) => {
  if ((event.target as HTMLElement).closest('.tiktok-tags-panel, button, input')) return
  event.preventDefault()
  if (event.ctrlKey || event.metaKey) switchByWheel(event.deltaY)
  else if (currentItem.value?.type === 'image') {
    setZoom(zoom.value * Math.exp(-event.deltaY * .002))
  } else switchByWheel(event.deltaY)
}
const handleKeydown = (event: KeyboardEvent) => {
  if (!tiktokStore.visible || interactionBlocked.value) return
  const target = event.target as HTMLElement
  if (target.closest('input, textarea, select, [contenteditable="true"], .ant-modal-wrap')) return
  if (target.closest('video, audio') && event.key !== 'Escape') return
  const shortcut = getShortcutStrFromEvent(event)
  const action = shortcutRestriction(shortcut) ? undefined : Object.entries(global.shortcut).find(([key, value]) => value && value === shortcut && (key === 'download' || key === 'delete' || global.conf?.all_custom_tags.some(tag => key === `toggle_tag_${tag.name}`)))?.[0]
  const tagName = action?.startsWith('toggle_tag_') ? action.slice('toggle_tag_'.length) : undefined
  const tag = tagName ? global.conf?.all_custom_tags.find(tag => tag.name === tagName) : undefined
  if (action === 'download' || action === 'delete' || tag) {
    if (event.repeat) { event.preventDefault(); event.stopImmediatePropagation(); return }
    event.preventDefault()
    event.stopImmediatePropagation()
    if (action === 'download') downloadCurrent()
    else if (action === 'delete') void deleteCurrent()
    else if (tag) void onTagClick(tag.id)
    return
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const keys = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Escape', '+', '=', '-', '0', 'r', 'R']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (event.key === 'Escape') { tiktokStore.closeView(); return }
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
  if (tiktokStore.isFullscreen) {
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
      tiktokStore.isFullscreen = true
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
      tiktokStore.isFullscreen = false
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
  tiktokStore.isFullscreen = !!document.fullscreenElement
}
// 加载当前项的标签
const loadCurrentItemTags = async () => {
  const currentItem = tiktokStore.currentItem
  if (!currentItem) return

  const fullpath = (currentItem as any)?.fullpath || currentItem.id
  if (fullpath) {
    await tagStore.fetchImageTags([fullpath])
  }
}

const loadCurrentItemPrompt = async () => {
  const currentItem = tiktokStore.currentItem
  if (!currentItem) {
    imageGenInfo.value = ''
    return
  }
  const fullpath = (currentItem as any)?.fullpath || currentItem.id
  if (!fullpath) {
    imageGenInfo.value = ''
    return
  }

  const requestId = ++promptRequestId
  promptLoading.value = true
  promptError.value = false
  try {
    const info = await getImageGenerationInfo(fullpath)
    if (requestId !== promptRequestId) return
    imageGenInfo.value = info
  } catch (error) {
    console.error('Load prompt error:', error)
    if (requestId !== promptRequestId) return
    imageGenInfo.value = ''
    promptError.value = true
  } finally {
    if (requestId === promptRequestId) {
      promptLoading.value = false
    }
  }
}

const loadCurrentItemDescription = async () => {
  const item = tiktokStore.currentItem
  const path = item?.fullpath || item?.id
  const requestId = ++descriptionRequestId
  imageDescription.value = ''
  descriptionDraft.value = ''
  descriptionAvailable.value = true
  descriptionError.value = false
  if (!path) return
  descriptionLoading.value = true
  try {
    const result = await getImageDescription(path)
    if (requestId !== descriptionRequestId) return
    imageDescription.value = result.description
    descriptionDraft.value = result.description
  } catch (error: any) {
    if (requestId === descriptionRequestId) {
      if (error?.response?.status === 404) descriptionAvailable.value = false
      else descriptionError.value = true
    }
  } finally {
    if (requestId === descriptionRequestId) descriptionLoading.value = false
  }
}

const loadCurrentItemMetadata = async () => {
  const item = tiktokStore.currentItem
  const path = item?.fullpath || item?.id
  const requestId = ++metadataRequestId
  imageExif.value = {}
  metadataError.value = false
  if (!path || item?.type !== 'image') return
  metadataLoading.value = true
  try {
    const result = await getImageExif(path)
    if (requestId === metadataRequestId) imageExif.value = result
  } catch {
    if (requestId === metadataRequestId) metadataError.value = true
  } finally {
    if (requestId === metadataRequestId) metadataLoading.value = false
  }
}

const editDescription = () => {
  if (global.conf?.is_readonly || !descriptionAvailable.value || descriptionLoading.value || descriptionError.value) return
  descriptionDraft.value = imageDescription.value
  autoPlayMode.value = 'off'
  clearAutoPlayTimer()
  descriptionEditing.value = true
}

const saveDescription = async () => {
  const path = currentItem.value?.fullpath || currentItem.value?.id
  if (!path || descriptionSaving.value) return
  descriptionSaving.value = true
  try {
    const result = await updateImageDescription(path, descriptionDraft.value)
    if ((currentItem.value?.fullpath || currentItem.value?.id) === path) {
      imageDescription.value = result.description
      descriptionEditing.value = false
    }
    message.success('描述已保存')
  } catch {
    message.error('描述保存失败，请重试')
  } finally {
    descriptionSaving.value = false
  }
}

async function loadInferredPrompt() {
  const path = currentItem.value?.fullpath || currentItem.value?.id
  const request = ++aiRequestId
  aiPromptDraft.value = ''
  aiPromptSaved.value = ''
  if (!path || currentItem.value?.type !== 'image') return
  try {
    const saved = await getInferredPrompt(path)
    if (request === aiRequestId) aiPromptDraft.value = aiPromptSaved.value = saved
  } catch { /* A file outside the indexed library has no saved note. */ }
}

async function refreshAiPromptDefault() {
  try {
    const config = await getImageAIConfig()
    const usingDefault = aiPromptTemplate.value === aiPromptDefault.value
    aiPromptDefault.value = config.prompts.prompt
    if (usingDefault) aiPromptTemplate.value = config.prompts.prompt
  } catch { /* Generation displays the API error if the service is unavailable. */ }
}

async function generateAiSuggestion(task: ImageAITask) {
  const path = currentItem.value?.fullpath || currentItem.value?.id
  if (!path || currentItem.value?.type !== 'image' || aiLoadingTask.value) return
  const request = ++aiRequestId
  aiError.value = ''
  aiLoadingTask.value = task
  try {
    const tags = (global.conf?.all_custom_tags ?? []).map(tag => tag.name).slice(0, 80)
    const result = await generateImageAIText(path, task, task === 'description' ? aiDescriptionLength.value : task === 'prompt' ? 600 : 120,
      task === 'tags' ? tags : [], task === 'prompt' ? aiPromptTemplate.value.trim() : undefined)
    if (request !== aiRequestId || (currentItem.value?.fullpath || currentItem.value?.id) !== path) return
    if (task === 'description') aiDescriptionDraft.value = result.text
    else if (task === 'prompt') aiPromptDraft.value = result.text
    else aiTagSuggestions.value = result.tags
  } catch (cause: any) {
    if (request === aiRequestId) aiError.value = cause?.response?.data?.detail || cause?.message || 'AI 分析失败'
  } finally {
    if (request === aiRequestId) aiLoadingTask.value = undefined
  }
}

function useAiDescription() {
  if (!aiDescriptionDraft.value || global.conf?.is_readonly) return
  editDescription()
  descriptionDraft.value = aiDescriptionDraft.value
}

async function saveAiPrompt() {
  const path = currentItem.value?.fullpath || currentItem.value?.id
  if (!path || aiSavingPrompt.value || global.conf?.is_readonly) return
  aiSavingPrompt.value = true
  try {
    const saved = await saveInferredPrompt(path, aiPromptDraft.value)
    if ((currentItem.value?.fullpath || currentItem.value?.id) === path) aiPromptSaved.value = saved
    message.success('参考提示词已保存')
  } catch (cause: any) {
    aiError.value = cause?.response?.data?.detail || cause?.message || '保存参考提示词失败'
  } finally { aiSavingPrompt.value = false }
}

function applyAiTag(name: string) {
  const tag = global.conf?.all_custom_tags.find(tag => tag.name === name)
  if (tag && !isTagSelected(tag.id)) void onTagClick(tag.id)
}
function suggestedTagLabel(name: string) {
  return tagLabel(global.conf?.all_custom_tags.find(tag => tag.name === name) ?? { name })
}

// 长按切换控件可见性
onLongPress(
  viewportRef,
  toggleControlsVisibility,
  { delay: 500 }
)

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
  document.removeEventListener('keydown', handleKeydown, true)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  clearAutoPlayTimer()
  switchByWheel.cancel()
  for (const media of [...videoRefs.value, ...audioRefs.value]) media?.pause()
})

// 监听当前项变化
watch(() => tiktokStore.currentItem?.id, () => {
  promptRequestId++
  promptError.value = false
  imageGenInfo.value = ''
  promptLoading.value = false
  descriptionEditing.value = false
  descriptionRequestId++
  descriptionLoading.value = false
  metadataRequestId++
  aiRequestId++
  aiLoadingTask.value = undefined
  aiDescriptionDraft.value = ''
  aiTagSuggestions.value = []
  aiError.value = ''
  metadataLoading.value = false
  imageExif.value = {}
  resetImageView()
  updateBuffer()
  nextTick(() => {
    loadCurrentItemTags()
    void loadCurrentItemPrompt()
    void loadCurrentItemDescription()
    void loadInferredPrompt()
    if (activeDetailsTab.value === 'metadata') void loadCurrentItemMetadata()
  })
}, { immediate: true })
watch(activeDetailsTab, tab => {
  if (tab === 'metadata') void loadCurrentItemMetadata()
})

// 监听媒体列表变化
watch(() => tiktokStore.mediaList.map(item => item.id), updateBuffer)

// 监听组件可见性变化
watch(() => tiktokStore.visible, (visible) => {
  if (visible) void refreshAiPromptDefault()
  if (!visible) {
    editorOpen.value = false
    descriptionEditing.value = false
    descriptionRequestId++
    aiRequestId++
    metadataRequestId++
    navigationRequest++
    isAnimating.value = false
    isDragging.value = false
    dragOffset.value = bufferTransform.value = 0
    autoPlayMode.value = 'off'
    imageSizes.clear()
    switchByWheel.cancel()
    imageGenInfo.value = ''
    promptLoading.value = false
    promptRequestId++
    // 组件隐藏时停止并清理所有视频
    videoRefs.value.forEach(video => {
      if (video) {
        video.pause()
        video.src = ''
        video.load()
      }
    })
    videoRefs.value = [null, null, null]
    
    // 组件隐藏时停止并清理所有音频
    audioRefs.value.forEach(audio => {
      if (audio) {
        audio.pause()
        audio.src = ''
        audio.load()
      }
    })
    audioRefs.value = [null, null, null]
    
    // 清空缓冲区
    bufferItems.value = [null, null, null]

    // 清除自动轮播计时器
    clearAutoPlayTimer()

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
})

// 监听静音状态变化，同步所有视频和音频
watch(() => isMuted.value, (muted) => {
  videoRefs.value.forEach(video => {
    if (video) {
      video.muted = muted
    }
  })
  audioRefs.value.forEach(audio => {
    if (audio) {
      audio.muted = muted
    }
  })
})

// 监听自动轮播模式变化
watch(() => autoPlayMode.value, () => {
  startAutoPlayTimer()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="tiktokStore.visible" ref="containerRef" :class="containerClass" @touchstart="handleTouchStart"
      @touchmove="handleTouchMove" @touchend="handleTouchEnd" @touchcancel="handleTouchCancel" @wheel="handleWheel">
      <!-- 媒体预览 -->
      <!-- 媒体内容区域 -->
      <div ref="viewportRef" class="tiktok-viewport">
        <!-- 3位buffer渲染 -->



        <div v-for="(item, index) in bufferItems" :key="item?.id || `empty-${index}`" class="tiktok-media-item"
          :style="getItemStyle(index)">
          <div v-if="item" class="media-content">
            <!-- 视频 -->
            <video v-if="item.type === 'video' && tiktokStore.visible" class="tiktok-media tiktok-video" :src="item.url"
              :controls="index === 1" :loop="index === 1 && autoPlayMode === 'off'" playsinline preload="metadata"
              :key="item.url" :ref="(el) => { if (el) videoRefs[index] = el as HTMLVideoElement }" />

            <!-- 音频 -->
            <div v-else-if="item.type === 'audio' && tiktokStore.visible" class="tiktok-media tiktok-audio-container">
              <div class="audio-icon">🎵</div>
              <div class="audio-filename">{{ item.name || item.url.split('/').pop() }}</div>
              <audio 
                class="tiktok-audio"
                :src="item.url"
                :controls="index === 1"
                :loop="index === 1 && autoPlayMode === 'off'"
                preload="metadata"
                :key="item.url"
                :ref="(el) => { if (el) audioRefs[index] = el as HTMLAudioElement }"
              />
            </div>

            <!-- 图片 -->
            <img v-else class="tiktok-media preview-image" :src="item.url" :alt="item.name || '图片'" :style="imageStyle(item, index)" :draggable="false"
              @load="imageLoaded($event, item.url)" @pointerdown="startPan" @pointermove="movePan" @pointerup="endPan" @pointercancel="endPan" @dblclick.stop="resetImageView" />
          </div>
        </div>
      </div>

      <!-- 控制按钮区域 -->
      <div v-show="controlsVisible" class="tiktok-controls">

        <!-- 全屏切换按钮 -->
        <button class="control-btn fullscreen-btn" @click="handleFullscreenToggle"
          :title="tiktokStore.isFullscreen ? $t('exitFullscreen') : $t('fullscreen')">
          <FullscreenExitOutlined v-if="tiktokStore.isFullscreen" />
          <FullscreenOutlined v-else />
        </button>

        <!-- 声音切换按钮 -->
        <button v-if="currentItem?.type !== 'image'" class="control-btn sound-btn" @click="toggleMute" :title="isMuted ? $t('soundOn') : $t('soundOff')">
          <SoundFilled v-if="!isMuted" />
          <SoundOutlined v-else />
        </button>

        <!-- Like 按钮 -->
        <button v-if="likeTag" class="control-btn like-btn" :class="{ 'like-active': isLiked }" @click="toggleLike"
          :title="isLiked ? $t('unlike') : $t('like')">
          <HeartFilled v-if="isLiked" />
          <HeartOutlined v-else />
        </button>

        <template v-if="currentItem?.type === 'image'">
          <button class="control-btn" title="适应窗口（0）" aria-label="适应窗口" @click="resetImageView"><BorderOutlined /></button>
          <button class="control-btn" title="向左旋转" aria-label="向左旋转" @click="rotateImage(-90)"><RotateLeftOutlined /></button>
          <button class="control-btn" title="向右旋转（R）" aria-label="向右旋转" @click="rotateImage(90)"><RotateRightOutlined /></button>
          <button class="control-btn description-toggle" :class="{ 'description-toggle-active': showDescriptionOverlay }" :aria-pressed="showDescriptionOverlay" :title="showDescriptionOverlay ? '隐藏图上描述' : '在图上显示描述'" aria-label="切换图上描述" @click="showDescriptionOverlay = !showDescriptionOverlay"><FileTextOutlined /></button>
        </template>
        <button class="control-btn" title="下载原文件" aria-label="下载原文件" @click="downloadCurrent"><DownloadOutlined /></button>
        <button class="control-btn delete-btn" title="删除当前文件" aria-label="删除当前文件" :disabled="global.conf?.is_readonly || interactionBlocked || isAnimating" @click="deleteCurrent"><DeleteOutlined /></button>
        <!-- 自动轮播按钮 -->
        <button class="control-btn autoplay-btn" :class="{ 'autoplay-active': autoPlayMode !== 'off' }"
          @click="toggleAutoPlay" :title="`点击切换轮播间隔；当前${autoPlayLabels[autoPlayMode]}`">
          <PlayCircleOutlined />
          <span class="autoplay-label">{{ autoPlayLabels[autoPlayMode] }}</span>
        </button>
        <button class="control-btn close-btn" @click="tiktokStore.closeView" title="关闭预览（Esc）" aria-label="关闭预览"><CloseOutlined /></button>

      </div>

      <!-- 导航指示器 -->
      <div v-show="controlsVisible" class="tiktok-navigation">
        <!-- 上一个指示器 -->
        <button v-if="tiktokStore.hasPrev" class="nav-indicator nav-prev" aria-label="上一项" title="上一项（↑）" @click="goToPrev()">
          <UpOutlined />
        </button>

        <!-- 下一个指示器 -->
        <button v-if="tiktokStore.hasNext" class="nav-indicator nav-next" aria-label="下一项" title="下一项（↓）" :disabled="tiktokStore.loadingMore" @click="goToNext()">
          <DownOutlined />
        </button>
      </div>

      <div v-if="tiktokStore.loadingMore" class="preview-loading" role="status">正在加载下一页…</div>
      <!-- 底部渐变遮罩和文件名 -->
      <div v-show="controlsVisible" class="tiktok-bottom-overlay">
        <div class="filename-display" v-if="currentItem?.name">
          <span class="preview-filename">{{ currentItem.name }}</span>
          <small v-if="currentItem.type === 'image'" class="preview-help">
            <span>切换图片：按 ↑ / ↓ 键，或按住 Ctrl 滚动滚轮</span>
            <span>缩放图片：直接滚动滚轮；放大后按住图片拖动</span>
          </small>
          <small v-else class="preview-help">切换文件：按 ↑ / ↓ 键，或滚动滚轮</small>
        </div>
      </div>
      <div v-if="showDescriptionOverlay && imageDescription && currentItem?.type === 'image'" class="preview-description-overlay" role="note" @wheel.stop @touchmove.stop>{{ imageDescription }}</div>

      <!-- 进度指示器 -->
      <div v-show="controlsVisible" class="tiktok-progress">
        <div class="progress-bar-row">
          <div class="progress-bar">
            <div class="progress-fill" :style="{
              width: `${((tiktokStore.currentIndex + 1) / tiktokStore.mediaList.length) * 100}%`
            }" />
          </div>
          <span class="progress-text">
            {{ tiktokStore.currentIndex + 1 }} / {{ tiktokStore.mediaList.length }}
          </span>
        </div>
      </div>

      <aside class="tiktok-tags-panel" aria-label="图片详细信息" @click.stop @touchstart.stop @touchmove.stop @wheel.stop>
        <div class="panel-header"><div class="panel-title"><InfoCircleOutlined /><span>详细信息</span></div></div>
        <div class="details-filename" :title="currentItem?.name">{{ currentItem?.name }}</div>
        <nav class="details-tabs" role="tablist" aria-label="详细信息分类">
          <button type="button" role="tab" :aria-selected="activeDetailsTab === 'description'" :class="{active:activeDetailsTab === 'description'}" @click="activeDetailsTab = 'description'">描述</button>
          <button type="button" role="tab" :aria-selected="activeDetailsTab === 'generation'" :class="{active:activeDetailsTab === 'generation'}" @click="activeDetailsTab = 'generation'">生成信息</button>
          <button type="button" role="tab" :aria-selected="activeDetailsTab === 'metadata'" :class="{active:activeDetailsTab === 'metadata'}" @click="activeDetailsTab = 'metadata'">元信息</button>
        </nav>
        <div class="panel-body" role="tabpanel">
          <template v-if="activeDetailsTab === 'description'">
          <section class="panel-section description-section">
            <div class="section-title"><span>图片描述</span><button v-if="!descriptionEditing && descriptionAvailable && !global.conf?.is_readonly" :disabled="descriptionLoading || descriptionError" aria-label="编辑图片描述" @click="editDescription"><EditOutlined /></button></div>
            <p v-if="descriptionLoading" class="prompt-empty">正在读取描述…</p>
            <p v-else-if="!descriptionAvailable" class="prompt-empty">加入媒体索引后可填写描述</p>
            <p v-else-if="descriptionError" class="prompt-empty">描述读取失败 <button class="metadata-retry" @click="loadCurrentItemDescription">重试</button></p>
            <template v-else-if="descriptionEditing">
              <textarea v-model="descriptionDraft" class="description-input" maxlength="5000" rows="4" placeholder="写下画面内容、人物或场景，保存后可通过文字搜索" />
              <div class="description-actions"><button :disabled="descriptionSaving" @click="descriptionEditing = false">取消</button><button :disabled="descriptionSaving" @click="saveDescription">{{ descriptionSaving ? '保存中…' : '保存描述' }}</button></div>
            </template>
            <p v-else-if="imageDescription" class="prompt-text">{{ imageDescription }}</p>
            <button v-else class="metadata-empty" :disabled="global.conf?.is_readonly" @click="editDescription">未填写 · 点击添加描述</button>
            <div v-if="currentItem?.type === 'image'" class="ai-suggestion-actions">
              <label>建议长度 <select v-model.number="aiDescriptionLength" aria-label="AI 描述长度"><option :value="80">80 字</option><option :value="120">120 字</option><option :value="200">200 字</option></select></label>
              <button :disabled="!!aiLoadingTask || descriptionEditing" @click="generateAiSuggestion('description')">{{ aiLoadingTask === 'description' ? '分析图片中…' : 'AI 生成描述建议' }}</button>
            </div>
            <div v-if="aiDescriptionDraft" class="ai-suggestion-draft"><p>{{ aiDescriptionDraft }}</p><button :disabled="global.conf?.is_readonly || descriptionEditing" @click="useAiDescription">采用并编辑</button></div>
          </section>
          </template>
          <template v-else-if="activeDetailsTab === 'generation'">
          <div class="metadata-actions generation-actions">
            <button :disabled="!imageGenInfo || promptLoading" aria-label="复制全部生成信息" title="复制全部" @click="copy2clipboardI18n(imageGenInfo)"><CopyOutlined />复制全部</button>
            <button :disabled="global.conf?.is_readonly || promptLoading || promptError || isAnimating" aria-label="编辑生成信息" title="编辑生成信息" @click="openMetadataEditor"><EditOutlined />编辑</button>
          </div>
          <div v-if="promptLoading" class="prompt-empty" role="status">正在读取生成信息…</div>
          <div v-else-if="promptError" class="prompt-empty">读取失败 <button class="metadata-retry" @click="loadCurrentItemPrompt">重试</button></div>
          <template v-else>
            <section class="panel-section resource-section">
              <div class="section-title">模型与资源</div>
              <div v-for="(resource, index) in modelResources" :key="index" class="model-resource"><span class="resource-type">{{ resource.type === 'model' ? 'Checkpoint' : resource.type }}</span><strong>{{ resource.name }}</strong><small v-if="resource.hash">{{ resource.hash }}</small><small v-if="resource.weight != null">权重 {{ resource.weight }}</small></div>
              <button v-if="!modelResources.length" class="metadata-empty" :disabled="global.conf?.is_readonly" @click="openMetadataEditor">未填写 · 添加模型</button>
            </section>
            <section v-for="prompt in [{key:'prompt', label:'正向提示词', english:'Prompt'}, {key:'negativePrompt', label:'负向提示词', english:'Negative prompt'}]" :key="prompt.key" class="panel-section prompt-section">
              <div class="section-title"><span>{{ prompt.label }}</span><small>{{ prompt.english }}</small><button v-if="geninfoStruct[prompt.key]" :title="`复制${prompt.label}`" :aria-label="`复制${prompt.label}`" @click="copy2clipboardI18n(geninfoStruct[prompt.key] || '')"><CopyOutlined /></button></div>
              <p v-if="geninfoStruct[prompt.key]" class="prompt-text">{{ geninfoStruct[prompt.key] }}</p>
              <button v-else class="metadata-empty" :disabled="global.conf?.is_readonly" @click="openMetadataEditor">未填写 · 点击补充</button>
            </section>
            <section class="panel-section parameters-section"><div class="section-title">生成参数</div><dl class="parameter-grid"><div v-for="entry in primaryParams" :key="entry.key"><dt>{{ entry.key }}</dt><dd :class="{'value-empty':!entry.value}">{{ entry.value || '未填写' }}</dd></div></dl></section>
            <details v-if="generationParams.length" class="panel-section raw-metadata"><summary>更多参数</summary><dl class="generation-params"><template v-for="entry in generationParams" :key="entry.key"><dt>{{ entry.key }}</dt><dd>{{ entry.value }}</dd></template></dl></details>
            <details v-if="imageGenInfo" class="panel-section raw-metadata"><summary>原始生成信息</summary><pre>{{ imageGenInfo }}</pre></details>
          </template>
          <section v-if="currentItem?.type === 'image'" class="panel-section ai-prompt-section">
            <div class="section-title">AI 反推参考提示词</div>
            <p class="prompt-empty">与图片原有生成信息分开保存；模型只能根据可见画面推测。</p>
            <div class="prompt-template-presets"><span>系统指令</span><button :aria-pressed="aiPromptTemplate === DEFAULT_IMAGE_PROMPT_ZH" @click="aiPromptTemplate = DEFAULT_IMAGE_PROMPT_ZH">中文</button><button :aria-pressed="aiPromptTemplate === DEFAULT_IMAGE_PROMPT_EN" @click="aiPromptTemplate = DEFAULT_IMAGE_PROMPT_EN">English</button><button :disabled="aiPromptTemplate === aiPromptDefault" @click="aiPromptTemplate = aiPromptDefault">使用设置默认</button></div>
            <textarea v-model="aiPromptTemplate" class="description-input prompt-template-input" maxlength="2000" rows="5" aria-label="反推图片的系统指令" placeholder="输入语言、风格等生成要求" />
            <p class="prompt-template-hint">可临时修改；{max_chars} 会替换为 600。全局默认指令在“设置 → AI 接入”中配置。</p>
            <div class="ai-suggestion-actions"><button :disabled="!!aiLoadingTask || !aiPromptTemplate.trim()" @click="generateAiSuggestion('prompt')">{{ aiLoadingTask === 'prompt' ? '分析图片中…' : '生成参考提示词' }}</button></div>
            <textarea v-if="aiPromptDraft || aiPromptSaved" v-model="aiPromptDraft" class="description-input" maxlength="5000" rows="5" aria-label="AI 反推参考提示词" placeholder="AI 生成后可编辑" />
            <div v-if="aiPromptDraft || aiPromptSaved" class="description-actions"><button :disabled="!aiPromptDraft" @click="copy2clipboardI18n(aiPromptDraft)">复制</button><button :disabled="global.conf?.is_readonly || aiSavingPrompt || aiPromptDraft === aiPromptSaved" @click="saveAiPrompt">{{ aiSavingPrompt ? '保存中…' : '保存参考提示词' }}</button></div>
          </section>
          </template>
          <template v-else>
            <section class="panel-section"><div class="section-title">文件信息</div><dl class="file-metadata"><div v-for="entry in fileDetails" :key="entry.label"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></div></dl></section>
            <section class="panel-section"><div class="section-title">文件元数据</div>
              <p v-if="metadataLoading" class="prompt-empty">正在读取元数据…</p>
              <p v-else-if="metadataError" class="prompt-empty">元数据读取失败 <button class="metadata-retry" @click="loadCurrentItemMetadata">重试</button></p>
              <dl v-else-if="exifDetails.length" class="file-metadata"><div v-for="entry in exifDetails" :key="entry.label"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></div></dl>
              <p v-else class="prompt-empty">文件没有可读取的元数据</p>
            </section>
          </template>
        </div>
        <p v-if="aiError" class="ai-error" role="alert">{{ aiError }}</p>
        <section class="persistent-tags" aria-label="标签"><div class="section-title"><TagsOutlined /><span>标签</span></div>
            <div class="tags-content"><button v-for="tag in global.conf?.all_custom_tags || []" :key="tag.id" :disabled="global.conf?.is_readonly" :aria-pressed="isTagSelected(tag.id)" @click="onTagClick(tag.id)" :style="{...tagBaseStyle, background:isTagSelected(tag.id) ? tagStore.getColor(tag) : 'transparent', color:isTagSelected(tag.id) ? 'white' : tagStore.getColor(tag), border:`1px solid ${tagStore.getColor(tag)}`}">{{ tagLabel(tag) }}</button></div>
            <p v-if="!global.conf?.all_custom_tags?.length" class="prompt-empty">可在设置的标签配置中添加标签</p>
            <div v-else-if="currentItem?.type === 'image'" class="ai-tags">
              <button :disabled="!!aiLoadingTask" @click="generateAiSuggestion('tags')">{{ aiLoadingTask === 'tags' ? '分析图片中…' : 'AI 推荐已有标签' }}</button>
              <div v-if="aiTagSuggestions.length" class="ai-tag-suggestions"><button v-for="name in aiTagSuggestions" :key="name" :disabled="global.conf?.is_readonly || !!global.conf?.all_custom_tags.find(tag => tag.name === name && isTagSelected(tag.id))" @click="applyAiTag(name)">+ {{ suggestedTagLabel(name) }}</button></div>
            </div>
        </section>
      </aside>
    </div>
  </Teleport>
  <GenerationInfoEditor :open="editorOpen" :path="editTarget.path" :name="editTarget.name" :raw="editTarget.raw" @close="editorOpen = false" @saved="metadataSaved" />
</template>

<style lang="scss" scoped>
.description-input{box-sizing:border-box;width:100%;min-height:90px;resize:vertical;padding:8px;border:1px solid #ffffff30;border-radius:5px;background:#1d2025;color:#e1e5eb;font:inherit;font-size:12px;line-height:1.6;}
.description-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;}.description-actions button{border:1px solid #ffffff30;border-radius:5px;background:#ffffff0a;color:#e1e5eb;padding:5px 9px;cursor:pointer;}.description-actions button:last-child{background:#2868af;border-color:#2868af;color:#fff;}.description-actions button:disabled{opacity:.5;cursor:default;}
.ai-suggestion-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:#aab3c0;}.ai-suggestion-actions label{display:flex;align-items:center;gap:5px;}.ai-suggestion-actions select{background:#1d2025;color:#e1e5eb;border:1px solid #ffffff30;border-radius:4px;padding:4px;}.ai-suggestion-actions button,.ai-suggestion-draft button,.ai-tags button{border:1px solid #447ac077;border-radius:5px;background:#447ac022;color:#a6c9ff;padding:5px 8px;cursor:pointer;font-size:11px;}.ai-suggestion-actions button:disabled,.ai-suggestion-draft button:disabled,.ai-tags button:disabled{opacity:.5;cursor:default;}.ai-suggestion-draft{margin-top:10px;padding:8px;border:1px solid #447ac055;border-radius:6px;font-size:12px;line-height:1.6;color:#dbe7f7;}.ai-suggestion-draft p{margin:0 0 8px;white-space:pre-wrap;}.ai-prompt-section .description-input{margin-top:8px;}.ai-tags{margin-top:12px;}.ai-tag-suggestions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;}.ai-error{color:#ff9c9c;font-size:11px;padding:5px 12px;}
.prompt-template-presets{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:#aab3c0;}.prompt-template-presets button{border:1px solid #ffffff30;border-radius:5px;background:#ffffff0a;color:#dbe7f7;padding:3px 7px;cursor:pointer;font-size:11px;}.prompt-template-presets button[aria-pressed="true"]{border-color:#447ac0;background:#447ac044;color:#fff;}.prompt-template-presets button:disabled{opacity:.5;cursor:default;}.ai-prompt-section .prompt-template-input{min-height:108px;}.prompt-template-hint{margin:5px 0 0;color:#8994a5;font-size:11px;line-height:1.4;}
.tiktok-controls .control-btn.description-toggle{width:32px;padding:0;font-size:16px;}
.tiktok-controls .control-btn.description-toggle-active{color:#a6c9ff;background:#447ac044;}
.preview-description-overlay{position:absolute;z-index:12;left:24px;right:calc(var(--details-width) + 24px);bottom:126px;width:max-content;max-width:min(70%,680px);max-height:28vh;box-sizing:border-box;margin:auto;padding:10px 16px;overflow:auto;border-radius:8px;background:#000b;color:white;text-align:center;font-size:clamp(14px,1.5vw,21px);line-height:1.55;text-shadow:0 1px 2px #000;white-space:pre-wrap;overflow-wrap:anywhere;}
.tiktok-tags-panel .details-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;margin:0 0 12px;padding:3px;border-radius:6px;background:#ffffff0b;flex-shrink:0;}
.details-tabs button{min-width:0;padding:7px 3px;border:0;border-radius:4px;background:transparent;color:#9da6b3;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;}
.details-tabs button.active{background:#3877bb;color:white;}
.details-tabs button:focus-visible{outline:2px solid white;outline-offset:1px;}
.generation-actions{justify-content:flex-end;margin-bottom:10px;}
.tiktok-tags-panel .persistent-tags{flex-shrink:0;max-height:170px;overflow:auto;padding:12px 2px 2px;border-top:1px solid #ffffff20;}
.persistent-tags .section-title{margin-bottom:7px;}
.file-metadata{margin:0;}
.file-metadata>div{padding:7px 0;border-top:1px solid #ffffff12;}
.file-metadata dt{font-size:11px;color:#9199a6;}
.file-metadata dd{margin:3px 0 0;font-size:12px;line-height:1.5;color:#e1e5eb;white-space:pre-wrap;overflow-wrap:anywhere;}
@media(max-width:600px){.preview-description-overlay{left:8px;right:calc(var(--details-width) + 8px);max-width:calc(100% - var(--details-width) - 16px);bottom:105px;padding:7px 10px;font-size:13px;}}
.debug-info {
  position: fixed;
  top: 20px;
  left: 20px;
  background: rgba(0, 0, 0, 0.8);
  padding: 10px;
  border-radius: 8px;
  font-family: monospace;
  font-size: 16px;
  color: #fff;
  z-index: 9999;
  pointer-events: none;
  backdrop-filter: blur(4px);

  .debug-item {
    margin: 4px 0;
    display: flex;
    gap: 8px;
  }

  .debug-label {
    color: #888;
  }

  .debug-value {
    &.is-true {
      color: #4caf50;
    }

    &.is-false {
      color: #f44336;
    }
  }
}

.tiktok-viewer {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 9999;
  background: #000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;

  &--floating {
    background: rgba(0, 0, 0, 0.95);
    backdrop-filter: blur(10px);
  }

  &--mobile {
    .tiktok-controls {
      bottom: 20px;
      right: 20px;
    }
  }
}

.tiktok-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.tiktok-media-item {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  will-change: transform;
}

.media-content {
  width: 100%;
  height: calc(100% - 32px);
  margin-bottom: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tiktok-media {
  width: 100%;
  height: 100%;
  margin: auto;
  object-fit: contain;
  border-radius: 0;
}

.tiktok-controls {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  z-index: 10;
}

.control-btn {
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
    transform: scale(1.1);
  }

  &:active {
    transform: scale(0.95);
  }

  &.like-btn {
    &.like-active {
      background: rgba(255, 20, 147, 0.3); // 深粉色背景
      color: #ff1493; // 深粉色

      &:hover {
        background: rgba(255, 20, 147, 0.5);
        transform: scale(1.15); // 稍微大一点的缩放效果
      }
    }

    &:not(.like-active):hover {
      color: #ff69b4; // 浅粉色
    }
  }

  &.autoplay-btn {
    width: 48px;
    height: 48px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;

    .autoplay-label {
      position: absolute;
      bottom: -2px;
      right: -2px;
      font-size: 10px;
      font-weight: bold;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 2px 4px;
      border-radius: 8px;
      line-height: 1;
      min-width: 20px;
      text-align: center;
      backdrop-filter: blur(5px);
    }

    &.autoplay-active {
      background: rgba(76, 175, 80, 0.3); // 绿色背景
      color: #4caf50; // 绿色

      .autoplay-label {
        background: rgba(76, 175, 80, 0.9);
        color: white;
      }

      &:hover {
        background: rgba(76, 175, 80, 0.5);
        transform: scale(1.1);
      }
    }

    &:not(.autoplay-active):hover {
      color: #81c784; // 浅绿色
    }
  }
}

.tiktok-navigation {
  position: absolute;
  right: 90px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 20px;
  z-index: 10;
}

.nav-indicator {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(10px);
  transition: all 0.3s ease;
  z-index: 999;

  &:hover {
    background: rgba(255, 255, 255, 0.5);
    transform: scale(1.1);
  }

  &.nav-fix {
    background: rgba(255, 165, 0, 0.3); // 橙色背景以区分

    &:hover {
      background: rgba(255, 165, 0, 0.5);
    }
  }
}

/* 底部渐变遮罩 - 抖音风格 */
.tiktok-bottom-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  min-height: 100px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7) 0%, rgba(0, 0, 0, 0.4) 40%, rgba(0, 0, 0, 0) 100%);
  pointer-events: none;
  z-index: 8;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 0 20px 20px 20px;
}

.filename-display {
  color: white;
  font-size: 16px;
  text-align: left;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: normal;
  max-width: 70%;
}

.tiktok-progress {
  position: absolute;
  bottom: 5px;
  left: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  z-index: 10;
  pointer-events: none;
}

.progress-bar-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #fff;
  transition: width 0.3s ease;
}

.progress-text {
  color: white;
  font-size: 14px;
  min-width: 60px;
  text-align: right;
}

/* 音频容器样式 */
.tiktok-audio-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  width: 100%;
  background: linear-gradient(135deg, #0a0a1a 0%, #0d1525 50%, #0a1628 100%);
  position: relative;
  overflow: hidden;
  
  /* 星空背景层 */
  &::before,
  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }
  
  /* 星星层1 - 小星星 */
  &::before {
    background-image: 
      radial-gradient(1px 1px at 20px 30px, white, transparent),
      radial-gradient(1px 1px at 40px 70px, rgba(255,255,255,0.8), transparent),
      radial-gradient(1px 1px at 50px 160px, rgba(255,255,255,0.6), transparent),
      radial-gradient(1px 1px at 90px 40px, white, transparent),
      radial-gradient(1px 1px at 130px 80px, rgba(255,255,255,0.7), transparent),
      radial-gradient(1px 1px at 160px 120px, white, transparent),
      radial-gradient(1.5px 1.5px at 200px 50px, rgba(255,255,255,0.9), transparent),
      radial-gradient(1px 1px at 220px 150px, rgba(255,255,255,0.5), transparent),
      radial-gradient(1.5px 1.5px at 280px 90px, white, transparent),
      radial-gradient(1px 1px at 320px 20px, rgba(255,255,255,0.8), transparent),
      radial-gradient(1px 1px at 350px 180px, rgba(255,255,255,0.6), transparent),
      radial-gradient(1.5px 1.5px at 400px 60px, white, transparent),
      radial-gradient(1px 1px at 450px 130px, rgba(255,255,255,0.7), transparent),
      radial-gradient(1px 1px at 500px 40px, rgba(255,255,255,0.9), transparent),
      radial-gradient(1.5px 1.5px at 80px 200px, white, transparent),
      radial-gradient(1px 1px at 180px 220px, rgba(255,255,255,0.6), transparent),
      radial-gradient(1px 1px at 300px 250px, rgba(255,255,255,0.8), transparent),
      radial-gradient(1.5px 1.5px at 420px 200px, white, transparent);
    background-repeat: repeat;
    background-size: 550px 300px;
    animation: starfield-move 60s linear infinite;
  }
  
  /* 星星层2 - 亮星星，不同速度 */
  &::after {
    background-image: 
      radial-gradient(2px 2px at 100px 50px, rgba(255,255,255,0.9), transparent),
      radial-gradient(2px 2px at 250px 120px, white, transparent),
      radial-gradient(2.5px 2.5px at 380px 80px, rgba(200,220,255,0.9), transparent),
      radial-gradient(2px 2px at 150px 180px, rgba(255,255,255,0.8), transparent),
      radial-gradient(2.5px 2.5px at 450px 150px, rgba(220,200,255,0.9), transparent),
      radial-gradient(2px 2px at 50px 250px, white, transparent),
      radial-gradient(2px 2px at 320px 220px, rgba(255,255,255,0.85), transparent);
    background-repeat: repeat;
    background-size: 600px 350px;
    animation: starfield-move 90s linear infinite reverse;
    opacity: 0.8;
  }
  
  .audio-icon {
    font-size: 120px;
    margin-bottom: 24px;
    animation: pulse 2s ease-in-out infinite;
    position: relative;
    z-index: 1;
    text-shadow: 0 0 40px rgba(100, 150, 255, 0.5);
  }
  
  .audio-filename {
    color: white;
    font-size: 18px;
    margin-bottom: 32px;
    max-width: 80%;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    position: relative;
    z-index: 1;
    text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
  }
  
  .tiktok-audio {
    width: 80%;
    max-width: 1400px;
    position: relative;
    z-index: 1;
  }
}

@keyframes starfield-move {
  from {
    transform: translateY(0) translateX(0);
  }
  to {
    transform: translateY(-300px) translateX(-550px);
  }
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.1);
    opacity: 0.8;
  }
}

.tiktok-tags-panel {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(25px);
  border-radius: 20px 20px 0 0;
  padding: 20px;
  max-height: 70vh;
  overflow: hidden;
  z-index: 20;
  display: flex;
  flex-direction: column;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  border-left: 1px solid rgba(255, 255, 255, 0.1);
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  color: white;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);

  .panel-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 18px;
    font-weight: 500;
  }

  .close-tags {
    background: rgba(255, 255, 255, 0.1);
    border: none;
    color: white;
    font-size: 18px;
    cursor: pointer;
    padding: 6px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: 0.2s ease;

    &:hover {
      background: rgba(255, 255, 255, 0.2);
    }
  }
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding-right: 8px;
  padding-bottom: 50px;
  overscroll-behavior: contain;
  touch-action: pan-y;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
}

.panel-section {
  margin-bottom: 24px;
  background: rgba(255, 255, 255, 0.08);
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.panel-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.panel-action-btn {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 18px;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    transform: translateY(-2px);
    border-color: rgba(255, 255, 255, 0.2);
  }

  &:active {
    transform: translateY(0);
  }

  &.danger {
    border-color: rgba(255, 86, 86, 0.3);
    background: rgba(255, 86, 86, 0.08);
    color: #ff6b6b;

    &:hover {
      background: rgba(255, 86, 86, 0.15);
      border-color: rgba(255, 86, 86, 0.5);
    }
  }
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;

  .edit-prompt-btn {
    margin-left: auto;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    padding: 6px 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    color: rgba(255, 255, 255, 0.8);

    &:hover {
      background: rgba(255, 255, 255, 0.2);
      border-color: rgba(255, 255, 255, 0.3);
      color: rgba(255, 255, 255, 1);
    }
  }
}

.tags-content {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.prompt-content {
  code {
    font-size: 13px;
    display: block;
    padding: 10px 12px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6em;
    color: rgba(255, 255, 255, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.05);

    :deep() {
      .natural-text {
        margin: 0.5em 0;
        line-height: 1.6em;
        color: rgba(255, 255, 255, 0.8);
      }

      .short-tag {
        word-break: break-all;
        white-space: nowrap;
      }

      span.tag {
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.9);
        padding: 3px 6px;
        border-radius: 4px;
        margin-right: 6px;
        margin-top: 4px;
        line-height: 1.3em;
        display: inline-block;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .has-parentheses.tag {
        background: rgba(255, 100, 100, 0.15);
        border-color: rgba(255, 100, 100, 0.2);
      }
    }
  }
}

.prompt-block {
  margin-bottom: 16px;

  &:last-child {
    margin-bottom: 0;
  }
}

.prompt-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
  margin-bottom: 8px;
  font-weight: 500;
}

.prompt-empty {
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
  padding: 8px 0;
}

.tiktok-panel-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 19;
}


// 动画
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all 0.3s ease;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-from {
  transform: translateY(100%);
  opacity: 0;
}

.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}

// 移动端适配
@media (max-width: 768px) {
  .tiktok-controls {
    top: 40px;
    right: 15px;
    gap: 10px;
  }

  .control-btn {
    width: 44px;
    height: 44px;
    font-size: 18px;

    &.autoplay-btn {
      width: 44px;
      height: 44px;

      .autoplay-label {
        font-size: 8px;
        padding: 1px 3px;
        border-radius: 6px;
        min-width: 16px;
      }
    }
  }

  .tiktok-navigation {
    right: 80px;
  }

  .nav-indicator {
    width: 36px;
    height: 36px;
  }

  .tiktok-progress {
    bottom: 80px;
    left: 15px;
    right: 15px;
  }

  .tiktok-tags-panel {
    padding: 15px;
    max-height: 50vh;
  }

  .panel-action-btn {
    width: 32px;
    height: 32px;
  }
}
.metadata-actions{display:flex;gap:6px;align-items:center;}.metadata-actions button,.metadata-retry{display:flex;align-items:center;gap:5px;border:0;border-radius:5px;background:#ffffff0a;color:#a6c9ff;padding:5px 7px;font-size:12px;cursor:pointer;}.metadata-actions button:disabled{opacity:.35;cursor:default;}.tiktok-controls .delete-btn{color:#ff7875;}.tiktok-tags-panel .section-title small{font-size:10px;color:#737a85;}.metadata-empty{border:0;padding:0;background:none;color:#828995;font-size:12px;cursor:pointer;text-align:left;}.metadata-empty:hover{color:#a6c9ff;}.parameter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;}.parameter-grid>div{padding:8px 10px;background:#ffffff06;border:1px solid #ffffff0b;border-radius:6px;min-width:0;}.parameter-grid dt{font-size:10px;color:#9199a6;margin-bottom:4px;}.parameter-grid dd{font:12px/1.5 ui-monospace,monospace;margin:0;color:#e1e5eb;overflow-wrap:anywhere;}.parameter-grid dd.value-empty{font:12px/1.5 inherit;color:#666e7a;}.model-resource{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:8px 0;overflow-wrap:anywhere;}.model-resource+.model-resource{border-top:1px solid #ffffff12;}.resource-type{font-size:10px;background:#528dca22;color:#a6c9ff;padding:2px 6px;border-radius:4px;}.model-resource strong{font-size:13px;font-weight:500;}.model-resource small{font-size:11px;color:#858d99;}.tiktok-tags-panel .prompt-text{font-size:12px;line-height:1.7;max-height:220px;overflow:auto;margin:0;white-space:pre-wrap;}.raw-metadata summary{font-size:12px;color:#9199a6;}.raw-metadata .generation-params{margin-top:12px;}@media(max-width:600px){.parameter-grid{grid-template-columns:1fr;}.section-title small{display:none;}}
</style>
<style scoped>
.tiktok-viewer{z-index:900;caret-color:transparent;}.tiktok-viewer input,.tiktok-viewer textarea{caret-color:auto;}
.tiktok-viewer .tiktok-controls{top:16px;right:16px;bottom:auto;left:auto;display:flex;flex-direction:row;flex-wrap:wrap;max-width:calc(100% - 32px);gap:6px;}
.tiktok-controls .control-btn{width:32px;height:32px;font-size:16px;border-radius:6px;}
.tiktok-controls .autoplay-btn{width:auto;padding:0 8px;}.tiktok-controls .control-btn.autoplay-btn .autoplay-label{position:static;font-size:11px;transform:none;}
.tiktok-viewer .media-content{box-sizing:border-box;height:100%;margin:0;padding:56px 24px 64px;}
.nav-indicator{border:0;}.nav-indicator:focus-visible{outline:2px solid white;outline-offset:3px;}
.preview-image{flex-shrink:0;max-width:none;max-height:none;touch-action:none;will-change:transform;}
.preview-filename{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.preview-help{display:block;margin-top:4px;font-size:12px;line-height:1.5;color:#ddd;}
.preview-help span{display:block;}
.preview-loading{position:absolute;top:60px;left:50%;transform:translateX(-50%);color:white;background:#0008;padding:6px 12px;border-radius:6px;}
.tiktok-tags-panel .panel-body{user-select:text;}
@media(max-width:650px){.tiktok-viewer .tiktok-controls{top:8px;right:8px;max-width:calc(100% - 16px);gap:4px;}.preview-help{display:none;}}
.metadata-actions{display:flex;gap:6px;align-items:center;}.metadata-actions button,.metadata-retry{display:flex;align-items:center;gap:5px;border:0;border-radius:5px;background:#ffffff0a;color:#a6c9ff;padding:5px 7px;font-size:12px;cursor:pointer;}.metadata-actions button:disabled{opacity:.35;cursor:default;}.tiktok-controls .delete-btn{color:#ff7875;}.tiktok-tags-panel .section-title small{font-size:10px;color:#737a85;}.metadata-empty{border:0;padding:0;background:none;color:#828995;font-size:12px;cursor:pointer;text-align:left;}.metadata-empty:hover{color:#a6c9ff;}.parameter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;}.parameter-grid>div{padding:8px 10px;background:#ffffff06;border:1px solid #ffffff0b;border-radius:6px;min-width:0;}.parameter-grid dt{font-size:10px;color:#9199a6;margin-bottom:4px;}.parameter-grid dd{font:12px/1.5 ui-monospace,monospace;margin:0;color:#e1e5eb;overflow-wrap:anywhere;}.parameter-grid dd.value-empty{font:12px/1.5 inherit;color:#666e7a;}.model-resource{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:8px 0;overflow-wrap:anywhere;}.model-resource+.model-resource{border-top:1px solid #ffffff12;}.resource-type{font-size:10px;background:#528dca22;color:#a6c9ff;padding:2px 6px;border-radius:4px;}.model-resource strong{font-size:13px;font-weight:500;}.model-resource small{font-size:11px;color:#858d99;}.tiktok-tags-panel .prompt-text{font-size:12px;line-height:1.7;max-height:220px;overflow:auto;margin:0;white-space:pre-wrap;}.raw-metadata summary{font-size:12px;color:#9199a6;}.raw-metadata .generation-params{margin-top:12px;}@media(max-width:600px){.parameter-grid{grid-template-columns:1fr;}.section-title small{display:none;}}
</style>

<style scoped>
.tiktok-viewer{--details-width:340px;padding-right:var(--details-width);box-sizing:border-box;}
.tiktok-viewer .tiktok-viewport{flex:1;min-height:0;}
.tiktok-viewer .tiktok-tags-panel{top:0;right:0;bottom:0;left:auto;width:var(--details-width);max-height:none;padding:16px;border:0;border-left:1px solid #ffffff20;border-radius:0;background:#15171a;box-shadow:none;box-sizing:border-box;}
.tiktok-tags-panel .panel-header{margin:0 0 14px;padding-bottom:12px;flex-shrink:0;}.tiktok-tags-panel .panel-title{font-size:14px;gap:8px;}.tiktok-tags-panel .panel-body{min-height:0;padding:0 2px 20px;}.tiktok-tags-panel .panel-section{padding:12px;margin-bottom:12px;border-radius:7px;background:#ffffff05;border-color:#ffffff14;}.details-filename{font-size:12px;color:#aaa;overflow-wrap:anywhere;margin-bottom:16px;}.tiktok-tags-panel .section-title{font-size:12px;margin-bottom:10px;display:flex;align-items:center;gap:6px;color:#bbb;}.section-title button{margin-left:auto;border:0;background:none;color:#bbb;cursor:pointer;}
.prompt-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.8;color:#ddd;margin:0;}.generation-params{margin:0;display:grid;grid-template-columns:minmax(60px,auto) minmax(0,1fr);gap:8px 12px;font-size:12px;}.generation-params dt{color:#aaa;overflow-wrap:anywhere;}.generation-params dd{margin:0;color:#ddd;white-space:pre-wrap;overflow-wrap:anywhere;}.raw-metadata{color:#aaa;font-size:12px;}.raw-metadata summary{cursor:pointer;}.raw-metadata pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#ccc;font-size:11px;}.raw-metadata>button{background:none;border:0;color:#80bfff;cursor:pointer;padding:8px 0;}
.tiktok-viewer .tiktok-navigation{left:12px;right:auto;}.tiktok-viewer .tiktok-controls{right:calc(var(--details-width) + 16px);max-width:calc(100% - var(--details-width) - 32px);}.tiktok-viewer .tiktok-progress{left:20px;right:calc(var(--details-width) + 20px);bottom:12px;}.tags-content>button{font:inherit;font-size:11px!important;padding:4px 9px!important;border-radius:5px!important;margin:0 6px 6px 0!important;}
@media(max-width:900px){.tiktok-viewer{--details-width:280px;}}
@media(max-width:600px){.tiktok-viewer{--details-width:42vw;}.tiktok-viewer .tiktok-tags-panel{padding:10px;}.tiktok-tags-panel .panel-section{padding:8px;}.tiktok-viewer .tiktok-controls{left:8px;right:calc(var(--details-width) + 8px);gap:3px;max-width:none;}.tiktok-controls .control-btn{width:28px;height:28px;font-size:14px;}.generation-params{display:block;}.generation-params dd{margin-bottom:8px;}.tiktok-viewer .tiktok-navigation{left:4px;}.tiktok-viewer .media-content{padding-inline:8px;}}
.metadata-actions{display:flex;gap:6px;align-items:center;}.metadata-actions button,.metadata-retry{display:flex;align-items:center;gap:5px;border:0;border-radius:5px;background:#ffffff0a;color:#a6c9ff;padding:5px 7px;font-size:12px;cursor:pointer;}.metadata-actions button:disabled{opacity:.35;cursor:default;}.tiktok-controls .delete-btn{color:#ff7875;}.tiktok-tags-panel .section-title small{font-size:10px;color:#737a85;}.metadata-empty{border:0;padding:0;background:none;color:#828995;font-size:12px;cursor:pointer;text-align:left;}.metadata-empty:hover{color:#a6c9ff;}.parameter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;}.parameter-grid>div{padding:8px 10px;background:#ffffff06;border:1px solid #ffffff0b;border-radius:6px;min-width:0;}.parameter-grid dt{font-size:10px;color:#9199a6;margin-bottom:4px;}.parameter-grid dd{font:12px/1.5 ui-monospace,monospace;margin:0;color:#e1e5eb;overflow-wrap:anywhere;}.parameter-grid dd.value-empty{font:12px/1.5 inherit;color:#666e7a;}.model-resource{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:8px 0;overflow-wrap:anywhere;}.model-resource+.model-resource{border-top:1px solid #ffffff12;}.resource-type{font-size:10px;background:#528dca22;color:#a6c9ff;padding:2px 6px;border-radius:4px;}.model-resource strong{font-size:13px;font-weight:500;}.model-resource small{font-size:11px;color:#858d99;}.tiktok-tags-panel .prompt-text{font-size:12px;line-height:1.7;max-height:220px;overflow:auto;margin:0;white-space:pre-wrap;}.raw-metadata summary{font-size:12px;color:#9199a6;}.raw-metadata .generation-params{margin-top:12px;}@media(max-width:600px){.parameter-grid{grid-template-columns:1fr;}.section-title small{display:none;}}
</style>

<style scoped>.tiktok-viewer .tiktok-bottom-overlay{right:var(--details-width);padding-bottom:34px;}.tiktok-viewer .filename-display{font-size:13px;max-width:100%;}.preview-help{overflow:hidden;text-overflow:ellipsis;}.metadata-actions{display:flex;gap:6px;align-items:center;}.metadata-actions button,.metadata-retry{display:flex;align-items:center;gap:5px;border:0;border-radius:5px;background:#ffffff0a;color:#a6c9ff;padding:5px 7px;font-size:12px;cursor:pointer;}.metadata-actions button:disabled{opacity:.35;cursor:default;}.tiktok-controls .delete-btn{color:#ff7875;}.tiktok-tags-panel .section-title small{font-size:10px;color:#737a85;}.metadata-empty{border:0;padding:0;background:none;color:#828995;font-size:12px;cursor:pointer;text-align:left;}.metadata-empty:hover{color:#a6c9ff;}.parameter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;}.parameter-grid>div{padding:8px 10px;background:#ffffff06;border:1px solid #ffffff0b;border-radius:6px;min-width:0;}.parameter-grid dt{font-size:10px;color:#9199a6;margin-bottom:4px;}.parameter-grid dd{font:12px/1.5 ui-monospace,monospace;margin:0;color:#e1e5eb;overflow-wrap:anywhere;}.parameter-grid dd.value-empty{font:12px/1.5 inherit;color:#666e7a;}.model-resource{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:8px 0;overflow-wrap:anywhere;}.model-resource+.model-resource{border-top:1px solid #ffffff12;}.resource-type{font-size:10px;background:#528dca22;color:#a6c9ff;padding:2px 6px;border-radius:4px;}.model-resource strong{font-size:13px;font-weight:500;}.model-resource small{font-size:11px;color:#858d99;}.tiktok-tags-panel .prompt-text{font-size:12px;line-height:1.7;max-height:220px;overflow:auto;margin:0;white-space:pre-wrap;}.raw-metadata summary{font-size:12px;color:#9199a6;}.raw-metadata .generation-params{margin-top:12px;}@media(max-width:600px){.parameter-grid{grid-template-columns:1fr;}.section-title small{display:none;}}
</style>
