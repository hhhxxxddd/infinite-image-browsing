import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  ScrollArea,
  Select,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput
} from '@mantine/core'
import {
  IconEdit,
  IconMusic,
  IconPlus,
  IconRefresh,
  IconSparkles,
  IconTags
} from '@tabler/icons-react'
import {
  parameterEntries,
  readGenerationDraft,
  readParameter,
  setParameter,
  writeGenerationDraft
} from '../../../src/features/generation-metadata/model/generationInfoDraft'
import {
  generationParameterFields,
  validateGenerationParameter
} from '../../../src/features/generation-metadata/model/generationFields'
import { generationDetails } from '../../../src/features/generation-metadata/model/generationDetails'
import { parse } from '../../../src/features/generation-metadata/model/generationInfoParser'
import {
  audioCoverUrl,
  getArtifactMetadata,
  getAudioMetadata,
  getGenerationInfo,
  getImageAiPrompts,
  getMediaDescription,
  getMediaExif,
  getReferencePrompt,
  mediaKind,
  generateImageAiText,
  updateArtifactMetadata,
  updateAudioMetadata,
  updateGenerationInfo,
  updateMediaDescription,
  updateReferencePrompt,
  type ArtifactMetadata,
  type AudioMetadata,
  type ImageAiTextTask,
  type MediaFile,
  type MediaTag
} from './mediaApi'
import { useMediaText } from './mediaLocale'

type TextField = 'description' | 'generation' | 'reference'

interface MediaDetailsPanelProps {
  file: MediaFile
  tags: MediaTag[]
  availableTags: MediaTag[]
  readonly: boolean
  onEditTags: () => void
  onApplyTag: (tag: MediaTag) => Promise<void>
  onAudioWriteStart: () => Promise<void>
  onAudioWriteEnd: () => void
  onAudioUpdated: (metadata: AudioMetadata) => void
}

function readableError(cause: unknown) {
  return cause instanceof Error ? cause.message : '读取失败，请重试'
}

function formatDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return '未知'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const m = useMediaText()
  return (
    <div className="ml-detail-row">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" title={value}>
        {value || m('未填写')}
      </Text>
    </div>
  )
}

