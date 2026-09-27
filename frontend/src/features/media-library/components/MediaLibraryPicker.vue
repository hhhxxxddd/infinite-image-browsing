<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'

import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { cloneDeep } from 'lodash-es'
import { message } from 'ant-design-vue'
import { AudioOutlined, EyeOutlined } from '@ant-design/icons-vue'
import {
  getDbBasicInfo,
  getImagesBySubstr,
  type SearchFilters,
  type Tag
} from '@/features/media-library/api/library'
import type { FileNodeInfo } from '@/features/media-library/api/files'
import {
  getQwenStatus,
  searchQwen,
  startQwenIndex,
  type QwenResult,
  type QwenStatus
} from '@/features/ai-workflows/public'
import {
  isAudioFile,
  isImageFile,
  isVideoFile,
  toImageThumbnailUrl,
  toImageUrl,
  toStreamAudioUrl,
  toStreamVideoUrl,
  toVideoCoverUrl
} from '@/features/media-library/model/mediaFiles'
import { fileDisplayName } from '@/shared/lib/fileDisplayName'
import { useApplicationStore } from '@/features/application/public'
import MediaSearchBox from './MediaSearchBox.vue'
import MediaQuickLook from '../../media-preview/components/MediaQuickLook.vue'
import MediaTypeBadge from './MediaTypeBadge.vue'
import SimilarityMethodControl from './SimilarityMethodControl.vue'
import LibraryFilterFields from '@/features/media-library/components/LibraryFilterFields.vue'
import {
  emptySearchFilters,
  describeSearchFilters
} from '@/features/media-library/model/searchFilters'
import { useSimilaritySearch } from '@/features/media-library/model/useSimilaritySearch'
import { navigate } from '@/features/application/public'

