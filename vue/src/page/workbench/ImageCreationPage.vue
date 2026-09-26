<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { PlusOutlined, PictureOutlined, ArrowRightOutlined } from '@ant-design/icons-vue'
import type { FileNodeInfo } from '@/api/files'
import { toImageThumbnailUrl } from '@/util/file'
import type { WorkspaceAsset } from './workspaceModel'
import { legacyStudioKey, readStudioIndex, studioIndexKey, type StudioDocumentIndex } from './imageStudioModel'
import ImageCreationStudio from './ImageCreationStudio.vue'
import StudioDraftCard from './StudioDraftCard.vue'
import './studioEditorShell.css'

const props = defineProps<{ workspaceId: string; workspaceName: string; assets: WorkspaceAsset[];
  assetInfo: Record<string, FileNodeInfo>; readonly?: boolean; noteDirty: boolean; noteSaving: boolean }>()
const note = defineModel<string>('note', { required: true })
defineEmits<{ addAssets: []; saveNote: []; artifactSaved: [] }>()
const docs = ref<StudioDocumentIndex['docs']>([]), legacy = ref(false), loadError = ref(false)
const editorOpen = ref(false), initialDraftId = ref<string>(), createNew = ref(false)
const editorShell = ref<HTMLElement>()
const imageAssets = computed(() => props.assets.filter(item => item.kind === 'image'))
const recent = computed(() => docs.value[0])
let trigger: HTMLElement | null = null
let restorePage: (() => void) | undefined
function loadDrafts() {
  try {
    const index = readStudioIndex(JSON.parse(localStorage.getItem(studioIndexKey(props.workspaceId)) || 'null'))
    docs.value = [...(index?.docs ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    legacy.value = !docs.value.length && !!localStorage.getItem(legacyStudioKey(props.workspaceId))
    loadError.value = false
  } catch { loadError.value = true }
}
watch(() => props.workspaceId, loadDrafts, { immediate: true })
async function openEditor(id?: string) {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  initialDraftId.value = id
  createNew.value = !id && docs.value.length > 0
  editorOpen.value = true
  const app = document.getElementById('iib-app'), oldInert = app?.inert, oldOverflow = document.body.style.overflow
  if (app) app.inert = true
  document.body.style.overflow = 'hidden'
  restorePage = () => { if (app) app.inert = oldInert ?? false; document.body.style.overflow = oldOverflow }
  await nextTick()
  editorShell.value?.querySelector<HTMLButtonElement>('.studio-preview-actions button[aria-label="关闭编辑"]')?.focus()
}
async function closeEditor() {
  editorOpen.value = false
  restorePage?.(); restorePage = undefined
  await nextTick()
  loadDrafts()
  await nextTick()
  if (trigger?.isConnected) trigger.focus({ preventScroll: true })
}
onBeforeUnmount(() => { restorePage?.() })
</script>

<template>
  <section class="creation-library" aria-label="图片制作作品">
    <header class="creation-heading"><div><span>{{ workspaceName }} · 图片制作</span><h2>我的作品</h2><p>从一张图片开始，把想法留在画布上。</p></div><button type="button" class="new-creation" :disabled="readonly || docs.length >= 100 || loadError" @click="openEditor()"><PlusOutlined />新建作品</button></header>
    <p v-if="loadError" role="alert">无法读取本机草稿。<button type="button" @click="loadDrafts">重试</button></p>
    <template v-else-if="docs.length">
      <div class="creation-summary"><span>{{ docs.length }} 个作品 · 图层草稿自动保存</span><button v-if="recent" type="button" @click="openEditor(recent.id)">继续上次编辑 <ArrowRightOutlined /></button></div>
      <div class="creation-grid"><StudioDraftCard v-for="item in docs" :key="item.id" :item="item" :workspace-id="workspaceId" :asset-info="assetInfo" @open="openEditor(item.id)" /></div>
    </template>
    <div v-else class="creation-empty"><div class="empty-canvas"><PictureOutlined /></div><h3>{{ legacy ? '继续之前的创作' : '第一件作品，从这里开始' }}</h3><p>{{ legacy ? '原有草稿会在编辑器中恢复。' : '自由排版、添加文字，或将多张图片组合成作品。' }}</p><button type="button" :disabled="readonly || loadError" @click="openEditor()">{{ legacy ? '打开原有草稿' : '创建空白画布' }} <ArrowRightOutlined /></button></div>
    <section class="creation-assets"><div><h3>工作区图片</h3><span>{{ imageAssets.length }} 张 · 编辑时可直接添加到画布</span><button type="button" :disabled="readonly" @click="$emit('addAssets')">从媒体库加入</button></div><div v-if="imageAssets.length" class="creation-asset-strip"><img v-for="asset in imageAssets.slice(0, 12)" :key="asset.path" :src="assetInfo[asset.path] ? toImageThumbnailUrl(assetInfo[asset.path], '160x160') : undefined" :alt="asset.name" :title="asset.name" loading="lazy" /><span v-if="imageAssets.length > 12">+{{ imageAssets.length - 12 }}</span></div></section>
  </section>
  <Teleport to="body">
    <div v-if="editorOpen" ref="editorShell" class="studio-editor-shell" role="region" aria-label="图片制作编辑器">
      <ImageCreationStudio :key="workspaceId" v-bind="props" v-model:note="note" standalone :initial-draft-id="initialDraftId" :create-new="createNew"
        @exit="closeEditor" @add-assets="$emit('addAssets')" @save-note="$emit('saveNote')" @artifact-saved="$emit('artifactSaved')" />
    </div>
  </Teleport>
</template>

<style scoped>
.creation-library{padding:20px 22px 28px;min-width:0;max-width:1500px;margin:0 auto;color:var(--ui-text)}.creation-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:30px}.creation-heading span{font-size:12px;color:var(--ui-muted)}.creation-heading h2{font-size:26px;letter-spacing:-.5px;margin:8px 0}.creation-heading p{margin:0;font-size:13px;color:var(--ui-muted)}button{font:inherit;cursor:pointer}button:disabled{opacity:.45;cursor:default}.new-creation,.creation-empty>button{display:flex;align-items:center;gap:8px;padding:10px 16px;border:0;border-radius:11px;background:var(--primary-color);color:#fff;font-size:13px}.creation-summary{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:16px;font-size:12px;color:var(--ui-muted)}.creation-summary button,.creation-assets button{display:inline-flex;align-items:center;gap:6px;border:0;background:none;color:var(--primary-color);font-size:12px;padding:6px 0}.creation-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:18px}.creation-empty{display:flex;align-items:center;flex-direction:column;justify-content:center;min-height:350px;border:1px dashed var(--ui-border);border-radius:22px;background:var(--ui-surface)}.empty-canvas{display:grid;place-items:center;width:78px;height:90px;border:1px solid var(--ui-border);border-radius:12px;background:var(--ui-surface-soft);color:var(--primary-color);font-size:30px;transform:rotate(-5deg);margin-bottom:12px}.creation-empty h3{margin:10px 0;font-size:18px}.creation-empty p{margin:0 0 20px;color:var(--ui-muted);font-size:13px}.creation-assets{margin-top:34px;padding-top:22px;border-top:1px solid var(--ui-border)}.creation-assets>div:first-child{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.creation-assets h3{font-size:13px;margin:0}.creation-assets span{color:var(--ui-muted);font-size:12px}.creation-assets button{margin-left:auto}.creation-asset-strip{display:flex;align-items:center;gap:10px;margin-top:14px;overflow:hidden}.creation-asset-strip img{width:64px;height:64px;object-fit:cover;border-radius:10px;background:var(--ui-surface-soft)}button:focus-visible{outline:2px solid var(--primary-color);outline-offset:3px}
@media(max-width:600px){.creation-library{padding:14px 8px}.creation-heading{gap:10px}.creation-heading h2{font-size:22px}.creation-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.new-creation{padding:9px;white-space:nowrap}.creation-summary{flex-wrap:wrap}}
</style>
