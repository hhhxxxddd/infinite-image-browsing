<script setup lang="ts">
import { ref } from 'vue'
import type { FileNodeInfo } from '@/api/files'
import { toRawFileUrl } from '@/util/file'

defineProps<{ files: FileNodeInfo[]; size: 4 | 6 | 9 }>()
const wrapper = ref<HTMLElement>()
const failed = ref<string[]>([])
function markFailed(path: string) { if (!failed.value.includes(path)) failed.value.push(path) }
function requestFullScreen() { void wrapper.value?.requestFullscreen() }
defineExpose({ requestFullScreen })
</script>

<template>
  <div ref="wrapper" class="image-grid-view" :class="`grid-${size}`" :aria-label="`${size} 宫格多图查看`">
    <figure v-for="slot in size" :key="slot" class="grid-cell">
      <template v-if="files[slot - 1]">
        <img :src="toRawFileUrl(files[slot - 1])" :alt="files[slot - 1].name" draggable="false" @error="markFailed(files[slot - 1].fullpath)" />
        <figcaption :title="files[slot - 1].name">{{ files[slot - 1].name }}</figcaption>
        <span v-if="failed.includes(files[slot - 1].fullpath)" class="grid-error">图片加载失败</span>
      </template>
      <span v-else class="grid-empty">空位</span>
    </figure>
  </div>
</template>

<style scoped>
.image-grid-view{display:grid;flex:1;min-height:0;gap:4px;padding:8px;box-sizing:border-box;background:#11151b;overflow:hidden;}
.grid-4{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));}
.grid-6{grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr));}
.grid-9{grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));}
.grid-cell{position:relative;display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;margin:0;background:#202630;overflow:hidden;}
.grid-cell img{display:block;width:100%;height:100%;object-fit:contain;}
.grid-cell figcaption{position:absolute;left:8px;right:8px;bottom:8px;width:max-content;max-width:calc(100% - 16px);padding:4px 7px;border-radius:4px;background:#000a;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;pointer-events:none;}
.grid-empty{color:#86909d;font-size:13px;}.grid-error{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);padding:6px 10px;border-radius:4px;background:#9b1c1c;color:#fff;font-size:12px;white-space:nowrap;}
@media(max-width:650px){.image-grid-view{gap:2px;padding:4px;}.grid-cell figcaption{left:4px;right:4px;bottom:4px;max-width:calc(100% - 8px);font-size:10px;}}
</style>
