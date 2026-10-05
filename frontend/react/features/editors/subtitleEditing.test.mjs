import test from 'node:test'
import assert from 'node:assert/strict'
import {
  matchingSubtitles,
  offsetSubtitles,
  replaceSubtitleText,
  applySubtitleStyle,
  MAX_SUBTITLE_TEXT_LENGTH
} from './subtitleEditing.ts'
const captions = [
  {
    id: 'a',
    text: 'Hello [world]. HELLO',
    start: 1.125,
    duration: 2,
    style: { fontSize: 32, color: '#ffffff' }
  },
  { id: 'b', text: '你好，世界', start: 4, duration: 3, style: { fontSize: 20 } }
]
test('subtitle search and literal replacement respect the selected cues and replacement characters', () => {
  assert.deepEqual(
    matchingSubtitles(captions, 'hello').map((cue) => cue.id),
    ['a']
  )
  assert.equal(
    replaceSubtitleText(captions, ['a'], '[world].', '$&你好')[0].text,
    'Hello $&你好 HELLO'
  )
  assert.equal(replaceSubtitleText(captions, ['a'], 'hello', '开始')[0].text, '开始 [world]. 开始')
  assert.equal(replaceSubtitleText(captions, ['a'], '世界', '地球')[1].text, '你好，世界')
  assert.equal(captions[0].text, 'Hello [world]. HELLO')
})
test('batch offset is atomic and preserves duration and exact intervals', () => {
  const result = offsetSubtitles(captions, ['a', 'b'], 0.375)
  assert.equal(result[0].start, 1.5)
  assert.equal(result[1].start, 4.375)
  assert.equal(result[0].duration, 2)
  assert.throws(() => offsetSubtitles(captions, ['a', 'b'], -2), /超出/)
  assert.throws(() => offsetSubtitles(captions, ['a'], 21600), /超出/)
  assert.equal(captions[0].start, 1.125)
})
test('style application leaves text and timing intact and does not alias another subtitle', () => {
  const result = applySubtitleStyle(captions, ['b'], captions[0])
  assert.equal(result[1].text, '你好，世界')
  assert.equal(result[1].start, 4)
  assert.deepEqual(result[1].style, captions[0].style)
  result[1].style.fontSize = 60
  assert.equal(captions[0].style.fontSize, 32)
})

test('batch replacement respects the export text limit and rejects the whole edit atomically', () => {
  assert.equal(MAX_SUBTITLE_TEXT_LENGTH, 5000)
  const original = [
    { id: 'short', text: 'x', start: 0, duration: 1 },
    { id: 'boundary', text: 'a'.repeat(4999) + 'x', start: 1, duration: 1 }
  ]
  assert.throws(
    () => replaceSubtitleText(original, ['short', 'boundary'], 'x', 'xx'),
    /5000.*原始字幕未修改/
  )
  assert.equal(original[0].text, 'x')
  assert.equal(original[1].text.length, 5000)
  const accepted = replaceSubtitleText(original, ['short', 'boundary'], 'x', 'z')
  assert.equal(accepted[1].text.length, 5000)
  assert.equal(accepted[0].text, 'z')
  const repair = replaceSubtitleText(
    [{ ...original[0], text: 'a'.repeat(5001) }],
    ['short'],
    'aa',
    'a'
  )
  assert.ok(repair[0].text.length < 5000)
})
