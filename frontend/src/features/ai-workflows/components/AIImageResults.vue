<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { workspaceTasksKey } from '@/features/workspaces/public'
import { toImageThumbnailUrl, type FileNodeInfo } from '@/features/media-library/public'
import { studioTaskResults, imageResultBatches } from '../model/studioResults'

const props = defineProps<{
  workspaceId?: string
  productionId?: string
  purpose: 'image_edit' | 'image_generation'
  assetInfo: Record<string, FileNodeInfo>
}>()
const emit = defineEmits<{ preview: [path: string] }>()
const tasks = inject(workspaceTasksKey, ref([]))
const batches = computed(() =>
  imageResultBatches(tasks.value, props.workspaceId, props.productionId, props.purpose)
)
const batchId = ref('')
watch(
  () => batches.value.map((task) => task.id),
  (ids, previous) => {
    if (
      !ids.includes(batchId.value) ||
      (ids[0] !== previous?.[0] && batchId.value === previous?.[0])
    )
      batchId.value = ids[0] ?? ''
  },
  { immediate: true }
)
const batch = computed(() => batches.value.find((task) => task.id === batchId.value))
const results = computed(() => (batch.value ? studioTaskResults(batch.value) : []))
</script>

<template>
  <section v-if="batch" class="process-section image-results" aria-label="AI 图片结果">
    <header>
      <strong
        >图片结果 <span>{{ results.length }} 张</span></strong
      ><small>点击预览</small>
    </header>
    <label v-if="batches.length > 1" class="batch-label"
      >结果批次<select v-model="batchId" aria-label="结果批次">
        <option v-for="task in batches" :key="task.id" :value="task.id">
          {{ task.name }} · {{ studioTaskResults(task).length }} 张
        </option>
      </select></label
    >
    <p v-if="batch.state === 'failed'" class="result-warning" role="alert">{{ batch.error }}</p>
    <div class="result-grid">
      <button
        v-for="(result, index) in results"
        :key="result.artifact_id"
        type="button"
        :disabled="!assetInfo[`workspace-artifact:${result.artifact_id}`]"
        :aria-label="`预览结果 ${index + 1}${result.label ? ' · ' + result.label : ''}`"
        :title="
          assetInfo[`workspace-artifact:${result.artifact_id}`]?.name ?? '文件正在载入或已删除'
        "
        @click="emit('preview', `workspace-artifact:${result.artifact_id}`)"
      >
        <img
          v-if="assetInfo[`workspace-artifact:${result.artifact_id}`]"
          :src="toImageThumbnailUrl(assetInfo[`workspace-artifact:${result.artifact_id}`])"
          alt=""
        />
        <span v-else class="missing-result">不可用</span>
        <span class="result-caption">{{ index + 1 }} · {{ result.label || '结果' }}</span>
      </button>
    </div>
    <p class="result-hint">每张图片均已保存为独立产物，可在下方素材区使用。</p>
  </section>
</template>

<style scoped>
.image-results {
  min-width: 0;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}
header span,
small,
.result-hint {
  font-size: 10px;
  font-weight: 400;
  color: var(--ui-muted);
}
.batch-label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 10px 0;
  font-size: 10px;
  color: var(--ui-muted);
}
select {
  width: 100%;
  min-width: 0;
  padding: 6px;
  border: 1px solid var(--ui-control-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
}
.result-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-top: 10px;
  max-height: 235px;
  overflow-y: auto;
  padding: 2px;
}
button {
  min-width: 0;
  overflow: hidden;
  padding: 3px;
  border: 1px solid var(--ui-control-border);
  border-radius: 6px;
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
}
button:hover {
  border-color: var(--primary-color);
}
button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 1px;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
img,
.missing-result {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  background: var(--ui-surface-soft);
}
.missing-result {
  display: grid;
  place-items: center;
  font-size: 10px;
}
.result-caption {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}
.result-hint,
.result-warning {
  margin: 8px 0 0;
  line-height: 1.5;
}
.result-warning {
  color: #ce8b44;
  font-size: 11px;
}
</style>
