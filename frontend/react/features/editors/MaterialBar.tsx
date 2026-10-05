import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  HoverCard,
  Menu,
  Modal,
  Popover,
  SegmentedControl,
  Tabs,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import {
  IconCheck,
  IconGridDots,
  IconMusic,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconVideo,
  IconX
} from '@tabler/icons-react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import { mergeArtifactActions } from '../../../src/features/workspaces/model/workspaceArtifactActions'
import { orderEditorMaterials } from '../../../src/features/workspaces/model/workspaceMaterials'
import {
  getDeletedArtifactIds,
  notifyArtifactDeleted,
  subscribeArtifactDeletion
} from './editorArtifactEvents'
import {
  materialScrollSettled,
  materialScrollTarget,
  stepMaterialScroll,
  type MaterialScrollMotion
} from './materialScrollMotion'
import './MaterialBar.css'

export interface MaterialAction {
  key: string
  label: string
  disabled?: boolean
  danger?: boolean
}

export interface MaterialBarProps {
  items: WorkspaceAsset[]
  assetInfo: Record<string, FileNodeInfo>
  activePath?: string
  usedPaths?: readonly string[]
  roles?: Record<string, string>
  onDragStart?: (asset: WorkspaceAsset, event: DragEvent<HTMLButtonElement>) => void
  onPreview?: (asset: WorkspaceAsset) => void
  onAdd?: () => void
  readonly?: boolean
  actions?: (asset: WorkspaceAsset) => MaterialAction[]
  onAction?: (asset: WorkspaceAsset, key: string) => void
  /** Use normal document flow instead of the editor's floating dock position. */
  embedded?: boolean
  placement?: 'above' | 'below'
  scope?: 'all' | 'used'
  /** Keep the media library's original first among references. */
  referenceFirstPath?: string
  className?: string
  style?: CSSProperties
}

function previewUrl(asset: WorkspaceAsset, file?: FileNodeInfo, size = 160) {
  if (asset.kind === 'audio') return ''
  if (file?.edit_snapshot) {
    const value = file.edit_snapshot
    return apiUrl(
      `/image_edit_asset?path=${encodeURIComponent(value.owner)}&revision=${encodeURIComponent(value.revision)}&asset=${encodeURIComponent(value.asset)}`
    )
  }
  if (file?.workspace_artifact_id)
    return apiUrl(
      `/workspace_artifacts/${encodeURIComponent(file.workspace_artifact_id)}/thumbnail?size=${size}`
    )
  if (asset.kind === 'video')
    return apiUrl(
      `/video_cover?path=${encodeURIComponent(asset.path)}&mt=${encodeURIComponent(file?.date || '')}`
    )
  return apiUrl(
    `/image-thumbnail?path=${encodeURIComponent(asset.path)}&size=${size}x${size}&t=${encodeURIComponent(file?.date || '0')}`
  )
}

function mediaUrl(asset: WorkspaceAsset, file?: FileNodeInfo) {
  if (file?.workspace_artifact_id)
    return apiUrl(`/workspace_artifacts/${encodeURIComponent(file.workspace_artifact_id)}/file`)
  return apiUrl(
    `/file?path=${encodeURIComponent(asset.path)}&t=${encodeURIComponent(file?.date || '0')}`
  )
}

const kindLabel = { image: '图片', video: '视频', audio: '音频' }

function isCreated(asset: WorkspaceAsset, info: Record<string, FileNodeInfo>) {
  return !!info[asset.path]?.workspace_artifact_id && !info[asset.path]?.workspace_input_owner
}

