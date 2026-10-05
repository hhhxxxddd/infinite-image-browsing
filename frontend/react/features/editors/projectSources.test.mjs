import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyDocument, readDocument } from './videoStudioModel.ts'
import {
  createAudioTimeline,
  readAudioTimeline
} from '../../../src/features/media-editor/model/audioTimeline.ts'
import {
  applyProjectSourceRelinks,
  prepareProjectSourceRelinks,
  projectRelinkSources,
  projectLockedSourcePaths,
  projectSourceHealth,
  projectSourceMatches,
  proposeProjectSourceChoices,
  sourceFilename
} from './projectSources.ts'

const clip = (id, path, extra = {}) => ({
  id,
  path,
  name: path.split('/').at(-1),
  kind: 'video',
  start: 5,
  sourceIn: 8,
  sourceDuration: 50,
  duration: 4,
  rate: 2,
  gain: 1,
  ...extra
})
const video = () => ({
  ...emptyDocument(),
  visuals: [
    clip('v', '/old/a.mp4', {
      linkId: 'linked',
      transform: { opacity: 0.7 },
      keyframes: [
        { time: 0, rotation: 20 },
        { time: 4, rotation: 40 }
      ]
    })
  ],
  sounds: [
    clip('s', '/old/a.mp4', {
      start: 6,
      linkId: 'linked',
      pan: 0.6,
      gainPoints: [
        { time: 0, gain: 0.5 },
        { time: 4, gain: 1 }
      ]
    }),
    clip('s2', '/old/b.wav', { kind: 'audio' })
  ]
})
const replacement = (name = 'a.mp4', kind = 'video') => ({ path: `/new/${name}`, name, kind })
const inspection = (asset, duration = 50, extra = {}) => ({
  ...asset,
  state: 'available',
  error: '',
  metadata: {
    duration,
    width: asset.kind === 'audio' ? 0 : 1920,
    height: asset.kind === 'audio' ? 0 : 1080,
    fps: 30,
    has_audio: true,
    fingerprint: asset.path,
    ...extra
  }
})
const directory = (candidates) => ({
  candidates,
  complete: true,
  case_sensitive: true,
  scanned_entries: candidates.length,
  skipped_directories: 0
})
const selections = (doc) => {
  const sources = projectRelinkSources(doc, 'video')
  const candidates = [replacement(), replacement('b.wav', 'audio')]
  return prepareProjectSourceRelinks(
    sources,
    { '/old/a.mp4': '/new/a.mp4', '/old/b.wav': '/new/b.wav' },
    candidates,
    candidates.map((asset) => inspection(asset))
  )
}

test('project health distinguishes missing, blocked, bad ranges and healthy header-only metadata', () => {
  const source = projectRelinkSources(video(), 'video')[0]
  assert.equal(projectSourceHealth(source).state, 'unchecked')
  assert.equal(
    projectSourceHealth(source, {
      path: source.path,
      kind: source.kind,
      state: 'missing',
      error: 'missing'
    }).state,
    'missing'
  )
  assert.equal(
    projectSourceHealth(source, {
      path: source.path,
      kind: source.kind,
      state: 'unavailable',
      error: 'trust denied'
    }).error,
    'trust denied'
  )
  assert.equal(projectSourceHealth(source, inspection(source)).state, 'available')
  assert.match(projectSourceHealth(source, inspection(source, 15)).error, /过短/)
  assert.match(
    projectSourceHealth(source, inspection(source, 50, { has_audio: false })).error,
    /声音/
  )
  assert.equal(projectSourceHealth(source, inspection(source, NaN)).state, 'invalid')
})

test('directory names derive from real paths and respect host case sensitivity', () => {
  const source = projectRelinkSources(video(), 'video')[0]
  assert.equal(
    sourceFilename({ ...source, path: 'E:\\lost\\a.mp4', name: 'renamed clip' }),
    'a.mp4'
  )
  assert.equal(
    sourceFilename({ ...source, path: 'workspace-artifact:abc', name: 'result.mp4' }),
    'result.mp4'
  )
  const response = directory([replacement('A.mp4')])
  assert.deepEqual(projectSourceMatches(source, response), [])
  assert.equal(projectSourceMatches(source, { ...response, case_sensitive: false }).length, 1)
})

test('duplicate names, shared candidates and incomplete scans never auto-select a guess', () => {
  const source = projectRelinkSources(video(), 'video')[0]
  const candidate = replacement()
  assert.deepEqual(proposeProjectSourceChoices([source], directory([candidate])), {
    [source.path]: candidate.path
  })
  assert.deepEqual(
    proposeProjectSourceChoices(
      [source],
      directory([candidate, { ...candidate, path: '/other/a.mp4' }])
    ),
    {}
  )
  assert.deepEqual(
    proposeProjectSourceChoices(
      [source, { ...source, path: '/another/a.mp4' }],
      directory([candidate])
    ),
    {}
  )
  assert.deepEqual(
    proposeProjectSourceChoices([source], { ...directory([candidate]), complete: false }),
    {}
  )
})

