import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sourceMetadata,
  initialSourceRange,
  initialSourceRangeForMode,
  sourceRangeError,
  sourceModeError,
  setSourceRangeEndpoint,
  sourceRangeSelection,
  sourceStreamPath,
  sourceMetadataPath
} from './sourceRange.ts'

const video = { path: 'E:\\media\\8h film.mp4', name: '8h film.mp4', kind: 'video' }
const info = sourceMetadata(
  { duration: 8 * 3600, width: 3840, height: 2160, fps: 30, has_audio: true, fingerprint: 'v1' },
  'video'
)

test('long originals can supply a short range beyond the six-hour timeline limit', () => {
  assert.deepEqual(initialSourceRange(info.duration), { start: 0, end: 21600 })
  const selection = sourceRangeSelection(
    video,
    info,
    { start: 7 * 3600, end: 7 * 3600 + 30 },
    'default'
  )
  assert.equal(selection.sourceIn, 25200)
  assert.equal(selection.duration, 30)
  assert.equal(selection.sourceDuration, 28800)
  assert.equal(selection.asset, video)
})

test('initial sound ranges respect shorter audio streams without silently shortening later selections', () => {
  const metadata = sourceMetadata(
    {
      duration: 634.56665,
      width: 3840,
      height: 2160,
      has_audio: true,
      audio_streams: [
        { ordinal: 0, duration: 631.808 },
        { ordinal: 1, duration: 600 }
      ]
    },
    'video'
  )
  for (const mode of ['default', 'sound']) {
    const range = initialSourceRangeForMode(metadata, mode)
    assert.deepEqual(range, { start: 0, end: 631.808 })
    assert.equal(sourceRangeSelection(video, metadata, range, mode).duration, 631.808)
    assert.throws(() => sourceRangeSelection(video, metadata, range, mode, 21600, 1), /过短/)
    assert.deepEqual(range, { start: 0, end: 631.808 })
  }
  const full = initialSourceRangeForMode(metadata, 'visual')
  assert.deepEqual(full, { start: 0, end: 634.56665 })
  assert.throws(() => sourceRangeSelection(video, metadata, full, 'sound'), /过短/)
  assert.deepEqual(initialSourceRangeForMode(metadata, 'sound', 30), { start: 0, end: 30 })
})

test('out-of-bounds, empty and oversized ranges reject rather than silently shorten', () => {
  for (const range of [
    { start: -1, end: 5 },
    { start: 5, end: 5 },
    { start: 10, end: 5 },
    { start: 0, end: 28801 },
    { start: 0, end: 21601 }
  ]) {
    assert.ok(sourceRangeError(range, info.duration))
    assert.throws(() => sourceRangeSelection(video, info, range, 'visual'))
  }
  assert.ok(sourceRangeError({ start: 0, end: 5 }, NaN))
  assert.equal(sourceRangeError({ start: 0, end: 25200 }, info.duration, 86400), '')
})

test('I/O edits beyond the opposite point preserve an interval and reject impossible endpoints', () => {
  assert.deepEqual(setSourceRangeEndpoint({ start: 0, end: 10 }, 'start', 20, 40), {
    start: 20,
    end: 30
  })
  assert.deepEqual(setSourceRangeEndpoint({ start: 20, end: 30 }, 'end', 5, 40), {
    start: 0,
    end: 5
  })
  assert.equal(setSourceRangeEndpoint({ start: 0, end: 10 }, 'start', 40, 40), undefined)
  assert.equal(setSourceRangeEndpoint({ start: 0, end: 10 }, 'end', 0, 40), undefined)
})

test('metadata must prove duration and streams instead of trusting library labels', () => {
  for (const duration of [0, -1, Infinity, NaN, undefined]) {
    assert.throws(() => sourceMetadata({ duration }, 'audio'))
  }
  assert.throws(() => sourceMetadata({ duration: 4, width: 0, height: 0 }, 'video'))
  assert.throws(() => sourceMetadata({ width: 0, height: 800 }, 'image'))
  assert.ok(sourceModeError(video, { ...info, hasAudio: false }, 'sound'))
  assert.equal(sourceModeError(video, { ...info, hasAudio: false }, 'visual'), '')
  assert.ok(sourceModeError({ ...video, kind: 'audio' }, { ...info, hasVideo: false }, 'visual'))
})

test('original media URLs preserve paths and use native streaming/authorized artifact endpoints', () => {
  const url = new URL(sourceStreamPath(video), 'http://localhost')
  assert.equal(url.pathname, '/stream_video')
  assert.equal(url.searchParams.get('path'), video.path)
  assert.equal(
    sourceStreamPath({ ...video, path: 'workspace-artifact:abc' }),
    '/workspace_artifacts/abc/file'
  )
  const query = new URL(sourceMetadataPath('workspace', video), 'http://localhost')
  assert.equal(query.searchParams.get('workspace_id'), 'workspace')
  assert.equal(query.searchParams.get('kind'), 'video')
})
