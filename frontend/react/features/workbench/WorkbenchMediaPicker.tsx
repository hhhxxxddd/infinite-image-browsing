import { useEffect, useState } from 'react'
import {
  Badge,
  Button,
  Center,
  FileButton,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  UnstyledButton
} from '@mantine/core'
import { IconFilter, IconMusic, IconPhoto, IconSearch, IconVideo } from '@tabler/icons-react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import {
  emptyFilters,
  getLibraryInfo,
  searchByDescription,
  searchSimilarMedia,
  type MediaFilters,
  type MediaTag
} from '../media/mediaApi'
import MediaFilterForm from '../media/MediaFilterForm'
import type { WorkspaceAsset } from '../../../src/features/workspaces/model/workspaceModel'
import './WorkbenchPage.css'

type MediaKind = WorkspaceAsset['kind']
type Filter = 'all' | MediaKind
interface FileNodeInfo {
  id?: number
  fullpath: string
  name: string
  type: 'file' | 'dir'
  date: string
  relevance?: number
  similarity?: number
}
interface MediaPage {
  files: FileNodeInfo[]
  cursor: { next: string; has_next: boolean }
}

const imageExtensions = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'avif',
  'svg',
  'tif',
  'tiff'
])
const videoExtensions = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'])
function kindForFile(name: string): MediaKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (imageExtensions.has(ext)) return 'image'
  if (videoExtensions.has(ext)) return 'video'
  return 'audio'
}
const icon = { image: IconPhoto, video: IconVideo, audio: IconMusic }
const score = (value: number) =>
  Math.round(Math.max(0, Math.min(100, value <= 1 ? value * 100 : value)))
type SearchMode = 'keyword' | 'visual' | 'similar'

interface Props {
  opened: boolean
  onClose: () => void
  onConfirm: (assets: WorkspaceAsset[]) => Promise<void> | void
  alreadyAdded: string[]
}

