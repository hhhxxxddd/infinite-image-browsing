<script setup lang="ts">
import { computed, ref } from 'vue'
import { AudioOutlined, VideoCameraOutlined } from '@ant-design/icons-vue'
import EditorNotesPanel from '@/features/image-editor/components/EditorNotesPanel.vue'
import StudioToolIcon from '@/features/image-editor/components/StudioToolIcon.vue'
import EditorHelpButton from '@/shared/components/EditorHelpButton.vue'
import '@/features/image-editor/styles/editorSurface.css'
const props = defineProps<{
  media: 'audio' | 'video'
  readonly?: boolean
  noteDirty: boolean
  noteSaving: boolean
}>()
const note = defineModel<string>('note', { required: true })
const emit = defineEmits<{ close: []; saveNote: [] }>()
const root = ref<HTMLElement>(),
  notesOpen = ref(false)
const label = computed(() => (props.media === 'audio' ? 'AI 音频' : 'AI 视频'))
const plans = computed(() =>
  props.media === 'audio'
    ? ['文字配音', '音乐与音效生成', '音频换音色', '降噪与人声处理']
    : ['单图生成视频', '首尾帧生成视频', '音频驱动视频', '视频延长与编辑']
)
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    if (props.noteDirty) emit('saveNote')
  }
}
defineExpose({ saveBeforeLeave: () => true, focusEditor: () => root.value?.focus() })
</script>
<template>
  <section
    ref="root"
    class="ai-image-editor"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    :aria-label="label"
    @keydown="keydown"
  >
    <slot name="navigation" />
    <nav class="tool-row editor-tool-rail" aria-label="制作工具">
      <button
        type="button"
        :class="{ active: notesOpen }"
        title="制作笔记"
        aria-label="制作笔记"
        @click="notesOpen = !notesOpen"
      >
        <StudioToolIcon kind="note" />
      </button>
    </nav>
    <div class="editor-workarea">
      <main class="editor-stage placeholder-stage">
        <div class="placeholder-copy">
          <component :is="media === 'audio' ? AudioOutlined : VideoCameraOutlined" />
          <strong>{{ label }}尚未接入</strong>
          <p>可以浏览素材、记录制作笔记，或返回 AI 图片继续制作。</p>
        </div>
        <div v-if="notesOpen" class="image-tools-panel notes-tools-panel">
          <EditorNotesPanel
            v-model:note="note"
            :dirty="noteDirty"
            :saving="noteSaving"
            :readonly="readonly"
            @close="notesOpen = false"
            @save="emit('saveNote')"
          />
        </div>
      </main>
    </div>
    <aside class="editor-inspector">
      <header>
        <div class="placeholder-title">
          <strong>{{ label }}</strong
          ><EditorHelpButton :kind="media === 'audio' ? 'ai-audio' : 'ai-video'" />
        </div>
        <span>尚未接入</span>
      </header>
      <div class="placeholder-plans">
        <h2>规划任务</h2>
        <p>以下是后续规划，目前无法提交任务。</p>
        <ul>
          <li v-for="plan in plans" :key="plan">{{ plan }}</li>
        </ul>
      </div>
    </aside>
    <div class="editor-materials"><slot name="materials" /></div>
  </section>
</template>
<style scoped src="./aiImageEditorShell.css"></style>
<style scoped>
.placeholder-stage {
  display: grid;
  place-items: center;
}
.placeholder-copy {
  text-align: center;
  color: var(--ui-muted);
  padding: 24px;
}
.placeholder-copy > .anticon {
  display: block;
  font-size: 40px;
  margin-bottom: 16px;
  opacity: 0.5;
}
.placeholder-copy strong {
  font-size: 18px;
  color: var(--ui-text);
  font-weight: 500;
}
.editor-inspector header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid var(--ui-border);
}
.editor-inspector header span {
  font-size: 12px;
  color: var(--ui-muted);
}
.placeholder-title {
  display: flex;
  align-items: center;
  gap: 5px;
}
.placeholder-plans {
  padding: 16px;
}
.placeholder-plans h2 {
  font-size: 14px;
}
.placeholder-plans p {
  color: var(--ui-muted);
  font-size: 12px;
}
.placeholder-plans ul {
  list-style: none;
  padding: 0;
  margin: 16px 0 0;
  display: grid;
  gap: 8px;
}
.placeholder-plans li {
  border: 1px solid var(--ui-border);
  border-radius: 9px;
  background: var(--ui-surface-soft);
  padding: 12px;
  color: var(--ui-muted);
}
.notes-tools-panel {
  display: flex;
}
</style>
