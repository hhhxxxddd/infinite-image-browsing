<script setup lang="ts">
const model = defineModel<number>()
defineProps<{ min: number; max: number; step: number; label?: string }>()
</script>
<template>
  <div class="num-input">
    <a-input-number v-model:value="model" :min="min" :max="max" :step="step" :aria-label="label" />
    <a-slider
      v-model:value="model"
      :min="min"
      :max="max"
      :step="step"
      :aria-label-for-handle="label"
      class="slide"
    />
  </div>
</template>
<style lang="scss" scoped>
.num-input {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  max-width: 420px;
  min-width: 0;
  :deep(.ant-input-number) {
    flex: 0 0 88px;
    width: 88px;
  }
  .slide {
    flex: 1;
    min-width: 48px;
    margin: 10px 6px;
  }
}
</style>
