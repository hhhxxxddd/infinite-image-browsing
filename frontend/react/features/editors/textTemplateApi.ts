import { apiFetch } from '../../shared/apiClient'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import { blobToBase64 } from '../../../src/shared/lib/blobEncoding'
import { toRawFileUrl } from '../../../src/shared/lib/mediaUrls'
import { managedImageAssetFile } from '../../../src/shared/lib/managedImageAssets'
import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel'
import { renderStudioDocument } from '../../../src/features/image-editor/model/imageStudioRender'
import type {
  CreativeTemplate,
  TextTemplate
} from '../../../src/features/image-editor/model/imageTextTemplates'
import { textTemplatePreviewBackground } from '../../../src/features/image-editor/model/imageTextTemplates'

export const fetchTextTemplate = (id: string, signal?: AbortSignal) =>
  apiFetch<TextTemplate>(`/templates/${encodeURIComponent(id)}`, { signal })

export async function saveTextTemplate(
  name: string,
  document: StudioDocument,
  info: Record<string, FileNodeInfo>,
  type: CreativeTemplate['type'] = 'text'
) {
  const paths = [
    ...new Set(
      document.layers.flatMap((layer) => (layer.kind === 'image' && layer.path ? [layer.path] : []))
    )
  ]
  const assets: Record<string, string> = {}
  let bytes = 0
  // Sequential loading avoids allocating every full-resolution image at once.
  for (const path of paths) {
    const file = info[path] || managedImageAssetFile(path)
    if (!file) throw new Error('无法读取模板配图，请重新打开作品后再试')
    const response = await fetch(toRawFileUrl(file), { credentials: 'include' })
    if (!response.ok) throw new Error(`无法读取配图：${file.name}`)
    const blob = await response.blob()
    bytes += blob.size
    if (bytes > 64 * 1024 * 1024) throw new Error('模板配图总大小不能超过 64 MB')
    assets[path] = await blobToBase64(blob)
  }
  const canvas = window.document.createElement('canvas')
  const missing = await renderStudioDocument(
    canvas,
    {
      ...document,
      background: type === 'text' ? textTemplatePreviewBackground(document) : document.background
    },
    info,
    true,
    { kind: 'all' },
    600
  )
  if (missing.length) throw new Error('无法生成预览：' + missing.join('、'))
  const preview = canvas.toDataURL('image/png').split(',')[1]
  return apiFetch<CreativeTemplate>('/templates', {
    method: 'POST',
    body: JSON.stringify({ name, document, assets, preview, type })
  })
}
