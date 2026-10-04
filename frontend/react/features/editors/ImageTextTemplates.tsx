import { useEffect, useRef, useState } from 'react'
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Menu,
  Modal,
  Pagination,
  Stack,
  Text,
  TextInput,
  Tooltip
} from '@mantine/core'
import { IconDots, IconPencil, IconSearch, IconTrash } from '@tabler/icons-react'
import { apiFetch, apiUrl } from '../../shared/apiClient'
import { renderStudioDocument } from '../../../src/features/image-editor/model/imageStudioRender'
import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import type {
  CreativeTemplate,
  TextTemplate
} from '../../../src/features/image-editor/model/imageTextTemplates'
import { fetchTextTemplate, saveTextTemplate } from './textTemplateApi'
import { textTemplatePreviewBackground } from '../../../src/features/image-editor/model/imageTextTemplates'
import './ImageTextTemplates.css'

export function TextTemplatePreview({
  document,
  assetInfo = {}
}: {
  document: StudioDocument
  assetInfo?: Record<string, FileNodeInfo>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    if (canvas.current)
      void renderStudioDocument(
        canvas.current,
        document,
        assetInfo,
        true,
        { kind: 'all' },
        600,
        false,
        abort.signal
      )
        .then((missing) => {
          if (!abort.signal.aborted) setError(missing.length ? '部分配图不可用' : '')
        })
        .catch(() => {
          if (!abort.signal.aborted) setError('无法生成预览')
        })
    return () => abort.abort()
  }, [document, assetInfo])
  return (
    <div
      className="text-template-preview"
      style={{ backgroundColor: textTemplatePreviewBackground(document) }}
    >
      <canvas ref={canvas} />
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </div>
  )
}

function TemplateCard({
  item,
  busy,
  compact = false,
  onInsert,
  onRename,
  onDelete
}: {
  item: CreativeTemplate
  busy: boolean
  compact?: boolean
  onInsert: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const [record, setRecord] = useState<TextTemplate>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (item.has_preview) return
    const abort = new AbortController()
    void fetchTextTemplate(item.id, abort.signal)
      .then(setRecord)
      .catch((reason) => {
        if (!abort.signal.aborted) setError(String(reason))
      })
    return () => abort.abort()
  }, [item.id, item.updated_at, item.has_preview])
  return (
    <article
      className="text-template-card"
      title={item.builtin ? `${item.name}（预置）` : item.name}
    >
      <button
        className="text-template-insert"
        disabled={busy || (!record && !item.has_preview) || !!error}
        onClick={onInsert}
        aria-label={`添加模板：${item.name}`}
      >
        {item.has_preview ? (
          <div className="text-template-preview">
            <img
              src={apiUrl(`/templates/${item.id}/preview?t=${encodeURIComponent(item.updated_at)}`)}
              alt={item.name}
            />
          </div>
        ) : record ? (
          <TextTemplatePreview document={record.document} />
        ) : (
          <div className="text-template-preview">
            {error ? (
              <Text c="red" size="xs">
                预览不可用
              </Text>
            ) : (
              <Loader size="sm" />
            )}
          </div>
        )}
      </button>
      <Group gap={compact ? 2 : 'xs'} wrap="nowrap" p={compact ? 4 : 'xs'}>
        <Text size={compact ? 'xs' : 'sm'} truncate style={{ flex: 1 }} title={item.name}>
          {item.name}
        </Text>
        {item.builtin && !compact && (
          <Badge size="xs" variant="light" color="gray">
            预置
          </Badge>
        )}
        <Menu position="bottom-end" withinPortal={!compact}>
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              size="sm"
              disabled={busy}
              aria-label={`管理模板：${item.name}`}
            >
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item leftSection={<IconPencil size={14} />} onClick={onRename}>
              重命名
            </Menu.Item>
            <Menu.Item leftSection={<IconTrash size={14} />} color="red" onClick={onDelete}>
              删除模板
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </article>
  )
}

