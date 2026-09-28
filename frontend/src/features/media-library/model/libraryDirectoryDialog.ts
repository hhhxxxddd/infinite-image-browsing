import { defineAsyncComponent, h, nextTick } from 'vue'
import { Modal, message } from 'ant-design-vue'
import { useApplicationStore } from '@/features/application/public'
import { checkPathIsDirectory } from '../api/fileOperations'
import {
  scannedDirectoryRoots,
  isLibraryDirectory,
  readLibraryDirectory,
  rememberLibraryDirectory
} from './libraryDirectory'

const DirectoryBrowser = defineAsyncComponent(
  () => import('../components/MediaDirectoryBrowser.vue')
)

function storage() {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
function roots() {
  const global = useApplicationStore()
  return scannedDirectoryRoots(global.conf?.extra_paths ?? [], global.conf?.is_win)
}

export function lastLibraryDirectory(): string {
  return readLibraryDirectory(storage(), roots(), useApplicationStore().conf?.is_win)
}

export async function validateLibraryDirectory(directory: string): Promise<void> {
  if (!isLibraryDirectory(directory, roots(), useApplicationStore().conf?.is_win))
    throw new Error('此目录已不在媒体库扫描范围内，请重新选择')
  if (!(await checkPathIsDirectory([directory]))[directory])
    throw new Error('此目录已删除或无法读取，请重新选择')
}

export function chooseLibraryDirectory(
  initialPath = lastLibraryDirectory()
): Promise<string | undefined> {
  if (!roots().length) {
    message.warning('请先在媒体库添加扫描目录')
    return Promise.resolve(undefined)
  }
  return new Promise((resolve) => {
    let selected = ''
    let closed = false
    const cancel = () => {
      closed = true
      resolve(undefined)
    }
    const dialog = Modal.confirm({
      title: '选择媒体库目录',
      icon: null,
      width: 720,
      centered: true,
      okText: '选择此目录',
      cancelText: '取消',
      okButtonProps: { disabled: true },
      content: () =>
        h(DirectoryBrowser, {
          initialPath,
          onReady(path: string) {
            selected = path
            // Modal.update renders synchronously; wait until the browser has mounted.
            void nextTick(() => {
              if (!closed) dialog.update({ okButtonProps: { disabled: !selected } })
            })
          }
        }),
      async onOk() {
        try {
          await validateLibraryDirectory(selected)
          rememberLibraryDirectory(storage(), selected)
          resolve(selected)
        } catch (error) {
          message.error(error instanceof Error ? error.message : '无法选择此目录，请重试')
          throw error
        }
      },
      onCancel: cancel,
      afterClose: cancel
    })
  })
}
