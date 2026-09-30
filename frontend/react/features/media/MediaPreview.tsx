import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent
} from 'react'
import { flushSync } from 'react-dom'
import { isTauri } from '@tauri-apps/api/core'
import { ActionIcon, Alert, Button, Group, Modal, MultiSelect, Stack, Text } from '@mantine/core'
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconExternalLink,
  IconFile,
  IconHeart,
  IconHeartFilled,
  IconInfoCircle,
  IconMessageCircle,
  IconMusic,
  IconPencil,
  IconRotateClockwise,
  IconTrash,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset
} from '@tabler/icons-react'
import { fileDisplayName } from '../../../src/shared/lib/fileDisplayName'
import {
  audioCoverUrl,
  getArtifactMetadata,
  getAudioMetadata,
  getLibraryInfo,
  getMediaTags,
  getMediaDescription,
  getReadOnlyMode,
  getSelectedCustomTags,
  isAnimatedMedia,
  isEditableOriginalImage,
  mediaKind,
  openWithAppPicker,
  rawMediaUrl,
  streamMediaUrl,
  toggleArtifactTag,
  toggleMediaTag,
  videoCoverUrl,
  type AudioMetadata,
  type MediaFile,
  type MediaTag
} from './mediaApi'
import { MediaDetailsPanel } from './MediaDetailsPanel'
import { useMediaText } from './mediaLocale'
import { nextIndexAfterPage } from './previewPagination'
import { previewSwipeDirection } from './previewGesture'
import './mediaLibrary.css'

export interface MediaPreviewProps {
  files: MediaFile[]
  index: number | null
  onClose: () => void
  onIndexChange?: (index: number) => void
  hasMore?: boolean
  loadingMore?: boolean
  onLoadMore?: () => Promise<void>
  readonly?: boolean
  availableTags?: MediaTag[]
  initialTags?: MediaTag[]
  onTagsUpdated?: (path: string, tags: MediaTag[]) => void
  onAudioUpdated?: (file: MediaFile, metadata: AudioMetadata) => void
  onCreateDraft?: (file: MediaFile) => void
  onDownload?: (file: MediaFile) => void
  onEditMedia?: (path: string) => void
  onDelete?: (file: MediaFile) => void
  footerActions?: (file: MediaFile) => ReactNode
}

function errorText(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败，请重试'
}

