import { childFolderPath } from './folderName.ts'

const normalized = (path: string, windows: boolean) => {
  const value = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return windows ? value.toLocaleLowerCase() : value
}

export function folderMoveTarget(source: string, destination: string, registeredPaths: string[], windows = false) {
  const from = normalized(source, windows)
  const to = normalized(destination, windows)
  if (registeredPaths.some(path => normalized(path, windows) === from)) throw new Error('已添加的根目录不能移动，请移动其子目录')
  if (!registeredPaths.some(path => from.startsWith(`${normalized(path, windows)}/`))) throw new Error('只能移动已添加文件夹内的子目录')
  if (!registeredPaths.some(path => to === normalized(path, windows) || to.startsWith(`${normalized(path, windows)}/`))) throw new Error('目标必须位于已添加的文件夹内')
  if (registeredPaths.some(path => normalized(path, windows).startsWith(`${from}/`))) throw new Error('此目录包含已添加的文件夹，不能移动')
  if (from === to || to.startsWith(`${from}/`)) throw new Error('不能把目录移动到自身或其子目录')
  if (from.slice(0, from.lastIndexOf('/')) === to) throw new Error('该目录已经位于目标位置')
  const name = source.split(/[\\/]/).filter(Boolean).pop()
  if (!name) throw new Error('无法识别要移动的目录')
  return childFolderPath(destination, name, windows)
}
