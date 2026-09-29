<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { SettingOutlined } from '@ant-design/icons-vue'
import type { StudioDocument } from '@/features/image-editor/public'
import {
  defaultAnnotationPromptRules,
  extractAnnotationPrompt,
  formatAnnotationPrompt,
  validAnnotationTemplate,
  type AnnotationPromptRules
} from '../model/annotationPrompt'

const props = defineProps<{
  rules: AnnotationPromptRules
  doc: StudioDocument | null
  disabled?: boolean
  saveRules: (rules: AnnotationPromptRules) => Promise<boolean>
}>()
const open = ref(false)
const saving = ref(false)
const error = ref('')
const trigger = ref<HTMLButtonElement>()
const form = ref<HTMLElement>()
const draft = ref({ ...defaultAnnotationPromptRules })
const fields = [
  { key: 'rect', label: '方框批注', sample: '替换背景' },
  { key: 'arrow', label: '箭头批注', sample: '增加纹理' },
  { key: 'paint', label: '涂抹批注', sample: '调整颜色' }
] as const
const valid = computed(() => fields.every(({ key }) => validAnnotationTemplate(draft.value[key])))
const actualPreview = computed(() => valid.value && extractAnnotationPrompt(props.doc, draft.value))
const preview = computed(
  () =>
    actualPreview.value ||
    fields
      .map(({ key, sample }, index) => formatAnnotationPrompt(draft.value[key], sample, index + 1))
      .join('\n')
)
function popupContainer() {
  return document.fullscreenElement instanceof HTMLElement
    ? document.fullscreenElement
    : document.body
}
async function setOpen(value: boolean) {
  if (saving.value || (value && props.disabled)) return
  open.value = value
  if (value) {
    draft.value = { ...props.rules }
    error.value = ''
    await nextTick()
    form.value?.querySelector('textarea')?.focus()
  } else {
    await nextTick()
    trigger.value?.focus()
  }
}
async function save() {
  if (!valid.value || saving.value || props.disabled) return
  saving.value = true
  try {
    if (await props.saveRules({ ...draft.value })) {
      saving.value = false
      await setOpen(false)
    } else error.value = '规则尚未保存，请重试。'
  } catch {
    error.value = '规则尚未保存，请重试。'
  } finally {
    saving.value = false
  }
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && !saving.value) void setOpen(false)
  }
)
watch(form, (element) => element?.querySelector('textarea')?.focus(), { flush: 'post' })
</script>

<template>
  <a-popover
    :open="open"
    trigger="click"
    placement="left"
    overlay-class-name="annotation-rules-popover"
    :get-popup-container="popupContainer"
    :z-index="1100"
    destroy-tooltip-on-hide
    @open-change="setOpen"
  >
    <template #content>
      <form
        v-if="open"
        ref="form"
        class="annotation-rules-form"
        aria-label="批注提取规则"
        @submit.prevent="save"
        @keydown.stop
        @keydown.esc.prevent="setOpen(false)"
        @wheel.stop
      >
        <header>
          <strong>批注提取规则</strong
          ><button
            type="button"
            :disabled="saving"
            @click="draft = { ...defaultAnnotationPromptRules }"
          >
            恢复默认
          </button>
        </header>
        <div class="annotation-rules-fields">
          <p>用 <code>{批注}</code> 插入批注文字，可用 <code>{序号}</code> 插入编号。</p>
          <label v-for="field in fields" :key="field.key">
            <span>{{ field.label }}</span>
            <textarea v-model="draft[field.key]" rows="2" maxlength="1000" :disabled="saving" />
            <small v-if="!validAnnotationTemplate(draft[field.key])" role="alert"
              >请保留 {批注} 占位符。</small
            >
          </label>
          <section class="annotation-rules-preview">
            <strong>{{ actualPreview ? '提取预览' : '格式示例' }}</strong>
            <pre>{{ preview }}</pre>
          </section>
          <p class="annotation-rules-hint">
            只提取可见且有文字的批注，按编号逐行排列。保存后，下次提取时生效。
          </p>
          <p v-if="error" class="annotation-rules-error" role="alert">{{ error }}</p>
        </div>
        <footer>
          <button type="button" :disabled="saving" @click="setOpen(false)">取消</button
          ><button type="submit" class="primary" :disabled="!valid || saving || disabled">
            {{ saving ? '保存中…' : '保存规则' }}
          </button>
        </footer>
      </form>
    </template>
    <button
      ref="trigger"
      type="button"
      class="annotation-rules-trigger"
      aria-label="设置批注提取规则"
      title="批注提取规则"
      :aria-expanded="open"
      :disabled="disabled"
    >
      <SettingOutlined />
    </button>
  </a-popover>