export function MediaPreview({
  files,
  index,
  onClose,
  onIndexChange,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  readonly: readonlyProp,
  availableTags: availableTagsProp,
  initialTags,
  onTagsUpdated,
  onAudioUpdated,
  onCreateDraft,
  onDownload,
  onEditMedia,
  onDelete,
  footerActions
}: MediaPreviewProps) {
  const m = useMediaText()
  const file = index === null ? null : files[index] || null
  const [readOnly, setReadOnly] = useState(readonlyProp ?? true)
  const [availableTags, setAvailableTags] = useState(availableTagsProp || [])
  const [tags, setTags] = useState(initialTags || [])
  const [tagEditorOpen, setTagEditorOpen] = useState(false)
  const [tagIds, setTagIds] = useState<string[]>([])
  const [originalTagIds, setOriginalTagIds] = useState<string[]>([])
  const [tagBusy, setTagBusy] = useState(false)
  const [error, setError] = useState('')
  const [fetchingNext, setFetchingNext] = useState(false)
  const [audioSuspended, setAudioSuspended] = useState(false)
  const [audioAutoPlay, setAudioAutoPlay] = useState(true)
  const [audioRevision, setAudioRevision] = useState('')
  const [audioDetails, setAudioDetails] = useState<AudioMetadata | null>(null)
  const [currentAudioTime, setCurrentAudioTime] = useState(0)
  const [coverBroken, setCoverBroken] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const [favoriteBusy, setFavoriteBusy] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [description, setDescription] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioResumeRef = useRef<{ path: string; time: number; playing: boolean } | null>(null)
  const activeFilePathRef = useRef(file?.fullpath)
  activeFilePathRef.current = file?.fullpath
  const stageRef = useRef<HTMLDivElement>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const lyricsRef = useRef<HTMLDivElement>(null)
  const panStartRef = useRef({ x: 0, y: 0, px: 0, py: 0 })
  const lastWheelNavigationRef = useRef(0)
  const pendingNextRef = useRef<{ path: string; length: number } | null>(null)
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)

  const goPrevious = useCallback(() => {
    if (index === null || index <= 0 || !onIndexChange) return
    pendingNextRef.current = null
    onIndexChange(index - 1)
  }, [index, onIndexChange])

  const goNext = useCallback(() => {
    if (!file || index === null || !onIndexChange) return
    if (index < files.length - 1) {
      pendingNextRef.current = null
      onIndexChange(index + 1)
      return
    }
    if (loadingMore || fetchingNext) return
    if (!hasMore || !onLoadMore) return
    pendingNextRef.current = { path: file.fullpath, length: files.length }
    setFetchingNext(true)
    void Promise.resolve()
      .then(onLoadMore)
      .catch((cause) => {
        pendingNextRef.current = null
        setError(errorText(cause))
      })
      .finally(() => setFetchingNext(false))
  }, [file, index, files.length, onIndexChange, loadingMore, fetchingNext, hasMore, onLoadMore])

  const onStageTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (
      zoom > 1 ||
      event.touches.length !== 1 ||
      (event.target instanceof Element &&
        event.target.closest(
          'button, input, textarea, video, audio, .ml-preview-lyrics, .ml-preview-controls, .ml-preview-description'
        ))
    ) {
      swipeStartRef.current = null
      return
    }
    swipeStartRef.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }
  }
  const onStageTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) swipeStartRef.current = null
  }
  const onStageTouchEnd = (event: ReactTouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current
    swipeStartRef.current = null
    if (!start || zoom > 1 || !event.changedTouches.length) return
    const touch = event.changedTouches[0]
    const direction = previewSwipeDirection(
      start,
      { x: touch.clientX, y: touch.clientY },
      window.innerHeight
    )
    if (direction === 'next') goNext()
    else if (direction === 'previous') goPrevious()
  }

  useEffect(() => {
    const pending = pendingNextRef.current
    if (!pending || !onIndexChange) return
    if (files.length > pending.length) {
      const next = nextIndexAfterPage(files, pending.path)
      if (next !== null) {
        pendingNextRef.current = null
        onIndexChange(next)
        return
      }
    } else if (file?.fullpath !== pending.path) {
      pendingNextRef.current = null
      return
    }
    if (!hasMore && !loadingMore && !fetchingNext) pendingNextRef.current = null
  }, [files, file?.fullpath, hasMore, loadingMore, fetchingNext, onIndexChange])

  useEffect(() => setReadOnly(readonlyProp ?? true), [readonlyProp])
  useEffect(() => setAvailableTags(availableTagsProp || []), [availableTagsProp])
  useEffect(() => setTags(initialTags || []), [initialTags, file?.fullpath])
  useEffect(() => {
    audioResumeRef.current = null
    setAudioSuspended(false)
    setAudioAutoPlay(true)
    setCoverBroken(false)
    setAudioRevision('')
    setAudioDetails(null)
    setCurrentAudioTime(0)
    setPreviewError('')
    setZoom(1)
    setRotation(0)
    setPan({ x: 0, y: 0 })
    setPanning(false)
    setImageSize({ width: 0, height: 0 })
    setTagEditorOpen(false)
    setDescriptionOpen(false)
    setDescription('')
    setError('')
  }, [file?.fullpath])
  useEffect(() => {
    if (!file || !descriptionOpen || file.cloud_only) return
    let active = true
    const request = file.workspace_artifact_id
      ? getArtifactMetadata(file.workspace_artifact_id).then((result) => result.description)
      : getMediaDescription(file.fullpath)
    void request
      .then((result) => {
        if (active) setDescription(result)
      })
      .catch((cause) => {
        if (active) setError(errorText(cause))
      })
    return () => {
      active = false
    }
  }, [file?.fullpath, file?.workspace_artifact_id, file?.cloud_only, descriptionOpen])
  useEffect(() => {
    if (!file || mediaKind(file) !== 'audio' || file.workspace_artifact_id || file.cloud_only)
      return
    let active = true
    void getAudioMetadata(file.fullpath)
      .then((details) => {
        if (active) setAudioDetails(details)
      })
      .catch((cause) => {
        if (active) setError(errorText(cause))
      })
    return () => {
      active = false
    }
  }, [file?.fullpath, file?.workspace_artifact_id, file?.cloud_only, audioRevision])
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !file) return
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [file?.fullpath])
  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(document.fullscreenElement === layoutRef.current)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])
  useEffect(() => {
    if (zoom <= 1) setPan({ x: 0, y: 0 })
  }, [zoom])
  const activeLyricIndex = audioDetails?.lyrics?.timed
    ? audioDetails.lyrics.lines.reduce(
        (active, line, lineIndex) =>
          (line.time ?? Infinity) <= currentAudioTime ? lineIndex : active,
        -1
      )
    : -1
  useEffect(() => {
    if (activeLyricIndex < 0 || !lyricsRef.current) return
    const line = lyricsRef.current.querySelector<HTMLElement>(
      `[data-lyric-index="${activeLyricIndex}"]`
    )
    if (!line) return
    lyricsRef.current.scrollTo({
      top: line.offsetTop - lyricsRef.current.offsetTop - lyricsRef.current.clientHeight / 2,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    })
  }, [activeLyricIndex])
  useEffect(() => {
    if (!file) return
    let active = true
    setError('')
    if (readonlyProp === undefined)
      void getReadOnlyMode()
        .then((value) => {
          if (active) setReadOnly(value)
        })
        .catch(() => {})
    if (!availableTagsProp)
      void getLibraryInfo()
        .then((result) => {
          if (active) setAvailableTags(result.tags.filter((tag) => tag.type === 'custom'))
        })
        .catch(() => {})
    if (file.workspace_artifact_id) {
      void Promise.all([
        getArtifactMetadata(file.workspace_artifact_id),
        availableTagsProp
          ? Promise.resolve(availableTagsProp)
          : getLibraryInfo().then((result) => result.tags)
      ])
        .then(([metadata, allTags]) => {
          if (active) setTags(allTags.filter((tag) => metadata.tag_ids.includes(Number(tag.id))))
        })
        .catch(() => {})
    } else {
      void getMediaTags([file.fullpath])
        .then((result) => {
          if (active) setTags(result[file.fullpath] || [])
        })
        .catch(() => {})
    }
    return () => {
      active = false
    }
  }, [file?.fullpath, readonlyProp, availableTagsProp])
  useEffect(() => {
    if (!file) return
    const handleKey = (event: KeyboardEvent) => {
      if (
        tagEditorOpen ||
        (event.target instanceof Element &&
          event.target.closest('input, textarea, select, audio, video, [contenteditable]'))
      )
        return
      const command = event.ctrlKey || event.metaKey
      if (!command && !event.altKey && !event.repeat && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        event.stopImmediatePropagation()
        download()
        return
      }
      if (
        !command &&
        !event.altKey &&
        !event.repeat &&
        event.key.toLowerCase() === 'l' &&
        availableTags.some((tag) => tag.name === 'like')
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        void toggleFavorite()
        return
      }
      if (
        !command &&
        !event.altKey &&
        !event.repeat &&
        event.key === 'Delete' &&
        onDelete &&
        !readOnly
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
        onDelete(file)
        return
      }
      if (command || event.altKey) return
      const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      const next = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      if ((previous || next) && index !== null && onIndexChange) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (previous) goPrevious()
        else goNext()
        return
      }
      if (mediaKind(file) !== 'image') return
      if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(16, value * 1.25))
      else if (event.key === '-') setZoom((value) => Math.max(0.25, value / 1.25))
      else if (event.key === '0') {
        setZoom(1)
        setRotation(0)
        setPan({ x: 0, y: 0 })
      } else if (event.key.toLowerCase() === 'r') {
        setRotation((value) => (value + 90) % 360)
        setPan({ x: 0, y: 0 })
      } else return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [
    file,
    index,
    onIndexChange,
    tagEditorOpen,
    availableTags,
    tags,
    readOnly,
    onDelete,
    onClose,
    onDownload,
    goPrevious,
    goNext
  ])

  const refreshTags = async (target: MediaFile) => {
    let next: MediaTag[]
    if (target.workspace_artifact_id) {
      const metadata = await getArtifactMetadata(target.workspace_artifact_id)
      next = availableTags.filter((tag) => metadata.tag_ids.includes(Number(tag.id)))
    } else {
      const result = await getMediaTags([target.fullpath])
      next = result[target.fullpath] || []
    }
    setTags(next)
    onTagsUpdated?.(target.fullpath, next)
    return next
  }

  const openTagEditor = async () => {
    if (!file || readOnly) return
    setTagBusy(true)
    setError('')
    try {
      const ids = file.workspace_artifact_id
        ? (await getArtifactMetadata(file.workspace_artifact_id)).tag_ids.map(String)
        : (await getSelectedCustomTags(file.fullpath)).map((tag) => String(tag.id))
      setTagIds(ids)
      setOriginalTagIds(ids)
      setTagEditorOpen(true)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setTagBusy(false)
    }
  }

  const saveTags = async () => {
    if (!file || tagBusy) return
    setTagBusy(true)
    setError('')
    try {
      for (const id of new Set([...originalTagIds, ...tagIds])) {
        if (originalTagIds.includes(id) === tagIds.includes(id)) continue
        if (file.workspace_artifact_id)
          await toggleArtifactTag(file.workspace_artifact_id, Number(id))
        else await toggleMediaTag(file.fullpath, Number(id))
      }
      await refreshTags(file)
      setTagEditorOpen(false)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setTagBusy(false)
    }
  }

  const applyTag = async (tag: MediaTag) => {
    if (!file || readOnly || tags.some((current) => Number(current.id) === Number(tag.id))) return
    if (file.workspace_artifact_id)
      await toggleArtifactTag(file.workspace_artifact_id, Number(tag.id))
    else await toggleMediaTag(file.fullpath, Number(tag.id))
    await refreshTags(file)
  }

  const favoriteTag = availableTags.find((tag) => tag.name === 'like')
  const liked = !!favoriteTag && tags.some((tag) => Number(tag.id) === Number(favoriteTag.id))
  const toggleFavorite = async () => {
    if (!file || !favoriteTag || readOnly || favoriteBusy) return
    setFavoriteBusy(true)
    setError('')
    try {
      if (file.workspace_artifact_id)
        await toggleArtifactTag(file.workspace_artifact_id, Number(favoriteTag.id))
      else await toggleMediaTag(file.fullpath, Number(favoriteTag.id))
      await refreshTags(file)
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setFavoriteBusy(false)
    }
  }

  const setImageZoom = (next: number) => {
    const bounded = Math.max(0.25, Math.min(16, next))
    setZoom(bounded)
    if (bounded <= 1) setPan({ x: 0, y: 0 })
  }
  const onImagePointerDown = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (zoom <= 1 || event.button !== 0) return
    event.preventDefault()
    panStartRef.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y }
    setPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onImagePointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (!panning) return
    const start = panStartRef.current
    setPan({ x: start.px + event.clientX - start.x, y: start.py + event.clientY - start.y })
  }
  const onStageWheel = (event: WheelEvent) => {
    if (!file) return
    if (
      event.target instanceof Element &&
      event.target.closest('audio, video, button, .ml-preview-lyrics')
    )
      return
    event.preventDefault()
    if (event.ctrlKey || event.metaKey || mediaKind(file) !== 'image') {
      if (index === null || !onIndexChange || Date.now() - lastWheelNavigationRef.current < 250)
        return
      lastWheelNavigationRef.current = Date.now()
      if (event.deltaY > 0) goNext()
      else goPrevious()
    } else setImageZoom(zoom * Math.exp(-event.deltaY * 0.002))
  }
  useEffect(() => {
    const stage = stageRef.current
    if (!stage || !file) return
    stage.addEventListener('wheel', onStageWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onStageWheel)
  }, [file, index, zoom, onIndexChange, goPrevious, goNext])
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === layoutRef.current) await document.exitFullscreen()
      else await layoutRef.current?.requestFullscreen()
    } catch (cause) {
      setError(errorText(cause))
    }
  }
  const resetImage = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setRotation(0)
  }
  const rotated = Math.abs(rotation % 180) === 90
  const fit =
    imageSize.width && imageSize.height && stageSize.width && stageSize.height
      ? Math.min(
          Math.max(1, stageSize.width - 72) / (rotated ? imageSize.height : imageSize.width),
          Math.max(1, stageSize.height - 116) / (rotated ? imageSize.width : imageSize.height),
          1
        )
      : 0

  const prepareAudioWrite = async () => {
    const player = audioRef.current
    audioResumeRef.current =
      player && file
        ? { path: file.fullpath, time: player.currentTime, playing: !player.paused }
        : null
    if (player) {
      player.pause()
      player.removeAttribute('src')
      player.load()
    }
    // Unmount the media element before issuing the write request. A scheduled
    // state update alone can leave its range request alive until after save.
    flushSync(() => {
      setAudioAutoPlay(false)
      setAudioSuspended(true)
    })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
  const finishAudioWrite = () => {
    setAudioSuspended(false)
    setPreviewError('')
    const resume = audioResumeRef.current
    audioResumeRef.current = null
    if (!resume) return
    setTimeout(() => {
      if (activeFilePathRef.current !== resume.path) return
      const player = audioRef.current
      if (!player) return
      const restore = () => {
        if (activeFilePathRef.current !== resume.path) return
        if (Number.isFinite(resume.time))
          player.currentTime = Math.min(
            resume.time,
            Number.isFinite(player.duration) ? player.duration : resume.time
          )
        if (resume.playing) void player.play().catch(() => {})
      }
      if (player.readyState >= 1) restore()
      else player.addEventListener('loadedmetadata', restore, { once: true })
    }, 0)
  }

  const download = () => {
    if (!file) return
    if (onDownload) {
      onDownload(file)
      return
    }
    const link = document.createElement('a')
    link.href = rawMediaUrl(file, true)
    link.download = file.name
    link.click()
  }

  const kind = file ? mediaKind(file) : 'other'
  const shownFile =
    file && audioRevision && kind === 'audio' ? { ...file, date: audioRevision } : file
  const audioStream = shownFile && kind === 'audio' ? streamMediaUrl(shownFile) : ''
  const audioSrc = audioStream
    ? `${audioStream}${audioStream.includes('?') ? '&' : '?'}audio_tag_revision=${encodeURIComponent(audioDetails?.revision || '')}`
    : ''
  return (
    <>
      <Modal
        opened={file !== null}
        onClose={onClose}
        size="min(1120px, calc(100vw - 24px))"
        centered
        title={file?.name || m('预览')}
        classNames={{ content: 'ml-preview-modal', body: 'ml-preview-body' }}
      >
        {shownFile && (
          <>
            {error && (
              <Alert color="red" m="sm" role="alert">
                {error}
              </Alert>
            )}
            <div
              className={`ml-preview-layout${detailsOpen ? '' : ' is-details-hidden'}`}
              ref={layoutRef}
            >
              <div
                className="ml-preview-stage"
                ref={stageRef}
                onTouchStart={onStageTouchStart}
                onTouchMove={onStageTouchMove}
                onTouchEnd={onStageTouchEnd}
                onTouchCancel={() => {
                  swipeStartRef.current = null
                }}
              >
                <ActionIcon
                  variant="filled"
                  color="dark"
                  className="ml-preview-previous"
                  aria-label={m('上一项')}
                  disabled={index === 0 || !onIndexChange}
                  onClick={goPrevious}
                >
                  <IconChevronLeft size={20} />
                </ActionIcon>
                <div className="ml-preview-controls" role="toolbar" aria-label={m('预览操作')}>
                  <ActionIcon
                    variant="filled"
                    color="dark"
                    aria-label={m(fullscreen ? '退出全屏' : '全屏')}
                    onClick={() => void toggleFullscreen()}
                  >
                    {fullscreen ? (
                      <IconArrowsMinimize size={18} />
                    ) : (
                      <IconArrowsMaximize size={18} />
                    )}
                  </ActionIcon>
                  {favoriteTag && (
                    <ActionIcon
                      variant="filled"
                      color={liked ? 'pink' : 'dark'}
                      aria-label={m(liked ? '取消收藏' : '喜欢')}
                      disabled={readOnly || favoriteBusy}
                      onClick={() => void toggleFavorite()}
                    >
                      {liked ? <IconHeartFilled size={18} /> : <IconHeart size={18} />}
                    </ActionIcon>
                  )}
                  <ActionIcon
                    variant="filled"
                    color={descriptionOpen ? 'blue' : 'dark'}
                    aria-label={m(descriptionOpen ? '隐藏媒体描述' : '显示媒体描述')}
                    aria-pressed={descriptionOpen}
                    onClick={() => setDescriptionOpen((value) => !value)}
                  >
                    <IconMessageCircle size={18} />
                  </ActionIcon>
                  <ActionIcon
                    variant="filled"
                    color={detailsOpen ? 'blue' : 'dark'}
                    aria-label={m(detailsOpen ? '收起详细信息' : '展开详细信息')}
                    aria-pressed={detailsOpen}
                    onClick={() => setDetailsOpen((value) => !value)}
                  >
                    <IconInfoCircle size={18} />
                  </ActionIcon>
                  {kind === 'image' && (
                    <>
                      <ActionIcon
                        variant="filled"
                        color="dark"
                        aria-label={m('缩小')}
                        onClick={() => setImageZoom(zoom / 1.25)}
                      >
                        <IconZoomOut size={18} />
                      </ActionIcon>
                      <ActionIcon
                        variant="filled"
                        color="dark"
                        aria-label={m('放大')}
                        onClick={() => setImageZoom(zoom * 1.25)}
                      >
                        <IconZoomIn size={18} />
                      </ActionIcon>
                      <ActionIcon
                        variant="filled"
                        color="dark"
                        aria-label={m('旋转图片')}
                        onClick={() => {
                          setRotation((value) => (value + 90) % 360)
                          setPan({ x: 0, y: 0 })
                        }}
                      >
                        <IconRotateClockwise size={18} />
                      </ActionIcon>
                      <ActionIcon
                        variant="filled"
                        color="dark"
                        aria-label={m('重置视图')}
                        onClick={resetImage}
                      >
                        <IconZoomReset size={18} />
                      </ActionIcon>
                    </>
                  )}
                </div>
                {shownFile.cloud_only ? (
                  <Text c="dimmed">{m('此文件仅在线，下载到本机后可预览。')}</Text>
                ) : kind === 'image' ? (
                  <img
                    className="ml-preview-image"
                    src={rawMediaUrl(shownFile)}
                    alt={shownFile.name}
                    draggable={false}
                    style={{
                      ...(fit
                        ? { width: imageSize.width * fit, height: imageSize.height * fit }
                        : {}),
                      transform: `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
                      cursor: zoom > 1 ? (panning ? 'grabbing' : 'grab') : 'default'
                    }}
                    onLoad={(event) =>
                      setImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight
                      })
                    }
                    onError={() => setPreviewError(m('无法预览此文件'))}
                    onPointerDown={onImagePointerDown}
                    onPointerMove={onImagePointerMove}
                    onPointerUp={() => setPanning(false)}
                    onPointerCancel={() => setPanning(false)}
                    onDoubleClick={resetImage}
                  />
                ) : kind === 'video' ? (
                  <video
                    key={shownFile.fullpath}
                    src={streamMediaUrl(shownFile)}
                    poster={videoCoverUrl(shownFile)}
                    controls
                    autoPlay
                    loop
                    playsInline
                    onError={() => setPreviewError(m('无法预览此文件'))}
                    onLoadedMetadata={() => setPreviewError('')}
                  />
                ) : kind === 'audio' ? (
                  <div className="ml-preview-audio">
                    <div className="ml-preview-audio-main">
                      {coverBroken || (audioDetails && !audioDetails.has_cover) ? (
                        <div className="ml-artwork-fallback">
                          <IconMusic size={62} stroke={1.2} />
                        </div>
                      ) : (
                        <img
                          src={audioCoverUrl(shownFile)}
                          alt={m('音频封面')}
                          onError={() => setCoverBroken(true)}
                        />
                      )}
                      <div className="ml-preview-audio-copy">
                        <h2>{audioDetails?.title || fileDisplayName(shownFile.name)}</h2>
                        {(audioDetails?.artist || audioDetails?.album) && (
                          <p>
                            {[audioDetails.artist, audioDetails.album].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        {audioDetails?.lyrics?.lines.length ? (
                          <div
                            className="ml-preview-lyrics"
                            ref={lyricsRef}
                            aria-label={m('歌词或台词')}
                            onWheel={(event) => event.stopPropagation()}
                          >
                            {audioDetails.lyrics.lines.map((line, lineIndex) =>
                              audioDetails.lyrics?.timed ? (
                                <button
                                  key={lineIndex}
                                  type="button"
                                  data-lyric-index={lineIndex}
                                  className={lineIndex === activeLyricIndex ? 'active' : ''}
                                  onClick={() => {
                                    if (line.time !== undefined && audioRef.current)
                                      audioRef.current.currentTime = line.time
                                  }}
                                >
                                  {line.text}
                                </button>
                              ) : (
                                <p key={lineIndex}>{line.text}</p>
                              )
                            )}
                          </div>
                        ) : (
                          <p className="ml-preview-lyrics-empty">
                            {m('此文件没有可显示的歌词或台词')}
                          </p>
                        )}
                      </div>
                    </div>
                    {!audioSuspended && (
                      <audio
                        ref={audioRef}
                        key={`${shownFile.fullpath}:${shownFile.date}`}
                        src={audioSrc}
                        controls
                        autoPlay={audioAutoPlay}
                        loop
                        preload="metadata"
                        onTimeUpdate={(event) =>
                          setCurrentAudioTime(event.currentTarget.currentTime)
                        }
                        onLoadedMetadata={() => setPreviewError('')}
                        onError={() => setPreviewError(m('无法预览此文件'))}
                      />
                    )}
                  </div>
                ) : (
                  <div className="ml-artwork-fallback">
                    <IconFile size={52} stroke={1.2} />
                  </div>
                )}
                {previewError && !audioSuspended && (
                  <div className="ml-preview-unavailable" role="alert">
                    <strong>{m('无法预览此文件')}</strong>
                    <Text size="sm">{m('可下载原文件后用本机应用打开。')}</Text>
                    <Group justify="center" gap="xs">
                      {isTauri() && !shownFile.workspace_artifact_id && (
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() =>
                            void openWithAppPicker(shownFile.fullpath).catch((cause) =>
                              setError(errorText(cause))
                            )
                          }
                        >
                          {m('用其他应用打开')}
                        </Button>
                      )}
                      <Button size="xs" variant="light" onClick={download}>
                        {m('下载')}
                      </Button>
                    </Group>
                  </div>
                )}
                {descriptionOpen && !previewError && (
                  <div className="ml-preview-description" role="note">
                    {description || m('暂无描述')}
                  </div>
                )}
                <ActionIcon
                  variant="filled"
                  color="dark"
                  className="ml-preview-next"
                  aria-label={m('下一项')}
                  loading={index === files.length - 1 && (loadingMore || fetchingNext)}
                  disabled={
                    !onIndexChange || (index === files.length - 1 && (!hasMore || !onLoadMore))
                  }
                  onClick={goNext}
                >
                  <IconChevronRight size={20} />
                </ActionIcon>
              </div>
              {detailsOpen && (
                <MediaDetailsPanel
                  key={shownFile.fullpath}
                  file={shownFile}
                  tags={tags}
                  availableTags={availableTags}
                  readonly={readOnly}
                  onEditTags={() => void openTagEditor()}
                  onApplyTag={applyTag}
                  onAudioWriteStart={prepareAudioWrite}
                  onAudioWriteEnd={finishAudioWrite}
                  onAudioUpdated={(metadata) => {
                    setAudioDetails(metadata)
                    setAudioRevision(metadata.modified_date)
                    setCoverBroken(false)
                    setPreviewError('')
                    onAudioUpdated?.(shownFile, metadata)
                  }}
                />
              )}
            </div>
            <div className="ml-preview-footer">
              <div>
                <Text fw={600}>{fileDisplayName(shownFile.name)}</Text>
                <Text size="xs" c="dimmed">
                  {m(
                    kind === 'other'
                      ? '文件'
                      : kind === 'image'
                        ? '图片'
                        : kind === 'video'
                          ? '视频'
                          : '音频'
                  )}{' '}
                  ·{' '}
                  {shownFile.width && shownFile.height
                    ? `${shownFile.width} × ${shownFile.height} · `
                    : ''}
                  {shownFile.size} · {(index ?? 0) + 1} / {files.length}
                </Text>
              </div>
              <Group gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconDownload size={15} />}
                  onClick={download}
                >
                  {m('下载')}
                </Button>
                {onDelete && !readOnly && (
                  <Button
                    size="xs"
                    variant="default"
                    color="red"
                    leftSection={<IconTrash size={15} />}
                    onClick={() => {
                      onClose()
                      onDelete(shownFile)
                    }}
                  >
                    {m('删除')}
                  </Button>
                )}
                {isTauri() &&
                  kind !== 'other' &&
                  !shownFile.cloud_only &&
                  !shownFile.workspace_artifact_id && (
                    <Button
                      size="xs"
                      variant="default"
                      leftSection={<IconExternalLink size={15} />}
                      disabled={readOnly}
                      onClick={() =>
                        void openWithAppPicker(shownFile.fullpath).catch((cause) =>
                          setError(errorText(cause))
                        )
                      }
                    >
                      {m('用其他应用打开')}
                    </Button>
                  )}
                {onEditMedia && isEditableOriginalImage(shownFile) && !readOnly && (
                  <Button
                    size="xs"
                    variant="light"
                    leftSection={<IconPencil size={15} />}
                    onClick={() => {
                      void isAnimatedMedia(shownFile)
                        .then((animated) => {
                          if (animated) throw new Error(m('动态图片暂不支持调整'))
                          onClose()
                          onEditMedia(shownFile.fullpath)
                        })
                        .catch((cause) => setError(errorText(cause)))
                    }}
                  >
                    {m('调整图片')}
                  </Button>
                )}
                {onCreateDraft && kind !== 'other' && !readOnly && (
                  <Button size="xs" variant="light" onClick={() => onCreateDraft(shownFile)}>
                    {m('新建制作')}
                  </Button>
                )}
                {footerActions?.(shownFile)}
              </Group>
            </div>
          </>
        )}
      </Modal>
      <Modal
        opened={tagEditorOpen}
        onClose={() => !tagBusy && setTagEditorOpen(false)}
        title={m('编辑标签')}
        centered
      >
        <Stack>
          {error && <Alert color="red">{error}</Alert>}
          <MultiSelect
            searchable
            label={m('选择标签')}
            data={availableTags.map((tag) => ({
              value: String(tag.id),
              label: tag.display_name || tag.name
            }))}
            value={tagIds}
            onChange={setTagIds}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setTagEditorOpen(false)}>
              {m('取消')}
            </Button>
            <Button loading={tagBusy} onClick={() => void saveTags()}>
              {m('保存标签')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  )
}
