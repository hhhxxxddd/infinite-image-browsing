import type { FileNodeInfo } from '../../../shared/types/fileNode'

type PreviewFile = Pick<
  FileNodeInfo,
  'workspace_artifact_id' | 'workspace_input_owner' | 'workspace_artifact_source' | 'edit_snapshot'
>

export function assetPreviewIdentity(file?: PreviewFile) {
  if (!file) return { origin: '上传文件', productionSource: undefined }
  if (file.workspace_input_owner) return { origin: '工作区输入快照', productionSource: undefined }
  if (file.edit_snapshot) return { origin: '编辑快照', productionSource: undefined }
  if (!file.workspace_artifact_id) return { origin: '媒体库', productionSource: undefined }
  const source = file.workspace_artifact_source
  return {
    origin: '工作区产物',
    productionSource:
      source === 'image_studio' ||
      source === 'ai_image_edit' ||
      source === 'ai_image_generation' ||
      source === 'audio_studio'
        ? source
        : undefined
  }
}
