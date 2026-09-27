import { isAxiosError } from 'axios'
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { tagLabel } from '@/features/media-library/public'
import { ref, computed, watch } from 'vue'
import {
  useMediaPreviewStore,
  type MediaPreviewItem
} from '@/features/media-preview/model/useMediaPreviewStore'
import { useTagStore } from '@/features/media-library/public'
import { useApplicationStore } from '@/features/application/public'
import { useLocalStorage } from '@vueuse/core'

import {
  getImageDescription,
  toggleCustomTagToImg,
  updateImageDescription
} from '@/features/media-library/public'
import {
  getWorkspaceArtifactMetadata,
  toggleWorkspaceArtifactTag,
  updateWorkspaceArtifactMetadata
} from '@/features/workspaces/public'
import {
  getImageExif,
  getImageGenerationInfo,
  updateExif
} from '@/features/generation-metadata/public'
import { getInferredPrompt, saveInferredPrompt } from '@/features/ai-workflows/public'
import {
  DEFAULT_IMAGE_DESCRIPTION,
  DEFAULT_IMAGE_PROMPT_EN,
  generateImageAIText,
  getImageAIConfig,
  type ImageAITask
} from '@/features/ai-workflows/public'

import { findComfyWorkflow } from '@/features/generation-metadata/public'
import {
  generationParameterFields,
  validateGenerationParameter
} from '@/features/generation-metadata/public'

import { parse } from '@/features/generation-metadata/public'
import {
  copyableGenerationInfo,
  appendGenerationResource,
  type GenerationResource
} from '@/features/generation-metadata/public'
import { generationDetails } from '@/features/generation-metadata/public'
import {
  readGenerationDraft,
  writeGenerationDraft,
  readParameter,
  setParameter
} from '@/features/generation-metadata/public'
import { message } from 'ant-design-vue'

import { t } from '@/shared/i18n/index'
import type { StyleValue } from 'vue'

import type { ComputedRef } from 'vue'

