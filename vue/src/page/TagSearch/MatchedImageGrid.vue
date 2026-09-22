<script lang="ts" setup>
import fileItemCell from '@/components/FileItem.vue'
import 'vue-virtual-scroller/index.css'
import { RecycleScroller } from 'vue-virtual-scroller'
import { getImagesByTags, type MatchImageByTagsReq } from '@/api/db'
import { nextTick, watch, ref } from 'vue'
import { copy2clipboardI18n } from '@/util'
import { useImageSearch, createImageSearchIter } from './hook'
import { openRebuildImageIndexModal } from '@/components/functionalCallableComp'
import { useGlobalStore } from '@/store/useGlobalStore'
import { useKeepMultiSelect } from '../fileTransfer/hook'

const props = defineProps<{
  tabIdx: number
  paneIdx: number
  selectedTagIds: MatchImageByTagsReq
  id: string
}>()

// 添加随机排序状态
const randomSort = ref(false)

// 创建搜索迭代器，根据随机排序状态决定参数
const iter = createImageSearchIter(cursor => {
  return getImagesByTags({...props.selectedTagIds, random_sort: randomSort.value}, cursor)
})
const {
  queue,
  images,
  onContextMenuClickU,
  stackViewEl,
  openPreview,
  itemSize,
  gridItems,
  showGenInfo,
  imageGenInfo,
  q: genInfoQueue,
  multiSelectedIdxs,
  onFileItemClick,
  scroller,
  showMenuIdx,
  onFileDragStart,
  onFileDragEnd,
  cellWidth,
  onScroll,
  saveAllFileAsJson,
  props: propsUpstream,
  saveLoadedFileAsJson,
  changeIndchecked,
  seedChangeChecked,
  getGenDiff,
  getGenDiffWatchDep
} = useImageSearch(iter)

watch(
  () => props.selectedTagIds,
  async () => {
    await iter.reset()
    await nextTick()
    scroller.value?.scrollToItem(0)
    onScroll() // 重新获取
  },
  { immediate: true }
)

// 监听随机排序状态变化
watch(
  randomSort,
  async () => {
    await iter.reset()
    await nextTick()
    scroller.value?.scrollToItem(0)
    onScroll() // 重新获取
  }
)

watch(
  () => props,
  async (v) => {
    propsUpstream.value = v
  },
  { deep: true, immediate: true}
)

const g = useGlobalStore()
const { onClearAllSelected, onSelectAll, onReverseSelect } = useKeepMultiSelect()

// TikTok View 按钮点击处理
const onTiktokViewClick = () => {
  if (images.value.length === 0) {
    return
  }
  // 从第一张图片开始播放
  openPreview(0)
}
</script>
<template>
  <div class="container workspace-pane" :ref="(el) => { stackViewEl = el as HTMLDivElement }">

    <MultiSelectKeep :show="!!multiSelectedIdxs.length || g.keepMultiSelect"
      @clear-all-selected="onClearAllSelected" @select-all="onSelectAll" @reverse-select="onReverseSelect"/>
    <ASpin size="large" :spinning="!queue.isIdle">
      <AModal v-model:open="showGenInfo" width="70vw" mask-closable @ok="showGenInfo = false">
        <template #cancelText />
        <ASkeleton active :loading="!genInfoQueue.isIdle">
          <div
            style="
              width: 100%;
              word-break: break-all;
              white-space: pre-line;
              max-height: 70vh;
              overflow: auto;
            "
            @dblclick="copy2clipboardI18n(imageGenInfo)"
          >
            <div class="hint">{{ $t('doubleClickToCopy') }}</div>
            {{ imageGenInfo }}
          </div>
        </ASkeleton>
      </AModal>
      <div class="action-bar">
        <a-switch v-model:checked="randomSort" :checked-children="$t('randomSort')" :un-checked-children="$t('sortByDate')" />
        <a-button @click="onTiktokViewClick" :disabled="!images?.length">{{ $t('tiktokView') }}</a-button>
        <a-button @click="saveLoadedFileAsJson">{{ $t('saveLoadedImageAsJson') }}</a-button>
        <a-button @click="saveAllFileAsJson">{{ $t('saveAllAsJson') }}</a-button>

      </div>
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
          <div style="height: 24px;"/>
        </template>
        <template v-slot="{ item: file, index: idx }">
          <file-item-cell
            :idx="idx"
            :file="file"
            :cell-width="cellWidth"
            v-model:show-menu-idx="showMenuIdx"
            @dragstart="onFileDragStart"
            @dragend="onFileDragEnd"
            @file-item-click="onFileItemClick"
            @tiktok-view="(_file, idx) => openPreview(idx)"
            :selected="multiSelectedIdxs.includes(idx)"
            @context-menu-click="onContextMenuClickU"
            :is-selected-mutil-files="multiSelectedIdxs.length > 1"
            :enable-change-indicator="changeIndchecked"
            :seed-change-checked="seedChangeChecked"
            :get-gen-diff="getGenDiff"
            :get-gen-diff-watch-dep="getGenDiffWatchDep"
          />
        </template>
      </RecycleScroller>
      <div v-else-if="iter.load && selectedTagIds.and_tags.length === 1 && !selectedTagIds.folder_paths_str?.trim()">
        <div class="no-res-hint">
          <p class="hint">{{ $t('tagSearchNoResultsMessage') }}</p>
          <AButton @click="openRebuildImageIndexModal()" type="primary">{{ $t('rebuildImageIndex') }}</AButton>
        </div>
      </div>

    </ASpin>

  </div>
</template>
<style scoped lang="scss">
.container {
  background: var(--zp-secondary-background);
  position: relative;
  .action-bar {
    display: flex;
    align-items: center;
    user-select: none;
    gap: 4px;
    padding: 4px;
    &>* {
      flex-wrap: wrap;
    }
  }

  .file-list {
    list-style: none;
    padding: 8px;
    overflow: auto;
    height: calc(var(--pane-max-height) - 40px);
    width: 100%;
  }
  .no-res-hint {
    height: var(--pane-max-height);
    display: flex;
    align-items: center;
    flex-direction: column;
    justify-content: center;
    .hint {
      font-size: 1.6em;
      margin-bottom: 2em;
      text-align: center;
    }
  }
}

.container .actions-panel,.container .action-bar{flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:16px 24px;}
.container .file-list{height:auto;min-height:120px;flex:1;}
.container .no-res-hint{height:auto;min-height:220px;flex:1;padding:32px 24px;}.container .no-res-hint .hint{font-size:15px;line-height:1.8;}
.container .file-list .hint{max-width:600px;margin:0 auto;padding:64px 24px;font-size:15px;line-height:1.8;color:var(--zp-secondary);}

</style>
