import test from 'node:test'
import assert from 'node:assert/strict'
import { sourceMetadata, sourceRangeSelection } from './sourceRange.ts'
import {
  readSourceAudioStreams,
  sourceAudioStreamLabel,
  sourceAudioStreamError
} from './sourceAudioStreams.ts'
import { sourceAudioPreviewDocument } from './sourceAudioPreview.ts'
import { sourceRelinkError, sourceRelinkSelection, applySourceRelink } from './sourceRelink.ts'
import {
  projectRelinkSources,
  prepareProjectSourceRelinks,
  applyProjectSourceRelinks
} from './projectSources.ts'
import {
  createAudioClip,
  createAudioTimeline,
  readAudioTimeline
} from '../../../src/features/media-editor/model/audioTimeline.ts'
import { emptyDocument, readDocument } from './videoStudioModel.ts'
import { videoAudioClip } from './videoSoundProperties.ts'
import { prepareAudioPreview } from './continuousAudioEngine.ts'
import { prepareVideoAudioPreview } from './videoAudioPreview.ts'

const asset = { path: '/movie.mp4', kind: 'video', name: 'movie' }
const raw = {
  duration: 20,
  width: 1920,
  height: 1080,
  fps: 30,
  has_audio: true,
  fingerprint: 'original',
  audio_streams: [
    {
      ordinal: 0,
      index: 1,
      duration: 10,
      start_time: 0,
      title: 'English',
      language: 'eng',
      channels: 2,
      sample_rate: 48000
    },
    {
      ordinal: 1,
      index: 3,
      duration: 20,
      start_time: 3,
      title: '中文',
      language: 'zho',
      channels: 1,
      sample_rate: 44100,
      default: true
    }
  ]
}
const metadata = () => sourceMetadata(raw, 'video')
const video = () => ({
  ...emptyDocument(),
  sounds: [
    {
      id: 's',
      path: asset.path,
      name: asset.name,
      kind: 'video',
      sourceIn: 12,
      start: 0,
      duration: 4,
      sourceDuration: 20,
      rate: 1,
      gain: 1,
      audioStream: 1
    }
  ]
})

test('stream labels use language, title, channels and sample rate while selection uses ordinal, not absolute index', () => {
  const streams = metadata().audioStreams
  assert.deepEqual(
    streams.map((stream) => [stream.ordinal, stream.index]),
    [
      [0, 1],
      [1, 3]
    ]
  )
  assert.match(sourceAudioStreamLabel(streams[0]), /English.*eng.*立体声.*48 kHz/)
  assert.match(sourceAudioStreamLabel(streams[1]), /中文.*zho.*单声道.*44.1 kHz/)
  assert.equal(streams[1].startTime, 3)
  const selection = sourceRangeSelection(
    asset,
    metadata(),
    { start: 12, end: 16 },
    'sound',
    21600,
    1
  )
  assert.equal(selection.audioStream, 1)
  assert.equal(selection.sourceIn, 12)
  assert.equal(selection.audioSourceDuration, 20)
  const mixed = sourceRangeSelection(asset, metadata(), { start: 0, end: 8 }, 'default')
  assert.equal(mixed.sourceDuration, 20)
  assert.equal(mixed.audioSourceDuration, 10)
  assert.throws(
    () => sourceRangeSelection(asset, metadata(), { start: 12, end: 16 }, 'sound', 21600, 0),
    /过短/
  )
  assert.equal(
    sourceRangeSelection(asset, metadata(), { start: 12, end: 16 }, 'visual').audioStream,
    undefined
  )
})

test('legacy metadata can select only stream zero and malformed/missing choices never fall back', () => {
  assert.equal(readSourceAudioStreams(undefined, 20, true)[0].ordinal, 0)
  assert.equal(sourceAudioStreamError(undefined, 0, 0, 1), '')
  assert.match(sourceAudioStreamError(undefined, 1, 0, 1), /未知/)
  for (const ordinal of [2, -1, 1.5, Infinity])
    assert.ok(sourceAudioStreamError(metadata().audioStreams, ordinal, 0, 1))
  assert.throws(() => readSourceAudioStreams([{ ordinal: 0 }, { ordinal: 0 }], 20, true), /重复/)
  assert.equal(sourceAudioStreamError([], 0, 0, 1).includes('不包含'), true)
  assert.ok(sourceAudioStreamError([{ ...metadata().audioStreams[0], duration: 0 }], 0, 0, 1))
  assert.match(
    sourceAudioStreamError(readSourceAudioStreams([{ ordinal: 0 }], 20, true), 0, 0, 1),
    /未知/
  )
})

