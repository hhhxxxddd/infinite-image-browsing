import { Modal, message } from 'ant-design-vue'
import { deleteFiles } from '@/api/files'
import { useGlobalStore } from '@/store/useGlobalStore'
import { findManagedFolder } from './folderScope'
import { globalEvents } from '@/util'
export function deleteSubfolder(path: string, onDeleted: () => void | Promise<void>) {
  const global = useGlobalStore()
  if (global.conf?.is_readonly) return
  const parent = findManagedFolder(global.conf?.extra_paths ?? [], path, global.conf?.is_win)
  const normalize = (value: string) => { const normalized = value.replace(/\\/g, '/').replace(/\/+$/, ''); return global.conf?.is_win ? normalized.toLowerCase() : normalized }
  if (!parent || normalize(parent.path) === normalize(path)) {
    message.warning('已添加的根目录请使用“从媒体库移除”管理')
    return
  }
  Modal.confirm({
    title:'删除空文件夹？', content:`将从本机删除「${path.split(/[\\/]/).pop()}」。仅支持空文件夹；如有媒体或子文件夹，请先移出内容。`,
    okText:'删除文件夹',cancelText:'取消',okType:'danger',
    async onOk() {
      try { await deleteFiles([path]) }
      catch (error:any) { message.error(error.response?.data?.detail || '删除失败，请重试'); throw error }
      message.success('文件夹已删除')
      globalEvents.emit('searchIndexExpired')
      await onDeleted()
    }
  })
}
