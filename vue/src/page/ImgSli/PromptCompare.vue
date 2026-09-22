<script setup lang="ts">
import { FileNodeInfo } from '@/api/files'
import { getImageGenerationInfo } from '@/api'
import { watch, ref } from 'vue'
import { parse } from '@/util/stable-diffusion-image-metadata'
import { useGlobalStore } from '@/store/useGlobalStore'

const props = defineProps<{
  lImg: FileNodeInfo,
  rImg: FileNodeInfo
}>()

const g = useGlobalStore()
const lImgInfo = ref('')
const rImgInfo = ref('')

function preprocessGenerationInfo (info: any) {
  let formatted = ''
  const parsed = parse(info)

  formatted += '--- PROMPT --- \r\n'
  formatted += (parsed.prompt ?? '').replace(/\r\n/g, '') + '\r\n\r\n'
  formatted += '--- NEGATIVE PROMPT --- \r\n'
  formatted += parsed.negativePrompt ? parsed.negativePrompt.replace(/\n/g, '') + '\r\n\r\n' : '\r\n\r\n'

  //add rest of info properties line by line
  //collect seen keys in global array and add linebreak if known key is missing
  formatted += '--- PARAMS ---\r\n'
  for (const [key, value] of Object.entries(parsed)) {
    if (key == 'prompt' || key == 'negativePrompt') {
      continue
    }
    formatted += key + ': ' + value + '\r\n'
  }

  return formatted
}

watch(
  () => [props.lImg?.fullpath, props.rImg?.fullpath],
  async ([left, right], _previous, onCleanup) => {
    let current = true
    onCleanup(() => { current = false })
    lImgInfo.value = rImgInfo.value = ''
    if (!left || !right) return
    try {
      const [l, r] = await Promise.all([getImageGenerationInfo(left), getImageGenerationInfo(right)])
      if (!current) return
      lImgInfo.value = preprocessGenerationInfo(l)
      rImgInfo.value = preprocessGenerationInfo(r)
    } catch {
      if (current) lImgInfo.value = rImgInfo.value = '生成信息读取失败，请重新选择图片后重试。'
    }
  }, { immediate: true }
)

</script>

<template>
    <VueDiff class="diff" mode="split" :theme="g.computedTheme" language="plaintext" :prev="lImgInfo" :current="rImgInfo">
    </VueDiff>
</template>

<style lang="scss">
.diff {
    transform: scale(1);
    opacity: 1;
    backdrop-filter: blur(5px);
    transition: top 0.2s ease-in-out;
}


.diff code {
    font-size: 12px;
    line-height: 14px;
    /*color:white !important;*/
    font-family: "Fira Code", "Source Code Pro", monospace;
}

.vue-diff-viewer .vue-diff-row .vue-diff-cell-removed span.modified {
    background-color: #ff000059 !important;
}

.vue-diff-viewer .vue-diff-row .vue-diff-cell-added span.modified {
    background-color: #00ff0059 !important;
}
</style>