test('selected stream preview keeps source time, carries its ordinal and invalidates decoded cache on source change', () => {
  const doc = sourceAudioPreviewDocument(asset, metadata(), { start: 12, end: 16 }, 1)
  const clip = doc.tracks[0].clips[0]
  assert.deepEqual([clip.start, clip.sourceIn, clip.duration, clip.audioStream], [12, 12, 4, 1])
  assert.doesNotThrow(() => readAudioTimeline(JSON.stringify(doc)))
  const changed = sourceAudioPreviewDocument(
    asset,
    { ...metadata(), fingerprint: 'changed' },
    { start: 12, end: 16 },
    1
  )
  assert.notEqual(prepareAudioPreview(doc).signature, prepareAudioPreview(changed).signature)
  assert.throws(
    () => sourceAudioPreviewDocument(asset, metadata(), { start: 12, end: 16 }, 0),
    /过短/
  )
})

test('audio and video files persist selected streams and reject bad ordinals', () => {
  const audio = createAudioTimeline()
  audio.tracks[0].clips = [
    { ...createAudioClip('/movie.mp4', 'movie', 4, 0, 'video'), audioStream: 1 }
  ]
  assert.equal(readAudioTimeline(JSON.stringify(audio)).tracks[0].clips[0].audioStream, 1)
  assert.equal(readDocument(JSON.stringify(video())).sounds[0].audioStream, 1)
  const legacy = structuredClone(audio)
  delete legacy.tracks[0].clips[0].audioStream
  assert.doesNotThrow(() => readAudioTimeline(JSON.stringify(legacy)))
  for (const value of [-1, 1.5, 256, '1']) {
    const badAudio = structuredClone(audio)
    badAudio.tracks[0].clips[0].audioStream = value
    const badVideo = video()
    badVideo.sounds[0].audioStream = value
    assert.throws(() => readAudioTimeline(JSON.stringify(badAudio)))
    assert.throws(() => readDocument(JSON.stringify(badVideo)))
  }
})

test('sound waveforms and preview snapshots retain stream choice and invalidate when it changes', () => {
  const doc = video()
  assert.equal(videoAudioClip(doc.sounds[0]).audioStream, 1)
  const previous = prepareVideoAudioPreview(doc).signature
  doc.sounds[0].audioStream = 0
  assert.notEqual(previous, prepareVideoAudioPreview(doc).signature)
})

test('relink checks every referenced ordinal and never remaps a removed language silently', () => {
  const doc = video(),
    source = projectRelinkSources(doc, 'video')[0]
  const replacement = { ...asset, path: '/new/movie.mp4' }
  assert.equal(source.clips[0].audioStream, 1)
  assert.equal(sourceRelinkError(source, replacement, metadata()), '')
  assert.match(
    sourceRelinkError(source, replacement, {
      ...metadata(),
      audioStreams: [metadata().audioStreams[0]]
    }),
    /不包含/
  )
  const selected = prepareProjectSourceRelinks(
    [source],
    { [source.path]: replacement.path },
    [replacement],
    [{ ...replacement, state: 'available', error: '', metadata: raw }]
  )
  assert.equal(applyProjectSourceRelinks(doc, 'video', selected).sounds[0].audioStream, 1)
  doc.sounds[0].audioStream = 0
  assert.throws(() => applyProjectSourceRelinks(doc, 'video', selected), /引用已变化/)
})

test('relink keeps picture container bounds and applies the selected sound stream bound separately', () => {
  const doc = video()
  doc.sounds[0] = { ...doc.sounds[0], audioStream: 0, sourceIn: 0 }
  doc.visuals = [{ ...doc.sounds[0], id: 'v', duration: 15 }]
  const source = projectRelinkSources(doc, 'video')[0]
  const replacement = { ...asset, path: '/new/movie.mp4' }
  const single = sourceRelinkSelection(source, replacement, metadata())
  assert.equal(applySourceRelink(doc.sounds[0], single).sourceDuration, 10)
  assert.equal(applySourceRelink(doc.visuals[0], single).sourceDuration, 20)
  const selected = prepareProjectSourceRelinks(
    [source],
    { [source.path]: replacement.path },
    [replacement],
    [{ ...replacement, state: 'available', error: '', metadata: raw }]
  )
  const changed = applyProjectSourceRelinks(doc, 'video', selected)
  assert.equal(changed.sounds[0].sourceDuration, 10)
  assert.equal(changed.visuals[0].sourceDuration, 20)
})
