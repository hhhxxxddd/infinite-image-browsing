import { useNotice } from '../../shared/notices'
import { PageFrame } from '../../shared/PageFrame'
import { isFavoriteTag } from '../../../src/features/media-library/model/favoriteTag'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Group, Modal, SegmentedControl, Skeleton } from '@mantine/core'
import { useCallbackRef } from '@mantine/hooks'
import {
  IconArrowsShuffle,
  IconChevronLeft,
  IconHeadphones,
  IconPhoto,
  IconVideo
} from '@tabler/icons-react'
import { apiFetch } from '../../shared/apiClient'
import {
  getLibraryInfo,
  getMediaTags,
  getReadOnlyMode,
  getSelectedCustomTags,
  mediaKind,
  setMediaCustomTags,
  toggleMediaTag,
  type MediaFile,
  type MediaTag
} from '../media/mediaApi'
import { MediaPreview } from '../media/MediaPreview'
import { MasonryGallery } from '../media/MasonryGallery'
import { mediaCardWidth } from '../media/masonryModel'
import { MediaGalleryViewOptions } from '../media/MediaGalleryViewOptions'
import { MediaTagPicker } from '../media/MediaTagPicker'
import { browsePreferencesEvent, readBrowsePreferences } from '../settings/browsePreferences'
import { DiscoveryMediaCard } from './DiscoveryMediaCard'
import { useMediaText } from '../media/mediaLocale'
import '../media/mediaLibrary.css'
import '../media/mediaGallery.css'
import './discovery.css'

