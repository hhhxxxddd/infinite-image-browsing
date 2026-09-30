import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  MultiSelect,
  SegmentedControl,
  Skeleton,
  Text,
  Tooltip
} from '@mantine/core'
import {
  IconHeart,
  IconHeartFilled,
  IconHeadphones,
  IconPhoto,
  IconPlayerPlay,
  IconRefresh,
  IconSparkles,
  IconTags,
  IconVideo
} from '@tabler/icons-react'
import { apiFetch } from '../../shared/apiClient'
import { fileDisplayName } from '../../../src/shared/lib/fileDisplayName'
import {
  audioCoverUrl,
  getLibraryInfo,
  getMediaTags,
  getReadOnlyMode,
  getSelectedCustomTags,
  mediaKind,
  thumbnailUrl,
  toggleMediaTag,
  videoCoverUrl,
  type MediaFile,
  type MediaTag
} from '../media/mediaApi'
import { MediaPreview } from '../media/MediaPreview'
import { MasonryGallery } from '../media/MasonryGallery'
import { mediaCardRatio } from '../media/masonryModel'
import { useMediaText } from '../media/mediaLocale'
import '../media/mediaLibrary.css'
import './discovery.css'

type MediaType = 'all' | 'image' | 'video' | 'audio'
const filters: { value: MediaType; label: string }[] = [
  { value: 'all', label: '全部媒体' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' }
]

function kindLabel(file: MediaFile) {
  const kind = mediaKind(file)
  return kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文件'
}

function MediaArtwork({ file }: { file: MediaFile }) {
  const [failed, setFailed] = useState(false)
  const kind = mediaKind(file)
  const src =
    kind === 'image'
      ? thumbnailUrl(file, 512)
      : kind === 'video'
        ? videoCoverUrl(file)
        : kind === 'audio'
          ? audioCoverUrl(file)
          : ''
  const Icon = kind === 'audio' ? IconHeadphones : kind === 'video' ? IconVideo : IconPhoto
  return (
    <span className={`discovery-art discovery-art-${kind}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <Icon size={38} stroke={1.25} />
      )}
    </span>
  )
}

export default function DiscoveryPage() {
  const m = useMediaText()
  const [activeType, setActiveType] = useState<MediaType>('all')
  const [batches, setBatches] = useState<MediaFile[][]>([])
  const [batchIndex, setBatchIndex] = useState(-1)
  const [batchOffset, setBatchOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [tags, setTags] = useState<Record<string, MediaTag[]>>({})
  const [availableTags, setAvailableTags] = useState<MediaTag[]>([])
  const [likeTagId, setLikeTagId] = useState<number | null>(null)
  const [readonly, setReadonly] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [savingLike, setSavingLike] = useState<string | null>(null)
  const [tagEditing, setTagEditing] = useState<MediaFile | null>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [initialTagIds, setInitialTagIds] = useState<string[]>([])
  const [tagBusy, setTagBusy] = useState(false)
  const seenRef = useRef(new Set<string>())
  const historyRef = useRef<MediaFile[][]>([])
  const indexRef = useRef(-1)
  const offsetRef = useRef(0)
  const loadingRef = useRef(false)
  const requestVersion = useRef(0)

  const files = batches[batchIndex] || []
  const counts = useMemo(
    () =>
      files.reduce(
        (result, file) => {
          const kind = mediaKind(file)
          if (kind === 'image' || kind === 'video' || kind === 'audio') result[kind]++
          return result
        },
        { image: 0, video: 0, audio: 0 }
      ),
    [files]
  )

  const fetchBatch = useCallback(
    async (type: MediaType) => {
      if (loadingRef.current) return
      loadingRef.current = true
      setLoading(true)
      setLoadError('')
      setNotice('')
      const version = ++requestVersion.current
      try {
        const pick = (excludePaths: string[]) =>
          apiFetch<MediaFile[]>('/pick_media', {
            method: 'POST',
            body: JSON.stringify({ media_type: type, exclude_paths: excludePaths, limit: 24 })
          })
        let picked = await pick([...seenRef.current].slice(-256))
        if (version !== requestVersion.current) return
        if (!picked.length && seenRef.current.size) {
          seenRef.current.clear()
          picked = await pick([])
          if (version !== requestVersion.current) return
          if (picked.length) setNotice(m('这一类已经看完，已重新开始挑选。'))
        }
        if (picked.length) {
          const next = [...historyRef.current, picked]
          if (next.length > 20) {
            next.shift()
            offsetRef.current++
          }
          historyRef.current = next
          indexRef.current = next.length - 1
          setBatches(next)
          setBatchIndex(indexRef.current)
          setBatchOffset(offsetRef.current)
          picked.forEach((file) => seenRef.current.add(file.fullpath))
          void getMediaTags(picked.map((file) => file.fullpath))
            .then((value) => {
              if (version === requestVersion.current)
                setTags((current) => ({ ...current, ...value }))
            })
            .catch(() => {})
        }
      } catch (cause) {
        if (version === requestVersion.current)
          setLoadError(cause instanceof Error ? cause.message : m('换一批失败，请重试'))
      } finally {
        if (version === requestVersion.current) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    },
    [m]
  )

  useEffect(() => {
    void Promise.all([getLibraryInfo(), getReadOnlyMode()])
      .then(([info, readOnly]) => {
        const like = info.tags.find((tag) => tag.type === 'custom' && tag.name === 'like')
        setLikeTagId(typeof like?.id === 'number' ? like.id : null)
        setAvailableTags(info.tags.filter((tag) => tag.type === 'custom'))
        setReadonly(readOnly)
      })
      .catch(() => {})
    void fetchBatch('all')
    return () => {
      requestVersion.current++
      loadingRef.current = false
    }
  }, [fetchBatch])

  function chooseType(value: MediaType) {
    if (value === activeType) return
    requestVersion.current++
    loadingRef.current = false
    historyRef.current = []
    indexRef.current = -1
    offsetRef.current = 0
    seenRef.current.clear()
    setActiveType(value)
    setBatches([])
    setBatchIndex(-1)
    setBatchOffset(0)
    setPreviewIndex(null)
    void fetchBatch(value)
  }

  function nextBatch() {
    if (loading) return
    if (indexRef.current < historyRef.current.length - 1) {
      indexRef.current++
      setBatchIndex(indexRef.current)
      return
    }
    void fetchBatch(activeType)
  }

  function previousBatch() {
    if (loading || indexRef.current <= 0) return
    indexRef.current--
    setBatchIndex(indexRef.current)
  }

  async function toggleLike(file: MediaFile) {
    if (readonly || likeTagId === null || savingLike) return
    setSavingLike(file.fullpath)
    try {
      const result = await toggleMediaTag(file.fullpath, likeTagId)
      setTags((current) => {
        const existing = current[file.fullpath] || []
        const next = result.is_remove
          ? existing.filter((tag) => tag.id !== likeTagId)
          : [
              ...existing.filter((tag) => tag.id !== likeTagId),
              {
                id: likeTagId,
                name: 'like',
                display_name: m('收藏'),
                type: 'custom',
                color: '#ed6b8b',
                group_name: '',
                count: 0
              }
            ]
        return { ...current, [file.fullpath]: next }
      })
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : m('收藏更新失败'))
    } finally {
      setSavingLike(null)
    }
  }

  async function refreshTags(path: string) {
    const value = await getMediaTags([path])
    setTags((current) => ({ ...current, ...value }))
  }

  async function openTagEditor(file: MediaFile) {
    setTagEditing(file)
    setTagBusy(true)
    try {
      const selected = await getSelectedCustomTags(file.fullpath)
      const ids = selected.map((tag) => String(tag.id))
      setTagIds(ids)
      setInitialTagIds(ids)
    } catch (cause) {
      setTagEditing(null)
      setNotice(cause instanceof Error ? cause.message : m('标签读取失败'))
    } finally {
      setTagBusy(false)
    }
  }

  async function saveTagEditor() {
    if (!tagEditing) return
    setTagBusy(true)
    try {
      for (const id of new Set([...initialTagIds, ...tagIds])) {
        if (initialTagIds.includes(id) !== tagIds.includes(id))
          await toggleMediaTag(tagEditing.fullpath, Number(id))
      }
      await refreshTags(tagEditing.fullpath)
      setTagEditing(null)
      setNotice(m('标签已更新'))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : m('标签更新失败'))
    } finally {
      setTagBusy(false)
    }
  }

  async function applyTag(file: MediaFile, tag: MediaTag) {
    if (readonly || (tags[file.fullpath] || []).some((entry) => entry.id === tag.id)) return
    await toggleMediaTag(file.fullpath, Number(tag.id))
    await refreshTags(file.fullpath)
  }

  return (
    <div className="omni-content-inner discovery-page">
      <div className="discovery-heading">
        <div className="discovery-title-block">
          <span className="discovery-title-mark">
            <IconSparkles size={23} stroke={1.7} />
          </span>
          <div>
            <h2 className="omni-page-title">{m('挑一挑')}</h2>
            <p className="omni-page-description">
              {m('从媒体库里随机遇见喜欢的内容，点开细看，顺手收藏。')}
            </p>
          </div>
        </div>
        <Group gap="xs" className="discovery-actions">
          <Button variant="default" onClick={previousBatch} disabled={batchIndex <= 0 || loading}>
            {m('上一批')}
          </Button>
          <Button leftSection={<IconRefresh size={16} />} loading={loading} onClick={nextBatch}>
            {m('换一批')}
          </Button>
          <Button variant="light" onClick={() => setPreviewIndex(0)} disabled={!files.length}>
            {m('逐项查看')}
          </Button>
        </Group>
      </div>

      <div className="discovery-toolbar">
        <SegmentedControl
          value={activeType}
          onChange={(value) => chooseType(value as MediaType)}
          data={filters.map((filter) => ({ ...filter, label: m(filter.label) }))}
          aria-label={m('挑选媒体类型')}
        />
        {files.length > 0 && (
          <Text size="xs" c="dimmed">
            {m('第 {batch} 批 · {count} 项', {
              batch: batchOffset + batchIndex + 1,
              count: files.length
            })}
            {activeType === 'all' &&
              ` · ${counts.image} ${m('图片')} / ${counts.video} ${m('视频')} / ${counts.audio} ${m('音频')}`}
          </Text>
        )}
      </div>
      {notice && (
        <Alert color="blue" variant="light" mb="md" onClose={() => setNotice('')} withCloseButton>
          {notice}
        </Alert>
      )}
      {loadError && (
        <Alert color="red" variant="light" mb="md" title={m('读取媒体失败')}>
          {loadError}{' '}
          <Button variant="subtle" size="xs" onClick={nextBatch}>
            {m('重试')}
          </Button>
        </Alert>
      )}

      {loading && !files.length ? (
        <div className="discovery-grid" aria-label={m('正在挑选媒体')}>
          {Array.from({ length: 12 }, (_, index) => (
            <Skeleton key={index} height={235} radius="lg" />
          ))}
        </div>
      ) : !files.length ? (
        <div className="omni-panel omni-empty discovery-empty">
          <IconPhoto size={42} stroke={1.25} />
          <strong>{m('还没有可挑选的媒体')}</strong>
          <span>{m('请先在媒体库中添加目录并扫描。')}</span>
        </div>
      ) : (
        <div className={'discovery-results' + (loading ? ' is-loading' : '')}>
          <MasonryGallery
            items={files}
            cardMinWidth={210}
            renderItem={(file, index) => {
              const liked = (tags[file.fullpath] || []).some((tag) => tag.name === 'like')
              const shownTags = (tags[file.fullpath] || [])
                .filter((tag) => tag.type === 'custom')
                .slice(0, 2)
              const kind = mediaKind(file)
              return (
                <article className="ml-card discovery-card" key={file.fullpath}>
                  <button
                    type="button"
                    className="ml-card-visual discovery-card-main"
                    style={{ aspectRatio: String(mediaCardRatio(file)) }}
                    onClick={() => setPreviewIndex(index)}
                    aria-label={m('预览：{name}', { name: file.name })}
                  >
                    <MediaArtwork file={file} />
                    {(kind === 'video' || kind === 'audio') && (
                      <span className="ml-play-indicator">
                        <IconPlayerPlay size={21} />
                      </span>
                    )}
                    <span className="ml-card-caption discovery-caption">
                      <span className="ml-card-kind">{m(kindLabel(file))}</span>
                      {shownTags.length > 0 && (
                        <Group gap={4} className="ml-card-tags">
                          {shownTags.map((tag) => (
                            <Badge
                              key={tag.id}
                              size="xs"
                              variant="filled"
                              style={{ backgroundColor: tag.color || '#405369', color: '#fff' }}
                            >
                              {tag.display_name || tag.name}
                            </Badge>
                          ))}
                          {(tags[file.fullpath] || []).filter((tag) => tag.type === 'custom')
                            .length > 2 && (
                            <Badge size="xs" color="gray" variant="filled">
                              +
                              {(tags[file.fullpath] || []).filter((tag) => tag.type === 'custom')
                                .length - 2}
                            </Badge>
                          )}
                        </Group>
                      )}
                      <span className="ml-card-name discovery-card-name" title={file.name}>
                        {fileDisplayName(file.name)}
                      </span>
                    </span>
                  </button>
                  <Tooltip label={m(liked ? '取消收藏' : '收藏')}>
                    <ActionIcon
                      className={'discovery-like' + (liked ? ' is-liked' : '')}
                      size="sm"
                      variant="filled"
                      color={liked ? 'pink' : 'dark'}
                      aria-label={m(liked ? '取消收藏：{name}' : '收藏：{name}', {
                        name: file.name
                      })}
                      disabled={readonly || likeTagId === null || savingLike === file.fullpath}
                      onClick={() => void toggleLike(file)}
                    >
                      {liked ? <IconHeartFilled size={16} /> : <IconHeart size={16} stroke={1.8} />}
                    </ActionIcon>
                  </Tooltip>
                  {!readonly && availableTags.length > 0 && (
                    <Menu position="bottom-end" withinPortal>
                      <Menu.Target>
                        <ActionIcon
                          className="discovery-tag-action"
                          size="sm"
                          variant="filled"
                          color="dark"
                          aria-label={m('编辑标签 · {name}', { name: file.name })}
                        >
                          <IconTags size={16} stroke={1.8} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => void openTagEditor(file)}>
                          {m('编辑标签')}…
                        </Menu.Item>
                        {availableTags.map((tag) => (
                          <Menu.Item
                            key={tag.id}
                            disabled={(tags[file.fullpath] || []).some(
                              (entry) => entry.id === tag.id
                            )}
                            onClick={() =>
                              void applyTag(file, tag).catch((cause) =>
                                setNotice(
                                  cause instanceof Error ? cause.message : m('标签更新失败')
                                )
                              )
                            }
                          >
                            {tag.display_name || tag.name}
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </article>
              )
            }}
          />
        </div>
      )}

      <MediaPreview
        files={files}
        index={previewIndex}
        onClose={() => setPreviewIndex(null)}
        onIndexChange={setPreviewIndex}
        readonly={readonly}
        availableTags={availableTags}
        initialTags={previewIndex === null ? undefined : tags[files[previewIndex]?.fullpath]}
        onTagsUpdated={(path, next) => setTags((current) => ({ ...current, [path]: next }))}
        onAudioUpdated={(file, metadata) => {
          const updated = historyRef.current.map((batch) =>
            batch.map((item) =>
              item.fullpath === file.fullpath ? { ...item, date: metadata.modified_date } : item
            )
          )
          historyRef.current = updated
          setBatches(updated)
        }}
        footerActions={(file) => {
          const liked = (tags[file.fullpath] || []).some((tag) => tag.name === 'like')
          return (
            <Button
              size="xs"
              variant="light"
              color={liked ? 'pink' : 'blue'}
              leftSection={liked ? <IconHeartFilled size={16} /> : <IconHeart size={16} />}
              disabled={readonly || likeTagId === null}
              onClick={() => {
                void toggleLike(file)
              }}
            >
              {m(liked ? '已收藏' : '收藏')}
            </Button>
          )
        }}
      />
      <Modal
        opened={tagEditing !== null}
        onClose={() => setTagEditing(null)}
        title={tagEditing ? m('编辑标签 · {name}', { name: tagEditing.name }) : m('编辑标签')}
        centered
      >
        <MultiSelect
          label={m('自定义标签')}
          data={availableTags.map((tag) => ({
            value: String(tag.id),
            label: tag.display_name || tag.name
          }))}
          value={tagIds}
          onChange={setTagIds}
          searchable
          disabled={tagBusy || readonly}
        />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setTagEditing(null)}>
            {m('取消')}
          </Button>
          <Button onClick={() => void saveTagEditor()} loading={tagBusy} disabled={readonly}>
            {m('保存')}
          </Button>
        </Group>
      </Modal>
    </div>
  )
}
