<script setup lang="ts">
import { computed, ref } from 'vue'
import { QuestionCircleOutlined } from '@ant-design/icons-vue'
import { editorHelp, type EditorHelpKind } from '../lib/editorHelp'

const props = defineProps<{ kind: EditorHelpKind }>()
const open = ref(false)
const content = computed(() => editorHelp[props.kind])
</script>

<template>
  <button
    type="button"
    class="editor-help-trigger"
    :aria-label="`${content.title}帮助`"
    :title="`${content.title}帮助与快捷键`"
    @click="open = true"
  >
    <QuestionCircleOutlined />
  </button>
  <a-modal
    v-model:open="open"
    :title="`${content.title} · 工具帮助`"
    :footer="null"
    :z-index="2000"
    wrap-class-name="editor-help-dialog"
    width="min(640px, calc(100vw - 32px))"
    centered
  >
    <div class="editor-help-content">
      <p class="editor-help-intro">{{ content.description }}</p>
      <ul v-if="content.details.length" class="editor-help-details">
        <li v-for="detail in content.details" :key="detail">{{ detail }}</li>
      </ul>
      <h3>快捷键</h3>
      <div class="editor-help-table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">操作</th>
              <th scope="col">按键</th>
              <th scope="col">位置／条件</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in content.shortcuts" :key="`${item.action}-${item.keys}`">
              <td>{{ item.action }}</td>
              <td>
                <kbd>{{ item.keys }}</kbd>
              </td>
              <td>{{ item.scope || '当前编辑器' }}</td>
            </tr>
            <tr v-if="!content.shortcuts.length">
              <td colspan="3" class="editor-help-empty">此工具尚未接入快捷键。</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </a-modal>
</template>

<style scoped>
.editor-help-trigger {
  display: inline-grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--ui-muted, #9eafc0);
  font-size: 17px;
  cursor: pointer;
}
.editor-help-trigger:hover,
.editor-help-trigger:focus-visible {
  background: var(--ui-surface-soft, #ffffff12);
  color: var(--primary-color, #8fbaf4);
}
.editor-help-trigger:focus-visible {
  outline: 2px solid var(--primary-color, #8fbaf4);
}
</style>
<style>
.editor-help-dialog .ant-modal-content {
  padding: 22px 24px;
  border: 1px solid #475566;
  border-radius: 16px;
  background: #202833;
  color: #e9f0fa;
  box-shadow: 0 22px 70px #0009;
}
.editor-help-dialog .ant-modal-header .ant-modal-title {
  color: #e9f0fa !important;
}
.editor-help-dialog .ant-modal-close {
  color: #e9f0fa;
}
.editor-help-dialog .ant-modal-header {
  background: transparent;
}
.editor-help-dialog .ant-modal-close:hover {
  color: #fff;
  background: #ffffff1b;
}
.editor-help-content {
  font-size: 13px;
  line-height: 1.6;
}
.editor-help-intro {
  margin: 10px 0 8px;
}
.editor-help-details {
  margin: 0 0 18px;
  padding-left: 20px;
  color: #b7c5d5;
}
.editor-help-content h3 {
  margin: 16px 0 8px;
  color: #e9f0fa;
  font-size: 14px;
}
.editor-help-table-scroll {
  max-height: min(44vh, 390px);
  overflow: auto;
  border: 1px solid #415065;
  border-radius: 9px;
}
.editor-help-content table {
  width: 100%;
  min-width: 430px;
  border-collapse: collapse;
  text-align: left;
}
.editor-help-content th,
.editor-help-content td {
  padding: 9px 10px;
  border-bottom: 1px solid #3c495a;
  vertical-align: top;
}
.editor-help-content tr:last-child td {
  border-bottom: 0;
}
.editor-help-content th {
  position: sticky;
  top: 0;
  background: #2d3948;
  font-weight: 600;
}
.editor-help-content td:last-child {
  color: #aebed0;
}
.editor-help-content kbd {
  display: inline-block;
  padding: 2px 6px;
  border: 1px solid #536579;
  border-radius: 4px;
  background: #18212b;
  color: #d6e7ff;
  font: inherit;
  white-space: nowrap;
}
.editor-help-empty {
  text-align: center;
  color: #aebed0;
}
</style>
