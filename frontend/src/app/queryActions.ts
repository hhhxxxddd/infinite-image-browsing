import type {
  FileTransferTabPane,
  TabPane,
  useApplicationStore
} from '@/features/application/public'
import { removeQueryParams } from '@/shared/lib/queryParameters'
import { uniqueId } from 'lodash-es'
import { parseTabPane } from '@/features/application/public'
import { getParentDirectory, basename, normalize } from '../shared/lib/path'

export const resolveQueryActions = async (g: ReturnType<typeof useApplicationStore>) => {
  const params = new URLSearchParams(parent.location.search)
  const action = params.get('action')

  switch (action) {
    case 'view': {
      // Quick view action: open image in fullscreen preview
      // Usage: ?action=view&path=/path/to/image.png
      let imagePath = params.get('path')
      if (!imagePath) {
        console.error('[OmniGallery] view action requires path parameter')
        return
      }
      imagePath = normalize(imagePath)

      // Get parent folder and use scanned-fixed mode
      const folderPath = getParentDirectory(imagePath)
      const imageName = basename(imagePath)

      const tab = g.tabList[0]
      const pane: FileTransferTabPane = {
        type: 'local',
        path: folderPath,
        key: uniqueId(),
        name: imageName,
        mode: 'scanned-fixed',
        targetFile: imagePath,
        openPreview: true
      }

      tab.panes.unshift(pane)
      tab.key = pane.key

      removeQueryParams(['action', 'path'])
      break
    }
    case 'open': {
      const path = params.get('path')

      if (!path) return
      const tab = g.tabList[0]
      const mode = params.get('mode') as FileTransferTabPane['mode']
      const pane: FileTransferTabPane = {
        type: 'local',
        path,
        key: uniqueId(),
        name: '',
        mode: (['scanned', 'walk', 'scanned-fixed'] as const).includes(mode || 'scanned')
          ? mode
          : 'scanned'
      }
      tab.panes.unshift(pane)
      tab.key = pane.key

      removeQueryParams(['action', 'path', 'mode'])
      break
    }
    case 'pane': {
      const type = params.get('type') as TabPane['type']
      const propsJson = params.get('props')

      // Validate pane type
      const validTypes: TabPane['type'][] = [
        'local',
        'grid-view',
        'img-sli',
        'random-image',
        'workbench',
        'batch-download',
        'global-setting',
        'empty'
      ]

      if (!type || !validTypes.includes(type)) {
        console.error('[OmniGallery] Invalid or missing pane type:', type)
        return
      }

      let props: unknown = {}
      try {
        if (propsJson) {
          props = JSON.parse(propsJson)
        }
      } catch (e) {
        console.error('[OmniGallery] Failed to parse pane props:', e)
        return
      }

      if (!props || typeof props !== 'object' || Array.isArray(props)) return
      const pane = parseTabPane({ ...props, key: uniqueId(), type })
      if (pane) {
        const tab = g.tabList[0]
        tab.panes.unshift(pane)
        tab.key = pane.key
      }
      removeQueryParams(['action', 'type', 'props'])
      break
    }
  }
}
