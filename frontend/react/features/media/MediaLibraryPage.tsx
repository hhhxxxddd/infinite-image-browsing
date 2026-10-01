import { useNotice } from '../../shared/notices'
import { LazyModal } from '../../shared/LazyModal'
import { tagColor } from '../../design/tagColors'
import { AISearchGlow } from './AISearchGlow'
import { MediaTagMenu } from './MediaTagMenu'
import { MediaTagPicker } from './MediaTagPicker'
import { groupTags } from '../../../src/features/media-library/model/tagGroups'
import { tagLabel } from '../../../src/features/media-library/model/tagLabel'
import { MediaArtwork } from './MediaArtwork'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useCallbackRef } from '@mantine/hooks'
import { isTauri } from '@tauri-apps/api/core'
import { open as openDesktopFolderPicker } from '@tauri-apps/plugin-dialog'
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Group,
  Loader,
  Menu,
  NumberInput,
  Popover,
  Portal,
  Radio,
  SegmentedControl,
  Select,
  Skeleton,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip
} from '@mantine/core'
import {
  IconArrowLeft,
  IconCopy,
  IconCrop,
  IconDots,
  IconDownload,
  IconExternalLink,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconHeart,
  IconHeartFilled,
  IconHeadphones,
  IconHelpCircle,
  IconLayoutGrid,
  IconMusic,
  IconPhoto,
  IconPencil,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSparkles,
  IconTags,
  IconTagPlus,
  IconTagMinus,
  IconTrash,
  IconVideo,
  IconX
} from '@tabler/icons-react'
import { fileDisplayName } from '../../../src/shared/lib/fileDisplayName'
import { topLevelManagedFolders } from '../../../src/shared/lib/folderScope'
import {
  addWorkspaceAssets,
  readWorkspaceRecords,
  type WorkspaceAsset,
  type WorkspaceRecord
} from '../../../src/features/workspaces/model/workspaceModel'
import { apiFetch } from '../../shared/apiClient'
import { browsePreferencesEvent, readBrowsePreferences } from '../settings/browsePreferences'
import { mediaCardWidth } from './masonryModel'
import { generalPreferencesEvent, readGeneralPreferences } from '../settings/generalPreferences'
import {
  addLibraryRoot,
  aliasLibraryRoot,
  batchUpdateMediaTags,
  createFolder,
  deleteMediaFiles,
  emptyFilters,
  exportMediaArchive,
  flattenFolder,
  getFolderChildren,
  getFolderIcons,
  getFolderPickerPath,
  getArtifactMetadata,
  getExpiredDirectories,
  getArchiveSettings,
  getLibraryInfo,
  getLibraryRoots,
  getReadOnlyMode,
  getMediaTags,
  getSelectedCustomTags,
  setMediaCustomTags,
  getVisualSearchStatus,
  getVisualRerankerStatus,
  isAnimatedMedia,
  isEditableOriginalImage,
  mediaKind,
  openContainingFolder,
  openWithAppPicker,
  rawMediaUrl,
  removeLibraryRoot,
  renameMediaFile,
  renameFolder,
  resetMediaOrder,
  scanLibrary,
  searchByDescription,
  searchMedia,
  searchSimilarMedia,
  startVisualSearchIndex,
  thumbnailUrl,
  toggleMediaTag,
  toggleArtifactTag,
  transferMediaFiles,
  swapMediaOrder,
  checkFolderPath,
  checkDirectoryPaths,
  checkPathsExist,
  type AudioMetadata,
  type FlattenFolderResult,
  type LibraryRoot,
  type MediaFile,
  type MediaFilters,
  type MediaSection,
  type MediaTag,
  type SimilarResult,
  type VisualSearchResult,
  type VisualSearchStatus
} from './mediaApi'
import { MediaPreview } from './MediaPreview'
import { DirectoryWalker } from './directoryWalk'
import MediaFilterForm from './MediaFilterForm'
import { MediaFilterPanel } from './MediaFilterPanel'
import { ComparisonView } from './ComparisonView'
import { useMediaText } from './mediaLocale'
import { createMediaDraft, readMediaDraftTarget, type MediaDraftTarget } from './createMediaDraft'
import { FolderGraphNode, type FolderAction } from './FolderGraphNode'
import { FolderIconPicker } from './FolderIconPicker'
import { MasonryGallery } from './MasonryGallery'
import { MediaLibraryViewControls } from './MediaLibraryViewControls'
import { toggleMediaSelection } from './mediaSelection'
import './mediaLibrary.css'
import './mediaGallery.css'

type EditorKind = 'image' | 'video' | 'audio' | 'ai-image' | 'ai-audio' | 'ai-video'

interface MediaLibraryPageProps {
  section: MediaSection
  initialPath?: string
  initialPreviewPath?: string
  onFolderChange?: (path: string) => void
  onOpenEditor?: (kind: EditorKind, draftId?: string) => void
  onEditMedia?: (path: string) => void
}

type SimilarSource = { name: string; preview: string; path?: string; image_base64?: string }
type SortMode = 'manual' | 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc' | 'size-desc'

const kindLabels = { image: '图片', video: '视频', audio: '音频', other: '文件' }
const sortOptions: { value: SortMode; label: string }[] = [
  { value: 'manual', label: '自定义顺序' },
  { value: 'date-desc', label: '最近更新' },
  { value: 'date-asc', label: '最早更新' },
  { value: 'name-asc', label: '名称 A–Z' },
  { value: 'name-desc', label: '名称 Z–A' },
  { value: 'size-desc', label: '文件大小' }
]

function errorText(error: unknown, fallback = '操作失败，请重试') {
  return error instanceof Error ? error.message : fallback
}

function basename(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

function joinPath(parent: string, child: string) {
  return `${parent.replace(/[\\/]+$/, '')}${parent.includes('\\') ? '\\' : '/'}${child}`
}

function compareMedia(a: MediaFile, b: MediaFile, sort: SortMode) {
  if (sort === 'manual') return 0
  if (sort === 'date-desc') return b.date.localeCompare(a.date)
  if (sort === 'date-asc') return a.date.localeCompare(b.date)
  if (sort === 'name-asc') return a.name.localeCompare(b.name, 'zh')
  if (sort === 'name-desc') return b.name.localeCompare(a.name, 'zh')
  return (b.bytes || 0) - (a.bytes || 0)
}

function scoreLabel(value: number) {
  return Math.round(Math.max(0, Math.min(100, value <= 1 ? value * 100 : value)))
}

function announceFoldersUpdated(oldPath?: string, newPath?: string) {
  window.dispatchEvent(
    new CustomEvent('omnigallery:folders-updated', {
      detail: oldPath && newPath ? { oldPath, newPath } : undefined
    })
  )
}

type MediaCardAction =
  | 'open'
  | 'favorite'
  | 'similar'
  | 'tags'
  | 'workspace'
  | 'rename'
  | 'delete'
  | 'copy-path'
  | 'open-folder'
  | 'open-external'
  | 'edit-original'
  | 'download'

interface MediaCardActions {
  dispatch: (action: MediaCardAction, file: MediaFile) => void
  select: (path: string, range: boolean) => void
  toggleTag: (file: MediaFile, tag: MediaTag) => void
  reorder: (source: string, target: string) => void
  batchTag: (action: 'add' | 'remove', tag: MediaTag) => void
  getDragPaths: (path: string) => string[]
}

const emptyCardTags: MediaTag[] = []

interface MediaCardProps {
  file: MediaFile
  tags: MediaTag[]
  availableTags: MediaTag[]
  favoriteTag?: MediaTag
  thumbnailsEnabled: boolean
  thumbnailSize: number
  longPressOpenContextMenu: boolean
  checked: boolean
  showInformation: boolean
  readonly: boolean
  relevance?: number
  reorderDisabled: boolean
  actions: MediaCardActions
  canEditOriginal: boolean
  multiSelected: boolean
}

const MediaCard = memo(function MediaCard({
  file,
  tags,
  availableTags,
  favoriteTag,
  thumbnailsEnabled,
  thumbnailSize,
  longPressOpenContextMenu,
  checked,
  showInformation,
  readonly,
  relevance,
  reorderDisabled,
  actions,
  canEditOriginal,
  multiSelected
}: MediaCardProps) {
  const m = useMediaText()
  const kind = mediaKind(file)
  const shownTags = tags.filter((tag) => tag.type === 'custom').slice(0, 2)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dropTarget, setDropTarget] = useState(false)
  const liked = !!favoriteTag && tags.some((tag) => Number(tag.id) === Number(favoriteTag.id))
  const longPressTimer = useRef<number | null>(null)
  const longPressStart = useRef<{ x: number; y: number } | null>(null)
  const suppressNextClick = useRef(false)
  const onOpen = () => actions.dispatch('open', file)
  const onSelect = (shift: boolean) => actions.select(file.fullpath, shift)
  const onFavorite = () => actions.dispatch('favorite', file)
  const onSimilar = () => actions.dispatch('similar', file)
  const onTags = () => actions.dispatch('tags', file)
  const onWorkspace = () => actions.dispatch('workspace', file)
  const onRename = () => actions.dispatch('rename', file)
  const onDelete = () => actions.dispatch('delete', file)
  const onCopyPath = () => actions.dispatch('copy-path', file)
  const onOpenFolder = () => actions.dispatch('open-folder', file)
  const onOpenExternal = () => actions.dispatch('open-external', file)
  const onDownload = () => actions.dispatch('download', file)
  const onEditOriginal = canEditOriginal ? () => actions.dispatch('edit-original', file) : undefined
  const onToggleTag = (tag: MediaTag) => actions.toggleTag(file, tag)
  const onReorder = actions.reorder
  const onBatchTag = actions.batchTag
  useEffect(
    () => () => {
      if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
    },
    []
  )
  const cancelLongPress = () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current)
    longPressTimer.current = null
    longPressStart.current = null
  }
  return (
    <Card
      className={`ml-card ml-gallery-card ml-card-${kind}${showInformation ? ' shows-information' : ''}${menuOpen ? ' has-open-menu' : ''}${checked ? ' ml-card-selected' : ''}${dropTarget ? ' ml-card-drop-target' : ''}`}
      padding={0}
      radius="md"
      withBorder
      draggable={!readonly}
      onDragStart={(event) => {
        if (!reorderDisabled)
          event.dataTransfer.setData('application/x-omnigallery-media-order', file.fullpath)
        event.dataTransfer.setData(
          'application/x-omnigallery-files',
          JSON.stringify(actions.getDragPaths(file.fullpath))
        )
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        if (
          reorderDisabled ||
          !event.dataTransfer.types.includes('application/x-omnigallery-media-order')
        )
          return
        event.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(event) => {
        setDropTarget(false)
        const source = event.dataTransfer.getData('application/x-omnigallery-media-order')
        if (!source || reorderDisabled) return
        event.preventDefault()
        event.stopPropagation()
        onReorder(source, file.fullpath)
      }}
      onDragEnd={() => setDropTarget(false)}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenuOpen(true)
      }}
      onPointerDown={(event) => {
        if (!longPressOpenContextMenu || !['touch', 'pen'].includes(event.pointerType)) return
        if ((event.target as Element).closest('button, input, [role="checkbox"]')) return
        cancelLongPress()
        longPressStart.current = { x: event.clientX, y: event.clientY }
        longPressTimer.current = window.setTimeout(() => {
          longPressTimer.current = null
          suppressNextClick.current = true
          setMenuOpen(true)
          window.setTimeout(() => {
            suppressNextClick.current = false
          }, 1000)
        }, 500)
      }}
      onPointerMove={(event) => {
        const start = longPressStart.current
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
          cancelLongPress()
      }}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onClickCapture={(event) => {
        if (!suppressNextClick.current) return
        suppressNextClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div
        className="ml-card-visual"
        onClick={(event) => {
          if (event.detail > 1) return
          onSelect(event.shiftKey)
        }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          onOpen()
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || event.repeat) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(event.shiftKey)
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={m('选择 {name}', { name: file.name })}
        aria-pressed={checked}
      >
        <MediaArtwork
          file={file}
          thumbnailsEnabled={thumbnailsEnabled}
          thumbnailSize={thumbnailSize}
        />
        {(kind === 'video' || kind === 'audio') && (
          <button
            className={`ml-play-indicator${kind === 'audio' ? ' ml-audio-listen' : ''}`}
            type="button"
            aria-label={m(kind === 'audio' ? '试听：{name}' : '预览：{name}', { name: file.name })}
            onClick={(event) => {
              event.stopPropagation()
              onOpen()
            }}
          >
            {kind === 'audio' ? (
              <>
                <IconHeadphones size={19} />
                <span>{m('试听')}</span>
              </>
            ) : (
              <IconPlayerPlay size={19} />
            )}
          </button>
        )}
      </div>
      <div className="ml-card-top">
        {kind !== 'image' && (
          <span className="ml-media-kind" title={m(kindLabels[kind])}>
            {kind === 'audio' ? (
              <IconMusic size={13} />
            ) : kind === 'video' ? (
              <IconVideo size={13} />
            ) : (
              <IconFile size={13} />
            )}
            {m(kindLabels[kind])}
          </span>
        )}
        {relevance !== undefined && (
          <Badge size="sm" variant="filled" color="dark">
            {m('相关度 {score}', { score: scoreLabel(relevance) })}
          </Badge>
        )}
        {favoriteTag && !readonly && (
          <ActionIcon
            className={`ml-favorite${liked ? ' is-liked' : ''}`}
            color={liked ? 'red' : 'gray'}
            variant="filled"
            size="sm"
            aria-label={m(liked ? '取消收藏' : '收藏')}
            onClick={(event) => {
              event.stopPropagation()
              onFavorite()
            }}
          >
            {liked ? <IconHeartFilled size={16} /> : <IconHeart size={16} />}
          </ActionIcon>
        )}
      </div>
      <div className="ml-card-menu">
        <Menu
          withinPortal
          position="bottom-end"
          shadow="md"
          width={210}
          opened={menuOpen}
          onChange={setMenuOpen}
        >
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={m('{name} 的更多操作', { name: file.name })}
              onClick={(event) => event.stopPropagation()}
            >
              <IconDots size={17} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown onClick={(event) => event.stopPropagation()}>
            {kind === 'image' && (
              <Menu.Item leftSection={<IconSearch size={16} />} onClick={onSimilar}>
                {m('查找相似图片')}
              </Menu.Item>
            )}
            {onEditOriginal && kind === 'image' && !readonly && (
              <Menu.Item leftSection={<IconCrop size={16} />} onClick={onEditOriginal}>
                {m('调整图片')}
              </Menu.Item>
            )}
            {kind === 'image' && !readonly && <Menu.Divider />}
            {!readonly && multiSelected && (
              <>
                {(['add', 'remove'] as const).map((action) => (
                  <Menu.Sub key={action}>
                    <Menu.Sub.Target>
                      <Menu.Sub.Item
                        leftSection={
                          action === 'add' ? <IconTagPlus size={16} /> : <IconTagMinus size={16} />
                        }
                      >
                        {m(action === 'add' ? '添加标签' : '移除标签')}
                      </Menu.Sub.Item>
                    </Menu.Sub.Target>
                    <Menu.Sub.Dropdown className="ml-tag-submenu">
                      <MediaTagMenu
                        tags={availableTags}
                        getColor={tagColor}
                        onSelect={(tag) => onBatchTag(action, tag)}
                      />
                    </Menu.Sub.Dropdown>
                  </Menu.Sub>
                ))}
              </>
            )}
            {!readonly && !multiSelected && (
              <Menu.Sub>
                <Menu.Sub.Target>
                  <Menu.Sub.Item leftSection={<IconTags size={16} />}>{m('标签')}</Menu.Sub.Item>
                </Menu.Sub.Target>
                <Menu.Sub.Dropdown className="ml-tag-submenu">
                  <MediaTagMenu
                    tags={availableTags}
                    selectedTags={tags}
                    getColor={tagColor}
                    onSelect={onToggleTag}
                    onEdit={onTags}
                  />
                </Menu.Sub.Dropdown>
              </Menu.Sub>
            )}
            {!readonly && (
              <>
                <Menu.Item leftSection={<IconLayoutGrid size={16} />} onClick={onWorkspace}>
                  {m('加入工作区')}
                </Menu.Item>
                <Menu.Divider />
              </>
            )}
            <Menu.Item leftSection={<IconCopy size={16} />} onClick={onCopyPath}>
              {m('复制路径')}
            </Menu.Item>
            <Menu.Item leftSection={<IconFolderOpen size={16} />} onClick={onOpenFolder}>
              {m('在文件夹中显示')}
            </Menu.Item>
            {isTauri() && kind !== 'other' && !file.cloud_only && !file.workspace_artifact_id && (
              <Menu.Item
                disabled={readonly}
                leftSection={<IconExternalLink size={16} />}
                onClick={onOpenExternal}
              >
                {m('用其他应用打开')}
              </Menu.Item>
            )}
            <Menu.Item leftSection={<IconDownload size={16} />} onClick={onDownload}>
              {m('下载文件')}
            </Menu.Item>
            {!readonly && (
              <>
                <Menu.Divider />
                <Menu.Item leftSection={<IconPencil size={16} />} onClick={onRename}>
                  {m('重命名')}
                </Menu.Item>
                <Menu.Divider />
                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={onDelete}>
                  {m('删除文件')}
                </Menu.Item>
              </>
            )}
          </Menu.Dropdown>
        </Menu>
      </div>
      <div className="ml-card-caption">
        <Text size="xs" className="ml-card-name" lineClamp={2} title={file.name}>
          {fileDisplayName(file.name)}
        </Text>
        {shownTags.length > 0 && (
          <Group gap={4} className="ml-card-tags">
            {shownTags.map((tag) => (
              <Badge
                key={tag.id}
                variant="light"
                size="xs"
                style={{ '--ml-tag-color': tagColor(tag) } as React.CSSProperties}
              >
                {tag.display_name || tag.name}
              </Badge>
            ))}
            {tags.filter((tag) => tag.type === 'custom').length > 2 && (
              <Badge color="gray" variant="outline" size="xs">
                +{tags.filter((tag) => tag.type === 'custom').length - 2}
              </Badge>
            )}
          </Group>
        )}
      </div>
    </Card>
  )
})

