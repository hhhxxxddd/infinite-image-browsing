import { Input, Modal, message } from 'ant-design-vue'
import { ref } from 'vue'
import * as Path from '@/shared/lib/path'
import { mkdirs } from '@/features/media-library/api/files'

import { t } from '@/shared/i18n/index'

import { globalEvents } from '@/features/application/public'

import { rebuildImageIndex, renameFile } from '@/features/media-library/api/library'

import { useApplicationStore } from '@/features/application/public'

import { readWorkspaceRecords } from '@/features/workspaces/public'
import { remapWorkspaceDrafts, remapWorkspaceRecords } from '@/features/workspaces/public'
import { reloadLoadedWorkspaceStorage } from '@/features/workspaces/services/workspaceStorage'

export const openCreateFoldersDialog = (base: string) => {
  const folderName = ref('')
  return new Promise<void>((resolve) => {
    Modal.confirm({
      title: t('inputFolderName'),
      content: () => <Input v-model:value={folderName.value} />,
      async onOk() {
        if (!folderName.value) {
          return
        }
        const dest = Path.join(base, folderName.value)
        await mkdirs(dest)
        resolve()
      }
    })
  })
}

export const openRebuildImageIndexModal = () => {
  Modal.confirm({
    title: t('confirmRebuildImageIndex'),
    onOk: async () => {
      await rebuildImageIndex()
      globalEvents.emit('searchIndexExpired')
      message.success(t('rebuildComplete'))
    }
  })
}

export const openRenameFileModal = (path: string) => {
  const name = ref(path.split(/[\\/]/).pop() ?? '')
  return new Promise<string>((resolve) => {
    Modal.confirm({
      title: t('rename'),
      content: () => <Input v-model:value={name.value} />,
      async onOk() {
        if (!name.value) {
          return
        }
        const resp = await renameFile({ path, name: name.value })
        const paths = new Map([[path, resp.new_path]])
        try {
          remapWorkspaceDrafts(localStorage, paths)
          await reloadLoadedWorkspaceStorage()
        } catch {
          message.warning('文件已重命名，制作文件引用暂未刷新，请重新打开工作区')
        }
        const global = useApplicationStore()
        if (global.conf) {
          const records = readWorkspaceRecords(global.conf.app_fe_setting.workbench_projects)
          global.conf.app_fe_setting.workbench_projects = {
            version: 2,
            items: remapWorkspaceRecords(records, paths)
          }
        }
        resolve(resp.new_path)
      }
    })
  })
}
