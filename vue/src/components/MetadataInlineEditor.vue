<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
const props = defineProps<{ modelValue: string; label: string; multiline?: boolean; saving: boolean; error: string; size?: boolean; placeholder?: string; numeric?: { min: number; max?: number; integer: boolean; step: number } }>()
const dimensions = computed(() => props.modelValue.split(/\s*[x×]\s*/))
function setDimension(index: number, value: string | number) {
  const next = [dimensions.value[0] || '', dimensions.value[1] || '']
  next[index] = String(value)
  emit('update:modelValue', next.every(value => !value) ? '' : next.join('x'))
}
const emit = defineEmits<{ 'update:modelValue': [value: string]; save: []; cancel: [] }>()
const input = ref<HTMLInputElement | HTMLTextAreaElement>()
onMounted(() => nextTick(() => input.value?.focus()))
</script>
<template>
  <form class="metadata-inline-editor" @submit.prevent="emit('save')" @keydown.stop @keydown.esc="!saving && emit('cancel')">
    <textarea v-if="multiline" ref="input" :value="modelValue" :aria-label="`编辑${label}`" :disabled="saving" rows="4" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
    <div v-else-if="size" class="dimensions"><label>宽<MetadataNumberInput :model-value="dimensions[0] || ''" :min="1" integer :disabled="saving" label="生成宽度" placeholder="1024" autofocus @update:model-value="setDimension(0, $event)" /></label><span>×</span><label>高<MetadataNumberInput :model-value="dimensions[1] || ''" :min="1" integer :disabled="saving" label="生成高度" placeholder="1024" @update:model-value="setDimension(1, $event)" /></label></div>
    <MetadataNumberInput v-else-if="numeric" :model-value="modelValue" v-bind="numeric" :label="label" :placeholder="placeholder" :disabled="saving" autofocus @update:model-value="emit('update:modelValue', String($event))" />
    <input v-else ref="input" :placeholder="placeholder" :value="modelValue" :aria-label="`编辑${label}`" :disabled="saving" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
    <p v-if="error" role="alert">{{ error }}</p>
    <div><button type="button" :disabled="saving" @click="emit('cancel')">取消</button><button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存' }}</button></div>
  </form>
</template>
<style scoped>
.metadata-inline-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

input,textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid #91bcff77;
  border-radius: 8px;
  background: #10151caa;
  color: #e9eef6;
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
  caret-color: auto;
}

textarea {
  resize: vertical;
}

input:focus,textarea:focus {
  outline: 1px solid #91bcff;
}

.metadata-inline-editor>.dimensions {
  display: grid;
  grid-template-columns: minmax(0,1fr) auto minmax(0,1fr);
  align-items: end;
  gap: 6px;
}

.dimensions label {
  font-size: 11px;
  color: #aebbd0;
}

.dimensions span {
  padding-bottom: 9px;
  color: #aebbd0;
}

.metadata-inline-editor>div {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

button {
  border: 1px solid #ffffff26;
  border-radius: 6px;
  background: #ffffff09;
  color: #cbd5e4;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

button:last-child {
  background: #2868af;
  color: #fff;
}

button:disabled {
  opacity: .5;
  cursor: default;
}

p {
  margin: 0;
  color: #ff9c9c;
  font-size: 12px;
}
</style>
