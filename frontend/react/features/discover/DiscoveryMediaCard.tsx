import { useState, type CSSProperties } from 'react'
import { ActionIcon, Badge, Group, Menu, Text, Tooltip } from '@mantine/core'
import {
  IconFile,
  IconHeart,
  IconHeartFilled,
  IconHeadphones,
  IconMusic,
  IconPlayerPlay,
  IconTags,
  IconVideo
} from '@tabler/icons-react'
import { fileDisplayName } from '../../../src/shared/lib/fileDisplayName'
import {
  favoriteTagFirst,
  isFavoriteTag
} from '../../../src/features/media-library/model/favoriteTag'
import { tagLabel } from '../../../src/features/media-library/model/tagLabel'
import { tagColor } from '../../design/tagColors'
import { MediaArtwork } from '../media/MediaArtwork'
import { MediaTagMenu } from '../media/MediaTagMenu'
import { mediaKind, type MediaFile, type MediaTag } from '../media/mediaApi'
import { useMediaText } from '../media/mediaLocale'

export function DiscoveryMediaCard({
  file,
  tags,
  availableTags,
  showInformation,
  thumbnailsEnabled,
  thumbnailSize,
  readonly,
  favoriteDisabled,
  onPreview,
  onFavorite,
  onEditTags,
  onToggleTag
}: {
  file: MediaFile
  tags: MediaTag[]
  availableTags: MediaTag[]
  showInformation: boolean
  thumbnailsEnabled: boolean
  thumbnailSize: number
  readonly: boolean
  favoriteDisabled: boolean
  onPreview: () => void
  onFavorite: () => void
  onEditTags: () => void
  onToggleTag: (tag: MediaTag) => void
}) {
  const m = useMediaText()
  const [menuOpen, setMenuOpen] = useState(false)
  const kind = mediaKind(file)
  const liked = tags.some(isFavoriteTag)
  const customTags = tags.filter((tag) => tag.type === 'custom').sort(favoriteTagFirst)
  return (
    <article
      className={`ml-card ml-gallery-card ml-card-${kind}${showInformation ? ' shows-information' : ''}${menuOpen ? ' has-open-menu' : ''}`}
    >
      <button
        type="button"
        className="ml-card-visual discovery-card-main"
        onClick={onPreview}
        aria-label={m('预览：{name}', { name: file.name })}
      >
        <MediaArtwork
          file={file}
          thumbnailsEnabled={thumbnailsEnabled}
          thumbnailSize={thumbnailSize}
        />
        {(kind === 'video' || kind === 'audio') && (
          <span className={`ml-play-indicator${kind === 'audio' ? ' ml-audio-listen' : ''}`}>
            {kind === 'audio' ? (
              <>
                <IconHeadphones size={19} />
                {m('试听')}
              </>
            ) : (
              <IconPlayerPlay size={19} />
            )}
          </span>
        )}
      </button>
      <div className="ml-card-top">
        {kind !== 'image' && (
          <span className="ml-media-kind">
            {kind === 'audio' ? (
              <IconMusic size={13} />
            ) : kind === 'video' ? (
              <IconVideo size={13} />
            ) : (
              <IconFile size={13} />
            )}
            {m(kind === 'audio' ? '音频' : kind === 'video' ? '视频' : '文件')}
          </span>
        )}
        <Tooltip label={m(liked ? '取消收藏' : '收藏')}>
          <ActionIcon
            className={`ml-favorite${liked ? ' is-liked' : ''}`}
            size="sm"
            variant="filled"
            color={liked ? 'red' : 'gray'}
            aria-label={m(liked ? '取消收藏：{name}' : '收藏：{name}', { name: file.name })}
            disabled={favoriteDisabled}
            onClick={onFavorite}
          >
            {liked ? <IconHeartFilled size={16} /> : <IconHeart size={16} />}
          </ActionIcon>
        </Tooltip>
      </div>
      {!readonly && availableTags.length > 0 && (
        <div className="ml-card-menu">
          <Menu
            position="bottom-end"
            withinPortal
            shadow="md"
            width={270}
            opened={menuOpen}
            onChange={setMenuOpen}
          >
            <Menu.Target>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="gray"
                aria-label={m('编辑标签 · {name}', { name: file.name })}
              >
                <IconTags size={17} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown className="ml-tag-submenu">
              <MediaTagMenu
                tags={availableTags}
                selectedTags={tags}
                getColor={tagColor}
                onSelect={onToggleTag}
                onEdit={onEditTags}
              />
            </Menu.Dropdown>
          </Menu>
        </div>
      )}
      <div className="ml-card-caption">
        <Text size="xs" className="ml-card-name" lineClamp={2} title={file.name}>
          {fileDisplayName(file.name)}
        </Text>
        {customTags.length > 0 && (
          <Group gap={4} className="ml-card-tags">
            {customTags.slice(0, 2).map((tag) => (
              <Badge
                key={tag.id}
                variant="light"
                size="xs"
                style={{ '--ml-tag-color': tagColor(tag) } as CSSProperties}
              >
                {m(tagLabel(tag))}
              </Badge>
            ))}
            {customTags.length > 2 && (
              <Badge color="gray" variant="outline" size="xs">
                +{customTags.length - 2}
              </Badge>
            )}
          </Group>
        )}
      </div>
    </article>
  )
}
