<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
const props = defineProps<{ text: string; label: string; disabled: boolean }>()
defineEmits<{ edit: [] }>()
const content = ref<HTMLElement>()
const expanded = ref(false)
const overflowing = ref(false)
function measure() {
  if (!expanded.value && content.value)
    overflowing.value = content.value.scrollHeight > content.value.clientHeight + 1
}
useResizeObserver(content, measure)
watch(
  () => props.text,
  () => {
    expanded.value = false
    void nextTick(measure)
  }
)
</script>
<template>
  <button
    ref="content"
    class="generation-prompt-text"
    :class="{ 'is-clamped': !expanded }"
    :disabled="disabled"
    :aria-label="`原地编辑${label}`"
    @click="$emit('edit')"
  >
    {{ text }}
  </button>
  <button
    v-if="overflowing || expanded"
    class="generation-expand"
    :aria-expanded="expanded"
    @click="expanded = !expanded"
  >
    {{ expanded ? '收起' : '展开全文' }}
  </button>
</template>
