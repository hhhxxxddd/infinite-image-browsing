import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createAudioClip,
  createAudioTimeline,
  audioTimelineKey
} from '../../../src/features/media-editor/model/audioTimeline.ts'
import { emptyDocument } from '../editors/videoStudioModel.ts'
import {
  draftVideoThumbnailQuery,
  queueDraftVideoCover,
  readTimelineDraftCover
} from './draftMediaCover.ts'

const storage = (key, value) => ({
  getItem: (requested) => (requested === key ? JSON.stringify(value) : null)
})
const clip = (id, path, extra = {}) => ({
  id,
  path,
  name: path,
  kind: 'video',
  start: 0,
  sourceIn: 12,
  duration: 4,
  sourceDuration: 100,
  rate: 1,
  gain: 1,
  ...extra
})

test('video cover samples the saved trim and ignores hidden tracks, not an unrelated workspace video', () => {
  const doc = emptyDocument()
  doc.tracks.push({ id: 'hidden', name: '隐藏', kind: 'video', hidden: true })
  doc.visuals = [
    clip('hidden', '/hidden.mp4', { trackId: 'hidden' }),
    clip('later', '/later.mp4', { start: 9 }),
    clip('trim', '/trim.mp4', { sourceIn: 42, rate: 2 })
  ]
  const result = readTimelineDraftCover(
    storage('omnigallery:video-timeline-v1:w:d', doc),
    'w',
    'd',
    'video'
  )
  assert.deepEqual(
    result.sources.map((item) => item.path),
    ['/trim.mp4', '/later.mp4']
  )
  assert.equal(result.sources[0].time, 43)
  const query = new URLSearchParams(draftVideoThumbnailQuery(result.sources[0], 'w'))
  assert.equal(query.get('count'), '1')
  assert.equal(query.get('workspace_id'), 'w')
  assert.equal(query.get('path'), '/trim.mp4')
  assert.ok(Number(query.get('start')) < 43 && Number(query.get('end')) > 43)
  assert.equal(
    readTimelineDraftCover(storage('omnigallery:video-timeline-v1:other:d', doc), 'w', 'd', 'video')
      .sources.length,
    0
  )
})

test('reverse, freeze and still-image projects retain the current clip source identity', () => {
  const doc = emptyDocument()
  doc.visuals = [
    clip('reverse', '/reverse.mp4', { reverse: true }),
    clip('freeze', '/freeze.mp4', { start: 5, freeze: true, sourceIn: 23 }),
    clip('image', 'editor-asset:abc', { start: 10, kind: 'image' })
  ]
  const result = readTimelineDraftCover(
    storage('omnigallery:video-timeline-v1:w:d', doc),
    'w',
    'd',
    'video'
  )
  assert.ok(Math.abs(result.sources[0].time - (12 + 4 - 1 / 30 - 0.5)) < 0.00001)
  assert.equal(result.sources[1].time, 23)
  assert.equal(result.sources[2].kind, 'image')
})

test('audio cover candidates include later sounds, deduplicate repeats and do not treat video frames as artwork', () => {
  const doc = createAudioTimeline()
  doc.tracks[0].clips = [
    createAudioClip('/coverless.wav', '无封面', 2),
    createAudioClip('/artwork.mp3', '有封面', 3, 2),
    createAudioClip('/artwork.mp3', '重复片段', 3, 5),
    { ...createAudioClip('/source.mp4', '视频声音', 2, 8), sourceKind: 'video' }
  ]
  const result = readTimelineDraftCover(storage(audioTimelineKey('w', 'd'), doc), 'w', 'd', 'audio')
  assert.deepEqual(
    result.sources.map((item) => item.path),
    ['/coverless.wav', '/artwork.mp3']
  )
  assert.ok(result.sources.every((item) => item.kind === 'audio'))
  assert.match(result.summary, /00:10\.000/)
})

test('damaged timelines are rejected without rewriting the saved production', () => {
  const raw = '{invalid'
  const saved = { getItem: () => raw }
  assert.throws(() => readTimelineDraftCover(saved, 'w', 'd', 'video'))
  assert.throws(() => readTimelineDraftCover(saved, 'w', 'd', 'audio'))
  assert.equal(saved.getItem('unused'), raw)
})

test('a grid never starts more than two video decoders and skips cards removed before their turn', async () => {
  let running = 0,
    peak = 0,
    skippedRan = false
  const releases = []
  const prepare = () =>
    new Promise((resolve) => {
      peak = Math.max(peak, ++running)
      releases.push(() => {
        running--
        resolve('ready')
      })
    })
  const first = queueDraftVideoCover(prepare, () => true)
  const second = queueDraftVideoCover(prepare, () => true)
  const skipped = queueDraftVideoCover(
    async () => {
      skippedRan = true
    },
    () => false
  )
  const third = queueDraftVideoCover(prepare, () => true)
  assert.equal(releases.length, 2)
  releases[0]()
  assert.equal(await first, 'ready')
  assert.equal(await skipped, undefined)
  releases[1]()
  assert.equal(await second, 'ready')
  releases[2]()
  assert.equal(await third, 'ready')
  assert.equal(peak, 2)
  assert.equal(skippedRan, false)
})
