<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
const props = withDefaults(
  defineProps<{
    modelValue: string | number
    label: string
    step?: number
    min?: number
    max?: number
    integer?: boolean
    disabled?: boolean
    placeholder?: string
    autofocus?: boolean
    themed?: boolean
  }>(),
  { step: 1 }
)
const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()
const input = ref<HTMLInputElement>()
function adjust(direction: number) {
  if (props.disabled) return
  const current = Number(props.modelValue)
  const base = Number.isFinite(current) ? (props.integer ? Math.trunc(current) : current) : 0
  const next = Number((base + direction * props.step).toFixed(8))
  emit('update:modelValue', Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, next)))
}
onMounted(() => {
  if (props.autofocus) void nextTick(() => input.value?.focus())
})
</script>
<template>
  <div class="metadata-number-input" :class="{ 'is-disabled': disabled, 'is-themed': themed }">
    <button
      type="button"
      :disabled="disabled || (min != null && modelValue !== '' && Number(modelValue) <= min)"
      :aria-label="`减少${label}`"
      @click="adjust(-1)"
    >
      −
    </button>
    <input
      ref="input"
      type="number"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="integer ? 1 : 'any'"
      :inputmode="integer ? 'numeric' : 'decimal'"
      :aria-label="label"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.up.prevent="adjust(1)"
      @keydown.down.prevent="adjust(-1)"
    />
    <button
      type="button"
      :disabled="disabled || (max != null && modelValue !== '' && Number(modelValue) >= max)"
      :aria-label="`增加${label}`"
      @click="adjust(1)"
    >
      +
    </button>
  </div>
</template>
<style scoped>
.metadata-number-input {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  border: 1px solid #91bcff44;
  border-radius: 8px;
  background: #161d27;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.metadata-number-input:focus-within {
  border-color: #91bcff;
  box-shadow: 0 0 0 2px #91bcff20;
}

.metadata-number-input input {
  box-sizing: border-box;
  flex: 1;
  width: 0;
  min-width: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: #e0eafa;
  padding: 7px 0;
  font: inherit;
  font-size: 12px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  appearance: textfield;
  -moz-appearance: textfield;
  caret-color: #e0eafa;
  user-select: text;
  cursor: text;
}

.metadata-number-input input::-webkit-inner-spin-button,
.metadata-number-input input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.metadata-number-input input:focus-visible {
  outline: none;
  box-shadow: none;
}

.metadata-number-input button {
  display: grid;
  place-items: center;
  flex: 0 0 24px;
  height: 26px;
  margin: 3px;
  padding: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #9eafc7;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}

.metadata-number-input button:hover:not(:disabled) {
  background: #91bcff20;
  color: #d9e8ff;
}

.metadata-number-input button:focus-visible {
  outline: 1px solid #91bcff;
  outline-offset: -1px;
}

.metadata-number-input button:disabled {
  opacity: 0.3;
  cursor: default;
}

.is-disabled {
  opacity: 0.55;
}

.is-themed {
  border-color: var(--ui-control-border);
  background: var(--ui-surface);
}
.is-themed:focus-within {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px var(--ui-accent-soft);
}
.is-themed input {
  color: var(--ui-text);
  font-size: 13px;
  caret-color: auto;
}
.is-themed button {
  color: var(--ui-muted);
}
.is-themed button:hover:not(:disabled) {
  background: var(--ui-accent-soft);
  color: var(--primary-color);
}
.is-themed button:focus-visible {
  outline-color: var(--primary-color);
}
</style>
