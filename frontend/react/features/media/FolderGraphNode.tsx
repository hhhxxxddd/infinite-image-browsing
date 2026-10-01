import { useState } from 'react'
import { ActionIcon, Menu, Text } from '@mantine/core'
import { IconChevronRight, IconDots } from '@tabler/icons-react'
import type { MediaFile } from './mediaApi'
import { FolderIcon } from './FolderIconPicker'
import { useMediaText } from './mediaLocale'

export type FolderAction =
  'walk' | 'icon' | 'new' | 'rename' | 'move' | 'copy' | 'refresh' | 'alias' | 'remove' | 'delete'

export interface FolderGraphNodeProps {
  path: string
  name: string
  root?: boolean
  depth?: number
  query: string
  focusedPath: string
  movingPath: string
  readonly: boolean
  icons: Record<string, string>
  expandedPaths: Set<string>
  children: Record<string, MediaFile[]>
  loadingPath: string
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onMove: (source: string, destination: string) => void
  onDropFiles: (paths: string[], destination: string, copy: boolean) => void
  onAction: (action: FolderAction, path: string) => void
}

export function FolderGraphNode(props: FolderGraphNodeProps) {
  const m = useMediaText()
  const [menuOpen, setMenuOpen] = useState(false)
  const [dropTarget, setDropTarget] = useState(false)
  const {
    path,
    name,
    root = false,
    depth = 0,
    query,
    focusedPath,
    movingPath,
    readonly,
    icons,
    expandedPaths,
    children,
    loadingPath,
    onToggle,
    onOpen,
    onMove,
    onDropFiles,
    onAction
  } = props
  const expanded = expandedPaths.has(path)
  const loading = expanded && (children[path] === undefined || loadingPath === path)
  const childFolders = children[path] || []
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matched =
    !!normalizedQuery && `${name} ${path}`.toLocaleLowerCase().includes(normalizedQuery)
  const hasBranch = children[path] === undefined || childFolders.length > 0 || loadingPath === path
  const normalizedPath = (value: string) =>
    value.replace(/\\/g, '/').replace(/\/+$/, '').toLocaleLowerCase()
  const focused = normalizedPath(focusedPath) === normalizedPath(path)
  const sameMove = normalizedPath(movingPath) === normalizedPath(path)
  const icon =
    icons[path] ||
    Object.entries(icons).find(([key]) => normalizedPath(key) === normalizedPath(path))?.[1]

  return (
    <div className="ml-graph-branch">
      <article
        className={`ml-graph-node${matched ? ' ml-graph-match' : ''}${normalizedQuery && !matched ? ' ml-graph-muted' : ''}${focused ? ' ml-graph-focused' : ''}${sameMove ? ' ml-graph-moving' : ''}${dropTarget ? ' ml-graph-drop' : ''}`}
        title={path}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
        draggable={!root && !readonly}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-omnigallery-folder-node', path)
          event.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(event) => {
          if (
            readonly ||
            !event.dataTransfer.types.some((type) =>
              ['application/x-omnigallery-folder-node', 'application/x-omnigallery-files'].includes(
                type
              )
            )
          )
            return
          event.preventDefault()
          setDropTarget(true)
        }}
        onDragLeave={() => setDropTarget(false)}
        onDrop={(event) => {
          setDropTarget(false)
          const source = event.dataTransfer.getData('application/x-omnigallery-folder-node')
          const files = event.dataTransfer.getData('application/x-omnigallery-files')
          if (readonly || (!source && !files)) return
          event.preventDefault()
          event.stopPropagation()
          if (source) onMove(source, path)
          else {
            try {
              const paths = JSON.parse(files) as unknown
              if (Array.isArray(paths) && paths.every((item) => typeof item === 'string'))
                onDropFiles(paths, path, event.ctrlKey || event.metaKey)
            } catch {
              /* Ignore drag data from another application. */
            }
          }
        }}
      >
        <button
          className="ml-graph-open"
          type="button"
          aria-label={movingPath ? m('移动到：{name}', { name }) : m('浏览：{name}', { name })}
          onClick={() =>
            movingPath ? (sameMove ? onAction('move', '') : onMove(movingPath, path)) : onOpen(path)
          }
        >
          <span className="ml-graph-icon">
            <FolderIcon value={icon} />
          </span>
          <strong title={name}>{name}</strong>
          <small>{root ? m('已添加') : m('子目录')}</small>
        </button>
        <Menu
          withinPortal
          opened={menuOpen}
          onChange={setMenuOpen}
          position="bottom-start"
          shadow="md"
        >
          <Menu.Target>
            <ActionIcon
              className="ml-graph-more"
              variant="subtle"
              color="gray"
              size="sm"
              aria-label={m('目录操作：{name}', { name })}
            >
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => onAction('walk', path)}>{m('查看全部内容')}</Menu.Item>
            <Menu.Divider />
            <Menu.Item disabled={readonly} onClick={() => onAction('icon', path)}>
              {m('修改图标')}
            </Menu.Item>
            <Menu.Item disabled={readonly} onClick={() => onAction('new', path)}>
              {m('新建子文件夹')}
            </Menu.Item>
            {!root && (
              <Menu.Item disabled={readonly} onClick={() => onAction('rename', path)}>
                {m('改名')}
              </Menu.Item>
            )}
            {!root && (
              <Menu.Item disabled={readonly} onClick={() => onAction('move', path)}>
                {m('移动到其他节点')}
              </Menu.Item>
            )}
            <Menu.Item onClick={() => onAction('copy', path)}>{m('复制路径')}</Menu.Item>
            <Menu.Item onClick={() => onAction('refresh', path)}>{m('刷新下级目录')}</Menu.Item>
            <Menu.Divider />
            {root ? (
              <>
                <Menu.Item disabled={readonly} onClick={() => onAction('alias', path)}>
                  {m('修改显示名称')}
                </Menu.Item>
                <Menu.Item disabled={readonly} color="red" onClick={() => onAction('remove', path)}>
                  {m('从媒体库移除')}
                </Menu.Item>
              </>
            ) : (
              <Menu.Item disabled={readonly} color="red" onClick={() => onAction('delete', path)}>
                {m('删除空文件夹')}
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
        {hasBranch && (
          <button
            className={`ml-graph-reveal${expanded ? ' is-expanded' : ''}`}
            type="button"
            aria-expanded={expanded}
            aria-label={m(expanded ? '折叠 {name}' : '展开 {name}', { name })}
            onClick={() => onToggle(path)}
          >
            <IconChevronRight size={14} />
          </button>
        )}
      </article>
      {expanded && (loading || childFolders.length > 0) && (
        <div
          className="ml-graph-children"
          role="group"
          aria-label={m('{name} 的下级目录', { name })}
        >
          {loading ? (
            <Text size="xs" c="dimmed" className="ml-graph-loading">
              {m('读取子目录…')}
            </Text>
          ) : (
            childFolders.map((child) => (
              <FolderGraphNode
                {...props}
                key={child.fullpath}
                path={child.fullpath}
                name={child.name}
                root={false}
                depth={depth + 1}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}
