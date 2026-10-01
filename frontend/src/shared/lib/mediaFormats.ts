export const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.avif', '.jpe']
export const videoExtensions = [
  '.mp4',
  '.m4v',
  '.avi',
  '.mkv',
  '.mov',
  '.wmv',
  '.flv',
  '.ts',
  '.webm'
]
export const audioExtensions = ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma']

/** Classify by the formats supported by the media index, without requiring an indexed record. */
export function mediaFileKind(filename: string): 'image' | 'video' | 'audio' | 'other' {
  const dot = filename.lastIndexOf('.')
  const extension = dot < 0 ? '' : filename.slice(dot).toLowerCase()
  if (imageExtensions.includes(extension)) return 'image'
  if (videoExtensions.includes(extension)) return 'video'
  if (audioExtensions.includes(extension)) return 'audio'
  return 'other'
}
