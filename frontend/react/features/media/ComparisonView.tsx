import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  Alert,
  Button,
  Drawer,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Text,
  TextInput
} from '@mantine/core'
import { IconArrowsExchange, IconArrowsMaximize, IconSearch } from '@tabler/icons-react'
import { parse } from '../../../src/features/generation-metadata/model/generationInfoParser'
import { comparisonTextDiff } from './comparisonTextDiff'
import {
  emptyFilters,
  getArtifactMetadata,
  getGenerationInfo,
  mediaKind,
  rawMediaUrl,
  searchMedia,
  type MediaFile
} from './mediaApi'
import './comparisonView.css'

export interface ComparisonViewProps {
  files: MediaFile[]
  mode: 'compare' | 'grid' | null
  onClose: () => void
  embedded?: boolean
}

type Side = 'left' | 'right'
type GenerationRow = { key: string; left: string; right: string; different: boolean }

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value, null, 2)
}

/** Keep prompt, negative prompt, then model parameters in the same order on both sides. */
export function generationRows(leftRaw: string, rightRaw: string): GenerationRow[] {
  const left = parse(leftRaw) as Record<string, unknown>
  const right = parse(rightRaw) as Record<string, unknown>
  const keys = [
    'prompt',
    'negativePrompt',
    ...new Set(
      [...Object.keys(left), ...Object.keys(right)].filter(
        (key) => key !== 'prompt' && key !== 'negativePrompt'
      )
    )
  ]
  if (keys.length === 2 && (leftRaw.trim() || rightRaw.trim())) keys.push('raw')
  return keys.map((key) => {
    const leftText = key === 'raw' ? leftRaw : displayValue(left[key])
    const rightText = key === 'raw' ? rightRaw : displayValue(right[key])
    return { key, left: leftText, right: rightText, different: leftText !== rightText }
  })
}

function formattedGenerationText(raw: string): string {
  if (!raw.trim()) return ''
  const parsed = parse(raw) as Record<string, unknown>
  const prompt = displayValue(parsed.prompt)
  const negativePrompt = displayValue(parsed.negativePrompt)
  const parameters = Object.entries(parsed)
    .filter(([key]) => key !== 'prompt' && key !== 'negativePrompt')
    .map(([key, value]) => `${key}: ${displayValue(value)}`)
  if (!prompt && !negativePrompt && !parameters.length) return raw
  return [
    '--- PROMPT ---',
    prompt,
    '',
    '--- NEGATIVE PROMPT ---',
    negativePrompt,
    '',
    '--- PARAMS ---',
    ...parameters
  ].join('\n')
}

function dragPaths(event: DragEvent): string[] {
  try {
    const parsed: unknown = JSON.parse(
      event.dataTransfer.getData('application/x-omnigallery-files')
    )
    if (Array.isArray(parsed))
      return parsed.filter((path): path is string => typeof path === 'string')
    if (parsed && typeof parsed === 'object' && 'nodes' in parsed) {
      const nodes = (parsed as { nodes: unknown }).nodes
      if (Array.isArray(nodes))
        return nodes
          .filter(
            (node): node is { fullpath: string } => !!node && typeof node.fullpath === 'string'
          )
          .map((node) => node.fullpath)
    }
  } catch {
    /* Only app media drag payloads are accepted. */
  }
  return []
}

const readGeneration = async (file: MediaFile) =>
  file.workspace_artifact_id
    ? (await getArtifactMetadata(file.workspace_artifact_id)).generation_info
    : getGenerationInfo(file.fullpath)

