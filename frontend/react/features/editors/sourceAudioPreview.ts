import {
  createAudioClip,
  createAudioTimeline
} from '../../../src/features/media-editor/model/audioTimeline.ts'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import type { SourceMetadata, SourceRange } from './sourceRange'
import { sourceAudioStreamError } from './sourceAudioStreams.ts'

/** Only selected source samples enter the existing bounded 12-second preview engine. */
export function sourceAudioPreviewDocument(
  asset: WorkspaceAsset,
  metadata: SourceMetadata,
  range: SourceRange,
  audioStream = 0
) {
  const error = sourceAudioStreamError(
    metadata.audioStreams,
    audioStream,
    range.start,
    range.end - range.start
  )
  if (error) throw new Error(error)
  if (asset.kind === 'image' || range.end > metadata.duration || range.end > 86400)
    throw new Error('所选素材不支持声音试听')
  const document = createAudioTimeline()
  const clip = createAudioClip(
    asset.path,
    asset.name,
    range.end - range.start,
    range.start,
    asset.kind
  )
  clip.id = `source-preview-${metadata.fingerprint.slice(0, 60) || 'clip'}`
  clip.sourceIn = range.start
  clip.audioStream = audioStream
  document.tracks[0].id = 'source-preview-track'
  document.tracks[0].clips = [clip]
  return document
}
