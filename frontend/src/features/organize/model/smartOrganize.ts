import { getErrorMessage } from '@/shared/lib/errorMessage'
/**
 * Smart organize utility functions
 * Handles starting organize jobs and polling for status
 */

import { message } from 'ant-design-vue'
import { t } from '@/shared/i18n/index'
import { useApplicationStore } from '@/features/application/public'
import { startOrganizeFiles, getOrganizeFilesStatus } from '@/features/organize/api/organize'
import type { OrganizeFilesReq } from '@/features/organize/api/organize'
import { globalEvents } from '@/features/application/public'

export interface SmartOrganizeConfig {
  destFolder: string
  recursive: boolean
  minClusterSize: number
  action: 'move' | 'copy'
}

/**
 * Open the smart organize config modal
 * @param folderPath - Folder path to organize
 */
export function openSmartOrganizeConfig(folderPath: string) {
  const globalStore = useApplicationStore()
  globalStore.smartOrganizeConfigPath = folderPath
  globalStore.showSmartOrganizeConfig = true
}

/**
 * Start a smart organize job with config from modal
 * @param paths - Array of folder paths or file paths to organize
 * @param config - Config from modal
 */
export async function startSmartOrganizeWithConfig(paths: string[], config: SmartOrganizeConfig) {
  const globalStore = useApplicationStore()

  try {
    // Build request with config options
    const req: OrganizeFilesReq = {
      folder_paths: paths,
      lang: globalStore.lang,
      dest_folder: config.destFolder || undefined,
      min_cluster_size: config.minClusterSize,
      action: config.action,
      recursive: config.recursive
    }

    const { job_id } = await startOrganizeFiles(req)

    // Add job to global store for tracking
    globalStore.addOrganizeJob({
      job_id,
      status: 'queued',
      progress: {
        stage: 'embedding',
        embedded_done: 0,
        to_embed: 0,
        clusters_done: 0,
        clusters_total: 0,
        moved_done: 0,
        moved_total: 0,
        current_file: '',
        created_folders: [],
        errors: []
      },
      startedAt: Date.now(),
      folder_paths: paths
    })

    message.success(t('organizeJobStarted'))

    // Start polling for status
    pollOrganizeStatus(job_id, paths)

    return job_id
  } catch (e) {
    message.error(`${t('error')}: ${getErrorMessage(e, t('error'))}`)
    throw e
  }
}

/**
 * Poll for organize job status until completion
 * @param job_id - Job ID to poll
 * @param folderPaths - Original folder paths (for refreshing view after completion)
 */
async function pollOrganizeStatus(job_id: string, folderPaths?: string[]) {
  const globalStore = useApplicationStore()
  const pollInterval = 2000 // 2 seconds

  const poll = async () => {
    try {
      const status = await getOrganizeFilesStatus(job_id)

      // Update job in store with all available data
      const updateData: Parameters<typeof globalStore.updateOrganizeJob>[1] = {
        status: status.status,
        progress: status.progress
      }

      // Only include preview if it exists in the response
      if (status.preview) {
        updateData.preview = status.preview
      }

      globalStore.updateOrganizeJob(job_id, updateData)

      // Continue polling if not done or error
      if (!['done', 'error', 'preview_ready'].includes(status.status)) {
        setTimeout(poll, pollInterval)
      } else {
        if (status.status === 'error') {
          console.error('Organize job failed:', status.error)
        } else if (status.status === 'done') {
          // Refresh file view after completion
          globalEvents.emit('refreshFileView', { paths: folderPaths })
        }
      }
    } catch (e) {
      console.error('Poll organize status error:', e)
      // Retry on error
      setTimeout(poll, pollInterval * 2)
    }
  }

  // Start polling
  poll()
}
