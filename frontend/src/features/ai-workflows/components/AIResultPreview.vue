<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { apiBase } from '@/shared/api/httpClient'
import {
  getWorkspaceArtifactMetadata,
  type WorkspaceArtifactMetadata
} from '@/features/workspaces/public'
import WorkspacePreviewShell from '@/features/workspaces/components/WorkspacePreviewShell.vue'
import type { FileNodeInfo } from '@/features/media-library/api/files'
import { toImageUrl } from '@/features/media-library/model/mediaFiles'
import { fileDisplayName } from '@/shared/lib/fileDisplayName'
import GenerationInfoDetails from '@/features/generation-metadata/components/GenerationInfoDetails.vue'

const props = defineProps<{ file: FileNodeInfo; workspaceName?: string }>()
const src = computed(() => toImageUrl(props.file))
const name = computed(() => fileDisplayName(props.file.name))
const emit = defineEmits<{ close: [] }>()
const view = ref<'result' | 'slide' | 'compare'>('result')
const split = ref(50)
const metadata = ref<WorkspaceArtifactMetadata>()
const loading = ref(true),
  error = ref(''),
  sourceFailed = ref(false),
  resultFailed = ref(false)
const dimensions = ref({ width: 0, height: 0 })
let disposed = false
const sourceUrl = computed(
  () =>
    `${apiBase.value}/workspace_artifacts/${encodeURIComponent(props.file.workspace_artifact_id ?? '')}/source`
)
const sourceAvailable = computed(
  () => metadata.value?.source_image_available && !sourceFailed.value
)
const embedded = computed(() => metadata.value?.embedded_generation_info || '')
const distinctEmbedded = computed(
  () => embedded.value && embedded.value !== metadata.value?.generation_info
)
function resultLoaded(event: Event) {
  const image = event.target as HTMLImageElement
  dimensions.value = { width: image.naturalWidth, height: image.naturalHeight }
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await getWorkspaceArtifactMetadata(props.file.workspace_artifact_id ?? '')
    if (!disposed) {
      metadata.value = result
      const size = /^(\d+)\s*×\s*(\d+)$/.exec(result.exif['像素尺寸'] || '')
      if (size) dimensions.value = { width: Number(size[1]), height: Number(size[2]) }
    }
  } catch {
    if (!disposed) error.value = '生成信息暂时无法读取'
  } finally {
    if (!disposed) loading.value = false
  }
}
onMounted(load)
onBeforeUnmount(() => {
  disposed = true
})
</script>

<template>
  <WorkspacePreviewShell :file="file" :workspace-name="workspaceName" @close="emit('close')">
    <template #toolbar>
      <div class="result-tabs" role="tablist" aria-label="AI 结果预览">
        <button
          v-for="tab in [
            { id: 'result', name: '结果' },
            { id: 'slide', name: '滑动对比' },
            { id: 'compare', name: '并排查看' }
          ] as const"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="view === tab.id"
          @click="view = tab.id"
        >
          {{ tab.name }}
        </button>
      </div>
    </template>
    <template v-if="view !== 'result'" #default>
      <div class="result-detail" role="tabpanel">
        <p v-if="loading" class="empty">正在读取…</p>
        <div v-else-if="error" class="empty">
          {{ error }} <button type="button" @click="load">重试</button>
        </div>
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
              {{ sourceFailed ? '源图暂时无法读取' : '此结果未保存加工时的源图' }}
            </p>
          </figure>
          <figure>
            <figcaption>AI 加工结果</figcaption>
            <img
              v-if="!resultFailed"
              :src="src"
              :alt="name"
              @load="resultLoaded"
              @error="resultFailed = true"
            />
            <p v-else class="empty">结果图片暂时无法读取</p>
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
          ><span class="image-label result-label">结果</span>
          <div class="split-line" :style="{ left: `${split}%` }"><span>↔</span></div>
          <input
            v-model.number="split"
            class="split-input"
            type="range"
            min="0"
            max="100"
            step="1"
            aria-label="源图对比分界"
            :aria-valuetext="`源图 ${split}%，结果 ${100 - split}%`"
          />
        </div>
        <p v-else class="empty">
          {{
            resultFailed
              ? '结果图片暂时无法读取'
              : sourceFailed
                ? '源图暂时无法读取'
                : '此结果未保存加工时的源图'
          }}
        </p>
      </div>
    </template>
    <template #side>
      <h3 class="info-heading">加工记录</h3>
      <p v-if="loading" class="muted">正在读取…</p>
      <p v-else-if="error" class="muted">
        {{ error }} <button type="button" @click="load">重试</button>
      </p>
      <template v-else>
        <p class="info-note">
          {{
            distinctEmbedded
              ? '提交记录与图片内嵌信息分别展示。'
              : embedded
                ? '信息来自图片内嵌记录。'
                : '以下为已保存的提交记录；图片未提供更多生成参数。'
          }}
        </p>
        <GenerationInfoDetails
          :raw="metadata?.generation_info || ''"
          :width="dimensions.width"
          :height="dimensions.height"
        />
        <details v-if="distinctEmbedded" class="embedded-info">
          <summary>图片内嵌生成信息</summary>
          <GenerationInfoDetails
            :raw="embedded"
            :width="dimensions.width"
            :height="dimensions.height"
          />
        </details>
        <details v-if="metadata && Object.keys(metadata.exif).length" class="embedded-info">
          <summary>原始文件元信息</summary>
          <dl>
            <template v-for="(value, key) in metadata.exif" :key="key"
              ><dt>{{ key }}</dt>
              <dd>{{ value }}</dd></template
            >
          </dl>
        </details>
      </template>
    </template>
    <template v-if="$slots.actions" #actions><slot name="actions" /></template>
  </WorkspacePreviewShell>
</template>

<style scoped>
.result-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.result-tabs button {
  padding: 6px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--ui-muted);
  cursor: pointer;
}
.result-tabs button[aria-selected='true'] {
  background: var(--primary-color-1);
  color: var(--primary-color);
  border-color: var(--primary-color);
}
.result-detail {
  height: min(64dvh, 600px);
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
.info-heading {
  margin: 0 0 8px;
  font-size: 14px;
}
.info-note,
.muted {
  font-size: 11px;
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
