import type { FileNodeInfo } from './files'
import { apiBase, axiosInst } from './index'

export interface AudioLyricLine { time?: number; text: string }
export interface AudioLyrics { source: 'sidecar' | 'embedded'; timed: boolean; lines: AudioLyricLine[] }
export interface AudioMetadata {
  title: string
  artist: string
  album: string
  duration: number | null
  has_cover: boolean
  lyrics: AudioLyrics | null
}

export async function getAudioMetadata(path: string): Promise<AudioMetadata> {
  return (await axiosInst.value.get('/audio_metadata', { params: { path } })).data
}

export function audioCoverUrl(file: FileNodeInfo): string {
  return `${apiBase.value}/audio_cover?path=${encodeURIComponent(file.fullpath)}&t=${encodeURIComponent(file.date)}`
}
