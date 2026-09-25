<script setup lang="ts">
import { useId } from 'vue'
import { ReloadOutlined } from '@ant-design/icons-vue'

defineProps<{ label: string; value: number; display: string; min: number; max: number;
  step?: number; defaultValue: number; disabled?: boolean }>()
const emit = defineEmits<{ input: [value: number]; begin: []; finish: []; reset: [] }>()
const id = useId()
</script>

<template>
  <div class="range-field">
    <label :for="id" class="range-label">{{ label }}</label>
    <div class="range-row">
      <button type="button" :aria-label="`重置${label}`" :title="`重置${label}`"
        :disabled="disabled || value === defaultValue" @click="emit('reset')"><ReloadOutlined /></button>
      <input :id="id" type="range" :value="value" :min="min" :max="max" :step="step ?? 1" :disabled="disabled"
        @focus="emit('begin')" @input="emit('begin'); emit('input', Number(($event.target as HTMLInputElement).value))"
        @change="emit('finish')" />
    </div>
    <span class="range-value">{{ display }}</span>
  </div>
</template>

<style scoped>
.range-field{display:grid;grid-template-columns:48px minmax(0,1fr) 42px;align-items:center;gap:5px;margin:7px 0;color:var(--ui-muted);font-size:11px}
.range-label{white-space:nowrap}.range-value{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.range-row{display:flex;align-items:center;gap:6px}
.range-row button{display:grid;place-items:center;flex:none;width:23px;height:23px;padding:0;border:1px solid var(--ui-border);border-radius:6px;background:var(--ui-surface-soft);color:var(--ui-muted);cursor:pointer;font-size:12px}
.range-row button:hover:not(:disabled){border-color:var(--primary-color);color:var(--primary-color)}
.range-row button:disabled{opacity:.45;cursor:default}
.range-row input{flex:1;min-width:0;margin:0;accent-color:var(--primary-color)}
.range-row :is(button,input):focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}
</style>
