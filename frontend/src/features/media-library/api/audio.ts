import type { FileNodeInfo } from './files'
import { apiBase, axiosInst } from '@/shared/api/httpClient'

export interface AudioLyricLine {
  time?: number
  text: string
}
export interface AudioLyrics {
  source: 'sidecar' | 'embedded'
  timed: boolean
  lines: AudioLyricLine[]
}
export interface AudioMetadata {
  title: string
  embedded_title: string
  title_source: 'embedded' | 'filename'
  artist: string
  album: string
  duration: number | null
  has_cover: boolean
  cover_source: 'embedded' | 'same_name' | 'directory' | null
  cover_name: string
  editable: boolean
  revision: string
  modified_date: string
  lyrics: AudioLyrics | null
}

export interface AudioMetadataUpdate {
  path: string
  revision: string
  title: string
  artist: string
  album: string
  cover?: string
  remove_cover?: boolean
}
export async function updateAudioMetadata(request: AudioMetadataUpdate): Promise<AudioMetadata> {
  return (await axiosInst.value.post('/audio_metadata', request)).data
}

export async function getAudioMetadata(path: string): Promise<AudioMetadata> {
  return (await axiosInst.value.get('/audio_metadata', { params: { path } })).data
}

export function audioCoverUrl(file: FileNodeInfo, revision = file.date): string {
  return `${apiBase.value}/audio_cover?path=${encodeURIComponent(file.fullpath)}&t=${encodeURIComponent(revision)}`
}
