import { h, ref } from 'vue'
import { Input, Modal, message } from 'ant-design-vue'
import { checkPathExists } from '@/api'
import { mkdirs } from '@/api/files'
import { useGlobalStore } from '@/store/useGlobalStore'
import { childFolderPath } from './folderName'

export function createSubfolder(parent: string, onCreated?: (path: string) => void | Promise<void>) {
  const global = useGlobalStore()
  if (global.conf?.is_readonly) return
  const name = ref('')
  const error = ref('')
  Modal.confirm({
    title: '新建子文件夹', width: 460, okText: '创建', cancelText: '取消',
    content: () => h('div', { style: 'padding-top:12px' }, [
      h('p', { style: 'color:var(--zp-secondary);font-size:12px;overflow-wrap:anywhere' }, `创建位置：${parent}`),
      h(Input, { value: name.value, autofocus: true, 'aria-label': '子文件夹名称', placeholder: '文件夹名称',
        'onUpdate:value': (value: string) => { name.value = value; error.value = '' } }),
      error.value ? h('p', { role: 'alert', style: 'color:var(--ant-error-color,#ff4d4f);margin:8px 0 0' }, error.value) : null
    ]),
    async onOk() {
      let path: string
      try {
        path = childFolderPath(parent, name.value, global.conf?.is_win)
        const existing = await checkPathExists([path])
        if (existing[path]) throw new Error('此位置已存在同名文件或文件夹，请换一个名称')
        await mkdirs(path)
      } catch (cause: any) {
        error.value = cause.response?.data?.detail || cause.message || '创建失败，请检查目录权限后重试'
        throw cause
      }
      message.success('子文件夹已创建')
      await onCreated?.(path)
    }
  })
}
