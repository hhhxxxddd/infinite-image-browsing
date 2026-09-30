import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  SegmentedControl,
  Select,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import {
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

function previewUrl(asset: WorkspaceAsset, file?: FileNodeInfo) {
  if (asset.kind === 'audio') return ''
  if (file?.edit_snapshot) {
    const value = file.edit_snapshot
    return apiUrl(
      `/image_edit_asset?path=${encodeURIComponent(value.owner)}&revision=${encodeURIComponent(value.revision)}&asset=${encodeURIComponent(value.asset)}`
    )
  }
  if (file?.workspace_artifact_id)
    return apiUrl(
      `/workspace_artifacts/${encodeURIComponent(file.workspace_artifact_id)}/thumbnail?size=256`
    )
  if (asset.kind === 'video')
    return apiUrl(
      `/video_cover?path=${encodeURIComponent(asset.path)}&mt=${encodeURIComponent(file?.date || '')}`
    )
  return apiUrl(
    `/image-thumbnail?path=${encodeURIComponent(asset.path)}&size=160x160&t=${encodeURIComponent(file?.date || '0')}`
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
  const strip = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | WorkspaceAsset['kind']>('all')
  const [source, setSource] = useState<'all' | 'created' | 'referenced'>('all')
  const [preview, setPreview] = useState<WorkspaceAsset>()
  const [menu, setMenu] = useState<{ asset: WorkspaceAsset; x: number; y: number }>()
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(undefined)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [menu])
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
  const scoped = ordered.filter((item) => scope === 'all' || used.has(item.path))
  const filtered = scoped.filter((item) => {
    const created = isCreated(item, assetInfo)
    return (
      (kind === 'all' || kind === item.kind) &&
      (source === 'all' || (source === 'created' ? created : !created)) &&
      (!query.trim() || item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    )
  })

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

  function card(asset: WorkspaceAsset, grid: boolean) {
    const file = assetInfo[asset.path]
    const created = isCreated(asset, assetInfo)
    const Icon = asset.kind === 'image' ? IconPhoto : asset.kind === 'video' ? IconVideo : IconMusic
    return (
      <button
        key={asset.path}
        type="button"
        className={`react-material-card${grid ? ' is-grid' : ''}`}
        aria-label={`${clickMode === 'view' ? '查看' : clickMode === 'replace' ? '替换为' : '选择'}${asset.name}`}
        aria-pressed={activePath === asset.path}
        title={asset.name}
        draggable={!!onDragStart && !readonly}
        onDragStart={(event) => onDragStart?.(asset, event)}
        onClick={() => activate(asset)}
        onContextMenu={(event) => {
          if (!actions?.(asset).length) return
          event.preventDefault()
          setMenu({ asset, x: event.clientX, y: event.clientY })
        }}
      >
        <span className="react-material-thumb">
          {asset.kind === 'audio' ? (
            <Icon size={28} stroke={1.5} />
          ) : (
            <img src={previewUrl(asset, file)} alt="" loading="lazy" />
          )}
          <span className="react-material-type">{kindLabel[asset.kind]}</span>
          {(roles[asset.path] || used.has(asset.path) || activePath === asset.path) && (
            <span className="react-material-used" aria-label={roles[asset.path] || '已使用'}>
              {roles[asset.path] || '已使用'}
            </span>
          )}
          {created && <span className="react-material-product">产物</span>}
        </span>
        {grid && <span className="react-material-name">{asset.name}</span>}
      </button>
    )
  }

  return (
    <div
      className={`react-material-bar${embedded ? ' is-embedded' : ''} ${className}`}
      data-placement={placement}
      style={style}
    >
      <div className="react-material-strip" aria-label="当前工作区素材">
        <Tooltip label="向左滚动素材">
          <ActionIcon
            variant="subtle"
            aria-label="向左滚动素材"
            onClick={() => strip.current?.scrollBy({ left: -360, behavior: 'smooth' })}
          >
            <IconChevronLeft size={18} />
          </ActionIcon>
        </Tooltip>
        <div className="react-material-list" ref={strip}>
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
        <Tooltip label="向右滚动素材">
          <ActionIcon
            variant="subtle"
            aria-label="向右滚动素材"
            onClick={() => strip.current?.scrollBy({ left: 360, behavior: 'smooth' })}
          >
            <IconChevronRight size={18} />
          </ActionIcon>
        </Tooltip>
      </div>
      <div className="react-material-actions">
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
      {expanded && (
        <section className="react-material-browser" aria-label="浏览工作区素材">
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
          <Group gap="xs" my="sm" wrap="nowrap">
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
              w={138}
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
              w={124}
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
        </section>
      )}
      {menu && (
        <div
          className="react-material-context-menu"
          style={{
            left: Math.min(menu.x, window.innerWidth - 210),
            top: Math.min(menu.y, window.innerHeight - 210)
          }}
          role="menu"
        >
          {actions?.(menu.asset).map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              data-danger={action.danger}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                onAction?.(menu.asset, action.key)
                setMenu(undefined)
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
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
    </div>
  )
}
