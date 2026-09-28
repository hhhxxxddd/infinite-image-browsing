<script setup lang="ts">
import { CloseOutlined } from '@ant-design/icons-vue'
import StudioToolIcon from './StudioToolIcon.vue'

const props = withDefaults(
  defineProps<{ dirty: boolean; saving: boolean; readonly?: boolean; showHeading?: boolean }>(),
  { showHeading: true }
)
const note = defineModel<string>('note', { required: true })
const emit = defineEmits<{ close: []; save: [] }>()
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    event.stopPropagation()
    if (props.dirty && !props.saving && !props.readonly) emit('save')
  }
}
</script>

<template>
  <section class="editor-notes-panel" aria-label="制作笔记" @keydown="keydown">
    <header v-if="showHeading">
      <strong><StudioToolIcon kind="note" />制作笔记</strong>
      <button type="button" title="收起笔记" aria-label="收起制作笔记" @click="emit('close')">
        <CloseOutlined />
      </button>
    </header>
    <p>记录这份制作文件的想法、要求和待办。</p>
    <textarea
      v-model="note"
      maxlength="5000"
      :disabled="readonly"
      placeholder="写下创作想法或需要继续调整的地方…"
      aria-label="制作笔记"
    />
    <footer>
      <span role="status">{{
        saving ? '正在保存…' : dirty ? '有未保存的修改' : '笔记已保存'
      }}</span>
      <button type="button" :disabled="readonly || saving || !dirty" @click="emit('save')">
        {{ saving ? '保存中…' : '保存笔记' }}
      </button>
    </footer>
  </section>
</template>

<style scoped>
.editor-notes-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--editor-panel-spacing, 12px);
  min-height: 0;
  height: 100%;
}
header,
header strong,
footer {
  display: flex;
  align-items: center;
  gap: 8px;
}
header strong {
  flex: 1;
  font-size: 13px;
}
header :deep(svg) {
  width: var(--editor-icon-size, 16px);
  height: var(--editor-icon-size, 16px);
}
header button {
  display: grid;
  place-items: center;
  flex: none;
  width: var(--editor-tool-size, 32px);
  height: var(--editor-tool-size, 32px);
  padding: 0;
  border: 1px solid var(--ui-control-border);
  border-radius: 7px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  cursor: pointer;
}
p {
  margin: 0;
  color: var(--ui-muted);
  font-size: 11px;
  line-height: 1.5;
}
textarea {
  flex: 1;
  min-height: 80px;
  width: 100%;
  box-sizing: border-box;
  resize: none;
  border: 1px solid var(--ui-control-border);
  border-radius: 7px;
  background: var(--ui-surface-soft);
  color: var(--ui-text);
  padding: 9px;
  font: inherit;
  font-size: var(--editor-field-font-size, 12px);
  line-height: 1.6;
}
textarea:focus-visible {
  outline: 1px solid var(--primary-color);
}
footer {
  justify-content: space-between;
  flex-wrap: wrap;
}
footer span {
  color: var(--ui-muted);
  font-size: 10px;
}
footer button {
  flex: none;
  min-height: var(--editor-field-height, 32px);
  border: 1px solid var(--primary-color);
  border-radius: 7px;
  background: var(--primary-color);
  color: #152a46;
  padding: 0 9px;
  cursor: pointer;
  font-size: 11px;
}
button:hover:not(:disabled) {
  filter: brightness(1.1);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