type MediaType = 'all' | 'image' | 'video' | 'audio'
const filters: { value: MediaType; label: string }[] = [
  { value: 'all', label: '全部媒体' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' }
]

export default function DiscoveryPage() {
  const m = useMediaText()
  const text = useCallbackRef(m)
  const [activeType, setActiveType] = useState<MediaType>('all')
  const [batches, setBatches] = useState<MediaFile[][]>([])
  const [batchIndex, setBatchIndex] = useState(-1)
  const [batchOffset, setBatchOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const setNotice = useNotice('blue')
  const [tags, setTags] = useState<Record<string, MediaTag[]>>({})
  const [availableTags, setAvailableTags] = useState<MediaTag[]>([])
  const [likeTagId, setLikeTagId] = useState<number | null>(null)
  const [readonly, setReadonly] = useState(true)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [savingLike, setSavingLike] = useState<string | null>(null)
  const [tagEditing, setTagEditing] = useState<MediaFile | null>(null)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [tagBusy, setTagBusy] = useState(false)
  const [browsePreferences, setBrowsePreferences] = useState(readBrowsePreferences)
  const [cardSize, setCardSize] = useState<'small' | 'medium' | 'large'>(() => {
    try {
      const saved = localStorage.getItem('iib-react-card-size')
      return saved === 'medium' || saved === 'large' ? saved : 'small'
    } catch {
      return 'small'
    }
  })
  const [showInformation, setShowInformation] = useState(() => {
    try {
      return localStorage.getItem('omnigallery-react-media-information') === 'true'
    } catch {
      return false
    }
  })
  const seenRef = useRef(new Set<string>())
  const historyRef = useRef<MediaFile[][]>([])
  const indexRef = useRef(-1)
  const offsetRef = useRef(0)
  const loadingRef = useRef(false)
  const requestVersion = useRef(0)
  const batchGeneration = useRef(0)
  const tagEditorVersion = useRef(0)
  const tagSavingRef = useRef(false)

  const files = batches[batchIndex] || []
  const cardMinWidth = mediaCardWidth(browsePreferences.smallThumbnailWidth, cardSize)
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
      const generation = batchGeneration.current
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
          if (picked.length) setNotice(text('这一类已经看完，已重新开始挑选。'))
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
          seenRef.current = new Set([...seenRef.current].slice(-256))
          const retainedPaths = new Set(next.flat().map((file) => file.fullpath))
          setTags((current) =>
            Object.fromEntries(Object.entries(current).filter(([path]) => retainedPaths.has(path)))
          )
          void getMediaTags(picked.map((file) => file.fullpath))
            .then((value) => {
              if (generation !== batchGeneration.current) return
              const retained = new Set(historyRef.current.flat().map((file) => file.fullpath))
              setTags((current) => ({
                ...Object.fromEntries(
                  Object.entries(value).filter(
                    ([path]) => retained.has(path) && current[path] === undefined
                  )
                ),
                ...current
              }))
            })
            .catch(() => {})
        }
      } catch (cause) {
        if (version === requestVersion.current)
          setLoadError(cause instanceof Error ? cause.message : text('换一批失败，请重试'))
      } finally {
        if (version === requestVersion.current) {
          loadingRef.current = false
          setLoading(false)
        }
      }
    },
    [text, setNotice]
  )

  useEffect(() => {
    const refreshPreferences = () => setBrowsePreferences(readBrowsePreferences())
    window.addEventListener(browsePreferencesEvent, refreshPreferences)
    window.addEventListener('storage', refreshPreferences)
    return () => {
      window.removeEventListener(browsePreferencesEvent, refreshPreferences)
      window.removeEventListener('storage', refreshPreferences)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('iib-react-card-size', cardSize)
      localStorage.setItem('omnigallery-react-media-information', String(showInformation))
    } catch {
      /* Keep browsing usable when preferences cannot be saved. */
    }
  }, [cardSize, showInformation])

  useEffect(() => {
    let active = true
    void Promise.all([getLibraryInfo(), getReadOnlyMode()])
      .then(([info, readOnly]) => {
        if (!active) return
        const like = info.tags.find(isFavoriteTag)
        setLikeTagId(typeof like?.id === 'number' ? like.id : null)
        setAvailableTags(info.tags.filter((tag) => tag.type === 'custom'))
        setReadonly(readOnly)
      })
      .catch(() => {})
    void fetchBatch('all')
    return () => {
      active = false
      requestVersion.current++
      batchGeneration.current++
      tagEditorVersion.current++
      loadingRef.current = false
    }
  }, [fetchBatch])

  function chooseType(value: MediaType) {
    if (value === activeType) return
    requestVersion.current++
    batchGeneration.current++
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
    const favorite = availableTags.find(isFavoriteTag)
    if (readonly || likeTagId === null || savingLike || !favorite) return
    setSavingLike(file.fullpath)
    try {
      const result = await toggleMediaTag(file.fullpath, likeTagId)
      setTags((current) => {
        const existing = current[file.fullpath] || []
        const next = result.is_remove
          ? existing.filter((tag) => tag.id !== likeTagId)
          : [...existing.filter((tag) => tag.id !== likeTagId), favorite]
        return { ...current, [file.fullpath]: next }
      })
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : m('收藏更新失败'), { kind: 'error' })
    } finally {
      setSavingLike(null)
    }
  }

  async function refreshTags(path: string) {
    const value = await getMediaTags([path])
    setTags((current) => ({ ...current, ...value }))
  }

  async function openTagEditor(file: MediaFile) {
    const version = ++tagEditorVersion.current
    setTagEditing(file)
    setTagIds([])
    setTagBusy(true)
    try {
      const selected = await getSelectedCustomTags(file.fullpath)
      if (version !== tagEditorVersion.current) return
      const ids = selected.map((tag) => String(tag.id))
      setTagIds(ids)
    } catch (cause) {
      if (version !== tagEditorVersion.current) return
      setTagEditing(null)
      setNotice(cause instanceof Error ? cause.message : m('标签读取失败'), { kind: 'error' })
    } finally {
      if (version === tagEditorVersion.current) setTagBusy(false)
    }
  }

  async function saveTagEditor() {
    if (!tagEditing || tagBusy) return
    tagSavingRef.current = true
    setTagBusy(true)
    try {
      const next = await setMediaCustomTags(tagEditing, tagIds, availableTags)
      setTags((current) => ({ ...current, [tagEditing.fullpath]: next }))
      setTagEditing(null)
      setNotice(m('标签已更新'))
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : m('标签更新失败'), { kind: 'error' })
    } finally {
      tagSavingRef.current = false
      setTagBusy(false)
    }
  }

  async function toggleTag(file: MediaFile, tag: MediaTag) {
    if (readonly) return
    try {
      await toggleMediaTag(file.fullpath, Number(tag.id))
      await refreshTags(file.fullpath)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : m('标签更新失败'), { kind: 'error' })
    }
  }

  function closeTagEditor() {
    if (tagSavingRef.current) return
    tagEditorVersion.current++
    setTagEditing(null)
    setTagBusy(false)
  }

  return (
    <PageFrame
      className="discovery-frame"
      scrollKey={`${activeType}:${batchOffset}:${batchIndex}`}
      header={
        <div className="discovery-heading">
          <SegmentedControl
            value={activeType}
            onChange={(value) => chooseType(value as MediaType)}
            data={filters.map((filter) => ({ ...filter, label: m(filter.label) }))}
            aria-label={m('挑选媒体类型')}
          />
          <Group gap="xs" className="discovery-actions">
            <Button
              variant="subtle"
              color="gray"
              leftSection={<IconChevronLeft size={16} />}
              onClick={previousBatch}
              disabled={batchIndex <= 0 || loading}
            >
              {m('上一批')}
            </Button>
            <Button
              leftSection={<IconArrowsShuffle size={17} />}
              loading={loading}
              onClick={nextBatch}
            >
              {m('换一批')}
            </Button>
          </Group>
        </div>
      }
    >
      <div className="omni-content-inner ml-gallery-page discovery-page">
        <div className="discovery-toolbar">
          {files.length > 0 && (
            <div className="discovery-batch-info" aria-live="polite">
              <span className="discovery-batch-number">
                {m('第 {batch} 批 · {count} 项', {
                  batch: batchOffset + batchIndex + 1,
                  count: files.length
                })}
              </span>
              {activeType === 'all' && (
                <span className="discovery-type-counts">
                  <span title={m('图片')}>
                    <IconPhoto size={14} />
                    {counts.image}
                  </span>
                  <span title={m('视频')}>
                    <IconVideo size={14} />
                    {counts.video}
                  </span>
                  <span title={m('音频')}>
                    <IconHeadphones size={14} />
                    {counts.audio}
                  </span>
                </span>
              )}
            </div>
          )}
          <div className="ml-view-actions">
            <MediaGalleryViewOptions
              cardSize={cardSize}
              onCardSize={(value) => setCardSize(value as typeof cardSize)}
              showInformation={showInformation}
              onToggleInformation={() => setShowInformation((value) => !value)}
            />
          </div>
        </div>
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
              cardMinWidth={cardMinWidth}
              renderItem={(file, index) => (
                <DiscoveryMediaCard
                  key={file.fullpath}
                  file={file}
                  tags={tags[file.fullpath] || []}
                  availableTags={availableTags}
                  showInformation={showInformation}
                  thumbnailsEnabled={browsePreferences.enableThumbnail}
                  thumbnailSize={browsePreferences.gridThumbnailResolution}
                  readonly={readonly}
                  favoriteDisabled={readonly || likeTagId === null || savingLike === file.fullpath}
                  onPreview={() => setPreviewIndex(index)}
                  onFavorite={() => void toggleLike(file)}
                  onEditTags={() => void openTagEditor(file)}
                  onToggleTag={(tag) =>
                    void toggleTag(file, tag).catch((cause) =>
                      setNotice(cause instanceof Error ? cause.message : m('标签更新失败'), {
                        kind: 'error'
                      })
                    )
                  }
                />
              )}
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
        />
        <Modal
          opened={tagEditing !== null}
          onClose={closeTagEditor}
          title={tagEditing ? m('编辑标签 · {name}', { name: tagEditing.name }) : m('编辑标签')}
          centered
        >
          <MediaTagPicker
            label={m('自定义标签')}
            tags={availableTags}
            value={tagIds}
            onChange={setTagIds}
            disabled={tagBusy || readonly}
          />
          <Group justify="flex-end" mt="lg">
            <Button variant="default" onClick={closeTagEditor}>
              {m('取消')}
            </Button>
            <Button onClick={() => void saveTagEditor()} loading={tagBusy} disabled={readonly}>
              {m('保存')}
            </Button>
          </Group>
        </Modal>
      </div>
    </PageFrame>
  )
}
