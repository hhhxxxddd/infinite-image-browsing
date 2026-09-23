<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { FolderOutlined, FolderAddOutlined, RightOutlined, DownOutlined, EllipsisOutlined, DeleteOutlined } from '@ant-design/icons-vue'
import { getTargetFolderFiles, type FileNodeInfo } from '@/api/files'
import { useGlobalStore } from '@/store/useGlobalStore'
import { copy2clipboardI18n } from '@/util'
import { getFileTransferDataFromDragEvent } from '@/util/file'
import { navigate } from './navigation'
import { createSubfolder } from './createSubfolder'
import { deleteSubfolder } from './deleteSubfolder'
import { onAliasExtraPathClick, onRemoveExtraPathClick } from './extraPathControlFunc'
const props = withDefaults(defineProps<{path:string; name:string; root?:boolean; ancestors?:string[]}>(), {root:false,ancestors:()=>[]})
const emit = defineEmits<{changed:[]}>()
const global = useGlobalStore()
const expanded = ref(props.root)
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
const children = ref<FileNodeInfo[]>([])
const dropTarget = ref(false)
const registered = computed(() => global.conf?.extra_paths.find(folder => folder.path === props.path))
const label = computed(() => registered.value?.alias || props.name)
async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try { children.value = (await getTargetFolderFiles(props.path, true)).files.sort((a,b) => a.name.localeCompare(b.name)); loaded.value = true }
  catch { error.value = '无法读取子文件夹，点击重试' }
  finally { loading.value = false }
}
async function toggle() { expanded.value = !expanded.value; if (expanded.value && !loaded.value) await load() }
async function created() { expanded.value = true; await load() }
function dragOver(event: DragEvent) {
  if (global.conf?.is_readonly || !event.dataTransfer?.types.includes('application/x-iib-files')) return
  event.preventDefault(); dropTarget.value = true
}
async function drop(event: DragEvent) {
  dropTarget.value = false
  const data = getFileTransferDataFromDragEvent(event)
  if (!data || global.conf?.is_readonly) return
  event.preventDefault()
  const { confirmFileTransfer } = await import('@/page/fileTransfer/hooks/useFileTransfer')
  confirmFileTransfer(data, props.path)
}
onMounted(() => { if (expanded.value) void load() })
</script>
<template>
  <div class="folder-tree-node">
    <div class="tree-row" :class="{'drop-active':dropTarget}" @dragover="dragOver" @dragleave="dropTarget=false" @drop.stop="drop">
      <button class="tree-toggle" :aria-expanded="expanded" :aria-label="`${expanded ? '收起' : '展开'}：${label}`" @click="toggle"><DownOutlined v-if="expanded" /><RightOutlined v-else /></button>
      <button class="tree-open" :aria-label="`打开文件夹：${label}`" :title="path" @click="navigate('local',{path,mode:'scanned-fixed'})"><FolderOutlined /><span>{{ label }}</span><small v-if="root">已添加</small></button>
      <div class="tree-actions">
        <button :disabled="global.conf?.is_readonly" :aria-label="`在 ${label} 中新建子文件夹`" title="新建子文件夹" @click="createSubfolder(path,created)"><FolderAddOutlined /></button>
        <button v-if="!registered" :disabled="global.conf?.is_readonly" :aria-label="`删除子文件夹：${label}`" title="删除空文件夹" @click="deleteSubfolder(path,()=>emit('changed'))"><DeleteOutlined /></button>
        <a-dropdown :trigger="['click']"><button :aria-label="`管理文件夹：${label}`"><EllipsisOutlined /></button><template #overlay><a-menu>
          <a-menu-item @click="copy2clipboardI18n(path)">复制路径</a-menu-item>
          <a-menu-item @click="load">刷新子文件夹</a-menu-item>
          <template v-if="registered">
            <a-menu-item :disabled="global.conf?.is_readonly" @click="onAliasExtraPathClick(path)">修改显示名称</a-menu-item>
            <a-menu-item danger :disabled="global.conf?.is_readonly" @click="onRemoveExtraPathClick(path,registered.types.filter(type=>type!=='cli_access_only'))">从媒体库移除</a-menu-item>
          </template>
        </a-menu></template></a-dropdown>
      </div>
    </div>
    <div v-if="expanded" class="tree-children" role="group" :aria-label="`${label} 的子文件夹`">
      <span v-if="loading" class="tree-hint">正在读取…</span>
      <button v-else-if="error" class="tree-hint" @click="load">{{ error }}</button>
      <template v-else>
        <span v-if="!children.length" class="tree-hint">没有子文件夹</span>
        <template v-for="child in children" :key="child.fullpath">
          <FolderTreeNode v-if="![path,...ancestors].includes(child.fullpath)" :path="child.fullpath" :name="child.name" :ancestors="[path,...ancestors]" @changed="load" />
        </template>
      </template>
    </div>
  </div>
</template>
<style scoped>
.tree-row{display:flex;align-items:center;gap:6px;min-height:42px;border-radius:6px;}.tree-row:hover{background:var(--zp-secondary-background);}.tree-row.drop-active{outline:2px dashed var(--primary-color);}.tree-row button{border:0;background:none;color:var(--zp-primary);cursor:pointer;padding:6px;border-radius:4px;}.tree-row button:hover{background:var(--primary-color-1);}.tree-toggle{font-size:10px;flex-shrink:0;}.tree-open{display:flex;align-items:center;gap:9px;min-width:0;flex:1;text-align:left;font-size:13px;}.tree-open>.anticon{font-size:19px;color:var(--primary-color);}.tree-open>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.tree-open small{font-size:10px;color:var(--zp-secondary);flex-shrink:0;}.tree-actions{display:flex;gap:2px;margin-left:auto;flex-shrink:0;}.tree-actions button{color:var(--zp-secondary);font-size:14px;}.tree-children{margin-left:16px;padding-left:12px;border-left:1px solid var(--zp-border);}.tree-hint{display:block;font-size:11px;color:var(--zp-secondary);padding:6px 12px;background:none;border:0;}.tree-row button:disabled{opacity:.4;cursor:default;}
</style>
