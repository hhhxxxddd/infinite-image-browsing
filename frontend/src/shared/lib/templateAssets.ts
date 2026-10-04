import type { FileNodeInfo } from '../types/fileNode.ts'

/** Opaque managed references survive root migration and workspace/library changes. */
export function templateAssetRoute(path: string): string | undefined {
  const material = /^template-asset:([a-f0-9]{64})$/.exec(path)
  if (material) return `/template-assets/${material[1]}`
  const library = /^template-library:([\w-]{1,80}):([a-f0-9]{64})$/.exec(path)
  if (library) return `/templates/${library[1]}/assets/${library[2]}`
}

export function templateAssetFile(path: string): FileNodeInfo | undefined {
  if (!templateAssetRoute(path)) return
  return {
    fullpath: path,
    name: '模板配图.png',
    type: 'file',
    bytes: 0,
    size: '',
    date: path,
    created_time: '',
    is_under_scanned_path: false
  }
}
