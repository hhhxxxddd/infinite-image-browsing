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
export function matchBrowseShortcut(
  value: string
): (typeof browseActions)[keyof typeof browseActions] | undefined {
  return browseActions[value as keyof typeof browseActions]
}

export const browseShortcuts = [
  { keys: 'PageUp / PageDown', action: '向前／向后翻一屏', scope: '媒体列表 · 鼠标位于列表上' },
  { keys: 'Home / End', action: '跳到已加载列表的开头／末尾', scope: '媒体列表 · 鼠标位于列表上' },
  { keys: 'Backspace', action: '返回上级目录', scope: '媒体列表 · 鼠标位于列表上' },
  { keys: 'Ctrl / Cmd + A', action: '全选／取消全选已加载的媒体', scope: '媒体列表' },
  { keys: '↑ / ←　　↓ / →', action: '上一项／下一项', scope: '普通预览、全屏预览' },
  { keys: 'Esc', action: '关闭预览', scope: '普通预览、全屏预览' },
  { keys: '+ / −', action: '放大／缩小图片', scope: '图片预览' },
  { keys: '滚轮', action: '缩放图片', scope: '图片预览' },
  { keys: 'Ctrl / Cmd + 滚轮', action: '上一项／下一项', scope: '普通预览、全屏预览' },
  { keys: '0', action: '恢复图片大小、位置与旋转', scope: '图片预览' },
  { keys: 'R', action: '向右旋转 90°', scope: '图片预览' },
  {
    keys: 'D',
    action: '下载选中媒体／当前文件',
    scope: '媒体列表 · 鼠标位于列表上且已选中媒体；普通预览、全屏预览'
  },
  {
    keys: 'Delete',
    action: '删除选中媒体／当前文件',
    scope: '媒体列表 · 鼠标位于列表上且已选中媒体；普通预览、全屏预览'
  },
  {
    keys: 'L',
    action: '切换“喜欢”标签',
    scope: '媒体列表 · 鼠标位于列表上且已选中媒体；普通预览、全屏预览'
  }
]

export const imageStudioShortcutGroups = [
  {
    title: '保存与历史',
    items: [
      {
        keys: 'Ctrl / Cmd + S',
        action: '保存制作文件；媒体库编辑时选择保存方式',
        scope: '图片制作'
      },
      { keys: 'Ctrl / Cmd + Z', action: '撤销（拖动／裁剪中先取消）', scope: '图片制作' },
      { keys: 'Ctrl / Cmd + Shift + Z 或 Ctrl / Cmd + Y', action: '重做', scope: '图片制作' }
    ]
  },
  {
    title: '选择与图层',
    items: [
      { keys: 'Ctrl / Cmd + 点击', action: '增减选择，可混选图层与分组', scope: '图层列表与画布' },
      { keys: 'Alt + 点击', action: '选择分组成员或画框内图层', scope: '图片制作画布' },
      {
        keys: 'Ctrl / Cmd + G',
        action: '打开编组确认',
        scope: '选中图层或分组；确认后合并成员到新组'
      },
      {
        keys: 'Ctrl / Cmd + Shift + G',
        action: '解散单个选中分组，保留图层',
        scope: '仅选中一个分组时'
      },
      {
        keys: 'Ctrl / Cmd + C / V',
        action: '复制／粘贴所选内容',
        scope: '当前图片编辑器内，支持图层与分组混选'
      },
      {
        keys: 'Delete / Backspace',
        action: '删除所选内容（含分组时确认）',
        scope: '锁定或 AI 处理中的内容不可删除'
      }
    ]
  },
  {
    title: '移动与视图',
    items: [
      {
        keys: '方向键 / Shift + 方向键',
        action: '移动 1 / 10 像素；裁剪时移动选框',
        scope: '选中未锁定内容；已聚焦控件使用自身按键'
      },
      { keys: 'Shift + 拖动选框角点', action: '切换是否保持缩放比例', scope: '单选图层缩放时' },
      { keys: 'Shift + 拖动旋转手柄', action: '按 15° 对齐旋转', scope: '单选图层旋转时' },
      { keys: '滚轮', action: '缩放视图，不改变输出尺寸', scope: '鼠标位于图片画布区域' },
      {
        keys: '中键拖动 / 空格 + 左键拖动',
        action: '平移视图',
        scope: '图片制作画布；点击“适应”居中复位'
      }
    ]
  },
  {
    title: '文字与退出',
    items: [
      { keys: 'Ctrl / Cmd + Enter', action: '完成画布文字编辑', scope: '双击文字后的编辑框' },
      { keys: 'Esc（文字编辑时）', action: '取消本次文字编辑', scope: '恢复进入编辑前的文字' },
      {
        keys: 'Esc',
        action: '退出当前操作，或取消选择',
        scope: '关闭弹窗／菜单、取消拖动／裁剪、退出对比／工具；即时尺寸和校正修改保留'
      }
    ]
  }
]

// The editor help and settings page share the same shortcut descriptions.
export const imageStudioShortcuts = imageStudioShortcutGroups.flatMap((group) => group.items)

export const aiImageEditorShortcuts = [
  { keys: '滚轮', action: '以指针所在位置缩放视图', scope: 'AI 创作 · 图片编辑画布' },
  { keys: '中键拖动', action: '平移画布', scope: 'AI 创作 · 图片编辑画布' },
  { keys: 'V', action: '切换到选择工具', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Ctrl / Cmd + S', action: '保存图片编辑草稿', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Ctrl / Cmd + Z', action: '撤销', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Ctrl / Cmd + Shift + Z / Ctrl / Cmd + Y', action: '重做', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Delete', action: '删除选中标注', scope: 'AI 创作 · 图片编辑' },
  { keys: 'Enter / Esc', action: '确认／取消裁剪', scope: 'AI 创作 · 图片编辑 · 裁剪时' },
  { keys: 'Esc', action: '收起画布上的批注', scope: 'AI 创作 · 图片编辑 · 批注展开时' }
]
