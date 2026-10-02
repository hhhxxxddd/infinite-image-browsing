import assert from 'node:assert/strict'
import test from 'node:test'
import { readWorkbenchSort, sortWorkbenchCards, workbenchCardDate } from './workbenchCardOrder.ts'
import {
  createWorkspaceWork,
  createWorkspaceWorksRepository
} from '../../../src/features/workspaces/model/workspaceWorks.ts'

const ids = (items) => items.map((item) => item.id)
const cards = [
  {
    id: 'old',
    name: '旧作品',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    lastOpenedAt: '2026-10-02T00:00:00Z'
  },
  {
    id: 'new',
    name: '新作品',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    lastOpenedAt: '2026-09-30T00:00:00Z'
  }
]

test('date ordering stays independent of recently opening an older card and never mutates source order', () => {
  assert.deepEqual(ids(sortWorkbenchCards(cards, 'recent')), ['old', 'new'])
  assert.deepEqual(ids(sortWorkbenchCards(cards, 'created-desc')), ['new', 'old'])
  assert.deepEqual(ids(sortWorkbenchCards(cards, 'created-asc')), ['old', 'new'])
  assert.deepEqual(ids(sortWorkbenchCards(cards, 'updated-desc')), ['new', 'old'])
  assert.deepEqual(ids(sortWorkbenchCards(cards, 'updated-asc')), ['old', 'new'])
  assert.deepEqual(ids(cards), ['old', 'new'])
})

test('sorts actual instants across timezone offsets instead of comparing date strings', () => {
  const items = [
    { ...cards[0], createdAt: '2026-10-02T10:00:00+08:00' },
    { ...cards[1], createdAt: '2026-10-02T03:00:00Z' }
  ]
  assert.deepEqual(ids(sortWorkbenchCards(items, 'created-desc')), ['new', 'old'])
})

test('updated ordering includes edits to contained drafts without changing the creation date', () => {
  const edited = { ...cards[0], drafts: [{ updatedAt: '2026-10-03T00:00:00Z' }] }
  assert.deepEqual(ids(sortWorkbenchCards([edited, cards[1]], 'updated-desc')), ['old', 'new'])
  assert.equal(workbenchCardDate(edited, 'created-desc').timestamp, Date.parse(edited.createdAt))
  assert.equal(workbenchCardDate(edited, 'recent').timestamp, Date.parse(edited.lastOpenedAt))
})

test('legacy missing or invalid dates use a valid fallback and unknown dates stay last in both directions', () => {
  const missing = { ...cards[0], createdAt: '', updatedAt: '', lastOpenedAt: 'invalid' }
  const fallback = { ...cards[1], createdAt: 'invalid', lastOpenedAt: 'invalid' }
  for (const order of ['created-asc', 'created-desc', 'recent']) {
    assert.deepEqual(ids(sortWorkbenchCards([missing, fallback], order)), ['new', 'old'])
  }
  assert.equal(workbenchCardDate(fallback, 'recent').label, '更新')
  assert.equal(readWorkbenchSort('unknown'), 'recent')
  assert.equal(readWorkbenchSort(null), 'recent')
})

test('same-date ordering is deterministic even if source order changes', () => {
  const a = { ...cards[0], id: 'a', name: '作品 2' }
  const b = { ...a, id: 'b', name: '作品 10' }
  assert.deepEqual(ids(sortWorkbenchCards([b, a], 'created-desc')), ['a', 'b'])
  assert.deepEqual(ids(sortWorkbenchCards([a, b], 'created-desc')), ['a', 'b'])
})

test('work usage date survives repository normalization without altering edit or creation dates', () => {
  const values = new Map()
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  }
  const repo = createWorkspaceWorksRepository('sorting-test', storage)
  const work = { ...createWorkspaceWork('作品', 'work'), lastOpenedAt: '2026-10-02T00:00:00Z' }
  repo.save({ version: 2, activeId: work.id, works: [work] })
  assert.equal(repo.load().works[0].lastOpenedAt, work.lastOpenedAt)
  assert.equal(repo.load().works[0].updatedAt, work.updatedAt)
  assert.equal(repo.load().works[0].createdAt, work.createdAt)
  repo.save({ version: 2, activeId: work.id, works: [{ ...work, lastOpenedAt: 'invalid' }] })
  assert.equal(repo.load().works[0].lastOpenedAt, undefined)
})
