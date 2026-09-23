<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FolderOutlined, SearchOutlined, ReloadOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons-vue'
import { Modal, message } from 'ant-design-vue'
import { checkPathExists } from '@/api'
import { updateImageData } from '@/api/db'
import { moveFiles } from '@/api/files'
import { useGlobalStore } from '@/store/useGlobalStore'
import { globalEvents } from '@/util'
import { addToExtraPath } from './extraPathControlFunc'
import { findManagedFolder, topLevelManagedFolders } from './folderScope'
import { folderMoveTarget } from './folderMove'
import FolderTreeNode from './FolderTreeNode.vue'
import { isTauri } from '@/util/env'

const props = withDefaults(defineProps<{ embedded?: boolean; focusPath?: string }>(), { embedded: false, focusPath: '' })
const emit = defineEmits<{ opened: [path: string]; changed: [] }>()

const global = useGlobalStore()
const query = ref('')
const revision = ref(0)
const movingPath = ref('')
const folders = computed(() => (global.conf?.extra_paths ?? []).filter(folder => folder.types.some(type => type !== 'cli_access_only')))
const roots = computed(() => topLevelManagedFolders(folders.value, global.conf?.is_win))
const selectedRootPath = ref('')
const focusedRoot = computed(() => findManagedFolder(roots.value, props.focusPath, global.conf?.is_win))
watch([roots, () => props.focusPath], () => {
  if (!roots.value.some(folder => folder.path === selectedRootPath.value)) selectedRootPath.value = focusedRoot.value?.path ?? roots.value[0]?.path ?? ''
}, { immediate: true })
const visibleRoots = computed(() => {
  if (!props.embedded) return roots.value
  return roots.value.filter(folder => folder.path === selectedRootPath.value)
})
const nameOf = (folder: {path:string;alias?:string}) => folder.alias || folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() || path

