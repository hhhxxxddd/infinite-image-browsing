<script lang="ts" setup>
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/index.css'
import FileItem from '@/components/FileItem.vue'
import { useFilesDisplay, useHookShareState } from '@/page/fileTransfer/hook'
import { getFileTransferDataFromDragEvent, toImageUrl, uniqueFile } from '@/util/file'
import { ref, watchEffect, toRaw } from 'vue'
import { GridViewFile, useGlobalStore } from '@/store/useGlobalStore'
import { useTagStore } from '@/store/useTagStore'

const g = useGlobalStore()
const { stackViewEl, scroller } = useHookShareState().toRefs()
const { itemSize, gridItems, cellWidth } = useFilesDisplay()
const tag = useTagStore()

const props = defineProps<{
  tabIdx: number
  paneIdx: number
  id: string,
  removable?: boolean
  allowDragAndDrop?: boolean,
  files: GridViewFile[]
  paneKey: string
}>()


const files = ref(props.files ?? [])
const onDrop = async (e: DragEvent) => {
  const data = getFileTransferDataFromDragEvent(e)
  if (props.allowDragAndDrop && data) {
    files.value = uniqueFile([...files.value, ...data.nodes])
  }
}

const onDeleteClick = (idx: number) => {
  files.value.splice(idx, 1)
}


watchEffect(() => {
  g.pageFuncExportMap.set(props.paneKey, {
    getFiles: () => toRaw(files.value),
    setFiles: (_files: GridViewFile[]) => files.value = _files
  })
})

</script>
<template>
  <div class="container workspace-pane" :ref="(el) => { stackViewEl = el as HTMLDivElement }" @drop="onDrop">
    <RecycleScroller :ref="(el) => { scroller = el as any }" class="file-list" :items="files.slice()" :item-size="itemSize.first"
      key-field="fullpath" :item-secondary-size="itemSize.second" :gridItems="gridItems">
      <template v-slot="{ item: file, index: idx }">
        <file-item :idx="idx" :file="file" :cell-width="cellWidth" :enable-close-icon="props.removable"
          @close-icon-click="onDeleteClick(idx)" :full-screen-preview-image-url="toImageUrl(file)"
          :extra-tags="file?.tags?.map(tag.tagConvert)" :enable-right-click-menu="false" />
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
.container{background:var(--ui-canvas);}
.container .file-list{padding:16px;}

</style>