/** Owns the metadata edit session and invalidates all pending saves when media changes. */
export function usePreviewMetadata(currentItem: ComputedRef<MediaPreviewItem | null>) {
  const previewStore = useMediaPreviewStore()
  const tagStore = useTagStore()
  const global = useApplicationStore()
  const isWorkspaceArtifact = computed(
    () => !!currentItem.value?.originalFile?.workspace_artifact_id
  )
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
  const editTarget = ref<{ path: string; name: string; raw: string; artifactId?: string }>({
    path: '',
    name: '',
    raw: ''
  })
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
  const aiPromptTemplate = useLocalStorage(
    'omnigallery:preview:ai-prompt-template',
    DEFAULT_IMAGE_PROMPT_EN
  )
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

  const isTagSelected = (tagId: string | number) => {
    if (isWorkspaceArtifact.value) return artifactTagIds.value.includes(Number(tagId))
    const currentUrl = currentItem.value?.url
    if (!currentUrl) return false

    const fullpath = currentItem.value?.fullpath || currentItem.value?.id
    return !!tagStore.tagMap.get(fullpath)?.some((v) => v.id === tagId)
  }

  // Like 标签相关
  const likeTag = computed(() => {
    return global.conf?.all_custom_tags?.find((v) => v.type === 'custom' && v.name === 'like')
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
          artifactTagIds.value = is_remove
            ? artifactTagIds.value.filter((value) => value !== Number(tagId))
            : [...artifactTagIds.value, Number(tagId)]
        }
        const tag =
          global.conf?.all_custom_tags.find((value) => value.id === tagId)?.name || t('tag')
        message.success(t(is_remove ? 'removedTagFromImage' : 'addedTagToImage', { tag }))
        return
      }
      const fullpath = currentItem.value?.fullpath || currentItem.value?.id

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
  const comfyWorkflow = computed(() =>
    findComfyWorkflow(imageExif.value, geninfoStruct.value.extraJsonMetaInfo, imageGenInfo.value)
  )
  const copyableGenInfo = computed(() => copyableGenerationInfo(imageGenInfo.value || ''))
  const generationView = computed(() =>
    generationDetails(geninfoStruct.value, undefined, undefined, false)
  )
  const primaryParams = computed(() =>
    generationView.value.primary.filter((entry) => entry.value.trim() !== '')
  )
  const modelResources = computed(() => generationView.value.resources)
  const visibleResources = computed(() =>
    resourcesExpanded.value ? modelResources.value : modelResources.value.slice(0, 3)
  )
  const promptFields = [
    { key: 'prompt', label: '正向提示词' },
    { key: 'negativePrompt', label: '负向提示词' }
  ]
  const visiblePrompts = computed(() =>
    promptFields.filter(
      (field) =>
        String(geninfoStruct.value[field.key] ?? '').trim() || inlineField.value === field.key
    )
  )
  const generationFields = [...promptFields, ...generationParameterFields]
  const missingGenerationFields = computed(() =>
    generationFields.filter((field) => {
      if (field.key === 'prompt' || field.key === 'negativePrompt')
        return !String(geninfoStruct.value[field.key] ?? '').trim()
      return !primaryParams.value.some((entry) => entry.key === field.key)
    })
  )
  const inlineParameter = computed(
    () =>
      inlineField.value && !['prompt', 'negativePrompt', '__resource'].includes(inlineField.value)
  )
  const hasGenerationContent = computed(
    () =>
      modelResources.value.length ||
      visiblePrompts.value.length ||
      primaryParams.value.length ||
      imageGenInfo.value.trim() ||
      comfyWorkflow.value
  )
  const canEditInline = computed(
    () =>
      !global.conf?.is_readonly &&
      !promptLoading.value &&
      !promptError.value &&
      !generationDraft.value.rawPreferred
  )
  function beginInline(field: string) {
    if (!canEditInline.value || inlineSaving.value || inlineField.value) return
    const draft = readGenerationDraft(imageGenInfo.value)
    inlineDraft.value =
      field === 'prompt'
        ? draft.positive
        : field === 'negativePrompt'
          ? draft.negative
          : readParameter(draft.parameters, field)
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
        draft.parameters = setParameter(
          draft.parameters,
          inlineField.value,
          inlineField.value === 'Size' ? inlineDraft.value.replace(/×/g, 'x') : inlineDraft.value
        )
      }
      const raw = resource
        ? appendGenerationResource(imageGenInfo.value, resource)
        : writeGenerationDraft(draft)
      if (item.originalFile?.workspace_artifact_id)
        await updateWorkspaceArtifactMetadata(item.originalFile.workspace_artifact_id, {
          generation_info: raw
        })
      else await updateExif(path, raw)
      if (
        request === inlineSaveRequest &&
        (currentItem.value?.fullpath || currentItem.value?.id) === path
      ) {
        imageGenInfo.value = raw
        inlineField.value = ''
      }
      message.success('生成信息已保存')
    } catch (error) {
      if (
        request === inlineSaveRequest &&
        (currentItem.value?.fullpath || currentItem.value?.id) === path
      )
        inlineError.value = getErrorMessage(error, '保存失败，请重试')
    } finally {
      if (request === inlineSaveRequest) inlineSaving.value = false
    }
  }
  function confirmAiPrompt() {
    if (!aiPromptTemplate.value.trim() || aiLoadingTask.value) return
    aiPromptOpen.value = false
    void generateAiSuggestion('prompt')
  }

  const loadCurrentArtifactMetadata = async (force = false) => {
    const id = previewStore.currentItem?.originalFile?.workspace_artifact_id
    if (!id || (!force && (artifactMetadataLoaded === id || metadataLoading.value))) return
    const requestId = ++artifactMetadataRequestId
    descriptionAvailable.value = true
    promptLoading.value = descriptionLoading.value = metadataLoading.value = true
    promptError.value = descriptionError.value = metadataError.value = false
    try {
      const result = await getWorkspaceArtifactMetadata(id)
      if (
        requestId !== artifactMetadataRequestId ||
        previewStore.currentItem?.originalFile?.workspace_artifact_id !== id
      )
        return
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

    const fullpath = currentItem?.fullpath || currentItem.id
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
    const fullpath = currentItem?.fullpath || currentItem.id
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
    } catch (error) {
      if (requestId === descriptionRequestId) {
        if (isAxiosError(error) && error.response?.status === 404)
          descriptionAvailable.value = false
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
    if (
      global.conf?.is_readonly ||
      !descriptionAvailable.value ||
      descriptionLoading.value ||
      descriptionError.value
    )
      return
    descriptionDraft.value = imageDescription.value
    descriptionEditing.value = true
  }

  watch(
    descriptionEditing,
    (editing) => {
      if (editing) return
      aiDescriptionOpen.value = false
      if (aiLoadingTask.value === 'description') {
        aiRequestId++
        aiLoadingTask.value = undefined
      }
    },
    { flush: 'sync' }
  )

  function confirmAiDescription() {
    if (
      !aiDescriptionTemplate.value.trim() ||
      descriptionSaving.value ||
      aiLoadingTask.value ||
      global.conf?.is_readonly ||
      !descriptionAvailable.value ||
      descriptionLoading.value ||
      descriptionError.value
    )
      return
    if (!descriptionEditing.value) editDescription()
    aiDescriptionOpen.value = false
    void generateAiSuggestion('description')
  }

  const saveDescription = async () => {
    const path = currentItem.value?.fullpath || currentItem.value?.id
    if (
      !path ||
      descriptionSaving.value ||
      global.conf?.is_readonly ||
      aiLoadingTask.value === 'description'
    )
      return
    const request = ++descriptionSaveRequest
    descriptionSaving.value = true
    try {
      const artifactId = currentItem.value?.originalFile?.workspace_artifact_id
      const result = artifactId
        ? await updateWorkspaceArtifactMetadata(artifactId, { description: descriptionDraft.value })
        : await updateImageDescription(path, descriptionDraft.value)
      if (
        request === descriptionSaveRequest &&
        (currentItem.value?.fullpath || currentItem.value?.id) === path
      ) {
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
    } catch {
      /* A file outside the indexed library has no saved note. */
    }
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
    } catch {
      /* Generation displays the API error if the service is unavailable. */
    }
  }

  async function generateAiSuggestion(task: ImageAITask) {
    const path = currentItem.value?.fullpath || currentItem.value?.id
    if (!path || currentItem.value?.type !== 'image' || aiLoadingTask.value) return
    if (
      task === 'description' &&
      (!descriptionEditing.value || descriptionSaving.value || global.conf?.is_readonly)
    )
      return
    const request = ++aiRequestId
    aiError.value = ''
    aiLoadingTask.value = task
    try {
      const tags = (global.conf?.all_custom_tags ?? []).map((tag) => tag.name).slice(0, 80)
      const result = await generateImageAIText(
        path,
        task,
        task === 'description'
          ? aiDescriptionLength.value
          : task === 'prompt'
            ? aiPromptLength.value
            : 120,
        task === 'tags' ? tags : [],
        task === 'prompt'
          ? aiPromptTemplate.value.trim()
          : task === 'description'
            ? aiDescriptionTemplate.value.trim()
            : undefined
      )
      if (
        request !== aiRequestId ||
        (currentItem.value?.fullpath || currentItem.value?.id) !== path
      )
        return
      if (task === 'description' && descriptionEditing.value) descriptionDraft.value = result.text
      else if (task === 'prompt') {
        aiPromptDraft.value = result.text
        aiPromptEditing.value = true
      } else aiTagSuggestions.value = result.tags
    } catch (cause) {
      if (request === aiRequestId) aiError.value = getErrorMessage(cause, 'AI 分析失败')
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
    if (
      !path ||
      aiSavingPrompt.value ||
      aiLoadingTask.value === 'prompt' ||
      global.conf?.is_readonly
    )
      return
    const request = ++aiPromptSaveRequest
    aiError.value = ''
    aiSavingPrompt.value = true
    try {
      const artifactId = currentItem.value?.originalFile?.workspace_artifact_id
      const saved = artifactId
        ? (
            await updateWorkspaceArtifactMetadata(artifactId, {
              inferred_prompt: aiPromptDraft.value
            })
          ).inferred_prompt
        : await saveInferredPrompt(path, aiPromptDraft.value)
      if (
        request === aiPromptSaveRequest &&
        (currentItem.value?.fullpath || currentItem.value?.id) === path
      ) {
        aiPromptDraft.value = aiPromptSaved.value = saved
        aiPromptEditing.value = false
      }
      if (request === aiPromptSaveRequest) message.success('参考提示词已保存')
    } catch (cause) {
      if (request === aiPromptSaveRequest)
        aiError.value = getErrorMessage(cause, '保存参考提示词失败')
    } finally {
      if (request === aiPromptSaveRequest) aiSavingPrompt.value = false
    }
  }

  function applyAiTag(name: string) {
    const tag = global.conf?.all_custom_tags.find((tag) => tag.name === name)
    if (tag && !isTagSelected(tag.id)) void onTagClick(tag.id)
  }
  function suggestedTagLabel(name: string) {
    return tagLabel(global.conf?.all_custom_tags.find((tag) => tag.name === name) ?? { name })
  }

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

  let promptRequestId = 0
  let descriptionRequestId = 0

  return {
    imageGenInfo,
    artifactTagIds,
    promptLoading,
    promptError,
    editorOpen,
    editTarget,
    imageDescription,
    descriptionDraft,
    descriptionLoading,
    descriptionSaving,
    descriptionEditing,
    descriptionAvailable,
    descriptionError,
    aiDescriptionLength,
    aiDescriptionOpen,
    aiDescriptionTemplate,
    aiDescriptionDefault,
    aiPromptDraft,
    aiPromptSaved,
    aiPromptEditing,
    aiPromptOpen,
    aiPromptLength,
    inlineField,
    inlineDraft,
    inlineSaving,
    inlineError,
    addGenerationFieldOpen,
    resourcesExpanded,
    aiPromptTemplate,
    aiPromptDefault,
    aiTagSuggestions,
    aiLoadingTask,
    aiSavingPrompt,
    aiError,
    imageExif,
    metadataLoading,
    metadataError,
    isTagSelected,
    likeTag,
    isLiked,
    toggleLike,
    onTagClick,
    tagBaseStyle,
    generationDraft,
    geninfoStruct,
    comfyWorkflow,
    copyableGenInfo,
    generationView,
    primaryParams,
    modelResources,
    visibleResources,
    promptFields,
    visiblePrompts,
    generationFields,
    missingGenerationFields,
    inlineParameter,
    hasGenerationContent,
    canEditInline,
    loadCurrentArtifactMetadata,
    loadCurrentItemTags,
    loadCurrentItemPrompt,
    loadCurrentItemDescription,
    loadCurrentItemMetadata,
    editDescription,
    saveDescription,
    beginInline,
    saveInline,
    confirmAiPrompt,
    confirmAiDescription,
    loadInferredPrompt,
    refreshAiPromptDefault,
    generateAiSuggestion,
    editAiPrompt,
    cancelAiPrompt,
    saveAiPrompt,
    applyAiTag,
    suggestedTagLabel,
    resetMetadataSession,
    isWorkspaceArtifact
  }
}
