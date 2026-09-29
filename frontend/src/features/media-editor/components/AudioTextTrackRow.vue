<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import {
  EyeOutlined,
  EyeInvisibleOutlined,
  LockOutlined,
  UnlockOutlined,
  PlusOutlined,
  MoreOutlined
} from '@ant-design/icons-vue'
import type { TextCue, TextTrack } from '../model/textTimeline'

const props = defineProps<{
  track: TextTrack
  selected: boolean
  selectedCueId: string
  editingCueId: string
  editable: boolean
  zoom: number
  scrollLeft: number
  viewportWidth: number
}>()
const emit = defineEmits<{
  select: [cue?: TextCue]
  edit: [cue: TextCue]
  update: [cue: TextCue, text: string]
  finish: [id: string]
  add: [event?: MouseEvent]
  toggle: [field: 'visible' | 'locked']
  menu: [event: MouseEvent, cue?: TextCue]
  drag: [event: PointerEvent, cue: TextCue, mode: 'move' | 'left' | 'right']
  seek: [event: PointerEvent]
}>()
const visibleCues = computed(() =>
  props.track.cues.filter(
    (cue) =>
      cue.id === props.selectedCueId ||
      ((cue.start + cue.duration) * props.zoom >= props.scrollLeft &&
        cue.start * props.zoom <= props.scrollLeft + props.viewportWidth)
  )
)
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, '0')}`
const inlineInput = ref<HTMLTextAreaElement>(),
  editingCue = ref<TextCue>(),
  draft = ref('')
function setInlineInput(element: Element | ComponentPublicInstance | null) {
  inlineInput.value = element instanceof HTMLTextAreaElement ? element : undefined
}
function finishEditing(save = true) {
  const cue = editingCue.value
  if (!cue) return
  editingCue.value = undefined
  if (save && draft.value !== cue.text) emit('update', cue, draft.value)
  emit('finish', cue.id)
}
function editKeydown(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
    event.preventDefault()
    finishEditing(event.key !== 'Escape')
  }
}
watch(
  () => [props.editingCueId, props.editable, props.track.locked] as const,
  async ([id, editable, locked]) => {
    if (editingCue.value?.id === id && editable && !locked) return
    finishEditing()
    const cue = props.track.cues.find((item) => item.id === id)
    if (!cue || !editable || locked) return
    editingCue.value = cue
    draft.value = cue.text
    await nextTick()
    if (editingCue.value?.id !== id) return
    inlineInput.value?.focus()
    inlineInput.value?.select()
  }
)
</script>

<template>
  <div
    class="text-track"
    :class="{ selected, hidden: !track.visible }"
    :data-text-track-id="track.id"
  >
    <div
      class="text-header"
      @click="emit('select')"
      @contextmenu.prevent.stop="emit('menu', $event)"
    >
      <div>
        <span class="text-symbol">T</span><strong>{{ track.name }}</strong>
        <button
          type="button"
          :aria-label="`${track.name} 更多操作`"
          @click.stop="emit('menu', $event)"
        >
          <MoreOutlined />
        </button>
      </div>
      <div class="text-controls">
        <button
          type="button"
          :aria-label="track.visible ? '隐藏文字轨' : '显示文字轨'"
          :aria-pressed="track.visible"
          :disabled="!editable || track.locked"
          @click.stop="emit('toggle', 'visible')"
        >
          <EyeOutlined v-if="track.visible" /><EyeInvisibleOutlined v-else />
        </button>
        <button
          type="button"
          :aria-label="track.locked ? '解锁文字轨' : '锁定文字轨'"
          :aria-pressed="track.locked"
          :disabled="!editable"
          @click.stop="emit('toggle', 'locked')"
        >
          <LockOutlined v-if="track.locked" /><UnlockOutlined v-else />
        </button>
        <button
          type="button"
          aria-label="在播放头添加文字"
          :disabled="!editable || track.locked"
          @click.stop="emit('add')"
        >
          <PlusOutlined />
        </button>
        <small>{{ track.cues.length }} 段</small>
      </div>
    </div>
    <div
      class="text-lane"
      @pointerdown.self="emit('seek', $event)"
      @dblclick.self="emit('add', $event)"
      @contextmenu.prevent.stop="emit('menu', $event)"
    >
      <div
        v-for="cue in visibleCues"
        :key="cue.id"
        class="text-cue"
        role="button"
        tabindex="0"
        :class="{
          selected: selectedCueId === cue.id,
          locked: track.locked,
          editing: editingCue?.id === cue.id
        }"
        :style="{
          left: cue.start * zoom + 'px',
          width: Math.max(28, cue.duration * zoom) + 'px',
          '--cue-edge-width': Math.min(9, Math.max(3, cue.duration * zoom * 0.2)) + 'px'
        }"
        :aria-label="`文字：${cue.text || '空白片段'}，${time(cue.start)} 至 ${time(cue.start + cue.duration)}`"
        :aria-pressed="selectedCueId === cue.id"
        :title="editingCue?.id === cue.id ? undefined : `${cue.text}\n双击或按 Enter 编辑文字`"
        @pointerdown="emit('drag', $event, cue, 'move')"
        @click.stop="emit('select', cue)"
        @dblclick.stop="emit('edit', cue)"
        @keydown.enter.stop.prevent="emit('edit', cue)"
        @focus="emit('select', cue)"
        @contextmenu.prevent.stop="emit('menu', $event, cue)"
      >
        <textarea
          v-if="editingCue?.id === cue.id"
          :ref="setInlineInput"
          v-model="draft"
          aria-label="片段文字编辑"
          maxlength="5000"
          @pointerdown.stop
          @click.stop
          @dblclick.stop
          @keydown="editKeydown"
          @blur="finishEditing()"
        />
        <span v-else>{{ cue.text || '空白片段' }}</span>
        <i
          v-if="editingCue?.id !== cue.id"
          class="cue-edge left"
          title="调整文字开始时间"
          @pointerdown.stop="emit('drag', $event, cue, 'left')"
        />
        <i
          v-if="editingCue?.id !== cue.id"
          class="cue-edge right"
          title="调整文字结束时间"
          @pointerdown.stop="emit('drag', $event, cue, 'right')"
        />
      </div>
      <small v-if="!track.cues.length" class="text-empty">点击＋或双击空白处添加文字</small>
    </div>
  </div>
</template>

<style scoped>
.text-track {
  display: flex;
  min-height: 88px;
  border-bottom: 1px solid var(--ui-border);
}
.text-header {
  position: sticky;
  left: 0;
  flex: 0 0 136px;
  z-index: 4;
  box-sizing: border-box;
  padding: 12px 10px;
  background: #202731;
  border-right: 1px solid var(--ui-border);
  cursor: pointer;
}
.selected .text-header {
  background: #273442;
}
.text-header > div {
  display: flex;
  gap: 7px;
  align-items: center;
}
.text-header strong {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
}
.text-symbol {
  color: #e2c28b;
  font: 13px serif;
}
.text-header button {
  width: 24px;
  height: 24px;
  border: 1px solid #ffffff18;
  background: #141b24;
  color: var(--ui-text);
  border-radius: 4px;
  padding: 3px;
  cursor: pointer;
}
.text-header button:disabled {
  opacity: 0.4;
  cursor: default;
}
.text-controls {
  margin-top: 12px;
}
.text-controls small {
  color: var(--ui-muted);
  font-size: 10px;
  margin-left: auto;
}
.text-lane {
  flex: 1;
  min-width: 0;
  position: relative;
  background: repeating-linear-gradient(
    90deg,
    transparent 0,
    transparent calc(var(--tick-width) - 1px),
    #ffffff06 calc(var(--tick-width) - 1px),
    #ffffff06 var(--tick-width)
  );
}
.text-cue {
  position: absolute;
  top: 10px;
  bottom: 10px;
  border: 1px solid #9f824d;
  background: linear-gradient(#655335, #4e412e);
  border-radius: 6px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  cursor: grab;
  touch-action: none;
  overflow: hidden;
}
.text-cue > span {
  padding: 6px 10px;
  font-size: 12px;
  white-space: pre-line;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
}
.text-cue.selected {
  z-index: 1;
  border: 2px solid #94bdf6;
  box-shadow: 0 0 0 1px #94bdf644;
}
.text-cue.locked {
  cursor: default;
}
.text-cue.editing {
  cursor: text;
}
.text-cue textarea {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  border: 0;
  padding: 6px 8px;
  margin: 0;
  resize: none;
  outline: none;
  color: #fff3dc;
  background: #332a1d;
  font: 12px/1.6 var(--ui-font);
  scrollbar-width: thin;
  cursor: text;
  touch-action: auto;
}
.hidden .text-cue {
  opacity: 0.35;
}
.cue-edge {
  position: absolute;
  width: var(--cue-edge-width, 9px);
  top: 0;
  bottom: 0;
  cursor: ew-resize;
}
.cue-edge:hover {
  background: #b5d5ff55;
}
.cue-edge.left {
  left: 0;
}
.cue-edge.right {
  right: 0;
}
.text-empty {
  display: block;
  padding: 32px 20px;
  color: #8793a4;
  font-size: 11px;
}
</style>
