<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ pureColor: string }>()
const emit = defineEmits<{ 'update:pureColor': [color: string] }>()
const open = ref(false)
const presets = [
  '#1677ff', '#13a8a8', '#389e0d', '#7cb305', '#faad14', '#fa8c16',
  '#f5222d', '#eb2f96', '#722ed1', '#2f54eb', '#595959', '#111827'
]
function choose(color: string) { emit('update:pureColor', color); open.value = false }
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
  <a-popover v-model:open="open" trigger="click" placement="bottomLeft">
    <button type="button" class="color-trigger" :style="{ background: hexColor }" aria-label="选择标签颜色" :aria-expanded="open" />
    <template #content>
      <div class="color-palette" aria-label="预设标签颜色">
        <button v-for="color in presets" :key="color" type="button" class="preset" :style="{ background: color }" :aria-label="`选择颜色 ${color}`" :aria-pressed="hexColor.toLowerCase() === color" @click="choose(color)" />
      </div>
      <label class="custom-color">自定义颜色 <input type="color" :value="hexColor" aria-label="自定义标签颜色" @change="emit('update:pureColor', ($event.target as HTMLInputElement).value)" /></label>
    </template>
  </a-popover>
</template>

<style scoped>
.color-trigger{width:24px;height:24px;border:1px solid rgba(0,0,0,.12);border-radius:6px;cursor:pointer;display:block}
.color-palette{display:grid;grid-template-columns:repeat(6,26px);gap:7px;padding:4px}
.preset{width:26px;height:26px;border:1px solid rgba(0,0,0,.1);border-radius:6px;cursor:pointer}
.preset[aria-pressed="true"]{outline:2px solid var(--primary-color);outline-offset:2px}
.custom-color{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px;color:var(--zp-primary)}
.custom-color input{width:36px;height:28px;border:0;padding:0;background:transparent;cursor:pointer}
</style>
