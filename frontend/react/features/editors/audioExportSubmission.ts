import {
  VideoExportSubmission,
  type VideoExportTask,
  type VideoExportInput
} from './videoExportSubmission.ts'
import { readAudioTimeline } from '../../../src/features/media-editor/model/audioTimeline.ts'

export type AudioExportTask = VideoExportTask
export interface AudioExportInput extends VideoExportInput {
  start: number
  duration: number
  format: 'wav' | 'mp3'
}
export const pendingAudioExportKey = (workspaceId: string, documentId: string) =>
  `omnigallery:audio-export-pending-v1:${workspaceId}:${documentId}`

/** Reuse the tested durable submission protocol; the stored snapshot includes all render options. */
export class AudioExportSubmission extends VideoExportSubmission {
  constructor(dependencies: {
    workspaceId: string
    documentId: string
    read: () => Pick<Storage, 'getItem'>
    mutate: <T>(operation: (storage: Storage) => T) => Promise<T>
    post: (body: string) => Promise<AudioExportTask>
    createId: () => string
  }) {
    const key = pendingAudioExportKey(dependencies.workspaceId, dependencies.documentId)
    super({
      ...dependencies,
      read: () => ({ getItem: () => dependencies.read().getItem(key) }),
      mutate: (operation) =>
        dependencies.mutate((storage) =>
          operation({
            ...storage,
            getItem: () => storage.getItem(key),
            setItem: (_key, value) => storage.setItem(key, value),
            removeItem: () => storage.removeItem(key)
          })
        ),
      post: (body) => {
        const request = JSON.parse(body)
        const snapshot = request.document as Pick<
          AudioExportInput,
          'document' | 'start' | 'duration' | 'format'
        >
        return dependencies.post(JSON.stringify({ ...request, ...snapshot }))
      }
    })
  }
  override submit(input: AudioExportInput) {
    if (!input.name.trim() || input.name.length > 120)
      return Promise.reject(new Error('产物名称需为 1 至 120 个字符'))
    if (
      !Number.isFinite(input.start) ||
      !Number.isFinite(input.duration) ||
      input.start < 0 ||
      input.duration <= 0 ||
      input.start + input.duration > 86400 ||
      !['wav', 'mp3'].includes(input.format)
    )
      return Promise.reject(new Error('音频导出范围或格式无效'))
    try {
      const document = readAudioTimeline(JSON.stringify(input.document))
      if (
        document.tracks.some(
          (track) =>
            track.name.length > 120 ||
            track.clips.some((clip) => clip.name.length > 256 || clip.path.length > 8192)
        )
      )
        throw new Error('音轨或素材名称过长，请缩短后导出')
    } catch (error) {
      return Promise.reject(error)
    }
    return super.submit({
      ...input,
      document: {
        document: input.document,
        start: input.start,
        duration: input.duration,
        format: input.format
      }
    })
  }
}
