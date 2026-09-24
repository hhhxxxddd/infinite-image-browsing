import { h, ref } from 'vue'
import { Input, Modal, message } from 'ant-design-vue'
import { renameFolder } from '@/api/db'
import { useGlobalStore } from '@/store/useGlobalStore'
import { globalEvents } from '@/util'
import { remapFolderPath } from './folderRenamePath'
import { getFolderIcons } from '@/api/folderIcons'

export function renameSubfolder(path: string, onRenamed: () => void | Promise<void>) {
  const global = useGlobalStore()
  if (global.conf?.is_readonly) return
  const name = ref(path.split(/[\\/]/).filter(Boolean).pop() || '')
  const error = ref('')
  Modal.confirm({
    title: '修改文件夹名称', width: 480, okText: '改名', cancelText: '取消',
    content: () => h('div', { style: 'padding-top:12px' }, [
      h('p', { style: 'color:var(--zp-secondary);font-size:12px;overflow-wrap:anywhere' }, `真实路径：${path}`),
      h(Input, { value: name.value, autofocus: true, 'aria-label': '新的文件夹名称',
        'onUpdate:value': (value: string) => { name.value = value; error.value = '' } }),
      error.value ? h('p', { role: 'alert', style: 'color:var(--ant-error-color,#ff4d4f);margin:8px 0 0' }, error.value) : null
    ]),
    async onOk() {
      let destination: string
      try { ({ new_path: destination } = await renameFolder({ path, name: name.value })) }
      catch (cause: any) {
        error.value = cause.response?.data?.detail || cause.message || '改名失败，请重试'
        throw cause
      }
      for (const tab of global.tabList) for (const pane of tab.panes) {
        if (pane.type !== 'local' || !pane.path) continue
        const nextPath = remapFolderPath(pane.path, path, destination, global.conf?.is_win)
        if (!nextPath) continue
        pane.path = nextPath
        pane.name = nextPath.split(/[\\/]/).filter(Boolean).pop() || nextPath
        pane.nameFallbackStr = undefined
        if (pane.targetFile) pane.targetFile = remapFolderPath(pane.targetFile, path, destination, global.conf?.is_win) || pane.targetFile
      }
      globalEvents.emit('folderRenamed', path, destination)
      try { global.folderIcons = await getFolderIcons() } catch { /* the next page load will retry */ }
      await onRenamed()
      message.success('文件夹已改名')
    }
  })
}
