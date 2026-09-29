<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, useId, watch } from 'vue'
import { isAxiosError } from 'axios'
import { ExpandOutlined, MinusOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/features/media-library/api/files'
import {
  isAudioFile,
  isVideoFile,
  toImageUrl,
  toStreamAudioUrl,
  toStreamVideoUrl
} from '@/features/media-library/model/mediaFiles'
import MediaTypeBadge from '@/features/media-library/components/MediaTypeBadge.vue'
import WorkspaceSourceBadge from '@/features/workspaces/components/WorkspaceSourceBadge.vue'
import { workspaceArtifactSourceLabels } from '@/features/workspaces/model/workspaceArtifactSource'
import { getWorkspaceArtifactMetadata } from '@/features/workspaces/api/workspaceArtifacts'
import { getImageExif, getImageGenerationInfo, parse } from '@/features/generation-metadata/public'
import { getImageDescription } from '@/features/media-library/public'
import { getInferredPrompt } from '@/features/ai-workflows/public'
import GenerationInfoDetails from '@/features/generation-metadata/components/GenerationInfoDetails.vue'
import { fileDisplayName } from '@/shared/lib/fileDisplayName'
import { copy2clipboardI18n } from '@/shared/lib/clipboard'
import { apiBase } from '@/shared/api/httpClient'
import { loadAssetPreviewMetadata, type AssetPreviewMetadata } from '../model/assetPreviewMetadata'
import MediaQuickLook from './MediaQuickLook.vue'
import { assetPreviewWorkspaceNameKey } from '../model/assetPreviewContext'
import { assetPreviewIdentity } from '../model/assetPreviewIdentity'
import { workspaceArtifactActionsKey } from '@/features/workspaces/model/workspaceArtifactActions'

const props = defineProps<{
  file?: FileNodeInfo
  src?: string
  name?: string
  kind?: 'image' | 'video' | 'audio'
  workspaceName?: string
}>()
const emit = defineEmits<{ close: [] }>()
const artifactActions = inject(workspaceArtifactActionsKey, undefined)
const managedFile = computed(() => props.file && artifactActions?.resolveFile(props.file))
const canManage = computed(() => !!managedFile.value)
watch(
  () => artifactActions?.lastRemovedId.value,
  (id) => {
    if (id && id === props.file?.workspace_artifact_id) emit('close')
  }
)
const workspaceContext = inject(assetPreviewWorkspaceNameKey, undefined)
const workspaceName = computed(() => workspaceContext?.value || props.workspaceName)
const name = computed(() => managedFile.value?.name || props.file?.name || props.name || '预览')
const kind = computed(
  () =>
    props.kind || (isAudioFile(name.value) ? 'audio' : isVideoFile(name.value) ? 'video' : 'image')
)
const src = computed(() => {
  if (props.file?.cloud_only) return ''
  if (props.src) return props.src
  const file = props.file
  if (!file) return ''
  return kind.value === 'audio'
    ? toStreamAudioUrl(file)
    : kind.value === 'video'
      ? toStreamVideoUrl(file)
      : toImageUrl(file)
})
const product = computed(
  () => !!props.file?.workspace_artifact_id && !props.file.workspace_input_owner
)
const identity = computed(() => assetPreviewIdentity(props.file))
const productionLabels = computed(() =>
  identity.value.productionSource
    ? workspaceArtifactSourceLabels(identity.value.productionSource)
    : []
)
const mediaInfo = ref<{ width?: number; height?: number; duration?: number }>({})
const width = computed(() => props.file?.width || mediaInfo.value.width)
const height = computed(() => props.file?.height || mediaInfo.value.height)
const duration = computed(() => {
  const seconds = mediaInfo.value.duration
  if (seconds === undefined) return ''
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  return `${hours ? `${hours}:` : ''}${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
})
const metadata = ref<AssetPreviewMetadata>()
const loading = ref(false),
  error = ref('')
const view = ref<'media' | 'slide' | 'compare'>('media'),
  split = ref(50)
const infoTabs = [
  { id: 'file', name: '文件信息' },
  { id: 'description', name: '描述' },
  { id: 'generation', name: '生成信息' }
] as const
const activeInfoTab = ref<(typeof infoTabs)[number]['id']>('file')
const infoId = useId()
const moreOpen = ref(false)
function navigateInfoTabs(event: KeyboardEvent, index: number) {
  let next = index
  if (event.key === 'ArrowRight') next = (index + 1) % infoTabs.length
  else if (event.key === 'ArrowLeft') next = (index + infoTabs.length - 1) % infoTabs.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = infoTabs.length - 1
  else return
  event.preventDefault()
  activeInfoTab.value = infoTabs[next].id
  const nav = (event.currentTarget as HTMLElement).parentElement
  nav?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
}
const sourceFailed = ref(false),
  resultFailed = ref(false)
const canCompare = computed(
  () =>
    kind.value === 'image' &&
    product.value &&
    props.file?.workspace_artifact_source === 'ai_image_edit'
)
const sourceUrl = computed(
  () =>
    `${apiBase.value}/workspace_artifacts/${encodeURIComponent(props.file?.workspace_artifact_id || '')}/source`
)
const sourceAvailable = computed(() => metadata.value?.sourceImageAvailable && !sourceFailed.value)
const distinctEmbedded = computed(
  () =>
    metadata.value?.embeddedGenerationInfo &&
    metadata.value.embeddedGenerationInfo !== metadata.value.generationInfo
)
const prompt = computed(() => {
  const value = parse(metadata.value?.generationInfo || '').prompt
  return typeof value === 'string' ? value.trim() : ''
})
const actionContext = computed(() => ({
  file: props.file,
  prompt: prompt.value,
  generationInfo: metadata.value?.generationInfo || '',
  loading: loading.value,
  error: error.value
}))
let request = 0
async function optionalIndexedValue<T>(load: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await load()
  } catch (cause) {
    // Browsable files may not have a media row yet; other failures stay visible.
    if (isAxiosError(cause) && cause.response?.status === 404) return empty
    throw cause
  }
}
async function loadLibraryMetadata(path: string, mediaKind: 'image' | 'video' | 'audio') {
  const [generationInfo, exif, description, inferredPrompt] = await Promise.all([
    mediaKind === 'image' ? getImageGenerationInfo(path, true) : '',
    mediaKind === 'image' ? getImageExif(path, true) : {},
    optionalIndexedValue(() => getImageDescription(path, true), { description: '' }),
    optionalIndexedValue(() => getInferredPrompt(path, true), '')
  ])
  return {
    generationInfo,
    embeddedGenerationInfo: '',
    description: description.description,
    inferredPrompt,
    exif,
    sourceImageAvailable: false
  }
}
async function load() {
  const token = ++request
  metadata.value = undefined
  error.value = ''
  loading.value = !!props.file && !props.file.cloud_only
  try {
    const data = await loadAssetPreviewMetadata(props.file, kind.value, {
      artifact: getWorkspaceArtifactMetadata,
      library: loadLibraryMetadata
    })
    if (token === request) metadata.value = data
  } catch {
    if (token === request) error.value = '详细信息暂时无法读取'
  } finally {
    if (token === request) loading.value = false
  }
}
watch(
  [
    () => props.file?.workspace_artifact_id,
    () => props.file?.fullpath,
    () => props.file?.cloud_only,
    () => props.src,
    kind
  ],
  () => {
    mediaInfo.value = {}
    view.value = 'media'
    activeInfoTab.value = 'file'
    moreOpen.value = false
    split.value = 50
    sourceFailed.value = resultFailed.value = false
    void load()
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  request++
})
function resultLoaded(event: Event) {
  const image = event.target as HTMLImageElement
  mediaInfo.value = { width: image.naturalWidth, height: image.naturalHeight }
}
</script>

<template>
  <MediaQuickLook
    :key="src || file?.fullpath || name"
    :src="src"
    :name="name"
    :title="fileDisplayName(name)"
    :workspace-name="workspaceName"
    :kind="kind"
    :side-key="activeInfoTab"
    :escape-closes="!moreOpen"
    wide
    canvas
    @close="$emit('close')"
    @loaded="mediaInfo = $event"
  >
    <template #toolbar>
      <div class="preview-context">
        <MediaTypeBadge :kind="kind" inline />
        <WorkspaceSourceBadge
          v-if="identity.productionSource"
          :source="identity.productionSource"
          inline
        />
      </div>
    </template>
    <template v-if="file?.cloud_only || view !== 'media'" #default>
      <div class="result-detail">
        <p v-if="file?.cloud_only" class="empty">仅在线文件，请下载到本机后预览。</p>
        <p v-else-if="loading" class="empty">正在读取…</p>
        <p v-else-if="error" class="empty">
          {{ error }}
        </p>
        <div v-else-if="view === 'compare'" class="comparison">
          <figure>
            <figcaption>加工时的源图</figcaption>
            <img
              v-if="sourceAvailable"
              :src="sourceUrl"
              alt="加工时实际提交的源图"
              @error="sourceFailed = true"
            />
            <p v-else class="empty">
              {{ sourceFailed ? '源图暂时无法读取' : '此产物未保存加工时的源图' }}
            </p>
          </figure>
          <figure>
            <figcaption>AI 加工产物</figcaption>
            <img
              v-if="!resultFailed"
              :src="src"
              :alt="name"
              @load="resultLoaded"
              @error="resultFailed = true"
            />
            <p v-else class="empty">图片暂时无法读取</p>
          </figure>
        </div>
        <div v-else-if="sourceAvailable && !resultFailed" class="slide-comparison">
          <img :src="src" :alt="name" @load="resultLoaded" @error="resultFailed = true" />
          <img
            class="source-overlay"
            :src="sourceUrl"
            alt="加工时实际提交的源图"
            :style="{ clipPath: `inset(0 ${100 - split}% 0 0)` }"
            @error="sourceFailed = true"
          />
          <span class="image-label source-label">源图</span
          ><span class="image-label result-label">产物</span>
          <div class="split-line" :style="{ left: `${split}%` }"><span>↔</span></div>
          <input
            v-model.number="split"
            class="split-input"
            type="range"
            min="0"
            max="100"
            step="1"
            aria-label="源图对比分界"
            :aria-valuetext="`源图 ${split}%，产物 ${100 - split}%`"
          />
        </div>
        <p v-else class="empty">
          {{
            resultFailed
              ? '图片暂时无法读取'
              : sourceFailed
                ? '源图暂时无法读取'
                : '此产物未保存加工时的源图'
          }}
        </p>
      </div>
    </template>
    <template #tabs>
      <nav class="preview-info-tabs" role="tablist" aria-label="预览信息分类">
        <button
          v-for="(tab, index) in infoTabs"
          :id="`${infoId}-${tab.id}`"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeInfoTab === tab.id"
          :aria-controls="`${infoId}-panel`"
          :tabindex="activeInfoTab === tab.id ? 0 : -1"
          @click="activeInfoTab = tab.id"
          @keydown="navigateInfoTabs($event, index)"
        >
          {{ tab.name }}
        </button>
      </nav>
    </template>
    <template #side>
      <div
        :id="`${infoId}-panel`"
        class="preview-info-panel"
        role="tabpanel"
        :aria-labelledby="`${infoId}-${activeInfoTab}`"
        tabindex="0"
      >
        <section v-if="activeInfoTab === 'file'" class="preview-info">
          <dl>
            <dt>名称</dt>
            <dd>{{ name }}</dd>
            <dt>类型</dt>
            <dd>{{ kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频' }}</dd>
            <dt>来源</dt>
            <dd>{{ identity.origin }}</dd>
            <template v-if="productionLabels.length">
              <dt>制作方式</dt>
              <dd>{{ productionLabels.join(' · ') }}</dd>
            </template>
            <template v-if="width && height"
              ><dt>尺寸</dt>
              <dd>{{ width }} × {{ height }}</dd></template
            >
            <template v-if="duration"
              ><dt>时长</dt>
              <dd>{{ duration }}</dd></template
            >
            <template v-if="file?.size"
              ><dt>大小</dt>
              <dd>{{ file.size }}</dd></template
            >
            <template v-if="file?.fullpath">
              <dt>路径</dt>
              <dd>{{ file.fullpath }}</dd>
            </template>
          </dl>
          <section v-if="metadata && Object.keys(metadata.exif).length" class="preview-extra">
            <h3>文件元信息</h3>
            <dl>
              <template v-for="(value, key) in metadata.exif" :key="key">
                <dt>{{ key }}</dt>
                <dd>{{ value }}</dd>
              </template>
            </dl>
          </section>
        </section>
        <section v-else-if="activeInfoTab === 'description'" class="preview-description">
          <section>
            <h3>媒体描述</h3>
            <p class="preview-text" :class="{ muted: !metadata?.description }">
              {{ metadata?.description || (loading ? '正在读取…' : '未记录媒体描述') }}
            </p>
          </section>
          <section class="preview-extra">
            <h3>AI 参考提示词</h3>
            <p class="preview-text" :class="{ muted: !metadata?.inferredPrompt }">
              {{ metadata?.inferredPrompt || (loading ? '正在读取…' : '未记录 AI 参考提示词') }}
            </p>
          </section>
        </section>
        <section v-else class="preview-generation">
          <p v-if="loading" class="muted" role="status">正在读取…</p>
          <template v-else-if="!error">
            <GenerationInfoDetails
              v-if="metadata?.generationInfo"
              :raw="metadata.generationInfo"
              :width="width"
              :height="height"
            />
            <p v-else class="muted">未记录生成信息</p>
            <details v-if="metadata && distinctEmbedded" class="embedded-info">
              <summary>图片内嵌生成信息</summary>
              <GenerationInfoDetails
                :raw="metadata.embeddedGenerationInfo"
                :width="width"
                :height="height"
              />
            </details>
          </template>
        </section>
        <p v-if="error" class="preview-read-error muted" role="alert">
          {{ error }}，可在“更多操作”中重试。
        </p>
      </div>
    </template>
    <template #actions="{ zoom, canZoom, zoomIn, zoomOut, resetView }">
      <div class="preview-controls">
        <div class="preview-view-actions">
          <div v-if="kind === 'image'" class="preview-zoom" role="group" aria-label="图片缩放">
            <a-button
              size="small"
              aria-label="缩小图片"
              :disabled="!canZoom || view !== 'media' || zoom <= 0.25"
              @click="zoomOut"
              ><MinusOutlined
            /></a-button>
            <output aria-label="缩放比例">{{ Math.round(zoom * 100) }}%</output>
            <a-button
              size="small"
              aria-label="放大图片"
              :disabled="!canZoom || view !== 'media' || zoom >= 8"
              @click="zoomIn"
              ><PlusOutlined
            /></a-button>
            <a-button
              size="small"
              aria-label="适应画面"
              title="适应画面"
              :disabled="!canZoom || view !== 'media'"
              @click="resetView"
              ><ExpandOutlined
            /></a-button>
          </div>
          <div v-if="canCompare" class="preview-view-modes" role="group" aria-label="预览方式">
            <button
              v-for="mode in [
                { id: 'media', name: '预览' },
                { id: 'slide', name: '滑动对比' },
                { id: 'compare', name: '并排查看' }
              ] as const"
              :key="mode.id"
              type="button"
              :aria-pressed="view === mode.id"
              @click="view = mode.id"
            >
              {{ mode.name }}
            </button>
          </div>
        </div>
        <div class="preview-task-actions">
          <div class="preview-context-actions"><slot name="actions" v-bind="actionContext" /></div>
          <a-popover
            v-if="file?.fullpath || canManage || $slots['more-actions'] || error"
            v-model:open="moreOpen"
            trigger="click"
            placement="topRight"
            :z-index="1210"
          >
            <template #content>
              <div
                class="preview-more-actions"
                @click="moreOpen = false"
                @keydown.esc.prevent.stop="moreOpen = false"
              >
                <a-button v-if="error" type="text" @click="load">重新读取信息</a-button>
                <a-button
                  v-if="file?.fullpath"
                  type="text"
                  @click="copy2clipboardI18n(file.fullpath)"
                  >复制文件路径</a-button
                >
                <slot name="more-actions" v-bind="actionContext" />
                <template v-if="canManage && managedFile && artifactActions">
                  <a-button
                    type="text"
                    :disabled="artifactActions.disabled.value"
                    @click="artifactActions.rename(managedFile)"
                    >重命名</a-button
                  >
                  <a-button
                    type="text"
                    danger
                    :disabled="artifactActions.disabled.value"
                    @click="artifactActions.remove(managedFile)"
                    >删除产物</a-button
                  >
                </template>
              </div>
            </template>
            <a-button
              class="preview-more-trigger"
              aria-label="更多操作"
              title="更多操作"
              @keydown.esc.prevent.stop="moreOpen = false"
              ><MoreOutlined
            /></a-button>
          </a-popover>
        </div>
      </div>
    </template>
  </MediaQuickLook>
</template>

<style scoped>
.preview-context {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-height: 24px;
  margin-bottom: 12px;
  color: var(--ui-muted);
  font-size: 12px;
}
.preview-info-panel h3 {
  margin: 0 0 12px;
  font-size: 14px;
}
.preview-info-panel dl {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 12px 14px;
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
}
.preview-info dt {
  color: var(--ui-muted);
  overflow-wrap: anywhere;
}
.preview-info dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.preview-extra {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--ui-border);
}
.preview-text {
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.preview-info-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 8px;
  background: var(--ui-surface-soft);
}
.preview-info-tabs button {
  height: 32px;
  min-width: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.preview-info-tabs button[aria-selected='true'] {
  background: var(--ui-surface);
  color: var(--primary-color);
  box-shadow: 0 1px 4px #15283a12;
}
.preview-info-tabs button:focus-visible,
.preview-info-panel:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.preview-info-panel {
  min-height: 100%;
}
.muted {
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.6;
}
.preview-read-error {
  padding: 12px;
  border-radius: 6px;
  background: var(--ui-surface-soft);
}
.preview-controls {
  display: grid;
  grid-template-rows: 32px 32px;
  gap: 12px;
}
.preview-view-actions,
.preview-task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.preview-view-actions {
  justify-content: space-between;
}
.preview-zoom {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.preview-zoom output {
  min-width: 42px;
  text-align: center;
  font-size: 12px;
  color: var(--ui-muted);
  font-variant-numeric: tabular-nums;
}
.preview-zoom :deep(.ant-btn) {
  width: 28px;
  height: 28px;
  padding: 0;
}
.preview-view-modes {
  display: flex;
  flex: 1;
  gap: 2px;
  min-width: 0;
  height: 32px;
  box-sizing: border-box;
  padding: 2px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface-soft);
}
.preview-view-modes button {
  flex: 1;
  min-width: 0;
  padding: 0 5px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ui-muted);
  font: inherit;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.preview-view-modes button[aria-pressed='true'] {
  background: var(--ui-surface);
  color: var(--primary-color);
  box-shadow: 0 1px 4px #15283a12;
}
.preview-view-modes button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.preview-context-actions {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 8px;
}
.preview-context-actions :deep(.ant-btn) {
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
}
.preview-more-trigger {
  width: 32px;
  height: 32px;
  flex: none;
  padding: 0;
  margin-left: auto;
}
.preview-more-actions {
  display: flex;
  flex-direction: column;
  min-width: 144px;
  gap: 4px;
}
.preview-more-actions :deep(.ant-btn) {
  text-align: left;
  justify-content: flex-start;
  height: 32px;
  font-size: 12px;
}
.result-detail {
  height: 100%;
  overflow: auto;
  color: var(--ui-text);
  background: var(--ui-surface-soft);
  border-radius: 8px;
}
.comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: minmax(0, 1fr);
  gap: 8px;
  height: 100%;
}
.comparison figure {
  margin: 0;
  min-width: 0;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px;
}
.comparison figcaption {
  font-size: 12px;
  color: var(--ui-muted);
  margin-bottom: 8px;
}
.comparison img {
  width: 100%;
  height: 0;
  min-height: 0;
  flex: 1;
  object-fit: contain;
}
.empty {
  margin: auto;
  padding: 28px;
  text-align: center;
  color: var(--ui-muted);
}
.slide-comparison {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  isolation: isolate;
  touch-action: none;
}
.slide-comparison img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}
.source-overlay {
  background: var(--ui-surface-soft);
}
.split-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--primary-color);
  transform: translateX(-50%);
  pointer-events: none;
}
.split-line span {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--ui-surface);
  border: 2px solid var(--primary-color);
  color: var(--primary-color);
  box-shadow: 0 2px 8px #0003;
}
.split-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: ew-resize;
}
.slide-comparison:focus-within {
  outline: 2px solid var(--primary-color);
  outline-offset: -2px;
}
.image-label {
  position: absolute;
  top: 10px;
  padding: 3px 7px;
  border-radius: 5px;
  background: var(--ui-surface);
  font-size: 11px;
  pointer-events: none;
}
.source-label {
  left: 10px;
}
.result-label {
  right: 10px;
}
.muted {
  font-size: 12px;
  color: var(--ui-muted);
}
.embedded-info {
  margin-top: 16px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.embedded-info summary {
  cursor: pointer;
  color: var(--ui-muted);
}
.embedded-info dd {
  margin: 4px 0 12px;
  white-space: pre-wrap;
}
.embedded-info dt {
  color: var(--ui-muted);
}
@media (max-width: 600px) {
  .comparison {
    grid-template-columns: 1fr;
    height: auto;
  }
  .comparison figure {
    height: 230px;
  }
}
</style>
