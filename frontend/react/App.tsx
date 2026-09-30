import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Modal,
  PasswordInput,
  Text,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme
} from '@mantine/core'
import {
  IconAppWindow,
  IconArrowRight,
  IconCompass,
  IconAlertCircle,
  IconFolder,
  IconHeadphones,
  IconLayoutGrid,
  IconMoon,
  IconPhoto,
  IconSettings,
  IconSun,
  IconVideo,
  IconX
} from '@tabler/icons-react'
import { useMediaQuery } from '@mantine/hooks'
import {
  Component,
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode
} from 'react'
import { setAuthKeyPrompt } from './shared/apiClient'
import { EditorNavigationContext, type EditorKind } from './design/navigation'
import { useLanguage, type UiKey } from './design/i18n'
import { addOpenFolder, readOpenFolders, saveOpenFolders } from './design/openFolders'
import {
  addOpenComparison,
  comparisonId,
  readOpenComparisons,
  saveOpenComparisons
} from './design/openComparisons'
import type { ComparisonFile } from './features/comparison/ComparisonPage'
import { isTauri } from '@tauri-apps/api/core'
import { listen, TauriEvent } from '@tauri-apps/api/event'
import { getFolderIcons, getLibraryRoots } from './features/media/mediaApi'
import { FolderIcon } from './features/media/FolderIconPicker'

const MediaLibraryPage = memo(lazy(() => import('./features/media/MediaLibraryPage')))
const WorkbenchPage = memo(lazy(() => import('./features/workbench/WorkbenchPage')))
const DiscoveryPage = memo(lazy(() => import('./features/discover/DiscoveryPage')))
const SettingsPage = memo(lazy(() => import('./features/settings/SettingsPage')))
const EditorHub = memo(lazy(() => import('./features/editors/EditorHub')))
const ComparisonPage = memo(lazy(() => import('./features/comparison/ComparisonPage')))

type MediaSection = 'all' | 'image' | 'video' | 'audio' | 'folders'
type Page = 'media' | 'workbench' | 'discover' | 'settings' | 'compare'
type Route = {
  page: Page
  section: MediaSection
  folderPath?: string
  previewPath?: string
  comparison?: { left: ComparisonFile; right: ComparisonFile }
  editor?: { kind: EditorKind; draftId?: string; mediaPath?: string }
}

const editorKinds: EditorKind[] = ['image', 'video', 'audio', 'ai-image', 'ai-audio', 'ai-video']
const mediaSections: MediaSection[] = ['all', 'image', 'video', 'audio', 'folders']

function comparisonFile(value: unknown): ComparisonFile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const file = value as Record<string, unknown>
  if (typeof file.fullpath !== 'string' || !file.fullpath) return null
  return {
    fullpath: file.fullpath,
    name:
      typeof file.name === 'string' && file.name
        ? file.name
        : file.fullpath.split(/[\\/]/).pop() || file.fullpath
  }
}

