<script setup lang="ts">
import TiktokViewer from './TiktokViewer.vue'
import { useImgSliStore } from '@/store/useImgSli'
import ImgSliComparePane from './ImgSliComparePane.vue'
import { ref, watch, onBeforeUnmount } from 'vue'
import { getImagesBySubstr } from '@/api/db'
import type { FileNodeInfo } from '@/api/files'
import { getFileTransferDataFromDragEvent } from '@/util/file'
import { isImageFile } from '@/util'
import { debounce } from 'lodash-es'
import { SwapOutlined } from '@ant-design/icons-vue'
const sli = useImgSliStore()
const splitpane = ref<{requestFullScreen():void}>()
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
watch(() => sli.drawerVisible, open => {
  sli.opened = false
  if (open) void searchImages()
  else { request++; search.cancel(); loading.value=false }
}, {immediate:true})
onBeforeUnmount(() => { request++; search.cancel() })
</script>
<template>
  <a-drawer width="100vw" v-model:open="sli.drawerVisible" destroy-on-close class="image-comparison-drawer" title="图片对比" :z-index="1100" :body-style="{padding:0,display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}">
    <template #extra><a-button size="small" :disabled="!sli.left || !sli.right" @click="splitpane?.requestFullScreen()">全屏查看</a-button></template>
    <div class="comparison-picker">
      <label @dragover.prevent @drop.prevent="drop($event,'left')"><span>左图</span><a-select aria-label="选择左图" show-search allow-clear :filter-option="false" :value="sli.left?.fullpath" :options="options('left')" :loading="loading" placeholder="选择或搜索图片" @search="search" @change="pick('left', $event as string)" /></label>
      <a-button title="交换左右图片" aria-label="交换左右图片" :disabled="!sli.left || !sli.right" @click="[sli.left,sli.right]=[sli.right,sli.left]"><SwapOutlined /></a-button>
      <label @dragover.prevent @drop.prevent="drop($event,'right')"><span>右图</span><a-select aria-label="选择右图" show-search allow-clear :filter-option="false" :value="sli.right?.fullpath" :options="options('right')" :loading="loading" placeholder="选择或搜索图片" @search="search" @change="pick('right', $event as string)" /></label>
    </div>
    <a-alert v-if="searchError" type="error" :message="searchError"><template #action><a-button size="small" @click="searchImages()">重试</a-button></template></a-alert>
    <ImgSliComparePane v-if="sli.left && sli.right" ref="splitpane" container="drawer" :left="sli.left" :right="sli.right" />
    <div v-else class="comparison-empty"><h2>选择两张图片开始对比</h2><p>在上方选择左右图片，也可以在媒体库多选两张后点击“对比两张”。</p></div>
  </a-drawer>
  <TiktokViewer />
</template>
<style scoped>
.comparison-picker{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--zp-border);flex-shrink:0;}.comparison-picker>label{display:flex;align-items:center;gap:10px;flex:1;min-width:0;font-size:12px;}.comparison-picker .ant-select{flex:1;min-width:0;}.comparison-empty{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:32px;text-align:center;}.comparison-empty h2{font-size:20px;}.comparison-empty p{color:var(--zp-secondary);font-size:13px;}
</style>
