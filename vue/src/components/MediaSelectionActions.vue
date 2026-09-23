<script setup lang="ts">
import { computed, ref } from 'vue'
import TagMenuItems from './TagMenuItems.vue'
import { message } from 'ant-design-vue'
import type { FileNodeInfo } from '@/api/files'
import ArchiveSettings from '@/page/globalSetting/ArchiveSettings.vue'
import { axiosInst, checkPathExists, checkPathIsDirectory, getArchiveSettings } from '@/api'
import { getTargetFolderFiles, moveFiles } from '@/api/files'
import { useGlobalStore } from '@/store/useGlobalStore'
import { useImgSliStore } from '@/store/useImgSli'
import { isImageFile, isVideoFile, isAudioFile, copy2clipboardI18n } from '@/util'
import { events } from '@/page/fileTransfer/hooks'
import { isAbsolute } from '@/util/path'
const props = defineProps<{ files: FileNodeInfo[]; allLoadedSelected?: boolean; currentFolder?: string }>()
const emit = defineEmits<{ action: [key: string]; selectAll: []; reverseSelect: []; clear: [] }>()
const global = useGlobalStore()
const comparison = useImgSliStore()
const exporting = ref(false)
const archivePath = ref('')
const targets = computed(() => Array.from(new Map(
  (global.conf?.extra_paths ?? []).filter(folder => folder.types.some(type => type === 'walk' || type === 'scanned'))
    .map(folder => [folder.path, folder.alias || folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path] as const)
).entries()))
const destinations = computed(() => Array.from(new Map([
  ...targets.value,
  ...global.tabList.flatMap(tab => tab.panes.flatMap(pane => pane.type === 'local' && pane.path
    ? [[pane.path, pane.nameFallbackStr || (typeof pane.name === 'string' ? pane.name : pane.path)] as [string, string]] : []))
]).entries()))
const pathPickerOpen = ref(false)
const targetPath = ref('')
const childFolders = ref<FileNodeInfo[]>([])
const browsing = ref(false)
const moving = ref(false)
const targetError = ref('')
let browseId = 0
async function browse(path: string) {
  const id = ++browseId
  targetPath.value = path
  browsing.value = true
  targetError.value = ''
  try {
    const result = await getTargetFolderFiles(path, true)
    if (id === browseId) childFolders.value = result.files.filter(file => file.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    if (id === browseId) { childFolders.value = []; targetError.value = '无法读取此目录，可以输入其他路径。' }
  } finally { if (id === browseId) browsing.value = false }
}
function openPathPicker() {
  pathPickerOpen.value = true
  const initial = props.currentFolder || destinations.value[0]?.[0] || ''
  targetPath.value = initial
  childFolders.value = []
  targetError.value = ''
  if (initial) void browse(initial)
}
function chooseDestination(key: string) {
  if (key === 'move-other') openPathPicker()
  else emit('action', key)
}
function editTargetPath() {
  browseId++
  browsing.value = false
  childFolders.value = []
  targetError.value = ''
}
async function moveToPath() {
  if (moving.value || global.conf?.is_readonly) return
  if (!onlyFiles.value) { targetError.value = '请在目录页移动文件夹'; return }
  const destination = targetPath.value.trim()
  if (!destination) { targetError.value = '请选择或输入目标文件夹路径'; return }
  if (!isAbsolute(destination)) { targetError.value = '请输入绝对目录路径'; return }
  moving.value = true
  targetError.value = ''
  try {
    if (!(await checkPathIsDirectory([destination]))[destination]) throw new Error('目标文件夹不存在，或媒体服务无法访问')
    const normalized = (path: string) => {
      const value = path.replace(/\\/g, '/').replace(/\/+$/, '')
      return global.conf?.is_win ? value.toLowerCase() : value
    }
    const paths = props.files.map(file => file.fullpath).filter(path => {
      const value = normalized(path)
      return value.slice(0, value.lastIndexOf('/')) !== normalized(destination)
    })
    if (!paths.length) throw new Error('所选文件已在目标文件夹')
    const separator = global.conf?.is_win ? '\\' : '/'
    const targetFiles = paths.map(path => destination.replace(/[\\/]+$/, '') + separator + path.split(/[\\/]/).pop())
    if (new Set(targetFiles.map(normalized)).size !== targetFiles.length) throw new Error('所选文件中有同名项，请分批移动')
    const existing = await checkPathExists(targetFiles)
    if (targetFiles.some(path => existing[path])) throw new Error('目标文件夹存在同名文件，请先处理重名文件')
    await moveFiles(paths, destination)
    events.emit('removeFiles', { paths, loc: props.currentFolder || '' })
    emit('clear')
    pathPickerOpen.value = false
    message.success(`已移动 ${paths.length} 项`)
  } catch (error: any) {
    targetError.value = error.response?.data?.detail || error.message || '移动失败，请重试'
  } finally { moving.value = false }
}
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
const canOpenGrid = computed(() => props.files.length >= 3 && props.files.length <= 9 && props.files.every(file => isImageFile(file.name)))
const mediaTypeSummary = computed(() => {
  const images = props.files.filter(file => isImageFile(file.name)).length
  const videos = props.files.filter(file => isVideoFile(file.name)).length
  const audios = props.files.filter(file => isAudioFile(file.name)).length
  const parts = [[images, '图片'], [videos, '视频'], [audios, '音频']].filter(([count]) => Number(count) > 0)
  return parts.length > 1 ? parts.map(([count, label]) => `${label} ${count}`).join(' · ') : ''
})
function compare() {
  if (!canCompare.value) return
  comparison.openComparison(props.files)
}
function openGrid() { if (canOpenGrid.value) comparison.openGrid(props.files) }
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
  <Transition name="selection-dock">
  <div v-if="files.length" class="selection-actions" role="toolbar" aria-label="选中文件的操作">
    <strong>已选 {{ files.length }} 项<span v-if="mediaTypeSummary" class="media-type-summary"> · {{ mediaTypeSummary }}</span></strong>
    <a-button size="small" type="text" :aria-pressed="!!allLoadedSelected" @click="emit('selectAll')">{{ allLoadedSelected ? '取消全选' : '全选已加载' }}</a-button>
    <a-button size="small" type="text" @click="emit('reverseSelect')">反选</a-button>
    <a-button size="small" type="text" @click="emit('clear')">取消</a-button>
    <span class="selection-divider" aria-hidden="true"></span>
    <a-dropdown :trigger="['click']" :disabled="global.conf?.is_readonly || !onlyFiles">
      <a-button size="small" :disabled="global.conf?.is_readonly || !onlyFiles">标签</a-button>
      <template #overlay><a-menu @click="emit('action', String($event.key))">
        <a-sub-menu key="add" title="添加标签"><TagMenuItems :tags="global.conf?.all_custom_tags ?? []" key-prefix="batch-add-tag-" /></a-sub-menu>
        <a-sub-menu key="remove" title="移除标签"><TagMenuItems :tags="global.conf?.all_custom_tags ?? []" key-prefix="batch-remove-tag-" /></a-sub-menu>
      </a-menu></template>
    </a-dropdown>
    <a-dropdown v-for="operation in ['copy', 'move']" :key="operation" :trigger="['click']" :disabled="global.conf?.is_readonly || (operation === 'copy' && !targets.length)">
      <a-button size="small" :disabled="global.conf?.is_readonly || (operation === 'copy' && !targets.length)">{{ operation === 'copy' ? '复制到' : '移动到' }}</a-button>
      <template #overlay><a-menu @click="chooseDestination(String($event.key))"><a-menu-item v-for="[path, name] in targets" :key="`${operation}-to-${path}`" :title="path">{{ name }}</a-menu-item><template v-if="operation === 'move'"><a-menu-divider v-if="targets.length" /><a-menu-item key="move-other" :disabled="!onlyFiles">其他路径…</a-menu-item></template></a-menu></template>
    </a-dropdown>
    <a-button size="small" type="primary" :loading="exporting" :disabled="global.conf?.is_readonly || !onlyFiles" @click="openExport">导出</a-button>
    <a-button v-if="canCompare" size="small" @click="compare">对比两张</a-button>
    <a-button v-if="canOpenGrid" size="small" @click="openGrid">多图查看（{{ files.length }}）</a-button>
    <span class="selection-divider" aria-hidden="true"></span>
    <a-button size="small" type="text" danger :disabled="global.conf?.is_readonly" @click="emit('action', 'deleteFiles')">删除</a-button>
  </div>
  </Transition>
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
  <a-modal v-model:open="pathPickerOpen" title="移动到其他文件夹" :width="520" ok-text="移动到这里" :ok-button-props="{ disabled: !targetPath.trim() || global.conf?.is_readonly, loading: moving }" :cancel-button-props="{ disabled: moving }" :closable="!moving" :mask-closable="!moving" @ok="moveToPath">
    <p class="move-path-hint">选择已添加的文件夹或标签页，再进入下级目录；也可以输入媒体服务能够访问的绝对路径。</p>
    <div v-if="destinations.length" class="move-quick-paths"><button v-for="[path, name] in destinations" :key="path" type="button" :title="path" :disabled="moving" @click="browse(path)">{{ name }}</button></div>
    <label class="move-path-label" for="move-target-path">目标文件夹路径</label>
    <div class="move-path-input"><input id="move-target-path" v-model="targetPath" :disabled="moving" placeholder="输入绝对目录路径" @input="editTargetPath" @keydown.enter.prevent="moveToPath" /><a-button size="small" :disabled="!targetPath.trim() || moving" :loading="browsing" @click="browse(targetPath.trim())">查看下级</a-button></div>
    <div class="move-folder-list" aria-label="下级文件夹">
      <span v-if="browsing">正在读取下级文件夹…</span>
      <span v-else-if="!childFolders.length">当前没有下级文件夹</span>
      <template v-else><button v-for="folder in childFolders" :key="folder.fullpath" type="button" :disabled="moving" :title="folder.fullpath" @click="browse(folder.fullpath)"><span>📁 {{ folder.name }}</span><span>进入 ›</span></button></template>
    </div>
    <p v-if="targetError" class="move-path-error" role="alert">{{ targetError }}</p>
    <p class="move-count">将移动 {{ files.length }} 项；文件保留在目标目录，原位置不再显示。</p>
  </a-modal>
</template>
<style scoped>
.selection-actions{display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 24px;background:var(--primary-color-1);border-block:1px solid var(--zp-border);flex-shrink:0;font-size:12px;}
.selection-actions strong{margin-right:4px;font-weight:500;white-space:nowrap;}
.move-path-hint,.move-count{font-size:12px;color:var(--zp-secondary);line-height:1.5}.move-path-hint{margin:0 0 12px}.move-count{margin:10px 0 0}
.move-quick-paths{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.move-quick-paths button{max-width:180px;padding:4px 9px;border:1px solid var(--zp-border);border-radius:6px;background:var(--zp-secondary-background);color:var(--zp-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.move-quick-paths button:hover{border-color:var(--primary-color);color:var(--primary-color)}
.move-path-label{display:block;margin-bottom:6px;font-size:12px;font-weight:600}.move-path-input{display:flex;gap:8px}.move-path-input input{flex:1;min-width:0;border:1px solid var(--zp-border);border-radius:6px;background:var(--zp-primary-background);color:var(--zp-primary);padding:6px 9px;font:inherit;font-size:12px}
.move-folder-list{display:flex;flex-direction:column;gap:4px;max-height:220px;overflow:auto;margin-top:12px;padding:5px;border:1px solid var(--zp-border);border-radius:7px}.move-folder-list>span{padding:14px;color:var(--zp-secondary);font-size:12px}.move-folder-list button{display:flex;align-items:center;justify-content:space-between;gap:8px;border:0;border-radius:5px;background:transparent;color:var(--zp-primary);padding:7px 9px;text-align:left;cursor:pointer}.move-folder-list button:hover{background:var(--primary-color-1)}.move-folder-list button span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.move-folder-list button span:last-child{flex-shrink:0;color:var(--zp-secondary);font-size:11px}.move-path-error{color:#cf1322;font-size:12px;margin:9px 0 0}
.selection-actions :deep(.ant-checkbox-wrapper){font-size:12px;}
.archive-path{overflow-wrap:anywhere;}
@media(max-width:650px){.selection-actions{padding-inline:12px;}}
</style>

<style scoped>
.selection-actions{pointer-events:auto;width:max-content;max-width:100%;flex-wrap:nowrap;overflow-x:auto;overscroll-behavior:contain;padding:10px 12px;gap:6px;background:var(--zp-primary-background);border:1px solid var(--zp-border);border-radius:10px;box-shadow:0 6px 28px #0002;}
.selection-actions>*{flex-shrink:0;white-space:nowrap;}
.selection-actions strong{font-size:12px;}
.selection-actions .media-type-summary{color:var(--zp-secondary);font-weight:400;}
.selection-actions .selection-divider{width:1px;height:20px;flex:0 0 1px;background:var(--zp-border);margin:0 3px;}
.selection-actions :deep(.ant-btn){min-height:28px;border-radius:var(--ui-radius-sm);}
.selection-dock-enter-active,.selection-dock-leave-active{transition:opacity var(--ui-motion) var(--ui-ease),transform var(--ui-motion) var(--ui-ease);}
.selection-dock-enter-from,.selection-dock-leave-to{opacity:0;transform:translateY(8px);}
</style>

<style scoped>
.export-options{display:flex;flex-direction:column;gap:12px;margin:12px 0;}
.export-hint{color:var(--zp-secondary);font-size:12px;line-height:1.7;margin-bottom:18px;}
</style>

<style scoped>.archive-destination{margin:12px 0;padding:10px;border:1px solid var(--zp-border);border-radius:6px;font-size:12px;}.archive-destination .archive-path{margin:0;}</style>