export function MediaDetailsPanel({
  file,
  tags,
  availableTags,
  readonly,
  onEditTags,
  onApplyTag,
  onAudioWriteStart,
  onAudioWriteEnd,
  onAudioUpdated
}: MediaDetailsPanelProps) {
  const m = useMediaText()
  const kind = mediaKind(file)
  const [tab, setTab] = useState<string | null>('description')
  const [description, setDescription] = useState('')
  const [generation, setGeneration] = useState('')
  const [reference, setReference] = useState('')
  const [exif, setExif] = useState<Record<string, string>>({})
  const [audio, setAudio] = useState<AudioMetadata | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [editField, setEditField] = useState<TextField | null>(null)
  const [draftText, setDraftText] = useState('')
  const [structuredField, setStructuredField] = useState<string | null>(null)
  const [structuredDraft, setStructuredDraft] = useState('')
  const [aiTask, setAiTask] = useState<ImageAiTextTask | null>(null)
  const [aiTemplate, setAiTemplate] = useState('')
  const [aiMaxChars, setAiMaxChars] = useState(120)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiSuggestedTags, setAiSuggestedTags] = useState<string[]>([])
  const [applyingTag, setApplyingTag] = useState('')
  const aiRequestId = useRef(0)
  const [audioEditorOpen, setAudioEditorOpen] = useState(false)
  const [audioDraft, setAudioDraft] = useState({ title: '', artist: '', album: '' })
  const [coverDraft, setCoverDraft] = useState('')
  const [removeCover, setRemoveCover] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const coverInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    setTab('description')
    setDescription('')
    setGeneration('')
    setReference('')
    setExif({})
    setAudio(null)
    setError('')
    setLoading(true)
    setEditField(null)
    setStructuredField(null)
    setAiTask(null)
    setAiSuggestedTags([])
    setAiBusy(false)
    setAiError('')
    aiRequestId.current += 1
    setAudioEditorOpen(false)
    const load = async () => {
      try {
        if (file.cloud_only) {
          setError(m('此文件仅在线，下载到本机后可查看详情'))
          return
        }
        if (file.workspace_artifact_id) {
          const details = await getArtifactMetadata(file.workspace_artifact_id)
          if (!active) return
          setDescription(details.description || '')
          setGeneration(details.generation_info || '')
          setReference(details.inferred_prompt || '')
          setExif(details.exif || {})
          return
        }
        const requests: Array<Promise<unknown>> = [getMediaDescription(file.fullpath)]
        if (kind === 'image') {
          requests.push(
            getGenerationInfo(file.fullpath),
            getReferencePrompt(file.fullpath),
            getMediaExif(file.fullpath)
          )
        } else if (kind === 'audio') requests.push(getAudioMetadata(file.fullpath))
        const results = await Promise.allSettled(requests)
        if (!active) return
        if (results[0].status === 'fulfilled') setDescription(results[0].value as string)
        else
          setError(m('媒体描述暂不可用：{error}', { error: m(readableError(results[0].reason)) }))
        if (kind === 'image') {
          if (results[1]?.status === 'fulfilled') setGeneration(results[1].value as string)
          if (results[2]?.status === 'fulfilled') setReference(results[2].value as string)
          if (results[3]?.status === 'fulfilled')
            setExif(results[3].value as Record<string, string>)
        } else if (kind === 'audio') {
          if (results[1]?.status === 'fulfilled') setAudio(results[1].value as AudioMetadata)
          else if (results[1]?.status === 'rejected')
            setError(m('音频标签读取失败：{error}', { error: m(readableError(results[1].reason)) }))
        }
      } catch (cause) {
        if (active) setError(m(readableError(cause)))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [
    file.fullpath,
    file.date,
    file.cloud_only,
    file.workspace_artifact_id,
    kind,
    reloadVersion,
    m
  ])

  const canEdit = !readonly && !file.cloud_only && !loading
  const generationDraft = useMemo(() => readGenerationDraft(generation), [generation])
  const parsedGeneration = useMemo(() => parse(generation), [generation])
  const generationView = useMemo(
    () =>
      generationDetails(parsedGeneration, file.width || undefined, file.height || undefined, false),
    [parsedGeneration, file.width, file.height]
  )
  const visibleParameters = generationParameterFields
    .map((field) => ({ ...field, value: readParameter(generationDraft.parameters, field.key) }))
    .filter((field) => field.value)
  const missingParameters = generationParameterFields.filter(
    (field) => !visibleParameters.some((entry) => entry.key === field.key)
  )
  const otherParameters = parameterEntries(generationDraft.parameters).filter((entry) => {
    const key = entry.slice(0, entry.indexOf(':')).trim()
    return !generationParameterFields.some((field) => field.key === key)
  })
  const fields: Record<TextField, { title: string; value: string; max: number }> = {
    description: { title: m('编辑媒体描述'), value: description, max: 5000 },
    generation: { title: m('编辑原始生成信息'), value: generation, max: 50000 },
    reference: { title: m('编辑 AI 参考提示词'), value: reference, max: 5000 }
  }
  const beginTextEdit = (field: TextField) => {
    setDraftText(fields[field].value)
    setSaveError('')
    setEditField(field)
  }
  const persistGeneration = async (raw: string) => {
    if (file.workspace_artifact_id)
      await updateArtifactMetadata(file.workspace_artifact_id, { generation_info: raw })
    else await updateGenerationInfo(file.fullpath, raw)
    setGeneration(raw)
  }
  const beginStructuredEdit = (field: string) => {
    setStructuredDraft(
      field === 'prompt'
        ? generationDraft.positive
        : field === 'negativePrompt'
          ? generationDraft.negative
          : readParameter(generationDraft.parameters, field)
    )
    setSaveError('')
    setStructuredField(field)
  }
  const saveStructured = async () => {
    if (!structuredField || !canEdit || generationDraft.rawPreferred) return
    setSaving(true)
    setSaveError('')
    try {
      const next = readGenerationDraft(generation)
      if (structuredField === 'prompt') next.positive = structuredDraft
      else if (structuredField === 'negativePrompt') next.negative = structuredDraft
      else {
        validateGenerationParameter(structuredField, structuredDraft)
        next.parameters = setParameter(
          next.parameters,
          structuredField,
          structuredField === 'Size' ? structuredDraft.replace(/×/g, 'x') : structuredDraft
        )
      }
      await persistGeneration(writeGenerationDraft(next))
      setStructuredField(null)
    } catch (cause) {
      setSaveError(m(readableError(cause)))
    } finally {
      setSaving(false)
    }
  }
  const openAiSuggestion = (task: ImageAiTextTask) => {
    if (kind !== 'image' || file.cloud_only) return
    const requestId = ++aiRequestId.current
    setAiTask(task)
    setAiError('')
    setAiMaxChars(task === 'prompt' ? 600 : 120)
    setAiTemplate('')
    if (task !== 'tags')
      void getImageAiPrompts()
        .then((prompts) => {
          if (requestId === aiRequestId.current) setAiTemplate(prompts[task] || '')
        })
        .catch(() => {})
  }
  const generateSuggestion = async () => {
    if (!aiTask || aiBusy) return
    const task = aiTask
    const requestId = ++aiRequestId.current
    setAiBusy(true)
    setAiError('')
    try {
      const result = await generateImageAiText(
        file.workspace_artifact_id
          ? `workspace-artifact:${file.workspace_artifact_id}`
          : file.fullpath,
        task,
        aiMaxChars,
        task === 'tags' ? availableTags.map((tag) => tag.name).slice(0, 80) : [],
        task === 'tags' ? undefined : aiTemplate.trim() || undefined
      )
      if (requestId !== aiRequestId.current) return
      if (task === 'tags') setAiSuggestedTags(result.tags)
      else {
        setDraftText(result.text)
        setEditField(task === 'description' ? 'description' : 'reference')
      }
      setAiTask(null)
    } catch (cause) {
      if (requestId === aiRequestId.current) setAiError(m(readableError(cause)))
    } finally {
      if (requestId === aiRequestId.current) setAiBusy(false)
    }
  }
  const applySuggestedTag = async (name: string) => {
    const tag = availableTags.find((entry) => entry.name === name)
    if (!tag || applyingTag) return
    setApplyingTag(name)
    setAiError('')
    try {
      await onApplyTag(tag)
      setAiSuggestedTags((current) => current.filter((entry) => entry !== name))
    } catch (cause) {
      setAiError(m(readableError(cause)))
    } finally {
      setApplyingTag('')
    }
  }
  const saveText = async () => {
    if (!editField || !canEdit) return
    const field = editField
    setSaving(true)
    setSaveError('')
    try {
      let result = draftText.trim()
      if (file.workspace_artifact_id) {
        const fieldName: keyof Pick<
          ArtifactMetadata,
          'description' | 'generation_info' | 'inferred_prompt'
        > =
          field === 'description'
            ? 'description'
            : field === 'generation'
              ? 'generation_info'
              : 'inferred_prompt'
        const updated = await updateArtifactMetadata(file.workspace_artifact_id, {
          [fieldName]: result
        })
        result = updated[fieldName]
      } else if (field === 'description')
        result = await updateMediaDescription(file.fullpath, result)
      else if (field === 'generation') await persistGeneration(result)
      else result = await updateReferencePrompt(file.fullpath, result)
      if (field === 'description') setDescription(result)
      else if (field === 'generation') setGeneration(result)
      else setReference(result)
      setEditField(null)
    } catch (cause) {
      setSaveError(m(readableError(cause)))
    } finally {
      setSaving(false)
    }
  }

  const beginAudioEdit = () => {
    if (!audio || !canEdit || !audio.editable) return
    setAudioDraft({ title: audio.embedded_title, artist: audio.artist, album: audio.album })
    setCoverDraft('')
    setRemoveCover(false)
    setSaveError('')
    setAudioEditorOpen(true)
  }
  const chooseCover = (selection: File | undefined) => {
    if (!selection) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selection.type)) {
      setSaveError(m('请选择 JPEG、PNG 或 WebP 图片'))
      return
    }
    if (selection.size > 8 * 1024 * 1024) {
      setSaveError(m('封面不能超过 8 MB'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setCoverDraft(String(reader.result))
      setRemoveCover(false)
      setSaveError('')
    }
    reader.onerror = () => setSaveError(m('封面读取失败，请重新选择'))
    reader.readAsDataURL(selection)
  }
  const saveAudio = async () => {
    if (!audio || !canEdit || !audio.editable) return
    setSaving(true)
    setSaveError('')
    let audioDetached = false
    try {
      await onAudioWriteStart()
      audioDetached = true
      const updated = await updateAudioMetadata({
        path: file.fullpath,
        revision: audio.revision,
        title: audioDraft.title,
        artist: audioDraft.artist,
        album: audioDraft.album,
        ...(coverDraft ? { cover: coverDraft } : {}),
        remove_cover: removeCover
      })
      setAudio(updated)
      onAudioUpdated(updated)
      setAudioEditorOpen(false)
    } catch (cause) {
      setSaveError(m(readableError(cause)))
    } finally {
      if (audioDetached) onAudioWriteEnd()
      setSaving(false)
    }
  }

  const activeCover =
    coverDraft ||
    (!removeCover && audio?.has_cover ? audioCoverUrl({ ...file, date: audio.revision }) : '')
  const customTags = tags.filter((tag) => tag.type === 'custom')
  const tabLabels = [
    { value: 'description', label: m('描述') },
    ...(kind === 'image' ? [{ value: 'generation', label: m('生成信息') }] : []),
    { value: 'metadata', label: m('元信息') }
  ]

  return (
    <aside className="ml-detail-panel" aria-label={m('媒体详情')}>
      <Tabs value={tab} onChange={setTab} variant="pills" className="ml-detail-tabs">
        <Tabs.List grow>
          {tabLabels.map((entry) => (
            <Tabs.Tab key={entry.value} value={entry.value}>
              {entry.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>
      <ScrollArea className="ml-detail-scroll" type="auto" offsetScrollbars="present">
        {loading ? (
          <Stack gap="sm" mt="md">
            <Skeleton height={22} />
            <Skeleton height={80} />
            <Skeleton height={26} />
          </Stack>
        ) : (
          <Stack gap="lg" py="md">
            {error && (
              <Alert color="orange" title={m('部分信息不可用')}>
                <Text size="xs">{error}</Text>
                <Button
                  variant="subtle"
                  size="compact-xs"
                  leftSection={<IconRefresh size={13} />}
                  onClick={() => setReloadVersion((value) => value + 1)}
                >
                  {m('重试')}
                </Button>
              </Alert>
            )}
            {tab === 'description' && (
              <>
                <section className="ml-detail-section">
                  <Group justify="space-between" align="center">
                    <Text fw={650} size="sm">
                      {m('媒体描述')}
                    </Text>
                    {canEdit && (
                      <Group gap={2}>
                        {kind === 'image' && (
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={<IconSparkles size={14} />}
                            onClick={() => openAiSuggestion('description')}
                          >
                            {m('AI 建议')}
                          </Button>
                        )}
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          leftSection={<IconEdit size={14} />}
                          onClick={() => beginTextEdit('description')}
                        >
                          {m('编辑')}
                        </Button>
                      </Group>
                    )}
                  </Group>
                  <Text size="sm" c={description ? undefined : 'dimmed'} className="ml-detail-copy">
                    {description || m('未填写媒体描述')}
                  </Text>
                </section>
                {kind === 'image' && (
                  <section className="ml-detail-section">
                    <Group justify="space-between" align="center">
                      <Text fw={650} size="sm">
                        {m('AI 参考提示词')}
                      </Text>
                      {canEdit && (
                        <Group gap={2}>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={<IconSparkles size={14} />}
                            onClick={() => openAiSuggestion('prompt')}
                          >
                            {m('AI 反推')}
                          </Button>
                          <Button
                            size="compact-xs"
                            variant="subtle"
                            leftSection={<IconEdit size={14} />}
                            onClick={() => beginTextEdit('reference')}
                          >
                            {m('编辑')}
                          </Button>
                        </Group>
                      )}
                    </Group>
                    <Text size="sm" c={reference ? undefined : 'dimmed'} className="ml-detail-copy">
                      {reference || m('未填写参考提示词')}
                    </Text>
                  </section>
                )}
              </>
            )}
            {tab === 'generation' && kind === 'image' && (
              <section className="ml-detail-section">
                <Group justify="space-between" align="center">
                  <Text fw={650} size="sm">
                    {m('生成信息')}
                  </Text>
                  {canEdit && (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => beginTextEdit('generation')}
                    >
                      {m('编辑原文')}
                    </Button>
                  )}
                </Group>
                {generationDraft.rawPreferred && (
                  <Text size="xs" c="dimmed" mt="xs">
                    {m('这份信息包含结构化数据或特殊格式，请使用原文编辑以保留内容。')}
                  </Text>
                )}
                {!generationDraft.rawPreferred && (
                  <Stack gap="sm" mt="sm">
                    {(
                      [
                        { key: 'prompt', label: m('正向提示词'), value: generationDraft.positive },
                        {
                          key: 'negativePrompt',
                          label: m('负向提示词'),
                          value: generationDraft.negative
                        }
                      ] as const
                    ).map((entry) => (
                      <div className="ml-generation-field" key={entry.key}>
                        <Group justify="space-between" align="center" wrap="nowrap">
                          <Text fw={600} size="xs">
                            {entry.label}
                          </Text>
                          {canEdit && (
                            <Button
                              size="compact-xs"
                              variant="subtle"
                              onClick={() => beginStructuredEdit(entry.key)}
                            >
                              {m('编辑')}
                            </Button>
                          )}
                        </Group>
                        <Text
                          size="sm"
                          c={entry.value ? undefined : 'dimmed'}
                          className="ml-detail-copy"
                        >
                          {entry.value || m('未填写')}
                        </Text>
                      </div>
                    ))}
                    {!!generationView.resources.length && (
                      <div className="ml-generation-field">
                        <Text fw={600} size="xs" mb={6}>
                          {m('使用资源')}
                        </Text>
                        <Group gap={5}>
                          {generationView.resources.map((resource, index) => (
                            <Badge
                              key={`${resource.type}:${resource.name}:${index}`}
                              className="ml-generation-resource"
                              variant="light"
                              color="grape"
                              size="sm"
                            >
                              {m(resource.type)} · {resource.name}
                            </Badge>
                          ))}
                        </Group>
                      </div>
                    )}
                    <div className="ml-generation-field">
                      <Text fw={600} size="xs" mb={6}>
                        {m('生成参数')}
                      </Text>
                      <div className="ml-generation-parameters">
                        {visibleParameters.map((field) => (
                          <button
                            key={field.key}
                            type="button"
                            className="ml-generation-parameter"
                            disabled={!canEdit}
                            onClick={() => beginStructuredEdit(field.key)}
                            title={canEdit ? m('编辑{name}', { name: m(field.label) }) : undefined}
                          >
                            <span>{m(field.label)}</span>
                            <strong>{field.value}</strong>
                          </button>
                        ))}
                      </div>
                      {canEdit && missingParameters.length > 0 && (
                        <Select
                          size="xs"
                          mt="sm"
                          placeholder={m('添加参数')}
                          searchable
                          leftSection={<IconPlus size={13} />}
                          data={missingParameters.map((field) => ({
                            value: field.key,
                            label: m(field.label)
                          }))}
                          value={null}
                          onChange={(value) => value && beginStructuredEdit(value)}
                        />
                      )}
                      {!!otherParameters.length && (
                        <Text size="xs" c="dimmed" mt="xs" className="ml-detail-copy">
                          {m('其他：{value}', { value: otherParameters.join(' · ') })}
                        </Text>
                      )}
                      {!visibleParameters.length && !otherParameters.length && (
                        <Text size="sm" c="dimmed">
                          {m('暂无参数')}
                        </Text>
                      )}
                    </div>
                  </Stack>
                )}
                <details
                  className="ml-generation-raw"
                  open={generationDraft.rawPreferred || undefined}
                >
                  <summary>{m('查看原始信息')}</summary>
                  <Text
                    size="sm"
                    c={generation ? undefined : 'dimmed'}
                    component="pre"
                    className="ml-detail-generation"
                  >
                    {generation || m('暂无生成信息')}
                  </Text>
                </details>
              </section>
            )}
            {tab === 'metadata' && (
              <>
                <section className="ml-detail-section">
                  <Text fw={650} size="sm" mb="sm">
                    {m('文件信息')}
                  </Text>
                  <DetailRow label={m('文件名')} value={file.name} />
                  <DetailRow label={m('路径')} value={file.fullpath} />
                  <DetailRow label={m('大小')} value={file.size || m('未知')} />
                  <DetailRow label={m('修改时间')} value={file.date || m('未知')} />
                  {!!file.width && !!file.height && (
                    <DetailRow label={m('尺寸')} value={`${file.width} × ${file.height}`} />
                  )}
                </section>
                {kind === 'audio' ? (
                  <section className="ml-detail-section">
                    <Group justify="space-between" align="center">
                      <Text fw={650} size="sm">
                        {m('歌曲信息')}
                      </Text>
                      {audio?.editable && canEdit && !file.workspace_artifact_id && (
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          leftSection={<IconEdit size={14} />}
                          onClick={beginAudioEdit}
                        >
                          {m('编辑歌曲信息')}
                        </Button>
                      )}
                    </Group>
                    {audio ? (
                      <>
                        {audio.has_cover && (
                          <img
                            className="ml-detail-cover"
                            src={audioCoverUrl({ ...file, date: audio.revision })}
                            alt={m('歌曲封面')}
                          />
                        )}
                        <DetailRow label={m('歌曲名')} value={audio.title} />
                        <DetailRow
                          label={m('标题来源')}
                          value={m(audio.title_source === 'embedded' ? '内嵌标签' : '文件名')}
                        />
                        <DetailRow label={m('艺术家')} value={audio.artist} />
                        <DetailRow label={m('专辑')} value={audio.album} />
                        <DetailRow label={m('时长')} value={m(formatDuration(audio.duration))} />
                        <DetailRow
                          label={m('封面来源')}
                          value={
                            audio.cover_source === 'embedded'
                              ? m('内嵌封面')
                              : audio.cover_source === 'same_name'
                                ? m('同名图片')
                                : audio.cover_source === 'directory'
                                  ? m('目录封面')
                                  : m('无封面')
                          }
                        />
                        <DetailRow
                          label={m('歌词')}
                          value={
                            audio.lyrics
                              ? `${m(audio.lyrics.source === 'embedded' ? '内嵌' : '同名文件')} · ${m(audio.lyrics.timed ? '带时间戳' : '纯文字')}`
                              : m('未发现')
                          }
                        />
                        {!audio.editable && (
                          <Text size="xs" c="dimmed" mt="sm">
                            {m('此格式可读取歌曲信息，标签写入目前支持 MP3。')}
                          </Text>
                        )}
                      </>
                    ) : (
                      <Text size="sm" c="dimmed" mt="sm">
                        {m('没有读取到音频标签')}
                      </Text>
                    )}
                  </section>
                ) : (
                  <section className="ml-detail-section">
                    <Text fw={650} size="sm" mb="sm">
                      {m('文件元数据')}
                    </Text>
                    {Object.entries(exif).length ? (
                      Object.entries(exif).map(([key, value]) => (
                        <DetailRow key={key} label={key} value={String(value)} />
                      ))
                    ) : (
                      <Text size="sm" c="dimmed">
                        {m('文件没有可读取的元数据')}
                      </Text>
                    )}
                  </section>
                )}
              </>
            )}
            <section className="ml-detail-section">
              <Group justify="space-between" align="center">
                <Group gap={6}>
                  <IconTags size={15} />
                  <Text fw={650} size="sm">
                    {m('标签')}
                  </Text>
                </Group>
                {canEdit && (
                  <Group gap={2}>
                    {kind === 'image' && !!availableTags.length && (
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        leftSection={<IconSparkles size={14} />}
                        onClick={() => openAiSuggestion('tags')}
                      >
                        {m('AI 建议')}
                      </Button>
                    )}
                    <Button size="compact-xs" variant="subtle" onClick={onEditTags}>
                      {m('编辑标签')}
                    </Button>
                  </Group>
                )}
              </Group>
              <Group gap={5} mt="sm">
                {customTags.length ? (
                  customTags.map((tag) => (
                    <Badge key={tag.id} size="sm" variant="light" color="blue">
                      {tag.display_name || tag.name}
                    </Badge>
                  ))
                ) : (
                  <Text size="sm" c="dimmed">
                    {m('暂无自定义标签')}
                  </Text>
                )}
              </Group>
              {!!aiSuggestedTags.length && (
                <div className="ml-ai-tag-suggestions">
                  <Text size="xs" c="dimmed">
                    {m('AI 推荐的已有标签，点击后添加：')}
                  </Text>
                  <Group gap={5} mt={6}>
                    {aiSuggestedTags.map((name) => {
                      const tag = availableTags.find((entry) => entry.name === name)
                      if (!tag || tags.some((entry) => entry.id === tag.id)) return null
                      return (
                        <Button
                          key={name}
                          size="compact-xs"
                          variant="light"
                          loading={applyingTag === name}
                          disabled={!canEdit || !!applyingTag}
                          leftSection={<IconPlus size={12} />}
                          onClick={() => void applySuggestedTag(name)}
                        >
                          {tag.display_name || name}
                        </Button>
                      )
                    })}
                  </Group>
                </div>
              )}
              {aiError && !aiTask && (
                <Alert color="red" mt="sm">
                  {aiError}
                </Alert>
              )}
            </section>
          </Stack>
        )}
      </ScrollArea>

      <Modal
        opened={editField !== null}
        onClose={() => !saving && setEditField(null)}
        title={editField ? fields[editField].title : ''}
        centered
        size="lg"
      >
        <Stack>
          <Textarea
            autoFocus
            aria-label={editField ? fields[editField].title : m('编辑内容')}
            minRows={7}
            maxRows={16}
            autosize
            maxLength={editField ? fields[editField].max : undefined}
            value={draftText}
            onChange={(event) => setDraftText(event.currentTarget.value)}
          />
          {editField === 'generation' && (
            <Text size="xs" c="dimmed">
              {m('保存到媒体索引，不会修改原图片中的内嵌信息。')}
            </Text>
          )}
          {saveError && <Alert color="red">{saveError}</Alert>}
          <Group justify="end">
            <Button variant="default" disabled={saving} onClick={() => setEditField(null)}>
              {m('取消')}
            </Button>
            <Button loading={saving} onClick={() => void saveText()}>
              {m('保存')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={structuredField !== null}
        onClose={() => !saving && setStructuredField(null)}
        title={
          structuredField === 'prompt'
            ? m('编辑正向提示词')
            : structuredField === 'negativePrompt'
              ? m('编辑负向提示词')
              : m('编辑{name}', {
                  name: m(
                    generationParameterFields.find((field) => field.key === structuredField)
                      ?.label ||
                      structuredField ||
                      '参数'
                  )
                })
        }
        centered
        size="lg"
      >
        <Stack>
          {structuredField === 'prompt' || structuredField === 'negativePrompt' ? (
            <Textarea
              autoFocus
              aria-label={m('提示词内容')}
              autosize
              minRows={5}
              maxRows={14}
              value={structuredDraft}
              onChange={(event) => setStructuredDraft(event.currentTarget.value)}
            />
          ) : (
            <TextInput
              autoFocus
              aria-label={m('参数值')}
              placeholder={m(
                generationParameterFields.find((field) => field.key === structuredField)
                  ?.placeholder || ''
              )}
              value={structuredDraft}
              onChange={(event) => setStructuredDraft(event.currentTarget.value)}
            />
          )}
          <Text size="xs" c="dimmed">
            {m('保存到媒体索引，不会修改原图片中的内嵌信息。')}
          </Text>
          {saveError && <Alert color="red">{saveError}</Alert>}
          <Group justify="end">
            <Button variant="default" disabled={saving} onClick={() => setStructuredField(null)}>
              {m('取消')}
            </Button>
            <Button loading={saving} onClick={() => void saveStructured()}>
              {m('保存')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={aiTask !== null}
        onClose={() => {
          if (aiBusy) return
          aiRequestId.current += 1
          setAiTask(null)
        }}
        title={
          aiTask === 'description'
            ? m('AI 建议媒体描述')
            : aiTask === 'prompt'
              ? m('AI 反推参考提示词')
              : m('AI 推荐已有标签')
        }
        centered
        size="lg"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {aiTask === 'tags'
              ? m('仅从现有的 {count} 个标签中推荐，生成后由你选择添加。', {
                  count: Math.min(availableTags.length, 80)
                })
              : m('AI 会根据图片内容生成建议。结果先填入编辑框，请检查并手动保存。')}
          </Text>
          {aiTask !== 'tags' && (
            <Textarea
              label={m('分析要求')}
              description={m('可按这次图片调整，不会修改设置中的默认模板')}
              autosize
              minRows={4}
              maxRows={8}
              value={aiTemplate}
              onChange={(event) => setAiTemplate(event.currentTarget.value)}
            />
          )}
          {aiTask !== 'tags' && (
            <Select
              label={m('建议长度')}
              data={
                aiTask === 'description'
                  ? [
                      { value: '80', label: m('简短 · 80 字') },
                      { value: '120', label: m('标准 · 120 字') },
                      { value: '200', label: m('详细 · 200 字') }
                    ]
                  : [
                      { value: '300', label: m('简短 · 300 字') },
                      { value: '600', label: m('标准 · 600 字') },
                      { value: '1000', label: m('详细 · 1000 字') }
                    ]
              }
              value={String(aiMaxChars)}
              allowDeselect={false}
              onChange={(value) => value && setAiMaxChars(Number(value))}
            />
          )}
          {aiError && <Alert color="red">{aiError}</Alert>}
          <Group justify="end">
            <Button
              variant="default"
              disabled={aiBusy}
              onClick={() => {
                aiRequestId.current += 1
                setAiTask(null)
              }}
            >
              {m('取消')}
            </Button>
            <Button
              loading={aiBusy}
              disabled={aiTask === 'tags' && !availableTags.length}
              leftSection={<IconSparkles size={15} />}
              onClick={() => void generateSuggestion()}
            >
              {m('生成建议')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={audioEditorOpen}
        onClose={() => !saving && setAudioEditorOpen(false)}
        title={m('编辑歌曲信息')}
        centered
        size="lg"
      >
        <Stack>
          <TextInput
            autoFocus
            label={m('歌曲名')}
            placeholder={m('未填写时显示文件名')}
            maxLength={1000}
            value={audioDraft.title}
            onChange={(event) => {
              const title = event.currentTarget.value
              setAudioDraft((old) => ({ ...old, title }))
            }}
          />
          <TextInput
            label={m('艺术家')}
            maxLength={1000}
            value={audioDraft.artist}
            onChange={(event) => {
              const artist = event.currentTarget.value
              setAudioDraft((old) => ({ ...old, artist }))
            }}
          />
          <TextInput
            label={m('专辑')}
            maxLength={1000}
            value={audioDraft.album}
            onChange={(event) => {
              const album = event.currentTarget.value
              setAudioDraft((old) => ({ ...old, album }))
            }}
          />
          <Group align="center" wrap="nowrap">
            <div className="ml-audio-cover-preview">
              {activeCover ? (
                <img src={activeCover} alt={m('歌曲封面预览')} />
              ) : (
                <IconMusic size={32} stroke={1.3} />
              )}
            </div>
            <Stack gap={6}>
              <Button variant="default" size="xs" onClick={() => coverInputRef.current?.click()}>
                {m('替换内嵌封面')}
              </Button>
              {(audio?.cover_source === 'embedded' || coverDraft) && (
                <Button
                  variant="subtle"
                  color="red"
                  size="xs"
                  onClick={() => {
                    setCoverDraft('')
                    setRemoveCover(true)
                  }}
                >
                  {m('移除内嵌封面')}
                </Button>
              )}
              <Text size="xs" c="dimmed">
                {m('JPEG、PNG、WebP · 最大 8 MB')}
              </Text>
            </Stack>
            <input
              ref={coverInputRef}
              hidden
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                chooseCover(event.currentTarget.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          </Group>
          <Text size="xs" c="dimmed">
            {m(
              '保存将写入 MP3 标签和内嵌封面，不重新编码声音。移除内嵌封面后仍可能显示同名或目录封面。'
            )}
          </Text>
          {saveError && <Alert color="red">{saveError}</Alert>}
          <Group justify="end">
            <Button variant="default" disabled={saving} onClick={() => setAudioEditorOpen(false)}>
              {m('取消')}
            </Button>
            <Button loading={saving} onClick={() => void saveAudio()}>
              {m('写入 MP3 文件')}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </aside>
  )
}
