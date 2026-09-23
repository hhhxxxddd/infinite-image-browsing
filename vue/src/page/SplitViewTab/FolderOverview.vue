<script setup lang="ts">
import { computed, ref } from 'vue'
import { FolderOutlined, SearchOutlined, ReloadOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons-vue'
import { Modal, message } from 'ant-design-vue'
import { checkPathExists } from '@/api'
import { updateImageData } from '@/api/db'
import { moveFiles } from '@/api/files'
import { useGlobalStore } from '@/store/useGlobalStore'
import { globalEvents } from '@/util'
import { addToExtraPath } from './extraPathControlFunc'
import { topLevelManagedFolders } from './folderScope'
import { folderMoveTarget } from './folderMove'
import FolderTreeNode from './FolderTreeNode.vue'
import { isTauri } from '@/util/env'
import { directoryFocusRequest } from './navigation'

const global = useGlobalStore()
const query = ref('')
const revision = ref(0)
const movingPath = ref('')
const folders = computed(() => (global.conf?.extra_paths ?? []).filter(folder => folder.types.some(type => type !== 'cli_access_only')))
const roots = computed(() => topLevelManagedFolders(folders.value, global.conf?.is_win))
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
      globalEvents.emit('searchIndexExpired')
      void updateImageData().catch(() => message.warning('文件夹已移动，请稍后手动刷新媒体索引'))
      message.success('文件夹已移动')
    }
  })
}
</script>

<template>
  <div class="folder-overview">
    <Teleport to="#media-header-search">
      <div class="folder-search"><SearchOutlined /><input v-model="query" aria-label="高亮目录节点" placeholder="查找目录名称或路径" /><button v-if="query" aria-label="清除目录搜索" @click="query = ''">×</button></div>
      <a-button type="text" title="刷新目录" aria-label="刷新目录" @click="revision++"><ReloadOutlined /></a-button>
    </Teleport>
    <div class="overview-heading"><div><h2>目录地图</h2><p>点击节点打开标签页 · 在节点上创建、移动或删除空目录</p></div><span>{{ folders.length }} 个已添加的文件夹</span></div>
    <div v-if="movingPath" class="move-banner"><span>正在移动 <strong>{{ baseName(movingPath) }}</strong>：点击目标节点，或将此节点拖到目标上</span><button @click="movingPath = ''"><CloseOutlined /> 取消</button></div>
    <p v-if="query" class="search-hint">匹配的节点已高亮；所有目录仍可用于移动和分类。</p>
    <div v-if="roots.length" class="graph-list" aria-label="目录节点图">
      <section v-for="folder in roots" :key="`${revision}:${folder.path}`" class="graph-canvas" :aria-label="`${nameOf(folder)} 的目录节点图`">
        <FolderTreeNode root :path="folder.path" :name="nameOf(folder)" :moving-path="movingPath" :query="query" :focus-path="directoryFocusRequest"
          @changed="revision++" @start-move="movingPath = $event" @cancel-move="movingPath = ''" @move="moveFolder" />
      </section>
    </div>
    <div v-else class="overview-empty"><FolderOutlined /><h2>添加你的第一个文件夹</h2><p>之后可以在节点图中创建真实的子目录，按你的分类方式整理媒体。</p><a-button type="primary" :disabled="global.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined />添加文件夹</a-button></div>
    <p v-if="isTauri && roots.length" class="folder-drop-hint">也可以将资源管理器中的文件夹拖入此页添加到媒体库。</p>
  </div>
</template>

<style scoped>
.folder-overview{height:100%;overflow:auto;background:var(--zp-primary-background);padding:18px 24px 32px}
.folder-search{display:flex;align-items:center;gap:10px;flex:1;min-width:0;height:36px;padding:0 12px;border:1px solid var(--zp-border);border-radius:7px;background:var(--zp-secondary-background);color:var(--zp-secondary)}
.folder-search:focus-within{border-color:var(--primary-color)}.folder-search input{flex:1;min-width:0;outline:0;border:0;background:none;color:var(--zp-primary);font:inherit;font-size:13px}.folder-search button{border:0;background:none;color:inherit;cursor:pointer}
.overview-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.overview-heading h2{font-size:19px;margin:0 0 5px}.overview-heading p,.overview-heading>span,.search-hint,.folder-drop-hint{font-size:12px;color:var(--zp-secondary);margin:0}.overview-heading>span{white-space:nowrap}
.graph-list{display:flex;flex-direction:column;gap:18px}.graph-canvas{display:flex;justify-content:safe center;min-height:158px;overflow:auto;padding:22px 28px 26px;border:1px solid var(--zp-border);border-radius:14px;background:radial-gradient(circle at 1px 1px,var(--zp-border) 1px,transparent 0) 0 0/18px 18px,var(--zp-secondary-background)}
.move-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;margin-bottom:15px;border:1px solid var(--primary-color);border-radius:9px;background:var(--primary-color-1);font-size:12px}.move-banner button{border:0;background:none;color:var(--primary-color);cursor:pointer;white-space:nowrap}
.search-hint{margin-bottom:12px}.folder-drop-hint{margin-top:14px}.overview-empty{display:flex;align-items:center;flex-direction:column;justify-content:center;min-height:300px;padding:40px 16px;text-align:center}.overview-empty>.anticon{font-size:42px;color:var(--primary-color)}.overview-empty h2{font-size:20px;margin:18px 0 8px}.overview-empty p{color:var(--zp-secondary);font-size:13px}
@media(max-width:650px){.folder-overview{padding-inline:12px}.overview-heading{align-items:flex-start;flex-direction:column}.graph-canvas{justify-content:flex-start}}
</style>