export default function ImageTextTemplates({
  opened,
  onClose,
  onInsert,
  type = 'text',
  inline = false,
  disabled = false
}: {
  opened: boolean
  onClose?: () => void
  onInsert: (template: TextTemplate) => void
  type?: CreativeTemplate['type']
  inline?: boolean
  disabled?: boolean
}) {
  const title = type === 'text' ? '文字模板' : type === 'layout' ? '版式模板' : '整页模板'
  const [query, setQuery] = useState(''),
    [page, setPage] = useState(1)
  const [items, setItems] = useState<CreativeTemplate[]>([]),
    [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false)
  const [error, setError] = useState(''),
    [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState<{ item: CreativeTemplate; kind: 'rename' | 'delete' }>()
  const [name, setName] = useState('')
  const actions = useRef({ onInsert, onClose, opened, disabled })
  actions.current = { onInsert, onClose, opened, disabled }
  useEffect(() => {
    if (!opened) return
    const abort = new AbortController()
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      void apiFetch<{ items: CreativeTemplate[]; total: number }>(
        `/templates?type=${type}&q=${encodeURIComponent(query)}&offset=${(page - 1) * 12}&limit=12`,
        { signal: abort.signal }
      )
        .then((result) => {
          if (!abort.signal.aborted) {
            setItems(result.items)
            setTotal(result.total)
            if (page > 1 && !result.items.length) setPage(page - 1)
          }
        })
        .catch((reason) => {
          if (!abort.signal.aborted) setError(String(reason))
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false)
        })
    }, 180)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [opened, query, page, revision, type])
  async function insert(item: CreativeTemplate) {
    if (busy || disabled) return
    setBusy(true)
    setError('')
    try {
      const template = await apiFetch<TextTemplate>(`/templates/${item.id}/instantiate`, {
        method: 'POST'
      })
      if (!actions.current.opened || actions.current.disabled) return
      actions.current.onInsert(template)
      actions.current.onClose?.()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  async function manage() {
    if (!editing) return
    setBusy(true)
    setError('')
    try {
      await apiFetch(
        `/templates/${editing.item.id}`,
        editing.kind === 'delete'
          ? { method: 'DELETE' }
          : { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) }
      )
      setEditing(undefined)
      setRevision((value) => value + 1)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  const library = (
    <Stack
      gap={inline ? 'xs' : 'md'}
      className={inline ? 'text-template-library-inline' : undefined}
    >
      {!inline && (
        <Text size="xs" c="dimmed">
          {type === 'text'
            ? '媒体库和所有工作区共用 · 点击预览添加到画布，文字和特效均可继续编辑'
            : type === 'layout'
              ? '媒体库和所有工作区共用 · 版式按当前画布适配，保留现有图片和文字。'
              : '媒体库和所有工作区共用 · 应用整页模板前可预览确认，所有图层均可继续编辑。'}
        </Text>
      )}
      <TextInput
        aria-label={`搜索${title}`}
        placeholder={inline ? '搜索文字模板' : '搜索模板名称'}
        size={inline ? 'xs' : 'sm'}
        leftSection={<IconSearch size={16} />}
        value={query}
        maxLength={120}
        onChange={(event) => {
          setQuery(event.currentTarget.value)
          setPage(1)
        }}
      />
      {error && <Alert color="red">{error}</Alert>}
      <div className={inline ? 'text-template-results' : undefined} aria-busy={loading}>
        {loading ? (
          <Group justify="center" p="xl">
            <Loader size="sm" />
          </Group>
        ) : (
          <>
            <div className="text-template-grid">
              {items.map((item) => (
                <TemplateCard
                  key={item.id}
                  item={item}
                  busy={busy || disabled}
                  compact={inline}
                  onInsert={() => void insert(item)}
                  onRename={() => {
                    setEditing({ item, kind: 'rename' })
                    setName(item.name)
                  }}
                  onDelete={() => setEditing({ item, kind: 'delete' })}
                />
              ))}
            </div>
            {!items.length && (
              <Text ta="center" c="dimmed" py="xl">
                {query
                  ? `没有匹配的${title}`
                  : type === 'text'
                    ? '还没有文字模板。右键文字图层或含文字的分组，即可保存。'
                    : '还没有保存的模板，可在版式面板中保存当前设计。'}
              </Text>
            )}
            {total > 12 && (
              <Pagination
                siblings={inline ? 0 : 1}
                total={Math.ceil(total / 12)}
                value={page}
                onChange={setPage}
                size="sm"
              />
            )}
          </>
        )}
      </div>
    </Stack>
  )
  const management = (
    <Stack>
      {editing?.kind === 'delete' ? (
        <Text size="sm">删除「{editing.item.name}」？已经套用的作品不会受影响。</Text>
      ) : (
        <TextInput
          label="模板名称"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.currentTarget.value)}
          data-autofocus
        />
      )}
      {error && <Alert color="red">{error}</Alert>}
      <Group justify="flex-end">
        <Button variant="default" disabled={busy} onClick={() => setEditing(undefined)}>
          取消
        </Button>
        <Button
          color={editing?.kind === 'delete' ? 'red' : undefined}
          loading={busy}
          disabled={editing?.kind === 'rename' && !name.trim()}
          onClick={() => void manage()}
        >
          {editing?.kind === 'delete' ? '删除' : '保存'}
        </Button>
      </Group>
    </Stack>
  )
  return (
    <>
      {inline ? (
        opened &&
        (editing ? (
          <Stack gap="xs" className="text-template-library-inline">
            <Text size="xs" fw={600}>
              {editing.kind === 'delete' ? `删除${title}` : '重命名模板'}
            </Text>
            {management}
          </Stack>
        ) : (
          library
        ))
      ) : (
        <Modal
          opened={opened}
          onClose={() => {
            if (!busy) onClose?.()
          }}
          title={title}
          size={800}
          centered
          closeOnClickOutside={!busy}
          closeOnEscape={!busy}
        >
          {library}
        </Modal>
      )}
      {!inline && (
        <Modal
          opened={!!editing}
          onClose={() => {
            if (!busy) setEditing(undefined)
          }}
          title={editing?.kind === 'delete' ? `删除${title}` : '重命名模板'}
          centered
          size="sm"
          closeOnEscape={!busy}
          closeOnClickOutside={!busy}
        >
          {management}
        </Modal>
      )}
    </>
  )
}

