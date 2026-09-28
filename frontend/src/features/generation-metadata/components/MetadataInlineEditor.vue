<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
const props = defineProps<{
  modelValue: string
  label: string
  multiline?: boolean
  saving: boolean
  error: string
  size?: boolean
  placeholder?: string
  numeric?: { min: number; max?: number; integer: boolean; step: number }
}>()
const dimensions = computed(() => props.modelValue.split(/\s*[x×]\s*/))
function setDimension(index: number, value: string | number) {
  const next = [dimensions.value[0] || '', dimensions.value[1] || '']
  next[index] = String(value)
  emit('update:modelValue', next.every((value) => !value) ? '' : next.join('x'))
}
const emit = defineEmits<{ 'update:modelValue': [value: string]; save: []; cancel: [] }>()
const input = ref<HTMLInputElement | HTMLTextAreaElement>()
onMounted(() => nextTick(() => input.value?.focus()))
</script>
<template>
  <form
    class="metadata-inline-editor"
    @submit.prevent="emit('save')"
    @keydown.stop
    @keydown.esc="!saving && emit('cancel')"
  >
    <textarea
      v-if="multiline"
      ref="input"
      :value="modelValue"
      :aria-label="`编辑${label}`"
      :disabled="saving"
      rows="6"
      @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
    />
    <div v-else-if="size" class="dimensions">
      <label
        >宽<MetadataNumberInput
          :model-value="dimensions[0] || ''"
          :min="1"
          integer
          themed
          :disabled="saving"
          label="生成宽度"
          placeholder="1024"
          autofocus
          @update:model-value="setDimension(0, $event)" /></label
      ><span>×</span
      ><label
        >高<MetadataNumberInput
          :model-value="dimensions[1] || ''"
          :min="1"
          integer
          themed
          :disabled="saving"
          label="生成高度"
          placeholder="1024"
          @update:model-value="setDimension(1, $event)"
      /></label>
    </div>
    <MetadataNumberInput
      v-else-if="numeric"
      :model-value="modelValue"
      v-bind="numeric"
      themed
      :label="label"
      :placeholder="placeholder"
      :disabled="saving"
      autofocus
      @update:model-value="emit('update:modelValue', String($event))"
    />
    <input
      v-else
      ref="input"
      :placeholder="placeholder"
      :value="modelValue"
      :aria-label="`编辑${label}`"
      :disabled="saving"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <p v-if="error" role="alert">{{ error }}</p>
    <div class="metadata-field-actions">
      <a-button :disabled="saving" @click="emit('cancel')">取消</a-button>
      <a-button type="primary" html-type="submit" :loading="saving" :disabled="saving"
        >保存</a-button
      >
    </div>
  </form>
</template>
<style scoped>
.metadata-inline-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

input,
textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--ui-control-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  caret-color: auto;
}

textarea {
  min-height: 160px;
  max-height: min(420px, 55dvh);
  resize: vertical;
}

input:focus,
textarea:focus {
  outline: 1px solid var(--primary-color);
}

.metadata-inline-editor > .dimensions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: 12px;
}

.dimensions label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--ui-muted);
}

.dimensions span {
  padding-bottom: 9px;
  color: var(--ui-muted);
}

.metadata-field-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border);
}

p {
  margin: 0;
  color: var(--ant-error-color, #ff4d4f);
  font-size: 12px;
}
</style>
