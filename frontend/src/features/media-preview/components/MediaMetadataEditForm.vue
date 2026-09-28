<script setup lang="ts">
import { computed, nextTick, ref, toRefs, watch, type UnwrapNestedRefs } from 'vue'
import type { usePreviewMetadata } from '../composables/usePreviewMetadata'
import { useApplicationStore } from '@/features/application/public'
import {
  generationFieldLabel,
  generationNumberOptions,
  generationParameterFields
} from '@/features/generation-metadata/public'
import MetadataInlineEditor from '../../generation-metadata/components/MetadataInlineEditor.vue'
import GenerationResourceForm from '../../generation-metadata/components/GenerationResourceForm.vue'

const props = defineProps<{
  session: UnwrapNestedRefs<ReturnType<typeof usePreviewMetadata>>
  kind: 'description' | 'reference' | 'generation'
}>()
const global = useApplicationStore()
const {
  descriptionDraft,
  descriptionSaving,
  imageDescription,
  aiPromptDraft,
  aiPromptSaved,
  aiSavingPrompt,
  aiLoadingTask,
  aiError,
  inlineField,
  inlineDraft,
  inlineSaving,
  inlineError,
  isWorkspaceArtifact,
  saveDescription,
  saveAiPrompt,
  cancelMetadataEdit,
  saveInline
} = toRefs(props.session)
const kind = computed(() => props.kind)
const multiline = computed(() => ['prompt', 'negativePrompt'].includes(inlineField.value))
const title = computed(() => {
  if (kind.value === 'description') return '编辑媒体描述'
  if (kind.value === 'reference') return '编辑参考提示词'
  if (inlineField.value === '__resource') return '添加使用资源'
  return `编辑${generationFieldLabel(inlineField.value)}`
})
const saving = computed(() =>
  kind.value === 'description'
    ? descriptionSaving.value
    : kind.value === 'reference'
      ? aiSavingPrompt.value
      : inlineSaving.value
)
const generating = computed(() =>
  kind.value === 'description'
    ? aiLoadingTask.value === 'description'
    : kind.value === 'reference' && aiLoadingTask.value === 'prompt'
)
const textDraft = computed({
  get: () => (kind.value === 'description' ? descriptionDraft.value : aiPromptDraft.value),
  set: (value: string) => {
    if (kind.value === 'description') descriptionDraft.value = value
    else aiPromptDraft.value = value
  }
})
const unchanged = computed(() =>
  kind.value === 'description'
    ? descriptionDraft.value === imageDescription.value
    : aiPromptDraft.value === aiPromptSaved.value
)
const textInput = ref<{ focus: () => void }>()
watch(
  kind,
  async () => {
    if (kind.value !== 'description' && kind.value !== 'reference') return
    await nextTick()
    textInput.value?.focus()
  },
  { immediate: true }
)

function cancel() {
  cancelMetadataEdit.value()
}
function saveText() {
  if (saving.value || generating.value || unchanged.value || global.conf?.is_readonly) return
  if (kind.value === 'description') void saveDescription.value()
  else void saveAiPrompt.value()
}
</script>

<template>
  <div
    class="metadata-edit-content"
    :class="{ 'metadata-edit-content--compact': kind === 'generation' && !multiline }"
    @keydown.stop
    @wheel.stop
  >
    <strong class="metadata-edit-title">{{ title }}</strong>
    <form
      v-if="kind === 'description' || kind === 'reference'"
      class="metadata-text-form"
      @submit.prevent="saveText"
      @keydown.esc.prevent="cancel"
      @keydown.ctrl.enter.prevent="saveText"
      @keydown.meta.enter.prevent="saveText"
    >
      <a-textarea
        ref="textInput"
        v-model:value="textDraft"
        :aria-label="kind === 'description' ? '媒体描述编辑区' : '参考提示词编辑区'"
        :auto-size="{ minRows: 6, maxRows: 12 }"
        :maxlength="5000"
        :disabled="saving || generating || global.conf?.is_readonly"
        :placeholder="
          kind === 'reference'
            ? '填写或调整参考提示词'
            : isWorkspaceArtifact
              ? '写下媒体内容或备注；同步到媒体库后可用于搜索'
              : '写下媒体内容或备注，保存后可通过文字搜索'
        "
      />
      <p v-if="generating" class="metadata-edit-status" role="status">AI 正在生成…</p>
      <p v-if="aiError" class="metadata-edit-error" role="alert">{{ aiError }}</p>
      <div class="metadata-edit-footer">
        <a-button :disabled="saving" @click="cancel">取消</a-button>
        <a-button
          type="primary"
          html-type="submit"
          :loading="saving"
          :disabled="generating || unchanged || global.conf?.is_readonly"
        >
          {{ kind === 'description' ? '保存描述' : '保存参考提示词' }}
        </a-button>
      </div>
    </form>
    <GenerationResourceForm
      v-else-if="kind === 'generation' && inlineField === '__resource'"
      :saving="inlineSaving"
      :error="inlineError"
      @save="saveInline"
      @cancel="cancel"
    />
    <div v-else-if="kind === 'generation'" class="metadata-field-form">
      <MetadataInlineEditor
        :key="inlineField"
        v-model="inlineDraft"
        :label="generationFieldLabel(inlineField)"
        :multiline="multiline"
        :size="inlineField === 'Size'"
        :numeric="generationNumberOptions(inlineField)"
        :placeholder="
          generationParameterFields.find((field) => field.key === inlineField)?.placeholder
        "
        :saving="inlineSaving"
        :error="inlineError"
        @save="saveInline"
        @cancel="cancel"
      />
    </div>
  </div>
</template>

<style scoped>
.metadata-edit-content {
  width: min(420px, calc(100vw - 64px));
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  color: var(--ui-text);
  font: 13px/1.6 var(--ui-font);
}
.metadata-edit-content--compact {
  width: min(340px, calc(100vw - 64px));
}
.metadata-edit-title {
  font-size: 14px;
  font-weight: 600;
}
.metadata-text-form,
.metadata-field-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.metadata-text-form :deep(textarea) {
  font: inherit;
  line-height: 1.7;
  caret-color: auto;
}
.metadata-edit-status,
.metadata-edit-error {
  margin: 0;
  font-size: 12px;
}
.metadata-edit-status {
  color: var(--ui-muted);
}
.metadata-edit-error {
  color: var(--ant-error-color, #ff4d4f);
}
.metadata-edit-footer {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border);
}
</style>
