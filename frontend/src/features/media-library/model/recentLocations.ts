import type { getGlobalSetting } from '@/features/application/public'
import { useApplicationStore } from '@/features/application/public'
import { type ReturnTypeAsync } from '@/shared/types/common'
import { normalizeRelativePathToAbsolute } from '@/shared/lib/path'
import { uniqBy } from 'lodash-es'

export const getQuickMovePaths = async ({
  working_dir,
  extra_paths
}: ReturnTypeAsync<typeof getGlobalSetting>) => {
  const global = useApplicationStore()
  const folders = extra_paths.filter((folder) =>
    folder.types.some((type) => type === 'walk' || type === 'scanned')
  )
  global.extraPathAliasMap = Object.fromEntries(
    folders
      .filter((folder) => folder.alias)
      .map((folder) => [folder.alias, normalizeRelativePathToAbsolute(folder.path, working_dir)])
  )
  return uniqBy(
    folders.map((folder) => ({
      key: folder.path,
      zh: folder.alias || folder.path.split(/[\\/]/).filter(Boolean).pop() || folder.path,
      dir: normalizeRelativePathToAbsolute(folder.path, working_dir),
      can_delete: true,
      types: folder.types
    })),
    (folder) => folder.dir
  )
}
