<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { PlusOutlined, PictureOutlined, ArrowRightOutlined } from '@ant-design/icons-vue'
import { Modal, message } from 'ant-design-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import { chooseLibraryDirectory } from '@/features/media-library/public'
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { syncWorkspaceArtifact, type WorkspaceArtifact } from '../api/workspaceArtifacts'
import { publishStudioDraft } from '../model/publishStudioDraft'
import type { WorkspaceAsset } from '../model/workspaceModel'
import type { StudioDocumentIndex } from '@/features/image-editor/public'
import { createWorkspaceDraftRepository } from '../model/workspaceDraftRepository'
import { createWorkImageDraftRepository } from '../model/workspaceWorks'
import WorkspaceImageEditor from './WorkspaceImageEditor.vue'
import StudioDraftCard from './StudioDraftCard.vue'
import '../../image-editor/styles/studioEditorShell.css'

const props = defineProps<{
  workspaceId: string
  workId: string
  workspaceName: string
  assets: WorkspaceAsset[]
  assetInfo: Record<string, FileNodeInfo>
  readonly?: boolean
  noteDirty: boolean
  noteSaving: boolean
  importLibraryImage?: (file: FileNodeInfo) => Promise<boolean>
  artifacts: WorkspaceArtifact[]
  requestedDraftId?: string
  openRequest?: number
}>()
const note = defineModel<string>('note', { required: true })
const emit = defineEmits<{
  addAssets: []
  saveNote: []
  artifactSaved: []
  newWork: []
  opened: [id: string]
  draftsChanged: []
}>()
const docs = ref<StudioDocumentIndex['docs']>([]),
  loadError = ref(false)
const editorOpen = ref(false),
  initialDraftId = ref<string>(),
  createNew = ref(false)
