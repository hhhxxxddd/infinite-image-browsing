<script setup lang="ts">
import { computed, ref } from 'vue'
import TagMenuItems from './TagMenuItems.vue'
import { message } from 'ant-design-vue'
import type { FileNodeInfo } from '@/api/files'
import ArchiveSettings from '@/page/globalSetting/ArchiveSettings.vue'
import { axiosInst, getArchiveSettings } from '@/api'
import { useGlobalStore } from '@/store/useGlobalStore'
import { useImgSliStore } from '@/store/useImgSli'
import { isImageFile, copy2clipboardI18n } from '@/util'
const props = defineProps<{ files: FileNodeInfo[]; allLoadedSelected?: boolean }>()
const emit = defineEmits<{ action: [key: string]; selectAll: []; reverseSelect: []; clear: [] }>()
const global = useGlobalStore()
const comparison = useImgSliStore()
const exporting = ref(false)
const archivePath = ref('')
const targets = computed(() => Array.from(new Map(
  (global.conf?.extra_paths ?? []).filter(folder => folder.types.some(type => type === 'walk' || type === 'scanned'))
    .map(folder => [folder.path, folder.alias || folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path] as const)
).entries()))
const exportOpen = ref(false)
const editingArchiveDirectory = ref(false)
const exportMode = ref<'download' | 'archive'>('download')
const exportPaths = ref<string[]>([])
async function openExport() {
  exportPaths.value = props.files.map(file => file.fullpath)
  exportOpen.value = true
  editingArchiveDirectory.value = false
  try { if (global.conf) global.conf.archive = await getArchiveSettings() }
  catch { message.error('读取归档目录失败，请重试') }
}
const onlyFiles = computed(() => props.files.every(file => file.type === 'file'))
const canCompare = computed(() => props.files.length === 2 && props.files.every(file => isImageFile(file.name)))
function compare() {
  if (!canCompare.value) return
  ;[comparison.left, comparison.right] = props.files
  comparison.drawerVisible = true
}
async function exportSelected() {
  if (exporting.value || !exportPaths.value.length || global.conf?.is_readonly) return
  exporting.value = true
  const paths = [...exportPaths.value]
  const packOnly = exportMode.value === 'archive'
  try {
    if (packOnly) {
      const response = await axiosInst.value.post('/zip', { paths, compress: global.batchDownloadCompress, pack_only: true })
      archivePath.value = response.data.path
    } else {
      const response = await axiosInst.value.post('/zip', { paths, compress: global.batchDownloadCompress, pack_only: false }, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `媒体库_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      message.success('已开始下载 ZIP')
    }
    exportOpen.value = false
  } catch (e: any) { message.error(e.response?.data?.detail || '打包失败，请检查归档目录后重试') }
  finally { exporting.value = false }
}
</script>
<template>
  <Teleport to="#media-selection-dock">
  <div v-if="files.length" class="selection-actions" role="toolbar" aria-label="选中文件的操作">
    <strong>已选 {{ files.length }} 项</strong>
    <a-button size="small" type="text" :aria-pressed="!!allLoadedSelected" @click="emit('selectAll')">{{ allLoadedSelected ? '取消全选' : '全选已加载' }}</a-button>
    <a-button size="small" type="text" @click="emit('reverseSelect')">反选</a-button>
    <a-button size="small" type="text" @click="emit('clear')">取消</a-button>
    <a-dropdown :trigger="['click']" :disabled="global.conf?.is_readonly || !onlyFiles">
      <a-button size="small" :disabled="global.conf?.is_readonly || !onlyFiles">标签</a-button>
      <template #overlay><a-menu @click="emit('action', String($event.key))">
        <a-sub-menu key="add" title="添加标签"><TagMenuItems :tags="global.conf?.all_custom_tags ?? []" key-prefix="batch-add-tag-" /></a-sub-menu>
        <a-sub-menu key="remove" title="移除标签"><TagMenuItems :tags="global.conf?.all_custom_tags ?? []" key-prefix="batch-remove-tag-" /></a-sub-menu>
      </a-menu></template>
    </a-dropdown>
    <a-dropdown v-for="operation in ['copy', 'move']" :key="operation" :trigger="['click']" :disabled="global.conf?.is_readonly || !targets.length">
      <a-button size="small" :disabled="global.conf?.is_readonly || !targets.length">{{ operation === 'copy' ? '复制到' : '移动到' }}</a-button>
      <template #overlay><a-menu @click="emit('action', String($event.key))"><a-menu-item v-for="[path, name] in targets" :key="`${operation}-to-${path}`" :title="path">{{ name }}</a-menu-item></a-menu></template>
    </a-dropdown>
    <a-button size="small" type="primary" :loading="exporting" :disabled="global.conf?.is_readonly || !onlyFiles" @click="openExport">导出</a-button>
    <a-button v-if="canCompare" size="small" @click="compare">对比两张</a-button>
    <a-button size="small" type="text" danger :disabled="global.conf?.is_readonly" @click="emit('action', 'deleteFiles')">删除</a-button>
  </div>
  </Teleport>
  <a-modal v-model:open="exportOpen" :title="`导出 ${exportPaths.length} 项`" :width="380" :confirm-loading="exporting" :closable="!exporting" :mask-closable="!exporting" :keyboard="!exporting" :cancel-button-props="{ disabled: exporting }" :ok-button-props="{ disabled: global.conf?.is_readonly || editingArchiveDirectory }" ok-text="导出" cancel-text="取消" @ok="exportSelected">
    <a-radio-group v-model:value="exportMode" class="export-options" :disabled="exporting">
      <a-radio value="download">下载到电脑（ZIP）</a-radio>
      <a-radio value="archive">保存到应用归档目录</a-radio>
    </a-radio-group>
    <p class="export-hint">{{ exportMode === 'download' ? '由浏览器下载到你的电脑。' : '保存在运行媒体库的机器上，完成后显示保存路径。' }}</p>
    <div v-if="exportMode === 'archive'" class="archive-destination">
      <p class="archive-path">目标目录：{{ global.conf?.archive?.directory || '读取中…' }}</p>
      <a-button v-if="!editingArchiveDirectory" size="small" type="link" :disabled="exporting" @click="editingArchiveDirectory = true">更改目录</a-button>
      <ArchiveSettings v-else @saved="editingArchiveDirectory = false" />
    </div>
    <a-checkbox v-model:checked="global.batchDownloadCompress" :disabled="exporting">压缩 ZIP 内容</a-checkbox>
  </a-modal>
  <a-modal :open="!!archivePath" title="归档已保存" :footer="null" @cancel="archivePath = ''">
    <p>ZIP 文件已保存到以下位置：</p><p class="archive-path">{{ archivePath }}</p>
    <a-button @click="copy2clipboardI18n(archivePath)">复制路径</a-button>
  </a-modal>
</template>
<style scoped>
.selection-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 24px;background:var(--primary-color-1);border-block:1px solid var(--zp-border);flex-shrink:0;font-size:12px;}
.selection-actions strong{margin-right:4px;font-weight:500;white-space:nowrap;}
.selection-actions :deep(.ant-checkbox-wrapper){font-size:12px;}
.archive-path{overflow-wrap:anywhere;}
@media(max-width:650px){.selection-actions{padding-inline:12px;}}
</style>

<style scoped>
.selection-actions{pointer-events:auto;width:max-content;max-width:100%;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior:contain;padding:10px 12px;gap:6px;background:var(--zp-primary-background);border:1px solid var(--zp-border);border-radius:10px;box-shadow:0 6px 28px #0002;}
.selection-actions>*{flex-shrink:0;white-space:nowrap;}
.selection-actions strong{font-size:12px;}
</style>

<style scoped>
.export-options{display:flex;flex-direction:column;gap:12px;margin:12px 0;}
.export-hint{color:var(--zp-secondary);font-size:12px;line-height:1.7;margin-bottom:18px;}
</style>

<style scoped>.archive-destination{margin:12px 0;padding:10px;border:1px solid var(--zp-border);border-radius:6px;font-size:12px;}.archive-destination .archive-path{margin:0;}</style>
