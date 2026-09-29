import { axiosInst } from '@/shared/api/httpClient'
import type { AudioTimelineDocument } from '../model/audioTimeline'
import type { WorkspaceArtifact } from '@/features/workspaces/api/workspaceArtifacts'
import { decodeLevels } from '../model/audioLevels'

export interface AudioSourceInfo {
  duration: number
  sampleRate: number
  channels: number
  codec: string
  peaks?: number[]
}
export async function getAudioSource(workspaceId: string, path: string, peaks = false) {
  return (
    await axiosInst.value.get<AudioSourceInfo>('/audio_studio/source', {
      params: { workspace_id: workspaceId, path, peaks },
      handledLocally: true,
      timeout: 0
    })
  ).data
}
export async function previewAudio(
  workspaceId: string,
  document: AudioTimelineDocument,
  start: number,
  duration: number,
  signal: AbortSignal
) {
  const response = await axiosInst.value.post<ArrayBuffer>(
    '/audio_studio/preview',
    { workspace_id: workspaceId, document, start, duration },
    { signal, responseType: 'arraybuffer', handledLocally: true, timeout: 0 }
  )
  return {
    data: response.data,
    levels: decodeLevels(String(response.headers['x-audio-level-peaks'] ?? ''))
  }
}
export async function exportAudio(
  workspaceId: string,
  documentId: string,
  documentRevision: string,
  document: AudioTimelineDocument,
  name: string,
  format: 'wav' | 'mp3',
  start: number,
  duration: number
) {
  return (
    await axiosInst.value.post<WorkspaceArtifact & { mix_peak_dbfs: number | null }>(
      '/audio_studio/export',
      {
        workspace_id: workspaceId,
        document_id: documentId,
        document_revision: documentRevision,
        document,
        name,
        format,
        start,
        duration
      },
      { handledLocally: true, timeout: 0 }
    )
  ).data
}
