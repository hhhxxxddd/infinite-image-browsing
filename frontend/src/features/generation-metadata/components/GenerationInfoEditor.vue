<script setup lang="ts">
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { nextTick, onUnmounted, ref, watch } from 'vue'
import { updateExif } from '@/features/generation-metadata/api'
import { updateWorkspaceArtifactMetadata } from '@/features/workspaces/public'
import { useApplicationStore } from '@/features/application/public'
import { message, Modal } from 'ant-design-vue'
import {
  readGenerationDraft,
  writeGenerationDraft,
  readParameter,
  setParameter
} from '@/features/generation-metadata/model/generationInfoDraft'
import { generationParameterFields } from '@/features/generation-metadata/model/generationFields'
const props = defineProps<{
  open: boolean
  path: string
  name: string
  raw: string
  artifactId?: string
  rawOnly?: boolean
}>()
const emit = defineEmits<{ close: []; saved: [path: string] }>()
const global = useApplicationStore()
const draft = ref(readGenerationDraft(''))
const rawDraft = ref('')
const mode = ref<'fields' | 'raw'>('fields')
const saving = ref(false)
const error = ref('')
const original = ref('')
const rawInput = ref<{ focus: () => void }>()
let confirmingCancel = false
let saveRequest = 0
const commonFields = [
  { key: 'Model', label: '模型' },
  ...generationParameterFields,
  { key: 'Model hash', label: '模型哈希' }
]
onUnmounted(() => {
  saveRequest++
})
watch(
  () => [props.open, props.path, props.artifactId] as const,
  async ([open]) => {
    saveRequest++
    saving.value = false
    if (!open) return
    rawDraft.value = props.raw
    draft.value = readGenerationDraft(props.raw)
    original.value = JSON.stringify(draft.value)
    mode.value = props.rawOnly || draft.value.rawPreferred ? 'raw' : 'fields'
    error.value = ''
    await nextTick()
    rawInput.value?.focus()
  },
  { immediate: true }
)
function changeMode(next: 'fields' | 'raw') {
  if (next === mode.value || saving.value) return
  try {
    if (next === 'raw')
      rawDraft.value =
        JSON.stringify(draft.value) === original.value
          ? rawDraft.value
          : writeGenerationDraft(draft.value)
    else {
      draft.value = readGenerationDraft(rawDraft.value)
      original.value = JSON.stringify(draft.value)
    }
    mode.value = next
    error.value = ''
  } catch (e) {
    error.value = getErrorMessage(e, '无法切换编辑模式')
  }
}
function cancel() {
  if (saving.value || confirmingCancel) return
  if (rawDraft.value !== props.raw || JSON.stringify(draft.value) !== original.value) {
    confirmingCancel = true
    Modal.confirm({
      title: '放弃未保存的修改？',
      zIndex: 1100,
      getContainer: () =>
        document.fullscreenElement instanceof HTMLElement
          ? document.fullscreenElement
          : document.body,
      okText: '放弃修改',
      cancelText: '继续编辑',
      onOk: () => emit('close'),
      afterClose: () => {
        confirmingCancel = false
      }
    })
  } else emit('close')
}
async function save() {
  if (saving.value || global.conf?.is_readonly) return
  const request = ++saveRequest
  const { path, artifactId } = props
  error.value = ''
  try {
    const value =
      mode.value === 'raw' || JSON.stringify(draft.value) === original.value
        ? rawDraft.value
        : writeGenerationDraft(draft.value)
    saving.value = true
    if (artifactId) await updateWorkspaceArtifactMetadata(artifactId, { generation_info: value })
    else await updateExif(path, value)
    if (request !== saveRequest) return
    message.success('生成信息已保存')
    emit('saved', path)
    emit('close')
  } catch (e) {
    if (request === saveRequest) error.value = getErrorMessage(e, '保存失败，请重试')
  } finally {
    if (request === saveRequest) saving.value = false
  }
}
defineExpose({ cancel })
</script>
<template>
  <div v-if="open" class="generation-editor-popover" @keydown.stop @wheel.stop>
    <strong :title="name">{{ rawOnly ? '编辑原始生成信息' : '编辑生成信息' }}</strong>
    <form
      @submit.prevent="save"
      @keydown.esc.prevent="cancel"
      @keydown.ctrl.enter.prevent="save"
      @keydown.meta.enter.prevent="save"
    >
      <fieldset :disabled="saving || global.conf?.is_readonly" class="metadata-editor">
        <div v-if="!rawOnly" class="edit-modes">
          <button type="button" :aria-pressed="mode === 'fields'" @click="changeMode('fields')">
            分项填写</button
          ><button type="button" :aria-pressed="mode === 'raw'" @click="changeMode('raw')">
            原文编辑
          </button>
        </div>
        <template v-if="mode === 'fields'">
          <label
            >正向提示词<a-textarea
              v-model:value="draft.positive"
              aria-label="编辑正向提示词"
              :auto-size="{ minRows: 3, maxRows: 7 }"
          /></label>
          <label
            >负向提示词<a-textarea
              v-model:value="draft.negative"
              aria-label="编辑负向提示词"
              :auto-size="{ minRows: 2, maxRows: 5 }"
          /></label>
          <div class="parameter-edit-grid">
            <label v-for="field in commonFields" :key="field.key"
              >{{ field.label }} <small>{{ field.key }}</small
              ><a-input
                :value="readParameter(draft.parameters, field.key)"
                :aria-label="`编辑 ${field.key}`"
                :placeholder="field.key === 'Size' ? '例如 1024x1024' : '未填写'"
                @update:value="
                  draft.parameters = setParameter(draft.parameters, field.key, $event)
                "
            /></label>
          </div>
          <details class="advanced-edit">
            <summary>更多参数与补充信息</summary>
            <label
              >全部生成参数<a-textarea
                v-model:value="draft.parameters"
                aria-label="编辑生成参数"
                :auto-size="{ minRows: 3, maxRows: 7 }"
            /></label>
            <label
              >补充信息（JSON 对象，可添加任意字段）<a-textarea
                v-model:value="draft.extra"
                aria-label="编辑补充信息"
                placeholder='例如 {"工作流": "文生图", "备注": "第一版"}'
                :auto-size="{ minRows: 3, maxRows: 7 }"
            /></label>
          </details>
        </template>
        <div v-else class="raw-mapping-layout">
          <label
            >原始生成信息<a-textarea
              ref="rawInput"
              v-model:value="rawDraft"
              aria-label="编辑原始生成信息"
              :auto-size="{ minRows: 8, maxRows: 14 }"
          /></label>
          <details class="advanced-edit">
            <summary>查看解析结果</summary>
            <GenerationMappingPreview :raw="rawDraft" />
          </details>
        </div>
        <a-alert v-if="error" type="error" :message="error" show-icon />
      </fieldset>
      <div class="generation-editor-actions">
        <a-button :disabled="saving" @click="cancel">取消</a-button>
        <a-button
          type="primary"
          html-type="submit"
          :loading="saving"
          :disabled="global.conf?.is_readonly"
          >保存生成信息</a-button
        >
      </div>
    </form>
  </div>
</template>
<style scoped>
.generation-editor-popover {
  width: min(480px, calc(100vw - 64px));
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--ui-text);
  font: 13px/1.6 var(--ui-font);
}
.generation-editor-popover > strong {
  font-size: 14px;
}
.generation-editor-popover > form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.generation-editor-popover :deep(textarea) {
  font: inherit;
  caret-color: auto;
}
.generation-editor-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border);
}
.raw-mapping-layout {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.raw-mapping-layout > label {
  min-width: 0;
}

.metadata-editor {
  border: 0;
  padding: 0;
  margin: 0;
  max-height: 55dvh;
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

.edit-modes button[aria-pressed='true'] {
  color: var(--primary-color);
  border-color: var(--primary-color);
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

@media (max-width: 480px) {
  .parameter-edit-grid {
    grid-template-columns: 1fr;
  }
}
</style>
