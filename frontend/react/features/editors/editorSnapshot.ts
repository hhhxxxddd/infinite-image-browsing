import {
  readAudioTimeline,
  timelineDuration
} from '../../../src/features/media-editor/model/audioTimeline.ts'
import { readDocument, timelineEnd, trackIdFor } from './videoStudioModel.ts'
import type { EditorVersionKind } from './editorVersionModel.ts'

export interface SnapshotItem {
  id: string
  label: string
  start: number
  duration: number
  type: 'visual' | 'sound' | 'text'
}
export interface SnapshotLane {
  id: string
  name: string
  disabled: boolean
  items: SnapshotItem[]
}
export function readEditorSnapshot(
  kind: Extract<EditorVersionKind, 'audio' | 'video'>,
  value: unknown
) {
  const raw = JSON.stringify(value)
  if (kind === 'audio') {
    const document = readAudioTimeline(raw)
    const lanes: SnapshotLane[] = document.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      disabled: track.muted,
      items: track.clips.map((clip) => ({ ...clip, label: clip.name, type: 'sound' }))
    }))
    lanes.push(
      ...(document.textTracks ?? []).map((track) => ({
        id: track.id,
        name: track.name,
        disabled: track.visible === false,
        items: track.cues.map((cue) => ({ ...cue, label: cue.text, type: 'text' as const }))
      }))
    )
    return { kind: 'audio' as const, document, lanes, duration: timelineDuration(document) }
  }
  const document = readDocument(raw)
  const lanes: SnapshotLane[] = document.tracks.map((track) => {
    const type = track.kind === 'video' ? 'visual' : 'sound'
    return {
      id: track.id,
      name: track.name,
      disabled: !!track.hidden || !!track.muted,
      items: (type === 'visual' ? document.visuals : document.sounds)
        .filter((clip) => trackIdFor(clip, type) === track.id)
        .map((clip) => ({ ...clip, label: clip.name, type }))
    }
  })
  if (document.captions.length)
    lanes.push({
      id: 'captions',
      name: '字幕',
      disabled: false,
      items: document.captions.map((cue) => ({ ...cue, label: cue.text, type: 'text' }))
    })
  return { kind: 'video' as const, document, lanes, duration: timelineEnd(document) }
}