// App remounts this page when navigation changes from a media section to folders.
// Carry a user-requested recursive view through that one route transition.
let pendingWalkPath: string | null = null

export default function MediaLibraryPage({
  section,
  initialPath,
  initialPreviewPath,
  onFolderChange,
  onOpenEditor,
  onEditMedia
}: MediaLibraryPageProps) {
  const m = useMediaText()
  const [roots, setRoots] = useState<LibraryRoot[]>([])
  const graphRoots = useMemo(
    () =>
      topLevelManagedFolders(
        roots,
        roots.some((root) => /^[a-z]:[\\/]/i.test(root.path))
      ),
    [roots]
  )
  const [info, setInfo] = useState<{
    media_count: number
    tags: MediaTag[]
    expired: boolean
  } | null>(null)
  const [readOnly, setReadOnly] = useState(true)
  const [items, setItems] = useState<MediaFile[]>([])
  const [cursor, setCursor] = useState<{ has_next: boolean; next: string }>({
    has_next: false,
    next: ''
  })
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const setNotice = useNotice()
  const [searchInput, setSearchInput] = useState('')
  const [searchMode, setSearchMode] = useState<'keyword' | 'visual'>('keyword')
  const [query, setQuery] = useState('')
  const [visualQuery, setVisualQuery] = useState('')
  const [visualResult, setVisualResult] = useState<VisualSearchResult | null>(null)
  const [visualBusy, setVisualBusy] = useState(false)
  const [visualStatus, setVisualStatus] = useState<VisualSearchStatus | null>(null)
  const [rerankerStatus, setRerankerStatus] = useState<VisualSearchStatus | null>(null)
  const [visualRerank, setVisualRerank] = useState(false)
  const [folderPath, setFolderPath] = useState(initialPath || '')
  const [walkMode, setWalkMode] = useState(
    () =>
      !!initialPath &&
      (pendingWalkPath === initialPath ||
        new URLSearchParams(window.location.search).get('mode') === 'walk')
  )
  const internalNavigationPathRef = useRef<string | null>(null)
  const routedPathKeyRef = useRef<string | null>(null)
  const [walkPendingDirectories, setWalkPendingDirectories] = useState(0)
  const directoryWalkRef = useRef<{ path: string; walker: DirectoryWalker } | null>(null)
  const [folderOptionsOpen, setFolderOptionsOpen] = useState(false)
  const [polling, setPolling] = useState(false)
  const [pollInterval, setPollInterval] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('omnigallery:poll-interval'))
      return Number.isInteger(saved) && saved >= 1 && saved <= 600 ? saved : 3
    } catch {
      return 3
    }
  })
  const [pollIntervalDraft, setPollIntervalDraft] = useState(pollInterval)
  const [includeSubfolders, setIncludeSubfolders] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filters, setFilters] = useState<MediaFilters>(emptyFilters)
  const [sort, setSort] = useState<SortMode>('manual')
  const [cardSize, setCardSize] = useState<'small' | 'medium' | 'large'>(() => {
    try {
      const saved = localStorage.getItem('iib-react-card-size')
      return saved === 'medium' || saved === 'large' ? saved : 'small'
    } catch {
      return 'small'
    }
  })
  const [browsePreferences, setBrowsePreferences] = useState(readBrowsePreferences)
  const [showInformation, setShowInformation] = useState(() => {
    try {
      return localStorage.getItem('omnigallery-react-media-information') === 'true'
    } catch {
      return false
    }
  })
  const [generalPreferences, setGeneralPreferences] = useState(readGeneralPreferences)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const pointerInPage = useRef(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const aiSearchFormRef = useRef<HTMLFormElement>(null)
  const [headerOverlapsContent, setHeaderOverlapsContent] = useState(false)
  const [comparisonMode, setComparisonMode] = useState<'compare' | 'grid' | null>(null)
  const selectionAnchor = useRef<string | null>(null)
  const [tagsByPath, setTagsByPath] = useState<Record<string, MediaTag[]>>({})
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<MediaFile[] | null>(null)
  const [confirmDownload, setConfirmDownload] = useState<MediaFile[] | null>(null)
  const [exportFiles, setExportFiles] = useState<MediaFile[] | null>(null)
  const [exportMode, setExportMode] = useState<'download' | 'archive'>('download')
  const [exportCompress, setExportCompress] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [archiveDirectory, setArchiveDirectory] = useState('')
  const [archivePath, setArchivePath] = useState('')
  const [workspaceTarget, setWorkspaceTarget] = useState<MediaFile[] | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [workspaceBusy, setWorkspaceBusy] = useState(false)
  const [renaming, setRenaming] = useState<MediaFile | null>(null)
  const [newName, setNewName] = useState('')
  const [tagEditing, setTagEditing] = useState<MediaFile | null>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const tagEditorVersion = useRef(0)
  const [tagLoading, setTagLoading] = useState(false)
  const [batchTagOpen, setBatchTagOpen] = useState(false)
  const [batchTagAction, setBatchTagAction] = useState<'add' | 'remove'>('add')
  const [batchTagId, setBatchTagId] = useState<string | null>(null)
  const [transferMode, setTransferMode] = useState<'move' | 'copy' | null>(null)
  const [transferDestination, setTransferDestination] = useState('')
  const [busyAction, setBusyAction] = useState(false)
  const [folderModal, setFolderModal] = useState<'root' | 'child' | null>(null)
  const [folderModalParent, setFolderModalParent] = useState('')
  const [folderInput, setFolderInput] = useState('')
  const [droppedFolders, setDroppedFolders] = useState<string[] | null>(null)
  const [flattenReview, setFlattenReview] = useState<{
    path: string
    result: FlattenFolderResult
  } | null>(null)
  const [flattenBusy, setFlattenBusy] = useState(false)
  const [aliasRoot, setAliasRoot] = useState<LibraryRoot | null>(null)
  const [aliasInput, setAliasInput] = useState('')
  const [removingRoot, setRemovingRoot] = useState<LibraryRoot | null>(null)
  const [createFile, setCreateFile] = useState<MediaFile | null>(null)
  const [createTarget, setCreateTarget] = useState<MediaDraftTarget | null>(null)
  const [createWorkId, setCreateWorkId] = useState('')
  const [createName, setCreateName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set())
  const [folderChildren, setFolderChildren] = useState<Record<string, MediaFile[]>>({})
  const [folderIcons, setFolderIcons] = useState<Record<string, string>>({})
  const [iconEditing, setIconEditing] = useState<{ path: string; name: string } | null>(null)
  const [folderRenaming, setFolderRenaming] = useState<string | null>(null)
  const [folderDeleting, setFolderDeleting] = useState<string | null>(null)
  const [folderMoving, setFolderMoving] = useState<string | null>(null)
  const [folderMoveTarget, setFolderMoveTarget] = useState<string | null>(null)
  const [movingFolderPath, setMovingFolderPath] = useState('')
  const [reorderBusy, setReorderBusy] = useState(false)
  const [subfolders, setSubfolders] = useState<MediaFile[]>([])
  const [subfolderMenuPath, setSubfolderMenuPath] = useState<string | null>(null)
  const [loadingFolderPath, setLoadingFolderPath] = useState('')
  const [folderQuery, setFolderQuery] = useState('')
  const [similarSource, setSimilarSource] = useState<SimilarSource | null>(null)
  const [similarMethod, setSimilarMethod] = useState<'qwen' | 'hash'>('qwen')
  const [similarMinimum, setSimilarMinimum] = useState(0)
  const [similarResult, setSimilarResult] = useState<SimilarResult | null>(null)
  const [similarBusy, setSimilarBusy] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const requestId = useRef(0)
  const pollInFlightRef = useRef(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const indexCheckInProgress = useRef(false)
  const pendingPreviewPath = useRef(initialPreviewPath || '')

  useEffect(() => {
    const scrollHost = pageRef.current?.closest('.omni-content')
    if (!scrollHost) return
    const updateHeaderOverlap = () => setHeaderOverlapsContent(scrollHost.scrollTop > 12)
    updateHeaderOverlap()
    scrollHost.addEventListener('scroll', updateHeaderOverlap, { passive: true })
    return () => scrollHost.removeEventListener('scroll', updateHeaderOverlap)
  }, [section, folderPath])

  const refreshInfo = useCallback(async () => {
    const [newInfo, newRoots, newIcons] = await Promise.all([
      getLibraryInfo(),
      getLibraryRoots(),
      getFolderIcons()
    ])
    setInfo(newInfo)
    setRoots(newRoots.filter((root) => !root.types.every((type) => type === 'cli_access_only')))
    setFolderIcons(newIcons)
  }, [])

  useEffect(() => {
    void refreshInfo().catch((cause) => setError(errorText(cause, m('无法连接媒体服务'))))
    void getReadOnlyMode()
      .then(setReadOnly)
      .catch(() => {})
  }, [refreshInfo, m])
  useEffect(() => {
    const onNativeDrop = (event: Event) => {
      if (section !== 'folders' || readOnly) return
      const value: unknown = (event as CustomEvent).detail?.paths
      if (!Array.isArray(value)) return
      const paths = value.filter(
        (path): path is string => typeof path === 'string' && !!path.trim()
      )
      if (!paths.length) return
      const normalized = (path: string) => {
        const trimmed = path.replace(/[\\/]+$/, '')
        return /^[a-z]:/i.test(trimmed) || trimmed.includes('\\')
          ? trimmed.toLocaleLowerCase()
          : trimmed
      }
      const registered = new Set(
        roots.filter((root) => root.types.includes('walk')).map((root) => normalized(root.path))
      )
      const candidates = [
        ...new Map(paths.map((path) => [normalized(path), path])).values()
      ].filter((path) => !registered.has(normalized(path)))
      if (!candidates.length) {
        setNotice(m('这些文件夹已在媒体库中'))
        return
      }
      void checkDirectoryPaths(candidates)
        .then((validity) => {
          const valid = candidates.filter((path) => validity[path])
          if (valid.length !== candidates.length)
            setNotice(m('已跳过文件和无法读取的路径，只能添加文件夹'))
          if (valid.length) setDroppedFolders(valid)
        })
        .catch(showError)
    }
    window.addEventListener('omnigallery:native-file-drop', onNativeDrop)
    return () => window.removeEventListener('omnigallery:native-file-drop', onNativeDrop)
  }, [section, readOnly, roots, m])
  useEffect(() => {
    if (!roots.length) return
    let active = true
    setExpandedPaths((current) => new Set([...current, ...roots.map((root) => root.path)]))
    void Promise.all(
      roots.map(async (root) => {
        const result = await getFolderChildren(root.path)
        return [
          root.path,
          result.files
            .filter((file) => file.type === 'dir')
            .sort((a, b) => a.name.localeCompare(b.name))
        ] as const
      })
    )
      .then((entries) => {
        if (active) setFolderChildren((current) => ({ ...current, ...Object.fromEntries(entries) }))
      })
      .catch((cause) => {
        if (active) setError(errorText(cause, m('读取子目录失败')))
      })
    return () => {
      active = false
    }
  }, [roots, m])
  useEffect(() => {
    const routeKey = `${section}\0${initialPath || ''}`
    if (routedPathKeyRef.current === routeKey) return
    routedPathKeyRef.current = routeKey
    if (internalNavigationPathRef.current === (initialPath || '')) {
      internalNavigationPathRef.current = null
      if (pendingWalkPath === initialPath) pendingWalkPath = null
      return
    }
    internalNavigationPathRef.current = null
    const requestedWalk = !!initialPath && pendingWalkPath === initialPath
    if (requestedWalk) pendingWalkPath = null
    setFolderPath(initialPath || '')
    setWalkMode(
      requestedWalk ||
        (!!initialPath && new URLSearchParams(window.location.search).get('mode') === 'walk')
    )
    directoryWalkRef.current = null
    setSelected(new Set())
    setSimilarSource(null)
    setVisualQuery('')
    setSearchMode('keyword')
    setPreviewIndex(null)
  }, [section, initialPath])
  useEffect(() => {
    if (section !== 'folders' || !folderPath) return
    const url = new URL(window.location.href)
    if (walkMode) url.searchParams.set('mode', 'walk')
    else url.searchParams.delete('mode')
    if (url.toString() !== window.location.href)
      window.history.replaceState(window.history.state, '', url)
  }, [section, folderPath, walkMode])
  useEffect(() => {
    pendingPreviewPath.current = initialPreviewPath || ''
  }, [initialPreviewPath])
  useEffect(() => {
    try {
      localStorage.setItem('iib-react-card-size', cardSize)
    } catch {
      /* storage may be unavailable */
    }
  }, [cardSize])
  useEffect(() => {
    try {
      localStorage.setItem('omnigallery-react-media-information', String(showInformation))
    } catch {
      /* Keep the current view usable when preferences cannot be saved. */
    }
  }, [showInformation])
  useEffect(() => {
    const refreshPreferences = () => setBrowsePreferences(readBrowsePreferences())
    window.addEventListener(browsePreferencesEvent, refreshPreferences)
    window.addEventListener('storage', refreshPreferences)
    return () => {
      window.removeEventListener(browsePreferencesEvent, refreshPreferences)
      window.removeEventListener('storage', refreshPreferences)
    }
  }, [])
  useEffect(() => {
    const refreshPreferences = () => setGeneralPreferences(readGeneralPreferences())
    window.addEventListener(generalPreferencesEvent, refreshPreferences)
    window.addEventListener('storage', refreshPreferences)
    return () => {
      window.removeEventListener(generalPreferencesEvent, refreshPreferences)
      window.removeEventListener('storage', refreshPreferences)
    }
  }, [])
  useEffect(() => {
    if (!browsePreferences.autoUpdateIndex || readOnly) return
    let active = true
    const check = async () => {
      if (!active || document.hidden || indexCheckInProgress.current || scanning) return
      indexCheckInProgress.current = true
      try {
        const state = await getExpiredDirectories()
        if (!active || !state.expired) return
        await scanLibrary()
        if (!active) return
        await refreshInfo()
        setNotice(m('媒体索引已更新，刷新列表可查看新增内容'))
      } catch {
        // Keep the current library usable if an automatic check fails.
      } finally {
        indexCheckInProgress.current = false
      }
    }
    const onVisible = () => {
      if (!document.hidden) void check()
    }
    void check()
    const timer = window.setInterval(() => void check(), 60000)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [browsePreferences.autoUpdateIndex, readOnly, scanning, refreshInfo, m])
  useEffect(() => {
    if (searchMode !== 'visual') return
    let active = true
    void Promise.allSettled([getVisualSearchStatus(), getVisualRerankerStatus()]).then(
      ([embedding, reranker]) => {
        if (!active) return
        setVisualStatus(embedding.status === 'fulfilled' ? embedding.value : null)
        setRerankerStatus(reranker.status === 'fulfilled' ? reranker.value : null)
        if (reranker.status !== 'fulfilled' || reranker.value.state !== 'ready')
          setVisualRerank(false)
      }
    )
    return () => {
      active = false
    }
  }, [searchMode])
  useEffect(() => {
    if (!folderPath) {
      setSubfolders([])
      return
    }
    let active = true
    void getFolderChildren(folderPath)
      .then((result) => {
        if (active) setSubfolders(result.files.filter((file) => file.type === 'dir'))
      })
      .catch((cause) => {
        if (active) setError(errorText(cause, m('无法读取子文件夹')))
      })
    return () => {
      active = false
    }
  }, [folderPath, m])

  const loadPage = useCallback(
    async (nextCursor = '', append = false, quiet = false) => {
      if (section === 'folders' && !folderPath) return
      const id = append ? requestId.current : ++requestId.current
      if (append) setLoadingMore(true)
      else if (!quiet) {
        setLoading(true)
        setError('')
      }
      try {
        const directFolder =
          folderPath &&
          !includeSubfolders &&
          !filters.and_tags.length &&
          !filters.or_tags.length &&
          !filters.not_tags.length &&
          !filters.exclude_all_tags &&
          !Object.values(filters.tag_groups).some((ids) => ids.length) &&
          !Object.keys(filters.dimensions).length
        const page =
          walkMode && folderPath
            ? await (async () => {
                const current = directoryWalkRef.current
                const walker =
                  append && current?.path === folderPath
                    ? current.walker
                    : new DirectoryWalker(folderPath)
                directoryWalkRef.current = { path: folderPath, walker }
                const walked = await walker.loadNext()
                if (id === requestId.current) setWalkPendingDirectories(walked.pendingDirectories)
                const files = append ? walked.added : walked.files
                return {
                  files: files.filter(
                    (file) =>
                      !query || file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())
                  ),
                  cursor: { has_next: walked.hasNext, next: walked.nextDirectoryPath || '' }
                }
              })()
            : directFolder
              ? {
                  files: (await getFolderChildren(folderPath, false)).files.filter(
                    (file) =>
                      file.type === 'file' &&
                      (!query || file.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
                  ),
                  cursor: { has_next: false, next: '' }
                }
              : await searchMedia({
                  section,
                  query,
                  folderPath,
                  includeSubfolders,
                  filters,
                  cursor: nextCursor
                })
        if (id !== requestId.current) return
        setItems((current) =>
          append
            ? [
                ...current,
                ...page.files.filter(
                  (item) => !current.some((existing) => existing.fullpath === item.fullpath)
                )
              ]
            : page.files
        )
        setCursor(page.cursor)
      } catch (cause) {
        if (id === requestId.current) setError(errorText(cause, m('媒体加载失败')))
      } finally {
        if (id === requestId.current) {
          if (append) setLoadingMore(false)
          else if (!quiet) setLoading(false)
        }
      }
    },
    [section, query, folderPath, walkMode, includeSubfolders, filters, m]
  )

  useEffect(() => {
    setItems([])
    setCursor({ has_next: false, next: '' })
    setSelected(new Set())
    void loadPage()
    return () => {
      requestId.current += 1
    }
  }, [loadPage])

  useEffect(() => {
    if (!polling || !folderPath || walkMode) return
    const timer = window.setInterval(() => {
      if (
        document.hidden ||
        previewIndex !== null ||
        loading ||
        loadingMore ||
        pollInFlightRef.current
      )
        return
      pollInFlightRef.current = true
      void loadPage('', false, true).finally(() => {
        pollInFlightRef.current = false
      })
    }, pollInterval * 1000)
    return () => window.clearInterval(timer)
  }, [polling, folderPath, walkMode, pollInterval, previewIndex, loading, loadingMore, loadPage])

  useEffect(() => {
    const onMediaUpdated = () => {
      void Promise.all([loadPage(), refreshInfo()])
    }
    window.addEventListener('omnigallery:media-updated', onMediaUpdated)
    return () => window.removeEventListener('omnigallery:media-updated', onMediaUpdated)
  }, [loadPage, refreshInfo])

  useEffect(() => {
    if (!similarSource) {
      setSimilarResult(null)
      return
    }
    const controller = new AbortController()
    setSimilarBusy(true)
    setError('')
    void searchSimilarMedia(
      similarSource.path
        ? { path: similarSource.path }
        : { image_base64: similarSource.image_base64 },
      similarMethod,
      filters,
      folderPath,
      includeSubfolders,
      controller.signal
    )
      .then(setSimilarResult)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(errorText(cause, m('搜图失败，请检查参考图片或模型配置')))
      })
      .finally(() => {
        if (!controller.signal.aborted) setSimilarBusy(false)
      })
    return () => controller.abort()
  }, [similarSource, similarMethod, filters, folderPath, includeSubfolders, m])

  useEffect(() => {
    if (!visualQuery) {
      setVisualResult(null)
      return
    }
    const controller = new AbortController()
    setVisualBusy(true)
    setError('')
    void searchByDescription(
      visualQuery,
      filters,
      folderPath,
      includeSubfolders,
      controller.signal,
      visualRerank
    )
      .then((result) => {
        if (!controller.signal.aborted) setVisualResult(result)
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(errorText(cause, m('画面搜索失败，请检查模型配置')))
      })
      .finally(() => {
        if (!controller.signal.aborted) setVisualBusy(false)
      })
    return () => controller.abort()
  }, [visualQuery, filters, folderPath, includeSubfolders, visualRerank, m])

  const displayItems = useMemo(() => {
    const source = similarSource
      ? (similarResult?.files || []).filter((file) => scoreLabel(file.similarity) >= similarMinimum)
      : visualQuery
        ? visualResult?.files || []
        : items
    return sort === 'manual' || similarSource || visualQuery
      ? source
      : [...source].sort((a, b) => compareMedia(a, b, sort))
  }, [items, similarSource, similarResult, similarMinimum, visualQuery, visualResult, sort])

  useEffect(() => {
    const path = pendingPreviewPath.current
    if (!path) return
    const index = displayItems.findIndex((file) => file.fullpath === path)
    if (index < 0) return
    pendingPreviewPath.current = ''
    setPreviewIndex(index)
  }, [displayItems])

  useEffect(() => {
    const paths = displayItems.slice(-100).map((file) => file.fullpath)
    if (!paths.length) return
    let active = true
    void getMediaTags(paths)
      .then((tags) => {
        if (active) setTagsByPath((current) => ({ ...current, ...tags }))
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [displayItems])

  useEffect(() => {
    const bottom = bottomRef.current
    if (!bottom || !cursor.has_next || loading || loadingMore || similarSource || visualQuery)
      return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          observer.disconnect()
          void loadPage(cursor.next, true)
        }
      },
      { rootMargin: '300px' }
    )
    observer.observe(bottom)
    return () => observer.disconnect()
  }, [cursor, loading, loadingMore, similarSource, visualQuery, loadPage])

  useEffect(() => {
    if (!selected.size) selectionAnchor.current = null
  }, [selected])

  const visiblePaths = useMemo(() => displayItems.map((file) => file.fullpath), [displayItems])
  const toggleSelection = useCallback(
    (path: string, range: boolean) => {
      const anchor = range ? selectionAnchor.current : null
      setSelected((current) => toggleMediaSelection(current, visiblePaths, path, anchor))
      if (!anchor || !visiblePaths.includes(anchor)) selectionAnchor.current = path
    },
    [visiblePaths]
  )

  const chooseSimilarFile = async (file: File) => {
    if (walkMode) setWalkMode(false)
    if (!file.type.startsWith('image/')) {
      setError(m('请选择图片作为搜图参考'))
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      setError(m('参考图片请勿超过 50 MB'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const preview = String(reader.result)
      setSimilarSource({ name: file.name, preview, image_base64: preview.split(',')[1] })
      setSearchInput('')
      setQuery('')
      setVisualQuery('')
      setSimilarMinimum(0)
      setSelected(new Set())
    }
    reader.onerror = () => setError(m('无法读取所选图片'))
    reader.readAsDataURL(file)
  }

  const refresh = async () => {
    setSimilarSource(null)
    setSimilarResult(null)
    setVisualQuery('')
    setVisualResult(null)
    await Promise.all([loadPage(), refreshInfo()])
  }

  const submitSearch = () => {
    setSimilarSource(null)
    setSelected(new Set())
    if (searchMode === 'visual') {
      setVisualResult(null)
      setVisualQuery(searchInput.trim())
    } else {
      setVisualQuery('')
      setQuery(searchInput.trim())
    }
  }

  const updateVisualIndex = async () => {
    setBusyAction(true)
    try {
      await startVisualSearchIndex()
      setNotice(m('画面索引已开始更新'))
      setVisualStatus(await getVisualSearchStatus())
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const runScan = async () => {
    setScanning(true)
    setError('')
    try {
      await scanLibrary()
      await refresh()
      setNotice(m('媒体索引已更新'))
      return true
    } catch (cause) {
      setError(errorText(cause, m('扫描失败')))
      return false
    } finally {
      setScanning(false)
    }
  }

  const refreshFolderChildren = async (path: string) => {
    setLoadingFolderPath(path)
    try {
      const result = await getFolderChildren(path)
      setFolderChildren((old) => ({
        ...old,
        [path]: result.files
          .filter((file) => file.type === 'dir')
          .sort((a, b) => a.name.localeCompare(b.name))
      }))
      if (folderPath === path) setSubfolders(result.files.filter((file) => file.type === 'dir'))
    } catch (cause) {
      setError(errorText(cause, m('读取子目录失败')))
    } finally {
      setLoadingFolderPath('')
    }
  }

  const toggleFolder = async (path: string) => {
    if (expandedPaths.has(path)) {
      setExpandedPaths((old) => {
        const next = new Set(old)
        next.delete(path)
        return next
      })
      return
    }
    setExpandedPaths((old) => new Set(old).add(path))
    if (folderChildren[path]) return
    await refreshFolderChildren(path)
  }

  const showFolder = (path: string) => {
    internalNavigationPathRef.current = path
    pendingWalkPath = null
    directoryWalkRef.current = null
    setWalkMode(false)
    setWalkPendingDirectories(0)
    setFolderPath(path)
    setSubfolders([])
    setItems([])
    onFolderChange?.(path)
    setSearchInput('')
    setQuery('')
    setVisualQuery('')
    setSelected(new Set())
    setSimilarSource(null)
  }

  const showAllFolderContents = (path: string) => {
    showFolder(path)
    pendingWalkPath = path
    setWalkMode(true)
    setPolling(false)
    setFilterOpen(false)
    setFilters(emptyFilters())
    setSearchMode('keyword')
  }

  const showCurrentFolderOnly = () => {
    setIncludeSubfolders(false)
    showFolder(folderPath)
  }

  const shareFolder = async () => {
    const url = new URL(window.location.href)
    url.searchParams.set('action', 'open')
    url.searchParams.set('path', folderPath)
    url.searchParams.set('mode', walkMode ? 'walk' : 'scanned')
    await navigator.clipboard.writeText(url.toString())
    setNotice(m('目录链接已复制'))
  }

  const togglePolling = () => {
    if (polling) {
      setPolling(false)
      return
    }
    const interval = Math.max(1, Math.min(600, Math.round(pollIntervalDraft || 3)))
    setPollInterval(interval)
    try {
      localStorage.setItem('omnigallery:poll-interval', String(interval))
    } catch {
      /* storage may be unavailable */
    }
    setPolling(true)
  }

  const folderAction = (action: FolderAction, path: string) => {
    if (action === 'walk') {
      showAllFolderContents(path)
    } else if (action === 'icon') {
      setIconEditing({
        path,
        name: roots.find((root) => root.path === path)?.alias || basename(path)
      })
    } else if (action === 'new') {
      setFolderModalParent(path)
      setFolderInput('')
      setFolderModal('child')
    } else if (action === 'rename') {
      setFolderRenaming(path)
      setNewName(basename(path))
    } else if (action === 'move') {
      setMovingFolderPath(path)
    } else if (action === 'copy') {
      void navigator.clipboard
        .writeText(path)
        .then(() => setNotice(m('文件路径已复制')))
        .catch(showError)
    } else if (action === 'refresh') {
      void refreshFolderChildren(path)
    } else if (action === 'alias') {
      const root = roots.find((item) => item.path === path)
      if (root) {
        setAliasRoot(root)
        setAliasInput(root.alias || '')
      }
    } else if (action === 'remove') {
      const root = roots.find((item) => item.path === path)
      if (root) setRemovingRoot(root)
    } else if (action === 'delete') {
      setFolderDeleting(path)
    }
  }

  const requestFolderMove = (source: string, destination: string) => {
    const normalized = (value: string) =>
      value.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase()
    if (
      !source ||
      source === destination ||
      roots.some((root) => normalized(root.path) === normalized(source))
    )
      return
    if (normalized(destination).startsWith(`${normalized(source)}/`)) {
      setError(m('不能将文件夹移入自身的子目录'))
      return
    }
    setFolderMoving(source)
    setFolderMoveTarget(destination)
  }

  const stageFileDrop = useCallback(
    (paths: string[], destination: string, copy: boolean) => {
      if (readOnly || !paths.length) return
      setSelected(new Set(paths))
      setTransferDestination(destination)
      setTransferMode(copy ? 'copy' : 'move')
    },
    [readOnly]
  )

  useEffect(() => {
    const onSidebarDrop = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail
      if (!detail || typeof detail !== 'object') return
      const { paths, destination, copy } = detail as Record<string, unknown>
      if (
        !Array.isArray(paths) ||
        !paths.length ||
        !paths.every((path) => typeof path === 'string') ||
        typeof destination !== 'string' ||
        !destination
      )
        return
      stageFileDrop(paths, destination, copy === true)
    }
    window.addEventListener('omnigallery:sidebar-file-drop', onSidebarDrop)
    return () => window.removeEventListener('omnigallery:sidebar-file-drop', onSidebarDrop)
  }, [stageFileDrop])

  const dropFilesOnFolder = (event: React.DragEvent, destination: string) => {
    const raw = event.dataTransfer.getData('application/x-omnigallery-files')
    if (!raw) return
    event.preventDefault()
    event.stopPropagation()
    try {
      const paths = JSON.parse(raw) as unknown
      if (Array.isArray(paths) && paths.every((item) => typeof item === 'string'))
        stageFileDrop(paths, destination, event.ctrlKey || event.metaKey)
    } catch {
      setError(m('无法读取拖动文件'))
    }
  }

  const confirmFolderMove = async () => {
    if (!folderMoving || !folderMoveTarget) return
    setBusyAction(true)
    try {
      const destination = folderMoveTarget
      const source = folderMoving
      const nextPath = joinPath(destination, basename(source))
      if ((await checkPathsExist([nextPath]))[nextPath])
        throw new Error(m('目标位置已有同名文件或文件夹'))
      const result = await transferMediaFiles('move', [source], destination)
      if (result.errors?.length) throw new Error(result.errors.join('；'))
      setFolderMoving(null)
      setFolderMoveTarget(null)
      setMovingFolderPath('')
      setFolderChildren({})
      await refreshInfo()
      if (
        folderPath === source ||
        folderPath.startsWith(`${source}${source.includes('\\') ? '\\' : '/'}`)
      ) {
        showFolder(nextPath + folderPath.slice(source.length))
      }
      announceFoldersUpdated(source, nextPath)
      setNotice(m('文件夹已移动'))
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const saveFolderRename = async () => {
    if (!folderRenaming || !newName.trim()) return
    setBusyAction(true)
    try {
      const source = folderRenaming
      const result = await renameFolder(source, newName.trim())
      setFolderRenaming(null)
      setFolderChildren({})
      await refreshInfo()
      if (
        folderPath === source ||
        folderPath.startsWith(`${source}${source.includes('\\') ? '\\' : '/'}`)
      ) {
        showFolder(result.new_path + folderPath.slice(source.length))
      }
      announceFoldersUpdated(source, result.new_path)
      setNotice(m('文件夹已改名'))
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const confirmFolderDelete = async () => {
    if (!folderDeleting) return
    setBusyAction(true)
    try {
      await deleteMediaFiles([folderDeleting])
      const deleted = folderDeleting
      setFolderDeleting(null)
      setFolderChildren({})
      await refreshInfo()
      if (folderPath === deleted) showFolder(deleted.replace(/[\\/][^\\/]+$/, ''))
      announceFoldersUpdated()
      setNotice(m('空文件夹已删除'))
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const reorderMedia = async (source: string, target: string) => {
    if (
      source === target ||
      reorderBusy ||
      readOnly ||
      similarSource ||
      visualQuery ||
      sort !== 'manual'
    )
      return
    const before = [...items]
    const sourceIndex = before.findIndex((file) => file.fullpath === source)
    const targetIndex = before.findIndex((file) => file.fullpath === target)
    if (sourceIndex < 0 || targetIndex < 0) return
    const after = [...before]
    ;[after[sourceIndex], after[targetIndex]] = [after[targetIndex], after[sourceIndex]]
    requestId.current += 1
    setLoadingMore(false)
    setItems(after)
    setReorderBusy(true)
    try {
      await swapMediaOrder(source, target)
      setNotice(m('自定义顺序已保存'))
    } catch (cause) {
      setItems(before)
      showError(cause)
    } finally {
      setReorderBusy(false)
    }
  }

  const restoreDateOrder = async () => {
    setReorderBusy(true)
    try {
      await resetMediaOrder()
      setSort('manual')
      await loadPage()
      setNotice(m('已恢复按时间排序'))
    } catch (cause) {
      showError(cause)
    } finally {
      setReorderBusy(false)
    }
  }

  const showError = (cause: unknown) => setError(errorText(cause, m('操作失败，请重试')))

  const openCreate = async (file: MediaFile) => {
    setCreateFile(file)
    setCreateTarget(null)
    setCreateWorkId('')
    setCreateName(`${fileDisplayName(file.name)} · 制作`)
    setCreateError('')
    setCreateLoading(true)
    try {
      const target = await readMediaDraftTarget()
      setCreateTarget(target)
      setCreateWorkId(target.preferredWorkId)
    } catch (cause) {
      setCreateError(errorText(cause))
    } finally {
      setCreateLoading(false)
    }
  }

  const finishCreate = async () => {
    if (!createFile || !createTarget || !createWorkId || !onOpenEditor || creating) return
    setCreating(true)
    setCreateError('')
    try {
      const created = await createMediaDraft(createFile, createTarget, createWorkId, createName)
      setCreateFile(null)
      setPreviewIndex(null)
      onOpenEditor(created.kind, created.draftId)
    } catch (cause) {
      setCreateError(errorText(cause))
    } finally {
      setCreating(false)
    }
  }

  const saveFolder = async () => {
    const entry = folderInput.trim()
    if (!entry) {
      setError(m('请输入文件夹路径或名称'))
      return
    }
    setBusyAction(true)
    try {
      if (folderModal === 'root') {
        await addLibraryRoot(entry)
        await refreshInfo()
        void runScan()
      } else if (folderModalParent || folderPath) {
        if (/[\\/]/.test(entry) || entry === '.' || entry === '..')
          throw new Error(m('子文件夹名称不能包含路径分隔符'))
        const parent = folderModalParent || folderPath
        await createFolder(joinPath(parent, entry))
        setFolderChildren((old) => {
          const next = { ...old }
          delete next[parent]
          return next
        })
        await refreshFolderChildren(parent)
      }
      setFolderModal(null)
      setFolderModalParent('')
      setFolderInput('')
      announceFoldersUpdated()
      setNotice(m('文件夹已添加'))
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const addDroppedFolders = async () => {
    if (!droppedFolders?.length || readOnly || busyAction) return
    const paths = droppedFolders
    let added = 0
    setBusyAction(true)
    try {
      for (const path of paths) {
        await addLibraryRoot(path)
        added += 1
      }
      setDroppedFolders(null)
      await refreshInfo()
      announceFoldersUpdated()
      const scanned = await runScan()
      setNotice(
        scanned
          ? m('已添加并扫描 {count} 个文件夹', { count: paths.length })
          : m('文件夹已添加，但扫描未完成，请稍后重试')
      )
    } catch (cause) {
      await refreshInfo().catch(() => {})
      if (added) {
        setDroppedFolders(paths.slice(added).length ? paths.slice(added) : null)
        announceFoldersUpdated()
        await runScan()
      }
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const reviewFlatten = async () => {
    if (!folderPath || readOnly || flattenBusy) return
    setFlattenBusy(true)
    try {
      const result = await flattenFolder(folderPath)
      if (!result.total_files) setNotice(m('没有需要移动的文件'))
      else setFlattenReview({ path: folderPath, result })
    } catch (cause) {
      showError(cause)
    } finally {
      setFlattenBusy(false)
    }
  }

  const performFlatten = async () => {
    if (!flattenReview || flattenReview.result.conflicts.length || readOnly || flattenBusy) return
    const path = flattenReview.path
    setFlattenBusy(true)
    try {
      const result = await flattenFolder(path, false)
      setFlattenReview(null)
      setFolderChildren({})
      await Promise.all([refresh(), refreshFolderChildren(path)])
      announceFoldersUpdated()
      if (!result.success || result.errors.length)
        throw new Error(result.errors.join('；') || m('压平文件夹未完成'))
      setNotice(m('压平完成，已移动 {count} 个文件', { count: result.moved_files }))
    } catch (cause) {
      showError(cause)
    } finally {
      setFlattenBusy(false)
    }
  }

  const saveRename = async () => {
    if (!renaming || !newName.trim()) return
    setBusyAction(true)
    try {
      await renameMediaFile(renaming.fullpath, newName.trim())
      setRenaming(null)
      await refresh()
      setNotice(m('文件已重命名'))
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const openTagEditor = async (file: MediaFile) => {
    const version = ++tagEditorVersion.current
    setTagEditing(file)
    setTagIds([])
    setTagLoading(true)
    try {
      const ids = file.workspace_artifact_id
        ? (await getArtifactMetadata(file.workspace_artifact_id)).tag_ids.map(String)
        : (await getSelectedCustomTags(file.fullpath)).map((tag) => String(tag.id))
      if (version !== tagEditorVersion.current) return
      setTagIds(ids)
    } catch (cause) {
      if (version !== tagEditorVersion.current) return
      setTagEditing(null)
      showError(cause)
    } finally {
      if (version === tagEditorVersion.current) setTagLoading(false)
    }
  }

  const saveTags = async () => {
    if (!tagEditing || tagLoading || busyAction) return
    setBusyAction(true)
    try {
      const next = await setMediaCustomTags(tagEditing, tagIds, customTags)
      setTagsByPath((old) => ({ ...old, [tagEditing.fullpath]: next }))
      setTagEditing(null)
      setNotice(m('标签已更新'))
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const closeTagEditor = () => {
    if (busyAction) return
    tagEditorVersion.current++
    setTagEditing(null)
    setTagLoading(false)
  }

  const toggleCardTag = async (file: MediaFile, tag: MediaTag) => {
    try {
      if (file.workspace_artifact_id) {
        await toggleArtifactTag(file.workspace_artifact_id, Number(tag.id))
        const metadata = await getArtifactMetadata(file.workspace_artifact_id)
        setTagsByPath((current) => ({
          ...current,
          [file.fullpath]: (info?.tags || []).filter((entry) =>
            metadata.tag_ids.includes(Number(entry.id))
          )
        }))
      } else {
        await toggleMediaTag(file.fullpath, Number(tag.id))
        const next = await getMediaTags([file.fullpath])
        setTagsByPath((current) => ({ ...current, ...next }))
      }
    } catch (cause) {
      showError(cause)
    }
  }

  const saveBatchTag = async (action = batchTagAction, id = batchTagId) => {
    if (!id || !selectedFiles.length || busyAction) return
    const tagId = Number(id)
    setBusyAction(true)
    try {
      const regular = selectedFiles.filter((file) => !file.workspace_artifact_id)
      const artifacts = selectedFiles.filter((file) => !!file.workspace_artifact_id)
      if (regular.length)
        await batchUpdateMediaTags(
          regular.map((file) => file.fullpath),
          action,
          tagId
        )
      for (const file of artifacts) {
        if (!file.workspace_artifact_id) continue
        const metadata = await getArtifactMetadata(file.workspace_artifact_id)
        const hasTag = metadata.tag_ids.includes(tagId)
        if ((action === 'add' && !hasTag) || (action === 'remove' && hasTag))
          await toggleArtifactTag(file.workspace_artifact_id, tagId)
      }
      const refreshed: Record<string, MediaTag[]> = regular.length
        ? await getMediaTags(regular.map((file) => file.fullpath))
        : {}
      for (const file of artifacts) {
        if (!file.workspace_artifact_id) continue
        const metadata = await getArtifactMetadata(file.workspace_artifact_id)
        refreshed[file.fullpath] = (info?.tags || []).filter((tag) =>
          metadata.tag_ids.includes(Number(tag.id))
        )
      }
      setTagsByPath((current) => ({ ...current, ...refreshed }))
      setBatchTagOpen(false)
      setNotice(
        m(action === 'add' ? '已为 {count} 项添加标签' : '已为 {count} 项移除标签', {
          count: selectedFiles.length
        })
      )
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const saveTransfer = async () => {
    if (!transferMode || !selectedFiles.length) return
    const target = transferDestination.trim()
    if (!target) {
      setError(m('请选择目标文件夹'))
      return
    }
    setBusyAction(true)
    try {
      if (!(await checkFolderPath(target))) throw new Error(m('目标文件夹不存在或无法访问'))
      const outputPaths = selectedFiles.map((file) => joinPath(target, file.name))
      const normalizedPaths = outputPaths.map((path) =>
        path.replace(/\\/g, '/').toLocaleLowerCase()
      )
      if (new Set(normalizedPaths).size !== outputPaths.length)
        throw new Error(m('所选文件中有同名项，请分批操作'))
      const existing = await checkPathsExist(outputPaths)
      if (outputPaths.some((path) => existing[path])) throw new Error(m('目标文件夹存在同名文件'))
      const result = await transferMediaFiles(
        transferMode,
        selectedFiles.map((file) => file.fullpath),
        target
      )
      if (result.errors?.length) throw new Error(result.errors.join('；'))
      setTransferMode(null)
      setSelected(new Set())
      await refresh()
      setNotice(m(transferMode === 'move' ? '文件已移动' : '文件已复制'))
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }

  const performDelete = async (files: MediaFile[]) => {
    if (!files.length || busyAction || readOnly) return
    setBusyAction(true)
    try {
      await deleteMediaFiles(files.map((file) => file.fullpath))
      setConfirmDelete(null)
      setSelected(new Set())
      await refresh()
      setNotice(m('文件已删除'))
    } catch (cause) {
      showError(cause)
    } finally {
      setBusyAction(false)
    }
  }
  const requestDelete = (files: MediaFile[]) => {
    if (!files.length || readOnly) return
    if (files.length === 1 && !generalPreferences.confirmSingleDelete) void performDelete(files)
    else setConfirmDelete(files)
  }

  const downloadConfirmed = () => {
    if (!confirmDownload) return
    confirmDownload.forEach((file, index) =>
      setTimeout(() => {
        const anchor = document.createElement('a')
        anchor.href = rawMediaUrl(file, true)
        anchor.download = file.name
        anchor.click()
      }, index * 160)
    )
    setConfirmDownload(null)
  }

  const openExport = async (files: MediaFile[]) => {
    if (!files.length || readOnly) return
    setExportFiles(files)
    setExportMode('download')
    try {
      const settings = await getArchiveSettings()
      setArchiveDirectory(settings.directory)
    } catch (cause) {
      showError(cause)
    }
  }

  const finishExport = async () => {
    if (!exportFiles?.length || exportBusy || readOnly) return
    setExportBusy(true)
    try {
      const result = await exportMediaArchive(
        exportFiles.map((file) => file.fullpath),
        exportCompress,
        exportMode === 'archive'
      )
      if (result instanceof Blob) {
        const url = URL.createObjectURL(result)
        const link = document.createElement('a')
        link.href = url
        link.download = `媒体库_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
        document.body.appendChild(link)
        link.click()
        link.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
        setNotice(m('已开始下载 ZIP'))
      } else {
        setArchivePath(result.path)
      }
      setExportFiles(null)
    } catch (cause) {
      showError(cause)
    } finally {
      setExportBusy(false)
    }
  }

  const openWorkspacePicker = async (files: MediaFile[]) => {
    if (readOnly) return
    setWorkspaceTarget(files)
    setWorkspaceBusy(true)
    setWorkspaceId(null)
    try {
      const setting = await apiFetch<{ app_fe_setting?: { workbench_projects?: unknown } }>(
        '/global_setting'
      )
      setWorkspaces(
        readWorkspaceRecords(setting.app_fe_setting?.workbench_projects).sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt)
        )
      )
    } catch (cause) {
      showError(cause)
      setWorkspaceTarget(null)
    } finally {
      setWorkspaceBusy(false)
    }
  }

  const addToWorkspace = async () => {
    if (!workspaceTarget?.length || !workspaceId || workspaceBusy || readOnly) return
    setWorkspaceBusy(true)
    try {
      const setting = await apiFetch<{ app_fe_setting?: { workbench_projects?: unknown } }>(
        '/global_setting'
      )
      const records = readWorkspaceRecords(setting.app_fe_setting?.workbench_projects)
      const workspace = records.find((item) => item.id === workspaceId)
      if (!workspace) throw new Error(m('工作区已不存在，请重新选择'))
      const incoming: WorkspaceAsset[] = workspaceTarget.flatMap((file) => {
        const kind = mediaKind(file)
        return kind === 'other'
          ? []
          : [
              {
                ...(typeof file.id === 'number' ? { id: file.id } : {}),
                path: file.fullpath,
                name: file.name,
                kind
              }
            ]
      })
      const assets = addWorkspaceAssets(workspace.assets, incoming)
      if (assets.length === workspace.assets.length) {
        setNotice(m('所选媒体已在这个工作区中'))
        setWorkspaceTarget(null)
        return
      }
      await apiFetch<void>('/app_fe_setting', {
        method: 'POST',
        body: JSON.stringify({
          name: 'workbench_projects',
          value: JSON.stringify({
            version: 2,
            items: records.map((item) =>
              item.id === workspace.id
                ? { ...item, assets, updatedAt: new Date().toISOString() }
                : item
            )
          })
        })
      })
      setNotice(m('已加入「{name}」', { name: workspace.name }))
      setWorkspaceTarget(null)
    } catch (cause) {
      showError(cause)
    } finally {
      setWorkspaceBusy(false)
    }
  }

  const preview = previewIndex === null ? null : (displayItems[previewIndex] ?? null)

  const audioMetadataUpdated = (file: MediaFile, metadata: AudioMetadata) => {
    const path = file.fullpath
    const updateDate = (file: MediaFile) =>
      file.fullpath === path ? { ...file, date: metadata.modified_date } : file
    setItems((current) => current.map(updateDate))
    setSimilarResult((current) =>
      current
        ? {
            ...current,
            files: current.files.map((file) =>
              file.fullpath === path ? { ...file, date: metadata.modified_date } : file
            )
          }
        : current
    )
    setVisualResult((current) =>
      current
        ? {
            ...current,
            files: current.files.map((file) =>
              file.fullpath === path ? { ...file, date: metadata.modified_date } : file
            )
          }
        : current
    )
    setNotice(m('歌曲信息已写入 MP3 文件'))
  }

  const selectedFiles = useMemo(
    () => displayItems.filter((file) => selected.has(file.fullpath)),
    [displayItems, selected]
  )
  const cardMinWidth = mediaCardWidth(browsePreferences.smallThumbnailWidth, cardSize)
  const activeFilterCount =
    filters.and_tags.length +
    filters.or_tags.length +
    filters.not_tags.length +
    Number(filters.exclude_all_tags) +
    Object.values(filters.tag_groups).reduce((count, ids) => count + ids.length, 0) +
    Object.keys(filters.dimensions).length
  const customTags = useMemo(
    () => (info?.tags || []).filter((tag) => tag.type === 'custom'),
    [info?.tags]
  )
  const favoriteTag = useMemo(() => customTags.find((tag) => tag.name === 'like'), [customTags])
  const tagChoices = useMemo(
    () =>
      groupTags(customTags).map((group) => ({
        group: group.key === 'custom' ? m('未分组') : group.label,
        items: group.tags.map((tag) => ({
          value: String(tag.id),
          label: `${m(tagLabel(tag))}${tag.group_name ? ` · ${tag.group_name}` : ''}`
        }))
      })),
    [customTags, m]
  )
  // Stable card handlers read the latest committed selection when an action starts.
  const dispatchCardAction = useCallbackRef((action: MediaCardAction, file: MediaFile) => {
    const targets = selected.has(file.fullpath) ? selectedFiles : [file]
    switch (action) {
      case 'open': {
        const index = displayItems.findIndex((item) => item.fullpath === file.fullpath)
        if (index >= 0) setPreviewIndex(index)
        break
      }
      case 'favorite':
        if (favoriteTag) void toggleCardTag(file, favoriteTag)
        break
      case 'similar':
        setWalkMode(false)
        setSimilarSource({ name: file.name, path: file.fullpath, preview: thumbnailUrl(file) })
        setVisualQuery('')
        setSimilarMinimum(0)
        break
      case 'tags':
        void openTagEditor(file)
        break
      case 'workspace':
        void openWorkspacePicker(targets)
        break
      case 'rename':
        setRenaming(file)
        setNewName(file.name)
        break
      case 'delete':
        requestDelete(targets)
        break
      case 'copy-path':
        void navigator.clipboard
          .writeText(file.fullpath)
          .then(() => setNotice(m('文件路径已复制')))
          .catch(showError)
        break
      case 'open-folder':
        void openContainingFolder(file.fullpath).catch(showError)
        break
      case 'open-external':
        void openWithAppPicker(file.fullpath).catch(showError)
        break
      case 'edit-original':
        if (onEditMedia)
          void isAnimatedMedia(file)
            .then((animated) => {
              if (animated) throw new Error(m('动态图片暂不支持调整'))
              onEditMedia(file.fullpath)
            })
            .catch(showError)
        break
      case 'download':
        setConfirmDownload(targets)
        break
    }
  })
  const toggleCardTagAction = useCallbackRef((file: MediaFile, tag: MediaTag) => {
    void toggleCardTag(file, tag)
  })
  const reorderCardAction = useCallbackRef((source: string, target: string) => {
    void reorderMedia(source, target)
  })
  const batchCardTagAction = useCallbackRef((action: 'add' | 'remove', tag: MediaTag) => {
    void saveBatchTag(action, String(tag.id))
  })
  const getCardDragPaths = useCallbackRef((path: string) =>
    selected.has(path) ? selectedFiles.map((file) => file.fullpath) : [path]
  )
  const cardActions = useMemo<MediaCardActions>(
    () => ({
      dispatch: dispatchCardAction,
      select: toggleSelection,
      toggleTag: toggleCardTagAction,
      reorder: reorderCardAction,
      batchTag: batchCardTagAction,
      getDragPaths: getCardDragPaths
    }),
    [
      dispatchCardAction,
      toggleSelection,
      toggleCardTagAction,
      reorderCardAction,
      batchCardTagAction,
      getCardDragPaths
    ]
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const focusedInPage = event.target instanceof Node && pageRef.current?.contains(event.target)
      const focusedInSelectionBar =
        event.target instanceof Element && !!event.target.closest('.ml-selection-bar')
      if (
        !(
          pointerInPage.current ||
          pageRef.current?.matches(':hover') ||
          focusedInPage ||
          focusedInSelectionBar
        ) ||
        previewIndex !== null ||
        event.isComposing
      )
        return
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, [contenteditable], [role="dialog"]')
      )
        return
      const command = event.ctrlKey || event.metaKey
      if (command && !event.altKey && event.key.toLowerCase() === 'a' && displayItems.length) {
        event.preventDefault()
        event.stopImmediatePropagation()
        setSelected((current) =>
          current.size === displayItems.length
            ? new Set()
            : new Set(displayItems.map((item) => item.fullpath))
        )
        return
      }
      if (command || event.altKey) return
      if (['PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) {
        const page = pageRef.current
        if (!page) return
        let scrollHost: HTMLElement | null = page
        while (scrollHost) {
          const overflow = getComputedStyle(scrollHost).overflowY
          if (/(auto|scroll)/.test(overflow) && scrollHost.scrollHeight > scrollHost.clientHeight)
            break
          scrollHost = scrollHost.parentElement
        }
        scrollHost ??= document.scrollingElement as HTMLElement | null
        if (!scrollHost) return
        event.preventDefault()
        event.stopImmediatePropagation()
        const top =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? scrollHost.scrollHeight
              : scrollHost.scrollTop +
                (event.key === 'PageUp' ? -1 : 1) * Math.max(160, scrollHost.clientHeight * 0.88)
        scrollHost.scrollTo({ top, behavior: 'smooth' })
        return
      }
      if (event.key === 'Backspace' && folderPath) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const atRoot = roots.some((root) => root.path === folderPath)
        showFolder(atRoot ? '' : folderPath.replace(/[\\/][^\\/]+$/, ''))
        return
      }
      if (event.repeat || !selectedFiles.length) return
      const key = event.key.toLowerCase()
      if (key === 'd') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setConfirmDownload(selectedFiles)
      } else if (event.key === 'Delete' && !readOnly) {
        event.preventDefault()
        event.stopImmediatePropagation()
        requestDelete(selectedFiles)
      } else if (key === 'l' && !readOnly && !busyAction) {
        const likeTag = customTags.find((tag) => tag.name === 'like')
        if (!likeTag) return
        event.preventDefault()
        event.stopImmediatePropagation()
        setBusyAction(true)
        void (async () => {
          try {
            const regular = selectedFiles.filter((item) => !item.workspace_artifact_id)
            const artifacts = selectedFiles.filter(
              (item): item is MediaFile & { workspace_artifact_id: string } =>
                !!item.workspace_artifact_id
            )
            const paths = regular.map((item) => item.fullpath)
            const current = paths.length ? await getMediaTags(paths) : {}
            const artifactDetails = await Promise.all(
              artifacts.map((item) => getArtifactMetadata(item.workspace_artifact_id))
            )
            const allLiked =
              regular.every((item) =>
                (current[item.fullpath] || []).some((tag) => Number(tag.id) === Number(likeTag.id))
              ) &&
              artifactDetails.every((metadata) => metadata.tag_ids.includes(Number(likeTag.id)))
            const action = allLiked ? 'remove' : 'add'
            if (paths.length) await batchUpdateMediaTags(paths, action, Number(likeTag.id))
            for (let index = 0; index < artifacts.length; index += 1) {
              const hasTag = artifactDetails[index].tag_ids.includes(Number(likeTag.id))
              if (hasTag === allLiked)
                await toggleArtifactTag(artifacts[index].workspace_artifact_id, Number(likeTag.id))
            }
            const refreshed = paths.length ? await getMediaTags(paths) : {}
            for (const artifact of artifacts) {
              const metadata = await getArtifactMetadata(artifact.workspace_artifact_id)
              refreshed[artifact.fullpath] = (info?.tags || []).filter((tag) =>
                metadata.tag_ids.includes(Number(tag.id))
              )
            }
            setTagsByPath((previous) => ({ ...previous, ...refreshed }))
          } catch (cause) {
            showError(cause)
          } finally {
            setBusyAction(false)
          }
        })()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [
    previewIndex,
    displayItems,
    folderPath,
    roots,
    selectedFiles,
    readOnly,
    busyAction,
    customTags,
    info,
    m
  ])
  const rootForFolder = roots.find(
    (root) =>
      folderPath === root.path ||
      folderPath.startsWith(
        `${root.path.replace(/[\\/]+$/, '')}${root.path.includes('\\') ? '\\' : '/'}`
      )
  )
  const breadcrumbs =
    folderPath && rootForFolder
      ? [
          { name: rootForFolder.alias || basename(rootForFolder.path), path: rootForFolder.path },
          ...folderPath
            .slice(rootForFolder.path.replace(/[\\/]+$/, '').length)
            .split(/[\\/]/)
            .filter(Boolean)
            .map((name, index, parts) => ({
              name,
              path: parts
                .slice(0, index + 1)
                .reduce((parent, part) => joinPath(parent, part), rootForFolder.path)
            }))
        ]
      : []

  return (
    <div
      className={`ml-page ml-gallery-page${section === 'folders' && !folderPath ? ' ml-directory-page' : ''}${selectedFiles.length ? ' has-selection' : ''}`}
      ref={pageRef}
      onPointerEnter={() => {
        pointerInPage.current = true
      }}
      onPointerLeave={() => {
        pointerInPage.current = false
      }}
    >
      {error && (
        <Alert
          color="red"
          variant="light"
          withCloseButton
          onClose={() => setError('')}
          className="ml-alert"
        >
          {error}
        </Alert>
      )}

      {section === 'folders' && !folderPath ? (
        <>
          <div
            className={`ml-sticky-controls${headerOverlapsContent ? ' has-scrolled-content' : ''}`}
          >
            <div className="ml-header-depth" aria-hidden="true" />
            <header className="ml-library-header">
              <div className="ml-toolbar ml-library-search">
                <div className="ml-search-form">
                  <TextInput
                    className="ml-search-input"
                    placeholder={m('查找已添加的文件夹')}
                    aria-label={m('查找目录')}
                    leftSection={<IconSearch size={17} />}
                    value={folderQuery}
                    onChange={(event) => setFolderQuery(event.currentTarget.value)}
                  />
                </div>
              </div>
              <Button
                className="ml-library-add"
                size="sm"
                variant="filled"
                disabled={readOnly}
                aria-label={m('添加文件夹')}
                title={m('添加文件夹')}
                leftSection={<IconPlus size={17} />}
                onClick={() => {
                  setFolderInput('')
                  setFolderModal('root')
                }}
              >
                {m('添加文件夹')}
              </Button>
            </header>
            <div className="ml-results-bar">
              <Text size="xs" c="dimmed">
                {m('已添加 {count} 个文件夹', { count: roots.length })}
              </Text>
              <Tooltip label={m('刷新目录')}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  aria-label={m('刷新目录')}
                  onClick={() => {
                    setFolderChildren({})
                    void refreshInfo()
                  }}
                >
                  <IconRefresh size={18} />
                </ActionIcon>
              </Tooltip>
            </div>
          </div>
          {movingFolderPath && (
            <div className="ml-move-banner" role="status">
              <Text size="sm">
                {m('正在移动 {name}：点击目标节点，或拖到目标上', {
                  name: basename(movingFolderPath)
                })}
              </Text>
              <Button size="compact-xs" variant="subtle" onClick={() => setMovingFolderPath('')}>
                {m('取消')}
              </Button>
            </div>
          )}
          {roots.length ? (
            <div className="ml-graph-list" aria-label={m('目录节点图')}>
              {graphRoots.map((root) => (
                <section
                  className="ml-graph-canvas"
                  key={root.path}
                  aria-label={m('{name} 的目录节点图', { name: root.alias || basename(root.path) })}
                >
                  <FolderGraphNode
                    path={root.path}
                    name={root.alias || basename(root.path)}
                    root
                    query={folderQuery}
                    focusedPath={folderPath}
                    movingPath={movingFolderPath}
                    readonly={readOnly}
                    icons={folderIcons}
                    expandedPaths={expandedPaths}
                    children={folderChildren}
                    loadingPath={loadingFolderPath}
                    onToggle={(path) => void toggleFolder(path)}
                    onOpen={showFolder}
                    onMove={requestFolderMove}
                    onDropFiles={stageFileDrop}
                    onAction={folderAction}
                  />
                </section>
              ))}
              {isTauri() && (
                <Text size="xs" c="dimmed" mt="sm">
                  {m('也可以将资源管理器中的文件夹拖入此页添加到媒体库。')}
                </Text>
              )}
            </div>
          ) : (
            <div className="ml-empty">
              <IconFolderPlus size={38} stroke={1.3} />
              <Title order={3}>{m('添加你的第一个文件夹')}</Title>
              <Text c="dimmed">{m('文件保持原位，添加后即可扫描、浏览和整理。')}</Text>
              <Button
                mt="md"
                leftSection={<IconPlus size={16} />}
                disabled={readOnly}
                onClick={() => {
                  setFolderInput('')
                  setFolderModal('root')
                }}
              >
                {m('添加文件夹')}
              </Button>
            </div>
          )}
        </>
      ) : (
        <>
          {breadcrumbs.length > 0 && (
            <nav className="ml-breadcrumbs" aria-label={m('文件夹位置')}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={m('返回目录')}
                onClick={() => showFolder('')}
              >
                <IconArrowLeft size={17} />
              </ActionIcon>
              <IconFolder size={17} />
              {breadcrumbs.map((crumb, index) => (
                <span key={`${crumb.path}:${index}`}>
                  <button
                    type="button"
                    onClick={() => showFolder(crumb.path)}
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes('application/x-omnigallery-files'))
                        event.preventDefault()
                    }}
                    onDrop={(event) => dropFilesOnFolder(event, crumb.path)}
                    aria-current={index === breadcrumbs.length - 1 ? 'location' : undefined}
                  >
                    {crumb.name}
                  </button>
                  {index < breadcrumbs.length - 1 && <span className="ml-crumb-separator">/</span>}
                </span>
              ))}
              <Button
                ml="auto"
                size="xs"
                variant={walkMode ? 'light' : 'subtle'}
                onClick={() =>
                  walkMode ? showCurrentFolderOnly() : showAllFolderContents(folderPath)
                }
              >
                {m(walkMode ? '仅当前文件夹' : '查看全部内容')}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                leftSection={<IconFolderPlus size={16} />}
                disabled={readOnly}
                onClick={() => {
                  setFolderInput('')
                  setFolderModalParent(folderPath)
                  setFolderModal('child')
                }}
              >
                {m('新建子文件夹')}
              </Button>
              <Menu withinPortal position="bottom-end">
                <Menu.Target>
                  <ActionIcon variant="subtle" color="gray" aria-label={m('文件夹操作')}>
                    <IconDots size={17} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item
                    onClick={() =>
                      walkMode ? showCurrentFolderOnly() : showAllFolderContents(folderPath)
                    }
                  >
                    {m(walkMode ? '仅当前文件夹' : '查看全部内容')}
                  </Menu.Item>
                  <Menu.Item
                    onClick={() => {
                      setPollIntervalDraft(pollInterval)
                      setFolderOptionsOpen(true)
                    }}
                  >
                    {m('查看选项')}
                  </Menu.Item>
                  {!isTauri() && (
                    <Menu.Item onClick={() => void shareFolder().catch(showError)}>
                      {m('分享目录链接')}
                    </Menu.Item>
                  )}
                  <Menu.Divider />
                  <Menu.Item
                    color="red"
                    disabled={readOnly || flattenBusy}
                    onClick={() => void reviewFlatten()}
                  >
                    {m('压平文件夹')}
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </nav>
          )}
          {walkMode && (
            <div className="ml-walk-banner" role="status">
              <Text size="sm">{m('逐级读取子目录，包含尚未扫描的媒体文件。')}</Text>
              <Text size="xs" c="dimmed">
                {m('已读取 {count} 项，待读取 {pending} 个目录', {
                  count: items.length,
                  pending: walkPendingDirectories
                })}
              </Text>
            </div>
          )}
          {subfolders.length > 0 && (
            <div className="ml-subfolder-strip" aria-label={m('子文件夹')}>
              <Text size="xs" c="dimmed" fw={600}>
                {m('子文件夹')}
              </Text>
              {subfolders.map((folder) => (
                <div
                  className="ml-subfolder-chip"
                  key={folder.fullpath}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setSubfolderMenuPath(folder.fullpath)
                  }}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes('application/x-omnigallery-files'))
                      event.preventDefault()
                  }}
                  onDrop={(event) => dropFilesOnFolder(event, folder.fullpath)}
                >
                  <Button
                    size="xs"
                    variant="light"
                    color="gray"
                    leftSection={<IconFolder size={15} />}
                    onClick={() => showFolder(folder.fullpath)}
                  >
                    {folder.name}
                  </Button>
                  <Menu
                    withinPortal
                    opened={subfolderMenuPath === folder.fullpath}
                    onChange={(open) =>
                      setSubfolderMenuPath((current) =>
                        open ? folder.fullpath : current === folder.fullpath ? null : current
                      )
                    }
                    position="bottom-start"
                  >
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size="sm"
                        aria-label={m('目录操作：{name}', { name: folder.name })}
                      >
                        <IconDots size={15} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={() => showFolder(folder.fullpath)}>
                        {m('浏览文件')}
                      </Menu.Item>
                      <Menu.Item onClick={() => showAllFolderContents(folder.fullpath)}>
                        {m('查看全部内容')}
                      </Menu.Item>
                      <Menu.Item onClick={() => folderAction('copy', folder.fullpath)}>
                        {m('复制路径')}
                      </Menu.Item>
                      <Menu.Item onClick={() => folderAction('refresh', folder.fullpath)}>
                        {m('刷新下级目录')}
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                  {!readOnly && (
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      size="sm"
                      aria-label={m('删除空文件夹：{name}', { name: folder.name })}
                      onClick={() => setFolderDeleting(folder.fullpath)}
                    >
                      <IconX size={15} />
                    </ActionIcon>
                  )}
                </div>
              ))}
            </div>
          )}
          <div
            className={`ml-sticky-controls${headerOverlapsContent ? ' has-scrolled-content' : ''}`}
          >
            <div className="ml-header-depth" aria-hidden="true" />
            <header className="ml-library-header">
              <div className="ml-toolbar ml-library-search">
                <form
                  ref={aiSearchFormRef}
                  className={`ml-search-form${searchMode === 'visual' ? ' is-ai-mode' : ''}`}
                  onSubmit={(event) => {
                    event.preventDefault()
                    submitSearch()
                  }}
                  onDragOver={(event) => {
                    if (
                      Array.from(event.dataTransfer.items).some((item) =>
                        item.type.startsWith('image/')
                      )
                    )
                      event.preventDefault()
                  }}
                  onDrop={(event) => {
                    const file = Array.from(event.dataTransfer.files).find((item) =>
                      item.type.startsWith('image/')
                    )
                    if (!file) return
                    event.preventDefault()
                    void chooseSimilarFile(file)
                  }}
                >
                  {searchMode === 'visual' && <AISearchGlow target={aiSearchFormRef} />}
                  <TextInput
                    className="ml-search-input"
                    aria-label={m('搜索媒体')}
                    placeholder={
                      searchMode === 'visual'
                        ? m('描述想找的画面')
                        : walkMode
                          ? m('搜索当前文件夹及子目录的文件名')
                          : folderPath
                            ? m('搜索当前文件夹中的媒体')
                            : m('搜索文件名、标签或描述')
                    }
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.currentTarget.value)}
                    onPaste={(event) => {
                      const file = Array.from(event.clipboardData.files).find((item) =>
                        item.type.startsWith('image/')
                      )
                      if (!file) return
                      event.preventDefault()
                      void chooseSimilarFile(file)
                    }}
                    rightSection={
                      searchInput && (
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          aria-label={m('清除搜索文字')}
                          onClick={() => {
                            setSearchInput('')
                            setQuery('')
                            setVisualQuery('')
                            setSimilarSource(null)
                          }}
                        >
                          <IconX size={15} />
                        </ActionIcon>
                      )
                    }
                  />
                  {!walkMode && section !== 'audio' && section !== 'video' && (
                    <Tooltip
                      label={m(searchMode === 'visual' ? '关闭 AI 画面搜索' : '开启 AI 画面搜索')}
                    >
                      <Button
                        type="button"
                        className="ml-ai-toggle"
                        variant="subtle"
                        size="compact-xs"
                        leftSection={<IconSparkles size={15} />}
                        aria-label={m('AI 画面搜索')}
                        aria-pressed={searchMode === 'visual'}
                        onClick={() => {
                          setSearchMode(searchMode === 'visual' ? 'keyword' : 'visual')
                          setSimilarSource(null)
                          setQuery('')
                          setVisualQuery('')
                          setVisualResult(null)
                          setSelected(new Set())
                          setError('')
                        }}
                      >
                        AI
                      </Button>
                    </Tooltip>
                  )}
                  <Tooltip label={m('以图搜图，也可在搜索框粘贴或拖入图片')}>
                    <ActionIcon
                      type="button"
                      variant="subtle"
                      color="gray"
                      size="lg"
                      aria-label={m('以图搜图')}
                      disabled={walkMode}
                      onClick={() => uploadRef.current?.click()}
                    >
                      <IconPhoto size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <ActionIcon
                    className="ml-search-submit"
                    type="submit"
                    variant="subtle"
                    color="gray"
                    size="lg"
                    aria-label={m(searchMode === 'visual' ? '搜索画面' : '搜索')}
                  >
                    <IconSearch size={18} />
                  </ActionIcon>
                </form>
                <Popover width={340} position="bottom-start" withArrow shadow="md">
                  <Popover.Target>
                    <ActionIcon variant="subtle" color="gray" size="lg" aria-label={m('搜索说明')}>
                      <IconHelpCircle size={19} />
                    </ActionIcon>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Stack gap="xs" className="ml-search-help">
                      <Text size="sm" fw={650}>
                        {m(searchMode === 'visual' ? '画面搜索' : '文字搜索')}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {m(
                          walkMode
                            ? '递归浏览只匹配文件名；高级搜索请返回当前文件夹。'
                            : searchMode === 'visual'
                              ? '用自然语言描述画面，已选筛选条件仍然生效。'
                              : '查找文件名、标签和描述，不搜索路径；空格分隔多个条件。'
                        )}
                      </Text>
                      {searchMode === 'keyword' ? (
                        <>
                          <Text size="xs">
                            <code>tag:</code> · <code>name:</code> · <code>desc:</code> ·{' '}
                            <code>has:desc</code>
                          </Text>
                          <Text size="xs" c="dimmed">
                            {m('支持排除词、OR、括号和带引号的短语。')}
                          </Text>
                          {[
                            'tag:风景 -tag:模糊',
                            '(tag:风景 OR tag:城市) desc:夜景',
                            'name:"IMG 001" has:desc'
                          ].map((example) => (
                            <Button
                              key={example}
                              size="compact-xs"
                              variant="subtle"
                              justify="start"
                              onClick={() => {
                                setSearchMode('keyword')
                                setSearchInput(example)
                                setQuery(example)
                                setSimilarSource(null)
                              }}
                            >
                              {example}
                            </Button>
                          ))}
                        </>
                      ) : (
                        <>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            justify="start"
                            onClick={() => {
                              const example = m('雨夜街道上的霓虹灯')
                              setSearchInput(example)
                              setVisualQuery(example)
                              setSimilarSource(null)
                            }}
                          >
                            {m('雨夜街道上的霓虹灯')}
                          </Button>
                          <Switch
                            size="xs"
                            label={m('AI 重排')}
                            checked={visualRerank}
                            disabled={rerankerStatus?.state !== 'ready'}
                            title={m(
                              rerankerStatus?.state === 'ready'
                                ? '对前 20 张候选图片再次排序'
                                : 'AI 重排暂不可用，请在设置中配置'
                            )}
                            onChange={(event) => setVisualRerank(event.currentTarget.checked)}
                          />
                          <Text size="xs" c="dimmed">
                            {visualStatus?.state === 'ready'
                              ? m('画面索引 {indexed} / {total}', {
                                  indexed: visualStatus.indexed_count || 0,
                                  total: visualStatus.image_count || 0
                                })
                              : visualStatus
                                ? m('画面搜索尚未就绪，请在设置中配置模型')
                                : m('正在检查画面搜索状态…')}
                          </Text>
                          {visualStatus?.state === 'ready' && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              loading={busyAction || visualStatus.running}
                              onClick={() => void updateVisualIndex()}
                            >
                              {m(visualStatus.indexed_count ? '更新索引' : '建立索引')}
                            </Button>
                          )}
                        </>
                      )}
                    </Stack>
                  </Popover.Dropdown>
                </Popover>
                <input
                  ref={uploadRef}
                  type="file"
                  accept="image/*"
                  hidden
                  aria-label={m('选择参考图片')}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void chooseSimilarFile(file)
                    event.target.value = ''
                  }}
                />
              </div>
              <Button
                className="ml-library-add"
                size="sm"
                variant="filled"
                aria-label={m('添加文件夹')}
                title={m('添加文件夹')}
                leftSection={<IconPlus size={17} />}
                disabled={readOnly}
                onClick={() => {
                  setFolderInput('')
                  setFolderModal('root')
                }}
              >
                {m('添加文件夹')}
              </Button>
            </header>
            {similarSource && (
              <div className="ml-similar-bar">
                <img src={similarSource.preview} alt={m('搜图参考图片')} />
                <div className="ml-similar-source">
                  <Text fw={600} size="sm">
                    {m('以图搜图')}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={1}>
                    {similarSource.name}
                  </Text>
                </div>
                <SegmentedControl
                  size="xs"
                  value={similarMethod}
                  onChange={(value) => {
                    setSimilarMethod(value as 'qwen' | 'hash')
                    setSimilarMinimum(value === 'hash' ? 70 : 0)
                  }}
                  data={[
                    { label: m('AI 相似'), value: 'qwen' },
                    { label: m('找重复'), value: 'hash' }
                  ]}
                />
                <div className="ml-score-slider">
                  <Text size="xs">{m('最低相关度 {value}', { value: similarMinimum })}</Text>
                  <Slider
                    size="xs"
                    min={0}
                    max={100}
                    step={5}
                    value={similarMinimum}
                    onChange={setSimilarMinimum}
                  />
                </div>
                <Button size="xs" variant="subtle" onClick={() => uploadRef.current?.click()}>
                  {m('更换图片')}
                </Button>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label={m('退出搜图')}
                  onClick={() => setSimilarSource(null)}
                >
                  <IconX size={18} />
                </ActionIcon>
              </div>
            )}
            <div className="ml-results-bar">
              <Group gap={8}>
                <Text size="sm" c="dimmed">
                  {similarSource
                    ? similarBusy
                      ? m('正在查找…')
                      : m('找到 {count} 项', { count: displayItems.length })
                    : visualQuery
                      ? visualBusy
                        ? m('正在匹配画面…')
                        : m('画面搜索 · {count} 项', { count: displayItems.length })
                      : info && !folderPath && section === 'all' && !query && !activeFilterCount
                        ? m('{count} / {total} 项', {
                            count: displayItems.length,
                            total: info.media_count
                          })
                        : m('{count} 项', { count: displayItems.length })}
                </Text>
              </Group>
              <MediaLibraryViewControls
                sort={sort}
                sortOptions={sortOptions}
                onSort={(value) => setSort(value as SortMode)}
                cardSize={cardSize}
                onCardSize={(value) => setCardSize(value as 'small' | 'medium' | 'large')}
                showInformation={showInformation}
                onToggleInformation={() => setShowInformation((value) => !value)}
                activeFilterCount={activeFilterCount}
                filterDisabled={walkMode}
                filterOpen={filterOpen}
                onFilter={() => {
                  if (filterOpen) {
                    setFilterOpen(false)
                    return
                  }
                  setFilterOpen(true)
                }}
                loading={loading}
                scanning={scanning}
                restoringOrder={reorderBusy}
                readOnly={readOnly}
                hasItems={displayItems.length > 0}
                allSelected={displayItems.length > 0 && selected.size === displayItems.length}
                onRefresh={() => void refresh()}
                onScan={() => void runScan()}
                onRestoreOrder={
                  !folderPath && !similarSource && !visualQuery
                    ? () => void restoreDateOrder()
                    : undefined
                }
                onSelectAll={() =>
                  setSelected(
                    selected.size === displayItems.length
                      ? new Set()
                      : new Set(displayItems.map((file) => file.fullpath))
                  )
                }
              />
            </div>
            {activeFilterCount > 0 && (
              <div className="ml-filter-summary">
                <span>{m('已应用 {count} 项筛选', { count: activeFilterCount })}</span>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => setFilters(emptyFilters())}
                >
                  {m('清除筛选')}
                </Button>
              </div>
            )}
            {selectedFiles.length > 0 && (
              <Portal target=".omni-main">
                <div className="ml-selection-bar" role="toolbar" aria-label={m('已选择文件的操作')}>
                  <Group gap="sm">
                    <Badge variant="light" color="blue">
                      {m('已选 {count}', { count: selectedFiles.length })}
                    </Badge>
                    <Button size="xs" variant="subtle" onClick={() => setSelected(new Set())}>
                      {m('清除选择')}
                    </Button>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() =>
                        setSelected(
                          new Set(
                            displayItems
                              .filter((file) => !selected.has(file.fullpath))
                              .map((file) => file.fullpath)
                          )
                        )
                      }
                    >
                      {m('反选')}
                    </Button>
                  </Group>
                  <Group gap="xs">
                    {!!customTags.length && (
                      <Button
                        size="xs"
                        variant="default"
                        disabled={readOnly}
                        leftSection={<IconTags size={15} />}
                        onClick={() => {
                          setBatchTagAction('add')
                          setBatchTagId(null)
                          setBatchTagOpen(true)
                        }}
                      >
                        {m('标签')}
                      </Button>
                    )}
                    <Button
                      size="xs"
                      variant="default"
                      disabled={readOnly}
                      onClick={() => {
                        setTransferDestination('')
                        setTransferMode('copy')
                      }}
                    >
                      {m('复制到…')}
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      disabled={readOnly}
                      onClick={() => {
                        setTransferDestination('')
                        setTransferMode('move')
                      }}
                    >
                      {m('移动到…')}
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconDownload size={15} />}
                      disabled={readOnly}
                      onClick={() => {
                        void openExport(selectedFiles)
                      }}
                    >
                      {m('导出')}
                    </Button>
                    {selectedFiles.length === 2 &&
                      selectedFiles.every((file) => mediaKind(file) === 'image') && (
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => setComparisonMode('compare')}
                        >
                          {m('对比两张')}
                        </Button>
                      )}
                    {selectedFiles.length >= 3 &&
                      selectedFiles.length <= 9 &&
                      selectedFiles.every((file) => mediaKind(file) === 'image') && (
                        <Button
                          size="xs"
                          variant="default"
                          onClick={() => setComparisonMode('grid')}
                        >
                          {m('多图查看（{count}）', { count: selectedFiles.length })}
                        </Button>
                      )}
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      disabled={readOnly}
                      leftSection={<IconTrash size={15} />}
                      onClick={() => requestDelete(selectedFiles)}
                    >
                      {m('删除')}
                    </Button>
                  </Group>
                </div>
              </Portal>
            )}
          </div>
          {(loading || similarBusy || visualBusy) && !displayItems.length ? (
            <div
              className="ml-grid"
              style={{ '--ml-card-min': `${cardMinWidth}px` } as React.CSSProperties}
            >
              {Array.from({ length: 8 }).map((_, index) => (
                <Card key={index} padding={0} withBorder radius="md">
                  <Skeleton height={190} />
                  <Box p="sm">
                    <Skeleton height={14} width="70%" />
                    <Skeleton height={10} mt={8} width="45%" />
                  </Box>
                </Card>
              ))}
            </div>
          ) : displayItems.length ? (
            <MasonryGallery
              items={displayItems}
              cardMinWidth={cardMinWidth}
              renderItem={(file) => (
                <MediaCard
                  key={file.fullpath}
                  file={file}
                  tags={tagsByPath[file.fullpath] || emptyCardTags}
                  availableTags={customTags}
                  favoriteTag={favoriteTag}
                  thumbnailsEnabled={browsePreferences.enableThumbnail}
                  thumbnailSize={browsePreferences.gridThumbnailResolution}
                  longPressOpenContextMenu={generalPreferences.longPressOpenContextMenu}
                  checked={selected.has(file.fullpath)}
                  showInformation={showInformation}
                  multiSelected={selected.has(file.fullpath) && selectedFiles.length > 1}
                  readonly={readOnly}
                  reorderDisabled={
                    readOnly ||
                    reorderBusy ||
                    loading ||
                    loadingMore ||
                    walkMode ||
                    sort !== 'manual' ||
                    !!similarSource ||
                    !!visualQuery
                  }
                  relevance={
                    similarSource
                      ? (file as MediaFile & { similarity?: number }).similarity
                      : visualQuery
                        ? (file as MediaFile & { relevance?: number }).relevance
                        : undefined
                  }
                  actions={cardActions}
                  canEditOriginal={!!onEditMedia && isEditableOriginalImage(file)}
                />
              )}
            />
          ) : (
            <div className="ml-empty">
              <IconPhoto size={40} stroke={1.3} />
              <Title order={3}>
                {similarSource
                  ? m('没有找到相似图片')
                  : visualQuery
                    ? m('没有找到相关画面')
                    : query
                      ? m('没有找到匹配的媒体')
                      : walkMode && cursor.has_next
                        ? m('正在逐级读取目录')
                        : m('这里还没有媒体文件')}
              </Title>
              <Text c="dimmed">
                {similarSource
                  ? m('试着降低最低相关度，或换一张参考图片。')
                  : visualQuery
                    ? m('试试换一种描述，或更新画面索引。')
                    : query
                      ? m('试试其他关键词或调整筛选条件。')
                      : walkMode && cursor.has_next
                        ? m('继续读取下一个目录以查找文件。')
                        : m('添加媒体文件夹并扫描后，就能在这里浏览。')}
              </Text>
              <Button
                mt="md"
                variant="light"
                onClick={() => {
                  setQuery('')
                  setSearchInput('')
                  setSimilarSource(null)
                  setVisualQuery('')
                  setFilters(emptyFilters())
                  void refresh()
                }}
              >
                {m(similarSource || query || visualQuery ? '清除搜索' : '刷新')}
              </Button>
            </div>
          )}
          {!similarSource && !visualQuery && cursor.has_next && (
            <div ref={bottomRef} className="ml-load-more">
              <Button
                variant="subtle"
                loading={loadingMore}
                onClick={() => void loadPage(cursor.next, true)}
              >
                {m(walkMode ? '读取下一个目录' : '加载更多')}
              </Button>
            </div>
          )}
        </>
      )}

      <LazyModal
        opened={folderOptionsOpen}
        onClose={() => setFolderOptionsOpen(false)}
        title={m('查看选项')}
        centered
      >
        {() => (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {m('停留在当前目录时，按设定间隔静默刷新文件列表；打开预览时暂停。')}
            </Text>
            <NumberInput
              label={m('轮询间隔（秒）')}
              min={1}
              max={600}
              allowDecimal={false}
              value={pollIntervalDraft}
              onChange={(value) => setPollIntervalDraft(typeof value === 'number' ? value : 3)}
              disabled={polling || walkMode}
            />
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {walkMode
                  ? m('递归浏览期间不启用轮询刷新。')
                  : polling
                    ? m('正在轮询刷新')
                    : m('轮询刷新未开启')}
              </Text>
              <Group gap="xs">
                {!isTauri() && (
                  <Button variant="subtle" onClick={() => void shareFolder().catch(showError)}>
                    {m('分享目录链接')}
                  </Button>
                )}
                <Button
                  variant={polling ? 'default' : 'filled'}
                  disabled={walkMode}
                  onClick={togglePolling}
                >
                  {m(polling ? '停止轮询刷新' : '开始轮询刷新')}
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </LazyModal>

      <MediaFilterPanel opened={filterOpen} onClose={() => setFilterOpen(false)}>
        {filterOpen && (
          <MediaFilterForm
            layout="panel"
            initialValue={filters}
            showIncludeSubfolders={!!folderPath}
            initialIncludeSubfolders={includeSubfolders}
            tags={info?.tags || []}
            onApply={(draft, subfolders) => {
              setFilters(draft)
              setIncludeSubfolders(subfolders)
              setFilterOpen(false)
            }}
          />
        )}
      </MediaFilterPanel>

      <MediaPreview
        files={displayItems}
        index={previewIndex}
        onClose={() => setPreviewIndex(null)}
        onIndexChange={setPreviewIndex}
        hasMore={!similarSource && !visualQuery && cursor.has_next}
        loadingMore={loadingMore}
        onLoadMore={() => loadPage(cursor.next, true)}
        readonly={readOnly}
        availableTags={customTags}
        initialTags={preview ? tagsByPath[preview.fullpath] : undefined}
        onTagsUpdated={(path, tags) => setTagsByPath((current) => ({ ...current, [path]: tags }))}
        onAudioUpdated={audioMetadataUpdated}
        onCreateDraft={
          onOpenEditor
            ? (file) => {
                void openCreate(file)
              }
            : undefined
        }
        onEditMedia={onEditMedia}
        onDelete={(file) => requestDelete([file])}
        onDownload={(file) => setConfirmDownload([file])}
      />
      <ComparisonView
        files={selectedFiles}
        mode={comparisonMode}
        onClose={() => setComparisonMode(null)}
      />

      <LazyModal
        opened={createFile !== null}
        onClose={() => !creating && setCreateFile(null)}
        title={m('从媒体新建制作')}
        centered
      >
        {() => (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {createFile?.name}
            </Text>
            {createLoading && <Loader size="sm" />}
            {createError && <Alert color="red">{createError}</Alert>}
            {createTarget && (
              <>
                <Text size="sm">
                  {m('工作区')}：{createTarget.workspaceName}
                </Text>
                <Select
                  label={m('目标作品')}
                  data={createTarget.works.map((work) => ({ value: work.id, label: work.name }))}
                  value={createWorkId}
                  onChange={(value) => setCreateWorkId(value || '')}
                  allowDeselect={false}
                />
                <TextInput
                  label={m('制作文件名称')}
                  value={createName}
                  maxLength={80}
                  onChange={(event) => setCreateName(event.currentTarget.value)}
                />
                <Group justify="flex-end">
                  <Button variant="default" onClick={() => setCreateFile(null)} disabled={creating}>
                    {m('取消')}
                  </Button>
                  <Button
                    loading={creating}
                    disabled={!createWorkId || !createName.trim()}
                    onClick={() => void finishCreate()}
                  >
                    {m('创建并编辑')}
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        )}
      </LazyModal>

      <LazyModal
        opened={folderModal !== null}
        onClose={() => setFolderModal(null)}
        title={m(folderModal === 'root' ? '添加媒体文件夹' : '新建子文件夹')}
        centered
      >
        {() => (
          <Stack>
            <Text size="sm" c="dimmed">
              {folderModal === 'root'
                ? m('文件保留在原位置，不会复制或上传。')
                : m('在 {path} 中创建真实文件夹。', { path: folderModalParent || folderPath })}
            </Text>
            <Group align="end" wrap="nowrap">
              <TextInput
                autoFocus
                className="ml-folder-input"
                label={m(folderModal === 'root' ? '文件夹绝对路径' : '子文件夹名称')}
                value={folderInput}
                onChange={(event) => setFolderInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveFolder()
                }}
              />
              {folderModal === 'root' && (
                <Button
                  variant="default"
                  onClick={() =>
                    void (
                      isTauri()
                        ? openDesktopFolderPicker({ directory: true })
                        : getFolderPickerPath()
                    )
                      .then((path) => typeof path === 'string' && setFolderInput(path))
                      .catch(showError)
                  }
                >
                  {m('浏览…')}
                </Button>
              )}
            </Group>
            <Group justify="end">
              <Button variant="default" onClick={() => setFolderModal(null)}>
                {m('取消')}
              </Button>
              <Button loading={busyAction} onClick={() => void saveFolder()}>
                {m('添加')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={renaming !== null}
        onClose={() => setRenaming(null)}
        title={m('重命名文件')}
        centered
      >
        {() => (
          <Stack>
            <TextInput
              autoFocus
              label={m('文件名')}
              value={newName}
              onChange={(event) => setNewName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveRename()
              }}
            />
            <Group justify="end">
              <Button variant="default" onClick={() => setRenaming(null)}>
                {m('取消')}
              </Button>
              <Button loading={busyAction} onClick={() => void saveRename()}>
                {m('保存')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={exportFiles !== null}
        onClose={() => !exportBusy && setExportFiles(null)}
        title={m('导出 {count} 项', { count: exportFiles?.length || 0 })}
        centered
      >
        {() => (
          <Stack gap="md">
            <Radio.Group
              value={exportMode}
              onChange={(value) => setExportMode(value as 'download' | 'archive')}
            >
              <Stack gap="xs">
                <Radio value="download" label={m('下载到电脑（ZIP）')} disabled={exportBusy} />
                <Radio value="archive" label={m('保存到应用归档目录')} disabled={exportBusy} />
              </Stack>
            </Radio.Group>
            <Text size="sm" c="dimmed">
              {exportMode === 'download'
                ? m('由浏览器下载到你的电脑。')
                : m('保存在运行媒体库的机器上，完成后显示保存路径。')}
            </Text>
            {exportMode === 'archive' && (
              <Text size="sm">
                {m('目标目录：{path}', { path: archiveDirectory || m('读取中…') })}
              </Text>
            )}
            <Checkbox
              label={m('压缩 ZIP 内容')}
              checked={exportCompress}
              onChange={(event) => setExportCompress(event.currentTarget.checked)}
              disabled={exportBusy}
            />
            <Group justify="flex-end">
              <Button variant="default" disabled={exportBusy} onClick={() => setExportFiles(null)}>
                {m('取消')}
              </Button>
              <Button
                loading={exportBusy}
                onClick={() => {
                  void finishExport()
                }}
              >
                {m('导出')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={!!archivePath}
        onClose={() => setArchivePath('')}
        title={m('归档已保存')}
        centered
      >
        {() => (
          <Stack>
            <Text size="sm">{m('ZIP 文件已保存到以下位置：')}</Text>
            <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
              {archivePath}
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(archivePath)
                    .then(() => setNotice(m('路径已复制')))
                    .catch(showError)
                }}
              >
                {m('复制路径')}
              </Button>
              <Button onClick={() => setArchivePath('')}>{m('完成')}</Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={workspaceTarget !== null}
        onClose={() => !workspaceBusy && setWorkspaceTarget(null)}
        title={m('加入工作区')}
        centered
      >
        {() => (
          <Stack>
            <Text size="sm" c="dimmed">
              {m('将 {count} 个媒体文件加入工作区。', { count: workspaceTarget?.length || 0 })}
            </Text>
            <Select
              label={m('工作区')}
              data={workspaces.map((workspace) => ({
                value: workspace.id,
                label: `${workspace.name}${workspace.status === 'paused' ? ` ${m('（已搁置）')}` : ''}`
              }))}
              placeholder={workspaces.length ? m('选择工作区') : m('请先在工作台创建工作区')}
              searchable
              value={workspaceId}
              onChange={setWorkspaceId}
              disabled={workspaceBusy || !workspaces.length}
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={workspaceBusy}
                onClick={() => setWorkspaceTarget(null)}
              >
                {m('取消')}
              </Button>
              <Button
                loading={workspaceBusy}
                disabled={!workspaceId}
                onClick={() => {
                  void addToWorkspace()
                }}
              >
                {m('加入')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={confirmDownload !== null}
        onClose={() => setConfirmDownload(null)}
        title={m('下载文件？')}
        centered
      >
        {() => (
          <Stack>
            <Text size="sm">
              {confirmDownload?.length === 1
                ? confirmDownload[0].name
                : m('将下载 {count} 个文件。', { count: confirmDownload?.length || 0 })}
            </Text>
            <Group justify="end">
              <Button variant="default" onClick={() => setConfirmDownload(null)}>
                {m('取消')}
              </Button>
              <Button onClick={downloadConfirmed}>{m('下载')}</Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={m('确认删除文件')}
        centered
      >
        {() => (
          <Stack>
            <Text size="sm">
              {m('将从本机磁盘删除 {count} 个文件。此操作无法在应用内撤销。', {
                count: confirmDelete?.length || 0
              })}
            </Text>
            <Group justify="end">
              <Button variant="default" onClick={() => setConfirmDelete(null)}>
                {m('取消')}
              </Button>
              <Button
                color="red"
                loading={busyAction}
                onClick={() => confirmDelete && void performDelete(confirmDelete)}
              >
                {m('删除')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={tagEditing !== null}
        onClose={closeTagEditor}
        title={m('编辑标签')}
        centered
      >
        {() => (
          <Stack>
            <Text size="xs" c="dimmed" lineClamp={1} title={tagEditing?.name}>
              {tagEditing?.name}
            </Text>
            <MediaTagPicker
              label={m('自定义标签')}
              tags={customTags}
              disabled={tagLoading || busyAction}
              value={tagIds}
              onChange={setTagIds}
            />
            <Group justify="end">
              <Button variant="default" onClick={closeTagEditor}>
                {m('取消')}
              </Button>
              <Button loading={busyAction || tagLoading} onClick={() => void saveTags()}>
                {m('保存标签')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={batchTagOpen}
        onClose={() => !busyAction && setBatchTagOpen(false)}
        title={m('批量编辑标签')}
        centered
      >
        {() => (
          <Stack>
            <Text size="sm" c="dimmed">
              {m('将对已选的 {count} 个文件执行此操作。', { count: selectedFiles.length })}
            </Text>
            <SegmentedControl
              aria-label={m('批量标签操作')}
              value={batchTagAction}
              onChange={(value) => setBatchTagAction(value as 'add' | 'remove')}
              data={[
                { value: 'add', label: m('添加标签') },
                { value: 'remove', label: m('移除标签') }
              ]}
              fullWidth
            />
            <Select
              label={m('选择标签')}
              placeholder={m('搜索现有标签')}
              data={tagChoices}
              value={batchTagId}
              onChange={setBatchTagId}
              searchable
            />
            <Group justify="end">
              <Button
                variant="default"
                disabled={busyAction}
                onClick={() => setBatchTagOpen(false)}
              >
                {m('取消')}
              </Button>
              <Button
                loading={busyAction}
                disabled={!batchTagId}
                onClick={() => void saveBatchTag()}
              >
                {m(batchTagAction === 'add' ? '添加到已选' : '从已选移除')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={transferMode !== null}
        onClose={() => setTransferMode(null)}
        title={m(transferMode === 'move' ? '移动文件' : '复制文件')}
        centered
      >
        {() => (
          <Stack>
            <Text size="sm" c="dimmed">
              {m('已选择 {count} 个文件。目标必须是现有文件夹。', { count: selectedFiles.length })}
            </Text>
            <Select
              label={m('已添加的目录')}
              placeholder={m('选择目录，或在下方填写子目录路径')}
              data={roots.map((root) => ({
                value: root.path,
                label: root.alias || basename(root.path)
              }))}
              value={
                roots.some((root) => root.path === transferDestination) ? transferDestination : null
              }
              onChange={(value) => setTransferDestination(value || '')}
              searchable
            />
            <TextInput
              label={m('目标文件夹路径')}
              value={transferDestination}
              onChange={(event) => setTransferDestination(event.currentTarget.value)}
            />
            <Group justify="end">
              <Button variant="default" onClick={() => setTransferMode(null)}>
                {m('取消')}
              </Button>
              <Button loading={busyAction} onClick={() => void saveTransfer()}>
                {m(transferMode === 'move' ? '移动' : '复制')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={aliasRoot !== null}
        onClose={() => setAliasRoot(null)}
        title={m('修改显示名称')}
        centered
      >
        {() => (
          <Stack>
            <Text size="xs" c="dimmed">
              {aliasRoot?.path}
            </Text>
            <TextInput
              autoFocus
              label={m('显示名称')}
              value={aliasInput}
              onChange={(event) => setAliasInput(event.currentTarget.value)}
            />
            <Group justify="end">
              <Button variant="default" onClick={() => setAliasRoot(null)}>
                {m('取消')}
              </Button>
              <Button
                loading={busyAction}
                onClick={() => {
                  if (!aliasRoot) return
                  setBusyAction(true)
                  void aliasLibraryRoot(aliasRoot.path, aliasInput.trim())
                    .then(refreshInfo)
                    .then(() => {
                      setAliasRoot(null)
                      announceFoldersUpdated()
                    })
                    .catch(showError)
                    .finally(() => setBusyAction(false))
                }}
              >
                {m('保存')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={removingRoot !== null}
        onClose={() => setRemovingRoot(null)}
        title={m('移除目录入口')}
        centered
      >
        {() => (
          <Stack>
            <Text size="sm">
              {m('只移除“{name}”的浏览入口，不会删除磁盘文件。', {
                name: removingRoot?.alias || basename(removingRoot?.path || '')
              })}
            </Text>
            <Group justify="end">
              <Button variant="default" onClick={() => setRemovingRoot(null)}>
                {m('取消')}
              </Button>
              <Button
                color="red"
                loading={busyAction}
                onClick={() => {
                  if (!removingRoot) return
                  setBusyAction(true)
                  void removeLibraryRoot(removingRoot)
                    .then(refreshInfo)
                    .then(() => {
                      setRemovingRoot(null)
                      announceFoldersUpdated()
                    })
                    .catch(showError)
                    .finally(() => setBusyAction(false))
                }}
              >
                {m('移除入口')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      {iconEditing && (
        <FolderIconPicker
          path={iconEditing.path}
          name={iconEditing.name}
          current={folderIcons[iconEditing.path] || ''}
          onClose={() => setIconEditing(null)}
          onSaved={(icon) => {
            setFolderIcons((current) => {
              const next = { ...current }
              if (icon) next[iconEditing.path] = icon
              else delete next[iconEditing.path]
              return next
            })
            announceFoldersUpdated()
            setNotice(m('目录图标已更新'))
          }}
        />
      )}
      <LazyModal
        opened={droppedFolders !== null}
        onClose={() => {
          if (!busyAction) setDroppedFolders(null)
        }}
        centered
        size="lg"
        closeOnClickOutside={!busyAction}
        closeOnEscape={!busyAction}
        title={m('添加 {count} 个文件夹？', { count: droppedFolders?.length || 0 })}
      >
        {() => (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {m('文件保留在原位置，不会复制或上传。')}
            </Text>
            <Stack gap={6} style={{ maxHeight: 260, overflowY: 'auto' }}>
              {droppedFolders?.map((path) => (
                <Text key={path} size="sm" style={{ overflowWrap: 'anywhere' }}>
                  {path}
                </Text>
              ))}
            </Stack>
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={busyAction}
                onClick={() => setDroppedFolders(null)}
              >
                {m('取消')}
              </Button>
              <Button loading={busyAction} onClick={() => void addDroppedFolders()}>
                {m('添加并扫描')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={flattenReview !== null}
        onClose={() => {
          if (!flattenBusy) setFlattenReview(null)
        }}
        centered
        title={
          flattenReview?.result.conflicts.length
            ? m('发现文件名冲突，无法压平文件夹')
            : m('压平文件夹')
        }
      >
        {() =>
          flattenReview && (
            <Stack gap="md">
              <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                {flattenReview.path}
              </Text>
              {flattenReview.result.conflicts.length ? (
                <>
                  <Alert color="red">{m('下列文件名重复，移动前需要先改名：')}</Alert>
                  <Stack gap={4} style={{ maxHeight: 260, overflowY: 'auto' }}>
                    {flattenReview.result.conflicts.map((name) => (
                      <Text size="sm" key={name} style={{ overflowWrap: 'anywhere' }}>
                        {name}
                      </Text>
                    ))}
                  </Stack>
                </>
              ) : (
                <>
                  <Alert color="orange">
                    {m(
                      '子文件夹里的媒体文件将移动到当前文件夹；变空的子文件夹会被删除。非媒体文件保留原位。'
                    )}
                  </Alert>
                  <Text size="sm">
                    {m('确认移动 {count} 个文件？', { count: flattenReview.result.total_files })}
                  </Text>
                </>
              )}
              <Group justify="flex-end">
                <Button
                  variant="default"
                  disabled={flattenBusy}
                  onClick={() => setFlattenReview(null)}
                >
                  {m(flattenReview.result.conflicts.length ? '关闭' : '取消')}
                </Button>
                {!flattenReview.result.conflicts.length && (
                  <Button color="red" loading={flattenBusy} onClick={() => void performFlatten()}>
                    {m('确认移动')}
                  </Button>
                )}
              </Group>
            </Stack>
          )
        }
      </LazyModal>
      <LazyModal
        opened={folderRenaming !== null}
        onClose={() => setFolderRenaming(null)}
        centered
        title={m('修改文件夹名称')}
      >
        {() => (
          <Stack>
            <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>
              {folderRenaming}
            </Text>
            <TextInput
              autoFocus
              aria-label={m('新的文件夹名称')}
              value={newName}
              onChange={(event) => setNewName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void saveFolderRename()
              }}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setFolderRenaming(null)}>
                {m('取消')}
              </Button>
              <Button
                loading={busyAction}
                disabled={!newName.trim()}
                onClick={() => void saveFolderRename()}
              >
                {m('改名')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={folderMoving !== null}
        onClose={() => {
          setFolderMoving(null)
          setFolderMoveTarget(null)
        }}
        centered
        title={m('移动文件夹？')}
      >
        {() => (
          <Stack>
            <Text size="sm">
              {m('将「{source}」移入「{target}」。文件和子目录会一同移动。', {
                source: basename(folderMoving || ''),
                target: basename(folderMoveTarget || '')
              })}
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setFolderMoving(null)
                  setFolderMoveTarget(null)
                }}
              >
                {m('取消')}
              </Button>
              <Button loading={busyAction} onClick={() => void confirmFolderMove()}>
                {m('移动')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
      <LazyModal
        opened={folderDeleting !== null}
        onClose={() => setFolderDeleting(null)}
        centered
        title={m('删除空文件夹？')}
      >
        {() => (
          <Stack>
            <Text size="sm">
              {m('仅删除本机空文件夹「{name}」；如有文件或子目录，请先移出内容。', {
                name: basename(folderDeleting || '')
              })}
            </Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setFolderDeleting(null)}>
                {m('取消')}
              </Button>
              <Button color="red" loading={busyAction} onClick={() => void confirmFolderDelete()}>
                {m('删除文件夹')}
              </Button>
            </Group>
          </Stack>
        )}
      </LazyModal>
    </div>
  )
}
