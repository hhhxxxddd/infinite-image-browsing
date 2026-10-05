import test from 'node:test'
import assert from 'node:assert/strict'
import {
  audioWaveformPath,
  audioWaveformGeometry,
  sameAudioWaveformProps
} from './audioWaveformView.ts'
import { videoClipStripWindow, sameVideoClipStripProps } from './videoClipStripView.ts'

test('combined waveform paths retain quiet peaks, bar gaps and amplitude limits in both channels', () => {
  assert.equal(
    audioWaveformPath([0, 0.5, 2], 1, 32),
    'M0,15.8h2v0.4h-2zM3,8.5h2v15h-2zM6,1h2v30h-2z'
  )
  assert.equal(audioWaveformPath([0.5, 1], 2, 16, 1), 'M0,17h2v14h-2zM3,17h2v14h-2z')
  assert.equal(audioWaveformPath([], 1, 32), '')
  const window = { window_start: 100, window_duration: 20 }
  const clip = { start: 10, sourceIn: 80, duration: 40, rate: 2 }
  assert.deepEqual(audioWaveformGeometry(window, clip, 10), { left: 100, width: 100 })
  assert.deepEqual(audioWaveformGeometry(window, clip, 10, true), { left: 200, width: 100 })
  assert.deepEqual(audioWaveformGeometry(window, clip, 10, false, { left: 220, width: 50 }), {
    left: 100,
    width: 100,
    clipPath: 'inset(0 30px 0 20px)'
  })
  assert.equal(audioWaveformGeometry(window, clip, 10, false, { left: 350, width: 50 }), null)
  assert.deepEqual(audioWaveformGeometry(window, clip, 10, true, { left: 350, width: 40 }), {
    left: 200,
    width: 100,
    clipPath: 'inset(0 10px 0 50px)'
  })
})

const props = {
  clip: { path: '/voice.mp3', start: 1, sourceIn: 2, duration: 30 },
  workspaceId: 'workspace',
  zoom: 20,
  left: 128,
  width: 900,
  retry: 0
}

test('waveform memo ignores processing changes but refreshes every source or viewport change', () => {
  assert.equal(
    sameAudioWaveformProps(props, {
      ...props,
      clip: {
        ...props.clip,
        name: 'new name',
        gain: 2,
        fadeIn: 4,
        gainPoints: [{ time: 0, gain: 0.5 }]
      }
    }),
    true
  )
  assert.equal(
    sameAudioWaveformProps(props, {
      ...props,
      amplitude: 1,
      stereo: false,
      clip: { ...props.clip, rate: 1, audioStream: 0 }
    }),
    true
  )
  for (const [field, value] of Object.entries({
    path: '/other.wav',
    sourceKind: 'video',
    start: 2,
    sourceIn: 3,
    duration: 29,
    rate: 2,
    audioStream: 1
  })) {
    assert.equal(
      sameAudioWaveformProps(props, { ...props, clip: { ...props.clip, [field]: value } }),
      false,
      field
    )
  }
  for (const [field, value] of Object.entries({
    workspaceId: 'other',
    zoom: 30,
    left: 129,
    width: 901,
    retry: 1,
    amplitude: 2,
    stereo: true
  })) {
    assert.equal(sameAudioWaveformProps(props, { ...props, [field]: value }), false, field)
  }
})

const videoProps = {
  clip: { path: '/clip.mp4', kind: 'video', start: 2, sourceIn: 20, duration: 100, rate: 2 },
  workspaceId: 'workspace',
  left: 500,
  width: 900,
  pixelsPerSecond: 20,
  lane: 'sound',
  imageUrl: '/clip.mp4?t=1'
}

test('video sound windows stay stable within a bucket and map reverse/rate source time correctly', () => {
  const first = videoClipStripWindow(videoProps)
  assert.deepEqual(first, { start: 58.4, end: 160.8, screenWidth: 1024, offset: 384 })
  assert.deepEqual(videoClipStripWindow({ ...videoProps, left: 505 }), first)
  const reversed = videoClipStripWindow({
    ...videoProps,
    clip: { ...videoProps.clip, reverse: true }
  })
  assert.ok(Math.abs(reversed.start - 79.2) < 1e-10)
  assert.equal(reversed.end, 181.6)
  const visual = videoClipStripWindow({ ...videoProps, lane: 'visual' })
  assert.deepEqual(visual, { start: 66, end: 156, screenWidth: 900, offset: 460 })
  assert.equal(videoClipStripWindow({ ...videoProps, lane: 'visual', left: 505 }).start, 66.5)
})

test('video strip memo preserves source stream, reverse, freeze and source revision refreshes', () => {
  assert.equal(
    sameVideoClipStripProps(videoProps, {
      ...videoProps,
      clip: { ...videoProps.clip, gain: 2, fadeOut: 3, transform: { x: 10 } }
    }),
    true
  )
  for (const [field, value] of Object.entries({
    sourceIn: 21,
    rate: 1,
    duration: 80,
    reverse: true,
    freeze: true,
    audioStream: 1
  })) {
    assert.equal(
      sameVideoClipStripProps(videoProps, {
        ...videoProps,
        clip: { ...videoProps.clip, [field]: value }
      }),
      false,
      field
    )
  }
  assert.equal(
    sameVideoClipStripProps(videoProps, { ...videoProps, imageUrl: '/clip.mp4?t=2' }),
    false
  )
  assert.equal(
    sameVideoClipStripProps(videoProps, { ...videoProps, sourceRevision: 'updated' }),
    false
  )
})
