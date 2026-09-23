<script setup lang="ts">
import { t } from '@/i18n'
import { useGlobalStore } from '@/store/useGlobalStore'
import NumInput from '@/components/numInput.vue'
import sampleImg from './abstract-sample.svg'
import { computed, ref, watch } from 'vue'
import { debounce } from 'lodash-es'
import { cardThumbnailShortEdge, mediaCardHeight } from '@/util/mediaCardLayout'

function reduceImageResolution (imagePath: string, scaleFactor: number) {
  return new Promise<string>(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scaleFactor
      canvas.height = img.height * scaleFactor
      const ctx = canvas.getContext('2d')
      ctx!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL())
    }
    img.src = imagePath
  })
}

const g = useGlobalStore()
const thuImg = ref(sampleImg)
const previewResolution = computed(() => cardThumbnailShortEdge(g.defaultGridCellWidth, window.devicePixelRatio || 1, g.gridThumbnailResolution))
watch(() => [g.enableThumbnail, previewResolution.value], debounce(async () => {
  if (g.enableThumbnail) {
    thuImg.value = await reduceImageResolution(sampleImg, previewResolution.value / 1024)
  }
}, 300), { immediate: true, deep: true })


</script>
<template>
  <a-form-item :label="t('defaultGridCellWidth')">
    <NumInput :min="64" :max="1024" :step="16" v-model="g.defaultGridCellWidth" />
  </a-form-item>
  <a-form-item :label="t('useThumbnailPreview')">
    <a-switch v-model:checked="g.enableThumbnail" />
  </a-form-item>
  <a-form-item :label="t('thumbnailResolution')" v-if="g.enableThumbnail">
    <NumInput v-model="g.gridThumbnailResolution" :min="256" :max="1024" :step="64" />
    <p class="setting-help">根据卡片尺寸自动选择分辨率，最高不超过此短边值；保持原图比例，极长图片会限制最长边。</p>
  </a-form-item>
  <a-form-item :label="t('livePreview')">
    <div>
      <img class="sample-preview" alt="缩略图效果预览" :style="{ width: `${Math.min(g.defaultGridCellWidth, 240)}px`, height: `${mediaCardHeight(Math.min(g.defaultGridCellWidth, 240))}px` }" :src="g.enableThumbnail ? thuImg : sampleImg">
    </div>
  </a-form-item>
  <a-form-item label="显示与排序上一张的参数差异">
    <a-switch v-model:checked="g.defaultChangeIndchecked" aria-label="显示与排序上一张的参数差异" /><p class="setting-help">在卡片名称旁显示变化项数；悬停可查看变化字段。按当前排序比较，不按瀑布流中的上下位置比较。无生成信息时不显示。</p>
  </a-form-item>
  <a-form-item v-if="g.defaultChangeIndchecked" label="将 Seed 变化计入差异">
    <a-switch v-model:checked="g.defaultSeedChangeChecked" aria-label="将 Seed 变化计入差异" /><p class="setting-help">Seed 是生成时使用的随机种子。关闭后，仅 Seed 不同不会被标为参数差异。</p>
  </a-form-item>

</template>
<style lang="scss" scoped>
.sample-preview { display:block; max-width:100%; object-fit:cover; border-radius:8px; }
.setting-help{font-size:12px;color:var(--zp-secondary);line-height:1.7;margin:8px 0 0;}
</style>
