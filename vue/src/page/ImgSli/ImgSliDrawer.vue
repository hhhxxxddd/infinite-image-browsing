<script setup lang="ts">
import MediaPreviewViewer from './MediaPreviewViewer.vue'
import { useImgSliStore } from '@/store/useImgSli'
import ImgSliComparePane from './ImgSliComparePane.vue'
import ImgSliGridPane from './ImgSliGridPane.vue'
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { getImagesBySubstr } from '@/api/db'
import type { FileNodeInfo } from '@/api/files'
import { getFileTransferDataFromDragEvent } from '@/util/file'
import { isImageFile } from '@/util'
import { debounce } from 'lodash-es'
import { SwapOutlined } from '@ant-design/icons-vue'
const sli = useImgSliStore()
const splitpane = ref<{requestFullScreen():void}>()
const gridpane = ref<{requestFullScreen():void}>()
const gridPage = ref(0)
const gridPages = computed(() => Math.max(1, Math.ceil(sli.gridFiles.length / sli.gridSize)))
const visibleGridFiles = computed(() => sli.gridFiles.slice(gridPage.value * sli.gridSize, (gridPage.value + 1) * sli.gridSize))
watch([() => sli.gridSize, () => sli.gridFiles], () => { gridPage.value = 0 })
const candidates = ref<FileNodeInfo[]>([])
const loading = ref(false)
const searchError = ref('')
let request = 0
async function searchImages(keyword = '') {
  const version = ++request
  loading.value = true
  searchError.value = ''
  try {
    const result = await getImagesBySubstr({surstr:keyword,regexp:'',cursor:'',media_type:'image',size:100})
    if (version === request) candidates.value = result.files
  } catch { if (version === request) searchError.value = '读取图片失败，请重试' }
  finally { if (version === request) loading.value = false }
}
const search = debounce(searchImages, 250)
function pick(side: 'left'|'right', path: string) { sli[side] = candidates.value.find(file => file.fullpath === path) || (sli[side]?.fullpath === path ? sli[side] : undefined) }
function options(side: 'left'|'right') {
  const chosen = sli[side]
  const files = chosen ? [chosen, ...candidates.value.filter(file => file.fullpath !== chosen.fullpath)] : candidates.value
  return files.map(file => ({label:file.name,value:file.fullpath,title:file.fullpath}))
}
function drop(event:DragEvent, side:'left'|'right') {
  const files = getFileTransferDataFromDragEvent(event)?.nodes.filter(file => isImageFile(file.name))
  if (files?.[0]) sli[side]=files[0]
}
watch([() => sli.drawerVisible, () => sli.viewMode], ([open, mode]) => {
  sli.opened = false
  if (open && mode === 'compare') void searchImages()
  else { request++; search.cancel(); loading.value=false }
}, {immediate:true})
function showFullScreen() {
  if (sli.viewMode === 'compare') splitpane.value?.requestFullScreen()
  else gridpane.value?.requestFullScreen()
}
onBeforeUnmount(() => { request++; search.cancel() })
</script>
<template>
  <a-drawer width="100vw" v-model:open="sli.drawerVisible" destroy-on-close class="image-comparison-drawer" :z-index="1100" :body-style="{padding:0,display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}">
    <template #title>
      <div class="viewer-heading">
        <strong>图片查看</strong>
        <div class="viewer-mode-bar" role="group" aria-label="图片查看模式">
          <button type="button" :aria-pressed="sli.viewMode === 'compare'" @click="sli.viewMode = 'compare'">两图对比</button>
          <button type="button" :aria-pressed="sli.viewMode === 'grid'" @click="sli.viewMode = 'grid'">多图查看</button>
        </div>
      </div>
    </template>
    <template #extra><a-button size="small" :disabled="sli.viewMode === 'compare' ? !sli.left || !sli.right : !sli.gridFiles.length" @click="showFullScreen">全屏查看</a-button></template>
    <div v-if="sli.viewMode === 'compare'" class="comparison-picker">
      <label @dragover.prevent @drop.prevent="drop($event,'left')"><span>左图</span><a-select aria-label="选择左图" show-search allow-clear :filter-option="false" :value="sli.left?.fullpath" :options="options('left')" :loading="loading" placeholder="选择或搜索图片" @search="search" @change="pick('left', $event as string)" /></label>
      <a-button title="交换左右图片" aria-label="交换左右图片" :disabled="!sli.left || !sli.right" @click="[sli.left,sli.right]=[sli.right,sli.left]"><SwapOutlined /></a-button>
      <label @dragover.prevent @drop.prevent="drop($event,'right')"><span>右图</span><a-select aria-label="选择右图" show-search allow-clear :filter-option="false" :value="sli.right?.fullpath" :options="options('right')" :loading="loading" placeholder="选择或搜索图片" @search="search" @change="pick('right', $event as string)" /></label>
    </div>
    <a-alert v-if="sli.viewMode === 'compare' && searchError" type="error" :message="searchError"><template #action><a-button size="small" @click="searchImages()">重试</a-button></template></a-alert>
    <template v-if="sli.viewMode === 'compare'">
      <ImgSliComparePane v-if="sli.left && sli.right" ref="splitpane" container="drawer" :left="sli.left" :right="sli.right" />
      <div v-else class="comparison-empty"><h2>选择两张图片开始对比</h2><p>在上方选择左右图片，也可以在媒体库多选两张后点击“对比两张”。</p></div>
    </template>
    <template v-else>
      <div class="grid-toolbar">
        <span>已选 {{ sli.gridFiles.length }} 张</span>
        <div class="grid-size-buttons" role="group" aria-label="宫格大小">
          <button v-for="size in ([4, 6, 9] as const)" :key="size" type="button" :aria-pressed="sli.gridSize === size" @click="sli.gridSize = size">{{ size }} 宫格</button>
        </div>
        <div v-if="gridPages > 1" class="grid-pagination">
          <a-button size="small" :disabled="gridPage === 0" @click="gridPage--">上一组</a-button>
          <span>{{ gridPage + 1 }} / {{ gridPages }}</span>
          <a-button size="small" :disabled="gridPage >= gridPages - 1" @click="gridPage++">下一组</a-button>
        </div>
      </div>
      <ImgSliGridPane v-if="sli.gridFiles.length" ref="gridpane" :files="visibleGridFiles" :size="sli.gridSize" />
      <div v-else class="comparison-empty"><h2>选择图片开始多图查看</h2><p>在媒体库选中 3–9 张图片，点击下方的“多图查看”。</p></div>
    </template>
  </a-drawer>
  <MediaPreviewViewer />