export default function MaterialBar({
  items,
  assetInfo,
  activePath,
  usedPaths = [],
  roles = {},
  onDragStart,
  onPreview,
  onAdd,
  readonly = false,
  actions,
  onAction,
  embedded = false,
  placement = 'above',
  scope,
  referenceFirstPath,
  className = '',
  style
}: MaterialBarProps) {
  const bar = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement>()
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | WorkspaceAsset['kind']>('all')
  const [source, setSource] = useState<'all' | 'created' | 'referenced'>('all')
  const [localScope, setLocalScope] = useState<'all' | 'used'>('all')
  const activeScope = scope ?? localScope
  const [preview, setPreview] = useState<WorkspaceAsset>()
  const [contextKey, setContextKey] = useState<string>()
  const [deletion, setDeletion] = useState<{ asset: WorkspaceAsset; id: string; used: boolean }>()
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deletedIds = useSyncExternalStore(subscribeArtifactDeletion, getDeletedArtifactIds)
  useEffect(
    () =>
      subscribeArtifactDeletion(({ path }) => {
        setPreview((current) => (current?.path === path ? undefined : current))
        setContextKey(undefined)
        setDeletion((current) => (current?.asset.path === path ? undefined : current))
      }),
    []
  )
  useEffect(() => {
    const surface = bar.current
    const viewport = strip.current
    const content = track.current
    if (!surface || !viewport || !content) return
    setPortalTarget(viewport.closest<HTMLElement>('.react-editor-shell') || undefined)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Translated edge pulls enlarge scrollWidth; measure layout width to keep the real boundary fixed.
    const measureMaxScroll = () => Math.max(0, content.offsetWidth - viewport.clientWidth)
    let maxScroll = measureMaxScroll()
    let motion: MaterialScrollMotion = {
      position: viewport.scrollLeft,
      target: viewport.scrollLeft,
      velocity: 0
    }
    let frame = 0
    let lastFrameAt = 0
    let lastWheelAt = 0
    let fadedLeft: boolean | undefined
    let fadedRight: boolean | undefined
    const updateEdgeFade = (position = viewport.scrollLeft) => {
      const left = position > 1
      const right = position < maxScroll - 1
      if (left !== fadedLeft) {
        viewport.toggleAttribute('data-fade-left', left)
        fadedLeft = left
      }
      if (right !== fadedRight) {
        viewport.toggleAttribute('data-fade-right', right)
        fadedRight = right
      }
    }
    const renderMotion = () => {
      const position = Math.max(0, Math.min(maxScroll, motion.position))
      const pull = position - motion.position
      viewport.scrollLeft = position
      content.style.transform = pull ? `translate3d(${pull}px, 0, 0)` : ''
      updateEdgeFade(motion.position)
    }
    const stopMotion = () => {
      window.cancelAnimationFrame(frame)
      frame = 0
      lastFrameAt = 0
      motion = { position: viewport.scrollLeft, target: viewport.scrollLeft, velocity: 0 }
      content.style.removeProperty('transform')
      updateEdgeFade()
    }
    const animate = (now: number) => {
      motion = stepMaterialScroll(
        motion,
        maxScroll,
        (now - lastFrameAt) / 1000,
        now - lastWheelAt > 110
      )
      lastFrameAt = now
      renderMotion()
      const pulled = motion.target < 0 || motion.target > maxScroll
      if (!materialScrollSettled(motion) || pulled) frame = window.requestAnimationFrame(animate)
      else {
        frame = 0
        lastFrameAt = 0
      }
    }
    const updateEdges = () => updateEdgeFade(frame ? motion.position : viewport.scrollLeft)
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      if (event.target instanceof Element && event.target.closest('.react-material-browser')) return
      maxScroll = measureMaxScroll()
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1
      if (!delta) return
      event.preventDefault()
      event.stopPropagation()
      setContextKey(undefined)
      if (reducedMotion.matches) {
        stopMotion()
        viewport.scrollLeft = Math.max(0, Math.min(maxScroll, viewport.scrollLeft + delta * scale))
        updateEdges()
        return
      }
      if (!frame)
        motion = { position: viewport.scrollLeft, target: viewport.scrollLeft, velocity: 0 }
      motion.target = materialScrollTarget(motion.target, delta * scale, maxScroll)
      lastWheelAt = performance.now()
      if (!frame) {
        lastFrameAt = lastWheelAt
        frame = window.requestAnimationFrame(animate)
      }
    }
    const observer = new ResizeObserver(() => {
      maxScroll = measureMaxScroll()
      stopMotion()
      updateEdges()
    })
    observer.observe(viewport)
    observer.observe(content)
    viewport.addEventListener('scroll', updateEdges, { passive: true })
    surface.addEventListener('wheel', onWheel, { passive: false })
    surface.addEventListener('pointerdown', stopMotion, { passive: true })
    surface.addEventListener('dragstart', stopMotion)
    viewport.addEventListener('keydown', stopMotion)
    reducedMotion.addEventListener('change', stopMotion)
    updateEdges()
    return () => {
      stopMotion()
      observer.disconnect()
      viewport.removeEventListener('scroll', updateEdges)
      surface.removeEventListener('wheel', onWheel)
      surface.removeEventListener('pointerdown', stopMotion)
      surface.removeEventListener('dragstart', stopMotion)
      viewport.removeEventListener('keydown', stopMotion)
      reducedMotion.removeEventListener('change', stopMotion)
      viewport.removeAttribute('data-fade-left')
      viewport.removeAttribute('data-fade-right')
    }
  }, [])
  const used = useMemo(() => new Set(usedPaths), [usedPaths])
  const ordered = useMemo(
    () =>
      orderEditorMaterials(
        items.filter(
          (asset) =>
            !asset.path.startsWith('workspace-artifact:') || !deletedIds.has(asset.path.slice(19))
        ),
        assetInfo,
        referenceFirstPath
      ),
    [items, assetInfo, deletedIds, referenceFirstPath]
  )
  const scoped = useMemo(
    () => (activeScope === 'all' ? ordered : ordered.filter((item) => used.has(item.path))),
    [ordered, activeScope, used]
  )
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return scoped.filter((item) => {
      const created = isCreated(item, assetInfo)
      return (
        (kind === 'all' || kind === item.kind) &&
        (source === 'all' || (source === 'created' ? created : !created)) &&
        (!search || item.name.toLocaleLowerCase().includes(search))
      )
    })
  }, [scoped, kind, source, query, assetInfo])

  function activate(asset: WorkspaceAsset) {
    setExpanded(false)
    if (onPreview) onPreview(asset)
    else setPreview(asset)
  }

  function materialAction(asset: WorkspaceAsset, key: string) {
    if (key !== 'delete-artifact') {
      onAction?.(asset, key)
      return
    }
    const file = assetInfo[asset.path]
    if (readonly || deleting || !file?.workspace_artifact_id || file.workspace_input_owner) return
    setContextKey(undefined)
    setDeleteError('')
    setDeletion({
      asset,
      id: file.workspace_artifact_id,
      used: used.has(asset.path) || !!roles[asset.path] || activePath === asset.path
    })
  }

  async function deleteArtifact() {
    if (!deletion || deleting || readonly) return
    setDeleting(true)
    setDeleteError('')
    try {
      await apiFetch(`/workspace_artifacts/${encodeURIComponent(deletion.id)}`, {
        method: 'DELETE'
      })
      notifyArtifactDeleted(deletion.id)
      setDeletion(undefined)
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : '产物删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  function card(asset: WorkspaceAsset, grid: boolean) {
    const file = assetInfo[asset.path]
    const created = isCreated(asset, assetInfo)
    const role = roles[asset.path]
    const usedLabel = role || '已使用'
    const roleLabel = role?.replace(/^参考图\s*(\d+)$/, '参$1').replace(/^主图$/, '主')
    const menuKey = `${grid ? 'grid' : 'strip'}:${asset.path}`
    const customActions = actions?.(asset) || []
    const menuActions = mergeArtifactActions(
      customActions.some((action) => action.key === 'preview')
        ? customActions
        : [{ key: 'preview', label: '预览文件' }, ...customActions],
      file,
      readonly || deleting
    )
    const Icon = asset.kind === 'image' ? IconPhoto : asset.kind === 'video' ? IconVideo : IconMusic
    return (
      <Menu
        key={asset.path}
        opened={contextKey === menuKey}
        onChange={(opened) =>
          setContextKey((current) => (opened ? menuKey : current === menuKey ? undefined : current))
        }
        width={180}
        position="bottom-start"
        offset={4}
        withinPortal
        portalProps={{ target: portalTarget }}
        floatingStrategy="fixed"
        zIndex={1001}
      >
        <Menu.ContextMenu disabled={!menuActions.length}>
          <span className="react-material-target">
            <HoverCard
              width={264}
              position="top"
              offset={10}
              openDelay={280}
              closeDelay={80}
              withinPortal
              portalProps={{ target: portalTarget }}
              floatingStrategy="fixed"
              withRoles={false}
              zIndex={200}
              classNames={{ dropdown: 'react-material-hover' }}
              disabled={!!contextKey}
            >
              <HoverCard.Target>
                <button
                  type="button"
                  className={`react-material-card${grid ? ' is-grid' : ''}`}
                  aria-label={`查看${asset.name}`}
                  aria-pressed={activePath === asset.path}
                  draggable={!!onDragStart && !readonly}
                  onDragStart={(event) => onDragStart?.(asset, event)}
                  onClick={() => activate(asset)}
                >
                  <span className="react-material-thumb">
                    {asset.kind === 'audio' ? (
                      <Icon size={28} stroke={1.5} />
                    ) : (
                      <img src={previewUrl(asset, file)} alt="" loading="lazy" />
                    )}
                    <span className="react-material-type">{kindLabel[asset.kind]}</span>
                    {(role || used.has(asset.path)) && (
                      <span className="react-material-used" aria-label={usedLabel}>
                        {roleLabel || <IconCheck size={12} stroke={2.5} />}
                      </span>
                    )}
                    {created && <span className="react-material-product">产物</span>}
                  </span>
                  {grid && <span className="react-material-name">{asset.name}</span>}
                </button>
              </HoverCard.Target>
              <HoverCard.Dropdown>
                <div className="react-material-hover-art">
                  {asset.kind === 'audio' ? (
                    <IconMusic size={56} stroke={1.25} />
                  ) : (
                    <img src={previewUrl(asset, file, 320)} alt={asset.name} />
                  )}
                </div>
                <Text size="sm" fw={600} className="react-material-hover-name">
                  {asset.name}
                </Text>
                <Group gap={6} mt={6}>
                  <Badge size="xs" variant="light" color="gray">
                    {kindLabel[asset.kind]}
                  </Badge>
                  {created && (
                    <Badge size="xs" color="product" variant="light">
                      产物
                    </Badge>
                  )}
                  {(role || used.has(asset.path)) && (
                    <Badge size="xs" variant="light">
                      {usedLabel}
                    </Badge>
                  )}
                  {file?.size && (
                    <Text size="xs" c="dimmed">
                      {file.size}
                    </Text>
                  )}
                </Group>
              </HoverCard.Dropdown>
            </HoverCard>
          </span>
        </Menu.ContextMenu>
        <Menu.Dropdown className="react-material-context-menu">
          {menuActions.map((action) => (
            <Menu.Item
              key={action.key}
              disabled={action.disabled}
              color={action.danger ? 'red' : undefined}
              onClick={() =>
                action.key === 'preview' ? activate(asset) : materialAction(asset, action.key)
              }
            >
              {action.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    )
  }

  return (
    <>
      <Popover
        opened={expanded}
        onChange={setExpanded}
        closeOnClickOutside={false}
        withRoles={false}
        width="target"
        position={placement === 'below' ? 'bottom-start' : 'top-start'}
        offset={7}
        middlewares={{ flip: true, shift: { padding: 8 }, size: { padding: 8 } }}
        withinPortal
        portalProps={{ target: portalTarget }}
        floatingStrategy="fixed"
        preventPositionChangeWhenVisible={false}
        transitionProps={{ duration: 0 }}
        zIndex={180}
      >
        <Popover.Target>
          <div
            ref={bar}
            className={`react-material-bar${embedded ? ' is-embedded' : ''} ${className}`}
            data-placement={placement}
            style={style}
          >
            <div className="react-material-strip" aria-label="当前工作区素材">
              <div className="react-material-list" ref={strip}>
                <div
                  className={`react-material-track${scoped.length ? '' : ' is-empty'}`}
                  ref={track}
                >
                  {scoped.length ? (
                    scoped.map((asset, index) => (
                      <span className="react-material-strip-item" key={asset.path}>
                        {index > 0 &&
                          isCreated(scoped[index - 1], assetInfo) &&
                          !isCreated(asset, assetInfo) && (
                            <span className="react-material-divider" aria-hidden="true" />
                          )}
                        {card(asset, false)}
                      </span>
                    ))
                  ) : (
                    <Text size="xs" c="dimmed" className="react-material-empty">
                      {activeScope === 'used' ? '当前制作文件尚未使用素材' : '暂无可用素材'}
                    </Text>
                  )}
                </div>
              </div>
            </div>
            <div className="react-material-actions">
              <Tooltip label="展开素材列表">
                <ActionIcon
                  variant={expanded ? 'light' : 'subtle'}
                  aria-label="展开素材列表"
                  aria-expanded={expanded}
                  onClick={() => setExpanded((value) => !value)}
                >
                  <IconGridDots size={18} />
                </ActionIcon>
              </Tooltip>
              {onAdd && (
                <Tooltip label="从媒体库加入素材">
                  <ActionIcon
                    variant="subtle"
                    aria-label="从媒体库加入素材"
                    disabled={readonly}
                    onClick={onAdd}
                  >
                    <IconPlus size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
            </div>
            {scope === undefined && (
              <SegmentedControl
                className="react-material-scope"
                orientation="vertical"
                size="xs"
                aria-label="素材范围"
                value={activeScope}
                onChange={(value) => {
                  setLocalScope(value === 'used' ? 'used' : 'all')
                  setContextKey(undefined)
                  strip.current?.scrollTo({ left: 0 })
                }}
                data={[
                  { value: 'all', label: '全部' },
                  { value: 'used', label: '已使用' }
                ]}
              />
            )}
          </div>
        </Popover.Target>
        <Popover.Dropdown
          className="react-material-browser"
          role="region"
          aria-label="浏览工作区素材"
        >
          <Group justify="space-between" mb="sm">
            <Group gap="xs">
              <Text fw={700} size="sm">
                {activeScope === 'used' ? '已使用素材' : '全部素材'}
              </Text>
              <Badge size="sm" variant="light">
                {scoped.length}
              </Badge>
            </Group>
            <ActionIcon
              variant="subtle"
              aria-label="关闭素材浏览"
              onClick={() => setExpanded(false)}
            >
              <IconX size={16} />
            </ActionIcon>
          </Group>
          <TextInput
            size="xs"
            aria-label="搜索工作区素材"
            placeholder="搜索工作区素材"
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <div className="react-material-filters">
            <div className="react-material-filter-group">
              <span className="react-material-filter-label">类型</span>
              <Tabs
                className="react-material-filter-tabs"
                value={kind}
                onChange={(value) => value && setKind(value as typeof kind)}
              >
                <Tabs.List aria-label="素材类型">
                  <Tabs.Tab value="all">全部</Tabs.Tab>
                  <Tabs.Tab value="image">图片</Tabs.Tab>
                  <Tabs.Tab value="video">视频</Tabs.Tab>
                  <Tabs.Tab value="audio">音频</Tabs.Tab>
                </Tabs.List>
              </Tabs>
            </div>
            <div className="react-material-filter-group">
              <span className="react-material-filter-label">来源</span>
              <Tabs
                className="react-material-filter-tabs"
                value={source}
                onChange={(value) => value && setSource(value as typeof source)}
              >
                <Tabs.List aria-label="素材来源">
                  <Tabs.Tab value="all">全部</Tabs.Tab>
                  <Tabs.Tab value="referenced">引用</Tabs.Tab>
                  <Tabs.Tab value="created">产物</Tabs.Tab>
                </Tabs.List>
              </Tabs>
            </div>
          </div>
          <div className="react-material-grid">
            {filtered.map((asset) => card(asset, true))}
            {!filtered.length && (
              <Text size="sm" c="dimmed">
                没有匹配的素材
              </Text>
            )}
          </div>
        </Popover.Dropdown>
      </Popover>
      <Modal
        opened={!!deletion}
        onClose={() => !deleting && setDeletion(undefined)}
        title={`删除产物“${deletion?.asset.name || ''}”？`}
        centered
        size="sm"
        closeOnEscape={!deleting}
        closeOnClickOutside={!deleting}
        withCloseButton={!deleting}
      >
        <Text size="sm">
          产物文件会永久删除，并从工作区素材和成果中移除。已同步到媒体库的副本保留；其他制作文件的素材引用可能不可用。
        </Text>
        {deletion?.used && (
          <Alert color="orange" mt="sm">
            当前制作文件正在使用此产物。删除后，对应画面或声音将不可用，图层和时间线片段会保留。
          </Alert>
        )}
        {deleteError && (
          <Alert color="red" mt="sm">
            {deleteError}
          </Alert>
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="default" disabled={deleting} onClick={() => setDeletion(undefined)}>
            取消
          </Button>
          <Button
            color="red"
            loading={deleting}
            disabled={readonly}
            onClick={() => void deleteArtifact()}
          >
            删除产物
          </Button>
        </Group>
      </Modal>
      <Modal
        opened={!!preview}
        onClose={() => setPreview(undefined)}
        title={preview?.name}
        centered
        size="lg"
      >
        {preview?.kind === 'image' && (
          <img
            className="react-material-preview"
            src={mediaUrl(preview, assetInfo[preview.path])}
            alt={preview.name}
          />
        )}
        {preview?.kind === 'video' && (
          <video
            className="react-material-preview"
            src={mediaUrl(preview, assetInfo[preview.path])}
            controls
          />
        )}
        {preview?.kind === 'audio' && (
          <audio
            className="react-material-audio"
            src={mediaUrl(preview, assetInfo[preview.path])}
            controls
          />
        )}
      </Modal>
    </>
  )
}
