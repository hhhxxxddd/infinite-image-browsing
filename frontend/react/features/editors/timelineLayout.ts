export const TIMELINE_TRACK_HEADER_WIDTH = 142
export const TIMELINE_TRACK_HEIGHTS = [
  { value: 76, label: '紧凑' },
  { value: 110, label: '标准' },
  { value: 144, label: '展开' }
] as const
export const TIMELINE_STANDARD_TRACK_HEIGHT = TIMELINE_TRACK_HEIGHTS[1].value
