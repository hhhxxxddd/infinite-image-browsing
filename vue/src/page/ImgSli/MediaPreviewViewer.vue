<script setup lang="ts">
import { tagLabel } from '@/util/tagLabel'
import { ref, computed, defineAsyncComponent, onMounted, onUnmounted, onBeforeUpdate, nextTick, watch, reactive } from 'vue'
import { useMediaPreviewStore, type MediaPreviewItem } from '@/store/useMediaPreviewStore'
import { useTagStore } from '@/store/useTagStore'
import { useGlobalStore } from '@/store/useGlobalStore'
import { useLocalStorage, onLongPress } from '@vueuse/core'
import { copy2clipboardI18n } from '@/util'
import { getImageDescription, toggleCustomTagToImg, updateImageDescription } from '@/api/db'
import { getWorkspaceArtifactMetadata, toggleWorkspaceArtifactTag,
  updateWorkspaceArtifactMetadata } from '@/api/workspaceArtifacts'
import { getImageExif, getImageGenerationInfo, openWithAppPicker, updateExif } from '@/api'
import { getInferredPrompt, saveInferredPrompt } from '@/api/qwen3vl'
import { DEFAULT_IMAGE_DESCRIPTION, DEFAULT_IMAGE_PROMPT_EN, DEFAULT_IMAGE_PROMPT_ZH, generateImageAIText, getImageAIConfig, type ImageAITask } from '@/api/imageAi'
import { EditOutlined, RightOutlined, ExclamationCircleOutlined, RobotOutlined, PlusOutlined } from '@ant-design/icons-vue'
const MediaImageEditor = defineAsyncComponent(() => import('./MediaImageEditor.vue'))
import './previewPanels.css'
import './generationPanel.css'
import { findComfyWorkflow } from '@/util/comfyWorkflow'
import { generationParameterFields, generationNumberOptions, generationFieldLabel, generationFieldTooltip, generationResourceLabel, validateGenerationParameter } from '@/util/generationFields'
import MediaPreviewToolbar, { type PreviewToolbarAction } from './MediaPreviewToolbar.vue'
import { usePreviewImageView } from './usePreviewImageView'
import { fileToPreviewItem } from '@/util/mediaPreview'
import type { FileNodeInfo } from '@/api/files'
import { globalEvents } from '@/util'
import { downloadFiles, toRawFileUrl, toVideoCoverUrl, invalidateFileUrls } from '@/util/file'
import { parse } from '@/util/stable-diffusion-image-metadata'
import { copyableGenerationInfo, appendGenerationResource, type GenerationResource } from '@/util/generationResources'
import { generationDetails } from '@/util/generationDetails'
import { readGenerationDraft, writeGenerationDraft, readParameter, setParameter } from '@/util/generationInfoDraft'
import { message, Modal } from 'ant-design-vue'
import { deleteFiles } from '@/api/files'
import { getParentDirectory } from '@/util/path'
import GenerationInfoEditor from '@/components/GenerationInfoEditor.vue'
import {
  UpOutlined,
  DownOutlined,
  TagsOutlined,
  CopyOutlined,
} from '@/icon'
import { t } from '@/i18n'
import type { StyleValue } from 'vue'
import { throttle } from 'lodash-es'
import { getShortcutStrFromEvent, matchBrowseShortcut } from '@/util/shortcut'
import { isAnimatedImage, mayBeAnimatedImage } from '@/util/mediaMotion'
import { isTauri } from '@/util/env'
import { audioCoverUrl, getAudioMetadata, type AudioMetadata } from '@/api/audio'
import { CustomerServiceOutlined } from '@ant-design/icons-vue'

const previewStore = useMediaPreviewStore()
const tagStore = useTagStore()
const global = useGlobalStore()

// 使用 @vueuse 存储用户声音偏好
const isMuted = useLocalStorage('tiktok-viewer-muted', true) // 默认静音
const showDescriptionOverlay = useLocalStorage('tiktok-viewer-description-overlay', false)
const detailsOpen = useLocalStorage('tiktok-viewer-details-open', true)
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
const { imageSizes, zoom, resetImageView, setZoom, rotateImage, measureImage, imageStyle, startPan, movePan, endPan } = usePreviewImageView(viewportRef)
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
    case 'fullscreen': void handleFullscreenToggle(); break
    case 'like': void toggleLike(); break
    case 'download': downloadCurrent(); break
    case 'edit': if (canEditCurrentImage.value) previewStore.viewMode = 'edit'; break
    case 'reset': resetImageView(); break
    case 'rotate-left': rotateImage(-90); break
    case 'rotate-right': rotateImage(90); break
    case 'description': showDescriptionOverlay.value = !showDescriptionOverlay.value; break
    case 'details': toggleDetails(); break
    case 'mute': toggleMute(); break
    case 'delete': void deleteCurrent(); break
    case 'close': previewStore.closeView(); break
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
    onOk: () => { try { downloadFiles([url]) } finally { confirmingDownload.value = false } },
    onCancel: () => { confirmingDownload.value = false }
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
const bufferTransform = ref(0) // 当前显示位置的偏移
let navigationRequest = 0
const isAnimating = ref(false) // 是否正在动画中
const touchStartY = ref(0)
const touchCurrentY = ref(0)
const isDragging = ref(false)
const dragOffset = ref(0) // 拖拽偏移量

// TAG 相关状态
const imageGenInfo = ref('')
const artifactTagIds = ref<number[]>([])
let artifactMetadataRequestId = 0
let artifactMetadataLoaded = ''
let metadataLoadedPath = ''
let descriptionSaveRequest = 0
let aiPromptSaveRequest = 0
const promptLoading = ref(false)
const promptError = ref(false)
const editorOpen = ref(false)
const editTarget = ref<{path: string; name: string; raw: string; artifactId?: string}>({path:'', name:'', raw:''})
const imageDescription = ref('')
const descriptionDraft = ref('')
const descriptionLoading = ref(false)
const descriptionSaving = ref(false)
const descriptionEditing = ref(false)
const descriptionAvailable = ref(true)
const descriptionError = ref(false)
const aiDescriptionLength = ref(120)
const aiDescriptionOpen = ref(false)
const aiDescriptionTemplate = ref(DEFAULT_IMAGE_DESCRIPTION)
const aiDescriptionDefault = ref(DEFAULT_IMAGE_DESCRIPTION)
const aiPromptDraft = ref('')
const aiPromptSaved = ref('')
const aiPromptEditing = ref(false)
const aiPromptOpen = ref(false)
const aiPromptLength = ref(600)
const inlineField = ref('')
const inlineDraft = ref('')
const inlineSaving = ref(false)
const inlineError = ref('')
const addGenerationFieldOpen = ref(false)
const resourcesExpanded = ref(false)
let inlineSaveRequest = 0
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
const confirmingDownload = ref(false)
const editingImage = computed(() => previewStore.viewMode === 'edit' && previewStore.currentItem?.type === 'image' &&
  !!previewStore.currentItem.originalFile && !previewStore.currentItem.originalFile.workspace_artifact_id)
