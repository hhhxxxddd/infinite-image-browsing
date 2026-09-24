export type ImageLayout = 'single' | 'pair-horizontal' | 'pair-vertical' | 'grid-four' | 'grid-six' | 'grid-nine'
export type ImageFit = 'cover' | 'contain'

export interface ImageSlot {
  path: string
  rotation: 0 | 90 | 180 | 270
  zoom: number
  focusX: number
  focusY: number
}

export interface ImageDraft {
  layout: ImageLayout
  width: number
  height: number
  padding: number
  gap: number
  radius: number
  background: string
  fit: ImageFit
  brightness: number
  contrast: number
  caption: string
  captionSize: number
  captionColor: string
  slots: ImageSlot[]
}

export interface ImageRect { x: number; y: number; width: number; height: number }

export const imageLayouts: { key: ImageLayout; label: string; columns: number; rows: number }[] = [
  { key: 'single', label: '单图', columns: 1, rows: 1 },
  { key: 'pair-horizontal', label: '左右拼接', columns: 2, rows: 1 },
  { key: 'pair-vertical', label: '上下拼接', columns: 1, rows: 2 },
  { key: 'grid-four', label: '四宫格', columns: 2, rows: 2 },
  { key: 'grid-six', label: '六宫格', columns: 3, rows: 2 },
  { key: 'grid-nine', label: '九宫格', columns: 3, rows: 3 }
]

export function emptyImageSlot(): ImageSlot {
  return { path: '', rotation: 0, zoom: 1, focusX: 50, focusY: 50 }
}

export function createImageDraft(): ImageDraft {
  return {
    layout: 'single', width: 1080, height: 1080, padding: 24, gap: 16, radius: 0,
    background: '#ffffff', fit: 'cover', brightness: 100, contrast: 100,
    caption: '', captionSize: 48, captionColor: '#ffffff', slots: Array.from({ length: 9 }, emptyImageSlot)
  }
}

function numberWithin(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

function colorOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

export function readImageDraft(value: unknown): ImageDraft {
  const initial = createImageDraft()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return initial
  const source = value as Record<string, unknown>
  const layout = imageLayouts.find(item => item.key === source.layout) ?? imageLayouts[0]
  const rawSlots = Array.isArray(source.slots) ? source.slots : []
  const slots = Array.from({ length: 9 }, (_, index): ImageSlot => {
    const raw = rawSlots[index]
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyImageSlot()
    const slot = raw as Record<string, unknown>
    return {
      path: typeof slot.path === 'string' ? slot.path.slice(0, 2048) : '',
      rotation: [0, 90, 180, 270].includes(slot.rotation as number) ? slot.rotation as ImageSlot['rotation'] : 0,
      zoom: numberWithin(slot.zoom, 1, 1, 3),
      focusX: numberWithin(slot.focusX, 50, 0, 100),
      focusY: numberWithin(slot.focusY, 50, 0, 100)
    }
  })
  return {
    layout: layout.key,
    width: Math.round(numberWithin(source.width, initial.width, 320, 4096)),
    height: Math.round(numberWithin(source.height, initial.height, 320, 4096)),
    padding: Math.round(numberWithin(source.padding, initial.padding, 0, 200)),
    gap: Math.round(numberWithin(source.gap, initial.gap, 0, 160)),
    radius: Math.round(numberWithin(source.radius, initial.radius, 0, 160)),
    background: colorOr(source.background, initial.background),
    fit: source.fit === 'contain' ? 'contain' : 'cover',
    brightness: Math.round(numberWithin(source.brightness, 100, 20, 200)),
    contrast: Math.round(numberWithin(source.contrast, 100, 20, 200)),
    caption: typeof source.caption === 'string' ? source.caption.slice(0, 120) : '',
    captionSize: Math.round(numberWithin(source.captionSize, 48, 18, 120)),
    captionColor: colorOr(source.captionColor, initial.captionColor),
    slots
  }
}

export function imageRects(draft: Pick<ImageDraft, 'layout' | 'width' | 'height' | 'padding' | 'gap'>): ImageRect[] {
  const layout = imageLayouts.find(item => item.key === draft.layout) ?? imageLayouts[0]
  const padding = Math.min(draft.padding, Math.floor(Math.min(draft.width, draft.height) / 4))
  const availableWidth = draft.width - padding * 2
  const availableHeight = draft.height - padding * 2
  const gap = Math.min(draft.gap,
    layout.columns > 1 ? (availableWidth - 1) / (layout.columns - 1) : draft.gap,
    layout.rows > 1 ? (availableHeight - 1) / (layout.rows - 1) : draft.gap)
  const innerWidth = Math.max(1, availableWidth - gap * (layout.columns - 1))
  const innerHeight = Math.max(1, availableHeight - gap * (layout.rows - 1))
  const cellWidth = innerWidth / layout.columns
  const cellHeight = innerHeight / layout.rows
  return Array.from({ length: layout.columns * layout.rows }, (_, index) => ({
    x: padding + (index % layout.columns) * (cellWidth + gap),
    y: padding + Math.floor(index / layout.columns) * (cellHeight + gap),
    width: cellWidth,
    height: cellHeight
  }))
}
