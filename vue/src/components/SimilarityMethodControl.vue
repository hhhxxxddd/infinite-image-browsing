<script setup lang="ts">
import { useId } from 'vue'

defineProps<{ modelValue: 'hash' | 'qwen' }>()
const emit = defineEmits<{ 'update:modelValue': [value: 'hash' | 'qwen'] }>()
const name = useId()
const options = [
  { value: 'hash', label: '找重复图', hint: '用图像算法查找同一张图的重复、缩放或压缩版本，无需 AI 模型。' },
  { value: 'qwen', label: 'AI 找相似', hint: '用 AI 理解画面内容，查找主题或主体相似的图片，需要配置本地 AI 模型和索引。' }
] as const
</script>

<template>
  <div class="similarity-segments" role="radiogroup" aria-label="以图搜图方式">
    <label v-for="option in options" :key="option.value" :title="option.hint">
      <input type="radio" :name="name" :value="option.value" :checked="modelValue === option.value"
        @change="emit('update:modelValue', option.value)" />
      <span>{{ option.label }}</span>
    </label>
  </div>
</template>

<style scoped>
.similarity-segments{display:inline-flex;align-items:center;flex-shrink:0;gap:2px;height:30px;padding:2px;box-sizing:border-box;border:1px solid var(--ui-border);border-radius:var(--ui-radius-sm);background:var(--ui-surface-soft);font-family:var(--ui-font);font-size:12px;font-weight:400;line-height:18px;white-space:nowrap;}
label{position:relative;cursor:pointer;}
input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer;}
span{display:block;padding:3px 9px;border-radius:5px;color:var(--ui-text);transition:background-color var(--ui-motion-fast) var(--ui-ease),color var(--ui-motion-fast) var(--ui-ease),box-shadow var(--ui-motion-fast) var(--ui-ease);}
label:hover span{background:var(--ui-hover);}
input:checked+span{color:var(--primary-color);background:var(--ui-surface);box-shadow:0 1px 3px #15283a1f;font-weight:500;}
input:focus-visible+span{outline:2px solid var(--primary-color);outline-offset:1px;}
</style>
