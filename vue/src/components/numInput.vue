<script setup lang="ts">
const model = defineModel<number>()
const props = defineProps<{ min: number, max: number, step: number }>()

</script>
<template>
  <div class="num-input">
    <a-input-number v-model:value="model" v-bind="props" />
    <a-slider v-model:value="model" v-bind="props" class="slide"/>
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
  :deep(.ant-input-number) { flex: 0 0 88px; width: 88px; }
  .slide {
    flex: 1;
    min-width: 48px;
    margin: 10px 6px;
  }
}
</style>