const props = defineProps<{
  title: string
  multiple?: boolean
  imagesOnly?: boolean
  saving?: boolean
  confirmText?: string
  explanation?: string
}>()
const emit = defineEmits<{
  close: []
  select: [file: FileNodeInfo]
  confirm: [files: FileNodeInfo[]]
}>()
const global = useApplicationStore()
const pickerQuery = ref('')
const pickerSemanticInput = ref('')
const pickerSemanticMode = ref(false)
const pickerSearchInput = computed({
  get: () => (pickerSemanticMode.value ? pickerSemanticInput.value : pickerQuery.value),
  set: (value: string) => {
    if (pickerSemanticMode.value) pickerSemanticInput.value = value
    else pickerQuery.value = value
  }
})
const pickerLoading = ref(false)
const pickerError = ref('')
const candidates = ref<FileNodeInfo[]>([])
const pickerCursor = ref('')
const pickerHasMore = ref(false)
const pickerFilters = ref<SearchFilters>(emptySearchFilters())
const pickerDraftFilters = ref<SearchFilters>(emptySearchFilters())
const pickerFiltersValid = ref(true)
const pickerFilterOpen = ref(false)
const pickerTags = ref<Tag[]>([])
const pickerFilterSummary = computed(() =>
  describeSearchFilters(pickerFilters.value, pickerTags.value)
)
const pickerSemanticResult = ref<QwenResult>()
const pickerSemanticLoading = ref(false)
const pickerSemanticError = ref('')
const pickerSemanticStatus = ref<QwenStatus>()
const pickerRerankerStatus = ref<QwenStatus>()
const pickerRerank = ref(false)
let pickerSemanticRequest = 0
let pickerStatusTimer: ReturnType<typeof setInterval> | undefined
const {
  reference: pickerReference,
  method: pickerSimilarityMethod,
  chooseMethod: choosePickerSimilarityMethod,
  minimum: pickerMinimum,
  loading: pickerSimilarityLoading,
  error: pickerSimilarityError,
  result: pickerSimilarityResult,
  clear: clearPickerSimilarity,
  chooseFile: choosePickerImage,
  choosePath: choosePickerPath,
  search: searchPickerSimilar
} = useSimilaritySearch(() => pickerFilters.value)
const visibleCandidates = computed(() =>
  (pickerReference.value
    ? (pickerSimilarityResult.value?.files ?? [])
    : pickerSemanticMode.value && pickerSemanticInput.value.trim()
      ? (pickerSemanticResult.value?.files ?? [])
      : candidates.value
  ).filter((file) => !props.imagesOnly || isImageFile(file.name))
)
const pickerBusy = computed(() =>
  pickerReference.value
    ? pickerSimilarityLoading.value
    : pickerSemanticMode.value
      ? pickerSemanticLoading.value
      : pickerLoading.value
)
const activePickerError = computed(() =>
  pickerReference.value
    ? pickerSimilarityError.value
    : pickerSemanticMode.value
      ? pickerSemanticError.value
      : pickerError.value
)
watch([pickerSemanticMode, pickerReference, pickerSimilarityMethod], () => {
  clearInterval(pickerStatusTimer)
  pickerStatusTimer = undefined
  if (!(
    pickerSemanticMode.value ||
    (pickerReference.value && pickerSimilarityMethod.value === 'qwen')
  ))
    return
  void refreshPickerStatus()
  pickerStatusTimer = setInterval(() => void refreshPickerStatus(), 10000)
})
onBeforeUnmount(() => {
  clearInterval(pickerStatusTimer)
  pickerRequest++
  pickerSemanticRequest++
})
const selectedCandidates = ref<FileNodeInfo[]>([])
const selectedPaths = computed(() => selectedCandidates.value.map((file) => file.fullpath))
type QuickLookItem = { src: string; name: string; kind: 'image' | 'video' | 'audio' }
const quickLook = ref<QuickLookItem>()
let quickLookTrigger: HTMLElement | null = null
function previewCandidate(file: FileNodeInfo, event: MouseEvent) {
  quickLookTrigger = event.currentTarget as HTMLElement
  const kind = isAudioFile(file.name) ? 'audio' : isVideoFile(file.name) ? 'video' : 'image'
  quickLook.value = {
    name: fileDisplayName(file.name),
    kind,
    src:
      kind === 'audio'
        ? toStreamAudioUrl(file)
        : kind === 'video'
          ? toStreamVideoUrl(file)
          : toImageUrl(file)
  }
}
function previewReference(event: MouseEvent) {
  const reference = pickerReference.value
  if (!reference?.preview) return
  quickLookTrigger = event.currentTarget as HTMLElement
  const src = reference.path
    ? toImageUrl({ name: reference.name, fullpath: reference.path, date: '' } as FileNodeInfo)
    : reference.preview
  quickLook.value = { src, name: fileDisplayName(reference.name), kind: 'image' }
}
function closeQuickLook() {
  quickLook.value = undefined
  void nextTick(() => {
    if (quickLookTrigger?.isConnected) quickLookTrigger.focus()
  })
}
let pickerRequest = 0
async function searchCandidates(more = false) {
  const request = ++pickerRequest
  pickerLoading.value = true
  pickerError.value = ''
  try {
    const result = await getImagesBySubstr({
      ...pickerFilters.value,
      surstr: pickerQuery.value.trim(),
      regexp: '',
      cursor: more ? pickerCursor.value : '',
      media_type: props.imagesOnly ? 'image' : 'all',
      size: 60,
      manual_order: true
    })
    if (request === pickerRequest) {
      candidates.value = more
        ? [...candidates.value, ...result.files.filter((file) => file.type === 'file')]
        : result.files.filter((file) => file.type === 'file')
      pickerCursor.value = result.cursor.next
      pickerHasMore.value = result.cursor.has_next
    }
  } catch (error) {
    if (request === pickerRequest)
      pickerError.value = getErrorMessage(error, '读取媒体库失败，请重试')
  } finally {
    if (request === pickerRequest) pickerLoading.value = false
  }
}
async function refreshPickerStatus() {
  try {
    const [embedding, reranker] = await Promise.all([
      getQwenStatus('embedding'),
      getQwenStatus('reranker')
    ])
    pickerSemanticStatus.value = embedding
    pickerRerankerStatus.value = reranker
  } catch {
    pickerSemanticError.value = '无法检查画面搜索状态'
  }
}
async function updatePickerIndex() {
  try {
    await startQwenIndex()
    await refreshPickerStatus()
  } catch (error) {
    pickerSemanticError.value = getErrorMessage(error, '更新索引失败')
  }
}
async function searchPickerSemantic() {
  const query = pickerSemanticInput.value.trim()
  const request = ++pickerSemanticRequest
  pickerSemanticError.value = ''
  pickerSemanticResult.value = undefined
  pickerSemanticLoading.value = false
  clearPickerSimilarity()
  if (!query) return
  pickerSemanticLoading.value = true
  try {
    const result = await searchQwen(query, pickerFilters.value, pickerRerank.value)
    if (request === pickerSemanticRequest) pickerSemanticResult.value = result
  } catch (error) {
    if (request === pickerSemanticRequest)
      pickerSemanticError.value = getErrorMessage(error, '画面搜索失败')
  } finally {
    if (request === pickerSemanticRequest) pickerSemanticLoading.value = false
  }
}
function submitPickerSearch() {
  if (pickerSemanticMode.value) void searchPickerSemantic()
  else {
    clearPickerSimilarity()
    void searchCandidates()
  }
}
function changePickerMode(semantic: boolean) {
  pickerSemanticMode.value = semantic
  if (semantic) {
    clearPickerSimilarity()
    void refreshPickerStatus()
  } else {
    pickerSemanticRequest++
    pickerSemanticResult.value = undefined
    pickerSemanticError.value = ''
    pickerSemanticLoading.value = false
  }
}
function choosePickerReference(file: File) {
  choosePickerImage(file)
  void refreshPickerStatus()
}
function choosePickerReferencePath(path: string) {
  choosePickerPath(path)
  void refreshPickerStatus()
}
function applyPickerExample(query: string) {
  pickerSearchInput.value = query
  submitPickerSearch()
}
function applyPickerFilters() {
  if (!pickerFiltersValid.value) {
    message.warning('请完整填写有效的尺寸或比例')
    return
  }
  pickerFilters.value = cloneDeep(pickerDraftFilters.value)
  pickerFilterOpen.value = false
  if (pickerReference.value) void searchPickerSimilar()
  else submitPickerSearch()
}
function togglePickerFilters() {
  if (!pickerFilterOpen.value) pickerDraftFilters.value = cloneDeep(pickerFilters.value)
  pickerFilterOpen.value = !pickerFilterOpen.value
}
onMounted(() => {
  void searchCandidates()
  void getDbBasicInfo(false)
    .then((info) => {
      pickerTags.value = info.tags
    })
    .catch(() => {})
})
function toggleCandidate(file: FileNodeInfo) {
  if (!props.multiple) {
    emit('select', file)
    return
  }
  selectedCandidates.value = selectedPaths.value.includes(file.fullpath)
    ? selectedCandidates.value.filter((item) => item.fullpath !== file.fullpath)
    : [...selectedCandidates.value, file]
}
</script>

