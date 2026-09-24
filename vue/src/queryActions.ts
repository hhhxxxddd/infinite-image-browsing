import type { FileTransferTabPane, TabPane, useGlobalStore, GridViewTabPane, ImgSliTabPane } from './store/useGlobalStore'
import { removeQueryParams } from './util'
import { uniqueId } from 'lodash-es'
import { getParentDirectory, basename, normalize } from './util/path'

const createPaneFromType = (type: TabPane['type'], props: any): TabPane | null => {
  const base = {
    key: uniqueId(),
    name: props.name ?? ''
  }

  switch (type) {
    case 'empty': {
      const section = ['all', 'image', 'video', 'folders'].includes(props.section) ? props.section : 'all'
      return { ...base, type, section }
    }
    case 'local': {
      const pane: FileTransferTabPane = {
        ...base,
        type,
        path: props.path,
        mode: props.mode,
        stackKey: props.stackKey,
        targetFile: props.targetFile,
        openPreview: props.openPreview
      }
      return pane
    }
    case 'grid-view': {
      const pane: GridViewTabPane = {
        ...base,
        type,
        files: props.files ?? [],
        removable: props.removable,
        allowDragAndDrop: props.allowDragAndDrop
      }
      return pane
    }
    case 'img-sli': {
      const pane: ImgSliTabPane = {
        ...base,
        type,
        left: props.left,
        right: props.right
      }
      return pane
    }
    case 'random-image': {
      const pane: TabPane = {
        ...base,
        type
      }
      return pane
    }
    case 'workbench': {
      const pane: TabPane = { ...base, type }
      return pane
    }
    case 'batch-download':
    case 'global-setting': {
      const pane: TabPane = {
        ...base,
        type
      }
      return pane
    }
    default:
      return null
  }
}

export const resolveQueryActions = async (g: ReturnType<typeof useGlobalStore>) => {
  const params = new URLSearchParams(parent.location.search)
  const action = params.get('action')

  switch (action) {
    case 'view': {
      // Quick view action: open image in fullscreen preview
      // Usage: ?action=view&path=/path/to/image.png
      let imagePath = params.get('path')
      if (!imagePath) {
        console.error('[IIB] view action requires path parameter')
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
        mode: (['scanned', 'walk', 'scanned-fixed'] as const).includes(mode || 'scanned') ? mode : 'scanned'
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
        console.error('[IIB] Invalid or missing pane type:', type)
        return
      }

      let props: any = {}
      try {
        if (propsJson) {
          props = JSON.parse(decodeURIComponent(propsJson))
        }
      } catch (e) {
        console.error('[IIB] Failed to parse pane props:', e)
        return
      }

      const pane = createPaneFromType(type, props)
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
