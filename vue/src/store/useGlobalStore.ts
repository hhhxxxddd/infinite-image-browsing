import type { GlobalConf } from '@/api'
import type { ExtraPathType, Tag } from '@/api/db'
import type { OrganizeJobProgress, OrganizeFilesPreviewResp } from '@/api/organize'
import { FileNodeInfo } from '@/api/files'
import { i18n, t } from '@/i18n'
import { getPreferredLang } from '@/i18n'
import { SortMethod } from '@/page/fileTransfer/fileSort'
import { Props as FileTransferProps } from '@/page/fileTransfer/hooks'
import type { getQuickMovePaths } from '@/page/taskRecord/autoComplete'
import { type Dict, type ReturnTypeAsync } from '@/util'
import { AnyFn, usePreferredDark } from '@vueuse/core'
import { uniqueId } from 'lodash-es'
import { defineStore } from 'pinia'
import { VNode, computed, reactive, watch } from 'vue'
import { ref } from 'vue'
import { WithRequired } from 'vue3-ts-util'
import * as Path from '../util/path'
import { prefix } from '@/util/const'
import { MIN_GRID_CELL_WIDTH } from '@/util/mediaCardLayout'
import { parseTabLayout, serializeTabLayout, TAB_LAYOUT_STORAGE_KEY } from '@/page/SplitViewTab/tabLayout'

interface TabPaneBase {
  name: string | VNode
  nameFallbackStr?: string
  readonly key: string
}

interface OtherTabPane extends TabPaneBase {
  referencePath?: string
  type: 'global-setting' | 'batch-download' | 'random-image' | 'workbench'
}

export interface EmptyStartTabPane extends TabPaneBase  {
  type: 'empty' 
  section?: 'all' | 'image' | 'video' | 'audio' | 'folders'
  popAddPathModal?: {
    path: string
    type: ExtraPathType
  }
}

export type GridViewFileTag = WithRequired<Partial<Tag>, 'name'>;

export interface GridViewFile extends FileNodeInfo {
  /**
   * Tags for displaying the file. The 'name' property is required,
   * while the other properties are optional.
   */
  tags?: GridViewFileTag[];
}

/**
 * A tab pane that displays files in a grid view.
 */
export interface GridViewTabPane extends TabPaneBase {
  type: 'grid-view'
  /**
   * Indicates whether the files in the grid view can be deleted.
   */
  removable?: boolean
  /**
   * Indicates whether files can be dragged and dropped from other pages into the grid view.
   */
  allowDragAndDrop?: boolean,
  files: GridViewFile[]
}


export interface ImgSliTabPane extends TabPaneBase {
  type: 'img-sli'
  left: FileNodeInfo
  right: FileNodeInfo
}

export interface FileTransferTabPane extends TabPaneBase {
  type: 'local'
  path?: string
  mode?: FileTransferProps['mode']
  stackKey?: string
  /** Target file path to scroll to and optionally preview */
  targetFile?: string
  /** Whether to open fullscreen preview for targetFile */
  openPreview?: boolean
}

export type TabPane =
  | EmptyStartTabPane
  | FileTransferTabPane
  | OtherTabPane
  | ImgSliTabPane
  | GridViewTabPane

/**
 * This interface represents a tab, which contains an array of panes, an ID, and a key
 */
export interface Tab {
  /**
   * An array of panes that belong to this tab
   */
  panes: TabPane[]
  /**
   * A unique identifier for this tab
   */
  id: string
  /**
   * A value indicating which pane is currently selected within the tab
   */
  key: string
}

export type ActionConfirmRequired = 'deleteOneOnly'

export const persistKeys = [
  'darkModeControl',
  'defaultSortingMethod',
  'defaultGridCellWidth',
  'lang',
  'enableThumbnail',
  'recent',
  'gridThumbnailResolution',
  'longPressOpenContextMenu',
  'fileTypeFilter',
  'ignoredConfirmActions',
  'autoRefreshWalkMode',
  'autoRefreshWalkModePosLimit',
  'autoRefreshNormalFixedMode',
  'batchDownloadCompress',
  'autoUpdateIndex',
]

function cellWidthMap(x: number): number {
  if (x < 768) {
    return MIN_GRID_CELL_WIDTH;
  } else {
    const y = MIN_GRID_CELL_WIDTH + Math.floor((x - 768) / 128) * 16;
    return Math.min(y, 256);
  }
}