<template>
  <a-modal
    :open="true"
    :width="680"
    :title="title"
    :confirm-loading="saving"
    :keyboard="!quickLook"
    :mask-closable="!quickLook"
    :footer="multiple ? undefined : null"
    :ok-text="confirmText || '添加'"
    cancel-text="取消"
    :ok-button-props="{ disabled: selectedPaths.length === 0 }"
    @ok="emit('confirm', selectedCandidates)"
    @cancel="emit('close')"
  >
    <div class="picker-body">
      <p v-if="explanation" class="picker-explanation">{{ explanation }}</p>
      <MediaSearchBox
        v-model="pickerSearchInput"
        :semantic-mode="pickerSemanticMode"
        help-first
        :label="imagesOnly ? '搜索媒体库图片' : '搜索媒体库'"
        @submit="submitPickerSearch"
        @mode-change="changePickerMode"
        @image-file="choosePickerReference"
        @image-path="choosePickerReferencePath"
        @example="applyPickerExample"
      />
      <div class="picker-options">
        <button
          type="button"
          class="picker-filter-toggle"
          :aria-expanded="pickerFilterOpen"
          @click="togglePickerFilters"
        >
          {{ imagesOnly ? '筛选图片' : '筛选媒体'
          }}{{ pickerFilterSummary ? ` · ${pickerFilterSummary}` : '' }}
        </button>
        <span v-if="pickerSemanticMode && !pickerReference" class="picker-mode-label"
          >AI 画面搜索</span
        >
        <span v-else-if="pickerReference" class="picker-mode-label">以图搜图</span>
      </div>
      <div v-if="pickerFilterOpen" class="picker-filter-panel">
        <LibraryFilterFields
          v-model="pickerDraftFilters"
          :tags="pickerTags"
          :disabled="pickerBusy"
          @validity="pickerFiltersValid = $event"
        />
        <div class="picker-filter-actions">
          <a-button size="small" @click="pickerDraftFilters = emptySearchFilters()"
            >清空筛选</a-button
          ><a-button
            size="small"
            type="primary"
            :disabled="!pickerFiltersValid"
            @click="applyPickerFilters"
            >应用筛选</a-button
          >
        </div>
      </div>
      <div v-if="pickerSemanticMode && !pickerReference" class="picker-search-settings">
        <template v-if="pickerSemanticStatus?.state === 'ready'"
          ><label
            >AI 重排
            <a-switch
              v-model:checked="pickerRerank"
              size="small"
              :disabled="pickerRerankerStatus?.state !== 'ready'" /></label
          ><span
            >已索引 {{ pickerSemanticStatus.indexed_count }} /
            {{ pickerSemanticStatus.image_count }}</span
          ><a-button
            size="small"
            :loading="pickerSemanticStatus.running"
            :disabled="global.conf?.is_readonly"
            @click="updatePickerIndex"
            >更新索引</a-button
          ></template
        >
        <template v-else
          ><span>{{ pickerSemanticStatus ? '画面搜索未就绪' : '正在检查画面搜索…' }}</span
          ><a-button v-if="pickerSemanticStatus" size="small" @click="navigate('global-setting')"
            >打开设置</a-button
          ></template
        >
      </div>
      <div v-if="pickerReference" class="picker-search-settings picker-reference">
        <button
          v-if="pickerReference.preview"
          type="button"
          class="picker-reference-preview"
          :aria-label="`查看参考图片：${pickerReference.name}`"
          @click="previewReference"
        >
          <img :src="pickerReference.preview" alt="" /></button
        ><span :title="pickerReference.name">{{ pickerReference.name }}</span
        ><SimilarityMethodControl
          :model-value="pickerSimilarityMethod"
          @update:model-value="choosePickerSimilarityMethod"
        /><label
          >最低分 <input v-model.number="pickerMinimum" type="range" min="0" max="100" step="5" />{{
            pickerMinimum
          }}</label
        ><a-button
          v-if="
            pickerSimilarityMethod === 'qwen' &&
            pickerSemanticStatus?.state === 'ready' &&
            (pickerSemanticStatus.indexed_count ?? 0) < (pickerSemanticStatus.image_count ?? 0)
          "
          size="small"
          :disabled="global.conf?.is_readonly"
          :loading="pickerSemanticStatus.running"
          @click="updatePickerIndex"
          >更新索引</a-button
        ><a-button size="small" @click="clearPickerSimilarity">清除搜图</a-button>
      </div>
      <p v-if="activePickerError" class="picker-error" role="alert">{{ activePickerError }}</p>
      <div v-else-if="pickerBusy && !visibleCandidates.length" class="picker-status">
        {{
          pickerReference
            ? '正在查找相似图片…'
            : pickerSemanticMode
              ? '正在匹配画面内容…'
              : '正在读取媒体库…'
        }}
      </div>
      <div v-else-if="!visibleCandidates.length" class="picker-status">
        没有找到匹配的媒体；请调整搜索词或筛选条件。
      </div>
      <div
        v-else
        class="picker-grid"
        :aria-label="imagesOnly ? '媒体库图片' : '媒体库素材'"
        :aria-busy="pickerBusy"
      >
        <div
          v-for="file in visibleCandidates"
          :key="file.fullpath"
          class="picker-card"
          :class="{ selected: selectedPaths.includes(file.fullpath) }"
        >
          <button
            type="button"
            class="picker-card-main"
            :aria-label="`选择 ${file.name}`"
            :aria-pressed="multiple ? selectedPaths.includes(file.fullpath) : undefined"
            @click="toggleCandidate(file)"
          >
            <span class="picker-thumbnail">
              <img
                v-if="isImageFile(file.name)"
                :src="toImageThumbnailUrl(file, '256x256')"
                alt=""
                loading="lazy"
              />
              <img
                v-else-if="isVideoFile(file.name)"
                :src="toVideoCoverUrl(file)"
                alt=""
                loading="lazy"
              />
              <AudioOutlined v-else />
              <MediaTypeBadge
                v-if="!imagesOnly"
                :kind="
                  isAudioFile(file.name) ? 'audio' : isVideoFile(file.name) ? 'video' : 'image'
                "
                compact
              />
            </span>
            <span class="picker-name" :title="file.name">{{ file.name }}</span>
            <span v-if="multiple" class="picker-check" aria-hidden="true">{{
              selectedPaths.includes(file.fullpath) ? '✓' : ''
            }}</span>
          </button>
          <button
            type="button"
            class="picker-preview"
            :aria-label="`预览 ${file.name}`"
            :title="`预览 ${file.name}`"
            @click="previewCandidate(file, $event)"
          >
            <EyeOutlined />
          </button>
        </div>
      </div>
      <a-button
        v-if="!pickerSemanticMode && !pickerReference && pickerHasMore"
        size="small"
        :loading="pickerLoading"
        @click="searchCandidates(true)"
        >加载更多</a-button
      >
      <p class="picker-count">
        <template v-if="multiple">已选 {{ selectedPaths.length }} 项 · </template>当前显示
        {{ visibleCandidates.length }} 项
      </p>
    </div>
  </a-modal>
  <MediaQuickLook
    v-if="quickLook"
    :src="quickLook.src"
    :name="quickLook.name"
    :kind="quickLook.kind"
    @close="closeQuickLook"
  />
