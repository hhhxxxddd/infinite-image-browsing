<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { FolderOutlined, HddOutlined, FolderAddOutlined, EllipsisOutlined, DeleteOutlined, DragOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import { getTargetFolderFiles, type FileNodeInfo } from '@/api/files'
import { useGlobalStore } from '@/store/useGlobalStore'
import { copy2clipboardI18n } from '@/util'
import { getFileTransferDataFromDragEvent } from '@/util/file'
import { navigate } from './navigation'
import { createSubfolder } from './createSubfolder'
import { deleteSubfolder } from './deleteSubfolder'
import { renameSubfolder } from './renameSubfolder'
import { onAliasExtraPathClick, onRemoveExtraPathClick } from './extraPathControlFunc'

const props = withDefaults(defineProps<{
  path: string; name: string; root?: boolean; depth?: number; ancestors?: string[];
  movingPath?: string; query?: string; focusPath?: string
}>(), { root: false, depth: 0, ancestors: () => [], movingPath: '', query: '', focusPath: '' })
const emit = defineEmits<{
  changed: []; startMove: [path: string]; cancelMove: []; move: [source: string, destination: string]; opened: [path: string]
}>()
const global = useGlobalStore()
const children = ref<FileNodeInfo[]>([])
const loaded = ref(false)
const loading = ref(false)
const error = ref('')
// Fetch only the first layer initially. A wide folder tree must not fire one
// request per descendant as soon as the directory page opens.
const normalized = (path: string) => {
  const value = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return global.conf?.is_win ? value.toLowerCase() : value
}
const focused = computed(() => !!props.focusPath && normalized(props.focusPath) === normalized(props.path))
const onFocusedBranch = () => !!props.focusPath && normalized(props.focusPath).startsWith(normalized(props.path) + '/')
const revealed = ref(props.depth === 0 || onFocusedBranch())
const cardEl = ref<HTMLElement>()
const dropTarget = ref(false)
const registered = computed(() => {
  const normalize = (path: string) => {
    const value = path.replace(/\\/g, '/').replace(/\/+$/, '')
    return global.conf?.is_win ? value.toLowerCase() : value
  }
  return global.conf?.extra_paths.find(folder => normalize(folder.path) === normalize(props.path))
})
const label = computed(() => registered.value?.alias || props.name)
const highlighted = computed(() => !!props.query.trim() && `${label.value} ${props.path}`.toLocaleLowerCase().includes(props.query.trim().toLocaleLowerCase()))
const isMoving = computed(() => props.movingPath === props.path)

async function load() {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    children.value = (await getTargetFolderFiles(props.path, true)).files
      .filter(file => file.type === 'dir').sort((a, b) => a.name.localeCompare(b.name))
    loaded.value = true
  } catch { error.value = '无法读取下级目录' }
  finally { loading.value = false }
}
async function reveal() { revealed.value = true; if (!loaded.value) await load() }
async function created() { await reveal(); await load(); emit('changed') }
function openOrMove() {
  if (props.movingPath) {
    if (isMoving.value) emit('cancelMove')
    else emit('move', props.movingPath, props.path)
  } else { navigate('local', { path: props.path, mode: 'scanned-fixed' }); emit('opened', props.path) }
}
function startDrag(event: DragEvent) {
  if (registered.value || global.conf?.is_readonly) { event.preventDefault(); return }
  event.dataTransfer?.setData('application/x-iib-folder-node', props.path)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function dragOver(event: DragEvent) {
  if (global.conf?.is_readonly || !event.dataTransfer) return
  if (!event.dataTransfer.types.includes('application/x-iib-folder-node') && !event.dataTransfer.types.includes('application/x-iib-files')) return
  event.preventDefault()
  dropTarget.value = true
}
async function drop(event: DragEvent) {
  dropTarget.value = false
  if (global.conf?.is_readonly) return
  const source = event.dataTransfer?.getData('application/x-iib-folder-node')
  if (source) { event.preventDefault(); emit('move', source, props.path); return }
  const data = getFileTransferDataFromDragEvent(event)
  if (!data) return
  event.preventDefault()
  const { confirmFileTransfer } = await import('@/page/fileTransfer/hooks/useFileTransfer')
  confirmFileTransfer(data, props.path)
}
onMounted(() => {
  if (revealed.value) void load()
  if (focused.value) void nextTick(() => cardEl.value?.scrollIntoView({ block: 'center', inline: 'center' }))
})
</script>

<template>
  <div class="graph-branch">
    <article ref="cardEl" class="graph-card" :class="{ 'drop-active': dropTarget, 'move-source': isMoving, 'move-target': movingPath && !isMoving, highlighted, focused }"
      :title="path" :draggable="!registered && !global.conf?.is_readonly" @dragstart="startDrag" @dragover="dragOver" @dragleave="dropTarget = false" @drop.stop="drop">
      <button class="graph-open" :aria-label="movingPath ? `移动到：${label}` : `在标签页打开：${label}`" @click="openOrMove">
        <span class="folder-icon"><HddOutlined v-if="root" /><FolderOutlined v-else /></span>
        <span class="graph-copy"><strong>{{ label }}</strong><small>{{ root ? '已添加的文件夹' : path }}</small></span>
      </button>
      <div class="graph-actions">
        <button :disabled="global.conf?.is_readonly" :aria-label="`在 ${label} 中新建子文件夹`" title="新建子文件夹" @click="createSubfolder(path, created)"><FolderAddOutlined /></button>
        <button v-if="!registered" :disabled="global.conf?.is_readonly" :aria-label="`移动文件夹：${label}`" title="移动到其他节点" @click="emit('startMove', path)"><DragOutlined /></button>
        <button v-if="!registered" :disabled="global.conf?.is_readonly" :aria-label="`删除空文件夹：${label}`" title="删除空文件夹" @click="deleteSubfolder(path, () => emit('changed'))"><DeleteOutlined /></button>
        <a-dropdown :trigger="['click']"><button :aria-label="`更多目录操作：${label}`" title="更多操作"><EllipsisOutlined /></button><template #overlay><a-menu>
          <a-menu-item v-if="!registered" :disabled="global.conf?.is_readonly" @click="renameSubfolder(path, () => emit('changed'))">改名</a-menu-item>
          <a-menu-item @click="copy2clipboardI18n(path)">复制路径</a-menu-item>
          <a-menu-item @click="load">刷新下级目录</a-menu-item>
          <template v-if="registered">
            <a-menu-item :disabled="global.conf?.is_readonly" @click="onAliasExtraPathClick(path)">修改显示名称</a-menu-item>
            <a-menu-item danger :disabled="global.conf?.is_readonly" @click="onRemoveExtraPathClick(path, registered.types.filter(type => type !== 'cli_access_only'))">从媒体库移除</a-menu-item>
          </template>
        </a-menu></template></a-dropdown>
      </div>
    </article>
    <div v-if="revealed && (loading || error || children.length)" class="graph-children" role="group" :aria-label="`${label} 的下级目录`">
      <span v-if="loading" class="graph-status">读取中…</span>
      <button v-else-if="error" class="graph-status retry" @click="load">{{ error }} · 重试</button>
      <template v-else>
        <FolderTreeNode v-for="child in children.filter(item => ![path, ...ancestors].includes(item.fullpath))" :key="child.fullpath"
          :path="child.fullpath" :name="child.name" :depth="depth + 1" :ancestors="[path, ...ancestors]"
          :moving-path="movingPath" :query="query" :focus-path="focusPath" @changed="load(); emit('changed')" @start-move="emit('startMove', $event)"
          @cancel-move="emit('cancelMove')" @move="(source, destination) => emit('move', source, destination)" @opened="emit('opened', $event)" />
      </template>
    </div>
    <button v-if="!revealed" class="graph-reveal" @click="reveal"><ReloadOutlined /> 查看下级目录</button>
  </div>
</template>

<style scoped>
.graph-branch{display:flex;flex-direction:column;align-items:center;flex:none;min-width:220px;position:relative}
.graph-card{width:220px;min-height:100px;padding:12px;border:1px solid var(--zp-border);border-radius:13px;background:var(--zp-secondary-background);box-shadow:0 5px 18px #102b4c0b;transition:border-color .15s,box-shadow .15s,transform .15s}
.graph-card:hover{border-color:var(--primary-color);box-shadow:0 9px 24px #1261ae20;transform:translateY(-2px)}
.graph-card.highlighted,.graph-card.focused,.graph-card.move-source{border-color:var(--primary-color);box-shadow:0 0 0 3px var(--primary-color-1)}
.graph-card.move-target:hover,.graph-card.drop-active{outline:2px dashed var(--primary-color);outline-offset:3px}
.graph-open{display:flex;align-items:center;gap:10px;width:100%;min-width:0;border:0;background:none;color:var(--zp-primary);text-align:left;cursor:pointer;padding:0}
.folder-icon{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:9px;background:var(--primary-color-1);color:var(--primary-color);font-size:20px}
.graph-copy{display:flex;flex-direction:column;min-width:0;gap:3px}.graph-copy strong{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.graph-copy small{font-size:10px;color:var(--zp-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.graph-actions{display:flex;justify-content:flex-end;gap:3px;margin-top:13px;padding-top:8px;border-top:1px solid var(--zp-border)}
.graph-actions button{display:grid;place-items:center;width:27px;height:25px;border:0;border-radius:5px;background:none;color:var(--zp-secondary);cursor:pointer}
.graph-actions button:hover{background:var(--primary-color-1);color:var(--primary-color)}.graph-actions button:disabled{opacity:.4;cursor:default}
.graph-children{display:flex;justify-content:center;align-items:flex-start;gap:18px;position:relative;width:max-content;min-width:100%;padding-top:36px}
.graph-children:not(:empty)::before{content:'';position:absolute;top:0;left:50%;height:18px;border-left:1px solid var(--primary-color)}
.graph-children>.graph-branch::before{content:'';position:absolute;top:-18px;left:50%;height:18px;border-left:1px solid var(--primary-color)}
.graph-children>.graph-branch:not(:only-child):first-of-type::after{content:'';position:absolute;top:-18px;left:50%;width:calc(50% + 18px);border-top:1px solid var(--primary-color)}
.graph-children>.graph-branch:not(:only-child):last-of-type::after{content:'';position:absolute;top:-18px;right:50%;width:calc(50% + 18px);border-top:1px solid var(--primary-color)}
.graph-children>.graph-branch:not(:first-of-type):not(:last-of-type)::after{content:'';position:absolute;top:-18px;left:-9px;width:calc(100% + 18px);border-top:1px solid var(--primary-color)}
.graph-status,.graph-reveal{font-size:11px;color:var(--zp-secondary);background:none;border:0}.graph-status{padding:8px}.graph-reveal{margin-top:20px;cursor:pointer}.graph-reveal:hover,.retry:hover{color:var(--primary-color)}
.graph-card{border-radius:var(--ui-radius);background:var(--ui-surface);box-shadow:0 2px 8px #1837540b;}
.graph-card:hover{transform:translateY(-1px);box-shadow:var(--ui-shadow);}
.folder-icon{width:34px;height:34px;font-size:17px;border-radius:var(--ui-radius-sm);}
.graph-actions button{width:28px;height:28px;border-radius:var(--ui-radius-sm);transition:background-color var(--ui-motion-fast) var(--ui-ease),color var(--ui-motion-fast) var(--ui-ease);}
</style>
