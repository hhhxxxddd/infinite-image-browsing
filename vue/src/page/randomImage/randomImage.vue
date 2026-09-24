<script setup lang="ts">
import { computed, onMounted, provide, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import type { MenuInfo } from 'ant-design-vue/lib/menu/src/interface'
import { message } from 'ant-design-vue'
import FileItem from '@/components/FileItem.vue'
import type { FileNodeInfo } from '@/api/files'
import { pickMedia, toggleCustomTagToImg, type PickMediaType } from '@/api/db'
import { useTagStore } from '@/store/useTagStore'
import { mediaPreviewKey } from '@/util/mediaPreviewContext'
import { openPreviewWithFiles } from '@/util/mediaPreview'
import { isAudioFile, isVideoFile } from '@/util/file'

defineProps<{ tabIdx: number; paneIdx: number; id: string; paneKey: string }>()

const filters: { value: PickMediaType; label: string }[] = [
  { value: 'all', label: '全部媒体' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' }
]
const tagStore = useTagStore()
const activeType = ref<PickMediaType>('all')
const batches = ref<FileNodeInfo[][]>([])
const batchIndex = ref(-1)
const batchOffset = ref(0)
const files = computed(() => batches.value[batchIndex.value] ?? [])
const loading = ref(false)
const loadError = ref(false)
let requestVersion = 0
const seenPaths = new Set<string>()
const gridRef = ref<HTMLElement>()
const { width: gridWidth } = useElementSize(gridRef)
const columns = computed(() => Math.max(1, Math.min(6, Math.floor((gridWidth.value + 16) / 236))))
const cellWidth = computed(() => Math.max(160, Math.floor((gridWidth.value - (columns.value - 1) * 16) / columns.value)))
const batchCount = computed(() => batchOffset.value + batchIndex.value + 1)
const counts = computed(() => files.value.reduce((result, file) => {
  if (isAudioFile(file.name)) result.audio++
  else if (isVideoFile(file.name)) result.video++
  else result.image++
  return result
}, { image: 0, video: 0, audio: 0 }))

provide(mediaPreviewKey, (index, mode = 'preview') => openPreviewWithFiles(files.value, index, undefined, mode))

async function nextBatch() {
  if (loading.value) return
  if (batchIndex.value < batches.value.length - 1) {
    batchIndex.value++
    return
  }
  loading.value = true
  loadError.value = false
  const version = ++requestVersion
  try {
    let picked = await pickMedia(activeType.value, [...seenPaths].slice(-256))
    if (version !== requestVersion) return
    if (!picked.length && seenPaths.size) {
      seenPaths.clear()
      picked = await pickMedia(activeType.value)
      if (version !== requestVersion) return
      if (picked.length) message.info('这一类已看完，重新开始挑选')
    }
    if (picked.length) {
      batches.value.push(picked)
      batchIndex.value = batches.value.length - 1
      if (batches.value.length > 20) {
        batches.value.shift()
        batchIndex.value--
        batchOffset.value++
      }
      picked.forEach(file => seenPaths.add(file.fullpath))
      void tagStore.fetchImageTags(picked.map(file => file.fullpath))
    }
  } catch {
    if (version === requestVersion) loadError.value = true
  } finally {
    if (version === requestVersion) loading.value = false
  }
}

function chooseType(value: PickMediaType) {
  if (activeType.value === value) return
  requestVersion++
  loading.value = false
  activeType.value = value
  batches.value = []
  batchIndex.value = -1
  batchOffset.value = 0
  seenPaths.clear()
  void nextBatch()
}

function openBatchPreview() {
  if (files.value.length) openPreviewWithFiles(files.value, 0)
}

async function onTagClick(event: MenuInfo, file: FileNodeInfo) {
  const match = /^toggle-tag-(\d+)$/.exec(String(event.key))
  if (!match) return
  try {
    await toggleCustomTagToImg({ tag_id: Number(match[1]), img_path: file.fullpath })
    await tagStore.refreshTags([file.fullpath])
  } catch {
    message.error('标签更新失败')
  }
}

onMounted(() => { void nextBatch() })
</script>

<template>
  <Teleport to="#pick-header-slot">
    <div class="pick-toolbar">
      <div class="pick-intro">
        <strong>从媒体库里随机遇见喜欢的内容</strong>
        <span>图片、视频和音频一起挑；点卡片查看，点心形留下喜欢的媒体。</span>
      </div>
      <div class="pick-actions">
        <a-button :disabled="batchIndex <= 0 || loading" @click="batchIndex--">上一批</a-button>
        <a-button type="primary" :loading="loading" @click="nextBatch">换一批</a-button>
        <a-button :disabled="!files.length" @click="openBatchPreview">逐项查看</a-button>
      </div>
    </div>
    <div class="pick-subbar">
      <div class="pick-filters" role="group" aria-label="挑选媒体类型">
        <button v-for="filter in filters" :key="filter.value" type="button"
          :class="{ active: activeType === filter.value }" :aria-pressed="activeType === filter.value"
          @click="chooseType(filter.value)">{{ filter.label }}</button>
      </div>
      <div v-if="files.length" class="pick-summary" aria-live="polite">
        第 {{ batchCount }} 批 · 本批 {{ files.length }} 项<span v-if="activeType === 'all'">：{{ counts.image }} 图片、{{ counts.video }} 视频、{{ counts.audio }} 音频</span>
      </div>
      <span v-if="loadError && files.length" class="pick-error" role="alert">换一批失败，请重试</span>
    </div>
  </Teleport>
  <div class="pick-page workspace-pane">
    <div class="pick-content" :class="{ loading }">
      <div v-if="loadError && !files.length" class="pick-empty">
        <strong>暂时无法读取媒体</strong><span>请稍后重试。</span>
        <a-button @click="nextBatch">重试</a-button>
      </div>
      <div v-else-if="!loading && !files.length" class="pick-empty">
        <strong>还没有可挑选的媒体</strong><span>请先到媒体库添加文件夹并扫描。</span>
      </div>
      <ul v-else ref="gridRef" class="pick-grid" :style="{ '--pick-columns': columns }">
        <FileItem v-for="(file, index) in files" :key="file.fullpath" :idx="index" :file="file"
          :cell-width="cellWidth" :enable-right-click-menu="false" pick-mode
          @context-menu-click="onTagClick" />
      </ul>
    </div>
  </div>
</template>

<style scoped>
.pick-page{height:100%;min-height:0;display:flex;flex-direction:column;background:transparent;color:var(--ui-text);}
.pick-toolbar{display:flex;align-items:center;justify-content:space-between;gap:18px;min-height:40px;}
.pick-intro{display:flex;flex-direction:column;gap:4px;min-width:0;}
.pick-intro strong{font-size:16px;font-weight:650;}
.pick-intro span{font-size:12px;color:var(--ui-muted);}
.pick-actions{display:flex;flex-wrap:wrap;gap:8px;flex:none;}
.pick-actions :deep(.ant-btn){min-height:34px;border-radius:var(--ui-radius-sm);}
.pick-subbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:8px;padding-top:9px;border-top:1px solid color-mix(in srgb,var(--ui-border) 68%,transparent);}
.pick-filters{display:inline-flex;gap:4px;padding:3px;border:1px solid var(--ui-border);border-radius:9px;background:var(--ui-surface-soft);}
.pick-filters button{border:0;border-radius:6px;padding:6px 12px;background:transparent;color:var(--ui-muted);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;}
.pick-filters button:hover{color:var(--ui-text);}
.pick-filters button.active{background:var(--ui-surface);color:var(--primary-color);box-shadow:0 1px 4px #0002;font-weight:600;}
.pick-filters button:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px;}
.pick-summary{font-size:12px;color:var(--ui-muted);}
.pick-error{font-size:12px;color:#cf3b35;}
.pick-content{min-height:0;flex:1;overflow:auto;padding:18px 20px 32px;}
.pick-content.loading{opacity:.65;}
.pick-grid{display:grid;grid-template-columns:repeat(var(--pick-columns),minmax(0,1fr));gap:16px;margin:0;padding:0;list-style:none;}
.pick-grid :deep(.file){max-width:100%;}
.pick-empty{min-height:240px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;text-align:center;color:var(--ui-muted);}
.pick-empty strong{font-size:16px;color:var(--ui-text);}
@media(max-width:760px){.pick-toolbar{align-items:flex-start;flex-direction:column;gap:10px;}.pick-subbar{gap:8px;}.pick-content{padding:16px;}.pick-actions{width:100%;}.pick-filters{max-width:100%;overflow:auto;}}
</style>
