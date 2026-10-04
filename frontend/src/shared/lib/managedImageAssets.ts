import type { FileNodeInfo } from '../types/fileNode.ts'
import { templateAssetFile, templateAssetRoute } from './templateAssets.ts'

export function managedImageAssetRoute(path: string): string | undefined {
  const composite = /^editor-asset:([a-f0-9]{64})$/.exec(path)
  return composite ? `/image-editor-assets/${composite[1]}` : templateAssetRoute(path)
}

export function managedImageAssetFile(path: string): FileNodeInfo | undefined {
  const template = templateAssetFile(path)
  if (template) return template
  if (!managedImageAssetRoute(path)) return
  return {
    fullpath: path,
    name: '合成图片.png',
    type: 'file',
    bytes: 0,
    size: '',
    date: path,
    created_time: '',
    is_under_scanned_path: false
  }
}
