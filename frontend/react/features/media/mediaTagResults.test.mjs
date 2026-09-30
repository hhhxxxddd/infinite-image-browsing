import assert from 'node:assert/strict'
import test from 'node:test'

import { completeMediaTagResults } from './mediaTagResults.ts'

test('an omitted zero-tag file clears a previously cached final tag', () => {
  const cached = { '/music/song.mp3': [{ id: 1, name: 'like' }] }
  const refreshed = completeMediaTagResults(['/music/song.mp3'], {})
  assert.deepEqual({ ...cached, ...refreshed }, { '/music/song.mp3': [] })
})

test('a batch refresh preserves tagged files while clearing each omitted path', () => {
  const remaining = [{ id: 2, name: 'music' }]
  assert.deepEqual(
    completeMediaTagResults(['/a.mp3', '/b.mp3', '/c.mp3'], { '/b.mp3': remaining }),
    { '/a.mp3': [], '/b.mp3': remaining, '/c.mp3': [] }
  )
})