export function ComparisonView({ files, mode, onClose, embedded = false }: ComparisonViewProps) {
  const selectedImages = useMemo(() => files.filter((file) => mediaKind(file) === 'image'), [files])
  const selectedKey = selectedImages.map((file) => file.fullpath).join('\u0001')
  const [view, setView] = useState<'compare' | 'grid'>(mode ?? 'compare')
  const [left, setLeft] = useState<MediaFile | null>(selectedImages[0] ?? null)
  const [right, setRight] = useState<MediaFile | null>(selectedImages[1] ?? null)
  const [compareMode, setCompareMode] = useState<'slider' | 'side'>('slider')
  const [percent, setPercent] = useState(50)
  const [gridSize, setGridSize] = useState<4 | 6 | 9>(4)
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [candidates, setCandidates] = useState<MediaFile[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [imageError, setImageError] = useState<Side | null>(null)
  const [generation, setGeneration] = useState<{ left: string; right: string }>({
    left: '',
    right: ''
  })
  const [generationError, setGenerationError] = useState('')
  const [metadataMode, setMetadataMode] = useState<'text' | 'fields'>('text')
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mode) return
    setView(mode)
    setLeft(selectedImages[0] ?? null)
    setRight(selectedImages[1] ?? null)
    setPage(0)
    setPercent(50)
    setImageError(null)
  }, [mode, selectedKey])

  useEffect(() => {
    if (!mode || view !== 'compare') return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setLoading(true)
      setSearchError('')
      void searchMedia(
        {
          section: 'image',
          query,
          folderPath: '',
          includeSubfolders: true,
          filters: emptyFilters(),
          cursor: '',
          size: 100
        },
        controller.signal
      )
        .then((result) => setCandidates(result.files.filter((file) => mediaKind(file) === 'image')))
        .catch(() => {
          if (!controller.signal.aborted) setSearchError('读取图片失败，请重试')
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [mode, view, query])

  useEffect(() => {
    if (!mode || view !== 'compare' || !left || !right) return
    let active = true
    setGeneration({ left: '', right: '' })
    setGenerationError('')
    void Promise.all([readGeneration(left), readGeneration(right)])
      .then(([leftInfo, rightInfo]) => {
        if (active) setGeneration({ left: leftInfo, right: rightInfo })
      })
      .catch(() => {
        if (active) setGenerationError('生成信息读取失败，请重新选择图片后重试')
      })
    return () => {
      active = false
    }
  }, [mode, view, left?.fullpath, right?.fullpath])

  const allCandidates = useMemo(
    () => [
      ...new Map(
        [left, right, ...selectedImages, ...candidates]
          .filter((file): file is MediaFile => !!file)
          .map((file) => [file.fullpath, file])
      ).values()
    ],
    [left, right, selectedImages, candidates]
  )
  const options = allCandidates.map((file) => ({ value: file.fullpath, label: file.name }))
  const gridPages = Math.max(1, Math.ceil(selectedImages.length / gridSize))
  const visibleGrid = selectedImages.slice(page * gridSize, (page + 1) * gridSize)
  const rows = useMemo(() => generationRows(generation.left, generation.right), [generation])
  const textDiff = useMemo(
    () =>
      comparisonTextDiff(
        formattedGenerationText(generation.left),
        formattedGenerationText(generation.right)
      ),
    [generation]
  )

  function choose(side: Side, path: string | null) {
    const file = allCandidates.find((item) => item.fullpath === path) ?? null
    if (side === 'left') setLeft(file)
    else setRight(file)
    setPercent(50)
    setImageError(null)
  }

  async function drop(event: DragEvent, side: Side) {
    event.preventDefault()
    const path = dragPaths(event)[0]
    if (!path) return
    const existing = allCandidates.find((file) => file.fullpath === path)
    if (existing) {
      choose(side, path)
      return
    }
    try {
      const basename = path.split(/[\\/]/).at(-1) ?? path
      const result = await searchMedia({
        section: 'image',
        query: basename,
        folderPath: '',
        includeSubfolders: true,
        filters: emptyFilters(),
        cursor: '',
        size: 100
      })
      const file = result.files.find(
        (item) => item.fullpath === path && mediaKind(item) === 'image'
      )
      if (!file) throw new Error('拖入的图片不在当前媒体库中')
      if (side === 'left') setLeft(file)
      else setRight(file)
      setCandidates((current) => [...current, file])
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : '无法读取拖入的图片')
    }
  }

  const fullscreen = () => {
    void stageRef.current?.requestFullscreen()
  }
  const drawerZIndex = 1100
  const title = (
    <Group gap="md" wrap="nowrap">
      <strong>图片查看</strong>
      <SegmentedControl
        size="xs"
        value={view}
        onChange={(value) => setView(value === 'grid' ? 'grid' : 'compare')}
        data={[
          { value: 'compare', label: '两图对比' },
          { value: 'grid', label: '多图查看' }
        ]}
      />
    </Group>
  )
  const content = (
    <div className="comparison-shell">
      {view === 'compare' ? (
        <>
          <div className="comparison-picker">
            <label
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void drop(event, 'left')}
            >
              <span>左图</span>
              <Select
                aria-label="选择左图"
                value={left?.fullpath ?? null}
                data={options}
                searchable
                clearable
                comboboxProps={{ zIndex: drawerZIndex + 1 }}
                onChange={(path) => choose('left', path)}
                placeholder="选择图片或拖入"
              />
            </label>
            <Button
              size="xs"
              variant="default"
              aria-label="交换左右图片"
              disabled={!left || !right}
              onClick={() => {
                setLeft(right)
                setRight(left)
                setPercent(50)
              }}
            >
              <IconArrowsExchange size={17} />
            </Button>
            <label
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => void drop(event, 'right')}
            >
              <span>右图</span>
              <Select
                aria-label="选择右图"
                value={right?.fullpath ?? null}
                data={options}
                searchable
                clearable
                comboboxProps={{ zIndex: drawerZIndex + 1 }}
                onChange={(path) => choose('right', path)}
                placeholder="选择图片或拖入"
              />
            </label>
            <TextInput
              aria-label="搜索候选图片"
              placeholder="搜索候选图片"
              leftSection={<IconSearch size={15} />}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            {loading && <Loader size="xs" />}
            <Button
              size="xs"
              variant="light"
              leftSection={<IconArrowsMaximize size={15} />}
              disabled={!left || !right}
              onClick={fullscreen}
            >
              全屏
            </Button>
          </div>
          {searchError && <Alert color="red">{searchError}</Alert>}
          {left && right ? (
            <div className="comparison-compare-view" ref={stageRef}>
              <div className="comparison-mode-bar">
                <SegmentedControl
                  size="xs"
                  value={compareMode}
                  onChange={(value) => setCompareMode(value === 'side' ? 'side' : 'slider')}
                  data={[
                    { value: 'slider', label: '滑动对比' },
                    { value: 'side', label: '并排查看' }
                  ]}
                />
                <Text size="xs" c="dimmed">
                  {compareMode === 'slider' ? '拖动分隔线比较两张图片' : '两张图片完整显示'}
                </Text>
              </div>
              <div className={`comparison-stage ${compareMode}`} aria-label="图片对比画布">
                <img
                  className="comparison-image right"
                  src={rawMediaUrl(right)}
                  alt={`右图：${right.name}`}
                  draggable={false}
                  onError={() => setImageError('right')}
                />
                <img
                  className="comparison-image left"
                  src={rawMediaUrl(left)}
                  alt={`左图：${left.name}`}
                  draggable={false}
                  style={
                    compareMode === 'slider'
                      ? { clipPath: `inset(0 ${100 - percent}% 0 0)` }
                      : undefined
                  }
                  onError={() => setImageError('left')}
                />
                {compareMode === 'slider' && (
                  <>
                    <div className="comparison-divider" style={{ left: `${percent}%` }}>
                      <span>↔</span>
                    </div>
                    <input
                      className="comparison-slider"
                      type="range"
                      min={0}
                      max={100}
                      step={0.1}
                      value={percent}
                      aria-label="图片对比分隔线"
                      onChange={(event) => setPercent(Number(event.currentTarget.value))}
                    />
                  </>
                )}
                <span className="comparison-image-label left">{left.name}</span>
                <span className="comparison-image-label right">{right.name}</span>
                {imageError && (
                  <div className="comparison-image-error" role="alert">
                    {imageError === 'left' ? '左图' : '右图'}加载失败，请重新选择图片
                  </div>
                )}
              </div>
              <details className="comparison-metadata">
                <summary>
                  提示词与生成参数对比 · {rows.filter((row) => row.different).length} 项差异
                </summary>
                <div className="comparison-metadata-mode">
                  <SegmentedControl
                    size="xs"
                    aria-label="生成信息对比方式"
                    value={metadataMode}
                    onChange={(value) => setMetadataMode(value === 'fields' ? 'fields' : 'text')}
                    data={[
                      { value: 'text', label: '文本差异' },
                      { value: 'fields', label: '字段对比' }
                    ]}
                  />
                </div>
                {generationError ? (
                  <Alert color="red">{generationError}</Alert>
                ) : metadataMode === 'text' ? (
                  <div className="comparison-text-diff" role="group" aria-label="逐词生成信息差异">
                    <section>
                      <strong title={left.name}>{left.name}</strong>
                      <pre>
                        {textDiff.left.map((part, index) => (
                          <span key={index} className={part.changed ? 'removed' : undefined}>
                            {part.text}
                          </span>
                        ))}
                      </pre>
                    </section>
                    <section>
                      <strong title={right.name}>{right.name}</strong>
                      <pre>
                        {textDiff.right.map((part, index) => (
                          <span key={index} className={part.changed ? 'added' : undefined}>
                            {part.text}
                          </span>
                        ))}
                      </pre>
                    </section>
                  </div>
                ) : (
                  <div className="comparison-diff-table" role="table" aria-label="生成信息差异">
                    <div className="comparison-diff-row heading" role="row">
                      <strong>字段</strong>
                      <strong>{left.name}</strong>
                      <strong>{right.name}</strong>
                    </div>
                    {rows.map((row) => (
                      <div
                        className={`comparison-diff-row${row.different ? ' different' : ''}`}
                        role="row"
                        key={row.key}
                      >
                        <strong>
                          {row.key === 'prompt'
                            ? '提示词'
                            : row.key === 'negativePrompt'
                              ? '反向提示词'
                              : row.key === 'raw'
                                ? '原始信息'
                                : row.key}
                        </strong>
                        <pre>{row.left || '—'}</pre>
                        <pre>{row.right || '—'}</pre>
                      </div>
                    ))}
                  </div>
                )}
              </details>
            </div>
          ) : (
            <div className="comparison-empty">
              <h2>选择两张图片开始对比</h2>
              <p>在上方选择左右图片，也可以从媒体库拖入图片。</p>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="comparison-grid-toolbar">
            <Text size="xs">已选 {selectedImages.length} 张</Text>
            <SegmentedControl
              size="xs"
              aria-label="宫格大小"
              value={String(gridSize)}
              onChange={(value) => {
                setGridSize(value === '6' ? 6 : value === '9' ? 9 : 4)
                setPage(0)
              }}
              data={[
                { value: '4', label: '4 宫格' },
                { value: '6', label: '6 宫格' },
                { value: '9', label: '9 宫格' }
              ]}
            />
            <Group gap="xs" ml="auto">
              <Button
                size="xs"
                variant="default"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                上一组
              </Button>
              <Text size="xs">
                {page + 1} / {gridPages}
              </Text>
              <Button
                size="xs"
                variant="default"
                disabled={page >= gridPages - 1}
                onClick={() => setPage((value) => value + 1)}
              >
                下一组
              </Button>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconArrowsMaximize size={15} />}
                disabled={!selectedImages.length}
                onClick={fullscreen}
              >
                全屏
              </Button>
            </Group>
          </div>
          {selectedImages.length ? (
            <div
              className={`comparison-grid grid-${gridSize}`}
              ref={stageRef}
              aria-label={`${gridSize} 宫格多图查看`}
            >
              {Array.from({ length: gridSize }, (_, index) => {
                const file = visibleGrid[index]
                return (
                  <figure key={file?.fullpath ?? `empty-${index}`} className="comparison-grid-cell">
                    {file ? (
                      <>
                        <img src={rawMediaUrl(file)} alt={file.name} draggable={false} />
                        <figcaption title={file.name}>{file.name}</figcaption>
                      </>
                    ) : (
                      <span>空位</span>
                    )}
                  </figure>
                )
              })}
            </div>
          ) : (
            <div className="comparison-empty">
              <h2>选择图片开始多图查看</h2>
              <p>在媒体库选中多张图片后打开网格查看。</p>
            </div>
          )}
        </>
      )}
    </div>
  )
  if (embedded)
    return (
      <section className="comparison-embedded">
        <header>{title}</header>
        {content}
      </section>
    )
  return (
    <Drawer
      opened={mode !== null}
      onClose={onClose}
      position="right"
      size="100%"
      title={title}
      classNames={{ content: 'comparison-drawer-content', body: 'comparison-drawer-body' }}
      withinPortal
      zIndex={drawerZIndex}
    >
      {content}
    </Drawer>
  )
}

export default ComparisonView
