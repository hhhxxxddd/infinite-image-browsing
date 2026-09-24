/** Font choices use installed system faces; each has a portable fallback. */
export const studioFonts = [
  { value: 'system-ui', label: '系统默认', family: 'system-ui, sans-serif' },
  { value: 'Microsoft YaHei', label: '微软雅黑', family: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif' },
  { value: 'SimHei', label: '黑体', family: 'SimHei, "Heiti SC", "Noto Sans CJK SC", sans-serif' },
  { value: 'SimSun', label: '宋体', family: 'SimSun, "Songti SC", "Noto Serif CJK SC", serif' },
  { value: 'KaiTi', label: '楷体', family: 'KaiTi, "Kaiti SC", "Noto Serif CJK SC", serif' },
  { value: 'FangSong', label: '仿宋', family: 'FangSong, "STFangsong", "Noto Serif CJK SC", serif' },
  { value: 'Segoe UI', label: 'Segoe UI', family: '"Segoe UI", system-ui, sans-serif' },
  { value: 'Arial', label: 'Arial', family: 'Arial, sans-serif' },
  { value: 'Georgia', label: 'Georgia', family: 'Georgia, serif' },
  { value: 'Times New Roman', label: 'Times New Roman', family: '"Times New Roman", serif' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif' },
  { value: 'Consolas', label: 'Consolas', family: 'Consolas, "Courier New", monospace' },
  { value: 'monospace', label: '等宽字体', family: 'monospace' },
] as const

export type StudioFont = typeof studioFonts[number]['value']
export const isStudioFont = (value: unknown): value is StudioFont =>
  typeof value === 'string' && studioFonts.some(font => font.value === value)
export const studioFontFamily = (value: StudioFont): string =>
  studioFonts.find(font => font.value === value)?.family ?? 'system-ui, sans-serif'