export default function WorkbenchMediaPicker({ opened, onClose, onConfirm, alreadyAdded }: Props) {
  const [query, setQuery] = useState('')
  const [searchMode, setSearchMode] = useState<SearchMode>('keyword')
  const [visualInput, setVisualInput] = useState('')
  const [visualQuery, setVisualQuery] = useState('')
  const [visualRevision, setVisualRevision] = useState(0)
  const [similarImage, setSimilarImage] = useState<{
    name: string
    preview: string
    path?: string
    image_base64?: string
  } | null>(null)
  const [referenceImages, setReferenceImages] = useState<FileNodeInfo[]>([])
  const [similarMethod, setSimilarMethod] = useState<'qwen' | 'hash'>('qwen')
  const [filter, setFilter] = useState<Filter>('all')
  const [files, setFiles] = useState<FileNodeInfo[]>([])
  const [selected, setSelected] = useState<Record<string, FileNodeInfo>>({})
  const [cursor, setCursor] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<MediaFilters>(emptyFilters)
  const [filterDraft, setFilterDraft] = useState<MediaFilters>(emptyFilters)
  const [filterOpen, setFilterOpen] = useState(false)
  const [tags, setTags] = useState<MediaTag[]>([])
  useEffect(() => {
    if (!opened) return
    let active = true
    void getLibraryInfo()
      .then((info) => {
        if (active) setTags(info.tags)
      })
      .catch(() => {
        if (active) setTags([])
      })
    return () => {
      active = false
    }
  }, [opened])

  useEffect(() => {
    if (!opened || searchMode !== 'keyword') return
    setSelected({})
  }, [opened])

  useEffect(() => {
    if (!opened || searchMode !== 'keyword') return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      setFiles([])
      setCursor('')
      setHasMore(false)
      try {
        const result = await search(query, filter, '', filters)
        if (cancelled) return
        setFiles(result.files.filter((file) => file.type === 'file'))
        setCursor(result.cursor.next)
        setHasMore(result.cursor.has_next)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '读取媒体库失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [opened, query, filter, searchMode, filters])

  useEffect(() => {
    if (!opened || searchMode === 'keyword') return
    const ready = searchMode === 'visual' ? !!visualQuery : !!similarImage
    if (!ready) {
      setFiles([])
      setHasMore(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setFiles([])
    setHasMore(false)
    const request =
      searchMode === 'visual'
        ? searchByDescription(visualQuery, filters, '', true, controller.signal)
        : searchSimilarMedia(
            similarImage?.path
              ? { path: similarImage.path }
              : { image_base64: similarImage?.image_base64 },
            similarMethod,
            filters,
            '',
            true,
            controller.signal
          )
    void request
      .then((result) => {
        if (!cancelled) setFiles(result.files.filter((file) => file.type === 'file'))
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : '画面搜索失败，请检查模型和索引状态')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [opened, searchMode, visualQuery, visualRevision, similarImage, similarMethod, filters])

  function submitVisualSearch() {
    setVisualQuery(visualInput.trim())
    setVisualRevision((revision) => revision + 1)
  }

  useEffect(() => {
    if (!opened || searchMode !== 'similar') return
    let cancelled = false
    void search('', 'image', '').then(
      (result) => {
        if (!cancelled) setReferenceImages(result.files.filter((file) => file.type === 'file'))
      },
      () => {
        if (!cancelled) setReferenceImages([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [opened, searchMode])

  function chooseSimilarImage(file: File | null) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const preview = String(reader.result ?? '')
      const encoded = preview.split(',')[1]
      if (!encoded) {
        setError('图片读取失败')
        return
      }
      setSimilarImage({ name: file.name, preview, image_base64: encoded })
    }
    reader.onerror = () => setError('图片读取失败')
    reader.readAsDataURL(file)
  }

  async function loadMore() {
    if (searchMode !== 'keyword' || !hasMore || loading) return
    setLoading(true)
    try {
      const result = await search(query, filter, cursor, filters)
      setFiles((current) => [...current, ...result.files.filter((file) => file.type === 'file')])
      setCursor(result.cursor.next)
      setHasMore(result.cursor.has_next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取媒体库失败')
    } finally {
      setLoading(false)
    }
  }

  async function confirm() {
    const assets = Object.values(selected).map((file) => ({
      ...(typeof file.id === 'number' ? { id: file.id } : {}),
      path: file.fullpath,
      name: file.name,
      kind: kindForFile(file.name)
    }))
    if (!assets.length) return
    setSaving(true)
    try {
      await onConfirm(assets)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加入素材失败')
    } finally {
      setSaving(false)
    }
  }

  const added = new Set(alreadyAdded)
  const visibleFiles =
    (searchMode === 'visual' && !visualQuery) || (searchMode === 'similar' && !similarImage)
      ? []
      : files
  const hasSearch =
    searchMode === 'keyword' ||
    (searchMode === 'visual' && !!visualQuery) ||
    (searchMode === 'similar' && !!similarImage)
  return (
    <>
      <Modal
        opened={opened}
        onClose={onClose}
        title="从媒体库加入素材"
        size="min(1120px, 94vw)"
        centered
      >
        <Stack gap="md" className="wb-picker">
          <SegmentedControl
            aria-label="搜索方式"
            value={searchMode}
            onChange={(value) => {
              setSearchMode(value as SearchMode)
              setFiles([])
              setHasMore(false)
              setError('')
              setFilter(value === 'keyword' ? 'all' : 'image')
            }}
            data={[
              { value: 'keyword', label: '关键词' },
              { value: 'visual', label: 'AI 画面搜索' },
              { value: 'similar', label: '以图搜图' }
            ]}
          />
          <Group align="end" wrap="nowrap">
            <Button
              variant="default"
              leftSection={<IconFilter size={16} />}
              onClick={() => {
                setFilterDraft(structuredClone(filters))
                setFilterOpen(true)
              }}
            >
              筛选
            </Button>
            {searchMode === 'keyword' ? (
              <TextInput
                aria-label="搜索媒体库文件"
                placeholder="搜索文件名、标签或描述"
                leftSection={<IconSearch size={17} />}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                style={{ flex: 1 }}
              />
            ) : searchMode === 'visual' ? (
              <>
                <TextInput
                  aria-label="描述画面"
                  placeholder="描述你要找的画面"
                  leftSection={<IconSearch size={17} />}
                  value={visualInput}
                  onChange={(event) => setVisualInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') submitVisualSearch()
                  }}
                  style={{ flex: 1 }}
                />
                <Button onClick={submitVisualSearch} disabled={!visualInput.trim()}>
                  搜索
                </Button>
              </>
            ) : (
              <Group gap="xs" style={{ flex: 1 }}>
                <FileButton onChange={chooseSimilarImage} accept="image/*">
                  {(props) => (
                    <Button {...props}>{similarImage ? '更换图片' : '选择参考图片'}</Button>
                  )}
                </FileButton>
                <Select
                  size="sm"
                  searchable
                  clearable
                  aria-label="从媒体库选择参考图片"
                  placeholder="或选媒体库图片"
                  value={similarImage?.path ?? null}
                  data={referenceImages.map((file) => ({ value: file.fullpath, label: file.name }))}
                  onChange={(path) => {
                    const file = referenceImages.find((candidate) => candidate.fullpath === path)
                    setSimilarImage(
                      file
                        ? {
                            name: file.name,
                            path: file.fullpath,
                            preview: apiUrl(
                              `/image-thumbnail?path=${encodeURIComponent(file.fullpath)}&size=80x80&t=${encodeURIComponent(file.date)}`
                            )
                          }
                        : null
                    )
                  }}
                  style={{ width: 190 }}
                />
                {similarImage && (
                  <Group gap="xs">
                    <img
                      className="wb-picker-reference"
                      src={similarImage.preview}
                      alt="搜图参考图片"
                    />
                    <Text size="xs" lineClamp={1}>
                      {similarImage.name}
                    </Text>
                  </Group>
                )}
                <SegmentedControl
                  size="xs"
                  aria-label="相似搜索方式"
                  value={similarMethod}
                  onChange={(value) => setSimilarMethod(value as 'qwen' | 'hash')}
                  data={[
                    { value: 'qwen', label: 'AI 相似' },
                    { value: 'hash', label: '找重复' }
                  ]}
                />
              </Group>
            )}
            <SegmentedControl
              aria-label="媒体类型"
              value={filter}
              onChange={(value) => setFilter(value as Filter)}
              data={[
                { label: '全部', value: 'all', disabled: searchMode !== 'keyword' },
                { label: '图片', value: 'image' },
                { label: '视频', value: 'video', disabled: searchMode !== 'keyword' },
                { label: '音频', value: 'audio', disabled: searchMode !== 'keyword' }
              ]}
            />
          </Group>
          {error && (
            <Text c="red" size="sm" role="alert">
              {error}
            </Text>
          )}
          <ScrollArea
            h={hasSearch && (!error || visibleFiles.length) ? 'min(56vh, 570px)' : 180}
            type="auto"
            offsetScrollbars
          >
            {visibleFiles.length ? (
              <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="sm" className="wb-picker-grid">
                {visibleFiles.map((file) => {
                  const kind = kindForFile(file.name)
                  const Icon = icon[kind]
                  const isAdded = added.has(file.fullpath)
                  const isSelected = !!selected[file.fullpath]
                  return (
                    <UnstyledButton
                      key={file.fullpath}
                      type="button"
                      className={`wb-picker-item ${isSelected ? 'is-selected' : ''}`}
                      disabled={isAdded}
                      aria-pressed={isSelected}
                      aria-label={`${isAdded ? '已加入' : isSelected ? '取消选择' : '选择'}：${file.name}`}
                      onClick={() =>
                        setSelected((current) => {
                          const next = { ...current }
                          if (next[file.fullpath]) delete next[file.fullpath]
                          else next[file.fullpath] = file
                          return next
                        })
                      }
                    >
                      <span className="wb-picker-image">
                        {kind === 'image' ? (
                          <img
                            src={apiUrl(
                              `/image-thumbnail?path=${encodeURIComponent(file.fullpath)}&size=320x320&t=${encodeURIComponent(file.date)}`
                            )}
                            alt=""
                            loading="lazy"
                          />
                        ) : kind === 'video' ? (
                          <img
                            src={apiUrl(
                              `/video_cover?path=${encodeURIComponent(file.fullpath)}&mt=${encodeURIComponent(file.date)}`
                            )}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <Icon size={42} stroke={1.25} />
                        )}
                        <Badge
                          size="xs"
                          variant="filled"
                          color={isAdded ? 'gray' : isSelected ? 'blue' : 'dark'}
                          className="wb-picker-badge"
                        >
                          {isAdded
                            ? '已加入'
                            : isSelected
                              ? '已选'
                              : { image: '图片', video: '视频', audio: '音频' }[kind]}
                        </Badge>
                        {(file.relevance !== undefined || file.similarity !== undefined) && (
                          <Badge size="xs" variant="filled" className="wb-picker-score">
                            相关度 {score(file.relevance ?? file.similarity ?? 0)}
                          </Badge>
                        )}
                      </span>
                      <Text size="xs" fw={600} lineClamp={2}>
                        {file.name}
                      </Text>
                    </UnstyledButton>
                  )
                })}
              </SimpleGrid>
            ) : loading ? (
              <Center h={150}>
                <Loader size="sm" />
              </Center>
            ) : (
              <Center h={150}>
                <Text c="dimmed">
                  {error
                    ? '搜索未完成，请检查服务状态后重试'
                    : searchMode === 'visual' && !visualQuery
                      ? '输入画面描述并搜索'
                      : searchMode === 'similar' && !similarImage
                        ? '选择图片后查找相似画面'
                        : '没有找到符合条件的文件'}
                </Text>
              </Center>
            )}
            {searchMode === 'keyword' && hasMore && (
              <Center py="md">
                <Button variant="subtle" loading={loading} onClick={() => void loadMore()}>
                  加载更多
                </Button>
              </Center>
            )}
          </ScrollArea>
          <Group justify="space-between" className="wb-picker-footer">
            <Text size="sm" c="dimmed">
              已选 {Object.keys(selected).length} 项
            </Text>
            <Group gap="xs">
              <Button variant="default" onClick={onClose}>
                取消
              </Button>
              <Button
                loading={saving}
                disabled={!Object.keys(selected).length}
                onClick={() => void confirm()}
              >
                加入工作区
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={opened && filterOpen}
        onClose={() => setFilterOpen(false)}
        title="筛选媒体"
        size="lg"
        centered
        zIndex={800}
      >
        <MediaFilterForm
          value={filterDraft}
          onChange={setFilterDraft}
          tags={tags}
          onApply={() => {
            setFilters(filterDraft)
            setFilterOpen(false)
          }}
        />
      </Modal>
    </>
  )
}

function search(
  query: string,
  filter: Filter,
  cursor: string,
  filters: MediaFilters = emptyFilters()
) {
  return apiFetch<MediaPage>('/search_by_substr', {
    method: 'POST',
    body: JSON.stringify({
      surstr: query.trim(),
      regexp: '',
      cursor,
      media_type: filter,
      size: 60,
      manual_order: true,
      ...filters
    })
  })
}
