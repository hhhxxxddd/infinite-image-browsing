import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  HoverCard,
  Menu,
  Modal,
  Popover,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconGridDots,
  IconMusic,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconVideo,
  IconX
} from '@tabler/icons-react'
import { apiUrl } from '../../shared/apiClient'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import './MaterialBar.css'

export type MaterialClickMode = 'view' | 'switch' | 'add' | 'replace'
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
  onSelect: (asset: WorkspaceAsset) => void
  onDragStart?: (asset: WorkspaceAsset, event: DragEvent<HTMLButtonElement>) => void
  onReplace?: (asset: WorkspaceAsset) => void
  onPreview?: (asset: WorkspaceAsset) => void
  onAdd?: () => void
  readonly?: boolean
  selectAction?: 'add' | 'switch'
  clickMode?: MaterialClickMode
  onClickModeChange?: (mode: MaterialClickMode) => void
  actions?: (asset: WorkspaceAsset) => MaterialAction[]
  onAction?: (asset: WorkspaceAsset, key: string) => void
  embedded?: boolean
  placement?: 'above' | 'below'
  scope?: 'all' | 'used'
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
  onSelect,
  onDragStart,
  onReplace,
  onPreview,
  onAdd,
  readonly = false,
  selectAction = 'switch',
  clickMode = 'switch',
  onClickModeChange,
  actions,
  onAction,
  embedded = false,
  placement = 'above',
  scope = 'all',
  className = '',
  style
}: MaterialBarProps) {
  const bar = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement>()
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false })
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | WorkspaceAsset['kind']>('all')
  const [source, setSource] = useState<'all' | 'created' | 'referenced'>('all')
  const [preview, setPreview] = useState<WorkspaceAsset>()
  const [contextKey, setContextKey] = useState<string>()
  useEffect(() => {
    const surface = bar.current
    const viewport = strip.current
    const content = track.current
    if (!surface || !viewport || !content) return
    setPortalTarget(viewport.closest<HTMLElement>('.react-editor-shell') || undefined)
    const updateEdges = () => {
      const left = viewport.scrollLeft > 1
      const right = viewport.scrollLeft < viewport.scrollWidth - viewport.clientWidth - 1
      setScrollEdges((current) =>
        current.left === left && current.right === right ? current : { left, right }
      )
    }
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return
      if (event.target instanceof Element && event.target.closest('.react-material-browser')) return
      const maxScroll = viewport.scrollWidth - viewport.clientWidth
      if (maxScroll <= 1) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1
      const next = Math.max(0, Math.min(maxScroll, viewport.scrollLeft + delta * scale))
      event.preventDefault()
      event.stopPropagation()
      setContextKey(undefined)
      viewport.scrollLeft = next
    }
    const observer = new ResizeObserver(updateEdges)
    observer.observe(viewport)
    observer.observe(content)
    viewport.addEventListener('scroll', updateEdges, { passive: true })
    surface.addEventListener('wheel', onWheel, { passive: false })
    updateEdges()
    return () => {
      observer.disconnect()
      viewport.removeEventListener('scroll', updateEdges)
      surface.removeEventListener('wheel', onWheel)
    }
  }, [])
  const used = useMemo(() => new Set(usedPaths), [usedPaths])
  const ordered = useMemo(
    () =>
      [...items].sort((a, b) => {
        const aCreated = Number(isCreated(a, assetInfo))
        const bCreated = Number(isCreated(b, assetInfo))
        return bCreated - aCreated
      }),
    [items, assetInfo]
  )
  const scoped = useMemo(
    () => (scope === 'all' ? ordered : ordered.filter((item) => used.has(item.path))),
    [ordered, scope, used]
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
    if (clickMode === 'view') {
      if (onPreview) onPreview(asset)
      else setPreview(asset)
    } else if (!readonly) {
      if (clickMode === 'replace') onReplace?.(asset)
      else onSelect(asset)
    }
  }

  function scrollMaterials(direction: number) {
    const viewport = strip.current
    if (!viewport) return
    viewport.scrollBy({
      left: direction * Math.max(144, viewport.clientWidth * 0.75),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    })
  }

  function card(asset: WorkspaceAsset, grid: boolean) {
    const file = assetInfo[asset.path]
    const created = isCreated(asset, assetInfo)
    const role = roles[asset.path]
    const usedLabel = role || '已使用'
    const roleLabel = role?.replace(/^参考图\s*(\d+)$/, '参$1').replace(/^主图$/, '主')
    const menuKey = `${grid ? 'grid' : 'strip'}:${asset.path}`
    const menuActions = actions?.(asset) || []
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
                  aria-label={`${clickMode === 'view' ? '查看' : clickMode === 'replace' ? '替换为' : '选择'}${asset.name}`}
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
                    {(role || used.has(asset.path) || activePath === asset.path) && (
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
                  {(role || used.has(asset.path) || activePath === asset.path) && (
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
              onClick={() => onAction?.(asset, action.key)}
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
                <div className="react-material-track" ref={track}>
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
                    <Text size="xs" c="dimmed">
                      {scope === 'used' ? '当前作品尚未使用素材' : '当前工作区暂无可用素材'}
                    </Text>
                  )}
                </div>
              </div>
            </div>
            <div className="react-material-actions">
              {(scrollEdges.left || scrollEdges.right) && (
                <>
                  <Tooltip label="向左滚动素材">
                    <ActionIcon
                      className="react-material-nav"
                      size={26}
                      variant="subtle"
                      aria-label="向左滚动素材"
                      disabled={!scrollEdges.left}
                      onClick={() => scrollMaterials(-1)}
                    >
                      <IconChevronLeft size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="向右滚动素材">
                    <ActionIcon
                      className="react-material-nav"
                      size={26}
                      variant="subtle"
                      aria-label="向右滚动素材"
                      disabled={!scrollEdges.right}
                      onClick={() => scrollMaterials(1)}
                    >
                      <IconChevronRight size={16} />
                    </ActionIcon>
                  </Tooltip>
                </>
              )}
              <Tooltip label="查看全部素材">
                <ActionIcon
                  variant={expanded ? 'light' : 'subtle'}
                  aria-label="查看全部素材"
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
            {onClickModeChange && (
              <SegmentedControl
                orientation="vertical"
                size="xs"
                aria-label="素材点击操作"
                value={clickMode}
                onChange={(value) => onClickModeChange(value as MaterialClickMode)}
                data={[
                  { value: 'view', label: '查看' },
                  ...(onReplace
                    ? [
                        { value: 'add', label: '添加' },
                        { value: 'replace', label: '替换', disabled: !activePath || readonly }
                      ]
                    : [{ value: selectAction, label: selectAction === 'add' ? '添加' : '切换' }])
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
                全部素材
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
          <Group gap="xs" my="sm" className="react-material-filters">
            <Select
              size="xs"
              aria-label="素材类型"
              data={[
                { value: 'all', label: '全部类型' },
                { value: 'image', label: '图片' },
                { value: 'video', label: '视频' },
                { value: 'audio', label: '音频' }
              ]}
              value={kind}
              onChange={(value) => setKind((value || 'all') as typeof kind)}
              allowDeselect={false}
            />
            <Select
              size="xs"
              aria-label="素材来源"
              data={[
                { value: 'all', label: '全部' },
                { value: 'referenced', label: '引用' },
                { value: 'created', label: '产物' }
              ]}
              value={source}
              onChange={(value) => setSource((value || 'all') as typeof source)}
              allowDeselect={false}
            />
          </Group>
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
        {preview && !readonly && (
          <Group justify="flex-end" mt="sm">
            <Button
              size="sm"
              onClick={() => {
                onSelect(preview)
                setPreview(undefined)
              }}
            >
              使用此素材
            </Button>
          </Group>
        )}
      </Modal>
    </>
  )
}
