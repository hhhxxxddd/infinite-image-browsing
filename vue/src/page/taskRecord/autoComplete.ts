import { checkPathExists, type getGlobalSetting } from '@/api'
import type { ExtraPathType } from '@/api/db'
import { t } from '@/i18n'
import { useGlobalStore } from '@/store/useGlobalStore'
import { type ReturnTypeAsync } from '@/util'
import { normalizeRelativePathToAbsolute } from '@/util/path'
import { uniqBy } from 'lodash-es'
import { delay } from 'vue3-ts-util'

export const getQuickMovePaths = async ({
  working_dir,
  home,
  extra_paths
}: ReturnTypeAsync<typeof getGlobalSetting>) => {
  
  const pathMap = {
    cwd: working_dir,
    home,
    desktop: `${home}/Desktop`
  }
  Object.keys(pathMap).forEach((_k) => {
    const k = _k as keyof typeof pathMap
    if (pathMap[k]) {
      try {
        pathMap[k] = normalizeRelativePathToAbsolute(pathMap[k], working_dir)
      } catch (error) {
        console.error(error)
      }
    }
  })
  const exists = await checkPathExists(Object.values(pathMap).filter((v) => v))
  type Keys = keyof typeof pathMap
  const cnMap: Record<Keys, string> = {
    cwd: t('workingFolder'),
    home: 'home',
    desktop: t('desktop')
  }
  const g = useGlobalStore() as any
  g.extraPathAliasMap = {
    home: home,
    [t('desktop')]: pathMap.desktop,
    [t('workingFolder')]: working_dir,
    ...extra_paths.filter(v => v.alias).reduce((acc, v) => {
      acc[v.alias!] = normalizeRelativePathToAbsolute(v.path, working_dir)
      return acc
    }, {} as Record<string, string>)
  }
  await delay(0)
  const res = Object.keys(cnMap)
    .filter((k) => exists[pathMap[k as keyof typeof pathMap] as string])
    .map((k) => {
      const key = k as Keys
      return {
        key,
        zh: cnMap[key],
        dir: pathMap[key],
        can_delete: false,
        types: ['preset' as 'preset' | ExtraPathType]
      }
    }).concat(extra_paths.map(v => ({ key: v.path, zh: v.alias || g.getShortPath(v.path), dir: v.path, can_delete: true, types: v.types })) as any[])
  return uniqBy(res, v => v.key + v.types.join())
}
