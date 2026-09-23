<script setup lang="ts">
import { onMounted, watch, ref, computed } from 'vue'
import { getGlobalSetting, setAppFeSetting } from './api'
import { useGlobalStore, persistKeys } from './store/useGlobalStore'
import { getQuickMovePaths } from '@/page/taskRecord/autoComplete'
import SplitViewTab from '@/page/SplitViewTab/SplitViewTab.vue'
import OrganizeJobsPanel from '@/components/OrganizeJobsPanel.vue'
import OrganizePreview from '@/page/OrganizeFiles/OrganizePreview.vue'
import SmartOrganizeConfigModal from '@/components/SmartOrganizeConfigModal.vue'
import PromptEditorModal from '@/components/PromptEditorModal.vue'
import { Dict, createReactiveQueue, globalEvents, useGlobalEventListen } from './util'
import { resolveQueryActions } from './queryActions'
import { refreshTauriConf } from './util/tauriAppConf'
import { exportFn } from './defineExportFunc'
import { debounce, once, cloneDeep } from 'lodash-es'
import { message, theme } from 'ant-design-vue'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import { t } from './i18n'
import type { OrganizeFilesPreviewResp } from '@/api/organize'
import { getOrganizeFilesStatus } from '@/api/organize'
import { MIN_GRID_CELL_WIDTH } from '@/util/mediaCardLayout'

const globalStore = useGlobalStore()
const queue = createReactiveQueue()

// Organize preview modal state
const showOrganizePreview = ref(false)
const currentOrganizePreview = ref<OrganizeFilesPreviewResp | null>(null)

// Moving progress state
const isMovingFiles = ref(false)
const movingProgress = ref({ moved: 0, total: 0 })

const handleOpenOrganizePreview = (job: { preview?: OrganizeFilesPreviewResp }) => {
  if (job.preview) {
    currentOrganizePreview.value = job.preview
    showOrganizePreview.value = true
  } else {
    console.warn('No preview data in job - job keys:', Object.keys(job))
  }
}

const handleOrganizePreviewConfirmed = async () => {
  showOrganizePreview.value = false
  const jobId = currentOrganizePreview.value?.job_id
  const folderPaths = globalStore.getOrganizeJob(jobId || '')?.folder_paths || []
  currentOrganizePreview.value = null

  if (!jobId) return

  // Start polling for moving progress with fullscreen loading
  isMovingFiles.value = true
  movingProgress.value = { moved: 0, total: 0 }

  const pollMoving = async () => {
    try {
      const status = await getOrganizeFilesStatus(jobId)

      if (status.status === 'moving') {
        movingProgress.value = {
          moved: status.progress?.moved_done || 0,
          total: status.progress?.moved_total || 0
        }
        setTimeout(pollMoving, 500)
      } else if (status.status === 'done') {
        // Done - close loading, remove job, refresh view
        isMovingFiles.value = false
        globalStore.removeOrganizeJob(jobId)
        message.success(t('organizeComplete'))
        // Trigger refresh
        globalEvents.emit('refreshFileView', { paths: folderPaths })
      } else if (status.status === 'error') {
        isMovingFiles.value = false
        message.error(`${t('organizeFailed')}: ${status.error}`)
      } else {
        // Still in other status, keep polling
        setTimeout(pollMoving, 500)
      }
    } catch (e: any) {
      console.error('Poll moving status error:', e)
      setTimeout(pollMoving, 1000)
    }
  }

  pollMoving()
}

const handleOrganizePreviewCancel = () => {
  showOrganizePreview.value = false
  currentOrganizePreview.value = null
}

const persistKeysFiltered = persistKeys.filter(v => v !== 'recent')

let lastConf = null as any
const watchGlobalSettingChange = once(async () => {
  globalStore.$subscribe((debounce(async () => {
    if (globalStore.conf?.is_readonly === true) {
      return
    }
    const conf = {} as Dict
    persistKeysFiltered.forEach((key) => {
      conf[key] = cloneDeep((globalStore as any)[key])
    })
    if (JSON.stringify(conf) === JSON.stringify(lastConf)) {
      return
    }
    await setAppFeSetting('global', conf)
    lastConf = cloneDeep(conf)
  }, 500)))


})