const mediaEditor = ref<InstanceType<typeof MediaImageEditor>>()
const interactionBlocked = computed(() => editorOpen.value || descriptionEditing.value || aiPromptEditing.value || !!inlineField.value || addGenerationFieldOpen.value || aiPromptOpen.value || aiDescriptionOpen.value || confirmingDelete.value || confirmingDownload.value || editingImage.value)
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
const isWorkspaceArtifact = computed(() => !!currentItem.value?.originalFile?.workspace_artifact_id)
const currentLyricIndex = computed(() => {
  const lyrics = audioDetails.value?.lyrics
  if (!lyrics?.timed) return -1
  let active = -1
  lyrics.lines.forEach((line, index) => { if ((line.time ?? Infinity) <= currentAudioTime.value) active = index })
  return active
})
watch(() => currentItem.value?.id, async (_, __, onCleanup) => {
  audioDetails.value = undefined
  audioArtworkAvailable.value = false
  currentAudioTime.value = 0
  const file = currentItem.value?.originalFile
  if (currentItem.value?.type !== 'audio' || !file) return
  let canceled = false
  onCleanup(() => { canceled = true })
  try {
    const details = await getAudioMetadata(file.fullpath)
    if (!canceled) { audioDetails.value = details; audioArtworkAvailable.value = details.has_cover }
  } catch { /* Audio playback remains available without parsed tags. */ }
}, { immediate: true })
watch(currentLyricIndex, async index => {
  if (index < 0) return
  await nextTick()
  const list = lyricList.value
  const line = list?.querySelector<HTMLElement>(`[data-lyric-index="${index}"]`)
  if (list && line) list.scrollTo({ top: line.offsetTop - list.offsetTop - list.clientHeight / 2,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
})
function seekAudio(time?: number) {
  const audio = audioRefs.value[1]
  if (audio && time !== undefined && Number.isFinite(time)) audio.currentTime = time
}
const currentPreviewError = computed(() => previewErrors.get(currentItem.value?.id ?? '') ?? '')
const canEditCurrentImage = computed(() => currentItem.value?.type === 'image' && !!currentItem.value.originalFile
  && !isWorkspaceArtifact.value
  && /\.(jpe?g|png|webp|bmp|tiff?)$/i.test(currentItem.value.name || '') && !global.conf?.is_readonly
  && (!mayBeAnimatedImage(currentItem.value.name || '') || (motionResolved.value && !isCurrentAnimatedImage.value)))
watch(() => currentItem.value?.id, async (_id, _, onCleanup) => {
  isCurrentAnimatedImage.value = false
  motionResolved.value = false
  const item = currentItem.value
  if (item?.type !== 'image' || !item.originalFile || item.originalFile.workspace_artifact_id || !mayBeAnimatedImage(item.name || '')) return
  let cancelled = false
  onCleanup(() => { cancelled = true })
  try {
    const animated = await isAnimatedImage(item.originalFile)
    if (!cancelled) isCurrentAnimatedImage.value = animated
  } catch { /* Keep ordinary image viewing available if the probe fails. */ }
  finally { if (!cancelled) motionResolved.value = true }
}, { immediate: true })
function onVideoMetadata(item: MediaPreviewItem, event: Event) {
  const video = event.target as HTMLVideoElement
  videoInfo.set(item.id, { width: video.videoWidth, height: video.videoHeight, duration: video.duration })
  previewErrors.delete(item.id)
}
function onPreviewError(item: MediaPreviewItem) {
  previewErrors.set(item.id, `${item.type === 'video' ? '视频' : item.type === 'audio' ? '音频' : '图片'}无法在内置预览中解码或读取。`)
}
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return ''
  const total = Math.floor(seconds)
  return `${Math.floor(total / 3600) ? `${Math.floor(total / 3600)}:` : ''}${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
async function openCurrentInLocalApp() {
  const path = currentItem.value?.originalFile?.fullpath
  if (!path || isWorkspaceArtifact.value) return
  try { await openWithAppPicker(path) }
  catch { message.error('无法使用本机应用打开此文件') }
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
    { label: '媒体类型', value: item.type === 'video' ? '视频' : item.type === 'audio' ? '音频' : isCurrentAnimatedImage.value ? '动图' : '图片' },
    ...(item.type === 'audio' ? [
      { label: '标题', value: audioDetails.value?.title || '' },
      { label: '艺术家', value: audioDetails.value?.artist || '' },
      { label: '专辑', value: audioDetails.value?.album || '' },
    ] : []),
    { label: '文件名', value: item.name || file.name },
    ...(artifact ? [{ label: '来源', value: file.workspace_artifact_source === 'ai_image_edit' ? '工作区 · AI 加工'
      : file.workspace_artifact_source === 'image_studio' ? '工作区 · 图片制作' : '工作区创建' }]
      : [{ label: '文件路径', value: item.fullpath || file.fullpath || item.id }]),
    { label: '文件大小', value: file.size || (file.bytes ? `${file.bytes} B` : '') },
    ...(!artifact ? [{ label: '修改时间', value: file.date || '' }] : []),
    { label: '创建时间', value: artifact && file.created_time && !Number.isNaN(Date.parse(file.created_time))
      ? new Date(file.created_time).toLocaleString('zh-CN') : file.created_time || file.created_date || '' },
    { label: item.type === 'video' ? '视频尺寸' : '图片尺寸', value: item.type === 'audio' ? '' : video?.width && video?.height ? `${video.width} × ${video.height}` : imageSize ? `${imageSize.width} × ${imageSize.height}` : '' },
    { label: '时长', value: video ? formatDuration(video.duration) : item.type === 'audio' && audioDetails.value?.duration ? formatDuration(audioDetails.value.duration) : '' },
  ].filter(entry => entry.value)
})
const exifDetails = computed(() => Object.entries(imageExif.value).map(([label, value]) => ({ label, value })))

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
    transition: isAnimating.value && !isDragging.value ? 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none'
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
  const urls = new Set(bufferItems.value.map(item => item?.url))
  for (const url of imageSizes.keys()) if (!urls.has(url)) imageSizes.delete(url)
  if (previousId !== currentItem.value?.id) nextTick(() => {
    void controlVideoPlayback()
  })
}

// TAG 相关功能
const isTagSelected = (tagId: string | number) => {
  if (isWorkspaceArtifact.value) return artifactTagIds.value.includes(Number(tagId))
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
    if (isWorkspaceArtifact.value) {
      const id = currentItem.value?.originalFile?.workspace_artifact_id
      if (!id) return
      const { is_remove } = await toggleWorkspaceArtifactTag(id, Number(tagId))
      if (currentItem.value?.originalFile?.workspace_artifact_id === id) {
        artifactTagIds.value = is_remove ? artifactTagIds.value.filter(value => value !== Number(tagId))
          : [...artifactTagIds.value, Number(tagId)]
      }
      const tag = global.conf?.all_custom_tags.find(value => value.id === tagId)?.name || t('tag')
      message.success(t(is_remove ? 'removedTagFromImage' : 'addedTagToImage', { tag }))
      return
    }
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

const generationDraft = computed(() => readGenerationDraft(imageGenInfo.value))
const geninfoStruct = computed(() => parse(imageGenInfo.value || ''))
const comfyWorkflow = computed(() => findComfyWorkflow(imageExif.value, geninfoStruct.value.extraJsonMetaInfo, imageGenInfo.value))
const copyableGenInfo = computed(() => copyableGenerationInfo(imageGenInfo.value || ''))
const generationView = computed(() => generationDetails(geninfoStruct.value, undefined, undefined, false))
const primaryParams = computed(() => generationView.value.primary.filter(entry => entry.value.trim() !== ''))
const modelResources = computed(() => generationView.value.resources)
const visibleResources = computed(() => resourcesExpanded.value ? modelResources.value : modelResources.value.slice(0, 3))
const promptFields = [{key:'prompt', label:'正向提示词'}, {key:'negativePrompt', label:'负向提示词'}]
const visiblePrompts = computed(() => promptFields.filter(field => String(geninfoStruct.value[field.key] ?? '').trim() || inlineField.value === field.key))
const generationFields = [...promptFields, ...generationParameterFields]
const missingGenerationFields = computed(() => generationFields.filter(field => {
  if (field.key === 'prompt' || field.key === 'negativePrompt') return !String(geninfoStruct.value[field.key] ?? '').trim()
  return !primaryParams.value.some(entry => entry.key === field.key)
}))
const inlineParameter = computed(() => inlineField.value && !['prompt', 'negativePrompt', '__resource'].includes(inlineField.value))
const hasGenerationContent = computed(() => modelResources.value.length || visiblePrompts.value.length || primaryParams.value.length || imageGenInfo.value.trim() || comfyWorkflow.value)
const canEditInline = computed(() => !global.conf?.is_readonly && !promptLoading.value && !promptError.value && !generationDraft.value.rawPreferred)
function beginInline(field: string) {
  if (!canEditInline.value || inlineSaving.value || inlineField.value) return
  const draft = readGenerationDraft(imageGenInfo.value)
  inlineDraft.value = field === 'prompt' ? draft.positive : field === 'negativePrompt' ? draft.negative : readParameter(draft.parameters, field)
  inlineField.value = field
  addGenerationFieldOpen.value = false
  inlineError.value = ''
}
async function saveInline(resource?: GenerationResource) {
  const item = currentItem.value
  if (!item || !inlineField.value || inlineSaving.value || !canEditInline.value) return
  const path = item.fullpath || item.id
  const request = ++inlineSaveRequest
  inlineSaving.value = true
  inlineError.value = ''
  try {
    const draft = readGenerationDraft(imageGenInfo.value)
    if (inlineField.value === 'prompt') draft.positive = inlineDraft.value
    else if (inlineField.value === 'negativePrompt') draft.negative = inlineDraft.value
    else if (inlineField.value !== '__resource') {
      validateGenerationParameter(inlineField.value, inlineDraft.value)
      draft.parameters = setParameter(draft.parameters, inlineField.value, inlineField.value === 'Size' ? inlineDraft.value.replace(/×/g, 'x') : inlineDraft.value)
    }
    const raw = resource ? appendGenerationResource(imageGenInfo.value, resource) : writeGenerationDraft(draft)
    if (item.originalFile?.workspace_artifact_id) await updateWorkspaceArtifactMetadata(item.originalFile.workspace_artifact_id, { generation_info: raw })
    else await updateExif(path, raw)
    if (request === inlineSaveRequest && (currentItem.value?.fullpath || currentItem.value?.id) === path) {
      imageGenInfo.value = raw
      inlineField.value = ''
    }
    message.success('生成信息已保存')
  } catch (error: any) {
    if (request === inlineSaveRequest && (currentItem.value?.fullpath || currentItem.value?.id) === path) inlineError.value = error?.response?.data?.detail || error?.message || '保存失败，请重试'
  } finally { if (request === inlineSaveRequest) inlineSaving.value = false }
}
function confirmAiPrompt() {
  if (!aiPromptTemplate.value.trim() || aiLoadingTask.value) return
  aiPromptOpen.value = false
  void generateAiSuggestion('prompt')
}
async function openMetadataEditor() {
  if (interactionBlocked.value || isAnimating.value || promptLoading.value || promptError.value || global.conf?.is_readonly || !currentItem.value) return
  const item = currentItem.value
  editTarget.value = {path:item.fullpath || item.id, name:item.name || '', raw:imageGenInfo.value, artifactId:item.originalFile?.workspace_artifact_id}
  editorOpen.value = true
  await exitFullscreen()
}
function metadataSaved(path: string) {
  if ((currentItem.value?.fullpath || currentItem.value?.id) === path) void loadCurrentItemPrompt(true)
}
async function deleteCurrent() {
  if (isWorkspaceArtifact.value || interactionBlocked.value || isAnimating.value || !currentItem.value || global.conf?.is_readonly) return
  const item = currentItem.value
  const path = item.fullpath || item.id
  confirmingDelete.value = true
  await exitFullscreen()
  const remove = async () => {
    try {
      const { events } = await import('@/page/fileTransfer/hooks')
      await deleteFiles([path])
      previewStore.removeMedia(item.id)
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
  try { await previewStore.next() }
  catch { if (request === navigationRequest) message.error('下一页加载失败，请重试') }
  finally { if (request === navigationRequest) isAnimating.value = false }
}
// 触摸事件处理
const handleTouchStart = (e: TouchEvent) => {
  if (zoom.value > 1 || (e.target as HTMLElement).closest('button, input, textarea, video, audio, .audio-lyrics, .preview-tags-panel')) return
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
  if (Math.abs(deltaY) > Math.min(80, viewportHeight * .15)) {
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
const switchByWheel = throttle((delta: number) => {
  if (delta > 0) void goToNext()
  else if (delta < 0) goToPrev()
}, 250, { trailing: false })
const handleWheel = (event: WheelEvent) => {
  if (editingImage.value) return
  if ((event.target as HTMLElement).closest('.preview-tags-panel, .audio-lyrics, audio, button, input')) return
  event.preventDefault()
  if (event.ctrlKey || event.metaKey) switchByWheel(event.deltaY)
  else if (currentItem.value?.type === 'image') {
    setZoom(zoom.value * Math.exp(-event.deltaY * .002))
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
  if (event.key === 'Escape') { previewStore.closeView(); return }
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
const loadCurrentArtifactMetadata = async (force = false) => {
  const id = previewStore.currentItem?.originalFile?.workspace_artifact_id
  if (!id || (!force && (artifactMetadataLoaded === id || metadataLoading.value))) return
  const requestId = ++artifactMetadataRequestId
  descriptionAvailable.value = true
  promptLoading.value = descriptionLoading.value = metadataLoading.value = true
  promptError.value = descriptionError.value = metadataError.value = false
  try {
    const result = await getWorkspaceArtifactMetadata(id)
    if (requestId !== artifactMetadataRequestId || previewStore.currentItem?.originalFile?.workspace_artifact_id !== id) return
    imageGenInfo.value = result.generation_info
    artifactMetadataLoaded = id
    imageDescription.value = result.description
    if (!descriptionEditing.value) descriptionDraft.value = result.description
    aiPromptSaved.value = result.inferred_prompt
    if (!aiPromptEditing.value) aiPromptDraft.value = result.inferred_prompt
    artifactTagIds.value = result.tag_ids
    imageExif.value = result.exif
  } catch {
    if (requestId === artifactMetadataRequestId) {
      promptError.value = descriptionError.value = metadataError.value = true
    }
  } finally {
    if (requestId === artifactMetadataRequestId) {
      promptLoading.value = descriptionLoading.value = metadataLoading.value = false
    }
  }
}
const loadCurrentItemTags = async () => {
  const currentItem = previewStore.currentItem
  if (!currentItem || currentItem.originalFile?.workspace_artifact_id) return

  const fullpath = (currentItem as any)?.fullpath || currentItem.id
  if (fullpath) {
    await tagStore.fetchImageTags([fullpath])
  }
}

const loadCurrentItemPrompt = async (force = false) => {
  const currentItem = previewStore.currentItem
  if (currentItem?.originalFile?.workspace_artifact_id) return loadCurrentArtifactMetadata(force)
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
  const item = previewStore.currentItem
  if (item?.originalFile?.workspace_artifact_id) return loadCurrentArtifactMetadata()
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

const loadCurrentItemMetadata = async (force = false) => {
  const item = previewStore.currentItem
  if (item?.originalFile?.workspace_artifact_id) return loadCurrentArtifactMetadata(force)
  const path = item?.fullpath || item?.id
  if (!force && (metadataLoadedPath === path || metadataLoading.value)) return
  const requestId = ++metadataRequestId
  imageExif.value = {}
  metadataError.value = false
  if (!path || item?.type !== 'image') return
  metadataLoading.value = true
  try {
    const result = await getImageExif(path)
    if (requestId === metadataRequestId) {
      imageExif.value = result
      metadataLoadedPath = path
    }
  } catch {
    if (requestId === metadataRequestId) metadataError.value = true
  } finally {
    if (requestId === metadataRequestId) metadataLoading.value = false
  }
}

const editDescription = () => {
  if (global.conf?.is_readonly || !descriptionAvailable.value || descriptionLoading.value || descriptionError.value) return
  descriptionDraft.value = imageDescription.value
  descriptionEditing.value = true
}

watch(descriptionEditing, editing => {
  if (editing) return
  aiDescriptionOpen.value = false
  if (aiLoadingTask.value === 'description') {
    aiRequestId++
    aiLoadingTask.value = undefined
  }
}, { flush: 'sync' })

function confirmAiDescription() {
  if (!aiDescriptionTemplate.value.trim() || descriptionSaving.value || aiLoadingTask.value || global.conf?.is_readonly || !descriptionAvailable.value || descriptionLoading.value || descriptionError.value) return
  if (!descriptionEditing.value) editDescription()
  aiDescriptionOpen.value = false
  void generateAiSuggestion('description')
}

const saveDescription = async () => {
  const path = currentItem.value?.fullpath || currentItem.value?.id
  if (!path || descriptionSaving.value || global.conf?.is_readonly || aiLoadingTask.value === 'description') return
  const request = ++descriptionSaveRequest
  descriptionSaving.value = true
  try {
    const artifactId = currentItem.value?.originalFile?.workspace_artifact_id
    const result = artifactId ? await updateWorkspaceArtifactMetadata(artifactId, { description: descriptionDraft.value })
      : await updateImageDescription(path, descriptionDraft.value)
    if (request === descriptionSaveRequest && (currentItem.value?.fullpath || currentItem.value?.id) === path) {
      imageDescription.value = result.description
      descriptionEditing.value = false
    }
    if (request === descriptionSaveRequest) message.success('描述已保存')
  } catch {
    if (request === descriptionSaveRequest) message.error('描述保存失败，请重试')
  } finally {
    if (request === descriptionSaveRequest) descriptionSaving.value = false
  }
}

async function loadInferredPrompt() {
  const path = currentItem.value?.fullpath || currentItem.value?.id
  const request = ++aiRequestId
  aiPromptEditing.value = false
  aiPromptDraft.value = ''
  aiPromptSaved.value = ''
  if (isWorkspaceArtifact.value) return loadCurrentArtifactMetadata()
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
    const usingDescriptionDefault = aiDescriptionTemplate.value === aiDescriptionDefault.value
    aiDescriptionDefault.value = config.prompts.description
    if (usingDescriptionDefault) aiDescriptionTemplate.value = config.prompts.description
  } catch { /* Generation displays the API error if the service is unavailable. */ }
}

async function generateAiSuggestion(task: ImageAITask) {
  const path = currentItem.value?.fullpath || currentItem.value?.id
  if (!path || currentItem.value?.type !== 'image' || aiLoadingTask.value) return
  if (task === 'description' && (!descriptionEditing.value || descriptionSaving.value || global.conf?.is_readonly)) return
  const request = ++aiRequestId
  aiError.value = ''
  aiLoadingTask.value = task
  try {
    const tags = (global.conf?.all_custom_tags ?? []).map(tag => tag.name).slice(0, 80)
    const result = await generateImageAIText(path, task, task === 'description' ? aiDescriptionLength.value : task === 'prompt' ? aiPromptLength.value : 120,
      task === 'tags' ? tags : [], task === 'prompt' ? aiPromptTemplate.value.trim() : task === 'description' ? aiDescriptionTemplate.value.trim() : undefined)
    if (request !== aiRequestId || (currentItem.value?.fullpath || currentItem.value?.id) !== path) return
    if (task === 'description' && descriptionEditing.value) descriptionDraft.value = result.text
    else if (task === 'prompt') {
      aiPromptDraft.value = result.text
      aiPromptEditing.value = true
    }
    else aiTagSuggestions.value = result.tags
  } catch (cause: any) {
    if (request === aiRequestId) aiError.value = cause?.response?.data?.detail || cause?.message || 'AI 分析失败'
  } finally {
    if (request === aiRequestId) aiLoadingTask.value = undefined
  }
}

function editAiPrompt() {
  aiPromptDraft.value = aiPromptSaved.value
  aiPromptEditing.value = true
  aiError.value = ''
}

function cancelAiPrompt() {
  aiPromptDraft.value = aiPromptSaved.value
  aiPromptEditing.value = false
  aiError.value = ''
}

async function saveAiPrompt() {
  const path = currentItem.value?.fullpath || currentItem.value?.id
  if (!path || aiSavingPrompt.value || aiLoadingTask.value === 'prompt' || global.conf?.is_readonly) return
  const request = ++aiPromptSaveRequest
  aiError.value = ''
  aiSavingPrompt.value = true
  try {
    const artifactId = currentItem.value?.originalFile?.workspace_artifact_id
    const saved = artifactId ? (await updateWorkspaceArtifactMetadata(artifactId, { inferred_prompt: aiPromptDraft.value })).inferred_prompt
      : await saveInferredPrompt(path, aiPromptDraft.value)
    if (request === aiPromptSaveRequest && (currentItem.value?.fullpath || currentItem.value?.id) === path) {
      aiPromptDraft.value = aiPromptSaved.value = saved
      aiPromptEditing.value = false
    }
    if (request === aiPromptSaveRequest) message.success('参考提示词已保存')
  } catch (cause: any) {
    if (request === aiPromptSaveRequest) aiError.value = cause?.response?.data?.detail || cause?.message || '保存参考提示词失败'
  } finally { if (request === aiPromptSaveRequest) aiSavingPrompt.value = false }
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
  resetMetadataSession()
  document.removeEventListener('keydown', handleKeydown, true)
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  switchByWheel.cancel()
  for (const media of [...videoRefs.value, ...audioRefs.value]) media?.pause()
})

function resetMetadataSession() {
  artifactMetadataLoaded = metadataLoadedPath = ''
  artifactMetadataRequestId++
  descriptionSaveRequest++
  aiPromptSaveRequest++
  descriptionSaving.value = aiSavingPrompt.value = false
  addGenerationFieldOpen.value = false
  imageDescription.value = descriptionDraft.value = ''
  aiPromptDraft.value = aiPromptSaved.value = ''
  descriptionAvailable.value = true
  resourcesExpanded.value = false
  aiPromptEditing.value = false
  inlineSaveRequest++
  inlineSaving.value = false
  inlineField.value = ''
  inlineError.value = ''
  aiPromptOpen.value = false
  promptRequestId++
  promptError.value = false
  imageGenInfo.value = ''
  promptLoading.value = false
  descriptionEditing.value = false
  descriptionRequestId++
  descriptionLoading.value = false
  metadataRequestId++
  artifactTagIds.value = []
  aiRequestId++
  aiLoadingTask.value = undefined
  aiDescriptionOpen.value = false
  aiTagSuggestions.value = []
  aiError.value = ''
  metadataLoading.value = false
  imageExif.value = {}
  descriptionError.value = metadataError.value = false
}

// 监听当前项变化
watch(() => previewStore.currentItem?.id, (id) => {
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
    if (activeDetailsTab.value === 'metadata' || activeDetailsTab.value === 'generation') void loadCurrentItemMetadata()
  })
}, { immediate: true })
watch(activeDetailsTab, tab => {
  addGenerationFieldOpen.value = false
  aiPromptOpen.value = false
  aiDescriptionOpen.value = false
  if (tab === 'metadata' || tab === 'generation') void loadCurrentItemMetadata()
})

// 监听媒体列表变化
watch(() => previewStore.mediaList.map(item => item.id), updateBuffer)

// 监听组件可见性变化
watch(() => previewStore.visible, (visible) => {
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

</script>

<template>
  <Teleport to="body">
    <div v-if="previewStore.visible" ref="containerRef" :class="containerClass" @touchstart="handleTouchStart"
      @touchmove="handleTouchMove" @touchend="handleTouchEnd" @touchcancel="handleTouchCancel" @wheel="handleWheel">
      <!-- 媒体预览 -->
      <!-- 媒体内容区域 -->
      <div ref="viewportRef" class="preview-viewport" :style="editingImage ? {visibility: 'hidden'} : undefined">
        <!-- 3位buffer渲染 -->



        <div v-for="(item, index) in bufferItems" :key="item?.id || `empty-${index}`" class="preview-media-item"
          :style="getItemStyle(index)">
          <div v-if="item" class="media-content">
            <!-- 视频 -->
            <video v-if="item.type === 'video' && previewStore.visible" class="preview-media preview-video" :src="index === 1 ? item.url : undefined"
              :poster="item.originalFile ? toVideoCoverUrl(item.originalFile) : undefined"
              :controls="index === 1" :loop="index === 1" playsinline :preload="index === 1 ? 'metadata' : 'none'"
              :key="item.url" :ref="(el) => { if (el) videoRefs[index] = el as HTMLVideoElement }"
              @loadedmetadata="onVideoMetadata(item, $event)" @error="onPreviewError(item)" />
            <!-- 音频 -->
            <div v-else-if="item.type === 'audio' && previewStore.visible" class="preview-media preview-audio-container">
              <div class="audio-stage">
                <div class="audio-cover-frame">
                  <img v-if="index === 1 && item.originalFile && audioArtworkAvailable" :src="audioCoverUrl(item.originalFile)" alt="音频封面" @error="audioArtworkAvailable = false" />
                  <CustomerServiceOutlined v-else class="audio-cover-fallback" />
                </div>
                <div class="audio-text">
                  <h2>{{ index === 1 ? audioDetails?.title || item.name || '音频' : item.name || '音频' }}</h2>
                  <p v-if="index === 1 && (audioDetails?.artist || audioDetails?.album)">{{ [audioDetails?.artist, audioDetails?.album].filter(Boolean).join(' · ') }}</p>
                  <div v-if="index === 1 && audioDetails?.lyrics?.lines.length" ref="lyricList" class="audio-lyrics" :class="{ timed: audioDetails.lyrics.timed }" aria-label="歌词或台词" @wheel.stop @touchmove.stop>
                    <component :is="audioDetails.lyrics.timed ? 'button' : 'p'" v-for="(line, lineIndex) in audioDetails.lyrics.lines" :key="lineIndex" :data-lyric-index="lineIndex" :class="{ active: lineIndex === currentLyricIndex }" :type="audioDetails.lyrics.timed ? 'button' : undefined" @click.stop="audioDetails.lyrics.timed && seekAudio(line.time)">{{ line.text }}</component>
                  </div>
                  <p v-else-if="index === 1" class="audio-lyrics-empty">此文件没有可显示的歌词或台词</p>
                </div>
              </div>
              <audio 
                class="preview-audio"
                :src="index === 1 ? item.url : undefined"
                :controls="index === 1"
                :loop="index === 1"
                :preload="index === 1 ? 'metadata' : 'none'"
                :key="item.url"
                :ref="(el) => { if (el) audioRefs[index] = el as HTMLAudioElement }"
                @loadedmetadata="previewErrors.delete(item.id)" @timeupdate="index === 1 && (currentAudioTime = ($event.target as HTMLAudioElement).currentTime)" @error="onPreviewError(item)"
              />
            </div>

            <!-- 图片 -->
            <img v-else class="preview-media preview-image" :src="item.url" :alt="item.name || '图片'" :style="imageStyle(item.url, index)" :draggable="false"
              @load="imageLoaded($event, item)" @error="onPreviewError(item)" @pointerdown="startPan" @pointermove="movePan" @pointerup="endPan" @pointercancel="endPan" @dblclick.stop="resetImageView" />
            <div v-if="index === 1 && currentPreviewError" class="preview-unavailable" role="alert">
              <strong>无法预览此文件</strong><p>{{ currentPreviewError }}{{ isTauri && item.originalFile?.fullpath && !item.originalFile.workspace_artifact_id ? ' 可用本机应用打开原文件。' : ' 可下载原文件后用本机应用打开。' }}</p>
              <div><button v-if="isTauri && item.originalFile?.fullpath && !item.originalFile.workspace_artifact_id" @click="openCurrentInLocalApp">{{ global.conf?.is_win ? '选择本机应用打开' : '用默认应用打开' }}</button><button @click="downloadCurrent">下载原文件</button></div>
            </div>
          </div>
        </div>
      </div>

      <MediaPreviewToolbar ref="previewToolbar" :visible="controlsVisible || editingImage" :details-open="detailsOpen && !editingImage" :editing="editingImage" :saving="!!mediaEditor?.saving"
        :fullscreen="previewStore.isFullscreen" :has-like-tag="!!likeTag" :liked="isLiked"
        :is-image="currentItem?.type === 'image'" :can-edit-image="canEditCurrentImage"
        :muted="isMuted" :description-visible="showDescriptionOverlay" :show-delete="!isWorkspaceArtifact"
        :delete-disabled="!!global.conf?.is_readonly || interactionBlocked || isAnimating"
        @action="handleToolbarAction" />

      <!-- 导航指示器 -->
      <div v-show="controlsVisible && !editingImage" class="preview-navigation">
        <!-- 上一个指示器 -->
        <button v-if="previewStore.hasPrev" class="nav-indicator nav-prev" aria-label="上一项" title="上一项（↑）" @click="goToPrev()">
          <UpOutlined />
        </button>

        <!-- 下一个指示器 -->
        <button v-if="previewStore.hasNext" class="nav-indicator nav-next" aria-label="下一项" title="下一项（↓）" :disabled="previewStore.loadingMore" @click="goToNext()">
          <DownOutlined />
        </button>
      </div>

      <div v-if="previewStore.loadingMore" class="preview-loading" role="status">正在加载下一页…</div>
      <!-- 底部渐变遮罩和文件名 -->
      <div v-show="controlsVisible && !editingImage" class="preview-bottom-overlay">
        <div class="filename-display" v-if="currentItem?.name">
          <span class="preview-filename">{{ currentItem.name }}</span>
        </div>
      </div>
      <div v-if="!editingImage && showDescriptionOverlay && imageDescription" class="preview-description-overlay" role="note" aria-label="媒体描述" @wheel.stop @touchmove.stop>{{ imageDescription }}</div>

      <!-- 进度指示器 -->
      <div v-show="controlsVisible && !editingImage" class="preview-progress">
        <div class="progress-bar-row">
          <div class="progress-bar">
            <div class="progress-fill" :style="{
              width: `${((previewStore.currentIndex + 1) / previewStore.mediaList.length) * 100}%`
            }" />
          </div>
          <span class="progress-text">
            {{ previewStore.currentIndex + 1 }} / {{ previewStore.mediaList.length }}
          </span>
        </div>
      </div>

      <aside id="preview-details" class="preview-tags-panel preview-panel-surface" aria-label="媒体详细信息" :aria-hidden="!detailsOpen || editingImage" :inert="!detailsOpen || editingImage" @click.stop @touchstart.stop @touchmove.stop @wheel.stop>
        <div class="panel-header"><div class="panel-title"><ExclamationCircleOutlined /><span>详细信息</span></div><button type="button" class="details-collapse" aria-label="收起详细信息" title="收起详细信息" aria-controls="preview-details" :aria-expanded="true" @click="toggleDetails"><RightOutlined /></button></div>
        <div class="details-filename" :title="currentItem?.name">{{ currentItem?.name }}</div>
        <nav class="details-tabs" role="tablist" aria-label="详细信息分类">
          <button type="button" role="tab" :aria-selected="activeDetailsTab === 'description'" :class="{active:activeDetailsTab === 'description'}" @click="activeDetailsTab = 'description'">描述</button>
          <button type="button" role="tab" :aria-selected="activeDetailsTab === 'generation'" :class="{active:activeDetailsTab === 'generation'}" @click="activeDetailsTab = 'generation'">生成信息</button>
          <button type="button" role="tab" :aria-selected="activeDetailsTab === 'metadata'" :class="{active:activeDetailsTab === 'metadata'}" @click="activeDetailsTab = 'metadata'">元信息</button>
        </nav>
          <div v-if="activeDetailsTab === 'generation'" class="metadata-actions generation-actions">
            <a-popover v-if="!global.conf?.is_readonly" v-model:open="addGenerationFieldOpen" trigger="click" placement="bottomLeft" :z-index="1010">
              <template #content><div class="generation-add-menu" @keydown.stop @keydown.esc="addGenerationFieldOpen = false" @wheel.stop><button :disabled="!canEditInline || !!inlineField" title="使用资源" aria-label="使用资源" @click="beginInline('__resource')">使用资源…</button><button v-for="field in missingGenerationFields" :key="field.key" :title="generationFieldTooltip(field.key)" :aria-label="generationFieldTooltip(field.key)" @click="beginInline(field.key)">{{ generationFieldLabel(field.key) }}</button></div></template>
              <button class="generation-add-trigger" :disabled="!canEditInline || !!inlineField" aria-label="补充生成信息" title="补充生成信息"><PlusOutlined /></button>
            </a-popover>
            <button :disabled="!copyableGenInfo || promptLoading" aria-label="复制全部生成信息（不含模型和 LoRA 名称）" title="复制全部（不含模型与 LoRA）" @click="copy2clipboardI18n(copyableGenInfo)"><CopyOutlined /></button>
            <button :disabled="global.conf?.is_readonly || promptLoading || promptError || isAnimating || !!inlineField" aria-label="编辑原始生成信息" title="编辑原始生成信息" @click="openMetadataEditor"><EditOutlined /></button>
          </div>
        <div class="panel-body" role="tabpanel">
          <template v-if="activeDetailsTab === 'description'">
          <section class="panel-section description-section">
            <div class="section-title"><span>媒体描述</span>
              <div v-if="descriptionAvailable" class="generation-heading-actions">
                <button v-if="imageDescription && !descriptionEditing" :disabled="descriptionLoading || descriptionError" aria-label="复制媒体描述" title="复制媒体描述" @click="copy2clipboardI18n(imageDescription)"><CopyOutlined /></button>
                <button v-if="!global.conf?.is_readonly && !descriptionEditing" :disabled="descriptionLoading || descriptionError" aria-label="编辑媒体描述" title="编辑媒体描述" @click="editDescription"><EditOutlined /></button>
                <a-popover v-if="currentItem?.type === 'image' && !global.conf?.is_readonly" v-model:open="aiDescriptionOpen" trigger="click" placement="bottomRight" :z-index="1010">
                  <template #content>
                    <div class="description-ai-confirm" @keydown.stop @keydown.esc="aiDescriptionOpen = false" @wheel.stop>
                      <label for="description-ai-prompt">提示词</label>
                      <a-textarea id="description-ai-prompt" v-model:value="aiDescriptionTemplate" :rows="5" :maxlength="2000" />
                      <div class="description-ai-options"><label for="description-ai-length">建议长度</label><select id="description-ai-length" v-model.number="aiDescriptionLength"><option :value="80">80 字</option><option :value="120">120 字</option><option :value="200">200 字</option></select></div>
                      <p>生成后填入编辑区，保存描述后生效。</p>
                      <div class="description-ai-footer"><a-button size="small" @click="aiDescriptionOpen = false">取消</a-button><a-button size="small" type="primary" :disabled="!aiDescriptionTemplate.trim() || !!aiLoadingTask || descriptionSaving" @click="confirmAiDescription">生成并填入</a-button></div>
                    </div>
                  </template>
                  <button :disabled="!!aiLoadingTask || descriptionSaving || descriptionLoading || descriptionError" aria-label="AI 描述建议" :title="aiLoadingTask === 'description' ? '生成中…' : 'AI 描述建议'"><RobotOutlined :spin="aiLoadingTask === 'description'" /></button>
                </a-popover>
                <button v-if="currentItem?.type === 'audio' || currentItem?.type === 'video'" disabled aria-label="AI 描述建议（暂未开放）" title="AI 描述建议暂未开放"><RobotOutlined /></button>
              </div>
            </div>
            <p v-if="descriptionLoading" class="prompt-empty">正在读取描述…</p>
            <p v-else-if="!descriptionAvailable" class="prompt-empty">加入媒体索引后可填写描述</p>
            <p v-else-if="descriptionError" class="prompt-empty">描述读取失败 <button class="metadata-retry" @click="loadCurrentItemDescription">重试</button></p>
            <template v-else-if="descriptionEditing">
              <textarea v-model="descriptionDraft" class="description-input" maxlength="5000" rows="4" aria-label="媒体描述编辑区" :disabled="aiLoadingTask === 'description' || descriptionSaving"
                :placeholder="isWorkspaceArtifact ? '写下媒体内容或备注；同步到媒体库后可用于搜索' : '写下媒体内容或备注，保存后可通过文字搜索'" />
              <div class="description-actions">

                <button :disabled="descriptionSaving" @click="descriptionEditing = false">取消</button><button :disabled="descriptionSaving || aiLoadingTask === 'description'" @click="saveDescription">{{ descriptionSaving ? '保存中…' : '保存描述' }}</button>
              </div>
            </template>
            <GenerationPromptText v-else-if="imageDescription" :text="imageDescription" label="媒体描述" :disabled="!!global.conf?.is_readonly || descriptionSaving" @edit="editDescription" />
            <button v-else class="metadata-empty" :disabled="global.conf?.is_readonly" @click="editDescription">未填写 · 点击添加描述</button>
          </section>
          <section v-if="currentItem?.type === 'image'" class="panel-section ai-prompt-section">
            <div class="section-title"><span>AI 参考提示词</span>
              <div class="generation-heading-actions">
                <button v-if="aiPromptSaved && !aiPromptEditing" aria-label="复制参考提示词" title="复制参考提示词" @click="copy2clipboardI18n(aiPromptSaved)"><CopyOutlined /></button>
                <button v-if="aiPromptSaved && !aiPromptEditing && !global.conf?.is_readonly" :disabled="!!aiLoadingTask || aiSavingPrompt" aria-label="编辑参考提示词" title="编辑参考提示词" @click="editAiPrompt"><EditOutlined /></button>
              <a-popover v-if="currentItem?.type === 'image'" v-model:open="aiPromptOpen" trigger="click" placement="bottomRight" :z-index="1010">
              <template #content>
                <div class="description-ai-confirm" @keydown.stop @keydown.esc="aiPromptOpen = false" @wheel.stop>
                  <strong>AI 反推参考提示词</strong>
                  <div class="ai-prompt-presets"><a-button size="small" @click="aiPromptTemplate = DEFAULT_IMAGE_PROMPT_ZH">中文</a-button><a-button size="small" @click="aiPromptTemplate = DEFAULT_IMAGE_PROMPT_EN">English</a-button><a-button size="small" @click="aiPromptTemplate = aiPromptDefault">设置默认</a-button></div>
                  <label for="ai-prompt-template">提示词</label><a-textarea id="ai-prompt-template" v-model:value="aiPromptTemplate" :rows="5" :maxlength="2000" />
                  <div class="description-ai-options"><label for="ai-prompt-length">建议长度</label><select id="ai-prompt-length" v-model.number="aiPromptLength"><option :value="300">300 字</option><option :value="600">600 字</option><option :value="1000">1000 字</option></select></div>
                  <p>结果填入参考提示词，与原始生成信息分开保存。</p>
                  <div class="description-ai-footer"><a-button size="small" @click="aiPromptOpen = false">取消</a-button><a-button size="small" type="primary" :disabled="!aiPromptTemplate.trim() || !!aiLoadingTask || aiSavingPrompt" @click="confirmAiPrompt">生成并填入</a-button></div>
                </div>
              </template>
              <button :disabled="!!aiLoadingTask || aiSavingPrompt || !!inlineField" aria-label="AI 反推参考提示词" :title="aiLoadingTask === 'prompt' ? '生成中…' : 'AI 反推参考提示词'"><RobotOutlined :spin="aiLoadingTask === 'prompt'" /></button>
              </a-popover>
              </div>
            </div>
            <p v-if="aiLoadingTask === 'prompt'" class="prompt-empty" role="status">正在生成参考提示词…</p>
            <template v-if="aiPromptEditing">
              <textarea v-model="aiPromptDraft" class="description-input" :disabled="aiSavingPrompt || aiLoadingTask === 'prompt' || global.conf?.is_readonly" maxlength="5000" rows="5" aria-label="编辑参考提示词" placeholder="AI 生成后可编辑" />
              <div class="description-actions">
                <button :disabled="aiSavingPrompt || aiLoadingTask === 'prompt'" @click="cancelAiPrompt">取消</button>
                <button :disabled="global.conf?.is_readonly || aiSavingPrompt || aiLoadingTask === 'prompt' || aiPromptDraft === aiPromptSaved" @click="saveAiPrompt">{{ aiSavingPrompt ? '保存中…' : '保存参考提示词' }}</button>
              </div>
            </template>
            <GenerationPromptText v-else-if="aiPromptSaved" :text="aiPromptSaved" label="参考提示词" :disabled="!!global.conf?.is_readonly || !!aiLoadingTask || aiSavingPrompt" @edit="editAiPrompt" />
            <p v-else-if="aiLoadingTask !== 'prompt'" class="reference-prompt-hint">根据画面反推，独立保存为参考提示词。</p>
          </section>
          </template>
          <template v-else-if="activeDetailsTab === 'generation'">

          <div v-if="promptLoading" class="prompt-empty" role="status">正在读取生成信息…</div>
          <div v-else-if="promptError" class="prompt-empty">读取失败 <button class="metadata-retry" @click="loadCurrentItemPrompt(true)">重试</button></div>
          <div v-else class="generation-sheet">
            <p v-if="!hasGenerationContent && !inlineField" class="generation-empty">暂无生成信息</p>
            <section v-if="modelResources.length || inlineField === '__resource'" class="generation-section generation-resources">
              <div class="generation-heading"><span>使用资源</span><button v-if="canEditInline" :disabled="!!inlineField" aria-label="添加资源" title="添加资源" @click="beginInline('__resource')"><PlusOutlined /></button></div>
              <GenerationResourceForm v-if="inlineField === '__resource'" :saving="inlineSaving" :error="inlineError" @save="saveInline" @cancel="inlineField = ''" />
              <div v-for="(resource, index) in visibleResources" :key="index" class="generation-resource">
                <div class="generation-resource-main"><strong :title="resource.name">{{ resource.name }}</strong><span class="generation-resource-kind">{{ generationResourceLabel(resource.type) }}</span><span v-if="resource.weight != null" class="generation-resource-weight">{{ resource.weight }}</span></div>
                <details v-if="resource.hash" class="generation-resource-hash"><summary>哈希</summary><code>{{ resource.hash }}</code></details>
              </div>
              <button v-if="modelResources.length > 3" class="generation-expand" @click="resourcesExpanded = !resourcesExpanded">{{ resourcesExpanded ? '收起资源' : `展开其余 ${modelResources.length - 3} 项` }}</button>
            </section>
            <section v-for="prompt in visiblePrompts" :key="prompt.key" class="generation-section generation-prompt">
              <div class="generation-heading"><span :title="generationFieldTooltip(prompt.key)">{{ generationFieldLabel(prompt.key) }}</span><div class="generation-heading-actions"><button v-if="geninfoStruct[prompt.key]" :title="`复制${prompt.label}`" :aria-label="`复制${prompt.label}`" @click="copy2clipboardI18n(geninfoStruct[prompt.key] || '')"><CopyOutlined /></button></div></div>
              <MetadataInlineEditor v-if="inlineField === prompt.key" v-model="inlineDraft" :label="generationFieldLabel(prompt.key)" multiline :saving="inlineSaving" :error="inlineError" @save="saveInline" @cancel="inlineField = ''" />
              <GenerationPromptText v-else :text="String(geninfoStruct[prompt.key] ?? '')" :label="prompt.label" :disabled="!canEditInline || !!inlineField" @edit="beginInline(prompt.key)" />
            </section>
            <section v-if="primaryParams.length || inlineParameter" class="generation-section generation-parameters">
              <div class="generation-heading"><span>生成参数</span></div>
              <div class="generation-chips"><button v-for="entry in primaryParams" :key="entry.key" class="generation-chip" :class="{'is-editing':inlineField === entry.key}" :disabled="!canEditInline || !!inlineField" :aria-label="`编辑${entry.key}`" @click="beginInline(entry.key)"><span :title="generationFieldTooltip(entry.key)">{{ generationFieldLabel(entry.key) }}</span><strong>{{ entry.value }}</strong></button></div>
              <div v-if="inlineParameter" class="generation-parameter-editor"><label :title="generationFieldTooltip(inlineField)">{{ generationFieldLabel(inlineField) }}</label><MetadataInlineEditor v-model="inlineDraft" :label="generationFieldLabel(inlineField)" :size="inlineField === 'Size'" :numeric="generationNumberOptions(inlineField)" :placeholder="generationParameterFields.find(field => field.key === inlineField)?.placeholder" :saving="inlineSaving" :error="inlineError" @save="saveInline" @cancel="inlineField = ''" /></div>
            </section>
            <div v-if="comfyWorkflow" class="generation-workflow" :title="`ComfyUI 工作流 · ${comfyWorkflow.nodeCount} 个节点`">
              <span>Comfyui·{{ comfyWorkflow.nodeCount }}</span>
              <button aria-label="复制 ComfyUI 工作流" title="复制工作流 JSON" @click="copy2clipboardI18n(comfyWorkflow.json)"><CopyOutlined /></button>
            </div>
          </div>
          </template>
          <template v-else>
            <section class="panel-section"><div class="section-title">文件信息</div><dl class="file-metadata"><div v-for="entry in fileDetails" :key="entry.label"><dt>{{ entry.label }}</dt><dd>{{ entry.value }}</dd></div></dl></section>
            <section class="panel-section"><div class="section-title">文件元数据</div>
              <p v-if="metadataLoading" class="prompt-empty">正在读取元数据…</p>
              <p v-else-if="metadataError" class="prompt-empty">元数据读取失败 <button class="metadata-retry" @click="loadCurrentItemMetadata(true)">重试</button></p>
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
      <Transition name="studio-open" appear>
        <MediaImageEditor ref="mediaEditor" v-if="editingImage && currentItem?.originalFile" :file="currentItem.originalFile" :readonly="!!global.conf?.is_readonly"
          @exit="previewStore.viewMode = 'preview'" @saved="editorSaved" />
      </Transition>
    </div>
  </Teleport>
  <GenerationInfoEditor :open="editorOpen" :path="editTarget.path" :name="editTarget.name" :raw="editTarget.raw"
    :artifact-id="editTarget.artifactId" raw-only @close="editorOpen = false" @saved="metadataSaved" />
</template>

<style lang="scss" scoped>
.description-input{box-sizing:border-box;width:100%;min-height:90px;resize:vertical;padding:8px;border:1px solid #ffffff30;border-radius:5px;background:#1d2025;color:#e1e5eb;font:inherit;font-size:12px;line-height:1.6;}
.description-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;}.description-actions button{border:1px solid #ffffff30;border-radius:5px;background:#ffffff0a;color:#e1e5eb;padding:5px 9px;cursor:pointer;}.description-actions button:last-child{background:#2868af;border-color:#2868af;color:#fff;}.description-actions button:disabled{opacity:.5;cursor:default;}
.ai-suggestion-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:#aab3c0;}.ai-suggestion-actions label{display:flex;align-items:center;gap:5px;}.ai-suggestion-actions select{background:#1d2025;color:#e1e5eb;border:1px solid #ffffff30;border-radius:4px;padding:4px;}.ai-suggestion-actions button,.ai-suggestion-draft button,.ai-tags button{border:1px solid #447ac077;border-radius:5px;background:#447ac022;color:#a6c9ff;padding:5px 8px;cursor:pointer;font-size:11px;}.ai-suggestion-actions button:disabled,.ai-suggestion-draft button:disabled,.ai-tags button:disabled{opacity:.5;cursor:default;}.ai-suggestion-draft{margin-top:10px;padding:8px;border:1px solid #447ac055;border-radius:6px;font-size:12px;line-height:1.6;color:#dbe7f7;}.ai-suggestion-draft p{margin:0 0 8px;white-space:pre-wrap;}.ai-prompt-section .description-input{margin-top:8px;}.ai-tags{margin-top:12px;}.ai-tag-suggestions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px;}.ai-error{color:#ff9c9c;font-size:11px;padding:5px 12px;}
.prompt-template-presets{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:10px;font-size:11px;color:#aab3c0;}.prompt-template-presets button{border:1px solid #ffffff30;border-radius:5px;background:#ffffff0a;color:#dbe7f7;padding:3px 7px;cursor:pointer;font-size:11px;}.prompt-template-presets button[aria-pressed="true"]{border-color:#447ac0;background:#447ac044;color:#fff;}.prompt-template-presets button:disabled{opacity:.5;cursor:default;}.ai-prompt-section .prompt-template-input{min-height:108px;}.prompt-template-hint{margin:5px 0 0;color:#8994a5;font-size:11px;line-height:1.4;}
.preview-description-overlay{position:absolute;z-index:12;left:24px;right:calc(var(--details-width) + 24px);bottom:126px;width:max-content;max-width:min(70%,680px);max-height:28vh;box-sizing:border-box;margin:auto;padding:10px 16px;overflow:auto;border-radius:8px;background:#000b;color:white;text-align:center;font-size:clamp(14px,1.5vw,21px);line-height:1.55;text-shadow:0 1px 2px #000;white-space:pre-wrap;overflow-wrap:anywhere;}
.preview-tags-panel .details-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px;margin:0 0 12px;padding:3px;border-radius:6px;background:#ffffff0b;flex-shrink:0;}
.details-tabs button{min-width:0;padding:7px 3px;border:0;border-radius:4px;background:transparent;color:#9da6b3;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;}
.details-tabs button.active{background:#3877bb;color:white;}
.details-tabs button:focus-visible{outline:2px solid white;outline-offset:1px;}
.generation-actions{justify-content:flex-end;margin-bottom:10px;}
.preview-tags-panel .persistent-tags{flex-shrink:0;max-height:170px;overflow:auto;padding:12px 2px 2px;border-top:1px solid #ffffff20;}
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

.preview-viewer {
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

  &--mobile {
    .preview-controls {
      bottom: 20px;
      right: 20px;
    }
  }
}

.preview-viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.preview-media-item {
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

.preview-media {
  width: 100%;
  height: 100%;
  margin: auto;
  object-fit: contain;
  border-radius: 0;
}

.preview-navigation {
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
.preview-bottom-overlay {
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

.preview-progress {
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

.preview-tags-panel {
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

.preview-panel-backdrop {
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
  .preview-navigation {
    right: 80px;
  }

  .nav-indicator {
    width: 36px;
    height: 36px;
  }

  .preview-progress {
    bottom: 80px;
    left: 15px;
    right: 15px;
  }

  .preview-tags-panel {
    padding: 15px;
    max-height: 50vh;
  }

  .panel-action-btn {
    width: 32px;
    height: 32px;
  }
}
</style>
<style scoped>
.ai-prompt-presets{display:flex;gap:6px;flex-wrap:wrap;}
.description-actions .description-ai-trigger{margin-right:auto;color:#a6c9ff;border-color:#447ac077;background:#447ac022;}
.description-ai-confirm{width:min(300px,calc(100vw - 64px));display:flex;flex-direction:column;gap:10px;}
.description-ai-confirm>label{font-size:12px;font-weight:600;}
.description-ai-options{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;}
.description-ai-options select{padding:4px 8px;border:1px solid var(--border-color,#d9d9d9);border-radius:6px;background:transparent;color:inherit;}
.description-ai-confirm p{margin:0;font-size:12px;opacity:.65;}
.description-ai-footer{display:flex;justify-content:flex-end;gap:8px;}
.preview-viewer{z-index:900;caret-color:transparent;}
.preview-viewer .preview-controls{top:16px;right:16px;bottom:auto;left:auto;max-width:calc(100% - 32px);}
.preview-viewer .media-content{box-sizing:border-box;height:100%;margin:0;padding:56px 24px 64px;}
.nav-indicator{border:0;}.nav-indicator:focus-visible{outline:2px solid white;outline-offset:3px;}
.preview-image{flex-shrink:0;max-width:none;max-height:none;touch-action:none;will-change:transform;}
.preview-filename{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.preview-loading{position:absolute;top:60px;left:50%;transform:translateX(-50%);color:white;background:#0008;padding:6px 12px;border-radius:6px;}
.preview-viewer .media-content{position:relative;}
.preview-unavailable{position:absolute;z-index:4;max-width:min(360px,calc(100% - 32px));padding:20px;border:1px solid #ffffff40;border-radius:10px;background:#171b20ee;color:#fff;text-align:center;box-shadow:0 8px 32px #0008;}
.preview-unavailable strong{font-size:15px;}.preview-unavailable p{margin:10px 0 16px;color:#c4cbd4;font-size:12px;line-height:1.6;}
.preview-unavailable>div{display:flex;justify-content:center;flex-wrap:wrap;gap:8px;}
.preview-unavailable button{padding:7px 11px;border:1px solid #ffffff50;border-radius:6px;background:#ffffff16;color:#fff;cursor:pointer;}
.preview-unavailable button:first-child{background:#1769c2;border-color:#1769c2;}
.preview-unavailable button:hover{background:#ffffff30;}
.preview-tags-panel .panel-body{user-select:text;}
@media(max-width:650px){.preview-viewer .preview-controls{top:8px;right:8px;max-width:calc(100% - 16px);}}
</style>

<style scoped>
.preview-viewer{--details-width:340px;padding-right:var(--details-width);box-sizing:border-box;}
.preview-viewer .preview-viewport{flex:1;min-height:0;}
.preview-viewer .preview-tags-panel{top:0;right:0;bottom:0;left:auto;width:var(--details-width);max-height:none;padding:16px;border:0;border-left:1px solid #ffffff20;border-radius:0;background:#15171a;box-shadow:none;box-sizing:border-box;}
.preview-tags-panel .panel-header{margin:0 0 14px;padding-bottom:12px;flex-shrink:0;}.preview-tags-panel .panel-title{font-size:14px;gap:8px;}.preview-tags-panel .panel-body{min-height:0;padding:0 2px 20px;}.preview-tags-panel .panel-section{padding:12px;margin-bottom:12px;border-radius:7px;background:#ffffff05;border-color:#ffffff14;}.details-filename{font-size:12px;color:#aaa;overflow-wrap:anywhere;margin-bottom:16px;}.preview-tags-panel .section-title{font-size:12px;margin-bottom:10px;display:flex;align-items:center;gap:6px;color:#bbb;}.section-title button{margin-left:auto;border:0;background:none;color:#bbb;cursor:pointer;}
.prompt-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.8;color:#ddd;margin:0;}.generation-params{margin:0;display:grid;grid-template-columns:minmax(60px,auto) minmax(0,1fr);gap:8px 12px;font-size:12px;}.generation-params dt{color:#aaa;overflow-wrap:anywhere;}.generation-params dd{margin:0;color:#ddd;white-space:pre-wrap;overflow-wrap:anywhere;}.raw-metadata{color:#aaa;font-size:12px;}.raw-metadata summary{cursor:pointer;}.raw-metadata pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#ccc;font-size:11px;}.raw-metadata>button{background:none;border:0;color:#80bfff;cursor:pointer;padding:8px 0;}
.preview-viewer .preview-navigation{left:12px;right:auto;}.preview-viewer .preview-controls{right:calc(var(--details-width) + 16px);max-width:calc(100% - var(--details-width) - 32px);}.preview-viewer .preview-progress{left:20px;right:calc(var(--details-width) + 20px);bottom:12px;}.tags-content>button{font:inherit;font-size:11px!important;padding:4px 9px!important;border-radius:5px!important;margin:0 6px 6px 0!important;}
@media(max-width:900px){.preview-viewer{--details-width:280px;}}
@media(max-width:600px){.preview-viewer{--details-width:42vw;}.preview-viewer .preview-tags-panel{padding:10px;}.preview-tags-panel .panel-section{padding:8px;}.preview-viewer .preview-controls{left:8px;right:calc(var(--details-width) + 8px);max-width:none;}.viewer-controls-bar{gap:1px;padding:3px;}.viewer-controls-bar .control-btn{width:26px;height:26px;font-size:13px;}.control-divider{margin:0 1px;}.generation-params{display:block;}.generation-params dd{margin-bottom:8px;}.preview-viewer .preview-navigation{left:4px;}.preview-viewer .media-content{padding-inline:8px;}}
</style>

<style scoped>.preview-viewer .preview-bottom-overlay{right:var(--details-width);padding-bottom:34px;}.preview-viewer .filename-display{font-size:13px;max-width:100%;}.metadata-actions{display:flex;gap:6px;align-items:center;}.metadata-actions button,.metadata-retry{display:flex;align-items:center;gap:5px;border:0;border-radius:5px;background:#ffffff0a;color:#a6c9ff;padding:5px 7px;font-size:12px;cursor:pointer;}.metadata-actions button:disabled{opacity:.35;cursor:default;}.preview-controls .delete-btn{color:#ff7875;}.preview-tags-panel .section-title small{font-size:10px;color:#737a85;}.metadata-empty{border:0;padding:0;background:none;color:#828995;font-size:12px;cursor:pointer;text-align:left;}.metadata-empty:hover{color:#a6c9ff;}.parameter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:0;}.parameter-grid>div{padding:8px 10px;background:#ffffff06;border:1px solid #ffffff0b;border-radius:6px;min-width:0;}.parameter-grid dt{font-size:10px;color:#9199a6;margin-bottom:4px;}.parameter-grid dd{font:12px/1.5 ui-monospace,monospace;margin:0;color:#e1e5eb;overflow-wrap:anywhere;}.parameter-grid dd.value-empty{font:12px/1.5 inherit;color:#666e7a;}.model-resource{display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:8px 0;overflow-wrap:anywhere;}.model-resource+.model-resource{border-top:1px solid #ffffff12;}.resource-type{font-size:10px;background:#528dca22;color:#a6c9ff;padding:2px 6px;border-radius:4px;}.model-resource strong{font-size:13px;font-weight:500;}.model-resource small{font-size:11px;color:#858d99;}.preview-tags-panel .prompt-text{font-size:12px;line-height:1.7;max-height:220px;overflow:auto;margin:0;white-space:pre-wrap;}.raw-metadata summary{font-size:12px;color:#9199a6;}.raw-metadata .generation-params{margin-top:12px;}@media(max-width:600px){.parameter-grid{grid-template-columns:1fr;}.section-title small{display:none;}}
</style>

<style scoped>
.preview-viewer .preview-tags-panel{background:#1c222a;border-left-color:#ffffff18;color:#e5ebf3;font:13px/1.6 var(--ui-font);}
.preview-tags-panel .panel-header{margin-bottom:10px;padding-bottom:10px;border-bottom-color:#ffffff14;}
.preview-tags-panel .panel-title{font-weight:600;color:#edf3fa;}
.preview-tags-panel .panel-title>.anticon{color:#9fc9ff;}
.preview-tags-panel .details-filename{margin-bottom:14px;color:#aeb9c8;font-size:12px;line-height:1.6;}
.preview-tags-panel .panel-section{padding:14px;border-color:#ffffff12;border-radius:10px;background:#ffffff04;}
.preview-tags-panel .section-title{color:#cbd5e3;font-size:12px;font-weight:600;letter-spacing:0;text-transform:none;}
.preview-tags-panel .details-tabs{gap:4px;padding:4px;margin-bottom:16px;border:1px solid #ffffff12;border-radius:8px;background:#10151c66;}
.preview-tags-panel .details-tabs button{transition:background-color var(--ui-motion-fast) var(--ui-ease),color var(--ui-motion-fast) var(--ui-ease);}
.preview-tags-panel .details-tabs button{border-radius:5px;font:inherit;font-size:12px;color:#aeb9c8;}
.preview-tags-panel .details-tabs button:hover{background:#ffffff0a;color:#edf3fa;}
.preview-tags-panel .details-tabs button.active{background:#6caeff26;color:#a9d2ff;box-shadow:inset 0 0 0 1px #6caeff26;font-weight:500;}
.preview-tags-panel :is(.metadata-actions,.description-actions,.ai-suggestion-actions,.ai-suggestion-draft,.ai-tags) button,.preview-tags-panel .metadata-retry{min-height:30px;box-sizing:border-box;padding:5px 9px;border:1px solid #ffffff20;border-radius:6px;font:inherit;font-size:12px;line-height:18px;}
.preview-tags-panel button:not(:disabled):focus-visible,.preview-tags-panel :is(textarea,select):focus-visible{outline:2px solid #8ac5f7;outline-offset:2px;}
.preview-tags-panel :is(.metadata-actions,.description-actions,.ai-suggestion-actions,.ai-suggestion-draft,.ai-tags) button:not(:disabled):hover{border-color:#8ac5f777;filter:brightness(1.15);}
.preview-tags-panel .section-title>button{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border-radius:5px;}
.preview-tags-panel .section-title>button:hover{background:#ffffff12;}
.preview-tags-panel .description-input{padding:10px;border-color:#ffffff24;border-radius:7px;background:#10151c66;}
.preview-tags-panel .file-metadata>div{display:grid;grid-template-columns:66px minmax(0,1fr);gap:10px;padding:9px 0;}
.preview-tags-panel .file-metadata>div:first-child{padding-top:0;border-top:0;}
.preview-tags-panel .file-metadata dt{padding-top:1px;color:#99a6b8;font-size:12px;}
.preview-tags-panel .file-metadata dd{margin:0;}
.preview-tags-panel .parameter-grid>div{background:#10151c40;border-color:#ffffff0d;}
.preview-tags-panel .persistent-tags{padding-top:14px;border-top-color:#ffffff18;}
.preview-tags-panel .tags-content{gap:6px;}
.preview-tags-panel .tags-content>button{margin:0!important;padding:4px 9px!important;font-weight:400;line-height:18px;transition:background-color .15s,color .15s;}
.preview-unavailable{border-color:#ffffff24;border-radius:var(--ui-radius-lg);background:#202b36ee;}
@media(max-width:600px){.preview-tags-panel .panel-section{padding:9px;}.preview-tags-panel .file-metadata>div{grid-template-columns:1fr;gap:3px;}}
</style>

<style scoped>
.preview-viewer{overflow:clip;transition:padding-right var(--ui-motion) var(--ui-ease);}
.preview-viewer--cropping>.preview-controls{z-index:960;}
@media(max-width:560px){.preview-viewer.preview-viewer--cropping>.preview-controls{left:8px;right:8px;max-width:calc(100% - 16px);}}
.preview-viewer--cropping>.preview-navigation,.preview-viewer--cropping>.preview-progress,.preview-viewer--cropping>.preview-bottom-overlay,.preview-viewer--cropping>.preview-description-overlay{visibility:hidden;pointer-events:none;}
.preview-viewer .preview-tags-panel{transition:transform var(--ui-motion) var(--ui-ease),opacity var(--ui-motion) var(--ui-ease),visibility 0s;}
.preview-viewer .preview-controls,.preview-viewer .preview-progress,.preview-viewer .preview-bottom-overlay,.preview-description-overlay{transition:right var(--ui-motion) var(--ui-ease);}
.preview-viewer.preview-viewer--details-collapsed{padding-right:0;}
.preview-viewer--details-collapsed .preview-tags-panel,.preview-viewer--cropping .preview-tags-panel{transform:translateX(100%);opacity:0;visibility:hidden;pointer-events:none;transition:transform var(--ui-motion) var(--ui-ease),opacity var(--ui-motion) var(--ui-ease),visibility 0s var(--ui-motion);}
.preview-viewer--details-collapsed:not(.preview-viewer--cropping) .preview-controls{left:auto;right:16px;max-width:calc(100% - 32px);}
.preview-viewer--details-collapsed .preview-progress{right:20px;}
.preview-viewer--details-collapsed .preview-bottom-overlay{right:0;}
.preview-viewer--details-collapsed .preview-description-overlay{right:24px;max-width:calc(100% - 48px);}
.details-collapse{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;flex-shrink:0;padding:0;border:1px solid #ffffff18;border-radius:6px;background:transparent;color:#b9c6d6;font:inherit;font-size:14px;cursor:pointer;transition:background-color var(--ui-motion-fast) var(--ui-ease),border-color var(--ui-motion-fast) var(--ui-ease);}
.details-collapse:hover{background:#ffffff12;border-color:#ffffff30;}
.details-collapse:focus-visible{outline:2px solid #8ac5f7;outline-offset:2px;}
@media(max-width:650px){.preview-viewer--details-collapsed:not(.preview-viewer--cropping) .preview-controls{right:8px;max-width:calc(100% - 16px);}.preview-viewer--details-collapsed .preview-description-overlay{right:8px;max-width:calc(100% - 16px);}}
@media(prefers-reduced-motion:reduce){.preview-viewer,.preview-viewer .preview-tags-panel,.preview-viewer .preview-controls,.preview-viewer .preview-progress,.preview-viewer .preview-bottom-overlay,.preview-description-overlay,.details-collapse{transition:none;}}
</style>

<style scoped>
.preview-audio-container{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;width:100%;height:100%;padding:24px;overflow:hidden;background:linear-gradient(145deg,#253745,#121a24);box-sizing:border-box}
.audio-stage{display:flex;align-items:center;justify-content:center;gap:clamp(20px,4vw,48px);width:min(100%,900px);min-height:0;max-height:calc(100% - 94px)}
.audio-cover-frame{display:grid;place-items:center;flex:none;width:clamp(160px,28vw,320px);aspect-ratio:1;border:1px solid #ffffff24;border-radius:16px;overflow:hidden;background:#354653;box-shadow:0 18px 50px #0006}
.audio-cover-frame img{display:block;width:100%;height:100%;object-fit:contain}
.audio-cover-fallback{font-size:clamp(60px,9vw,120px);color:#8ac5f7}
.audio-text{display:flex;flex-direction:column;gap:10px;min-width:0;max-width:420px;max-height:100%;color:#edf3f8}
.audio-text h2{margin:0;font-size:clamp(19px,2vw,28px);line-height:1.25;overflow-wrap:anywhere}
.audio-text>p{margin:0;color:#c5d2df;font-size:13px}
.audio-lyrics{position:relative;min-height:0;max-height:min(32vh,280px);overflow:auto;overscroll-behavior:contain;padding:8px 6px 8px 0;scrollbar-width:thin}
.audio-lyrics p,.audio-lyrics button{display:block;width:100%;margin:0 0 8px;padding:4px 7px;border:0;border-radius:6px;background:none;color:#c5d2df;text-align:left;font:inherit;font-size:14px;line-height:1.6;white-space:pre-wrap}
.audio-lyrics button{cursor:pointer}
.audio-lyrics button:hover,.audio-lyrics button.active{background:#ffffff16;color:white}
.audio-lyrics button:focus-visible{outline:2px solid #8ac5f7;outline-offset:1px}
.preview-audio-container .preview-audio{flex:none;width:min(100%,760px);max-width:100%;height:54px}
.preview-tags-panel .metadata-actions button,.preview-tags-panel .metadata-retry,.preview-tags-panel .raw-metadata>button,.preview-tags-panel .resource-type,.preview-tags-panel .metadata-empty:hover{color:#8ac5f7}
.preview-tags-panel .resource-type{background:#8ac5f722}
@media(max-width:680px){.preview-audio-container{gap:12px;padding:10px}.audio-stage{flex-direction:column;gap:14px;max-height:calc(100% - 80px)}.audio-cover-frame{width:min(40vw,180px)}.audio-text{width:100%;text-align:center}.audio-text h2{font-size:17px}.audio-lyrics{max-height:22vh}.audio-lyrics p,.audio-lyrics button{text-align:center;font-size:12px}}
@media(prefers-reduced-motion:reduce){.audio-lyrics{scroll-behavior:auto}}
</style>

<style scoped>
.studio-open-enter-active,.studio-open-leave-active{transition:opacity .18s ease,transform .18s ease}
.studio-open-enter-from,.studio-open-leave-to{opacity:0;transform:translateY(12px)}
@media(prefers-reduced-motion:reduce){.studio-open-enter-active,.studio-open-leave-active{transition:none}}
</style>
