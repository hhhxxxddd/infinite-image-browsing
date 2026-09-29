<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import { workspaceTasksKey } from '@/features/workspaces/public'
import { imageResultBatches, studioTaskResults } from '../model/studioResults'
import { PictureOutlined, ExpandOutlined } from '@ant-design/icons-vue'
import { message } from 'ant-design-vue'
import { toImageUrl, type FileNodeInfo } from '@/features/media-library/public'
import type { WorkspaceRecord, WorkspaceAsset } from '@/features/workspaces/public'
import type { WorkspaceArtifact } from '@/features/workspaces/api/workspaceArtifacts'
import type { MaterialController } from '@/features/workspaces/model/workspaceMaterials'
import MediaAssetPreview from '@/features/media-preview/components/MediaAssetPreview.vue'
import EditorNotesPanel from '@/features/image-editor/components/EditorNotesPanel.vue'
import StudioToolIcon from '@/features/image-editor/components/StudioToolIcon.vue'
import '@/features/image-editor/styles/editorSurface.css'
import AIImageProcess from './AIImageProcess.vue'

const props = defineProps<{
  workspace?: WorkspaceRecord
  draftScope?: string
  productionId?: string
  productionName?: string
  artifacts: WorkspaceArtifact[]
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  noteDirty: boolean
  noteSaving: boolean
}>()
const note = defineModel<string>('note', { required: true })
const emit = defineEmits<{ close: []; saveNote: [] }>()
const root = ref<HTMLElement>(),
  process = ref<InstanceType<typeof AIImageProcess>>()
const notesOpen = ref(false),
  preview = ref<WorkspaceAsset>()