async function moveFolder(source: string, destination: string) {
  if (global.conf?.is_readonly) return
  let newPath: string
  try {
    newPath = folderMoveTarget(source, destination, (global.conf?.extra_paths ?? []).map(folder => folder.path), global.conf?.is_win)
    if ((await checkPathExists([newPath]))[newPath]) throw new Error('目标位置已有同名文件或文件夹')
  } catch (error) { message.warning(error instanceof Error ? error.message : '无法移动目录'); return }
  Modal.confirm({
    title: '移动文件夹？',
    content: `将「${baseName(source)}」移入「${baseName(destination)}」。文件和子目录会一同移动。`,
    okText: '移动', cancelText: '取消',
    async onOk() {
      try { await moveFiles([source], destination) }
      catch (error: any) { message.error(error.response?.data?.detail || '移动失败，请重试'); throw error }
      const prefix = source.replace(/\\/g, '/')
      for (const tab of global.tabList) for (const pane of tab.panes) {
        if (pane.type !== 'local' || !pane.path) continue
        const current = pane.path.replace(/\\/g, '/')
        if (current !== prefix && !current.startsWith(`${prefix}/`)) continue
        pane.path = newPath + current.slice(prefix.length).replace(/\//g, global.conf?.is_win ? '\\' : '/')
        pane.name = baseName(pane.path)
      }
      movingPath.value = ''
      revision.value++
      emit('changed')
      globalEvents.emit('searchIndexExpired')
      void updateImageData().catch(() => message.warning('文件夹已移动，请稍后手动刷新媒体索引'))
      message.success('文件夹已移动')
    }
  })
}
</script>

<template>
  <div class="folder-overview" :class="{ embedded }">
    <Teleport to="#media-header-search" :disabled="embedded">
      <div class="folder-tools">
        <label v-if="embedded && roots.length" class="folder-root-picker"><span>根目录</span><select v-model="selectedRootPath" aria-label="选择根目录"><option v-for="folder in roots" :key="folder.path" :value="folder.path" :title="folder.path">{{ nameOf(folder) }}</option></select></label>
        <div class="folder-search"><SearchOutlined /><input v-model="query" aria-label="高亮目录节点" placeholder="查找目录名称或路径" /><button v-if="query" aria-label="清除目录搜索" @click="query = ''">×</button></div>
        <a-button type="text" title="刷新目录" aria-label="刷新目录" @click="revision++"><ReloadOutlined /></a-button>
      </div>
    </Teleport>
    <div class="overview-heading"><div><h2>目录地图</h2><p>点击节点打开标签页 · 在节点上创建、移动或删除空目录</p></div><span v-if="!embedded">{{ folders.length }} 个已添加的文件夹</span></div>
    <div v-if="movingPath" class="move-banner"><span>正在移动 <strong>{{ baseName(movingPath) }}</strong>：点击目标节点，或将此节点拖到目标上</span><button @click="movingPath = ''"><CloseOutlined /> 取消</button></div>
    <p v-if="query" class="search-hint">匹配的节点已高亮；所有目录仍可用于移动和分类。</p>
    <div v-if="visibleRoots.length" class="graph-list" aria-label="目录节点图">
      <section v-for="folder in visibleRoots" :key="`${revision}:${folder.path}`" class="graph-canvas" :aria-label="`${nameOf(folder)} 的目录节点图`">
        <FolderTreeNode root :path="folder.path" :name="nameOf(folder)" :moving-path="movingPath" :query="query" :focus-path="selectedRootPath === focusedRoot?.path || !embedded ? focusPath : ''"
          @changed="revision++; emit('changed')" @start-move="movingPath = $event" @cancel-move="movingPath = ''" @move="moveFolder" @opened="emit('opened', $event)" />
      </section>
    </div>
    <div v-else class="overview-empty"><FolderOutlined /><h2>添加你的第一个文件夹</h2><p>之后可以在节点图中创建真实的子目录，按你的分类方式整理媒体。</p><a-button type="primary" :disabled="global.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined />添加文件夹</a-button></div>
    <p v-if="isTauri && roots.length && !embedded" class="folder-drop-hint">也可以将资源管理器中的文件夹拖入此页添加到媒体库。</p>
  </div>
</template>

<style scoped>
.folder-overview{height:100%;overflow:auto;background:var(--zp-primary-background);padding:18px 24px 32px}
.folder-overview.embedded{height:auto;max-height:calc(100vh - 180px);padding:4px 0 12px}
.folder-tools{display:flex;align-items:center;gap:8px;flex:1;min-width:0}.embedded .folder-tools{margin-bottom:16px}
.folder-root-picker{display:flex;align-items:center;gap:8px;min-width:0;color:var(--zp-secondary);font-size:12px;white-space:nowrap}.folder-root-picker select{max-width:230px;min-width:130px;height:36px;padding:0 28px 0 10px;border:1px solid var(--zp-border);border-radius:7px;background:var(--zp-secondary-background);color:var(--zp-primary);font:inherit;cursor:pointer}.folder-root-picker select:focus-visible{outline:2px solid var(--primary-color);outline-offset:1px}
.folder-search{display:flex;align-items:center;gap:10px;flex:1;min-width:0;height:36px;padding:0 12px;border:1px solid var(--zp-border);border-radius:7px;background:var(--zp-secondary-background);color:var(--zp-secondary)}
.folder-search:focus-within{border-color:var(--primary-color)}.folder-search input{flex:1;min-width:0;outline:0;border:0;background:none;color:var(--zp-primary);font:inherit;font-size:13px}.folder-search button{border:0;background:none;color:inherit;cursor:pointer}
.overview-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.overview-heading h2{font-size:19px;margin:0 0 5px}.overview-heading p,.overview-heading>span,.search-hint,.folder-drop-hint{font-size:12px;color:var(--zp-secondary);margin:0}.overview-heading>span{white-space:nowrap}
.graph-list{display:flex;flex-direction:column;gap:18px}.graph-canvas{display:flex;justify-content:safe center;min-height:158px;overflow:auto;padding:22px 28px 26px;border:1px solid var(--zp-border);border-radius:14px;background:radial-gradient(circle at 1px 1px,var(--zp-border) 1px,transparent 0) 0 0/18px 18px,var(--zp-secondary-background)}
.move-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;margin-bottom:15px;border:1px solid var(--primary-color);border-radius:9px;background:var(--primary-color-1);font-size:12px}.move-banner button{border:0;background:none;color:var(--primary-color);cursor:pointer;white-space:nowrap}
.search-hint{margin-bottom:12px}.folder-drop-hint{margin-top:14px}.overview-empty{display:flex;align-items:center;flex-direction:column;justify-content:center;min-height:300px;padding:40px 16px;text-align:center}.overview-empty>.anticon{font-size:42px;color:var(--primary-color)}.overview-empty h2{font-size:20px;margin:18px 0 8px}.overview-empty p{color:var(--zp-secondary);font-size:13px}
@media(max-width:650px){.folder-overview{padding-inline:12px}.overview-heading{align-items:flex-start;flex-direction:column}.graph-canvas{justify-content:flex-start}.embedded .folder-tools{flex-wrap:wrap}.folder-root-picker{width:100%}.folder-root-picker select{flex:1;max-width:none}}
</style>
