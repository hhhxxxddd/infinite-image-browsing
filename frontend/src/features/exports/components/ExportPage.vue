<script lang="ts" setup>
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/index.css'
import FileItem from '@/features/media-library/components/FileItem.vue'
import { useBatchDownloadStore } from '@/features/exports/model/useBatchDownloadStore'
import { useApplicationStore } from '@/features/application/public'
import { storeToRefs } from 'pinia'
import { useFilesDisplay, useHookShareState } from '@/features/media-library/public/browser'
import {
  type Scroller,
  getFileTransferDataFromDragEvent,
  toImageUrl
} from '@/features/media-library/public'
import { axiosInst } from '@/shared/api/httpClient'
import { createReactiveQueue } from '@/shared/composables/useReactiveQueue'
import { message } from 'ant-design-vue'
import { t } from '@/shared/i18n/index'
const { stackViewEl, scroller } = useHookShareState().toRefs()
// Vue's generic component ref omits RecycleScroller's documented exposed methods.
const bindScroller = (instance: unknown) => {
  scroller.value = instance ? (instance as Scroller) : undefined
}
const { itemSize, gridItems, cellWidth } = useFilesDisplay()
const gs = useApplicationStore()
const store = useBatchDownloadStore()
const { selectedFiles } = storeToRefs(store)
const q = createReactiveQueue()
defineProps<{
  tabIdx: number
  paneIdx: number
  id: string
}>()
const onDrop = async (e: DragEvent) => {
  const data = getFileTransferDataFromDragEvent(e)
  if (data) {
    store.addFiles(data.nodes)
  }
}

const onDownloadClick = async () => {
  q.pushAction(async () => {
    const resp = await axiosInst.value.post(
      '/zip',
      {
        paths: selectedFiles.value.map((v) => v.fullpath),
        compress: gs.batchDownloadCompress,
        pack_only: false
      },
      {
        responseType: 'blob'
      }
    )

    const url = window.URL.createObjectURL(new Blob([resp.data]))
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `omnigallery_${new Date().toLocaleString()}.zip`)
    document.body.appendChild(link)
    link.click()
  })
}

const onPackClick = async () => {
  q.pushAction(async () => {
    await axiosInst.value.post(
      '/zip',
      {
        paths: selectedFiles.value.map((v) => v.fullpath),
        compress: gs.batchDownloadCompress,
        pack_only: true
      },
      {
        responseType: 'blob'
      }
    )
    message.success(t('success'))
  })
}

const onDeleteClick = (idx: number) => {
  selectedFiles.value.splice(idx, 1)
}
</script>
<template>
  <div
    class="container workspace-pane"
    :ref="
      (el) => {
        stackViewEl = el ? (el as HTMLDivElement) : undefined
      }
    "
    @dragover.prevent
    @drop.prevent="onDrop"
  >
    <div class="actions-panel actions">
      <div class="batch-heading">
        <strong>导出列表</strong><span>整理好文件后，选择下载或保存到归档目录。</span>
      </div>
      <AButton @click="store.selectedFiles = []">{{ $t('clear') }}</AButton>
      <div class="item">
        {{ $t('compressFile') }}: <ASwitch v-model:checked="gs.batchDownloadCompress" />
      </div>
      <AButton
        :disabled="!selectedFiles.length"
        @click="onPackClick"
        type="primary"
        :loading="!q.isIdle"
        >{{ $t('packOnlyNotDownload') }}</AButton
      >
      <AButton
        :disabled="!selectedFiles.length"
        @click="onDownloadClick"
        type="primary"
        :loading="!q.isIdle"
        >{{ $t('zipDownload') }}</AButton
      >
    </div>
    <div v-if="!selectedFiles.length" class="file-list empty-list">
      <p class="hint">
        从媒体库的文件菜单选择“添加到导出列表”，或将文件拖到这里。支持一次添加多项。
      </p>
    </div>
    <RecycleScroller
      :ref="bindScroller"
      v-else
      class="file-list"
      :items="selectedFiles.slice()"
      :item-size="itemSize.first"
      key-field="fullpath"
      :item-secondary-size="itemSize.second"
      :gridItems="gridItems"
    >
      <template v-slot="{ item: file, index: idx }">
        <file-item
          :idx="idx"
          :file="file"
          :cell-width="cellWidth"
          enable-close-icon
          @close-icon-click="onDeleteClick(idx)"
          :full-screen-preview-image-url="toImageUrl(file)"
          :enable-right-click-menu="false"
        />
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
    &.actions {
      display: flex;
      align-items: center;
      gap: 16px;
      z-index: 333;
    }
  }

  .file-list {
    flex: 1;
    z-index: 222;
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

.container .actions-panel,
.container .action-bar {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 16px 24px;
}
.container .file-list {
  height: auto;
  min-height: 120px;
  flex: 1;
}
.container .no-res-hint {
  height: auto;
  min-height: 220px;
  flex: 1;
  padding: 32px 24px;
}
.container .no-res-hint .hint {
  font-size: 15px;
  line-height: 1.8;
}
.container .file-list .hint {
  max-width: 600px;
  margin: 0 auto;
  padding: 64px 24px;
  font-size: 15px;
  line-height: 1.8;
  color: var(--zp-secondary);
}

.container .actions-panel.actions {
  z-index: auto;
}
.container .file-list {
  z-index: auto;
}
.item {
  display: flex;
  gap: 8px;
  align-items: center;
}
.container {
  background: var(--ui-canvas);
}
.container .actions-panel.actions {
  padding: 14px 24px;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-surface);
  gap: 8px;
}
.batch-heading {
  display: flex;
  flex: 1;
  min-width: 200px;
  flex-direction: column;
  gap: 2px;
}
.batch-heading strong {
  color: var(--ui-text);
  font-size: 15px;
  font-weight: 600;
}
.batch-heading span {
  color: var(--ui-muted);
  font-size: 12px;
}
.container .actions-panel :deep(.ant-btn) {
  min-height: 34px;
  border-radius: var(--ui-radius-sm);
}
.container .empty-list {
  display: grid;
  place-items: center;
  padding: 24px;
}
.container .empty-list .hint {
  width: min(100%, 580px);
  max-width: none;
  padding: 36px;
  text-align: center;
  border: 1px dashed var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface-soft);
  color: var(--ui-muted);
}
@media (max-width: 760px) {
  .container .actions-panel.actions {
    padding: 12px 16px;
  }
  .batch-heading {
    flex-basis: 100%;
  }
}
</style>
