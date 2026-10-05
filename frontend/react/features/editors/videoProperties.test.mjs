import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyVideoProperties,
  captureVideoProperties,
  captureCaptionProperties,
  validVideoProperties,
  readVideoPresets,
  videoPresetsKey,
  saveVideoPreset,
  deleteVideoPreset
} from './videoProperties.ts'
import { defaultLocalVideoEffects } from './videoLocalEffects.ts'
import { emptyDocument, evaluatedTransform, readDocument } from './videoStudioModel.ts'
import {
  mapStorage,
  WorkspaceStateStore
} from '../../../src/features/workspaces/model/workspaceStateStore.ts'
import { workspaceWorksKey } from '../../../src/features/workspaces/model/workspaceWorks.ts'
import { sliceClip } from './videoStudioModel.ts'
import { rollVideoBoundary } from './videoPrecisionEditing.ts'

const clip = (id, extra = {}) => ({
  id,
  path: `${id}.mp4`,
  name: id,
  kind: 'video',
  start: 0,
  sourceIn: 4,
  duration: 10,
  sourceDuration: 100,
  rate: 1,
  gain: 0.7,
  ...extra
})
test('trimmed picture fade presets use visible durations and reset destination envelope anchors', () => {
  const trimmed = sliceClip(clip('original', { fadeIn: 4, fadeOut: 2, fadeCurve: 'smooth' }), 2, 6)
  const properties = captureVideoProperties(trimmed)
  assert.equal(properties.fadeIn, 2)
  assert.equal(properties.fadeOut, 0)
  assert.equal(properties.fadeCurve, 'smooth')
  const doc = emptyDocument()
  doc.visuals = [sliceClip(clip('target', { fadeIn: 4, fadeOut: 2 }), 1, 5)]
  const result = applyVideoProperties(doc, ['target'], properties)
  assert.equal(result.document.visuals[0].envelopeOffset, 0)
  assert.equal(result.document.visuals[0].envelopeDuration, 4)
  assert.equal(result.document.visuals[0].fadeIn, 2)
  assert.equal(result.document.visuals[0].fadeCurve, 'smooth')
  assert.equal(readDocument(JSON.stringify(result.document)).visuals[0].duration, 4)
})

test('rolling either cut edge then copying picture properties cannot invent a fade', () => {
  const doc = emptyDocument()
  doc.visuals = [clip('left', { duration: 2 }), clip('right', { start: 2, duration: 2 })]
  for (const boundary of [1.5, 2.5]) {
    const rolled = rollVideoBoundary(doc, 'left', 'right', 'visual', boundary)
    assert.equal(rolled.error, '')
    for (const original of rolled.document.visuals) {
      const properties = captureVideoProperties(original)
      assert.equal(properties.fadeIn, 0)
      assert.equal(properties.fadeOut, 0)
      const destination = emptyDocument()
      destination.visuals = [
        clip('target', { duration: original.duration, fadeIn: 0.25, fadeOut: 0.25 })
      ]
      const copied = applyVideoProperties(destination, ['target'], properties).document
      assert.equal(readDocument(JSON.stringify(copied)).visuals[0].fadeOut, 0)
      for (const local of [0, original.duration / 2, original.duration])
        assert.equal(evaluatedTransform(copied.visuals[0], local).opacity, 1)
    }
  }
})
const source = () =>
  clip('source', {
    transform: {
      x: 0.1,
      y: -0.2,
      rotation: 15,
      scale: 1.2,
      opacity: 0.8,
      flipX: true,
      fit: 'cover',
      crop: { x: 0.2, y: 0.1, width: 0.7, height: 0.8 }
    },
    color: { brightness: 0.1, contrast: 1.2, saturation: 0.6 },
    localEffects: {
      ...defaultLocalVideoEffects(),
      exposure: 0.7,
      regions: [
        {
          id: 'mask',
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.4,
          shape: 'ellipse',
          effect: 'mosaic',
          feather: 0.03,
          strength: 0.5,
          invert: true
        }
      ]
    },
    keyframes: [
      { time: 0, rotation: 10 },
      {
        time: 4,
        rotation: 70,
        x: 0.3,
        easing: 'easeIn',
        curves: { x: { easing: 'easeInOut', start: 0.2, end: 0.8 } }
      },
      { time: 10, rotation: -30, x: -0.2, opacity: 0.4, easing: 'easeOut' }
    ],
    fadeIn: 4,
    fadeOut: 3,
    linkId: 'source-link',
    transitionIn: { previousId: 'previous', duration: 2, easing: 'linear' }
  })
