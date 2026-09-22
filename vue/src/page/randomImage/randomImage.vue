<script lang="ts" setup>
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/index.css'
import FileItem from '@/components/FileItem.vue'
import { useFileItemActions, useFilesDisplay, useFileTransfer, useHookShareState, useKeepMultiSelect, usePreview } from '@/page/fileTransfer/hook'
import { ref, onMounted } from 'vue'
import { GridViewFile, useGlobalStore } from '@/store/useGlobalStore'
import { getRandomImages } from '@/api/db'
import { identity } from '@vueuse/core'
import MultiSelectKeep from '@/components/MultiSelectKeep.vue'

import { copy2clipboardI18n } from '@/util'
import { message } from 'ant-design-vue'

const g = useGlobalStore()

defineProps<{
  tabIdx: number
  paneIdx: number
  id: string,
  paneKey: string
}>()

const loading = ref(false)
const files = ref([] as GridViewFile[])

const fetch = async () => {
  try {
    loading.value = true
    const res = await getRandomImages()

    files.value = res
  } finally {
    loading.value = false
    onScroll()
  }
}

// TikTok View 按钮点击处理
const onTiktokViewClick = () => {
  if (files.value.length === 0) {
    message.warn('没有图片可以浏览')
    return
  }
  // 从当前预览索引开始，如果没有预览则从第一张开始
  openPreview(Math.max(0, previewIdx.value))
}

onMounted(() => {
  fetch()
})
const { stackViewEl, multiSelectedIdxs, stack, scroller } = useHookShareState({
  images: files as any
}).toRefs()
const { onClearAllSelected, onSelectAll, onReverseSelect } = useKeepMultiSelect()
useFileTransfer()
const { itemSize, gridItems, cellWidth, onScroll } = useFilesDisplay()
const {
  showGenInfo,
  imageGenInfo,
  q: genInfoQueue,
  onContextMenuClick,
  onFileItemClick
} = useFileItemActions({ openNext: identity as any })
const { openPreview, previewIdx } = usePreview()

const onContextMenuClickU: typeof onContextMenuClick = async (e, file, idx) => {
  stack.value = [{ curr: '', files: files.value! }] // hack，for delete multi files
  await onContextMenuClick(e, file, idx)
}

</script>
<template>
  <div class="container workspace-pane" :ref="(el) => { stackViewEl = el as HTMLDivElement }">
    <MultiSelectKeep :show="!!multiSelectedIdxs.length || g.keepMultiSelect" @clear-all-selected="onClearAllSelected"
      @select-all="onSelectAll" @reverse-select="onReverseSelect" />
    <div class="refresh-button">
      <a-button
        @click="fetch"
        @touchstart.prevent="fetch"
        type="primary"
        :loading="loading"
        shape="round"
      >
        {{ $t('shuffle') }}
      </a-button>
      <a-button
        @click="onTiktokViewClick"
        @touchstart.prevent="onTiktokViewClick"
        type="default"
        :disabled="!files?.length"
        shape="round"
      >
        {{ $t('tiktokView') }}
      </a-button>
    </div>

    <AModal v-model:open="showGenInfo" width="70vw" mask-closable @ok="showGenInfo = false">
      <template #cancelText />
      <ASkeleton active :loading="!genInfoQueue.isIdle">
        <div style="
              width: 100%;
              word-break: break-all;
              white-space: pre-line;
              max-height: 70vh;
              overflow: auto;
            " @dblclick="copy2clipboardI18n(imageGenInfo)">
          <div class="hint">{{ $t('doubleClickToCopy') }}</div>
          {{ imageGenInfo }}
        </div>
      </ASkeleton>
    </AModal>
    <a-empty v-if="!loading && !files.length" description="暂无图片，请先添加文件夹并扫描媒体" class="random-empty" />
    <RecycleScroller v-if="files.length" :ref="(el) => { scroller = el as any }" class="file-list" :items="files.slice()" :item-size="itemSize.first"
      key-field="fullpath" :item-secondary-size="itemSize.second" :gridItems="gridItems" @scroll="onScroll">
      <template v-slot="{ item: file, index: idx }">
        <file-item :idx="idx" :file="file" :cell-width="cellWidth" @context-menu-click="onContextMenuClickU"
          :is-selected-mutil-files="multiSelectedIdxs.length > 1" :selected="multiSelectedIdxs.includes(idx)"
          @file-item-click="onFileItemClick" @tiktok-view="(_file, idx) => openPreview(idx)" />
      </template>
    </RecycleScroller>

  </div>
</template>
<style scoped lang="scss">
.container {
  background: var(--zp-secondary-background);

  height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;

  .actions-panel {
    padding: 8px;
    background-color: var(--zp-primary-background);
  }

  .refresh-button {
    position: absolute;
    top: 90%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 99;
    background: white;
    border-radius: 9999px;
    box-shadow: 0 0 20px var(--zp-secondary);
    padding: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .file-list {
    flex: 1;
    list-style: none;
    padding: 8px;
    height: var(--pane-max-height);
    width: 100%;

    .hint {
      text-align: center;
      font-size: 2em;
      padding: 30vh 128px 0;
    }
  }
}

.container .actions-panel,.container .action-bar{flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:16px 24px;}
.container .file-list{height:auto;min-height:120px;flex:1;}
.container .no-res-hint{height:auto;min-height:220px;flex:1;padding:32px 24px;}.container .no-res-hint .hint{font-size:15px;line-height:1.8;}
.container .file-list .hint{max-width:600px;margin:0 auto;padding:64px 24px;font-size:15px;line-height:1.8;color:var(--zp-secondary);}

.container .refresh-button{position:static;transform:none;display:flex;align-items:center;flex-wrap:wrap;gap:10px;padding:16px 24px;box-shadow:none;border-radius:0;border-bottom:1px solid var(--zp-border);flex-shrink:0;}
.random-empty{margin:64px 24px;}

</style>
