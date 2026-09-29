import test from 'node:test'
import assert from 'node:assert/strict'
import {
  activeTextCues,
  createTextCue,
  createTextTrack,
  decodeTextFile,
  parseTextTrack,
  serializeTextTrack,
  splitTextCue,
  textLimits
} from './textTimeline.ts'
import {
  createAudioTimeline,
  createAudioClip,
  cloneTimeline,
  readAudioTimeline,
  timelineDuration
} from './audioTimeline.ts'

test('LRC preserves repeated timestamps, offsets, gaps, fractional time and final duration', () => {
  const cues = parseTextTrack(
    '[ar:Artist]\n[offset:-500]\n[00:01.50][00:04.500]First\n[00:03.00]\n[00:07.25]Last',
    'lrc',
    { duration: 10 }
  )
  assert.deepEqual(
    cues.map(({ start, duration, text }) => ({ start, duration, text })),
    [
      { start: 1, duration: 1.5, text: 'First' },
      { start: 4, duration: 2.75, text: 'First' },
      { start: 6.75, duration: 3.25, text: 'Last' }
    ]
  )
  const track = createTextTrack()
  track.cues = cues
  const reopened = parseTextTrack(serializeTextTrack(track, 'lrc'), 'lrc')
  assert.deepEqual(
    reopened.map(({ start, duration, text }) => ({ start, duration, text })),
    cues.map(({ start, duration, text }) => ({ start, duration, text }))
  )
})
test('SRT and VTT retain multiline text, hours, overlaps and exact milliseconds through export', () => {
  const cues = parseTextTrack(
    '\uFEFF1\r\n01:02:03,456 --> 01:02:05,789\r\nFirst\r\n第二行\r\n\r\n2\r\n01:02:04,000 --> 01:02:06,000\r\nOverlap',
    'srt'
  )
  assert.equal(cues[0].start, 3723.456)
  assert.equal(cues[0].text, 'First\n第二行')
  const track = createTextTrack()
  track.cues = cues
  for (const format of ['srt', 'vtt']) {
    const reopened = parseTextTrack(serializeTextTrack(track, format), format)
    assert.deepEqual(
      reopened.map(({ start, duration, text }) => ({ start, duration, text })),
      cues.map(({ start, duration, text }) => ({ start, duration, text }))
    )
  }
  const vtt = parseTextTrack(
    'WEBVTT\n\nNOTE note\nignored\n\nSTYLE\n::cue { color: red }\n\nintro\n00:01.250 --> 00:02.750 align:start\nHello',
    'vtt'
  )
  assert.equal(vtt.length, 1)
  assert.equal(vtt[0].duration, 1.5)
})
test('plain text starts at the playhead, subtitle range exports clip and rebase times', () => {
  const track = createTextTrack()
  track.cues = parseTextTrack('First\n\nSecond', 'txt', { start: 5 })
  assert.deepEqual(
    track.cues.map((cue) => cue.start),
    [5, 8]
  )
  const range = parseTextTrack(serializeTextTrack(track, 'srt', { start: 6, end: 9 }), 'srt')
  assert.deepEqual(
    range.map(({ start, duration, text }) => ({ start, duration, text })),
    [
      { start: 0, duration: 2, text: 'First' },
      { start: 2, duration: 1, text: 'Second' }
    ]
  )
  assert.throws(() => serializeTextTrack(track, 'vtt', { start: 0, end: 1 }))
})
test('text track visibility, splitting, history snapshots and persistence leave audio clips intact', () => {
  const doc = createAudioTimeline(),
    track = createTextTrack('歌词')
  doc.tracks[0].clips.push(createAudioClip('/voice.wav', 'Voice', 2))
  const cue = createTextCue('歌词', 1, 3)
  track.cues = splitTextCue(cue, 2.25)
  doc.textTracks = [track]
  assert.equal(splitTextCue(cue, 1), undefined)
  assert.equal(track.cues[1].duration, 1.75)
  assert.equal(timelineDuration(doc), 4)
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
  const before = cloneTimeline(doc)
  assert.deepEqual(activeTextCues(doc.textTracks, 2.25), [track.cues[1]])
  assert.deepEqual(activeTextCues(doc.textTracks, 4), [])
  track.visible = false
  assert.deepEqual(activeTextCues(doc.textTracks, 2), [])
  assert.equal(before.textTracks[0].visible, true)
  assert.deepEqual(doc.tracks, before.tracks)
  delete doc.textTracks
  assert.deepEqual(readAudioTimeline(JSON.stringify(doc)), doc)
})
test('invalid imported timing and damaged persisted text fail atomically', () => {
  for (const [text, format] of [
    ['[00:61.00]Invalid', 'lrc'],
    ['No timing', 'lrc'],
    ['1\n00:00:05,000 --> 00:00:01,000\nInvalid', 'srt'],
    ['1\n24:00:00,000 --> 24:00:03,000\nToo late', 'srt'],
    ['00:01.000 --> 00:02.000\nMissing header', 'vtt']
  ])
    assert.throws(() => parseTextTrack(text, format))
  assert.throws(() => parseTextTrack('x'.repeat(textLimits.fileBytes + 1), 'txt'))
  assert.throws(() => parseTextTrack('x\n'.repeat(textLimits.cues + 1), 'txt'))
  const doc = createAudioTimeline(),
    track = createTextTrack()
  track.cues = [createTextCue('text')]
  doc.textTracks = [track]
  track.cues[0].id = doc.tracks[0].id
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
  track.cues[0].id = 'cue'
  track.cues[0].duration = -1
  assert.throws(() => readAudioTimeline(JSON.stringify(doc)))
})

test('local UTF-8 and caption markup preserve literal text safely; lyric brackets are not metadata', () => {
  assert.equal(decodeTextFile(new TextEncoder().encode('歌词').buffer), '歌词')
  assert.throws(() => decodeTextFile(new Uint8Array([255, 254, 0]).buffer))
  const cue = parseTextTrack(
    '1\n00:00:00,000 --> 00:00:01,000\n<b>Words</b> &amp; &lt;literal&gt;',
    'srt'
  )[0]
  assert.equal(cue.text, 'Words & <literal>')
  const track = createTextTrack()
  track.cues = [createTextCue('<b>literal</b> & me')]
  assert.equal(
    parseTextTrack(serializeTextTrack(track, 'vtt'), 'vtt')[0].text,
    '<b>literal</b> & me'
  )
  assert.equal(parseTextTrack('[00:00.00]歌词 [合唱]', 'lrc')[0].text, '歌词 [合唱]')
})
