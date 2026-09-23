<script setup lang="ts">
import { computed } from 'vue'
import type { GenDiffInfo } from '@/api/files'

const props = defineProps<{ genDiffToPrevious: GenDiffInfo }>()
const labels: Record<string, string> = {
  prompt: '提示词', negativePrompt: '反向提示词', seed: 'Seed', steps: '步数',
  cfgScale: 'CFG', size: '尺寸', Model: '模型', Sampler: '采样器',
}
const changedFields = computed(() => Object.keys(props.genDiffToPrevious.diff))
const summary = computed(() => {
  const names = [...new Set(changedFields.value.map(key => labels[key] ?? '其他参数'))]
  return `与排序上一张相比：${names.slice(0, 3).join('、')}${names.length > 3 ? `等 ${changedFields.value.length} 项` : ''}`
})
</script>

<template>
  <span v-if="!genDiffToPrevious.empty && changedFields.length" class="change-summary"
    :title="summary" :aria-label="summary">差异 {{ changedFields.length }}</span>
</template>

<style scoped>
.change-summary{flex:none;display:inline-flex;align-items:center;padding:1px 5px;border-radius:4px;background:#3b2b6bd9;color:#fff;font-size:10px;font-weight:600;line-height:16px;white-space:nowrap;pointer-events:auto;}
</style>
