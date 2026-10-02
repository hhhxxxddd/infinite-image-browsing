import { useEffect, useRef, type DragEvent } from 'react'
import { ActionIcon, Button, Menu, Switch, Text, Tooltip } from '@mantine/core'
import { IconArrowLeft, IconCopy, IconDots, IconFolderPlus } from '@tabler/icons-react'
import { FolderIcon } from './FolderIconPicker'
import { useMediaText } from './mediaLocale'

interface FolderEntry {
  path: string
  name: string
}

interface FolderNavigationProps {
  path: string
  breadcrumbs: FolderEntry[]
  subfolders: { fullpath: string; name: string }[]
  icons: Record<string, string>
  recursive: boolean
  readCount: number
  pendingDirectories: number
  readOnly: boolean
  flattenBusy: boolean
  menuPath: string | null
  onMenuPath: (path: string | null) => void
  onOpen: (path: string) => void
  onDropFiles: (event: DragEvent, path: string) => void
  onToggleRecursive: () => void
  onCreate: () => void
  onViewOptions: () => void
  onCopyLink?: () => void
  onFlatten: () => void
  onBrowseAll: (path: string) => void
  onCopyPath: (path: string) => void
  onDeleteEmpty: (path: string) => void
}

export function FolderNavigation({
  path,
  breadcrumbs,
  subfolders,
  icons,
  recursive,
  readCount,
  pendingDirectories,
  readOnly,
  flattenBusy,
  menuPath,
  onMenuPath,
  onOpen,
  onDropFiles,
  onToggleRecursive,
  onCreate,
  onViewOptions,
  onCopyLink,
  onFlatten,
  onBrowseAll,
  onCopyPath,
  onDeleteEmpty
}: FolderNavigationProps) {
  const m = useMediaText()
  const scrollRef = useRef<HTMLDivElement>(null)
  const hiddenParents = breadcrumbs.length > 3 ? breadcrumbs.slice(1, -2) : []
  const visibleCrumbs: (FolderEntry | null)[] = hiddenParents.length
    ? [breadcrumbs[0], null, ...breadcrumbs.slice(-2)]
    : breadcrumbs
  const progressText =
    pendingDirectories > 0
      ? m('已读 {count} 项 · 待读 {pending} 个目录', {
          count: readCount,
          pending: pendingDirectories
        })
      : m('已读 {count} 项', { count: readCount })

  useEffect(() => {
    const host = scrollRef.current
    if (!host) return
    const onWheel = (event: WheelEvent) => {
      if (
        event.ctrlKey ||
        event.shiftKey ||
        event.deltaX ||
        !event.deltaY ||
        host.scrollWidth <= host.clientWidth
      )
        return
      const unit = event.deltaMode === 1 ? 28 : event.deltaMode === 2 ? host.clientWidth : 1
      event.preventDefault()
      host.scrollLeft += event.deltaY * unit
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
  }, [subfolders.length])

  const allowFolderDrop = (event: DragEvent) => {
    if (event.dataTransfer.types.includes('application/x-omnigallery-files')) event.preventDefault()
  }

  return (
    <div className="ml-folder-navigation">
      <nav className="ml-breadcrumbs" aria-label={m('文件夹位置')}>
        <div className="ml-breadcrumb-location">
          <Tooltip label={m('上一级')}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size={28}
              aria-label={m('上一级')}
              onClick={() => onOpen(breadcrumbs.at(-2)?.path || '')}
            >
              <IconArrowLeft size={17} />
            </ActionIcon>
          </Tooltip>
          <FolderIcon value={icons[path]} size={17} />
          <div className="ml-breadcrumb-trail" title={path}>
            {visibleCrumbs.map((crumb, index) => (
              <span className="ml-breadcrumb-part" key={crumb?.path || 'hidden-parents'}>
                {crumb ? (
                  <button
                    type="button"
                    title={crumb.path}
                    onClick={() => onOpen(crumb.path)}
                    onDragOver={allowFolderDrop}
                    onDrop={(event) => onDropFiles(event, crumb.path)}
                    aria-current={index === visibleCrumbs.length - 1 ? 'location' : undefined}
                  >
                    {crumb.name}
                  </button>
                ) : (
                  <Menu withinPortal position="bottom-start">
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        size={24}
                        aria-label={m('其他上级目录')}
                      >
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown className="ml-breadcrumb-parents">
                      {hiddenParents.map((parent) => (
                        <Menu.Item
                          key={parent.path}
                          title={parent.path}
                          onClick={() => onOpen(parent.path)}
                          leftSection={<FolderIcon value={icons[parent.path]} size={15} />}
                        >
                          {parent.name}
                        </Menu.Item>
                      ))}
                    </Menu.Dropdown>
                  </Menu>
                )}
                {index < visibleCrumbs.length - 1 && (
                  <span className="ml-crumb-separator" aria-hidden="true">
                    /
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
        <div className="ml-folder-actions">
          {recursive && (
            <Tooltip
              label={`${progressText} · ${m('逐级读取子目录，包含尚未扫描的媒体文件。')}`}
              multiline
              w={280}
            >
              <Text
                component="span"
                className="ml-folder-progress"
                size="xs"
                c="dimmed"
                role="status"
                aria-atomic="true"
              >
                {progressText}
              </Text>
            </Tooltip>
          )}
          <Switch
            className="ml-folder-scope"
            size="xs"
            label={m('包含子目录')}
            checked={recursive}
            onChange={onToggleRecursive}
          />
          <Tooltip label={m('新建子文件夹')}>
            <ActionIcon
              size={28}
              variant="subtle"
              color="gray"
              aria-label={m('新建子文件夹')}
              disabled={readOnly}
              onClick={onCreate}
            >
              <IconFolderPlus size={17} />
            </ActionIcon>
          </Tooltip>
          <Menu withinPortal position="bottom-end">
            <Menu.Target>
              <ActionIcon size={28} variant="subtle" color="gray" aria-label={m('文件夹操作')}>
                <IconDots size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={onViewOptions}>{m('查看选项')}</Menu.Item>
              {onCopyLink && (
                <Menu.Item leftSection={<IconCopy size={15} />} onClick={onCopyLink}>
                  {m('复制目录链接')}
                </Menu.Item>
              )}
              <Menu.Divider />
              <Menu.Item color="red" disabled={readOnly || flattenBusy} onClick={onFlatten}>
                {m('压平文件夹')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </nav>
      {subfolders.length > 0 && (
        <div className="ml-subfolder-strip" aria-label={m('子文件夹')}>
          <Text className="ml-subfolder-label" size="xs" c="dimmed">
            {m('子文件夹')}
          </Text>
          <div ref={scrollRef} className="ml-subfolder-scroll">
            {subfolders.map((folder) => (
              <div
                className="ml-subfolder-chip"
                key={folder.fullpath}
                onDragOver={allowFolderDrop}
                onDrop={(event) => onDropFiles(event, folder.fullpath)}
              >
                <Menu
                  withinPortal
                  opened={menuPath === folder.fullpath}
                  onChange={(open) => {
                    if (open) onMenuPath(folder.fullpath)
                    else if (menuPath === folder.fullpath) onMenuPath(null)
                  }}
                  position="bottom-start"
                >
                  <Menu.ContextMenu>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="gray"
                      title={folder.name}
                      leftSection={<FolderIcon value={icons[folder.fullpath]} size={15} />}
                      onClick={() => onOpen(folder.fullpath)}
                    >
                      {folder.name}
                    </Button>
                  </Menu.ContextMenu>
                  <Menu.Dropdown>
                    <Menu.Item onClick={() => onOpen(folder.fullpath)}>{m('进入目录')}</Menu.Item>
                    <Menu.Item onClick={() => onBrowseAll(folder.fullpath)}>
                      {m('查看全部内容')}
                    </Menu.Item>
                    <Menu.Item onClick={() => onCopyPath(folder.fullpath)}>
                      {m('复制路径')}
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      disabled={readOnly}
                      onClick={() => onDeleteEmpty(folder.fullpath)}
                    >
                      {m('删除空文件夹')}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
