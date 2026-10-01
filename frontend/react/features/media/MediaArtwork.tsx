import { useEffect, useState } from 'react'
import { IconMusic, IconPhoto, IconVideo } from '@tabler/icons-react'
import {
  audioCoverUrl,
  mediaKind,
  rawMediaUrl,
  thumbnailUrl,
  videoCoverUrl,
  type MediaFile
} from './mediaApi'

export function MediaArtwork({
  file,
  large = false,
  thumbnailsEnabled = true,
  thumbnailSize = 512
}: {
  file: MediaFile
  large?: boolean
  thumbnailsEnabled?: boolean
  thumbnailSize?: number
}) {
  const kind = mediaKind(file)
  const [broken, setBroken] = useState(false)
  useEffect(
    () => setBroken(false),
    [file.fullpath, file.date, large, thumbnailsEnabled, thumbnailSize]
  )
  if (kind === 'other' || broken) {
    return (
      <div className="ml-artwork-fallback">
        {kind === 'audio' ? (
          <IconMusic size={large ? 62 : 38} stroke={1.3} />
        ) : kind === 'video' ? (
          <IconVideo size={large ? 62 : 38} stroke={1.3} />
        ) : (
          <IconPhoto size={large ? 62 : 38} stroke={1.3} />
        )}
      </div>
    )
  }
  const src =
    kind === 'image'
      ? large || !thumbnailsEnabled
        ? rawMediaUrl(file)
        : thumbnailUrl(file, thumbnailSize)
      : kind === 'video'
        ? videoCoverUrl(file)
        : audioCoverUrl(file)
  return (
    <img
      className="ml-artwork-image"
      src={src}
      alt=""
      loading={large ? 'eager' : 'lazy'}
      onError={() => setBroken(true)}
    />
  )
}
