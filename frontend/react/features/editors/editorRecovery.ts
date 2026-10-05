import {
  assertProductionDraftExists,
  createWorkspaceWorksRepository,
  storageTransaction
} from '../../../src/features/workspaces/model/workspaceWorks.ts'
import { readAudioTimeline } from '../../../src/features/media-editor/model/audioTimeline.ts'
import { readDocument } from './videoStudioModel.ts'
import {
  documentFromEditorVersion,
  editorVersionsKey,
  readEditorVersions,
  type EditorVersionKind
} from './editorVersionModel.ts'

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface EditorRecoveryBackup {
  id: string
  createdAt: string
  kind: EditorVersionKind
  name: string
  versionId: string
  versionName: string
  bytes: number
}
export interface EditorRecoveryRequest {
  workspaceId: string
  draftId: string
  kind: EditorVersionKind
  name: string
  expectedRaw: string
  versionId: string
  backupId: string
  createdAt: string
  readonly?: boolean
  isCurrent?: () => boolean
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)
export const editorRecoveryLimit = 100
export const editorRecoveryPrefix = (workspaceId: string, draftId: string) =>
  `omnigallery:editor-recovery-v1:${workspaceId}:${draftId}:`
export const editorRecoveryIndexKey = (workspaceId: string, draftId: string) =>
  `${editorRecoveryPrefix(workspaceId, draftId)}index`
export const editorRecoveryRawKey = (workspaceId: string, draftId: string, id: string) => {
  if (!validId(id) || id === 'index') throw new Error('恢复副本编号无效')
  return `${editorRecoveryPrefix(workspaceId, draftId)}${id}`
}
export const editorTimelineStorageKey = (
  workspaceId: string,
  draftId: string,
  kind: EditorVersionKind
) => `omnigallery:${kind}-timeline-v1:${workspaceId}:${draftId}`

export function parseRecoveryDocument(kind: EditorVersionKind, raw: string) {
  return kind === 'audio' ? readAudioTimeline(raw) : readDocument(raw)
}
export function readEditorRecoveries(raw: string | null): EditorRecoveryBackup[] {
  if (raw === null) return []
  const fail = () => {
    throw new Error('损坏副本索引无法读取，现有副本已保留')
  }
  let value: { version: number; entries: EditorRecoveryBackup[] }
  try {
    value = JSON.parse(raw)
  } catch {
    return fail()
  }
  if (!value || value.version !== 1 || !Array.isArray(value.entries)) return fail()
  const ids = new Set<string>()
  for (const entry of value.entries) {
    if (
      !entry ||
      !validId(entry.id) ||
      entry.id === 'index' ||
      ids.has(entry.id) ||
      !['audio', 'video'].includes(entry.kind) ||
      typeof entry.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(entry.createdAt)) ||
      typeof entry.name !== 'string' ||
      entry.name.length > 80 ||
      typeof entry.versionId !== 'string' ||
      !entry.versionId ||
      typeof entry.versionName !== 'string' ||
      !entry.versionName ||
      entry.versionName.length > 80 ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0
    )
      return fail()
    ids.add(entry.id)
  }
  return value.entries
}

/** Call inside mutateWorkspaceState: raw backup, index and restored timeline share one durable write. */
export function recoverEditorDocument(storage: RecoveryStorage, request: EditorRecoveryRequest) {
  const assertWritable = () => {
    if (request.readonly || request.isCurrent?.() === false)
      throw new Error('编辑器已切换或不可写，未恢复制作文件')
  }
  assertWritable()
  const { workspaceId, draftId, kind, expectedRaw } = request
  assertProductionDraftExists(storage, workspaceId, draftId)
  const draft = createWorkspaceWorksRepository(workspaceId, storage)
    .load()
    .works.flatMap((work) => work.drafts)
    .find((item) => item.id === draftId)
  if (draft?.kind !== kind) throw new Error('制作文件类型已变化，请重新打开作品')
  const versions = readEditorVersions(storage.getItem(editorVersionsKey(workspaceId, draftId)))
  const version = versions.entries.find((entry) => entry.id === request.versionId)
  if (!version) throw new Error('所选历史版本已不存在，请刷新后重试')
  const restored = documentFromEditorVersion(version, kind, (raw) =>
    parseRecoveryDocument(kind, raw)
  )
  const restoredRaw = JSON.stringify(restored)
  const timelineKey = editorTimelineStorageKey(workspaceId, draftId, kind)
  const indexKey = editorRecoveryIndexKey(workspaceId, draftId)
  const rawKey = editorRecoveryRawKey(workspaceId, draftId, request.backupId)
  const entries = readEditorRecoveries(storage.getItem(indexKey))
  const existing = entries.find((entry) => entry.id === request.backupId)
  if (existing) {
    if (
      existing.kind === kind &&
      existing.versionId === version.id &&
      storage.getItem(rawKey) === expectedRaw &&
      storage.getItem(timelineKey) === restoredRaw
    )
      return { backup: existing, restored, alreadyApplied: true }
    throw new Error('恢复记录已变化，请刷新后重试')
  }
  if (storage.getItem(rawKey) !== null) throw new Error('损坏副本已存在，未覆盖任何内容')
  if (storage.getItem(timelineKey) !== expectedRaw)
    throw new Error('制作文件已在其他窗口更新，请重新加载后再恢复')
  let damaged = false
  try {
    parseRecoveryDocument(kind, expectedRaw)
  } catch {
    damaged = true
  }
  if (!damaged) throw new Error('当前制作文件可以正常读取，请重新加载编辑器')
  if (entries.length >= editorRecoveryLimit)
    throw new Error('损坏副本已达到保存上限，未覆盖原始数据；请先下载副本并联系维护人员')
  const backup: EditorRecoveryBackup = {
    id: request.backupId,
    createdAt: request.createdAt,
    kind,
    name: request.name.slice(0, 80),
    versionId: version.id,
    versionName: version.name,
    bytes: new TextEncoder().encode(expectedRaw).byteLength
  }
  const indexRaw = JSON.stringify({ version: 1, entries: [backup, ...entries] })
  readEditorRecoveries(indexRaw)
  assertWritable()
  return storageTransaction(storage, [rawKey, indexKey, timelineKey], () => {
    // Store the exact string separately: wrapping it in JSON can double the entry size.
    storage.setItem(rawKey, expectedRaw)
    storage.setItem(indexKey, indexRaw)
    storage.setItem(timelineKey, restoredRaw)
    return { backup, restored, alreadyApplied: false }
  })
}
