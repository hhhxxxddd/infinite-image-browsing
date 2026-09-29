<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { FileNodeInfo } from '@/features/media-library/public'
import {
  renderStudioDocument,
  studioLayerVisible,
  type StudioDocument,
  type StudioRenderScope
} from '@/features/image-editor/public'
import type { WorkspaceAsset } from '@/features/workspaces/public'
import { createAIBranch } from '@/features/workspaces/services/aiProductionBranch'
import { createWorkspaceWorksRepository } from '@/features/workspaces/model/workspaceWorks'
import {
  matchingAIBranches,
  prepareAIInput,
  type AIInputScope
} from '@/features/workspaces/model/aiProductionBranch'
import {
  workspaceStorage,
  workspaceStorageRevision
} from '@/features/workspaces/services/workspaceStorage'
import { getErrorMessage } from '@/shared/lib/errorMessage'

const props = defineProps<{
  open: boolean
  doc: StudioDocument | null
  scope: StudioRenderScope
  assetInfo: Record<string, FileNodeInfo>
  assets: WorkspaceAsset[]
  workspaceId: string
  workId?: string
  readonly?: boolean
}>()
const emit = defineEmits<{ 'update:open': [value: boolean]; branchOpened: [id: string] }>()
const scopeChoice = ref('all')
const area = ref<'content' | 'canvas'>('content')
const maskChoice = ref('all'),
  referencePaths = ref<string[]>([])
const busy = ref(false),
  error = ref(''),
  previewUrl = ref(''),
  previewSize = ref('')
