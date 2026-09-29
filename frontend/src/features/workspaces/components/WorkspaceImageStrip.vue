<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import type { ImageEditorProps } from '@/features/image-editor/public'
import { saveWorkspaceState, workspaceStorage } from '../services/workspaceStorage'
import type {
  MaterialClickMode,
  MaterialClickOption,
  MaterialController
} from '../model/workspaceMaterials'
import type { WorkspaceAsset } from '../model/workspaceModel'
import {
  mergeMaterialHistory,
  readMaterialHistory,
  writeMaterialHistory
} from '../model/workspaceMaterialHistory'
import WorkspaceMaterialShelf from './WorkspaceMaterialShelf.vue'

const props = defineProps<{
  workspaceId: string
  assets: ImageEditorProps['assets']
  assetInfo: ImageEditorProps['assetInfo']
  selectedPath: string
  usedPaths: string[]
  canReplace: boolean
  disabled: boolean
}>()
const emit = defineEmits<{
  pick: [path: string, replace: boolean]
  preview: [path: string]
  addAssets: []
}>()
const mode = ref<MaterialClickMode>('add')
const clickOptions = computed<MaterialClickOption[]>(() => [
  { value: 'view', label: '查看', title: '单击素材打开预览', disabled: props.disabled },
  { value: 'add', label: '添加', title: '单击素材新增图片图层', disabled: props.disabled },
  {
    value: 'replace',
    label: '替换',
    title: props.canReplace ? '单击素材替换当前图片图层' : '先选中未锁定的图片图层',
    disabled: props.disabled || !props.canReplace
  }
])
const recentPaths = ref<string[]>([])
watch(
  [() => props.workspaceId, () => props.usedPaths],
  ([workspaceId, paths], previous) => {
    const key = `omnigallery:image-studio-recent-v1:${workspaceId}`
    if (!previous || previous[0] !== workspaceId) {
      // Reopening restores history without promoting the current layers again.
      recentPaths.value = mergeMaterialHistory(
        paths,
        readMaterialHistory(key, workspaceStorage(workspaceId))
      )
    } else {
      const previousPaths = new Set(previous[1])
      const added = paths.filter(
        (path) => !previousPaths.has(path) && !recentPaths.value.includes(path)
      )
      if (!added.length) return
      recentPaths.value = mergeMaterialHistory(recentPaths.value, added)
    }
    const history = [...recentPaths.value]
    if (!props.disabled)
      void saveWorkspaceState(workspaceId, (storage) =>
        writeMaterialHistory(key, history, storage)
      ).catch(() => message.warning('素材使用顺序尚未保存，请重试'))
  },
  { immediate: true }
)
watch(
  () => props.canReplace,
  (available) => {
    if (!available && mode.value === 'replace') mode.value = 'add'
  }
)
function pick(asset: WorkspaceAsset) {
  if (props.disabled || (mode.value === 'replace' && !props.canReplace)) return
  if (mode.value === 'view') emit('preview', asset.path)
  else emit('pick', asset.path, mode.value === 'replace')
}
const controller = computed<MaterialController>(() => ({
  assets: props.assets.filter((asset) => asset.kind === 'image'),
  roles: Object.fromEntries(props.usedPaths.map((path) => [path, '已使用'])),
  activePath: props.selectedPath,
  recentPaths: recentPaths.value,
  clickMode: mode.value,
  clickOptions: clickOptions.value,
  setClickMode: (value) => {
    if (value !== 'switch') mode.value = value
  },
  select: pick,
  actions: () => [
    { key: 'add-layer', label: '新增图层', disabled: props.disabled },
    { key: 'replace-layer', label: '替换当前图层', disabled: props.disabled || !props.canReplace }
  ],
  runAction: (asset, key) => {
    if (props.disabled) return
    if (key === 'add-layer') emit('pick', asset.path, false)
    else if (key === 'replace-layer' && props.canReplace) emit('pick', asset.path, true)
  }
}))
</script>

<template>
  <WorkspaceMaterialShelf
    class="workspace-image-strip"
    aria-label="工作区图片素材"
    :assets="assets"
    :asset-info="assetInfo"
    :allowed-kinds="['image']"
    :controller="controller"
    :tasks="[]"
    :readonly="disabled"
    placement="above"
    :context-key="workspaceId"
    :empty-state="{ title: '暂无图片素材', description: '从媒体库加入图片，用于添加图层或替换' }"
    @select="pick"
    @add="emit('addAssets')"
  />
</template>
