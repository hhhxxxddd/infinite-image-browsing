import type { SourceRelinkSource, SourceRelinkSelection } from './sourceRelink'
import { applySourceRelink } from './sourceRelink.ts'
import { clipLocked, mapClips, type VideoTimelineDocument } from './videoStudioModel.ts'

export function videoRelinkSources(document: VideoTimelineDocument): SourceRelinkSource[] {
  const result = new Map<string, SourceRelinkSource>()
  for (const [lane, clips] of [
    ['visual', document.visuals],
    ['sound', document.sounds]
  ] as const) {
    for (const clip of clips) {
      let source = result.get(clip.path)
      if (!source) {
        source = { path: clip.path, name: clip.name, kind: clip.kind, clips: [] }
        result.set(clip.path, source)
      }
      source.clips.push({
        id: clip.id,
        sourceIn: clip.sourceIn,
        duration: clip.duration,
        rate: clip.rate,
        freeze: clip.freeze,
        requiresAudio: lane === 'sound',
        audioStream: clip.audioStream,
        requiresVideo: lane === 'visual'
      })
    }
  }
  return [...result.values()]
}

export function relinkVideoSources(
  document: VideoTimelineDocument,
  selection: SourceRelinkSelection
) {
  for (const [lane, clips] of [
    ['visual', document.visuals],
    ['sound', document.sounds]
  ] as const) {
    if (
      clips.some((clip) => clip.path === selection.source.path && clipLocked(document, clip, lane))
    )
      throw new Error('使用该素材的轨道已锁定，请先解锁再重新指定')
  }
  return mapClips(document, (clip) => applySourceRelink(clip, selection))
}
