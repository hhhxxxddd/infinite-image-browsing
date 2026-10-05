import test from 'node:test'
import assert from 'node:assert/strict'
import { mapStorage } from '../../../src/features/workspaces/model/workspaceStateStore.ts'
import { workspaceWorksKey } from '../../../src/features/workspaces/model/workspaceWorks.ts'
import {
  audioLoudnessReportsKey,
  loudnessReportStale,
  loudnessSoundRevision,
  readAudioLoudnessReports,
  saveAudioLoudnessReport
} from './audioLoudnessReports.ts'
const setup = () => {
  const values = new Map(),
    storage = mapStorage(values)
  storage.setItem(
    workspaceWorksKey('workspace'),
    JSON.stringify({
      version: 2,
      activeId: 'work',
      works: [{ id: 'work', name: 'Work', drafts: [{ id: 'draft', name: 'Mix', kind: 'audio' }] }]
    })
  )
  return { values, storage }
}
const entry = (id = 'report') => ({
  id,
  createdAt: '2026-10-05T00:00:00Z',
  soundRevision: 'a'.repeat(64),
  report: {
    integrated_lufs: -18,
    loudness_range_lu: 3,
    true_peak_dbfs: -1,
    sample_peak_dbfs: -1.2,
    overload_windows: 0,
    overload_ranges: [],
    start: 0,
    duration: 12,
    sound_revision: 'b'.repeat(64)
  }
})
const request = (id) => ({
  workspaceId: 'workspace',
  draftId: 'draft',
  entry: entry(id),
  readonly: false
})
test('reports persist across reload with bounded count and explicit stale semantics', () => {
  const { storage } = setup()
  for (let i = 0; i < 12; i++) saveAudioLoudnessReport(storage, request('r' + i))
  const loaded = readAudioLoudnessReports(
    storage.getItem(audioLoudnessReportsKey('workspace', 'draft'))
  )
  assert.equal(loaded.entries.length, 8)
  assert.equal(loaded.entries[0].id, 'r11')
  assert.equal(loudnessReportStale(loaded.entries[0], 'a'.repeat(64), 12), false)
  assert.equal(loudnessReportStale(loaded.entries[0], 'c'.repeat(64), 12), true)
  assert.equal(loudnessReportStale(loaded.entries[0], 'a'.repeat(64), 13), true)
})
test('readonly, changed scope, removed draft and changed kind never write reports', () => {
  for (const scenario of ['readonly', 'scope', 'missing', 'kind']) {
    const { storage } = setup(),
      r = request()
    if (scenario === 'readonly') r.readonly = true
    if (scenario === 'scope') r.isCurrent = () => false
    if (scenario === 'missing') storage.removeItem(workspaceWorksKey('workspace'))
    if (scenario === 'kind')
      storage.setItem(
        workspaceWorksKey('workspace'),
        JSON.stringify({
          version: 2,
          works: [
            { id: 'work', name: 'Work', drafts: [{ id: 'draft', name: 'Mix', kind: 'video' }] }
          ]
        })
      )
    assert.throws(() => saveAudioLoudnessReport(storage, r))
    assert.equal(storage.getItem(audioLoudnessReportsKey('workspace', 'draft')), null)
  }
})
test('invalid records and corrupt stores are preserved; unexpected API media is stripped', () => {
  const { storage } = setup(),
    key = audioLoudnessReportsKey('workspace', 'draft')
  storage.setItem(key, 'broken')
  assert.throws(() => saveAudioLoudnessReport(storage, request()))
  assert.equal(storage.getItem(key), 'broken')
  storage.removeItem(key)
  const r = request()
  r.entry.report.media = 'data:audio/wav;base64,secret'
  saveAudioLoudnessReport(storage, r)
  assert.equal(storage.getItem(key).includes('secret'), false)
  const invalid = request('invalid')
  invalid.entry.report.integrated_lufs = Infinity
  assert.throws(() => saveAudioLoudnessReport(storage, invalid))
  assert.equal(readAudioLoudnessReports(storage.getItem(key)).entries.length, 1)
})
test('fingerprints are fixed size and change only when canonical input changes', async () => {
  const a = await loudnessSoundRevision('a'.repeat(1000000))
  assert.match(a, /^[a-f0-9]{64}$/)
  assert.equal(a, await loudnessSoundRevision('a'.repeat(1000000)))
  assert.notEqual(a, await loudnessSoundRevision('b'.repeat(1000000)))
})
