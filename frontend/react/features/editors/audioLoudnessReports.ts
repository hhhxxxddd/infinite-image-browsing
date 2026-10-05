import {
  assertProductionDraftExists,
  createWorkspaceWorksRepository
} from '../../../src/features/workspaces/model/workspaceWorks.ts'

export interface AudioLoudnessReport {
  integrated_lufs: number | null
  loudness_range_lu: number | null
  true_peak_dbfs: number | null
  sample_peak_dbfs: number | null
  overload_windows: number
  overload_ranges: Array<{ start: number; end: number }>
  start: number
  duration: number
  sound_revision: string
}
export interface SavedAudioLoudnessReport {
  id: string
  createdAt: string
  soundRevision: string
  report: AudioLoudnessReport
}
export interface AudioLoudnessReports {
  version: 1
  entries: SavedAudioLoudnessReport[]
}
export const audioLoudnessReportsKey = (workspaceId: string, draftId: string) =>
  `omnigallery:audio-loudness-reports-v1:${workspaceId}:${draftId}`
const byteLimit = 256 * 1024
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

export async function loudnessSoundRevision(signature: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

export function readAudioLoudnessReports(raw: string | null): AudioLoudnessReports {
  if (raw === null) return { version: 1, entries: [] }
  const fail = (): never => {
    throw new Error('响度报告无法读取，原始记录已保留')
  }
  if (new TextEncoder().encode(raw).byteLength > byteLimit) return fail()
  let value: AudioLoudnessReports
  try {
    value = JSON.parse(raw) as AudioLoudnessReports
  } catch {
    return fail()
  }
  if (!value || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 8)
    return fail()
  const ids = new Set<string>()
  for (const entry of value.entries) {
    const report = entry?.report
    if (
      !entry ||
      typeof entry.id !== 'string' ||
      !/^[\w-]{1,80}$/.test(entry.id) ||
      ids.has(entry.id) ||
      !Number.isFinite(Date.parse(entry.createdAt)) ||
      !hash(entry.soundRevision) ||
      !report ||
      !hash(report.sound_revision) ||
      !Number.isFinite(report.start) ||
      report.start < 0 ||
      !Number.isFinite(report.duration) ||
      report.duration <= 0 ||
      report.start + report.duration > 86400 + 1 / 48000 ||
      !Number.isSafeInteger(report.overload_windows) ||
      report.overload_windows < 0 ||
      !Array.isArray(report.overload_ranges) ||
      report.overload_ranges.length > 128 ||
      ['integrated_lufs', 'loudness_range_lu', 'true_peak_dbfs', 'sample_peak_dbfs'].some(
        (field) => {
          const number = report[field as keyof AudioLoudnessReport]
          return number !== null && (typeof number !== 'number' || !Number.isFinite(number))
        }
      ) ||
      report.overload_ranges.some(
        (range) =>
          !range ||
          !Number.isFinite(range.start) ||
          !Number.isFinite(range.end) ||
          range.start < report.start ||
          range.end <= range.start ||
          range.end > report.start + report.duration + 1 / 48000
      )
    )
      return fail()
    ids.add(entry.id)
  }
  return value
}

/** Must execute inside the workspace transaction; no document or media bytes are stored. */
export function saveAudioLoudnessReport(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  request: {
    workspaceId: string
    draftId: string
    entry: SavedAudioLoudnessReport
    readonly: boolean
    isCurrent?: () => boolean
  }
): AudioLoudnessReports {
  if (request.readonly || request.isCurrent?.() === false)
    throw new Error('编辑器已切换或不可写，未保存响度报告')
  const { workspaceId, draftId, entry } = request
  assertProductionDraftExists(storage, workspaceId, draftId)
  const draft = createWorkspaceWorksRepository(workspaceId, storage)
    .load()
    .works.flatMap((work) => work.drafts)
    .find((item) => item.id === draftId)
  if (draft?.kind !== 'audio') throw new Error('制作文件类型已变化，未保存响度报告')
  const key = audioLoudnessReportsKey(workspaceId, draftId)
  const existing = readAudioLoudnessReports(storage.getItem(key))
  // Copy the allowed fields so unexpected API extensions can never embed source media.
  const r = entry.report
  if (
    [r.integrated_lufs, r.loudness_range_lu, r.true_peak_dbfs, r.sample_peak_dbfs].some(
      (value) => value !== null && !Number.isFinite(value)
    )
  )
    throw new Error('响度报告测量值无效，未覆盖原始记录')
  const copy: SavedAudioLoudnessReport = {
    id: entry.id,
    createdAt: entry.createdAt,
    soundRevision: entry.soundRevision,
    report: {
      integrated_lufs: r.integrated_lufs,
      loudness_range_lu: r.loudness_range_lu,
      true_peak_dbfs: r.true_peak_dbfs,
      sample_peak_dbfs: r.sample_peak_dbfs,
      overload_windows: r.overload_windows,
      overload_ranges: r.overload_ranges.map(({ start, end }) => ({ start, end })),
      start: r.start,
      duration: r.duration,
      sound_revision: r.sound_revision
    }
  }
  const result: AudioLoudnessReports = {
    version: 1,
    entries: [copy, ...existing.entries.filter((item) => item.id !== copy.id)].slice(0, 8)
  }
  const raw = JSON.stringify(result)
  readAudioLoudnessReports(raw)
  if (request.isCurrent?.() === false) throw new Error('编辑器已切换，未保存响度报告')
  storage.setItem(key, raw)
  return result
}

export const loudnessReportStale = (
  entry: SavedAudioLoudnessReport,
  revision: string,
  duration: number
) => entry.soundRevision !== revision || Math.abs(entry.report.duration - duration) > 1 / 48000
