<script setup lang="ts">
import { DownOutlined, ArrowLeftOutlined } from '@/icon'
import { useGlobalStore } from '@/store/useGlobalStore'
import { useTiktokStore } from '@/store/useTiktokStore'
import {
  useFileTransfer,
  useFilesDisplay,
  useHookShareState,
  useLocation,
  usePreview,
  useFileItemActions,
  useMobileOptimization,
  stackCache,
  useKeepMultiSelect,
  Props
} from './hook'
import { SearchSelect } from 'vue3-ts-util'

import 'multi-nprogress/nprogress.css'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/index.css'
import FileItem from '@/components/FileItem.vue'
import BaseFileListInfo from '@/components/BaseFileListInfo.vue'
import { copy2clipboardI18n } from '@/util'
import { openFolder, flattenFolder } from '@/api'
import { sortMethods } from './fileSort'
import { isTauri } from '@/util/env'
import MediaSelectionActions from '@/components/MediaSelectionActions.vue'
import type { MenuInfo } from 'ant-design-vue/lib/menu/src/interface'
import { Modal, message } from 'ant-design-vue'
import { t } from '@/i18n'
import { h, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { normalize } from '@/util/path'
import { MIN_GRID_CELL_WIDTH } from '@/util/mediaCardLayout'

const global = useGlobalStore()
const props = defineProps<{
  tabIdx: number
  paneIdx: number
  /**
   * 初始打开路径
   */
  path?: string
  mode?: Props['mode']
  targetFile?: string
  openPreview?: boolean
  /**
   * 页面栈,跳过不必要的api请求
   */
  stackKey?: string
}>()
const {
  scroller,
  stackViewEl,
  props: _props,
  multiSelectedIdxs,
  spinning
} = useHookShareState().toRefs()
void scroller.value
void stackViewEl.value
const { currLocation, currPage, refresh, copyLocation, back, openNext, stack, quickMoveTo,
  addToSearchScanPathAndQuickMove, locInputValue, isLocationEditing,
  onLocEditEnter, onEditBtnClick, share, selectAll, onCreateFloderBtnClick, onWalkBtnClick,
  showWalkButton, backToLastUseTo, polling, onPollRefreshClick
} = useLocation()
const {
  gridItems,
  sortMethodConv,
  moreActionsDropdownShow,
  sortedFiles,
  sortMethod,
  itemSize,
  loadNextDir,
  loadNextDirLoading,
  canLoadNext,
  onScroll,
  cellWidth,
  dirCoverCache
} = useFilesDisplay()
const { onDrop, onFileDragStart, onFileDragEnd, onFileDropToFolder } = useFileTransfer()
const { onFileItemClick, onContextMenuClick, showGenInfo, imageGenInfo, q } = useFileItemActions({ openNext })
const { openPreview: openMediaPreview, previewIdx, scrollToFileId,scrollToIndex } = usePreview()
const tiktokStore = useTiktokStore()
const { showMenuIdx } = useMobileOptimization()
const { onClearAllSelected, onReverseSelect, onSelectAll } = useKeepMultiSelect()
function selectionAction(key: string) {
  const idx = multiSelectedIdxs.value[0]
  if (sortedFiles.value[idx]) void onContextMenuClick({ key } as MenuInfo, sortedFiles.value[idx], idx)
    .catch((error: any) => message.error(error.response?.data?.detail || '操作失败，请重试'))
}

// 双击空白处返回容易误触，暂时禁用

const onDropToFolder = async (e: DragEvent, file: any) => {
  const handled = await onFileDropToFolder(e, file)
  if (!handled) {
    await onDrop(e)
  }
}

// TikTok View 按钮点击处理
const onTiktokViewClick = () => {
  if (sortedFiles.value.length === 0) {
    return
  }
  // 只传入图片和视频文件，从当前预览索引开始
  openMediaPreview(previewIdx.value || 0)
}

// Flatten folder handler
const flattenFolderLoading = ref(false)
const onFlattenFolderClick = async () => {
  moreActionsDropdownShow.value = false

  // Step 1: Dry run to check for conflicts
  flattenFolderLoading.value = true
  let dryRunResult
  try {
    message.loading({ content: t('flattenFolderScanning'), key: 'flatten', duration: 0 })
    dryRunResult = await flattenFolder({ folder_path: currLocation.value, dry_run: true })
  } catch (e: any) {
    message.destroy('flatten')
    message.error(e.message || String(e))
    flattenFolderLoading.value = false
    return
  }
  message.destroy('flatten')
  flattenFolderLoading.value = false

  // Check if no files to move
  if (dryRunResult.total_files === 0) {
    message.info(t('flattenFolderNoFiles'))
    return
  }

  // Check for conflicts
  if (dryRunResult.conflicts.length > 0) {
    Modal.error({
      title: t('flattenFolderConflict'),
      content: h('div', {}, [
        h('p', {}, `${t('flattenFolderConflictFiles')}:`),
        h('ul', { style: 'max-height: 300px; overflow-y: auto;' },
          dryRunResult.conflicts.map(f => h('li', { style: 'color: red;' }, f))
        )
      ])
    })
    return
  }

  // Step 2: Confirm with user
  Modal.confirm({
    title: t('flattenFolder'),
    content: h('div', {}, [
      h('p', { style: 'color: red; font-weight: bold;' }, t('flattenFolderWarning')),
      h('p', {}, t('flattenFolderConfirm', { count: dryRunResult.total_files }))
    ]),
    okText: t('confirm'),
    okType: 'danger',
    cancelText: t('cancel'),
    onOk: async () => {
      // Step 3: Execute flatten
      try {
        message.loading({ content: t('flattenFolderExecuting'), key: 'flatten', duration: 0 })
        const result = await flattenFolder({ folder_path: currLocation.value, dry_run: false })
        message.destroy('flatten')

        if (result.success) {
          message.success(t('flattenFolderSuccess', { count: result.moved_files }))
          // Refresh the view
          refresh()
        } else {
          message.error(`${t('error')}: ${result.errors?.join(', ')}`)
        }
      } catch (e: any) {
        message.destroy('flatten')
        message.error(e.message || String(e))
      }
    }
  })
}

watch(
  () => props,
  () => {
    _props.value = props
    const stackC = stackCache.get(props.stackKey ?? '')
    if (stackC) {
      stack.value = stackC.slice() // 浅拷贝
    }
  },
  { immediate: true }
)

watch(
  () => tiktokStore.visible,
  (v, lv) => {
    if (!v && lv) {
      const id = tiktokStore.lastActiveId
      if (id) {
        scrollToFileId(id)
      }
    }
  }
)

// Handle view action: open target file in fullscreen preview
let stopTargetWatch: (() => void) | undefined
let targetWatchTimeout: ReturnType<typeof setTimeout> | undefined
let targetDisposed = false
onUnmounted(() => {
  targetDisposed = true
  stopTargetWatch?.()
  clearTimeout(targetWatchTimeout)
})
onMounted(() => {
  const { targetFile, openPreview } = props
  if (!targetFile || !openPreview) {
    return
  }

  // Wait for files to load, then find and open the target file
  void nextTick(() => {
    if (targetDisposed) return
    const normalizedTarget = normalize(targetFile)
    const tryOpenTarget = (files: typeof sortedFiles.value) => {
      const targetIdx = files.findIndex(file => normalize(file.fullpath) === normalizedTarget)
      if (targetIdx < 0) return false
      void nextTick(() => {
        if (targetDisposed) return
        scrollToIndex(targetIdx)
        openMediaPreview(targetIdx)
      })
      return true
    }
    // Register the watcher before checking the current list; an immediate
    // watcher could run before its own stop function has been assigned.
    stopTargetWatch = watch(sortedFiles, files => {
      if (tryOpenTarget(files)) {
        stopTargetWatch?.()
        stopTargetWatch = undefined
        clearTimeout(targetWatchTimeout)
      }
    })
    if (tryOpenTarget(sortedFiles.value)) {
      stopTargetWatch()
      stopTargetWatch = undefined
    } else {
      targetWatchTimeout = setTimeout(() => {
        stopTargetWatch?.()
        stopTargetWatch = undefined
      }, 5000)
    }
  })
})

</script>
<template>
  <div class="folder-page workspace-pane"><ASpin :spinning="spinning" size="large">
    <MediaSelectionActions :files="multiSelectedIdxs.map(idx => sortedFiles[idx]).filter(Boolean)" :current-folder="currLocation"
      @select-all="onSelectAll" @reverse-select="onReverseSelect" @clear="onClearAllSelected" @action="selectionAction" />
    <ASelect style="display: none"></ASelect>

    <div :ref="(el) => { stackViewEl = el as HTMLDivElement }" @dragover.prevent @drop.prevent="onDrop($event)" class="container">
      <AModal v-model:open="showGenInfo" width="70vw" mask-closable @ok="showGenInfo = false">
        <template #cancelText />
        <ASkeleton active :loading="!q.isIdle">
          <div style="
                width: 100%;
                word-break: break-all;
                white-space: pre-line;
                max-height: 70vh;
                overflow: auto;
                z-index: 9999;
              " @dblclick="copy2clipboardI18n(imageGenInfo)">
            <div class="hint">{{ $t('doubleClickToCopy') }}</div>
            {{ imageGenInfo }}
          </div>
        </ASkeleton>
      </AModal>
      <div class="location-bar">
        <div class="breadcrumb" :style="{ flex: isLocationEditing ? 1 : '' }" >
          <AInput v-if="isLocationEditing" style="flex: 1" v-model:value="locInputValue" @click.stop @keydown.stop
            @press-enter="onLocEditEnter" allow-clear></AInput>
          <a-breadcrumb style="flex: 1" v-else>
            <a-breadcrumb-item v-for="(item, idx) in stack" :key="idx">
              <a @click.prevent="back(idx)">{{ item.curr === '/' ? $t('root') : item.curr.replace(/:\/$/, $t('drive'))
                }}</a>
            </a-breadcrumb-item>
          </a-breadcrumb>

          <AButton size="small" v-if="isLocationEditing" @click="onLocEditEnter" type="primary">{{ $t('go') }}</AButton>
          <div v-else class="location-act">
            <a @click.prevent="backToLastUseTo"  v-if="mode === 'scanned-fixed'"><ArrowLeftOutlined /> 上一级</a>
            <a @click.prevent="copyLocation" class="copy">复制路径</a>
            <a @click.prevent.stop="onEditBtnClick">输入路径</a>
          </div>
        </div>
        <div class="actions">
          <a class="opt" @click.prevent="refresh"> {{ $t('refresh') }} </a>
          <a class="opt" @click.prevent="onTiktokViewClick">{{ $t('TikTok View') }}</a>
          <a class="opt" @click.prevent="onWalkBtnClick" v-if="showWalkButton">{{ $t('browseModeWalk') }}</a>
          <a class="opt" @click.prevent.stop="selectAll"> {{ $t('selectAll') }} </a>
          <a-dropdown>
            <a class="opt" @click.prevent>
              跳转到文件夹
              <down-outlined />
            </a>
            <template #overlay>
              <a-menu>
                <a-menu-item v-for="item in global.quickMovePaths" :key="item.dir">
                  <a @click.prevent="quickMoveTo(item.dir)">{{ item.zh }}</a>
                </a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
          <a-button @click="moreActionsDropdownShow = true">查看选项</a-button>
          <a-modal v-model:open="moreActionsDropdownShow" title="查看选项" :width="560" :footer="null">
            <a-form layout="vertical" :colon="false">
                  <a-form-item :label="$t('gridCellWidth')">
                    <numInput v-model="cellWidth" :max="1024" :min="MIN_GRID_CELL_WIDTH" :step="16" />
                  </a-form-item>
                  <a-form-item :label="$t('sortingMethod')">
                    <search-select v-model:value="sortMethod" @click.stop :conv="sortMethodConv"
                      :options="sortMethods" />
                  </a-form-item>
                  <div style="padding: 4px;">
                    <a @click.prevent="addToSearchScanPathAndQuickMove" >{{
    $t('addToSearchScanPathAndQuickMove') }}</a>
                  </div>
                  <div style="padding: 4px;">
                    <a @click.prevent="openFolder(currLocation + '/')">{{ $t('openWithLocalFileBrowser') }}</a>
                  </div>
                  <div style="padding: 4px;">
                    <a @click.prevent="onPollRefreshClick">{{ polling ? $t('stopPollRefresh') : $t('pollRefresh') }}</a>
                  </div>
                  <div style="padding: 4px;" v-if="!isTauri">
                    <a @click.prevent="share">{{ $t('share') }}</a>
                  </div>
                  <div style="padding: 4px;">
                    <a @click.prevent="onCreateFloderBtnClick">{{ $t('createFolder') }}</a>
                  </div>
                  <div style="padding: 4px;">
                    <a @click.prevent="onFlattenFolderClick" style="color: #ff4d4f;">{{ $t('flattenFolder') }}</a>
                  </div>
                </a-form>
          </a-modal>
        </div>
      </div>
      <div v-if="currPage" class="view">
        <RecycleScroller class="file-list" :items="sortedFiles" :ref="(el) => { scroller = el as any }" @scroll="onScroll"
          :item-size="itemSize.first" key-field="fullpath" :item-secondary-size="itemSize.second"
          :gridItems="gridItems">
          <template v-slot="{ item: file, index: idx }">
            <!-- idx 和file有可能丢失 -->
            <file-item :idx="idx" :file="file"
              v-model:show-menu-idx="showMenuIdx" :selected="multiSelectedIdxs.includes(idx)" :native-drag-paths="multiSelectedIdxs.includes(idx) ? multiSelectedIdxs.map(index => sortedFiles[index]?.fullpath).filter(Boolean) : undefined" :cell-width="cellWidth"
              @file-item-click="onFileItemClick" @dragstart="onFileDragStart" @dragend="onFileDragEnd" @context-menu-click="onContextMenuClick"
              @drop-to-folder="onDropToFolder"
              @tiktok-view="(_file, idx) => openMediaPreview(idx)"
              :is-selected-mutil-files="multiSelectedIdxs.length > 1"

              :cover-files="dirCoverCache.get(file.fullpath)"/>
          </template>
          <template #after>
            <div style="padding: 16px 0 24px;">
              <AButton v-if="props.mode === 'walk'" @click="loadNextDir" :loading="loadNextDirLoading" block type="primary"
                :disabled="!canLoadNext" ghost>
                {{ $t('loadNextPage') }}</AButton>
            </div>
          </template>

        </RecycleScroller>

      </div>
    </div>

    <BaseFileListInfo :file-num="sortedFiles.length" :selected-file-num="multiSelectedIdxs.length" />
  </ASpin></div>
</template>
<style lang="scss" scoped>

.location-act {
  margin-left: 8px;
  display:flex;
  align-items:center;
  gap:8px;

  .copy {
    margin-right: 4px;
  }

  @media (max-width: 768px) {
    display: flex;
    flex-direction: column;

    &>*,
    .copy {
      margin: 2px;
    }
  }
}

.breadcrumb {
  display: flex;
  align-items: center;

  &>* {
    margin-right: 4px;
  }

  @media (max-width: 768px) {
    width: 100%;

    .ant-breadcrumb>* {
      display: inline-block;
    }
  }
}

.container {
  background: var(--zp-secondary-background);
  height: var(--pane-max-height);
}

.location-bar {
  padding: 14px 20px;
  flex-wrap: wrap;
  gap: 12px;
  background: var(--zp-primary-background);
  border-bottom: 1px solid var(--zp-border);
  display: flex;
  align-items: center;
  justify-content: space-between;

  @media (max-width: 768px) {
    flex-direction: column;

    ::-webkit-scrollbar {
      height: 2px; // 滚动条宽度
      background-color: var(--zp-secondary-variant-background); // 滚动条背景颜色
    }

    .actions {
      padding: 4px 0;
      width: 100%;
      overflow: auto;
      display: flex;
      align-items: center;

      &>* {
        flex-shrink: 0;
      }
    }
  }

  .actions {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 6px;
  }

  a.opt {
    margin-left: 0;
    padding: 6px 10px;
    border: 1px solid var(--zp-border);
    border-radius: 6px;
    color: var(--zp-primary);
    background: var(--zp-primary-background);
    &:hover { color: var(--primary-color); background: var(--primary-color-1); }
  }
}

.view {
  padding: 8px;
  height: calc(var(--pane-max-height) - 120px);

  .file-list {
    list-style: none;
    padding: 8px;
    height: 100%;
    overflow: auto;
  }
}

.hint {
  padding: 4px;
  border: 4px;
  background: var(--zp-secondary-background);
  border: 1px solid var(--zp-border);
}

.container{height:auto;flex:1;min-height:0;display:flex;flex-direction:column;}
.location-bar{flex-shrink:0;padding:16px 24px;align-items:flex-start;}
.breadcrumb{flex:1 1 100%;min-width:0;flex-wrap:wrap;gap:8px;}.breadcrumb :deep(.ant-breadcrumb){min-width:0;overflow-wrap:anywhere;}.breadcrumb :deep(.ant-breadcrumb ol){flex-wrap:wrap;}
.location-act{flex-shrink:0;flex-direction:row;flex-wrap:wrap;margin:0;gap:12px;}.location-act a{white-space:nowrap;}
.location-bar .actions{min-width:0;flex-shrink:1;flex-wrap:wrap;overflow:visible;gap:8px;}.location-bar a.opt{white-space:nowrap;}
.view{height:auto;flex:1;min-height:140px;overflow:hidden;}.view .file-list{height:100%;min-height:0;}
@container(max-width:550px){.location-bar{padding:12px;}.location-bar .actions{gap:6px;}.location-bar a.opt{font-size:12px;padding:6px 8px;}}

.location-bar{flex-direction:column;flex-wrap:nowrap;}.breadcrumb{flex:0 0 auto;width:100%;}.location-bar .actions{width:100%;flex:0 0 auto;}
</style>
