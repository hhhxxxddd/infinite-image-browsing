<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { updateExif } from '@/api'
import { updateWorkspaceArtifactMetadata } from '@/api/workspaceArtifacts'
import { useGlobalStore } from '@/store/useGlobalStore'
import { message, Modal } from 'ant-design-vue'
import { readGenerationDraft, writeGenerationDraft, readParameter, setParameter } from '@/util/generationInfoDraft'
import { generationParameterFields } from '@/util/generationFields'
const props = defineProps<{open:boolean; path:string; name:string; raw:string; artifactId?: string; rawOnly?: boolean}>()
const emit = defineEmits<{close:[]; saved:[path:string]}>()
const global = useGlobalStore()
const draft = ref(readGenerationDraft(''))
const rawDraft = ref('')
const mode = ref<'fields'|'raw'>('fields')
const saving = ref(false)
const error = ref('')
const original = ref('')
let saveRequest = 0
const commonFields = [
  { key: 'Model', label: '模型' },
  ...generationParameterFields,
  { key: 'Model hash', label: '模型哈希' },
]
onUnmounted(() => { saveRequest++ })
watch(() => [props.open, props.path, props.artifactId] as const, ([open]) => {
  saveRequest++
  saving.value = false
  if (!open) return
  rawDraft.value = props.raw
  draft.value = readGenerationDraft(props.raw)
  original.value = JSON.stringify(draft.value)
  mode.value = props.rawOnly || draft.value.rawPreferred ? 'raw' : 'fields'
  error.value = ''
})
function changeMode(next: 'fields'|'raw') {
  if (next === mode.value || saving.value) return
  try {
    if (next === 'raw') rawDraft.value = JSON.stringify(draft.value) === original.value ? rawDraft.value : writeGenerationDraft(draft.value)
    else { draft.value = readGenerationDraft(rawDraft.value); original.value = JSON.stringify(draft.value) }
    mode.value = next
    error.value = ''
  } catch (e:any) { error.value = e.message }
}
function cancel() {
  if (saving.value) return
  if (rawDraft.value !== props.raw || JSON.stringify(draft.value) !== original.value) {
    Modal.confirm({title:'放弃未保存的修改？',okText:'放弃修改',cancelText:'继续编辑',onOk:()=>emit('close')})
  } else emit('close')
}
async function save() {
  if (saving.value || global.conf?.is_readonly) return
  const request = ++saveRequest
  const {path, artifactId} = props
  error.value = ''
  try {
    const value = mode.value === 'raw' || JSON.stringify(draft.value) === original.value ? rawDraft.value : writeGenerationDraft(draft.value)
    saving.value = true
    if (artifactId) await updateWorkspaceArtifactMetadata(artifactId, { generation_info: value })
    else await updateExif(path, value)
    if (request !== saveRequest) return
    message.success('生成信息已保存')
    emit('saved', path)
    emit('close')
  } catch(e:any) { if (request === saveRequest) error.value = e.response?.data?.detail || e.message || '保存失败，请重试' }
  finally { if (request === saveRequest) saving.value = false }
}
</script>
<template>
  <a-modal :open="open" :title="`${rawOnly ? '编辑原始生成信息' : '编辑生成信息'} · ${name}`" :width="rawOnly ? 960 : 760" :mask-closable="false" :closable="!saving" :keyboard="!saving" :confirm-loading="saving" :ok-button-props="{disabled:global.conf?.is_readonly}" :cancel-button-props="{disabled:saving}" ok-text="保存生成信息" cancel-text="取消" @cancel="cancel" @ok="save">
    <fieldset :disabled="saving" class="metadata-editor" @keydown.stop @wheel.stop>
      <div v-if="!rawOnly" class="edit-modes"><button type="button" :aria-pressed="mode==='fields'" @click="changeMode('fields')">分项填写</button><button type="button" :aria-pressed="mode==='raw'" @click="changeMode('raw')">原文编辑</button></div>
      <p class="editor-hint">允许留空，可补全未识别的信息。修改保存在当前素材中。</p>
      <template v-if="mode==='fields'">
        <label>正向提示词<a-textarea v-model:value="draft.positive" aria-label="编辑正向提示词" :auto-size="{minRows:3,maxRows:7}" /></label>
        <label>负向提示词<a-textarea v-model:value="draft.negative" aria-label="编辑负向提示词" :auto-size="{minRows:2,maxRows:5}" /></label>
        <div class="parameter-edit-grid"><label v-for="field in commonFields" :key="field.key">{{ field.label }} <small>{{ field.key }}</small><a-input :value="readParameter(draft.parameters, field.key)" :aria-label="`编辑 ${field.key}`" :placeholder="field.key==='Size' ? '例如 1024x1024' : '未填写'" @update:value="draft.parameters = setParameter(draft.parameters, field.key, $event)" /></label></div>
        <details class="advanced-edit"><summary>更多参数与补充信息</summary>
          <label>全部生成参数<a-textarea v-model:value="draft.parameters" aria-label="编辑生成参数" :auto-size="{minRows:3,maxRows:7}" /></label>
          <label>补充信息（JSON 对象，可添加任意字段）<a-textarea v-model:value="draft.extra" aria-label="编辑补充信息" placeholder='例如 {"工作流": "文生图", "备注": "第一版"}' :auto-size="{minRows:3,maxRows:7}" /></label>
        </details>
      </template>
      <div v-else class="raw-mapping-layout"><label>原始生成信息<a-textarea v-model:value="rawDraft" aria-label="编辑原始生成信息" :auto-size="{minRows:12,maxRows:22}" /></label><GenerationMappingPreview :raw="rawDraft" /></div>
      <a-alert v-if="error" type="error" :message="error" show-icon />
    </fieldset>
  </a-modal>
</template>
<style scoped>
.raw-mapping-layout {
  display: grid;
  grid-template-columns: minmax(0,1fr) minmax(0,1fr);
  gap: 16px;
  align-items: start;
}

.raw-mapping-layout>label {
  min-width: 0;
}

@media(max-width:700px) {

  .raw-mapping-layout {
    grid-template-columns: 1fr;
  }
}

.metadata-editor {
  border: 0;
  padding: 0;
  margin: 0;
  max-height: 65vh;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.metadata-editor label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}

.edit-modes {
  display: flex;
  gap: 6px;
}

.edit-modes button {
  border: 1px solid var(--zp-border);
  border-radius: 5px;
  padding: 5px 10px;
  background: var(--zp-primary-background);
  color: var(--zp-primary);
  cursor: pointer;
}

.edit-modes button[aria-pressed="true"] {
  color: var(--primary-color);
  border-color: var(--primary-color);
}

.editor-hint {
  font-size: 12px;
  color: var(--zp-secondary);
  margin: 0;
}

.parameter-edit-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.parameter-edit-grid label {
  gap: 4px;
}

.parameter-edit-grid small {
  color: var(--zp-secondary);
  font-size: 10px;
}

.advanced-edit summary {
  font-size: 12px;
  cursor: pointer;
  color: var(--zp-secondary);
}

.advanced-edit label {
  margin-top: 12px;
}

@media(max-width:480px) {

  .parameter-edit-grid {
    grid-template-columns: 1fr;
  }
}
</style>
