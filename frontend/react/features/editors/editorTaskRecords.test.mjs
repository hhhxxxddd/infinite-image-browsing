import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorTaskRecords } from './editorTaskRecords.ts'

test('late polls and reopened panel props cannot restore successfully removed records', () => {
  const records = new EditorTaskRecords()
  const pollStartedBeforeDelete = [
    { id: 'removed', state: 'completed' },
    { id: 'keep', state: 'running' }
  ]
  records.remove('video-export', 'workspace', 'removed')
  assert.deepEqual(
    records.filter('video-export', 'workspace', pollStartedBeforeDelete).map((task) => task.id),
    ['keep']
  )
  assert.deepEqual(
    records
      .filter('video-export', 'workspace', [...pollStartedBeforeDelete])
      .map((task) => task.id),
    ['keep']
  )
})

test('removal notifications immediately update mounted owners without affecting other sources or owners', () => {
  const records = new EditorTaskRecords()
  let jobs = [{ id: 'done', state: 'completed' }]
  const unsubscribe = records.subscribe(({ source, owner }) => {
    if (source === 'image-tools' && owner === 'media-document-key')
      jobs = records.filter(source, owner, jobs)
  })
  records.remove('image-ai', 'workspace', 'done')
  assert.equal(jobs.length, 1)
  records.remove('image-tools', 'other-document-key', 'done')
  assert.equal(jobs.length, 1)
  records.remove('image-tools', 'media-document-key', 'done')
  assert.equal(jobs.length, 0)
  unsubscribe()
  assert.equal(records.filter('image-tools', 'new-document-key', [{ id: 'done' }]).length, 1)
})

test('deleted server responses stay hidden and proxy hide only affects the current document session', () => {
  const records = new EditorTaskRecords()
  assert.equal(
    records.filter('audio-export', 'workspace', [{ id: 'done', deleted: true }]).length,
    0
  )
  records.remove('video-proxy', JSON.stringify(['workspace', 'doc-1']), 'proxy')
  assert.equal(
    records.filter('video-proxy', JSON.stringify(['workspace', 'doc-1']), [{ id: 'proxy' }]).length,
    0
  )
  assert.equal(
    records.filter('video-proxy', JSON.stringify(['workspace', 'doc-2']), [{ id: 'proxy' }]).length,
    1
  )
})