function readRoute(): Route {
  const query = new URLSearchParams(window.location.search)
  const legacyAction = query.get('action')
  if (legacyAction === 'open' || legacyAction === 'view') {
    const target = query.get('path')?.trim()
    if (target) {
      const folderPath = legacyAction === 'view' ? target.replace(/[\\/][^\\/]+$/, '') : target
      return {
        page: 'media',
        section: 'folders',
        folderPath,
        ...(legacyAction === 'view' ? { previewPath: target } : {})
      }
    }
  }
  if (legacyAction === 'pane') {
    let props: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(query.get('props') || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        props = parsed as Record<string, unknown>
    } catch {
      // Malformed legacy links return to the media library.
    }
    const type = query.get('type')
    if (type === 'local' && typeof props.path === 'string')
      return { page: 'media', section: 'folders', folderPath: props.path }
    if (type === 'workbench') return { page: 'workbench', section: 'all' }
    if (type === 'global-setting') return { page: 'settings', section: 'all' }
    if (type === 'random-image') return { page: 'discover', section: 'all' }
    if (type === 'img-sli') {
      const left = comparisonFile(props.left)
      const right = comparisonFile(props.right)
      if (left && right) return { page: 'compare', section: 'all', comparison: { left, right } }
    }
    if (type === 'empty') {
      const section = mediaSections.includes(props.section as MediaSection)
        ? (props.section as MediaSection)
        : 'all'
      return { page: 'media', section }
    }
  }
  const requestedPage = query.get('page')
  const requestedSection = query.get('section')
  const requestedEditor = query.get('editor')
  const leftPath = query.get('left')
  const rightPath = query.get('right')
  const comparison =
    requestedPage === 'compare' && leftPath && rightPath
      ? {
          left: {
            fullpath: leftPath,
            name: query.get('leftName') || leftPath.split(/[\\/]/).pop() || leftPath
          },
          right: {
            fullpath: rightPath,
            name: query.get('rightName') || rightPath.split(/[\\/]/).pop() || rightPath
          }
        }
      : undefined
  return {
    page:
      requestedPage === 'workbench' ||
      requestedPage === 'discover' ||
      requestedPage === 'settings' ||
      (requestedPage === 'compare' && comparison)
        ? requestedPage
        : 'media',
    section: mediaSections.includes(requestedSection as MediaSection)
      ? (requestedSection as MediaSection)
      : 'all',
    folderPath: query.get('path') || undefined,
    previewPath: query.get('preview') || undefined,
    comparison,
    editor: editorKinds.includes(requestedEditor as EditorKind)
      ? {
          kind: requestedEditor as EditorKind,
          draftId: query.get('draft') || undefined,
          mediaPath: query.get('imagePath') || undefined
        }
      : undefined
  }
}

function writeRoute(route: Route): void {
  const query = new URLSearchParams()
  if (route.page !== 'media') query.set('page', route.page)
  if (route.page === 'media' && route.section !== 'all') query.set('section', route.section)
  if (route.page === 'media' && route.folderPath) query.set('path', route.folderPath)
  if (route.page === 'media' && route.previewPath) query.set('preview', route.previewPath)
  if (route.page === 'compare' && route.comparison) {
    query.set('left', route.comparison.left.fullpath)
    query.set('right', route.comparison.right.fullpath)
    query.set('leftName', route.comparison.left.name)
    query.set('rightName', route.comparison.right.name)
  }
  if (route.editor) {
    query.set('editor', route.editor.kind)
    if (route.editor.draftId) query.set('draft', route.editor.draftId)
    if (route.editor.mediaPath) query.set('imagePath', route.editor.mediaPath)
  }
  const nextUrl = `${window.location.pathname}${query.size ? `?${query}` : ''}`
  window.history.pushState(null, '', nextUrl)
}

const navGroups: {
  labelKey: UiKey
  items: { key: string; labelKey: UiKey; icon: ReactNode; page: Page; section?: MediaSection }[]
}[] = [
  {
    labelKey: 'mediaLibrary',
    items: [
      {
        key: 'all',
        labelKey: 'allMedia',
        icon: <IconLayoutGrid size={19} stroke={1.8} />,
        page: 'media',
        section: 'all'
      },
      {
        key: 'folders',
        labelKey: 'folders',
        icon: <IconFolder size={19} stroke={1.8} />,
        page: 'media',
        section: 'folders'
      },
      {
        key: 'image',
        labelKey: 'imagePlural',
        icon: <IconPhoto size={19} stroke={1.8} />,
        page: 'media',
        section: 'image'
      },
      {
        key: 'video',
        labelKey: 'videoPlural',
        icon: <IconVideo size={19} stroke={1.8} />,
        page: 'media',
        section: 'video'
      },
      {
        key: 'audio',
        labelKey: 'audioPlural',
        icon: <IconHeadphones size={19} stroke={1.8} />,
        page: 'media',
        section: 'audio'
      }
    ]
  },
  {
    labelKey: 'creation',
    items: [
      {
        key: 'workbench',
        labelKey: 'workbench',
        icon: <IconAppWindow size={19} stroke={1.8} />,
        page: 'workbench'
      },
      {
        key: 'discover',
        labelKey: 'discover',
        icon: <IconCompass size={19} stroke={1.8} />,
        page: 'discover'
      }
    ]
  }
]