test('candidate review checks actual streams and all source intervals, including speed and freeze', () => {
  const sources = projectRelinkSources(video(), 'video')
  const asset = replacement()
  const prepare = (info) =>
    prepareProjectSourceRelinks(sources, { [sources[0].path]: asset.path }, [asset], info)
  assert.throws(() => prepare([]), /尚未验证/)
  assert.throws(() => prepare([inspection(asset, 15.9)]), /过短/)
  assert.throws(() => prepare([inspection(asset, 50, { has_audio: false })]), /声音/)
  assert.equal(prepare([inspection(asset, 16)])[0].sourceDuration, 16)
  const frozen = {
    ...sources[0],
    clips: [{ id: 'v', sourceIn: 8, duration: 100, freeze: true, requiresVideo: true }]
  }
  assert.equal(
    prepareProjectSourceRelinks(
      [frozen],
      { [frozen.path]: asset.path },
      [asset],
      [inspection(asset, 9)]
    )[0].sourceDuration,
    9
  )
  assert.throws(
    () =>
      prepareProjectSourceRelinks(
        [frozen],
        { [frozen.path]: asset.path },
        [asset],
        [inspection(asset, 8)]
      ),
    /过短/
  )
})

test('batch relink preserves all clip timing, links, animation and sound automation in one new document', () => {
  const doc = video(),
    before = structuredClone(doc)
  const next = applyProjectSourceRelinks(doc, 'video', selections(doc))
  assert.notEqual(next, doc)
  for (const lane of ['visuals', 'sounds'])
    next[lane].forEach((c, i) => {
      const original = before[lane][i]
      assert.deepEqual(c, { ...original, path: original.path.replace('/old/', '/new/') })
    })
  assert.deepEqual(doc, before)
  assert.doesNotThrow(() => readDocument(JSON.stringify(next)))
})

test('changes to any current reference or locks reject the entire batch without partial output', () => {
  const doc = video(),
    changes = selections(doc)
  for (const modify of [
    (next) => {
      next.sounds[0].sourceIn += 1
    },
    (next) => {
      next.sounds.push(clip('s3', '/old/a.mp4'))
    },
    (next) => {
      next.visuals = []
    },
    (next) => {
      next.tracks[1].locked = true
    }
  ]) {
    const changed = structuredClone(doc)
    modify(changed)
    const before = structuredClone(changed)
    assert.throws(() => applyProjectSourceRelinks(changed, 'video', changes), /变化|锁定/)
    assert.deepEqual(changed, before)
  }
  assert.throws(() => applyProjectSourceRelinks(doc, 'video', changes, true), /只读/)
  assert.throws(() => applyProjectSourceRelinks(doc, 'video', [...changes, changes[0]]), /多个/)
  assert.throws(
    () => applyProjectSourceRelinks(doc, 'video', [{ ...changes[0], sourceDuration: 999 }]),
    /变化/
  )
})

test('original mapping is applied once, without cascading A to B to C', () => {
  const doc = video(),
    changes = selections(doc)
  changes[0] = { ...changes[0], replacement: { ...changes[0].replacement, path: '/old/b.wav' } }
  const next = applyProjectSourceRelinks(doc, 'video', changes)
  assert.equal(next.visuals[0].path, '/old/b.wav')
  assert.equal(next.sounds[1].path, '/new/b.wav')
})

test('audio sources include every track and retain envelopes, groups, text and per-track settings', () => {
  const doc = createAudioTimeline()
  doc.tracks[0].clips = [
    {
      id: 'a',
      path: '/old/voice.wav',
      name: 'voice.wav',
      sourceKind: 'audio',
      sourceIn: 2,
      duration: 5,
      start: 4,
      rate: 1,
      gain: 0.8,
      fadeIn: 1,
      fadeOut: 1,
      envelopeOffset: 0,
      envelopeDuration: 5,
      gainPoints: [
        { time: 0, gain: 1 },
        { time: 5, gain: 0.5 }
      ]
    }
  ]
  const source = projectRelinkSources(doc, 'audio')[0]
  assert.equal(source.kind, 'audio')
  assert.equal(source.clips[0].requiresAudio, true)
  const asset = replacement('voice.wav', 'audio')
  const changes = prepareProjectSourceRelinks(
    [source],
    { [source.path]: asset.path },
    [asset],
    [inspection(asset, 7)]
  )
  const next = applyProjectSourceRelinks(doc, 'audio', changes)
  assert.deepEqual(next, {
    ...doc,
    tracks: doc.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((c) => ({ ...c, path: asset.path }))
    }))
  })
  assert.doesNotThrow(() => readAudioTimeline(JSON.stringify(next)))
  doc.tracks[0].locked = true
  assert.deepEqual(projectLockedSourcePaths(doc, 'audio'), ['/old/voice.wav'])
  assert.throws(() => applyProjectSourceRelinks(doc, 'audio', changes), /锁定/)
})
