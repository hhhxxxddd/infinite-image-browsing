<script setup lang="ts">
import { ref } from 'vue'
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
        <button type="button" @click="emit('cancel')">取消</button
        ><button type="submit">{{ saving ? '保存中…' : '添加资源' }}</button>
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
  gap: 9px;
  min-width: 0;
}

label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #aebbd0;
  font-size: 11px;
  min-width: 0;
}

input,
select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid #91bcff44;
  border-radius: 7px;
  background: #161d27;
  color: #e0eafa;
  font: inherit;
  font-size: 12px;
}

input:focus,
select:focus {
  outline: 1px solid #91bcff;
}

.resource-form-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.resource-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

button {
  padding: 5px 9px;
  border: 1px solid #ffffff26;
  border-radius: 6px;
  background: #ffffff09;
  color: #cbd5e4;
  cursor: pointer;
  font-size: 12px;
}

button:last-child {
  background: #2868af;
  color: white;
}

p {
  margin: 0;
  color: #ff9c9c;
  font-size: 12px;
}
</style>
