<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { generationResourceTypes } from '@/features/generation-metadata/model/generationFields'
import {
  parseResourceWeight,
  type GenerationResource
} from '@/features/generation-metadata/model/generationResources'
const props = defineProps<{ saving: boolean; error: string }>()
const emit = defineEmits<{ save: [resource: GenerationResource]; cancel: [] }>()
const type = ref('lora')
const name = ref('')
const weight = ref<string | number>('')
const validationError = ref('')
const hash = ref('')
const nameInput = ref<HTMLInputElement>()
onMounted(() => nextTick(() => nameInput.value?.focus()))
function save() {
  if (props.saving) return
  validationError.value = ''
  try {
    const parsedWeight = parseResourceWeight(weight.value)
    if (!name.value.trim()) throw new Error('请填写资源名称')
    emit('save', {
      type: type.value,
      name: name.value.trim(),
      ...(parsedWeight != null ? { weight: parsedWeight } : {}),
      ...(hash.value.trim() ? { hash: hash.value.trim() } : {})
    })
  } catch (cause) {
    validationError.value = cause instanceof Error ? cause.message : '请检查资源信息'
  }
}
</script>
<template>
  <form
    class="resource-form"
    @submit.prevent="save"
    @keydown.stop
    @keydown.esc="!saving && emit('cancel')"
  >
    <fieldset :disabled="saving">
      <label
        >类型<select v-model="type" aria-label="资源类型">
          <option v-for="entry in generationResourceTypes" :key="entry.key" :value="entry.key">
            {{ entry.label }}
          </option>
        </select></label
      >
      <label
        >名称<input
          ref="nameInput"
          v-model="name"
          required
          maxlength="300"
          placeholder="模型名称或文件名"
          aria-label="资源名称"
      /></label>
      <div class="resource-form-pair">
        <label
          >权重（可选）<MetadataNumberInput
            v-model="weight"
            themed
            label="资源权重"
            :step="0.1"
            :disabled="saving"
            placeholder="可留空" /></label
        ><label
          >哈希（可选）<input
            v-model="hash"
            maxlength="128"
            placeholder="例如 SHA256"
            aria-label="资源哈希"
        /></label>
      </div>
      <p v-if="validationError || error" role="alert">{{ validationError || error }}</p>
      <div class="resource-form-actions">
        <a-button :disabled="saving" @click="emit('cancel')">取消</a-button>
        <a-button type="primary" html-type="submit" :loading="saving" :disabled="saving"
          >添加资源</a-button
        >
      </div>
    </fieldset>
  </form>
</template>
<style scoped>
fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ui-text);
  font-size: 12px;
  min-width: 0;
}

input,
select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid var(--ui-control-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  caret-color: auto;
}

input:focus,
select:focus {
  outline: 1px solid var(--primary-color);
}

.resource-form-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.resource-form-actions {
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

select {
  color-scheme: light;
}
:global(body.dark) select {
  color-scheme: dark;
}
@media (max-width: 480px) {
  .resource-form-pair {
    grid-template-columns: 1fr;
  }
}
</style>
