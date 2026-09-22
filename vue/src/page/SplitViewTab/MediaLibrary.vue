<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/index.css'
import fileItemCell from '@/components/FileItem.vue'
import ContextMenu from '@/components/ContextMenu.vue'
import fullScreenContextMenu from '@/page/fileTransfer/fullScreenContextMenu.vue'
import { FolderOutlined, PictureOutlined, PlusOutlined, SearchOutlined, ReloadOutlined, PlayCircleOutlined, LeftCircleOutlined, RightCircleOutlined, EllipsisOutlined } from '@ant-design/icons-vue'
import { getDbBasicInfo, getImagesBySubstr, updateImageData, type DataBaseBasicInfo } from '@/api/db'
import { useGlobalStore } from '@/store/useGlobalStore'
import { createImageSearchIter, useImageSearch } from '@/page/TagSearch/hook'
import { useKeepMultiSelect } from '@/page/fileTransfer/hook'
import { openTiktokViewWithFiles } from '@/util/tiktokHelper'
import { toImageUrl, useGlobalEventListen } from '@/util'
import { addToExtraPath, onAliasExtraPathClick, onRemoveExtraPathClick } from './extraPathControlFunc'
import { navigate, similarityRequest } from './navigation'
import { useSimilaritySearch } from './useSimilaritySearch'
const props = defineProps<{ tabIdx:number; paneIdx:number; referencePath?:string; section?:'all'|'image'|'video'|'folders'; popAddPathModal?:{path:string; type:import('@/api/db').ExtraPathType} }>()
const g = useGlobalStore()
const folders = computed(() => g.conf?.extra_paths ?? [])
const keyword = ref('')
const imageChooser = ref<HTMLInputElement>()
const { reference, minimum, loading: searching, error: searchError, result: similarResult, clear: clearSimilarity, search: searchSimilar, chooseFile, choosePath } = useSimilaritySearch()
const similarityScores = computed(() => new Map(similarResult.value?.files.map(file => [file.fullpath, file.similarity])))
function searchWithImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) chooseFile(file)
  input.value = ''
}
function dropSearchImage(event: DragEvent) {
  const file = event.dataTransfer?.files[0]
  if (file) chooseFile(file)
}
const queryText = ref('')
const busy = ref(false)
let reloadPending = false
const error = ref('')
const info = ref<DataBaseBasicInfo>()
const libraryIter = createImageSearchIter(cursor => getImagesBySubstr({ cursor, surstr:queryText.value, regexp:'', media_type:props.section === 'image' || props.section === 'video' ? props.section : 'all', size:100 }))
const iter = reactive({
  get res() { return reference.value ? similarResult.value?.files ?? [] : libraryIter.res },
  get load() { return reference.value ? true : libraryIter.load },
  next: () => reference.value ? Promise.resolve(false) : libraryIter.next()
})
const { images, stackViewEl, previewIdx, previewing, onPreviewVisibleChange, previewImgMove, canPreview, itemSize, gridItems, showGenInfo, imageGenInfo, multiSelectedIdxs, onFileItemClick, scroller, showMenuIdx, onFileDragStart, onFileDragEnd, cellWidth, onScroll, onContextMenuClickU, props:upstream, changeIndchecked, seedChangeChecked, getGenDiff, getGenDiffWatchDep } = useImageSearch(iter)
const { onClearAllSelected, onSelectAll, onReverseSelect } = useKeepMultiSelect()
watch(() => [props.tabIdx,props.paneIdx], () => { upstream.value = props }, { immediate:true })
let normalScrollIndex = 0
watch(() => !!reference.value, async active => {
  if (active) normalScrollIndex = scroller.value?.findItemIndex(scroller.value.getScroll().start) ?? 0
  multiSelectedIdxs.value = []
  previewIdx.value = 0
  await nextTick()
  scroller.value?.scrollToItem(active ? 0 : normalScrollIndex)
  onScroll()
})
watch(similarResult, async () => {
  if (!reference.value) return
  multiSelectedIdxs.value = []
  previewIdx.value = 0
  await nextTick()
  scroller.value?.scrollToItem(0)
  onScroll()
})
watch(similarityRequest, request => {
  if (!request || request.paneKey !== g.tabList[props.tabIdx]?.panes[props.paneIdx]?.key) return
  choosePath(request.path)
  similarityRequest.value = undefined
}, {immediate: true})
watch(() => props.referencePath, path => { if (path) choosePath(path) }, {immediate: true})
function searchText() { clearSimilarity(); void reload() }
function refreshSearch() { if (reference.value) void searchSimilar(); else void reload() }
async function reload(scan=false) {
  if (busy.value) { reloadPending = true; return }
  busy.value=true; error.value=''
  try {
    if (scan) await updateImageData()
    info.value=await getDbBasicInfo()
    if (props.section !== 'folders') {
      multiSelectedIdxs.value=[]
      queryText.value=keyword.value.trim()
      await libraryIter.reset({refetch:true})
      if (scan && reference.value) await searchSimilar()
      await nextTick()
      scroller.value?.scrollToItem(0)
      onScroll()
    }
  } catch (e) { error.value=e instanceof Error ? e.message : '加载失败，请重试' }
  finally {
    busy.value=false
    if (reloadPending) { reloadPending=false; void reload() }
  }
}
onMounted(() => { reload(); if(props.popAddPathModal) addToExtraPath(props.popAddPathModal.type,props.popAddPathModal.path) })
useGlobalEventListen('updateGlobalSettingDone', () => reload())
useGlobalEventListen('searchIndexExpired', () => { if(info.value) info.value.expired=true })
function openFolder(path:string) { navigate('local',{path,mode:'scanned-fixed'}) }
</script>
<template>
 <div class="library" :ref="el => { stackViewEl = el as HTMLDivElement }">
  <template v-if="section === 'folders'">
   <div class="library-toolbar"><span class="result-count">{{ folders.length }} 个已添加的文件夹</span><span class="grow"/><a-button @click="navigate('local', {path:g.conf?.home,mode:'scanned-fixed'})"><FolderOutlined /> 浏览本机目录</a-button></div>
   <div v-if="folders.length" class="folder-grid">
    <article v-for="folder in folders" :key="folder.path" class="folder-card">
     <button class="folder-open" @click="openFolder(folder.path)"><span class="folder-art"><FolderOutlined /></span><strong>{{ folder.alias || folder.path.split(/[\\/]/).filter(Boolean).pop() }}</strong><small :title="folder.path">{{ folder.path }}</small></button>
     <div class="folder-actions"><a-button type="text" @click="navigate('local',{path:folder.path,mode:'walk'})">查看全部内容</a-button><a-dropdown :trigger="['click']"><a-button type="text" aria-label="文件夹管理"><EllipsisOutlined /></a-button><template #overlay><a-menu><a-menu-item @click="onAliasExtraPathClick(folder.path)">重命名显示名称</a-menu-item><a-menu-item v-for="kind in folder.types.filter(t => t !== 'cli_access_only')" :key="kind" @click="onRemoveExtraPathClick(folder.path,kind)">移除此浏览入口（保留磁盘文件）</a-menu-item></a-menu></template></a-dropdown></div>
    </article>
   </div>
  </template>
  <template v-else>
   <div class="library-toolbar"><form class="library-search" @submit.prevent="searchText" @dragover.prevent @drop.prevent="dropSearchImage"><SearchOutlined /><input v-model="keyword" aria-label="搜索媒体库" :placeholder="reference ? '输入文字可切换搜索' : '搜索媒体，或拖入图片'" /><button type="submit">搜索</button><button type="button" class="image-search-button" aria-label="搜图：选择参考图片" title="选择图片，按画面相似度搜索" @click="imageChooser?.click()"><PictureOutlined /> 搜图</button><input ref="imageChooser" class="image-search-input" type="file" accept=".png,.jpg,.jpeg,.webp,.avif,.bmp,.gif,.jpe" aria-label="搜索框参考图片" @change="searchWithImage" /></form><span class="grow"/><a-button :disabled="!images.length" @click="openTiktokViewWithFiles(images,0)"><PlayCircleOutlined /> 逐张查看</a-button><a-button :loading="busy || searching" @click="refreshSearch"><ReloadOutlined /> 刷新</a-button></div>
   <div v-if="reference" class="image-search-filter" aria-label="图片搜索条件">
    <img v-if="reference.preview" :src="reference.preview" alt="搜图参考图片" />
    <div class="reference-caption"><strong>以图搜图</strong><span :title="reference.name">{{ reference.name }}</span></div>
    <label class="similarity-threshold">最低相似分 <input v-model.number="minimum" aria-label="最低相似分" type="range" min="0" max="100" step="5" @change="searchSimilar" /><b>{{ minimum }}</b></label>
    <a-button type="text" @click="imageChooser?.click()">更换图片</a-button>
    <a-button @click="clearSimilarity">清除搜图</a-button>
   </div>
   <div class="library-meta"><span v-if="reference" role="status">{{ searching ? '正在本机查找相似图片…' : `相似图片 ${images.length} 项 · 按相似分从高到低排列` }}<template v-if="similarResult"> · 已比较 {{ similarResult.checked }} 张<span v-if="similarResult.matched > 100"> · 仅显示前 100 项</span></template></span><span v-else>媒体库共 {{ info?.img_count ?? 0 }} 项<span v-if="images.length"> · 已显示 {{ images.length }} 项</span></span><a-button v-if="images.length" size="small" :type="g.keepMultiSelect ? 'primary' : 'default'" @click="g.keepMultiSelect = !g.keepMultiSelect; multiSelectedIdxs = []">{{ g.keepMultiSelect ? '结束选择' : '选择文件' }}</a-button><label v-if="images.length" class="size-control">缩略图 <input aria-label="缩略图大小" type="range" min="96" max="384" step="16" v-model.number="cellWidth" /></label><a-button v-if="folders.length" type="text" :disabled="busy || g.conf?.is_readonly" @click="reload(true)">扫描新增文件</a-button></div>
   <a-alert v-if="info?.expired && folders.length" class="index-notice" type="info" show-icon message="文件夹内容有变化，扫描后即可在媒体库中查找新增文件。" />
   <MultiSelectKeep :show="!!multiSelectedIdxs.length || g.keepMultiSelect" @clear-all-selected="onClearAllSelected" @select-all="onSelectAll" @reverse-select="onReverseSelect" />
   <div v-if="multiSelectedIdxs.length" class="selection-actions"><span>已选择 {{ multiSelectedIdxs.length }} 项</span><a-dropdown :trigger="['click']"><a-button>操作选中文件 <EllipsisOutlined /></a-button><template #overlay><ContextMenu :file="images[multiSelectedIdxs[0]]" :idx="multiSelectedIdxs[0]" :selected-tag="[]" :is-selected-mutil-files="multiSelectedIdxs.length > 1" @context-menu-click="onContextMenuClickU" /></template></a-dropdown></div>
      <RecycleScroller
        :ref="(el) => { scroller = el as any }"
        class="file-list"
        v-if="images?.length"
        :items="images"
        :item-size="itemSize.first"
        key-field="fullpath"
        :item-secondary-size="itemSize.second"
        :gridItems="gridItems"
        @scroll="onScroll"
      >
        <template #after>
          <div style="height: 16px;"/>
        </template>
        <template v-slot="{ item: file, index: idx }">
          <div class="media-cell">
          <file-item-cell
            :idx="idx"
            :file="file"
            :cell-width="cellWidth"
            v-model:show-menu-idx="showMenuIdx"
            @dragstart="onFileDragStart"
            @dragend="onFileDragEnd"
            @file-item-click="onFileItemClick"
            @tiktok-view="(_file, idx) => openTiktokViewWithFiles(images, idx)"
            :full-screen-preview-image-url="
              images[previewIdx] ? toImageUrl(images[previewIdx]) : ''
            "
            :selected="multiSelectedIdxs.includes(idx)"
            @context-menu-click="onContextMenuClickU"
            @preview-visible-change="onPreviewVisibleChange"
            :is-selected-mutil-files="multiSelectedIdxs.length > 1"
            :enable-change-indicator="changeIndchecked"
            :seed-change-checked="seedChangeChecked"
            :get-gen-diff="getGenDiff"
            :get-gen-diff-watch-dep="getGenDiffWatchDep"
          />
          <span v-if="reference" class="similarity-score" :style="{bottom: cellWidth <= 160 ? '16px' : '56px'}">相似分 {{ similarityScores.get(file.fullpath) }}</span>
          </div>
        </template>
      </RecycleScroller>

  </template>
  <a-alert v-if="searchError || error" type="error" show-icon :message="searchError || error" class="index-notice"><template #action><a-button @click="refreshSearch">重试</a-button></template></a-alert>
  <div v-else-if="(searching || busy) && !images.length" class="loading-state"><a-spin/><p>{{ reference ? '正在本机比较图片，首次搜图可能需要一点时间…' : '正在读取媒体库…' }}</p></div>
  <div v-else-if="reference && !images.length" class="library-empty"><PictureOutlined /><h2>没有找到相似图片</h2><p>试着降低最低相似分、更换参考图片，或扫描更多图片。</p><a-button @click="clearSimilarity">清除搜图</a-button></div>
  <div v-else-if="section === 'folders' ? !folders.length : !images.length" class="library-empty">
   <div class="empty-illustration" aria-hidden="true"><div class="picture-back"/><div class="picture-front"><PictureOutlined /></div><span class="mini-folder"><FolderOutlined /></span></div>
   <h2>{{ !folders.length ? '从一个文件夹开始' : queryText ? '没有找到匹配的媒体' : '这里还没有媒体文件' }}</h2>
   <p>{{ !folders.length ? '添加图片或视频所在的文件夹，建立你的本地媒体库。' : queryText ? '尝试更短的文件名，或更换搜索词。' : '扫描已添加的文件夹，将图片和视频收录到媒体库。' }}</p>
   <p v-if="!folders.length" class="empty-note">文件留在原来的位置，无需复制或上传。</p>
   <a-button v-if="!folders.length" type="primary" size="large" :disabled="g.conf?.is_readonly" @click="addToExtraPath('walk')"><PlusOutlined /> 添加第一个文件夹</a-button>
   <a-button v-else-if="!queryText" type="primary" :disabled="g.conf?.is_readonly" @click="reload(true)"><ReloadOutlined /> 扫描文件夹</a-button>
   <a-button v-else @click="keyword=''; reload()">清除搜索</a-button>
   <div v-if="!folders.length" class="onboarding-steps"><span><b>1</b> 添加文件夹</span><span><b>2</b> 扫描图片与视频</span><span><b>3</b> 浏览、搜索和整理</span></div>
  </div>
  <a-modal v-model:open="showGenInfo" title="生成信息" :footer="null"><pre class="generation-info">{{ imageGenInfo }}</pre></a-modal>
  <div v-if="previewing" class="preview-switch"><LeftCircleOutlined @click="previewImgMove('prev')" :class="{disable:!canPreview('prev')}"/><RightCircleOutlined @click="previewImgMove('next')" :class="{disable:!canPreview('next')}"/></div>
  <fullScreenContextMenu v-if="previewing && images[previewIdx]" :file="images[previewIdx]" :idx="previewIdx" @context-menu-click="onContextMenuClickU" />
 </div>
