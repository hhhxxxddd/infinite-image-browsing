import assert from 'node:assert/strict'
import test from 'node:test'
import { contextVideoSelection, videoSelectionLocked } from './videoContextSelection.ts'
import { emptyDocument } from './videoStudioModel.ts'

const document = () => ({
  ...emptyDocument(),
  visuals: [
    { id: 'v', linkId: 'pair', trackId: 'video-1' },
    { id: 'other', trackId: 'video-1' }
  ],
  sounds: [{ id: 's', linkId: 'pair', trackId: 'audio-1' }],
  captions: [{ id: 'caption' }]
})

test('right click preserves a selected multi-selection including linked partners', () => {
  assert.deepEqual(contextVideoSelection(document(), ['v', 'other', 'caption'], 'v'), [
    'v',
    'other',
    'caption',
    's'
  ])
})

test('right click on an unselected item retargets without retaining the old selection', () => {
  assert.deepEqual(contextVideoSelection(document(), ['other', 'caption'], 'v'), ['v', 's'])
  assert.deepEqual(contextVideoSelection(document(), ['v', 's'], 'caption'), ['caption'])
})

test('linked partner locks disable mutations while unrelated track locks do not', () => {
  const doc = document()
  doc.tracks.find((track) => track.id === 'audio-1').locked = true
  assert.equal(videoSelectionLocked(doc, ['v']), true)
  assert.equal(videoSelectionLocked(doc, ['other', 'caption']), false)
})
