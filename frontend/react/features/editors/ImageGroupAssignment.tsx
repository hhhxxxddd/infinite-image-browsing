import { Menu } from '@mantine/core'
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconFolder,
  IconFolderPlus,
  IconLock
} from '@tabler/icons-react'
import type {
  StudioGroup,
  StudioLayer
} from '../../../src/features/image-editor/model/imageStudioModel'

/** The same membership control serves every layer type and multi-selection. */
export default function ImageGroupAssignment({
  groups,
  layers,
  disabled,
  contextMenu = false,
  onMove,
  onCreate
}: {
  groups: StudioGroup[]
  layers: StudioLayer[]
  disabled: boolean
  contextMenu?: boolean
  onMove: (groupId?: string) => void
  onCreate: () => void
}) {
  const groupId = layers[0]?.groupId
  const mixed = layers.some((layer) => layer.groupId !== groupId)
  const group = groups.find((item) => item.id === groupId)
  const label = mixed ? '多个分组' : group?.name || '未分组'
  const hasGroup = layers.some((layer) => layer.groupId)
  return (
    <Menu
      position={contextMenu ? 'left-start' : 'bottom-end'}
      offset={6}
      width={220}
      withinPortal
      portalProps={{ target: '.react-editor-shell' }}
      zIndex={85}
      returnFocus={!contextMenu}
      transitionProps={{ duration: 0 }}
    >
      <Menu.Target>
        <button
          type="button"
          role={contextMenu ? 'menuitem' : undefined}
          className={contextMenu ? 'react-image-group-menu-target' : 'react-image-group-tag'}
          aria-label={contextMenu ? '移入分组' : '更改分组归属'}
          title={`分组归属：${label}${layers.length > 1 ? ` · ${layers.length} 个图层` : ''}`}
          disabled={disabled}
        >
          {!contextMenu && <IconFolder size={13} />}
          <span>{contextMenu ? '移入分组' : label}</span>
          {contextMenu ? <IconChevronRight size={13} /> : <IconChevronDown size={12} />}
        </button>
      </Menu.Target>
      <Menu.Dropdown
        className="react-image-tool-popover react-image-group-dropdown"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Menu.Label>分组归属{layers.length > 1 ? ` · ${layers.length} 个图层` : ''}</Menu.Label>
        {!contextMenu && (
          <Menu.Item
            disabled={!hasGroup}
            rightSection={!hasGroup ? <IconCheck size={14} /> : undefined}
            onClick={() => onMove()}
          >
            {hasGroup ? '移出分组' : '未分组'}
          </Menu.Item>
        )}
        <div className="react-image-group-options">
          {groups.map((item) => (
            <Menu.Item
              key={item.id}
              disabled={item.locked || (!mixed && groupId === item.id)}
              leftSection={<IconFolder size={14} />}
              rightSection={
                item.locked ? (
                  <IconLock size={13} />
                ) : !mixed && groupId === item.id ? (
                  <IconCheck size={14} />
                ) : undefined
              }
              title={item.locked ? `${item.name}（已锁定）` : item.name}
              onClick={() => onMove(item.id)}
            >
              <span className="react-image-group-option-name">{item.name}</span>
            </Menu.Item>
          ))}
          {!groups.length && <Menu.Label>暂无分组</Menu.Label>}
        </div>
        <Menu.Divider />
        <Menu.Item leftSection={<IconFolderPlus size={14} />} onClick={onCreate}>
          新建分组并移入
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )
}
