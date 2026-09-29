<script setup lang="ts">
import { computed, useId } from 'vue'
import type { StudioWorkflowParameter } from '../api/imageAi'
import { parameterSliderRange } from '../model/workflowParameters'

const props = defineProps<{
  parameter: StudioWorkflowParameter
  value?: string | number | boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:value': [value: string | number | boolean] }>()
const inputId = useId()
const slider = computed(() => parameterSliderRange(props.parameter))
const numberValue = computed(() =>
  typeof props.value === 'number' && Number.isFinite(props.value) ? props.value : undefined
)
function updateNumber(value: number | string | null) {
  emit('update:value', value === null || value === '' ? Number.NaN : Number(value))
}
</script>

<template>
  <div class="workflow-parameter-input">
    <label :for="inputId">{{ parameter.name || '未命名参数' }}</label>
    <template v-if="parameter.kind === 'number'">
      <div :class="{ 'workflow-number-slider': slider }">
        <a-slider
          v-if="slider"
          :value="numberValue"
          :min="slider.min"
          :max="slider.max"
          :step="slider.step"
          :disabled="disabled"
          :aria-label-for-handle="`${parameter.name}滑块`"
          @update:value="updateNumber"
        />
        <a-input-number
          :id="inputId"
          :value="numberValue"
          :min="parameter.minimum ?? undefined"
          :max="parameter.maximum ?? undefined"
          :step="parameter.step ?? 1"
          :disabled="disabled"
          :aria-label="parameter.name"
          @update:value="updateNumber"
        />
      </div>
      <div v-if="slider" class="slider-range">
        <span>{{ slider.min }}</span
        ><span>{{ slider.max }}</span>
      </div>
    </template>
    <a-input
      v-else-if="parameter.kind === 'text'"
      :id="inputId"
      :value="typeof value === 'string' ? value : ''"
      :disabled="disabled"
      @update:value="emit('update:value', $event)"
    />
    <a-switch
      v-else-if="parameter.kind === 'boolean'"
      :id="inputId"
      :checked="value === true"
      :disabled="disabled"
      :aria-label="parameter.name"
      @update:checked="emit('update:value', $event)"
    />
    <a-select
      v-else
      :id="inputId"
      :value="typeof value === 'number' ? value : -1"
      :disabled="disabled"
      :options="[
        { value: -1, label: '保持工作流默认' },
        ...parameter.options.map((option, index) => ({ value: index, label: option.name }))
      ]"
      @update:value="emit('update:value', Number($event))"
    />
  </div>
</template>

<style scoped>
.workflow-parameter-input {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
}
.workflow-parameter-input > label {
  color: var(--ui-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.workflow-parameter-input :deep(.ant-input-number) {
  width: 100%;
}
.workflow-parameter-input :deep(.ant-switch) {
  align-self: flex-start;
}
.workflow-number-slider {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  align-items: center;
  gap: 16px;
}
.workflow-number-slider :deep(.ant-slider) {
  min-width: 0;
  margin: 10px 5px;
}
.slider-range {
  display: flex;
  justify-content: space-between;
  padding-right: 108px;
  color: var(--ui-muted);
  font-size: 10px;
}
</style>