</template>
<style scoped lang="scss">
.image-search-filter {display:flex;align-items:center;gap:14px;margin:0 32px 14px;padding:10px 14px;border:1px solid var(--zp-border);border-radius:8px;background:var(--primary-color-1);flex-shrink:0;img{width:44px;height:44px;object-fit:contain;border-radius:4px;background:var(--zp-primary-background);}}
.reference-caption {display:flex;flex-direction:column;gap:3px;min-width:0;max-width:220px;strong{font-size:13px;}span{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--zp-secondary);}}
.similarity-threshold {display:flex;align-items:center;gap:10px;margin-left:auto;font-size:12px;input{width:110px;accent-color:var(--primary-color);}b{width:24px;}}
.media-cell {position:relative;}.similarity-score {position:absolute;bottom:56px;right:16px;pointer-events:none;z-index:1;border-radius:4px;padding:3px 7px;background:#0067c0e6;color:white;font-size:11px;}
.library {height:100%;display:flex;flex-direction:column;min-height:0;background:var(--zp-primary-background);}
.selection-actions {display:flex;gap:16px;align-items:center;padding:8px 32px;color:var(--primary-color);font-size:13px;}
.library-search .image-search-input {position:absolute;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;}
.library-search .image-search-button {white-space:nowrap;border-left:1px solid var(--zp-border);padding-left:10px;}
.library-toolbar {display:flex;align-items:center;gap:10px;padding:20px 32px 14px;flex-shrink:0;}
.grow {flex:1;}.result-count{color:var(--zp-secondary);font-size:13px;}
.library-search {display:flex;align-items:center;gap:10px;max-width:440px;flex:1;background:var(--zp-secondary-background);border:1px solid var(--zp-border);border-radius:6px;padding:7px 12px;color:var(--zp-secondary);input{min-width:0;flex:1;background:transparent;border:0;outline:0;color:var(--zp-primary);font:inherit;}button{background:none;border:0;color:var(--primary-color);cursor:pointer;font:inherit;} &:focus-within{border-color:var(--primary-color);}}
.library-meta{display:flex;align-items:center;gap:16px;padding:0 32px 14px;font-size:12px;color:var(--zp-secondary);flex-shrink:0;}.size-control{display:flex;gap:10px;align-items:center;margin-left:auto;input{width:100px;accent-color:var(--primary-color);}}
.index-notice{margin:0 32px 12px;}.file-list{flex:1;min-height:0;padding:0 24px;overflow:auto;}.loading-state{text-align:center;padding:80px;}
.library-empty{flex:1;min-height:400px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 24px 70px;text-align:center;background:radial-gradient(ellipse at 50% 40%,var(--primary-color-1),transparent 60%);h2{font-size:24px;font-weight:600;margin:24px 0 12px;}p{font-size:14px;color:var(--zp-secondary);margin:0 0 10px;}.empty-note{font-size:12px;margin-bottom:24px;}}
.empty-illustration{height:120px;width:160px;position:relative;}.picture-back{position:absolute;width:120px;height:88px;left:2px;top:10px;border-radius:10px;background:#c9e3fb;transform:rotate(-12deg);border:1px solid #adcfea;}.picture-front{position:absolute;left:22px;top:22px;width:120px;height:88px;border:5px solid var(--zp-primary-background);border-radius:10px;background:#e2f0ff;color:#3585c7;display:grid;place-items:center;font-size:52px;box-shadow:0 10px 30px #0067c019;}.mini-folder{position:absolute;right:0;bottom:0;width:42px;height:42px;border-radius:10px;background:#0067c0;color:white;display:grid;place-items:center;font-size:24px;box-shadow:0 4px 12px #0067c025;}
.onboarding-steps{display:flex;gap:28px;margin-top:48px;color:var(--zp-secondary);font-size:12px;b{display:inline-grid;place-items:center;width:21px;height:21px;border:1px solid var(--zp-border);border-radius:50%;margin-right:8px;font-weight:500;}}
.folder-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;padding:8px 32px 32px;overflow:auto;}.folder-card{border:1px solid var(--zp-border);border-radius:9px;overflow:hidden;}.folder-open{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:24px;width:100%;border:0;background:var(--zp-secondary-background);cursor:pointer;text-align:left;color:var(--zp-primary);strong{font-size:15px;}small{width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--zp-secondary);}}.folder-art{color:#3b8bd2;font-size:42px;}.folder-actions{display:flex;justify-content:space-between;padding:8px;}.generation-info{white-space:pre-wrap;max-height:60vh;overflow:auto;}
@media(max-width:760px){.image-search-filter{margin:0 14px 14px;gap:10px;flex-wrap:wrap;}.similarity-threshold{margin-left:0;}.library-toolbar{padding:14px;flex-wrap:wrap;}.library-search{flex-basis:100%;}.library-meta{padding:0 14px 12px;flex-wrap:wrap;}.onboarding-steps{gap:12px;flex-wrap:wrap;justify-content:center;}.folder-grid{padding:14px;}.library-empty h2{font-size:21px;}}


.library{overflow:auto;min-width:0;}.library-toolbar{flex-wrap:wrap;gap:10px;}.library-toolbar>.grow{display:none;}
.library-search{flex:1 1 340px;max-width:none;min-width:0;min-height:36px;}.library-search>button{flex-shrink:0;white-space:nowrap;}
.library-toolbar>.ant-btn{flex-shrink:0;}.library-meta{flex-wrap:wrap;gap:10px 16px;line-height:1.6;}.library-meta>.size-control{flex-shrink:0;}
.image-search-filter{flex-wrap:wrap;gap:12px;}.reference-caption{flex:1 1 140px;}.similarity-threshold{flex-wrap:wrap;}.image-search-filter>img{flex-shrink:0;}
.library-empty{min-height:260px;flex-shrink:0;padding:32px 24px;}.library-empty h2{line-height:1.4;}.library-empty p{line-height:1.7;}
.selection-actions{flex-wrap:wrap;}.folder-grid{grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr));}.folder-card{min-width:0;}.folder-actions{flex-wrap:wrap;gap:6px;}
.folder-open strong{overflow-wrap:anywhere;}.onboarding-steps{flex-wrap:wrap;justify-content:center;line-height:1.6;}
.library .file-list{min-height:140px;}
@container(max-width:650px){.library-toolbar{padding:16px;}.library-search{flex-basis:100%;}.library-meta{padding:0 16px 14px;}.image-search-filter{margin-inline:16px;}.size-control{margin-left:0;}.library .file-list{padding-inline:8px;}.onboarding-steps{margin-top:24px;}.index-notice{margin-inline:16px;}.loading-state{padding:48px 16px;}}

</style>
