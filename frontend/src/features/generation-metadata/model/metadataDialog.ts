import { FileNodeInfo } from '@/features/media-library/public'

import { globalEvents } from '@/features/application/public'

export const openEditPromptModal = async (file: FileNodeInfo) => {
  globalEvents.off('promptEditorUpdated') // 确保事件监听器不会重复绑定
  return new Promise<void>((resolve) => {
    const handler = () => {
      globalEvents.off('promptEditorUpdated', handler)
      resolve()
    }

    globalEvents.on('promptEditorUpdated', handler)
    globalEvents.emit('openPromptEditor', { file })
  })
}
