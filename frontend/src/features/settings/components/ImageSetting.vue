<script setup lang="ts">
import { t } from '@/shared/i18n/index'
import { useApplicationStore } from '@/features/application/public'
import NumInput from '@/shared/ui/NumberInput.vue'
import sampleImg from './abstract-sample.svg'
import { computed, ref, watch } from 'vue'
import { debounce } from 'lodash-es'
import SettingsRow from './SettingsRow.vue'
import {
  cardThumbnailShortEdge,
  mediaCardHeight,
  MIN_GRID_CELL_WIDTH
} from '@/features/application/public'

function reduceImageResolution(imagePath: string, scaleFactor: number) {
  return new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width * scaleFactor
      canvas.height = img.height * scaleFactor
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(imagePath)
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL())
    }
    img.onerror = () => resolve(imagePath)
    img.src = imagePath
  })
}

const g = useApplicationStore()
const thuImg = ref(sampleImg)
const previewResolution = computed(() =>
  cardThumbnailShortEdge(
    g.defaultGridCellWidth,
    window.devicePixelRatio || 1,
    g.gridThumbnailResolution
  )
)
watch(
  () => [g.enableThumbnail, previewResolution.value],
  debounce(async () => {
    if (g.enableThumbnail) {
      thuImg.value = await reduceImageResolution(sampleImg, previewResolution.value / 1024)
    }
  }, 300),
  { immediate: true, deep: true }
)
</script>
<template>
  <SettingsRow :label="t('defaultGridCellWidth')" compact>
    <NumInput
      class="resolution-control"
      :label="t('defaultGridCellWidth')"
      :min="MIN_GRID_CELL_WIDTH"
      :max="1024"
      :step="16"
      v-model="g.defaultGridCellWidth"
    />
  </SettingsRow>
  <SettingsRow :label="t('useThumbnailPreview')" compact>
    <a-switch v-model:checked="g.enableThumbnail" :aria-label="t('useThumbnailPreview')" />
  </SettingsRow>
  <SettingsRow
    :label="t('thumbnailResolution')"
    v-if="g.enableThumbnail"
    help="根据卡片尺寸自动选择分辨率，最高不超过此短边值。保持原图比例，极长图片会限制最长边。"
    compact
  >
    <NumInput
      class="resolution-control"
      :label="t('thumbnailResolution')"
      v-model="g.gridThumbnailResolution"
      :min="256"
      :max="1024"
      :step="64"
    />
  </SettingsRow>
  <SettingsRow :label="t('livePreview')">
    <div>
      <img
        class="sample-preview"
        alt="缩略图效果预览"
        :style="{
          width: `${Math.min(g.defaultGridCellWidth, 240)}px`,
          height: `${mediaCardHeight(Math.min(g.defaultGridCellWidth, 240))}px`
        }"
        :src="g.enableThumbnail ? thuImg : sampleImg"
      />
    </div>
  </SettingsRow>
</template>
<style lang="scss" scoped>
.resolution-control {
  width: min(320px, 40cqw);
}
.sample-preview {
  display: block;
  max-width: 100%;
  object-fit: cover;
  border-radius: 8px;
}
</style>
