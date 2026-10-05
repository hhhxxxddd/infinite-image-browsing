import { sourceTime, type VideoClip } from './videoStudioModel.ts'

export interface VideoClipStripProps {
  clip: VideoClip
  workspaceId: string
  left: number
  width: number
  pixelsPerSecond: number
  lane: 'visual' | 'sound'
  imageUrl: string
  sourceRevision?: string
}

export function videoClipStripWindow({
  clip,
  left,
  width,
  pixelsPerSecond,
  lane
}: VideoClipStripProps) {
  const origin = clip.start * pixelsPerSecond
  const from = lane === 'sound' ? Math.floor((left - origin) / 128) * 128 + origin : left
  const to =
    lane === 'sound' ? Math.ceil((left + width - origin) / 128) * 128 + origin : left + width
  const visibleStart = Math.max(clip.start, from / pixelsPerSecond)
  const visibleEnd = Math.min(clip.start + clip.duration, to / pixelsPerSecond)
  const screenWidth = Math.max(0, (visibleEnd - visibleStart) * pixelsPerSecond)
  const first = sourceTime(clip, visibleStart)
  const last = sourceTime(clip, visibleEnd)
  const start = Math.max(0, Math.min(first, last))
  return {
    start,
    end: Math.max(start + 0.001, Math.max(first, last)),
    screenWidth,
    offset: (visibleStart - clip.start) * pixelsPerSecond
  }
}

export function sameVideoClipStripProps(previous: VideoClipStripProps, next: VideoClipStripProps) {
  return (
    previous.workspaceId === next.workspaceId &&
    previous.left === next.left &&
    previous.width === next.width &&
    previous.pixelsPerSecond === next.pixelsPerSecond &&
    previous.lane === next.lane &&
    previous.imageUrl === next.imageUrl &&
    previous.sourceRevision === next.sourceRevision &&
    previous.clip.path === next.clip.path &&
    previous.clip.kind === next.clip.kind &&
    previous.clip.start === next.clip.start &&
    previous.clip.sourceIn === next.clip.sourceIn &&
    previous.clip.duration === next.clip.duration &&
    previous.clip.rate === next.clip.rate &&
    (previous.clip.audioStream ?? 0) === (next.clip.audioStream ?? 0) &&
    !!previous.clip.reverse === !!next.clip.reverse &&
    !!previous.clip.freeze === !!next.clip.freeze
  )
}
