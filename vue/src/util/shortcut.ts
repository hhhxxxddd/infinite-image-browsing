export const getShortcutStrFromEvent = (e: KeyboardEvent) => {
  if (e.isComposing || ['Shift', 'Control', 'Meta', 'Alt', 'AltGraph'].includes(e.key)) return ''
  const key = e.key === 'Escape' ? 'Esc' : e.code || e.key
  if (!key) return ''
  const keys: string[] = []
  if (e.shiftKey) keys.push('Shift')
  if (e.ctrlKey) keys.push('Ctrl')
  if (e.metaKey) keys.push('Cmd')
  if (e.altKey) keys.push('Alt')
  keys.push(key)
  return keys.join(' + ')
}
const browseActions = { KeyD: 'download', Delete: 'delete', KeyL: 'toggle_tag_like' } as const
export function matchBrowseShortcut(value: string): typeof browseActions[keyof typeof browseActions] | undefined {
  return browseActions[value as keyof typeof browseActions]
}

export const browseShortcuts = [
  { keys: 'PageUp / PageDown', action: '向前／向后翻一屏', scope: '媒体列表 · 鼠标位于列表上' },
  { keys: 'Home / End', action: '跳到已加载列表的开头／末尾', scope: '媒体列表 · 鼠标位于列表上' },
  { keys: 'Backspace', action: '返回上级目录', scope: '媒体列表' },
  { keys: 'Ctrl / Cmd + A', action: '全选／取消全选已加载的媒体', scope: '媒体列表' },
  { keys: '↑ / ←　　↓ / →', action: '上一项／下一项', scope: '普通预览、全屏预览' },
  { keys: 'Esc', action: '关闭预览', scope: '普通预览、全屏预览' },
  { keys: '+ / −', action: '放大／缩小图片', scope: '图片预览' },
  { keys: '滚轮', action: '缩放图片', scope: '图片预览' },
  { keys: 'Ctrl / Cmd + 滚轮', action: '上一项／下一项', scope: '普通预览、全屏预览' },
  { keys: '0', action: '恢复图片大小、位置与旋转', scope: '图片预览' },
  { keys: 'R', action: '向右旋转 90°', scope: '图片预览' },
  { keys: 'D', action: '下载选中媒体／当前文件', scope: '媒体列表 · 已选中媒体；普通预览、全屏预览' },
  { keys: 'Delete', action: '删除选中媒体／当前文件', scope: '媒体列表 · 已选中媒体；普通预览、全屏预览' },
  { keys: 'L', action: '切换“喜欢”标签', scope: '媒体列表 · 已选中媒体；普通预览、全屏预览' },
]

export const imageStudioShortcuts = [
  { keys: '滚轮', action: '以指针所在位置缩放视图', scope: '图片制作画布' },
  { keys: '中键拖动 / 空格 + 左键拖动', action: '平移画布', scope: '图片制作画布' },
  { keys: 'Ctrl / Cmd + 点击', action: '多选图层', scope: '图层列表与画布' },
  { keys: 'Alt + 点击', action: '选择图层所属分组', scope: '图片制作画布' },
  { keys: 'Esc', action: '取消裁剪、关闭菜单或返回画布属性', scope: '图片制作' },
  { keys: 'Ctrl / Cmd + G', action: '将所选图层编组／解散选中分组', scope: '图片制作' },
  { keys: 'Ctrl / Cmd + C / V', action: '复制／粘贴图层或分组', scope: '图片制作' },
  { keys: 'Ctrl / Cmd + Z', action: '撤销', scope: '图片制作' },
  { keys: 'Ctrl / Cmd + Shift + Z / Ctrl / Cmd + Y', action: '重做', scope: '图片制作' },
  { keys: 'Delete', action: '删除选中图层', scope: '图片制作' },
  { keys: '方向键 / Shift + 方向键', action: '移动选中图层 1 / 10 px', scope: '图片制作' },
]

export const aiImageEditorShortcuts = [
  { keys: '滚轮', action: '以指针所在位置缩放视图', scope: 'AI 创作 · 图片编辑画布' },
  { keys: '中键拖动', action: '平移画布', scope: 'AI 创作 · 图片编辑画布' },
  { keys: 'V', action: '切换到选择工具', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Ctrl / Cmd + S', action: '保存图片编辑草稿', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Ctrl / Cmd + Z', action: '撤销', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Ctrl / Cmd + Shift + Z / Ctrl / Cmd + Y', action: '重做', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Delete', action: '删除选中标注', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Enter / Esc', action: '确认／取消裁剪', scope: 'AI 创作 · 图片编辑 · 裁剪时' },
  { keys: 'Esc', action: '收起画布上的批注', scope: 'AI 创作 · 图片编辑 · 批注展开时' },
]
