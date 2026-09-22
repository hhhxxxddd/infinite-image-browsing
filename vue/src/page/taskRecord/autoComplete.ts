import type { getGlobalSetting } from '@/api'
import { useGlobalStore } from '@/store/useGlobalStore'
import { type ReturnTypeAsync } from '@/util'
import { normalizeRelativePathToAbsolute } from '@/util/path'
import { uniqBy } from 'lodash-es'

export const getQuickMovePaths = async ({ working_dir, extra_paths }: ReturnTypeAsync<typeof getGlobalSetting>) => {
  const global = useGlobalStore()
  const folders = extra_paths.filter(folder => folder.types.some(type => type === 'walk' || type === 'scanned'))
  global.extraPathAliasMap = Object.fromEntries(folders.filter(folder => folder.alias).map(folder => [
    folder.alias!, normalizeRelativePathToAbsolute(folder.path, working_dir)
  ]))
  return uniqBy(folders.map(folder => ({
    key: folder.path,
    zh: folder.alias || folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path,
    dir: normalizeRelativePathToAbsolute(folder.path, working_dir),
    can_delete: true,
    types: folder.types
  })), folder => folder.dir)
}