const branchId = ref('')
let previewRevision = 0
const contentLayers = computed(() => {
  const doc = props.doc
  return (
    doc?.layers.filter(
      (layer) => ['image', 'text'].includes(layer.kind) && studioLayerVisible(doc, layer)
    ) ?? []
  )
})
const groups = computed(
  () =>
    props.doc?.groups.filter((group) =>
      contentLayers.value.some((layer) => layer.groupId === group.id)
    ) ?? []
)
const inputScope = computed<AIInputScope>(() =>
  scopeChoice.value.startsWith('layer:')
    ? { kind: 'layer', id: scopeChoice.value.slice(6) }
    : scopeChoice.value.startsWith('group:')
      ? { kind: 'group', id: scopeChoice.value.slice(6) }
      : { kind: 'all' }
)
const label = computed(() => {
  const scope = inputScope.value
  return scope.kind === 'all'
    ? '整张画布'
    : scope.kind === 'group'
      ? (groups.value.find((group) => group.id === scope.id)?.name ?? '分组')
      : (contentLayers.value.find((layer) => layer.id === scope.id)?.name ?? '图层')
})
const masks = computed(() => {
  const doc = props.doc
  return (
    doc?.layers.filter(
      (layer) =>
        layer.kind === 'mask' &&
        studioLayerVisible(doc, layer) &&
        (inputScope.value.kind !== 'group' || layer.groupId === inputScope.value.id)
    ) ?? []
  )
})
const maskIds = computed(() =>
  maskChoice.value === 'none'
    ? []
    : maskChoice.value === 'all'
      ? masks.value.map((layer) => layer.id)
      : [maskChoice.value]
)
const work = computed(() => {
  void workspaceStorageRevision.value
  if (!props.open || !props.workId) return
  return createWorkspaceWorksRepository(props.workspaceId, workspaceStorage(props.workspaceId))
    .load()
    .works.find((item) => item.id === props.workId)
})
const branches = computed(() =>
  matchingAIBranches(work.value?.drafts ?? [], props.doc?.id ?? '', inputScope.value, area.value)
)
const images = computed(() =>
  props.assets.filter((asset) => asset.kind === 'image' && props.assetInfo[asset.path])
)
watch(
  () => props.open,
  (open) => {
    if (!open) {
      previewRevision++
      return
    }
    const scope = props.scope
    scopeChoice.value = scope.kind === 'all' ? 'all' : `${scope.kind}:${scope.id}`
    area.value = 'content'
    maskChoice.value = 'all'
    referencePaths.value = []
    error.value = ''
  },
  { immediate: true }
)
watch(branches, (value) => {
  branchId.value = value[0]?.id ?? ''
})
watch(
  [() => props.open, () => props.doc, inputScope, area, maskIds],
  async () => {
    const token = ++previewRevision
    if (!props.open || !props.doc) return
    previewUrl.value = ''
    try {
      const input = prepareAIInput(props.doc, inputScope.value, area.value, maskIds.value)
      const canvas = document.createElement('canvas')
      const failures = await renderStudioDocument(
        canvas,
        input,
        props.assetInfo,
        true,
        { kind: 'all' },
        600
      )
      if (token !== previewRevision) return
      if (failures.length) throw new Error(`无法读取图片：${failures.join('、')}`)
      previewUrl.value = canvas.toDataURL('image/png')
      previewSize.value = `${input.width} × ${input.height}`
      error.value = ''
    } catch (reason) {
      if (token === previewRevision) {
        previewUrl.value = ''
        error.value = getErrorMessage(reason, '无法准备输入')
      }
    }
  },
  { immediate: true }
)
function close() {
  if (!busy.value) emit('update:open', false)
}
function openBranch(id: string) {
  emit('update:open', false)
  emit('branchOpened', id)
}
async function create() {
  if (!props.doc || !props.workId || props.readonly || busy.value || !previewUrl.value) return
  busy.value = true
  try {
    const draft = await createAIBranch(
      props.workspaceId,
      props.workId,
      props.doc,
      inputScope.value,
      area.value,
      label.value,
      maskIds.value,
      referencePaths.value,
      props.assetInfo
    )
    message.success('已建立独立的 AI 制作文件')
    openBranch(draft.id)
  } catch (reason) {
    error.value = getErrorMessage(reason, '创建 AI 制作文件失败，请重试')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <a-modal
    class="ai-handoff-dialog"
    centered
    :open="open"
    title="建立 AI 加工分支"
    :width="760"
    :footer="null"
    :closable="!busy"
    :mask-closable="!busy"
    :keyboard="!busy"
    @cancel="close"
  >
    <p class="handoff-description">
      输入会保存为独立快照，后续修改原画布不会影响这份 AI 制作文件。
    </p>
    <div class="handoff-input">
      <figure>
        <img v-if="previewUrl" :src="previewUrl" alt="AI 输入预览" />
        <figcaption>{{ label }} · {{ previewSize }}</figcaption>
      </figure>
      <div class="handoff-options">
        <label
          >输入范围<select v-model="scopeChoice" :disabled="busy">
            <option value="all">整张画布</option>
            <option v-for="group in groups" :key="group.id" :value="`group:${group.id}`">
              分组 · {{ group.name }}
            </option>
            <option v-for="layer in contentLayers" :key="layer.id" :value="`layer:${layer.id}`">
              图层 · {{ layer.name }}
            </option>
          </select></label
        >
        <label
          >画布范围<select v-model="area" :disabled="busy">
            <option value="content">内容区</option>
            <option value="canvas">整个画布</option>
          </select></label
        >
        <label
          >蒙版<select v-model="maskChoice" :disabled="busy || !masks.length">
            <option value="all">{{ masks.length ? '全部可见蒙版' : '没有可见蒙版' }}</option>
            <option value="none">不带入蒙版</option>
            <option v-for="mask in masks" :key="mask.id" :value="mask.id">{{ mask.name }}</option>
          </select></label
        >
        <label
          >参考图<a-select
            v-model:value="referencePaths"
            mode="multiple"
            placeholder="可选，在 AI 编辑器中也可继续添加"
            :disabled="busy"
            :options="images.map((asset) => ({ value: asset.path, label: asset.name }))"
        /></label>
      </div>
    </div>
    <p v-if="error" role="alert" class="handoff-error">{{ error }}</p>
    <div v-if="branches.length" class="handoff-existing">
      <strong>同一输入范围已有 {{ branches.length }} 份 AI 制作文件</strong>
      <select v-model="branchId" :disabled="busy">
        <option v-for="branch in branches" :key="branch.id" :value="branch.id">
          {{ branch.name }}
        </option>
      </select>
      <a-button :disabled="busy || !branchId" @click="openBranch(branchId)">继续已有分支</a-button>
      <small>续编保留原输入；新建使用当前画布版本。</small>
    </div>
    <div class="handoff-actions">
      <a-button :disabled="busy" @click="close">取消</a-button
      ><a-button
        type="primary"
        :loading="busy"
        :disabled="readonly || !workId || !previewUrl || referencePaths.length > 13"
        @click="create"
        >{{ branches.length ? '用当前版本新建' : '新建并进入 AI 编辑器' }}</a-button
      >
    </div>
  </a-modal>
</template>
<style scoped>
:global(.ai-handoff-dialog .ant-modal-body) {
  max-height: calc(100dvh - 140px);
  overflow: auto;
}
.handoff-description,
.handoff-existing small {
  color: var(--ui-text-muted);
}
.handoff-input {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) minmax(240px, 1.2fr);
  gap: 24px;
  margin: 20px 0;
}
figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  margin: 0;
  min-height: 220px;
  padding: 16px;
  border-radius: 12px;
  background: var(--ui-surface-soft);
  border: 1px solid var(--ui-border);
}
figure img {
  max-width: 100%;
  max-height: 260px;
  object-fit: contain;
}
figcaption {
  margin-top: 14px;
  color: var(--ui-text-muted);
  font-size: 12px;
}
.handoff-options,
.handoff-options > label {
  display: grid;
  gap: 8px;
}
.handoff-options {
  gap: 16px;
}
select {
  width: 100%;
  min-height: 34px;
  padding: 6px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  color: var(--ui-text);
  background: var(--ui-surface);
  font: inherit;
}
.handoff-existing {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border);
}
.handoff-existing strong,
.handoff-existing small {
  grid-column: 1 / -1;
}
.handoff-error {
  color: #d4380d;
}
.handoff-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 24px;
}
@media (max-width: 600px) {
  .handoff-input {
    grid-template-columns: 1fr;
  }
  figure {
    min-height: 100px;
  }
  figure img {
    max-height: 160px;
  }
}
</style>
