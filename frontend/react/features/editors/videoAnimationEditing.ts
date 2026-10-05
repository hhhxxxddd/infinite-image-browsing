import {
  bounded,
  evaluatedTransform,
  rounded,
  videoAnimatedFields,
  videoEasings,
  type VideoAnimatedField,
  type VideoClip,
  type VideoEasing,
  type VideoKeyframe
} from './videoStudioModel.ts'

export interface VideoAnimationEdit {
  clip: VideoClip
  error?: string
  times?: number[]
}
export function videoKeyTime(value: number, duration: number, fps = 30) {
  return rounded(bounded(Math.round(value * fps) / fps, 0, duration))
}
function validate(clip: VideoClip, frames: VideoKeyframe[]): VideoAnimationEdit {
  if (frames.length > 128) return { clip, error: '最多 128 个关键帧' }
  if (frames.some((f) => f.time < 0 || f.time > clip.duration || !Number.isFinite(f.time)))
    return { clip, error: '关键帧超出片段范围' }
  if (new Set(frames.map((f) => f.time)).size !== frames.length)
    return { clip, error: '该时刻已有关键帧' }
  return { clip: { ...clip, keyframes: frames.sort((a, b) => a.time - b.time) } }
}
export function upsertVideoKeyframe(
  clip: VideoClip,
  time: number,
  fields: readonly VideoAnimatedField[] = videoAnimatedFields,
  fps = 30
) {
  const stamp = videoKeyTime(time, clip.duration, fps),
    values = evaluatedTransform({ ...clip, fadeIn: 0, fadeOut: 0, transitionIn: undefined }, stamp)
  const existing = clip.keyframes?.find((frame) => frame.time === stamp)
  const frame: VideoKeyframe = { ...existing, time: stamp }
  for (const field of fields) frame[field] = values[field]
  return {
    ...validate(clip, [...(clip.keyframes ?? []).filter((f) => f.time !== stamp), frame]),
    times: [stamp]
  }
}
export function moveVideoKeyframes(
  clip: VideoClip,
  selected: readonly number[],
  delta: number,
  fps = 30
) {
  const chosen = (clip.keyframes ?? []).filter((f) => selected.includes(f.time))
  if (!chosen.length) return { clip }
  const from = Math.min(...chosen.map((f) => f.time)),
    to = Math.max(...chosen.map((f) => f.time))
  const accepted = bounded(
    videoKeyTime(from + bounded(delta, -from, clip.duration - to), clip.duration, fps) - from,
    -from,
    clip.duration - to
  )
  return {
    ...validate(
      clip,
      (clip.keyframes ?? []).map((f) =>
        selected.includes(f.time) ? { ...f, time: rounded(f.time + accepted) } : f
      )
    ),
    times: selected.map((t) => rounded(t + accepted))
  }
}
export function copyVideoKeyframesToTime(
  clip: VideoClip,
  selected: readonly number[],
  time: number,
  fps = 30
) {
  const chosen = (clip.keyframes ?? []).filter((f) => selected.includes(f.time))
  if (!chosen.length) return { clip, error: '先选中要复制的关键帧' }
  const from = Math.min(...chosen.map((f) => f.time)),
    offset = videoKeyTime(time, clip.duration, fps) - from
  return {
    ...validate(clip, [
      ...(clip.keyframes ?? []),
      ...chosen.map((f) => ({ ...structuredClone(f), time: rounded(f.time + offset) }))
    ]),
    times: chosen.map((f) => rounded(f.time + offset))
  }
}
export function patchVideoKeyframes(
  clip: VideoClip,
  selected: readonly number[],
  patch: Partial<Omit<VideoKeyframe, 'time' | 'curves'>>
) {
  if (patch.easing && !videoEasings.includes(patch.easing)) return { clip, error: '动画曲线无效' }
  const bounds: Record<VideoAnimatedField, [number, number]> = {
    x: [-2, 2],
    y: [-2, 2],
    scale: [0.05, 4],
    rotation: [-360, 360],
    opacity: [0, 1]
  }
  for (const field of videoAnimatedFields)
    if (
      patch[field] !== undefined &&
      (!Number.isFinite(patch[field]) ||
        patch[field] < bounds[field][0] ||
        patch[field] > bounds[field][1])
    )
      return { clip, error: '动画数值超出范围' }
  return validate(
    clip,
    (clip.keyframes ?? []).map((frame) => {
      if (!selected.includes(frame.time)) return frame
      const next = { ...frame, ...patch }
      if (patch.easing !== undefined) next.curves = undefined
      return next
    })
  )
}
export const videoEasingLabels: { value: VideoEasing; label: string }[] = [
  { value: 'linear', label: '匀速' },
  { value: 'easeIn', label: '缓入' },
  { value: 'easeOut', label: '缓出' },
  { value: 'easeInOut', label: '缓入缓出' }
]