const editorShell = ref<HTMLElement>()
const publishingId = ref('')
const recent = computed(() => docs.value[0])
const renameTarget = ref<StudioDocumentIndex['docs'][number]>()
const renameName = ref('')
const renameInput = ref<HTMLInputElement>()
let deleteDialog: ReturnType<typeof Modal.confirm> | undefined
let trigger: HTMLElement | null = null
let restorePage: (() => void) | undefined
function loadDrafts() {
  try {
    const index = createWorkImageDraftRepository(
      props.workspaceId,
      props.workId,
      localStorage
    ).loadIndex()
    docs.value = [...(index?.docs ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    loadError.value = false
    emit('draftsChanged')
  } catch {
    loadError.value = true
  }
}
watch(
  () => props.workspaceId,
  () => {
    renameTarget.value = undefined
    deleteDialog?.destroy()
    deleteDialog = undefined
    loadDrafts()
  },
  { immediate: true }
)
async function renameDraft(item: StudioDocumentIndex['docs'][number]) {
  if (props.readonly) return
  renameName.value = item.name
  renameTarget.value = item
  await nextTick()
  renameInput.value?.focus()
  renameInput.value?.select()
}
function confirmRename() {
  if (props.readonly || !renameTarget.value) return
  if (!renameName.value.trim()) {
    message.warning('请输入草稿名称')
    renameInput.value?.focus()
    return
  }
  try {
    createWorkspaceDraftRepository(props.workspaceId, localStorage).rename(
      renameTarget.value.id,
      renameName.value
    )
    renameTarget.value = undefined
    loadDrafts()
    message.success('草稿已重命名')
  } catch {
    message.error('重命名失败，请检查本机存储后重试')
  }
}
function deleteDraft(item: StudioDocumentIndex['docs'][number]) {
  if (props.readonly) return
  const workspaceId = props.workspaceId
  deleteDialog = Modal.confirm({
    title: `删除草稿“${item.name}”？`,
    content: '将删除此草稿的图层草稿，无法撤销。源素材和已保存的图片不会删除。',
    okText: '删除草稿',
    cancelText: '取消',
    okType: 'danger',
    onOk: async () => {
      if (props.readonly || props.workspaceId !== workspaceId) return
      try {
        createWorkImageDraftRepository(workspaceId, props.workId, localStorage).remove(item.id)
        loadDrafts()
        message.success('草稿已删除')
      } catch (error) {
        message.error('删除失败，请检查本机存储后重试')
        throw error
      }
    }
  })
}
async function openEditor(id?: string) {
  if (publishingId.value) return
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  initialDraftId.value = id
  if (id) emit('opened', id)
  createNew.value = !id && docs.value.length > 0
  editorOpen.value = true
  const app = document.getElementById('omnigallery-app'),
    oldInert = app?.inert,
    oldOverflow = document.body.style.overflow
  if (app) app.inert = true
  document.body.style.overflow = 'hidden'
  restorePage = () => {
    if (app) app.inert = oldInert ?? false
    document.body.style.overflow = oldOverflow
  }
  await nextTick()
  editorShell.value
    ?.querySelector<HTMLButtonElement>('.studio-preview-actions button[aria-label="关闭编辑"]')
    ?.focus()
}
async function publishDraft(id: string, sync = false) {
  if (props.readonly || publishingId.value) return
  const workspaceId = props.workspaceId
  const document = createWorkspaceDraftRepository(workspaceId, localStorage).loadDocument(id)
  if (!document) {
    message.error('草稿无法读取，请刷新后重试')
    return
  }
  publishingId.value = id
  let saved = false
  try {
    const directory = sync ? await chooseLibraryDirectory() : undefined
    if (sync && !directory) return
    if (props.readonly || workspaceId !== props.workspaceId) return
    const artifact = await publishStudioDraft(workspaceId, document, { ...props.assetInfo })
    saved = true
    emit('artifactSaved')
    if (directory) {
      await syncWorkspaceArtifact(artifact.id, directory)
      emit('artifactSaved')
    }
    message.success(directory ? '已保存素材并同步到媒体库' : '当前版本已保存为素材')
  } catch (error) {
    message.error(getErrorMessage(error, saved ? '素材已保存，同步失败，请重试' : '保存素材失败'))
  } finally {
    publishingId.value = ''
  }
}
async function closeEditor() {
  editorOpen.value = false
  restorePage?.()
  restorePage = undefined
  await nextTick()
  loadDrafts()
  await nextTick()
  if (trigger?.isConnected) trigger.focus({ preventScroll: true })
}
onBeforeUnmount(() => {
  restorePage?.()
  deleteDialog?.destroy()
})
watch(
  () => props.openRequest,
  (request) => {
    if (request && props.requestedDraftId) void openEditor(props.requestedDraftId)
  },
  { immediate: true }
)
defineExpose({ loadDrafts, publishDraft, publishingId })
</script>

<template>
  <section class="creation-library" aria-label="图片制作草稿">
    <div class="creation-section-heading">
      <h3>图片制作草稿</h3>
      <span>{{ docs.length }} 个草稿 · 草稿自动保存</span>
      <button v-if="recent && !loadError" type="button" @click="openEditor(recent.id)">
        继续上次编辑 <ArrowRightOutlined />
      </button>
      <button
        type="button"
        class="new-creation"
        :disabled="readonly || !!publishingId || docs.length >= 100 || loadError"
        @click="$emit('newWork')"
      >
        <PlusOutlined />新建草稿
      </button>
    </div>
    <p v-if="loadError" role="alert">
      无法读取本机草稿。<button type="button" @click="loadDrafts">重试</button>
    </p>
    <template v-else-if="docs.length">
      <div class="creation-grid">
        <StudioDraftCard
          v-for="item in docs"
          :key="item.id"
          :item="item"
          :workspace-id="workspaceId"
          :asset-info="assetInfo"
          :readonly="readonly || !!publishingId"
          :busy="publishingId === item.id"
          :artifacts="artifacts"
          @save="publishDraft(item.id)"
          @sync="publishDraft(item.id, true)"
          @open="openEditor(item.id)"
          @rename="renameDraft(item)"
          @delete="deleteDraft(item)"
        />
      </div>
    </template>
    <div v-else class="creation-empty">
      <div class="empty-canvas"><PictureOutlined /></div>
      <h3>新建一张画布</h3>
      <p>自由排版、添加文字，或将多张图片组合成草稿。</p>
      <button type="button" :disabled="readonly || loadError" @click="$emit('newWork')">
        创建空白画布 <ArrowRightOutlined />
      </button>
    </div>
  </section>
  <a-modal
    :open="!!renameTarget"
    title="重命名草稿"
    ok-text="保存"
    cancel-text="取消"
    :ok-button-props="{ disabled: readonly || !renameName.trim() }"
    @ok="confirmRename"
    @cancel="renameTarget = undefined"
  >
    <label class="rename-label" for="creation-name">草稿名称</label>
    <input
      id="creation-name"
      ref="renameInput"
      v-model="renameName"
      class="rename-input"
      maxlength="80"
      autocomplete="off"
      :disabled="readonly"
      @keydown.enter.prevent="confirmRename"
    />
  </a-modal>
  <Teleport to="body">
    <div
      v-if="editorOpen"
      ref="editorShell"
      class="studio-editor-shell"
      role="region"
      aria-label="图片制作编辑器"
    >
      <WorkspaceImageEditor
        :key="`${workspaceId}:${workId}`"
        :workspace-id="workspaceId"
        :work-id="workId"
        :workspace-name="workspaceName"
        :assets="assets"
        :asset-info="assetInfo"
        :readonly="readonly"
        :note-dirty="noteDirty"
        :note-saving="noteSaving"
        :import-library-image="importLibraryImage"
        v-model:note="note"
        standalone
        :initial-draft-id="initialDraftId"
        :create-new="createNew"
        @exit="closeEditor"
        @add-assets="$emit('addAssets')"
        @save-note="$emit('saveNote')"
        @artifact-saved="$emit('artifactSaved')"
        @document-activated="$emit('opened', $event)"
      />
    </div>
  </Teleport>
</template>

<style scoped>
.rename-label {
  display: block;
  margin-bottom: 8px;
}
.rename-input {
  width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  color: var(--ui-text);
  caret-color: currentColor;
  font: inherit;
}
.rename-input:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.creation-library {
  width: 100%;
  box-sizing: border-box;
  padding: 12px 0 28px;
  min-width: 0;
  color: var(--ui-text);
}

button {
  font: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.new-creation,
.creation-empty > button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 0;
  border-radius: 11px;
  background: var(--primary-color);
  color: #fff;
  font-size: 13px;
}
.creation-section-heading {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
  font-size: 12px;
  color: var(--ui-muted);
}
.creation-section-heading h3 {
  margin: 0;
  font-size: 15px;
  color: var(--ui-text);
}
.creation-section-heading > span {
  margin-right: auto;
}
.creation-section-heading > .new-creation {
  flex: none;
}
.creation-section-heading button:not(.new-creation) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: none;
  color: var(--primary-color);
  font-size: 12px;
  padding: 6px 0;
}
.creation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 18px;
}
.creation-empty {
  display: flex;
  align-items: center;
  flex-direction: column;
  justify-content: center;
  min-height: 350px;
  border: 1px dashed var(--ui-border);
  border-radius: 22px;
  background: var(--ui-surface);
}
.empty-canvas {
  display: grid;
  place-items: center;
  width: 78px;
  height: 90px;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-surface-soft);
  color: var(--primary-color);
  font-size: 30px;
  transform: rotate(-5deg);
  margin-bottom: 12px;
}
.creation-empty h3 {
  margin: 10px 0;
  font-size: 18px;
}
.creation-empty p {
  margin: 0 0 20px;
  color: var(--ui-muted);
  font-size: 13px;
}
button:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .creation-library {
    padding: 14px 8px;
  }
  .creation-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .new-creation {
    padding: 9px;
    white-space: nowrap;
  }
  .creation-section-heading {
    flex-wrap: wrap;
  }
}
</style>