function closePreview() {
  preview.value = undefined
}
function selectPreview() {
  if (preview.value) selectedPath.value = preview.value.path
  closePreview()
}
const tasks = inject(workspaceTasksKey, ref([]))
const ownResults = computed(() => {
  const latestBatch = imageResultBatches(
    tasks.value,
    props.workspace?.id,
    props.productionId,
    'image_generation'
  )[0]
  const ranks = new Map(
    (latestBatch ? studioTaskResults(latestBatch) : []).map((result, index) => [
      result.artifact_id,
      index
    ])
  )
  return props.artifacts
    .filter(
      (item) =>
        item.document_id === props.productionId &&
        !item.input_owner &&
        item.source === 'ai_image_generation'
    )
    .sort(
      (a, b) =>
        (ranks.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (ranks.get(b.id) ?? Number.MAX_SAFE_INTEGER) || b.created_at.localeCompare(a.created_at)
    )
})
const selectedPath = ref('')
const selected = computed(() => props.assetInfo[selectedPath.value])
watch(
  ownResults,
  (items, previous) => {
    if (items[0] && (items[0].id !== previous?.[0]?.id || !props.assetInfo[selectedPath.value]))
      selectedPath.value = `workspace-artifact:${items[0].id}`
    if (!items.length) selectedPath.value = ''
  },
  { immediate: true }
)
function previewAsset(asset: WorkspaceAsset) {
  preview.value = asset
}
function borrowPrompt(prompt: string, append: boolean) {
  if (props.readonly || !prompt) return
  process.value?.usePrompt(prompt, append)
  closePreview()
  message.success(append ? '已追加提示词' : '已使用提示词')
}
const materialController = computed<MaterialController>(() => ({
  assets: props.workspace?.assets.filter((asset) => asset.kind === 'image') ?? [],
  roles: {},
  activePath: selectedPath.value,
  recentPaths: [],
  select: (asset) => {
    previewAsset(asset)
  },
  actions: () => [{ key: 'preview', label: '预览文件' }],
  runAction: (asset) => {
    previewAsset(asset)
  }
}))
const zoom = ref(1),
  offset = ref({ x: 0, y: 0 })
function fit() {
  zoom.value = 1
  offset.value = { x: 0, y: 0 }
}
watch(selectedPath, fit)
let drag: { x: number; y: number; offsetX: number; offsetY: number } | undefined
function panStart(event: PointerEvent) {
  if (event.button !== 0 || !selected.value) return
  drag = { x: event.clientX, y: event.clientY, offsetX: offset.value.x, offsetY: offset.value.y }
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function panMove(event: PointerEvent) {
  if (drag)
    offset.value = {
      x: drag.offsetX + event.clientX - drag.x,
      y: drag.offsetY + event.clientY - drag.y
    }
}
function panEnd() {
  drag = undefined
}
function zoomBy(amount: number) {
  zoom.value = Math.max(0.25, Math.min(4, zoom.value + amount))
}
async function saveBeforeLeave() {
  return (await process.value?.persistConfiguration()) ?? true
}
async function saveSettings() {
  if (!props.readonly && (await saveBeforeLeave())) message.success('生成设置已保存到本机')
}
async function close() {
  if (await saveBeforeLeave()) emit('close')
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !preview.value) {
    event.preventDefault()
    void close()
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void saveBeforeLeave()
    if (props.noteDirty) emit('saveNote')
  }
}
defineExpose({ materialController, saveBeforeLeave, focusEditor: () => root.value?.focus() })
</script>

<template>
  <section
    ref="root"
    class="ai-image-editor ai-generation-editor"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-label="AI 图片生成"
    @keydown="keydown"
  >
    <header class="editor-header">
      <span class="editor-context">AI 图片生成 · {{ productionName }}</span
      ><button type="button" :disabled="readonly" @click="saveSettings">保存设置</button>
    </header>
    <slot name="navigation" />
    <nav class="tool-row editor-tool-rail" aria-label="生成查看工具">
      <button type="button" class="active" title="拖动画面" aria-label="拖动画面">
        <StudioToolIcon kind="hand" />
      </button>
      <button type="button" title="适应画面" aria-label="适应画面" @click="fit">
        <ExpandOutlined />
      </button>
      <span class="tool-spacer" />
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
      <div class="editor-stage">
        <div
          class="generation-canvas"
          @pointerdown="panStart"
          @pointermove="panMove"
          @pointerup="panEnd"
          @pointercancel="panEnd"
          @wheel.prevent="zoomBy($event.deltaY < 0 ? 0.1 : -0.1)"
        >
          <img
            v-if="selected"
            :key="selected.fullpath"
            :src="toImageUrl(selected)"
            :alt="selected.name"
            draggable="false"
            :style="{ transform: `translate(${offset.x}px,${offset.y}px) scale(${zoom})` }"
          />
          <div v-else class="generation-empty">
            <PictureOutlined /><strong>用文字描绘你的画面</strong
            ><span>填写右侧提示词开始生成。下方素材可预览和借鉴提示词。</span>
          </div>
        </div>
        <div v-if="selected" class="generation-zoom">
          <button type="button" aria-label="缩小画面" @click="zoomBy(-0.1)">−</button
          ><button type="button" title="适应画面" @click="fit">{{ Math.round(zoom * 100) }}%</button
          ><button type="button" aria-label="放大画面" @click="zoomBy(0.1)">+</button>
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
      </div>
    </div>
    <aside class="editor-inspector">
      <AIImageProcess
        ref="process"
        purpose="image_generation"
        :doc="null"
        :reference-inputs="[]"
        :workspace-id="workspace?.id"
        :draft-scope="draftScope"
        :production-id="productionId"
        :production-name="productionName"
        :asset-info="assetInfo"
        :readonly="readonly"
        :before-submit="() => true"
        @preview-result="preview = workspace?.assets.find((asset) => asset.path === $event)"
        ><template #task><slot name="image-task" /></template
      ></AIImageProcess>
    </aside>
    <div class="editor-materials"><slot name="materials" /></div>
    <MediaAssetPreview
      v-if="preview && assetInfo[preview.path]"
      :key="preview.path"
      :file="assetInfo[preview.path]"
      :workspace-name="workspace?.name"
      @close="closePreview"
    >
      <template #actions="{ prompt, loading, error }">
        <a-button
          type="primary"
          :disabled="readonly || !prompt || loading || !!error"
          @click="borrowPrompt(prompt, false)"
        >
          使用提示词</a-button
        >
        <a-button
          v-if="ownResults.some((item) => `workspace-artifact:${item.id}` === preview?.path)"
          @click="selectPreview"
        >
          在画布查看
        </a-button>
      </template>
      <template #more-actions="{ prompt, loading, error }">
        <a-button
          type="text"
          :disabled="readonly || !prompt || loading || !!error"
          @click="borrowPrompt(prompt, true)"
          >追加提示词</a-button
        >
      </template>
    </MediaAssetPreview>
  </section>
</template>

<style scoped src="./aiImageEditorShell.css"></style>
<style scoped>
.editor-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.editor-header button,
.generation-zoom button {
  border: 1px solid var(--ui-control-border);
  border-radius: 7px;
  padding: 6px 10px;
  background: var(--ui-surface);
  color: var(--ui-text);
  cursor: pointer;
}
.generation-canvas {
  display: grid;
  grid-template: minmax(0, 1fr) / minmax(0, 1fr);
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
}
.generation-canvas:active {
  cursor: grabbing;
}
.generation-canvas img {
  min-width: 0;
  min-height: 0;
  max-width: 100%;
  max-height: 100%;
  width: auto;
  height: auto;
  object-fit: contain;
  user-select: none;
}
.generation-empty {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  text-align: center;
  color: var(--ui-muted);
  padding: 30px;
}
.generation-empty .anticon {
  font-size: 40px;
  opacity: 0.5;
}
.generation-empty strong {
  font-size: 18px;
  font-weight: 500;
  color: var(--ui-text);
}
.generation-zoom {
  position: absolute;
  bottom: 4px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
}
.notes-tools-panel {
  display: flex;
}
</style>
