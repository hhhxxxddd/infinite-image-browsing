import {
  audioTimelineKey,
  readAudioTimeline,
  timelineDuration
} from '../../../src/features/media-editor/model/audioTimeline.ts'
import {
  clipTrack,
  previewSourceTime,
  readDocument,
  timelineEnd
} from '../editors/videoStudioModel.ts'
import { formatTimelineTime } from '../editors/timelineTime.ts'

export type DraftCoverSource = {
  path: string
  kind: 'image' | 'video' | 'audio'
  time?: number
  fps?: number
}

/** Read the current production's inputs, never an unrelated item from the shared media pool. */
export function readTimelineDraftCover(
  storage: Pick<Storage, 'getItem'>,
  workspaceId: string,
  draftId: string,
  kind: 'video' | 'audio'
): { sources: DraftCoverSource[]; summary: string } {
  if (kind === 'audio') {
    const doc = readAudioTimeline(storage.getItem(audioTimelineKey(workspaceId, draftId)))
    const clips = doc.tracks.flatMap((track) => track.clips).sort((a, b) => a.start - b.start)
    const paths = new Set<string>()
    return {
      sources: clips.flatMap((clip) => {
        if (clip.sourceKind === 'video' || paths.has(clip.path)) return []
        paths.add(clip.path)
        return [{ path: clip.path, kind: 'audio' as const }]
      }),
      summary: `${formatTimelineTime(timelineDuration(doc))} · ${doc.tracks.length} 条音轨`
    }
  }
  const doc = readDocument(
    storage.getItem(`omnigallery:video-timeline-v1:${workspaceId}:${draftId}`)
  )
  const clips = doc.visuals
    .filter((clip) => !clipTrack(doc, clip, 'visual')?.hidden)
    .sort((a, b) => a.start - b.start)
  return {
    sources: clips.map((clip) => ({
      path: clip.path,
      kind: clip.kind === 'image' ? 'image' : 'video',
      time: previewSourceTime(clip, clip.start + Math.min(0.5, clip.duration / 2), doc.fps),
      fps: doc.fps
    })),
    summary: `${doc.width} × ${doc.height} · ${formatTimelineTime(timelineEnd(doc))}`
  }
}

export function draftVideoThumbnailQuery(source: DraftCoverSource, workspaceId: string) {
  const time = source.time ?? 0
  const halfFrame = 0.5 / (source.fps || 30)
  return new URLSearchParams({
    workspace_id: workspaceId,
    path: source.path,
    start: String(Math.max(0, time - halfFrame)),
    end: String(time + halfFrame),
    count: '1',
    width: '320'
  }).toString()
}

let preparingVideoCovers = 0
const videoCoverQueue: Array<() => void> = []

/** Match the two bounded server decoders when several cards enter the viewport together. */
export function queueDraftVideoCover<T>(
  prepare: () => Promise<T>,
  live: () => boolean
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const run = () => {
      if (!live()) {
        resolve(undefined)
        videoCoverQueue.shift()?.()
        return
      }
      preparingVideoCovers++
      void prepare()
        .then(resolve, reject)
        .finally(() => {
          preparingVideoCovers--
          videoCoverQueue.shift()?.()
        })
    }
    if (preparingVideoCovers < 2) run()
    else videoCoverQueue.push(run)
  })
}
