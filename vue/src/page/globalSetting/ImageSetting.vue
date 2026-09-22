<script setup lang="ts">
import { t } from '@/i18n'
import { useGlobalStore } from '@/store/useGlobalStore'
import NumInput from '@/components/numInput.vue'
import sampleImg from './abstract-sample.svg'
import { ref, watch } from 'vue'
import { debounce } from 'lodash-es'

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
watch(() => [g.enableThumbnail, g.gridThumbnailResolution], debounce(async () => {
  if (g.enableThumbnail) {
    thuImg.value = await reduceImageResolution(sampleImg, g.gridThumbnailResolution / 1024)
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
  </a-form-item>
  <a-form-item :label="t('livePreview')">
    <div>
      <img class="sample-preview" alt="缩略图效果预览" :width="g.defaultGridCellWidth" :height="g.defaultGridCellWidth" :src="g.enableThumbnail ? thuImg : sampleImg">
    </div>
  </a-form-item>
  <a-form-item label="显示相邻图片的生成参数差异">
    <a-switch v-model:checked="g.defaultChangeIndchecked" aria-label="显示相邻图片的生成参数差异" /><p class="setting-help">比较前后两张图片的提示词、模型、步数等信息，在卡片上标记差异。无生成信息时不显示。</p>
  </a-form-item>
  <a-form-item v-if="g.defaultChangeIndchecked" label="将 Seed 变化计入差异">
    <a-switch v-model:checked="g.defaultSeedChangeChecked" aria-label="将 Seed 变化计入差异" /><p class="setting-help">Seed 是生成时使用的随机种子。关闭后，仅 Seed 不同不会被标为参数差异。</p>
  </a-form-item>

</template>
<style lang="scss" scoped>
.sample-preview { display:block; max-width:100%; height:auto; object-fit:contain; border-radius:8px; }
.setting-help{font-size:12px;color:var(--zp-secondary);line-height:1.7;margin:8px 0 0;}
</style>
