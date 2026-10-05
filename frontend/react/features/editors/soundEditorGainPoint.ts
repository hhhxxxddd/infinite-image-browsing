import {
  sampleTime,
  type AudioClip
} from '../../../src/features/media-editor/model/audioTimeline.ts'
import {
  gainPointAt,
  insertGainPoint,
  moveGainPoint
} from '../../../src/features/media-editor/model/audioEnvelopeEditing.ts'

/** Point times stay in their original envelope; controls display time within the trimmed clip. */
export function soundEditorGainPoint(clip: AudioClip, time: number | null) {
  if (time === null) return null
  const points = clip.gainPoints ?? []
  const index = points.findIndex(
    (point) =>
      Math.abs(point.time - time) < 0.5 / 48000 &&
      point.time >= clip.envelopeOffset &&
      point.time <= clip.envelopeOffset + clip.duration
  )
  if (index < 0) return null
  const point = points[index]
  return { index, point, local: sampleTime(point.time - clip.envelopeOffset) }
}

export function editSoundEditorGainPoint(
  clip: AudioClip,
  time: number | null,
  patch: { local?: number; gain?: number }
) {
  const selected = soundEditorGainPoint(clip, time)
  if (!selected || Object.values(patch).some((value) => !Number.isFinite(value))) return null
  const gainPoints = moveGainPoint(
    clip,
    selected.index,
    patch.local ?? selected.local,
    patch.gain ?? selected.point.gain
  )
  const point = gainPoints[selected.index]
  return {
    clip:
      point.time === selected.point.time && point.gain === selected.point.gain
        ? clip
        : { ...clip, gainPoints },
    time: point.time
  }
}

export function addSoundEditorGainPoint(clip: AudioClip, local: number) {
  if (!Number.isFinite(local)) return null
  const time = gainPointAt(clip, local, 1).time
  const selected = soundEditorGainPoint(clip, time)
  if (selected) return { clip, time: selected.point.time }
  if ((clip.gainPoints?.length ?? 0) >= 128) return null
  return { clip: { ...clip, gainPoints: insertGainPoint(clip, local) }, time }
}
