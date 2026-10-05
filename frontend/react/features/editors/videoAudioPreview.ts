import type { VideoTimelineDocument } from './videoStudioModel.ts'

/** Visual edits must not invalidate an otherwise identical playing mix. */
export function prepareVideoAudioPreview(document: VideoTimelineDocument) {
  const snapshot = structuredClone(document)
  const signature = JSON.stringify({
    sounds: snapshot.sounds,
    tracks: snapshot.tracks.filter((track) => track.kind === 'audio'),
    masterGain: ('masterGain' in snapshot ? snapshot.masterGain : undefined) ?? 1,
    processing: 'processing' in snapshot ? snapshot.processing : undefined
  })
  return { document: snapshot, signature, gain: 1 }
}
