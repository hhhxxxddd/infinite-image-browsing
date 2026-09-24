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
export const formatShortcut = (value?: string) => (value || '').replace(/\bKey([A-Z])\b/g, '$1').replace(/\bDigit([0-9])\b/g, '$1')
export const configurableShortcutKeys = ['download', 'delete', 'toggle_tag_like'] as const
export type ConfigurableShortcutKey = typeof configurableShortcutKeys[number]
export function normalizeConfigurableShortcuts(source: Record<string, unknown> | null | undefined): Record<ConfigurableShortcutKey, string> {
  const read = (key: ConfigurableShortcutKey) => typeof source?.[key] === 'string' ? source[key] as string : ''
  return { download: read('download'), delete: read('delete'), toggle_tag_like: read('toggle_tag_like') }
}
export function matchPreviewShortcut(shortcuts: Partial<Record<ConfigurableShortcutKey, string | undefined>>, value: string): ConfigurableShortcutKey | undefined {
  if (!value || shortcutRestriction(value)) return undefined
  return configurableShortcutKeys.find(key => shortcuts[key] === value)
}
export function shortcutRestriction(value: string): string {
  const keys = value.split(' + ')
  const key = keys[keys.length - 1]
  if (['Esc', 'Tab', 'Enter', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'Backspace'].includes(key)) return '此按键用于固定操作，不能修改'
  if (['Equal','Minus','NumpadAdd','NumpadSubtract'].includes(key) || ((key === 'Digit0' || key === 'KeyR') && !keys.some(k => ['Ctrl','Cmd','Alt'].includes(k)))) return '此按键用于预览缩放或旋转，不能修改'
  if (keys.some(k => k === 'Ctrl' || k === 'Cmd') && ['KeyA','KeyC','KeyV','KeyX','KeyZ','KeyY','KeyW','KeyT','KeyN','KeyR','KeyL','KeyP','KeyQ','KeyF','KeyS'].includes(key)) return '此组合用于浏览器或常用编辑操作，请换一个'
  if (keys.includes('Alt') && ['F4','Tab','ArrowLeft','ArrowRight'].includes(key)) return '此组合由系统使用，请换一个'
  if (!/^Key[A-Z]$|^Digit[0-9]$|^F(?:[2-9]|10)$|^Delete$/.test(key)) return '请选择字母、数字、Delete 或 F2–F10'
  return ''
}
export const fixedShortcuts = [
  {keys:'PageUp / PageDown', action:'向前／向后翻一屏', scope:'媒体列表 · 鼠标位于列表上'},
  {keys:'Home / End', action:'跳到已加载列表的开头／末尾', scope:'媒体列表 · 鼠标位于列表上'},
  {keys:'Ctrl / Cmd + A', action:'全选已加载的媒体', scope:'媒体列表 · 鼠标位于列表上'},
  {keys:'↑ / ←　　↓ / →', action:'上一项／下一项', scope:'普通预览、全屏预览'},
  {keys:'Esc', action:'关闭预览', scope:'普通预览、全屏预览'},
  {keys:'+ / −', action:'放大／缩小图片', scope:'图片预览'},
  {keys:'滚轮', action:'缩放图片', scope:'图片预览'},
  {keys:'Ctrl / Cmd + 滚轮', action:'上一项／下一项', scope:'普通预览、全屏预览'},
  {keys:'0', action:'恢复图片大小、位置与旋转', scope:'图片预览'},
  {keys:'R', action:'向右旋转 90°', scope:'图片预览'}
]