function ErrorFallback() {
  const { t } = useLanguage()
  return (
    <div className="omni-content-inner">
      <div className="omni-panel omni-empty" role="alert">
        <IconAlertCircle size={35} stroke={1.4} />
        <strong>{t('pageUnavailable')}</strong>
        <span>{t('pageUnavailableHint')}</span>
        <Button variant="light" onClick={() => window.location.reload()}>
          {t('reloadPage')}
        </Button>
      </div>
    </div>
  )
}

class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('React 页面渲染失败', error)
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback />
    }
    return this.props.children
  }
}

export default function App() {
  const { t } = useLanguage()
  const [route, setRoute] = useState<Route>(readRoute)
  const [openFolders, setOpenFolders] = useState(readOpenFolders)
  const [openComparisons, setOpenComparisons] = useState(readOpenComparisons)
  const [folderIcons, setFolderIcons] = useState<Record<string, string>>({})
  const [folderAliases, setFolderAliases] = useState<Record<string, string>>({})
  const [viewOrder, setViewOrder] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem('omnigallery:open-view-order:v1') || '[]'
      )
      return Array.isArray(saved)
        ? saved.filter((key): key is string => typeof key === 'string')
        : []
    } catch {
      return []
    }
  })
  const [dropViewKey, setDropViewKey] = useState('')
  const [directoryViewsOpen, setDirectoryViewsOpen] = useState(true)
  const [sidebarPreference, setSidebarPreference] = useState<boolean | null>(() => {
    const saved = localStorage.getItem('omnigallery-react-sidebar')
    return saved === 'collapsed' ? true : saved === 'expanded' ? false : null
  })
  const compactByViewport = useMediaQuery('(max-width: 1000px)')
  const collapsed = sidebarPreference ?? compactByViewport
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('light')
  const [authOpen, setAuthOpen] = useState(false)
  const [authKey, setAuthKey] = useState('')
  const authResolve = useRef<((key: string) => void) | null>(null)
  const currentRoute = useRef(route)
  currentRoute.current = route
  const currentUrl = useRef(window.location.href)
  const popstatePending = useRef(false)
  const editorBeforeLeave = useRef<(() => Promise<boolean>) | null>(null)
  const registerEditorBeforeLeave = useCallback((handler: (() => Promise<boolean>) | null) => {
    editorBeforeLeave.current = handler
  }, [])

  useEffect(() => {
    currentUrl.current = window.location.href
  }, [route])

  useEffect(() => {
    if (!isTauri()) return
    let mounted = true
    let stopListening: (() => void) | undefined
    const isFolderView = () => {
      const current = currentRoute.current
      return (
        current.page === 'media' &&
        (current.section === 'folders' || !!current.folderPath) &&
        !current.editor
      )
    }
    const allowFileDrop = (event: DragEvent) => {
      if (
        event.dataTransfer?.types.includes('Files') &&
        !event.dataTransfer.types.includes('application/x-omnigallery-files')
      )
        event.preventDefault()
    }
    const forwardFileDrop = (event: DragEvent) => {
      if (
        !isFolderView() ||
        !event.dataTransfer?.files.length ||
        event.dataTransfer.types.includes('application/x-omnigallery-files')
      )
        return
      const hasDirectory =
        Array.from(event.dataTransfer.items).some(
          (item) => item.webkitGetAsEntry?.()?.isDirectory
        ) || Array.from(event.dataTransfer.files).some((file) => !file.type && file.size === 0)
      if (
        !hasDirectory &&
        event.target instanceof Element &&
        event.target.closest('.ml-search-form')
      )
        return
      event.preventDefault()
      if (hasDirectory) event.stopPropagation()
      const bridge = (
        window as Window & {
          chrome?: {
            webview?: {
              postMessageWithAdditionalObjects?: (message: string, files: FileList) => void
            }
          }
        }
      ).chrome?.webview
      bridge?.postMessageWithAdditionalObjects?.(
        '__TAURI_PLUGIN_WIN_FILE_DROP__',
        event.dataTransfer.files
      )
    }
    document.addEventListener('dragover', allowFileDrop, true)
    document.addEventListener('drop', forwardFileDrop, true)
    void listen<{ paths: string[] }>(
      TauriEvent.DRAG_DROP,
      (event) => {
        if (!isFolderView()) return
        window.dispatchEvent(
          new CustomEvent('omnigallery:native-file-drop', {
            detail: { paths: event.payload.paths }
          })
        )
      },
      { target: { kind: 'WebviewWindow', label: 'main' } }
    )
      .then((unlisten) => {
        if (mounted) stopListening = unlisten
        else unlisten()
      })
      .catch((error: unknown) => console.error('系统文件拖放未能连接', error))
    return () => {
      mounted = false
      stopListening?.()
      document.removeEventListener('dragover', allowFileDrop, true)
      document.removeEventListener('drop', forwardFileDrop, true)
    }
  }, [])

  useEffect(() => {
    const onPopState = () => {
      const targetUrl = window.location.href
      const next = readRoute()
      const active = currentRoute.current.editor
      const destination = next.editor
      const leavingEditor =
        active &&
        (active.kind !== destination?.kind ||
          active.draftId !== destination?.draftId ||
          active.mediaPath !== destination?.mediaPath)
      const guard = editorBeforeLeave.current
      if (!leavingEditor || !guard) {
        currentUrl.current = targetUrl
        setRoute(next)
        return
      }
      // Keep the editor mounted while its save queue finishes. The browser has
      // already changed the URL by the time popstate fires.
      window.history.replaceState(window.history.state, '', currentUrl.current)
      if (popstatePending.current) return
      popstatePending.current = true
      void guard()
        .then((canLeave) => {
          if (!canLeave) return
          window.history.replaceState(window.history.state, '', targetUrl)
          currentUrl.current = targetUrl
          setRoute(next)
        })
        .catch((error) => {
          console.error('离开编辑器前保存失败', error)
        })
        .finally(() => {
          popstatePending.current = false
        })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => saveOpenFolders(openFolders), [openFolders])
  useEffect(() => saveOpenComparisons(openComparisons), [openComparisons])
  useEffect(() => {
    try {
      localStorage.setItem('omnigallery:open-view-order:v1', JSON.stringify(viewOrder))
    } catch {
      /* Storage may be disabled. */
    }
  }, [viewOrder])
  useEffect(() => {
    let active = true
    const refresh = () => {
      void Promise.allSettled([getFolderIcons(), getLibraryRoots()]).then(([icons, roots]) => {
        if (!active) return
        if (icons.status === 'fulfilled') setFolderIcons(icons.value)
        if (roots.status === 'fulfilled')
          setFolderAliases(
            Object.fromEntries(
              roots.value.filter((root) => root.alias).map((root) => [root.path, root.alias || ''])
            )
          )
      })
    }
    const updated = (event: Event) => {
      const detail = (event as CustomEvent<{ oldPath?: string; newPath?: string }>).detail
      if (detail?.oldPath && detail.newPath) {
        const { oldPath, newPath } = detail
        setOpenFolders((folders) =>
          folders.map((folder) => {
            const suffix =
              folder.path === oldPath
                ? ''
                : folder.path.startsWith(`${oldPath}/`) || folder.path.startsWith(`${oldPath}\\`)
                  ? folder.path.slice(oldPath.length)
                  : null
            if (suffix === null) return folder
            const path = `${newPath}${suffix}`
            return { path, name: path.split(/[\\/]/).filter(Boolean).at(-1) || path }
          })
        )
        setViewOrder((keys) =>
          keys.map((key) => (key === `folder:${oldPath}` ? `folder:${newPath}` : key))
        )
      }
      refresh()
    }
    refresh()
    window.addEventListener('omnigallery:folders-updated', updated)
    return () => {
      active = false
      window.removeEventListener('omnigallery:folders-updated', updated)
    }
  }, [route.page, route.folderPath])
  useEffect(() => {
    if (!route.comparison) return
    const { left, right } = route.comparison
    setOpenComparisons((comparisons) => addOpenComparison(comparisons, left, right))
  }, [route.comparison])

  useEffect(() => {
    setAuthKeyPrompt(
      () =>
        new Promise<string>((resolve) => {
          authResolve.current = resolve
          setAuthKey('')
          setAuthOpen(true)
        })
    )
    return () => {
      setAuthKeyPrompt(undefined)
      authResolve.current?.('')
      authResolve.current = null
    }
  }, [])

  const navigate = useCallback((page: Page, section: MediaSection = 'all') => {
    const next: Route = { page, section }
    writeRoute(next)
    setRoute(next)
  }, [])

  const navigateToFolder = useCallback((path: string) => {
    const next: Route = { page: 'media', section: 'folders', folderPath: path }
    writeRoute(next)
    setRoute(next)
    setOpenFolders((folders) => addOpenFolder(folders, path))
  }, [])

  const navigateToComparison = useCallback((left: ComparisonFile, right: ComparisonFile) => {
    const next: Route = { page: 'compare', section: 'all', comparison: { left, right } }
    writeRoute(next)
    setRoute(next)
    setOpenComparisons((comparisons) => addOpenComparison(comparisons, left, right))
  }, [])

  const onFolderChange = useCallback(
    (path: string) => {
      if (route.page !== 'media' || (route.folderPath || '') === path) return
      const next: Route = {
        page: 'media',
        section: path ? 'folders' : route.section,
        folderPath: path || undefined
      }
      writeRoute(next)
      setRoute(next)
      if (path) setOpenFolders((folders) => addOpenFolder(folders, path))
    },
    [route]
  )

  const closeFolderView = useCallback(
    (path: string) => {
      setOpenFolders((folders) => folders.filter((folder) => folder.path !== path))
      if (route.folderPath === path) navigate('media', 'folders')
    },
    [navigate, route.folderPath]
  )

  const closeComparisonView = useCallback(
    (id: string) => {
      setOpenComparisons((comparisons) => comparisons.filter((comparison) => comparison.id !== id))
      if (
        route.page === 'compare' &&
        route.comparison &&
        comparisonId(route.comparison.left, route.comparison.right) === id
      )
        navigate('media', 'folders')
    },
    [navigate, route]
  )

  const openEditor = useCallback(
    (kind: EditorKind, draftId?: string) => {
      const next = { ...route, editor: { kind, draftId } }
      writeRoute(next)
      setRoute(next)
    },
    [route]
  )

  const closeEditor = useCallback(() => {
    const next = { ...route, editor: undefined }
    writeRoute(next)
    setRoute(next)
  }, [route])
  const editMedia = useCallback(
    (mediaPath: string) => {
      const next: Route = { ...route, editor: { kind: 'image', mediaPath } }
      writeRoute(next)
      setRoute(next)
    },
    [route]
  )

  const finishAuth = (key: string) => {
    authResolve.current?.(key)
    authResolve.current = null
    setAuthOpen(false)
  }

  const activeKey = route.page === 'media' ? route.section : route.page
  const toggleSidebar = () => {
    const next = !collapsed
    setSidebarPreference(next)
    localStorage.setItem('omnigallery-react-sidebar', next ? 'collapsed' : 'expanded')
  }
  const openedViews = [
    ...openFolders.map((folder) => ({
      key: `folder:${folder.path}`,
      name: folderAliases[folder.path] || folder.name,
      path: folder.path,
      comparison: null
    })),
    ...openComparisons.map((comparison) => ({
      key: `compare:${comparison.id}`,
      name: comparison.name,
      path: '',
      comparison
    }))
  ].sort((left, right) => {
    const a = viewOrder.indexOf(left.key)
    const b = viewOrder.indexOf(right.key)
    return (a < 0 ? Infinity : a) - (b < 0 ? Infinity : b)
  })
  const dropOpenedView = (event: ReactDragEvent, key: string, path: string) => {
    event.preventDefault()
    setDropViewKey('')
    const source = event.dataTransfer.getData('application/x-omnigallery-open-view')
    if (source && source !== key) {
      const keys = openedViews.map((view) => view.key).filter((item) => item !== source)
      keys.splice(keys.indexOf(key), 0, source)
      setViewOrder(keys)
      return
    }
    if (!path || route.page !== 'media') return
    try {
      const paths: unknown = JSON.parse(
        event.dataTransfer.getData('application/x-omnigallery-files')
      )
      if (!Array.isArray(paths) || !paths.every((item) => typeof item === 'string')) return
      window.dispatchEvent(
        new CustomEvent('omnigallery:sidebar-file-drop', {
          detail: { paths, destination: path, copy: event.ctrlKey || event.metaKey }
        })
      )
    } catch {
      /* Ignore external or malformed drag payloads. */
    }
  }

  const editorNavigation = useMemo(() => ({ openEditor, closeEditor }), [openEditor, closeEditor])

  return (
    <EditorNavigationContext.Provider value={editorNavigation}>
      {route.editor ? (
        <PageErrorBoundary
          key={`${route.editor.kind}:${route.editor.draftId || route.editor.mediaPath || ''}`}
        >
          <Suspense
            fallback={
              <div className="omni-loading-screen" role="status" aria-label={t('loadingEditor')}>
                <Loader size="sm" />
              </div>
            }
          >
            <EditorHub
              kind={route.editor.kind}
              draftId={route.editor.draftId}
              mediaPath={route.editor.mediaPath}
              onClose={closeEditor}
              onBeforeLeaveChange={registerEditorBeforeLeave}
            />
          </Suspense>
        </PageErrorBoundary>
      ) : (
        <div className={`omni-app${collapsed ? ' is-collapsed' : ''}`}>
          <aside className="omni-sidebar" aria-label={t('mainNavigation')}>
            <div className="omni-brand">
              <button
                className="omni-brand-mark"
                type="button"
                onClick={toggleSidebar}
                aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
                aria-expanded={!collapsed}
                title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
              >
                <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="43" height="43" />
              </button>
              <span className="omni-brand-copy">
                <span className="omni-brand-name">万象馆</span>
                <span className="omni-brand-subtitle">{t('brandSubtitle')}</span>
              </span>
            </div>
            <nav className="omni-side-scroll" aria-label={t('pages')}>
              {navGroups.map((group) => (
                <div key={group.labelKey}>
                  <div className="omni-side-label">{t(group.labelKey)}</div>
                  {group.items.map((item) =>
                    item.key === 'folders' ? (
                      <div className="omni-directory-group" key={item.key}>
                        <div className="omni-directory-row">
                          <Tooltip
                            label={collapsed ? t('expandSidebar') : t('folders')}
                            disabled={!collapsed}
                            position="right"
                            withArrow
                          >
                            <button
                              type="button"
                              className={`omni-nav-item omni-directory-toggle${activeKey === 'folders' || activeKey === 'compare' ? ' is-active' : ''}`}
                              aria-label={t('folders')}
                              aria-expanded={!collapsed && directoryViewsOpen}
                              aria-controls="omni-open-folders"
                              aria-describedby={
                                openedViews.length ? 'omni-open-view-count' : undefined
                              }
                              onClick={() => {
                                if (collapsed) setSidebarPreference(false)
                                else setDirectoryViewsOpen((open) => !open)
                              }}
                            >
                              <span className="omni-nav-icon">{item.icon}</span>
                              <span className="omni-nav-text">{t(item.labelKey)}</span>
                              {openedViews.length > 0 && (
                                <span
                                  id="omni-open-view-count"
                                  className="omni-directory-count"
                                  aria-label={`${t('openedTabs')}: ${openedViews.length}`}
                                  title={`${t('openedTabs')}: ${openedViews.length}`}
                                >
                                  {openedViews.length > 99 ? '99+' : openedViews.length}
                                </span>
                              )}
                            </button>
                          </Tooltip>
                          {!collapsed && (
                            <Tooltip label={t('folders')} position="right" withArrow>
                              <button
                                className="omni-directory-entry"
                                type="button"
                                aria-label={`${t('folders')} →`}
                                onClick={() => navigate('media', 'folders')}
                              >
                                <IconArrowRight size={17} stroke={1.8} />
                              </button>
                            </Tooltip>
                          )}
                        </div>
                        <div
                          id="omni-open-folders"
                          className={`omni-open-folders${!collapsed && directoryViewsOpen ? ' is-open' : ''}`}
                          aria-hidden={collapsed || !directoryViewsOpen}
                          inert={collapsed || !directoryViewsOpen}
                        >
                          <div className="omni-open-folders-clip">
                            {openedViews.map((view) => (
                              <div
                                className={`omni-open-folder${dropViewKey === view.key ? ' is-drop-target' : ''}`}
                                key={view.key}
                                onDragOver={(event) => {
                                  const types = event.dataTransfer.types
                                  if (
                                    !types.includes('application/x-omnigallery-open-view') &&
                                    !(
                                      view.path &&
                                      route.page === 'media' &&
                                      types.includes('application/x-omnigallery-files')
                                    )
                                  )
                                    return
                                  event.preventDefault()
                                  event.dataTransfer.dropEffect = types.includes(
                                    'application/x-omnigallery-open-view'
                                  )
                                    ? 'move'
                                    : event.ctrlKey || event.metaKey
                                      ? 'copy'
                                      : 'move'
                                  setDropViewKey(view.key)
                                }}
                                onDragLeave={(event) => {
                                  if (!event.currentTarget.contains(event.relatedTarget as Node))
                                    setDropViewKey('')
                                }}
                                onDrop={(event) => dropOpenedView(event, view.key, view.path)}
                              >
                                <button
                                  className={`omni-open-folder-link${view.path ? (route.folderPath === view.path ? ' is-active' : '') : route.comparison && comparisonId(route.comparison.left, route.comparison.right) === view.comparison?.id ? ' is-active' : ''}`}
                                  type="button"
                                  title={view.path || view.name}
                                  draggable
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData(
                                      'application/x-omnigallery-open-view',
                                      view.key
                                    )
                                    event.dataTransfer.effectAllowed = 'move'
                                  }}
                                  onDragEnd={() => setDropViewKey('')}
                                  onClick={() => {
                                    if (view.comparison)
                                      navigateToComparison(
                                        view.comparison.left,
                                        view.comparison.right
                                      )
                                    else navigateToFolder(view.path)
                                  }}
                                >
                                  {view.path ? (
                                    <FolderIcon value={folderIcons[view.path]} size={16} />
                                  ) : (
                                    <IconPhoto size={16} stroke={1.7} />
                                  )}
                                  <span>{view.name}</span>
                                </button>
                                <button
                                  className="omni-open-folder-close"
                                  type="button"
                                  aria-label={`${t('closeView')} ${view.name}`}
                                  onClick={() => {
                                    if (view.comparison) closeComparisonView(view.comparison.id)
                                    else closeFolderView(view.path)
                                  }}
                                >
                                  <IconX size={14} stroke={1.8} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <Tooltip
                        key={item.key}
                        label={t(item.labelKey)}
                        disabled={!collapsed}
                        position="right"
                        withArrow
                      >
                        <button
                          type="button"
                          className={`omni-nav-item${activeKey === item.key ? ' is-active' : ''}`}
                          aria-current={activeKey === item.key ? 'page' : undefined}
                          aria-label={t(item.labelKey)}
                          onClick={() => navigate(item.page, item.section)}
                        >
                          <span className="omni-nav-icon">{item.icon}</span>
                          <span className="omni-nav-text">{t(item.labelKey)}</span>
                        </button>
                      </Tooltip>
                    )
                  )}
                </div>
              ))}
            </nav>
            <div className="omni-side-footer">
              <div className="omni-side-footer-row">
                <Tooltip label={t('settings')} disabled={!collapsed} position="right" withArrow>
                  <button
                    type="button"
                    className={`omni-nav-item${route.page === 'settings' ? ' is-active' : ''}`}
                    aria-current={route.page === 'settings' ? 'page' : undefined}
                    aria-label={t('settings')}
                    onClick={() => navigate('settings')}
                  >
                    <span className="omni-nav-icon">
                      <IconSettings size={19} stroke={1.8} />
                    </span>
                    <span className="omni-nav-text">{t('settings')}</span>
                  </button>
                </Tooltip>
                <Tooltip
                  label={computedColorScheme === 'dark' ? t('switchLight') : t('switchDark')}
                >
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="md"
                    aria-label={computedColorScheme === 'dark' ? t('switchLight') : t('switchDark')}
                    onClick={() =>
                      setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark')
                    }
                  >
                    {computedColorScheme === 'dark' ? (
                      <IconSun size={19} />
                    ) : (
                      <IconMoon size={19} />
                    )}
                  </ActionIcon>
                </Tooltip>
              </div>
            </div>
          </aside>

          <main className="omni-main">
            <div className="omni-content" key={`${route.page}:${route.section}`}>
              <PageErrorBoundary>
                <Suspense
                  fallback={
                    <div className="omni-content-inner omni-page-loading" role="status">
                      <Loader size="sm" />
                      <span>{t('loadingPage')}</span>
                    </div>
                  }
                >
                  {route.page === 'media' && (
                    <MediaLibraryPage
                      section={route.section}
                      initialPath={route.folderPath}
                      initialPreviewPath={route.previewPath}
                      onFolderChange={onFolderChange}
                      onEditMedia={editMedia}
                      onOpenEditor={openEditor}
                    />
                  )}
                  {route.page === 'workbench' && <WorkbenchPage />}
                  {route.page === 'settings' && <SettingsPage />}
                  {route.page === 'discover' && <DiscoveryPage />}
                  {route.page === 'compare' && route.comparison && (
                    <ComparisonPage left={route.comparison.left} right={route.comparison.right} />
                  )}
                </Suspense>
              </PageErrorBoundary>
            </div>
          </main>
        </div>
      )}

      <Modal
        opened={authOpen}
        onClose={() => finishAuth('')}
        title={t('serverKeyTitle')}
        centered
        closeOnClickOutside={false}
      >
        <Text size="sm" c="dimmed" mb="md">
          {t('serverKeyHint')}
        </Text>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            finishAuth(authKey)
          }}
        >
          <PasswordInput
            autoFocus
            label={t('accessKey')}
            value={authKey}
            onChange={(event) => setAuthKey(event.currentTarget.value)}
          />
          <Group justify="flex-end" mt="lg">
            <Button variant="default" onClick={() => finishAuth('')}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!authKey.trim()}>
              {t('continue')}
            </Button>
          </Group>
        </form>
      </Modal>
    </EditorNavigationContext.Provider>
  )
}