</template>

<style scoped>
.annotation-rules-trigger {
  display: grid;
  place-items: center;
  flex: none;
  width: 26px;
  height: 26px;
  margin-left: auto;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-muted);
  cursor: pointer;
}
.annotation-rules-trigger:hover:not(:disabled) {
  background: var(--ui-hover);
  color: var(--ui-text);
}
.annotation-rules-trigger:disabled {
  opacity: 0.5;
  cursor: default;
}
.annotation-rules-form {
  display: flex;
  flex-direction: column;
  width: min(380px, calc(100vw - 48px));
  max-height: calc(100vh - 80px);
  color: #e5ebf3;
  color-scheme: dark;
  font-size: 12px;
}
.annotation-rules-form header,
.annotation-rules-form footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
}
.annotation-rules-form header {
  justify-content: space-between;
  border-bottom: 1px solid #ffffff16;
}
.annotation-rules-form header strong {
  font-size: 13px;
}
.annotation-rules-fields {
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
}
.annotation-rules-fields p {
  margin: 0 0 12px;
  color: #92a1b5;
  font-size: 11px;
  line-height: 1.6;
}
.annotation-rules-fields code {
  color: #b6d2f6;
}
.annotation-rules-fields label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.annotation-rules-fields textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 58px;
  padding: 8px;
  border: 1px solid #ffffff26;
  border-radius: 6px;
  background: #171e27;
  color: #e5ebf3;
  font: inherit;
  line-height: 1.5;
  resize: vertical;
}
.annotation-rules-fields small,
.annotation-rules-fields p.annotation-rules-error {
  color: #ffc777;
}
.annotation-rules-preview {
  padding: 10px;
  border: 1px solid #ffffff16;
  border-radius: 7px;
  background: #171e27;
}
.annotation-rules-preview strong {
  font-size: 11px;
  color: #92a1b5;
  font-weight: 500;
}
.annotation-rules-preview pre {
  max-height: 130px;
  overflow-y: auto;
  margin: 6px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  line-height: 1.6;
}
.annotation-rules-fields p.annotation-rules-hint {
  margin: 10px 0 0;
}
.annotation-rules-fields p.annotation-rules-error {
  margin: 8px 0 0;
}
.annotation-rules-form footer {
  justify-content: flex-end;
  border-top: 1px solid #ffffff16;
}
.annotation-rules-form button {
  border: 1px solid #ffffff26;
  border-radius: 6px;
  background: #171e27;
  color: #e5ebf3;
  padding: 5px 10px;
  font: inherit;
  cursor: pointer;
}
.annotation-rules-form header button {
  border: 0;
  padding: 0;
  background: transparent;
  color: #94bdf6;
}
.annotation-rules-form button.primary {
  background: #94bdf6;
  border-color: #94bdf6;
  color: #122138;
}
.annotation-rules-form button:disabled {
  opacity: 0.5;
  cursor: default;
}
.annotation-rules-form :is(button, textarea):focus-visible,
.annotation-rules-trigger:focus-visible {
  outline: 2px solid #94bdf6;
  outline-offset: 2px;
}
</style>

<style>
.annotation-rules-popover {
  --ui-border: #ffffff26;
  --ui-surface: #202731;
  --ui-text: #e5ebf3;
  --ui-shadow: 0 10px 32px #0008;
  --ui-radius: 10px;
  --antd-arrow-background-color: #202731;
}
.annotation-rules-popover .ant-popover-inner {
  padding: 0;
  border: 1px solid #ffffff26;
  border-radius: 10px;
  background: #202731;
  box-shadow: 0 10px 32px #0008;
  overflow: hidden;
}
.annotation-rules-popover .ant-popover-arrow::before {
  background: #202731;
}
</style>
