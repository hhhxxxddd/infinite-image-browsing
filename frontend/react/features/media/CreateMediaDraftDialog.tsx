import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Group, Loader, Modal, Select, Stack, Text, TextInput } from '@mantine/core'
import { fileDisplayName } from '../../../src/shared/lib/fileDisplayName'
import type { WorkspaceRecord } from '../../../src/features/workspaces/model/workspaceModel'
import {
  createMediaDraft,
  readMediaDraftTarget,
  readMediaDraftWorkspaces
} from './createMediaDraft'
import type { MediaDraftTarget } from './mediaDraftModel'
import type { MediaFile } from './mediaApi'
import { useMediaText } from './mediaLocale'

const NEW_WORKSPACE = '__new-workspace__'
const NEW_WORK = '__new-work__'

interface CreateMediaDraftDialogProps {
  file: MediaFile
  onClose: () => void
  onCreated: (result: { kind: 'image' | 'audio' | 'video'; draftId: string }) => void
}

export default function CreateMediaDraftDialog({
  file,
  onClose,
  onCreated
}: CreateMediaDraftDialogProps) {
  const m = useMediaText()
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaceName, setWorkspaceName] = useState(fileDisplayName(file.name))
  const [target, setTarget] = useState<MediaDraftTarget | null>(null)
  const [workId, setWorkId] = useState('')
  const [workName, setWorkName] = useState(fileDisplayName(file.name))
  const [name, setName] = useState(`${fileDisplayName(file.name)} · 制作`)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [targetLoading, setTargetLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  // Stable IDs let a retry reuse a workspace already saved before a later draft write failed.
  const [newWorkspaceId] = useState(() => crypto.randomUUID())
  const [newWorkId] = useState(() => crypto.randomUUID())
  const submitting = useRef(false)
  const isNewWorkspace = workspaceId === NEW_WORKSPACE
  const isNewWork = workId === NEW_WORK
  const currentTarget = target?.workspaceId === workspaceId ? target : null
  const selectionReady = isNewWorkspace || !!currentTarget
  const canCreate =
    !loading &&
    ready &&
    !targetLoading &&
    selectionReady &&
    !!name.trim() &&
    (!isNewWorkspace || !!workspaceName.trim()) &&
    (!isNewWorkspace || isNewWork) &&
    !!workId &&
    (!isNewWork || !!workName.trim())

  useEffect(() => {
    let live = true
    void readMediaDraftWorkspaces()
      .then(({ workspaces: records, preferredWorkspaceId }) => {
        if (!live) return
        setWorkspaces(records)
        setReady(true)
        setWorkspaceId(preferredWorkspaceId || NEW_WORKSPACE)
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : '工作区读取失败')
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    let live = true
    setTarget(null)
    setWorkId('')
    setTargetLoading(false)
    if (workspaceId === NEW_WORKSPACE) {
      setWorkId(NEW_WORK)
      return
    }
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (!workspace) return
    setTargetLoading(true)
    setError('')
    void readMediaDraftTarget(workspace)
      .then((next) => {
        if (!live) return
        setTarget(next)
        setWorkId(next.preferredWorkId || NEW_WORK)
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : '作品读取失败')
      })
      .finally(() => {
        if (live) setTargetLoading(false)
      })
    return () => {
      live = false
    }
  }, [workspaceId, workspaces])

  async function finishCreate() {
    if (!canCreate || submitting.current) return
    submitting.current = true
    setCreating(true)
    setError('')
    try {
      const result = await createMediaDraft(
        file,
        {
          workspace: isNewWorkspace
            ? { newId: newWorkspaceId, name: workspaceName }
            : { id: workspaceId },
          work: isNewWork ? { newId: newWorkId, name: workName } : { id: workId }
        },
        name
      )
      onCreated(result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m('创建失败，请重试'))
    } finally {
      submitting.current = false
      setCreating(false)
    }
  }

  return (
    <Modal
      opened
      onClose={() => !creating && onClose()}
      title={m('从媒体新建制作')}
      centered
      closeOnClickOutside={!creating}
      closeOnEscape={!creating}
      closeButtonProps={{ disabled: creating }}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {file.name}
        </Text>
        {error && <Alert color="red">{error}</Alert>}
        {loading ? (
          <Loader size="sm" aria-label={m('正在读取工作区')} />
        ) : ready ? (
          <Select
            label={m('工作区')}
            searchable
            allowDeselect={false}
            value={workspaceId || null}
            disabled={creating}
            onChange={(value) => {
              setError('')
              setWorkspaceId(value || '')
            }}
            data={[
              ...workspaces.map((workspace) => ({
                value: workspace.id,
                label: `${workspace.name}${workspace.status === 'paused' ? ` ${m('（已搁置）')}` : ''}`
              })),
              {
                value: NEW_WORKSPACE,
                label: m('＋ 新建工作区'),
                disabled: workspaces.length >= 100
              }
            ]}
          />
        ) : null}
        {isNewWorkspace && (
          <TextInput
            label={m('工作区名称')}
            value={workspaceName}
            maxLength={80}
            disabled={creating}
            onChange={(event) => setWorkspaceName(event.currentTarget.value)}
          />
        )}
        {targetLoading && <Loader size="sm" aria-label={m('正在读取作品')} />}
        {selectionReady && (
          <>
            {currentTarget && (
              <Select
                label={m('目标作品')}
                allowDeselect={false}
                value={workId}
                disabled={creating}
                onChange={(value) => setWorkId(value || '')}
                data={[
                  ...currentTarget.works.map((work) => ({ value: work.id, label: work.name })),
                  {
                    value: NEW_WORK,
                    label: m('＋ 新建作品'),
                    disabled: currentTarget.works.length >= 200
                  }
                ]}
              />
            )}
            {isNewWork && (
              <TextInput
                label={m('作品名称')}
                value={workName}
                maxLength={80}
                disabled={creating}
                onChange={(event) => setWorkName(event.currentTarget.value)}
              />
            )}
            <TextInput
              label={m('制作文件名称')}
              value={name}
              maxLength={80}
              disabled={creating}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={creating}>
            {m('取消')}
          </Button>
          <Button loading={creating} disabled={!canCreate} onClick={() => void finishCreate()}>
            {m('创建并编辑')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