</template>
<style scoped>
.comparison-picker{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--zp-border);flex-shrink:0;}.comparison-picker>label{display:flex;align-items:center;gap:10px;flex:1;min-width:0;font-size:12px;}.comparison-picker .ant-select{flex:1;min-width:0;}.comparison-empty{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:32px;text-align:center;}.comparison-empty h2{font-size:20px;}.comparison-empty p{color:var(--zp-secondary);font-size:13px;}
.viewer-heading{display:flex;align-items:center;gap:16px;min-width:0;}.viewer-heading strong{white-space:nowrap;}.viewer-mode-bar{display:flex;gap:4px;flex-shrink:0;}.viewer-mode-bar button,.grid-size-buttons button{padding:5px 12px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--zp-secondary);font:inherit;font-size:13px;cursor:pointer;}.viewer-mode-bar button[aria-pressed="true"],.grid-size-buttons button[aria-pressed="true"]{color:var(--primary-color);border-color:var(--primary-color-2);background:var(--primary-color-1);font-weight:600;}.grid-toolbar{display:flex;align-items:center;gap:16px;padding:10px 20px;border-bottom:1px solid var(--zp-border);flex-shrink:0;font-size:12px;}.grid-size-buttons,.grid-pagination{display:flex;align-items:center;gap:4px;}.grid-pagination{margin-left:auto;}.grid-pagination>span{min-width:35px;text-align:center;color:var(--zp-secondary);}
@media(max-width:650px){.viewer-heading{gap:6px;}.viewer-heading strong{display:none;}.viewer-mode-bar button{padding-inline:7px;font-size:12px;}.grid-toolbar{padding-inline:12px;gap:8px;flex-wrap:wrap;}.grid-pagination{margin-left:0;}.comparison-picker{padding-inline:12px;gap:6px;}.comparison-picker>label{gap:4px;}}
.comparison-picker,.grid-toolbar{background:var(--ui-surface);border-color:var(--ui-border);}
.viewer-mode-bar,.grid-size-buttons{padding:3px;border-radius:var(--ui-radius);background:var(--ui-surface-soft);}
.viewer-mode-bar button,.grid-size-buttons button{border-radius:var(--ui-radius-sm);transition:background-color var(--ui-motion-fast) var(--ui-ease),color var(--ui-motion-fast) var(--ui-ease);}
.viewer-mode-bar button:hover:not([aria-pressed="true"]),.grid-size-buttons button:hover:not([aria-pressed="true"]){background:var(--ui-hover);color:var(--ui-text);}
.comparison-empty{margin:20px;border:1px dashed var(--ui-border);border-radius:var(--ui-radius-lg);background:var(--ui-surface-soft);}
</style>