useGlobalEventListen('updateGlobalSetting', async () => {
  await refreshTauriConf()
  const resp = await getGlobalSetting()
  globalStore.conf = resp
  const r = await getQuickMovePaths(resp)
  globalStore.quickMovePaths = r.filter((v) => v?.dir?.trim?.())

  const restoreFeGlobalSetting = globalStore?.conf?.app_fe_setting?.global
  if (restoreFeGlobalSetting) {
    lastConf = cloneDeep(restoreFeGlobalSetting)
    persistKeysFiltered.forEach((key) => {
      const v = restoreFeGlobalSetting[key]
      if (v !== undefined) {
        (globalStore as any)[key] = v
      }
    })
  }
  globalStore.defaultGridCellWidth = Math.max(MIN_GRID_CELL_WIDTH, globalStore.defaultGridCellWidth)
  watchGlobalSettingChange()
  exportFn(globalStore)
  resolveQueryActions(globalStore)
  globalEvents.emit('updateGlobalSettingDone')
})



const appTheme = computed(() => {
  const dark = globalStore.computedTheme === 'dark'
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: dark ? '#60a5fa' : '#0067c0',
      colorLink: dark ? '#80b8ff' : '#0067c0',
      colorBgBase: dark ? '#202a35' : '#ffffff',
      colorBgContainer: dark ? '#202a35' : '#ffffff',
      colorBgElevated: dark ? '#26313e' : '#ffffff',
      colorBgLayout: dark ? '#141a22' : '#f3f6fa',
      colorText: dark ? '#e8edf4' : '#1f2d3d',
      colorTextSecondary: dark ? '#a2b1c2' : '#617287',
      colorBorder: dark ? '#374758' : '#dce4ee',
      colorBorderSecondary: dark ? '#374758' : '#e8edf3',
      borderRadius: 7,
      borderRadiusLG: 14,
      controlHeight: 34,
      fontSize: 13,
      fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
      motionDurationFast: '0.12s',
      motionDurationMid: '0.19s',
      motionDurationSlow: '0.24s',
    },
  }
})
watch(appTheme, () => {
  document.body.classList.toggle('dark', globalStore.computedTheme === 'dark')
}, { immediate: true })


onMounted(async () => {
  globalEvents.emit('updateGlobalSetting')

})
</script>

<template>
  <a-config-provider :theme="appTheme" :locale="zhCN">
  <a-skeleton :loading="!queue.isIdle">
    <SplitViewTab />
  </a-skeleton>

  <!-- Organize Jobs Progress Panel -->
  <OrganizeJobsPanel @open-preview="handleOpenOrganizePreview" />

  <!-- Organize Preview Modal -->
  <a-modal
    v-model:open="showOrganizePreview"
    :title="t('smartOrganizePreview')"
    :footer="null"
    :width="800"
    :destroyOnClose="true"
    :zIndex="2000"
  >
    <OrganizePreview
      v-if="currentOrganizePreview"
      :preview="currentOrganizePreview"
      @cancel="handleOrganizePreviewCancel"
      @confirmed="handleOrganizePreviewConfirmed"
    />
  </a-modal>

  <!-- Smart Organize Config Modal -->
  <SmartOrganizeConfigModal />

  <!-- Prompt Editor Modal (自包含组件，通过全局事件控制) -->
  <PromptEditorModal />

  <!-- Fullscreen Loading for Moving Files -->
  <div v-if="isMovingFiles" class="moving-files-overlay">
    <div class="moving-files-content">
      <a-spin size="large" />
      <div class="moving-text">{{ t('movingFiles') }}</div>
      <div class="moving-progress">
        {{ movingProgress.moved }} / {{ movingProgress.total }}
      </div>
    </div>
  </div>
  </a-config-provider>
</template>

<style>
.moving-files-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.moving-files-content {
  text-align: center;
  color: #fff;
}

.moving-text {
  margin-top: 16px;
  font-size: 18px;
}

.moving-progress {
  margin-top: 8px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
}
</style>
