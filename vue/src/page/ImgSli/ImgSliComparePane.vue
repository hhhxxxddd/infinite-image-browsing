<script setup lang="ts">
import { ref, watch } from 'vue'
import type { FileNodeInfo } from '@/api/files'
import { toRawFileUrl } from '@/util/file'
import PromptCompare from './PromptCompare.vue'
const props = defineProps<{left: FileNodeInfo; right: FileNodeInfo; container?: 'drawer'}>()
const percent = ref(50)
const mode = ref<'slider' | 'side'>('slider')
const errors = ref({left:false,right:false})
const wrapperEl = ref<HTMLElement>()
watch(() => [props.left.fullpath, props.right.fullpath], () => { percent.value=50; errors.value={left:false,right:false} })
const requestFullScreen = () => wrapperEl.value?.requestFullscreen()
defineExpose({requestFullScreen})
</script>
<template>
  <div ref="wrapperEl" class="compare-view">
    <div class="compare-mode"><div class="mode-buttons" role="group" aria-label="对比方式"><button :aria-pressed="mode === 'slider'" @click="mode='slider'">滑动对比</button><button :aria-pressed="mode === 'side'" @click="mode='side'">并排查看</button></div><span>{{ mode === 'slider' ? '拖动分隔线比较两张图片' : '两张图片完整显示' }}</span></div>
    <div class="comparison-stage" :class="mode" aria-label="图片对比画布">
      <img class="compare-image image-right" :src="toRawFileUrl(right)" :alt="`右图：${right.name}`" draggable="false" @error="errors.right=true" />
      <img class="compare-image image-left" :style="mode === 'slider' ? {clipPath:`inset(0 ${100-percent}% 0 0)`} : {}" :src="toRawFileUrl(left)" :alt="`左图：${left.name}`" draggable="false" @error="errors.left=true" />
      <template v-if="mode === 'slider'"><div class="comparison-divider" :style="{left:`${percent}%`}"><span>↔</span></div><input class="comparison-slider" type="range" min="0" max="100" step="0.1" v-model.number="percent" aria-label="图片对比分隔线" /></template>
      <span class="image-label left-label">{{ left.name }}</span><span class="image-label right-label">{{ right.name }}</span>
      <p v-if="errors.left || errors.right" role="alert" class="image-error">{{ errors.left ? '左图' : '右图' }}加载失败，请重新选择图片。</p>
    </div>
    <details class="compare-prompts"><summary>提示词与生成参数对比</summary><PromptCompare :l-img="left" :r-img="right" /></details>
  </div>
</template>
<style scoped>
.compare-view{height:100%;min-height:0;display:flex;flex-direction:column;background:var(--zp-primary-background);overflow:auto;}.compare-mode{display:flex;align-items:center;gap:12px;padding:12px 20px;flex-shrink:0;}.compare-mode>span{font-size:12px;color:var(--zp-secondary);}.comparison-stage{position:relative;flex:1;min-height:260px;background:#0d0f12;overflow:hidden;user-select:none;}.compare-image{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;}.image-left{z-index:1;background:#0d0f12;}.comparison-divider{position:absolute;top:0;bottom:0;width:2px;background:white;z-index:2;pointer-events:none;}.comparison-divider span{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);display:grid;place-items:center;width:32px;height:44px;border-radius:6px;background:#fff;color:#333;box-shadow:0 2px 12px #0006;}.comparison-slider{position:absolute;inset:0;z-index:3;width:100%;height:100%;opacity:0;cursor:ew-resize;margin:0;}.comparison-stage:focus-within{outline:2px solid var(--primary-color);outline-offset:-2px;}.image-label{position:absolute;bottom:12px;z-index:4;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:#0009;color:white;border-radius:4px;padding:4px 8px;font-size:11px;pointer-events:none;}.left-label{left:12px;}.right-label{right:12px;}.side .image-left{width:50%;right:auto;}.side .image-right{width:50%;left:50%;}.image-error{position:absolute;top:40%;left:50%;transform:translateX(-50%);z-index:5;color:white;background:#a22;padding:10px;}.compare-prompts{flex-shrink:0;border-top:1px solid var(--zp-border);}.compare-prompts>summary{padding:14px 20px;cursor:pointer;font-size:13px;}.compare-prompts[open]{max-height:45%;overflow:auto;}
</style>

<style scoped>.mode-buttons{display:flex;gap:4px;}.mode-buttons button{padding:5px 10px;border:1px solid var(--zp-border);border-radius:5px;background:var(--zp-primary-background);color:var(--zp-primary);font:inherit;font-size:12px;cursor:pointer;}.mode-buttons button[aria-pressed="true"]{color:var(--primary-color);border-color:var(--primary-color);background:var(--primary-color-1);}</style>