export function SaveTextTemplateModal({
  document,
  assetInfo,
  onClose,
  onSaved,
  type = 'text'
}: {
  document?: StudioDocument
  assetInfo: Record<string, FileNodeInfo>
  onClose: () => void
  onSaved: () => void
  type?: CreativeTemplate['type']
}) {
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    setName(document?.name || '文字模板')
    setError('')
  }, [document])
  async function save() {
    if (!document) return
    setBusy(true)
    setError('')
    try {
      await saveTextTemplate(name.trim(), document, assetInfo, type)
      onSaved()
      onClose()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      opened={!!document}
      onClose={() => {
        if (!busy) onClose()
      }}
      title={
        type === 'text' ? '保存为文字模板' : type === 'layout' ? '保存为版式模板' : '保存为整页模板'
      }
      centered
      size="md"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Stack>
        {document && <TextTemplatePreview document={document} assetInfo={assetInfo} />}
        <TextInput
          label="模板名称"
          value={name}
          maxLength={120}
          onChange={(event) => setName(event.currentTarget.value)}
          data-autofocus
        />
        <Text size="xs" c="dimmed">
          {type === 'layout'
            ? '只保存画框形状、边框和位置；不包含图片或对白。'
            : '完整保存图层、配图和特效，可在媒体库及任意工作区中使用。'}
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Tooltip label="保存到共享模板库">
            <Button disabled={!name.trim()} loading={busy} onClick={() => void save()}>
              保存模板
            </Button>
          </Tooltip>
        </Group>
      </Stack>
    </Modal>
  )
}
