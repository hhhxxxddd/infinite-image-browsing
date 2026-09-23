<script setup lang="ts">
import { computed, ref } from 'vue'
import { FolderOutlined, SearchOutlined, ReloadOutlined, PlusOutlined } from '@ant-design/icons-vue'
import { useGlobalStore } from '@/store/useGlobalStore'
import { addToExtraPath } from './extraPathControlFunc'
import { topLevelManagedFolders } from './folderScope'
import FolderTreeNode from './FolderTreeNode.vue'
import { isTauri } from '@/util/env'
const global = useGlobalStore()
const query = ref('')
const revision = ref(0)
const folders = computed(() => (global.conf?.extra_paths ?? []).filter(folder => folder.types.some(type => type !== 'cli_access_only')))
const roots = computed(() => topLevelManagedFolders(folders.value,global.conf?.is_win))
const shown = computed(() => roots.value.filter(folder => `${folder.alias ?? ''} ${folder.path}`.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())))
const nameOf = (folder:{path:string;alias?:string}) => folder.alias || folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path
</script>

<template>
  <div class="folder-overview">
    <Teleport to="#media-header-search">
      <div class="folder-search"><SearchOutlined /><input v-model="query" aria-label="查找已添加的文件夹" placeholder="查找文件夹名称或路径" /><button v-if="query" aria-label="清除文件夹搜索" @click="query = ''">×</button></div>
      <a-button type="text" title="刷新文件夹" aria-label="刷新文件夹" @click="revision++"><ReloadOutlined /></a-button>
    </Teleport>
    <div class="overview-heading"><strong>文件夹</strong><span>{{ query ? `${shown.length} / ${folders.length}` : folders.length }} 个已添加</span><span v-if="isTauri" class="folder-drop-hint">可将资源管理器中的文件夹拖到此页添加</span></div>
    <div v-if="shown.length" class="folder-rows" aria-label="文件夹层级">
      <FolderTreeNode v-for="folder in shown" :key="`${revision}:${folder.path}`" root :path="folder.path" :name="nameOf(folder)" />
    </div>
    <div v-else class="overview-empty"><FolderOutlined /><h2>{{ folders.length ? '没有匹配的文件夹' : '添加你的第一个文件夹' }}</h2><p>{{ folders.length ? '试试其他名称或路径。' : '添加图片或视频所在的文件夹，开始收集与整理。' }}</p><a-button v-if="folders.length" @click="query = ''">清除搜索</a-button><a-button v-else type="primary" :disabled="global.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined />添加文件夹</a-button></div>
  </div>
</template>

<style scoped>
.folder-overview{height:100%;overflow:auto;background:var(--zp-primary-background);padding:0 20px 24px;}
.folder-search{display:flex;align-items:center;gap:10px;flex:1;min-width:0;height:36px;padding:0 12px;border:1px solid var(--zp-border);border-radius:7px;background:var(--zp-secondary-background);color:var(--zp-secondary);}
.folder-search:focus-within{border-color:var(--primary-color);}.folder-search input{flex:1;min-width:0;outline:0;border:0;background:none;color:var(--zp-primary);font:inherit;font-size:13px;}.folder-search button{border:0;background:none;color:inherit;cursor:pointer;}
.overview-heading{display:flex;align-items:center;gap:12px;height:54px;font-size:14px;}.overview-heading>span{font-size:12px;color:var(--zp-secondary);}
.overview-heading .folder-drop-hint{margin-left:auto;}
.folder-rows{display:flex;flex-direction:column;gap:10px;}.folder-row{display:flex;align-items:center;gap:12px;min-width:0;padding:12px;border:1px solid var(--zp-border);border-radius:9px;transition:background .15s;}.folder-row:hover{background:var(--zp-secondary-background);}.folder-row.drop-active{outline:2px dashed var(--primary-color);background:var(--primary-color-1);}
.folder-open{display:flex;align-items:center;gap:14px;flex:1;min-width:0;padding:0;background:none;border:0;color:inherit;text-align:left;cursor:pointer;}.folder-symbol{display:grid;place-items:center;width:44px;height:44px;flex-shrink:0;border-radius:9px;background:var(--primary-color-1);color:var(--primary-color);font-size:25px;}.folder-caption{display:flex;flex-direction:column;gap:5px;min-width:0;}.folder-caption strong{font-size:14px;font-weight:600;}.folder-caption small{font-size:11px;color:var(--zp-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.open-arrow{margin-left:auto;font-size:11px;color:var(--zp-secondary);}.folder-row-actions{display:flex;align-items:center;gap:4px;flex-shrink:0;}
.overview-empty{display:flex;align-items:center;flex-direction:column;justify-content:center;min-height:300px;padding:40px 16px;text-align:center;}.overview-empty>.anticon{font-size:42px;color:var(--primary-color);}.overview-empty h2{font-size:20px;margin:18px 0 8px;}.overview-empty p{color:var(--zp-secondary);font-size:13px;}
@media(max-width:650px){.folder-overview{padding-inline:12px;}.folder-row{flex-wrap:wrap;gap:8px;}.folder-open{flex-basis:100%;}.folder-row-actions{margin-left:auto;}}
</style>
