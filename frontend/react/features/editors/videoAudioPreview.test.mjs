import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareVideoAudioPreview } from './videoAudioPreview.ts'
import { emptyDocument } from './videoStudioModel.ts'

test('visual-only editing keeps the same mixed-audio cache and playback snapshot', () => {
  const doc = emptyDocument()
  const first = prepareVideoAudioPreview(doc)
  doc.width = 1920
  doc.captions.push({ id: 'c', start: 0, duration: 4, text: 'subtitle' })
  assert.equal(prepareVideoAudioPreview(doc).signature, first.signature)
  doc.masterGain = 0
  assert.notEqual(prepareVideoAudioPreview(doc).signature, first.signature)
  assert.equal(first.document.masterGain, undefined)
})
test('sound, track and DSP edits replace the mix; incoming documents do not alias the queued snapshot', () => {
  const doc = emptyDocument()
  const first = prepareVideoAudioPreview(doc)
  doc.tracks[1].pan = 0.5
  assert.notEqual(prepareVideoAudioPreview(doc).signature, first.signature)
  assert.equal(first.document.tracks[1].pan, undefined)
  const second = prepareVideoAudioPreview(doc)
  doc.processing = { bypass: true }
  assert.notEqual(prepareVideoAudioPreview(doc).signature, second.signature)
})
