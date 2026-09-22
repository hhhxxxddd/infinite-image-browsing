<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ pureColor: string }>()
const emit = defineEmits<{ 'update:pureColor': [color: string] }>()
// Stored tag colors can be HSL/RGB. Normalize them for the native color control.
const hexColor = computed(() => {
  const context = document.createElement('canvas').getContext('2d')!
  context.fillStyle = props.pureColor || '#000000'
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`
})
</script>

<template>
  <input type="color" :value="hexColor" :aria-label="$t('customTag')"
    @input="emit('update:pureColor', ($event.target as HTMLInputElement).value)" />
</template>

<style scoped>
input { width: 24px; height: 24px; padding: 0; border: 0; cursor: pointer; }
input::-webkit-color-swatch-wrapper { padding: 0; }
input::-webkit-color-swatch { border: 0; border-radius: 6px; }
</style>