const approximate = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`)
test('capture is detached and includes only picture properties, never source, timing, audio or linked transitions', () => {
  const original = source(),
    p = captureVideoProperties(original)
  for (const field of [
    'path',
    'name',
    'id',
    'start',
    'sourceIn',
    'sourceDuration',
    'gain',
    'rate',
    'linkId',
    'transitionIn'
  ])
    assert.equal(p[field], undefined)
  p.transform.crop.x = 0
  p.localEffects.regions[0].x = 0
  p.keyframes[1].curves.x.start = 0
  assert.equal(original.transform.crop.x, 0.2)
  assert.equal(original.localEffects.regions[0].x, 0.1)
  assert.equal(original.keyframes[1].curves.x.start, 0.2)
})
test('batch targets visuals only, preserves target timing/link/transition, skips locked track and explicit locked IDs', () => {
  const doc = {
    ...emptyDocument(),
    tracks: [
      ...emptyDocument().tracks,
      { id: 'locked', kind: 'video', name: '锁定', gain: 1, locked: true }
    ],
    visuals: [
      clip('a', {
        start: 7,
        sourceIn: 12,
        duration: 5,
        reverse: true,
        linkId: 'linked',
        transitionIn: { previousId: 'mine', duration: 1, easing: 'easeIn' }
      }),
      clip('b', { trackId: 'locked' }),
      clip('c')
    ],
    sounds: [clip('audio', { kind: 'audio', linkId: 'linked', trackId: 'audio-1' })]
  }
  const before = structuredClone(doc)
  const result = applyVideoProperties(
    doc,
    ['a', 'b', 'c', 'audio'],
    captureVideoProperties(source()),
    { lockedIds: ['c'] }
  )
  assert.deepEqual(result.appliedIds, ['a'])
  assert.deepEqual(result.skippedLockedIds, ['b', 'c'])
  assert.deepEqual(doc, before)
  for (const field of [
    'id',
    'path',
    'name',
    'start',
    'sourceIn',
    'sourceDuration',
    'duration',
    'rate',
    'gain',
    'reverse',
    'linkId',
    'transitionIn'
  ])
    assert.deepEqual(result.document.visuals[0][field], doc.visuals[0][field])
  assert.equal(result.document.sounds, doc.sounds)
  assert.equal(result.document.visuals[1], doc.visuals[1])
  assert.doesNotThrow(() => readDocument(JSON.stringify(result.document)))
  assert.equal(
    applyVideoProperties(doc, ['a'], captureVideoProperties(source()), { readonly: true }).document,
    doc
  )
})
test('short target truncates eased rotation/curves without changing retained animation; fades fit target', () => {
  const original = source()
  for (const duration of [0.1371234, 2, 4, 7]) {
    const doc = { ...emptyDocument(), visuals: [clip('target', { duration })] }
    const edited = applyVideoProperties(doc, ['target'], captureVideoProperties(original)).document
      .visuals[0]
    assert.ok(edited.keyframes.every((frame) => frame.time <= duration))
    assert.ok(edited.keyframes.length <= 128)
    assert.equal(edited.fadeIn, Math.min(4, duration))
    assert.equal(edited.fadeOut, Math.min(3, duration))
    for (let index = 0; index <= 20; index++) {
      const time = (duration * index) / 20
      const actual = evaluatedTransform({ ...edited, fadeIn: 0, fadeOut: 0 }, time)
      const expected = evaluatedTransform(
        { ...original, fadeIn: 0, fadeOut: 0, transitionIn: undefined },
        time
      )
      for (const field of ['x', 'y', 'rotation', 'scale', 'opacity'])
        approximate(actual[field], expected[field])
    }
    assert.doesNotThrow(() => readDocument(JSON.stringify({ ...doc, visuals: [edited] })))
  }
})
test('longer target retains original animation seconds and curves, then holds final transform', () => {
  const original = source(),
    doc = { ...emptyDocument(), visuals: [clip('target', { duration: 20 })] }
  const edited = applyVideoProperties(doc, ['target'], captureVideoProperties(original)).document
    .visuals[0]
  assert.deepEqual(edited.keyframes, original.keyframes)
  assert.notEqual(edited.keyframes, original.keyframes)
  for (const time of [0, 2, 6, 10, 15, 20])
    approximate(
      evaluatedTransform({ ...edited, fadeIn: 0, fadeOut: 0 }, time).rotation,
      evaluatedTransform(
        { ...original, fadeIn: 0, fadeOut: 0, transitionIn: undefined },
        Math.min(time, 10)
      ).rotation
    )
})
test('same settings avoid creating an undo entry and dense 128-keyframe curves remain valid after trim', () => {
  const original = clip('dense', {
    keyframes: Array.from({ length: 128 }, (_, i) => ({
      time: (10 * i) / 127,
      rotation: i,
      opacity: i / 127,
      easing: 'easeInOut'
    }))
  })
  const doc = { ...emptyDocument(), visuals: [original] }
  const same = applyVideoProperties(doc, ['dense'], captureVideoProperties(original))
  assert.equal(same.document, doc)
  assert.deepEqual(same.unchangedIds, ['dense'])
  const trimmed = applyVideoProperties(
    { ...doc, visuals: [clip('short', { duration: 9.99 })] },
    ['short'],
    captureVideoProperties(original)
  ).document
  assert.ok(trimmed.visuals[0].keyframes.length <= 128)
  assert.doesNotThrow(() => readDocument(JSON.stringify(trimmed)))
})
test('caption presets include style only, batch applies matching captions and preserves words/time', () => {
  const caption = {
    id: 'source',
    text: '请勿复制这段文字',
    start: 30,
    duration: 10,
    style: {
      fontFamily: '思源黑体',
      fontSize: 48,
      color: '#33ddff',
      background: '#11223388',
      outlineWidth: 4,
      bold: true,
      maxWidth: 0.7,
      wrap: false,
      x: 0.2,
      y: 0.3
    }
  }
  const p = captureCaptionProperties(caption)
  assert.deepEqual(Object.keys(p).sort(), ['kind', 'style'])
  const doc = {
    ...emptyDocument(),
    visuals: [source()],
    captions: [
      { id: 'a', text: '保留 A', start: 2, duration: 4 },
      { id: 'b', text: '保留 B', start: 8, duration: 1 }
    ]
  }
  const result = applyVideoProperties(doc, ['a', 'b', 'source'], p, { lockedIds: ['b'] })
  assert.deepEqual(result.appliedIds, ['a'])
  assert.deepEqual(result.skippedLockedIds, ['b'])
  assert.deepEqual(result.document.captions[0], { ...doc.captions[0], style: p.style })
  assert.equal(result.document.visuals, doc.visuals)
  assert.equal(result.document.captions[1], doc.captions[1])
})
test('invalid or injected properties reject rather than leaving unexportable values in document', () => {
  const p = captureVideoProperties(source()),
    caption = captureCaptionProperties({ id: 'a', text: 'a', start: 0, duration: 1 })
  for (const item of [
    { ...p, path: 'wrong.mp4' },
    { ...p, transform: { ...p.transform, flipX: 'false' } },
    { ...p, fadeOut: 11 },
    { ...p, keyframes: [{ time: 11, rotation: 20 }] },
    {
      ...p,
      keyframes: [{ time: 1, curves: { rotation: { easing: 'linear', start: 0.5, end: 0.4 } } }]
    },
    { ...p, localEffects: { ...p.localEffects, unknown: 'bad' } },
    { ...caption, style: { ...caption.style, color: 'red' } },
    { ...caption, style: { ...caption.style, fontFamily: 'bad;filter' } },
    { ...caption, style: { ...caption.style, fontSize: 500 } },
    null
  ]) {
    assert.equal(validVideoProperties(item), false)
    assert.throws(
      () => applyVideoProperties({ ...emptyDocument(), visuals: [clip('a')] }, ['a'], item),
      /属性无效/
    )
  }
})

function works(draftId = 'draft') {
  return JSON.stringify({
    version: 2,
    activeId: 'work',
    works: [
      {
        id: 'work',
        name: '作品',
        drafts: [{ id: draftId, name: '视频制作', kind: 'video' }],
        activeDraftId: draftId
      }
    ]
  })
}
const preset = (id = 'preset') => ({
  id,
  name: '我的画面',
  properties: captureVideoProperties(source())
})
test('presets save/remove are scoped and require an existing draft and writable context', () => {
  const map = new Map([
    [workspaceWorksKey('one'), works()],
    [workspaceWorksKey('two'), works('other')]
  ])
  const storage = mapStorage(map)
  saveVideoPreset(storage, 'one', 'draft', preset())
  assert.equal(readVideoPresets(storage.getItem(videoPresetsKey('one'))).length, 1)
  assert.equal(storage.getItem(videoPresetsKey('two')), null)
  for (const operation of [
    () => saveVideoPreset(storage, 'two', 'draft', preset()),
    () => saveVideoPreset(storage, 'one', 'missing', preset()),
    () => saveVideoPreset(storage, 'one', 'draft', preset('two'), true),
    () => deleteVideoPreset(storage, 'one', 'draft', 'preset', true)
  ])
    assert.throws(operation)
  assert.equal(readVideoPresets(storage.getItem(videoPresetsKey('one'))).length, 1)
  deleteVideoPreset(storage, 'one', 'draft', 'preset')
  assert.deepEqual(readVideoPresets(storage.getItem(videoPresetsKey('one'))), [])
})
test('corrupt, duplicate, oversized and full preset collections preserve original state', () => {
  for (const raw of [
    '{broken',
    JSON.stringify([preset(), preset()]),
    JSON.stringify([{ ...preset(), unexpected: 1 }]),
    ' '.repeat(256 * 1024 + 1)
  ])
    assert.throws(() => readVideoPresets(raw), /预设/)
  const map = new Map([
      [workspaceWorksKey('one'), works()],
      [videoPresetsKey('one'), '{broken']
    ]),
    storage = mapStorage(map)
  assert.throws(() => saveVideoPreset(storage, 'one', 'draft', preset()))
  assert.equal(storage.getItem(videoPresetsKey('one')), '{broken')
  const full = JSON.stringify(
    Array.from({ length: 30 }, (_, i) => ({
      id: `preset-${i}`,
      name: `预设 ${i}`,
      properties: captureCaptionProperties({ id: 'c', text: '', start: 0, duration: 1 })
    }))
  )
  storage.setItem(videoPresetsKey('one'), full)
  assert.throws(() => saveVideoPreset(storage, 'one', 'draft', preset()), /30/)
  assert.equal(storage.getItem(videoPresetsKey('one')), full)
})
test('durable transaction failure rolls back and a later reload restores committed video presets', async () => {
  let snapshot = { revision: 1, imported: true, entries: { [workspaceWorksKey('one')]: works() } },
    fail = true
  const remote = {
    load: async () => structuredClone(snapshot),
    import: async () => structuredClone(snapshot),
    remove: async () => {},
    save: async (revision, changes) => {
      if (fail) throw new Error('offline')
      assert.equal(revision, snapshot.revision)
      snapshot = {
        ...snapshot,
        revision: revision + 1,
        entries: { ...snapshot.entries, ...changes }
      }
      return { revision: snapshot.revision }
    }
  }
  const store = new WorkspaceStateStore(remote)
  await store.ensure(() => ({}))
  await assert.rejects(
    store.transaction((storage) => saveVideoPreset(storage, 'one', 'draft', preset())),
    /offline/
  )
  assert.equal(store.storage.getItem(videoPresetsKey('one')), null)
  fail = false
  await store.transaction((storage) => saveVideoPreset(storage, 'one', 'draft', preset()))
  const restored = new WorkspaceStateStore(remote)
  await restored.ensure(() => ({}))
  assert.equal(
    readVideoPresets(restored.storage.getItem(videoPresetsKey('one')))[0].name,
    '我的画面'
  )
  snapshot.entries[workspaceWorksKey('one')] = works('replacement')
  await restored.load()
  await assert.rejects(
    restored.transaction((storage) => saveVideoPreset(storage, 'one', 'draft', preset('late'))),
    /删除/
  )
  assert.equal(readVideoPresets(restored.storage.getItem(videoPresetsKey('one'))).length, 1)
})