</template>

<style scoped>
.picker-body > .media-search-box {
  width: 100%;
}
.picker-options {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.picker-filter-toggle {
  max-width: 80%;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: var(--primary-color);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-mode-label {
  color: var(--ui-muted);
  font-size: 11px;
  white-space: nowrap;
}
.picker-filter-panel {
  max-height: 260px;
  overflow: auto;
  padding: 12px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-surface-soft);
}
.picker-filter-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 10px;
}
.picker-search-settings {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius);
  background: var(--ui-surface-soft);
  font-size: 11px;
}
.picker-search-settings label {
  display: flex;
  align-items: center;
  gap: 5px;
}
.picker-search-settings select {
  border: 1px solid var(--ui-border);
  border-radius: 5px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
}
.picker-reference-preview {
  flex: none;
  width: 48px;
  height: 48px;
  overflow: hidden;
  border: 0;
  border-radius: 5px;
  padding: 0;
  background: var(--ui-surface);
  cursor: zoom-in;
}
.picker-reference-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.picker-reference > span {
  flex: 1;
  min-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.picker-reference input[type='range'] {
  width: 70px;
}

.picker-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: calc(100dvh - 250px);
  overflow: auto;
  min-height: 200px;
}
.picker-explanation,
.picker-count {
  margin: 0;
  color: var(--ui-muted);
  font-size: 12px;
}
.picker-status {
  padding: 36px;
  text-align: center;
  color: var(--ui-muted);
}
.picker-error {
  color: #d44444;
}
.picker-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  grid-auto-rows: max-content;
  align-content: start;
  gap: 10px;
  overflow: auto;
  min-height: 150px;
  max-height: 440px;
  flex: 1 1 auto;
  padding: 2px;
}
.picker-card {
  position: relative;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface-soft);
  overflow: hidden;
  align-self: start;
}
.picker-card:hover,
.picker-card.selected {
  border-color: var(--primary-color);
}
.picker-card.selected {
  background: var(--primary-color-1);
}
.picker-card-main {
  display: block;
  width: 100%;
  padding: 5px;
  border: 0;
  background: none;
  color: var(--ui-text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.picker-thumbnail {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 5px;
  background: var(--ui-accent-soft);
  color: var(--primary-color);
  font-size: 36px;
}
.picker-thumbnail img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.picker-thumbnail :deep(.media-type-badge) {
  top: auto;
  bottom: 4px;
  left: 4px;
}
.picker-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 24px;
}
.picker-check {
  position: absolute;
  left: 9px;
  top: 9px;
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  border: 1px solid #ffffffb3;
  border-radius: 4px;
  background: #172331aa;
  color: white;
  font-size: 12px;
}
.selected .picker-check {
  background: var(--primary-color);
  border-color: var(--primary-color);
}
.picker-preview {
  position: absolute;
  right: 8px;
  top: 8px;
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border: 0;
  border-radius: 5px;
  background: #172331cc;
  color: white;
  cursor: zoom-in;
}
.picker-card-main:focus-visible,
.picker-preview:focus-visible,
.picker-reference-preview:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.picker-filter-panel {
  flex: none;
  max-height: 220px;
}
.picker-grid ~ .ant-btn {
  align-self: center;
}
.picker-count {
  flex: none;
}
@media (max-width: 520px) {
  .picker-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