export const useGlobalStore = defineStore(
  prefix + 'useGlobalStore',
  () => {
    const conf = ref<GlobalConf>()
    const folderIcons = ref<Record<string, string>>({})
    const quickMovePaths = ref([] as ReturnTypeAsync<typeof getQuickMovePaths>)

    const enableThumbnail = ref(true)
    const gridThumbnailResolution = ref(512)
    const defaultSortingMethod = ref(SortMethod.CREATED_TIME_DESC)
    const defaultGridCellWidth = ref(256)

    try {
      if (typeof parent !== 'undefined' && parent.window) {
        defaultGridCellWidth.value = cellWidthMap(parent.window.innerHeight)
      }
    } catch (error) {
      console.error(error)
    }
    
    const darkModeControl = ref<'light' | 'dark' | 'auto'>('light')

    const createEmptyPane = (): TabPane => ({
      type: 'empty',
      name: t('emptyStartPage'),
      key: uniqueId()
    })
    const initialPane = createEmptyPane()
    let restoredTabs: Tab[] | null = null
    try {
      if (typeof window !== 'undefined') restoredTabs = parseTabLayout(window.localStorage.getItem(TAB_LAYOUT_STORAGE_KEY))
    } catch (error) {
      console.warn('无法读取已保存的标签页布局', error)
    }
    // Lodash's ID counter starts over on each launch. Give restored panes their own
    // namespace so newly opened panes cannot reuse an old key.
    restoredTabs?.forEach(tab => {
      const selectedKey = tab.key
      tab.id = uniqueId('restored-workspace-')
      tab.panes = tab.panes.map(pane => {
        const nextKey = uniqueId('restored-')
        if (pane.key === selectedKey) tab.key = nextKey
        return { ...pane, key: nextKey }
      })
    })
    const tabList = ref<Tab[]>(restoredTabs ?? [{ panes: [initialPane], key: initialPane.key, id: uniqueId() }])
    watch(() => serializeTabLayout(tabList.value), layout => {
      try {
        if (typeof window !== 'undefined') window.localStorage.setItem(TAB_LAYOUT_STORAGE_KEY, layout)
      } catch (error) {
        console.warn('无法保存标签页布局', error)
      }
    }, { immediate: true, flush: 'post' })
    const recent = ref(new Array<{ path: string; key: string, mode: FileTransferTabPane['mode'] }>())
    const lang = ref(getPreferredLang())
    watch(lang, (v) => (i18n.global.locale.value = v as any))

    const longPressOpenContextMenu = ref(false)

    const extraPathAliasMap = ref({} as Dict<string>)
    const pathAliasMap = computed((): Dict<string> => extraPathAliasMap.value)

    const pageFuncExportMap = new Map<string, Dict<AnyFn>>()
    const ignoredConfirmActions = reactive<Record<ActionConfirmRequired, boolean>>({ deleteOneOnly: false })

    const dark = usePreferredDark()

    const computedTheme = computed(() =>  {
      const isDark = darkModeControl.value === 'auto' ? dark.value : darkModeControl.value === 'dark'
      return isDark ? 'dark' : 'light'
    })

    // 简化路径
    const getShortPath = (loc: string) => {
      try {
        loc = loc.trim()
        const map = pathAliasMap.value
        const np = Path.normalize(loc)
        const replacedPaths = [] as string[]
        for (const [k, v] of Object.entries(map)) {
          if (k && v) {
            if (loc === v || np === v) return k
            replacedPaths.push(np.replace(v, '$' + k))
          }
        }
        return replacedPaths.sort((a, b) => a.length - b.length)?.[0] ?? loc
      } catch (error) {
        console.error(error)
        return loc
      }
    }

    // ===== Organize Jobs Management =====
    interface OrganizeJob {
      job_id: string
      status: string
      progress: OrganizeJobProgress
      startedAt: number
      folder_paths: string[]
      preview?: OrganizeFilesPreviewResp
    }

    const activeOrganizeJobs = ref<OrganizeJob[]>([])
    const showOrganizePanel = ref(true) // 控制面板显示/隐藏

    // Smart organize config modal state
    const showSmartOrganizeConfig = ref(false)
    const smartOrganizeConfigPath = ref('')

    const addOrganizeJob = (job: OrganizeJob) => {
      activeOrganizeJobs.value.push(job)
      showOrganizePanel.value = true // 添加任务时自动显示面板
    }

    const updateOrganizeJob = (job_id: string, update: Partial<OrganizeJob>) => {
      const idx = activeOrganizeJobs.value.findIndex(j => j.job_id === job_id)
      if (idx >= 0) {
        // Replacing the array entry triggers Vue reactivity without serializing
        // potentially large preview payloads on every progress poll.
        activeOrganizeJobs.value[idx] = { ...activeOrganizeJobs.value[idx], ...update }
      }
    }

    const removeOrganizeJob = (job_id: string) => {
      activeOrganizeJobs.value = activeOrganizeJobs.value.filter(j => j.job_id !== job_id)
    }

    const getOrganizeJob = (job_id: string) => {
      return activeOrganizeJobs.value.find(j => j.job_id === job_id)
    }

    return {
      computedTheme,
      darkModeControl,
      defaultSortingMethod,
      defaultGridCellWidth,
      pathAliasMap,
      createEmptyPane,
      lang,
      tabList,
      conf,
      folderIcons,
      quickMovePaths,
      enableThumbnail,
      recent,
      gridThumbnailResolution,
      longPressOpenContextMenu,
      fileTypeFilter: ref<('image' | 'video' | 'audio' | 'all')[]>(['image', 'video', 'audio']), // 新的多选过滤
      keepMultiSelect: ref(false),
      pageFuncExportMap,
      ignoredConfirmActions,
      getShortPath,
      extraPathAliasMap,
      autoRefreshWalkMode: ref(true),
      autoRefreshWalkModePosLimit: ref(128),
      autoRefreshNormalFixedMode: ref(true),
      batchDownloadCompress: ref(false),
      autoUpdateIndex: ref(true),
      // Organize jobs
      activeOrganizeJobs,
      showOrganizePanel,
      addOrganizeJob,
      updateOrganizeJob,
      removeOrganizeJob,
      getOrganizeJob,
      // Smart organize config modal
      showSmartOrganizeConfig,
      smartOrganizeConfigPath
    }
  },
  {
    persist: {
      // debug: true,
      pick: persistKeys
    }
  }
)
