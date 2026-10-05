import assert from 'node:assert/strict'
import test from 'node:test'
import { AudioMixPreviewClient, mixPreviewSignature, needsCompleteMix } from './audioMixPreview.ts'
import { prepareAudioPreview } from './continuousAudioEngine.ts'

const doc = (processing = {}) => ({
  tracks: [
    {
      id: 'a',
      role: 'sound',
      clips: [
        { id: 'clip', path: '/a.wav', start: 0, sourceIn: 0, duration: 30, rate: 1, gain: 1 }
      ],
      processing
    }
  ],
  masterGain: 0.5
})
const job = (state, extra = {}) => ({
  id: 'mix-1',
  revision: 'sound-revision',
  state,
  phase: state,
  progress: state === 'ready' ? 1 : 0.2,
  duration: 30,
  error: '',
  ...extra
})
const response = (value) => new Response(JSON.stringify(value))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('stateful sound and ducking require finalized mix; muted/solo, bypass and zero EQ retain quick audition', () => {
  for (const p of [
    { compressor: 'custom' },
    { equalizer: 'voice' },
    { denoise: 'light' },
    { deess: true },
    { normalize: 'voice' },
    { limiter: true }
  ])
    assert.equal(needsCompleteMix('audio', doc(p)), true)
  assert.equal(needsCompleteMix('audio', doc({ normalize: 'music', bypass: true })), false)
  assert.equal(
    needsCompleteMix('audio', doc({ equalizer: 'custom', eq: { low: 0, mid: 0, high: 0 } })),
    false
  )
  const duck = doc()
  duck.tracks.push({ ...duck.tracks[0], id: 'music', role: 'music', duck: true })
  duck.tracks[0].role = 'dialogue'
  assert.equal(needsCompleteMix('audio', duck), true)
  duck.tracks[0].muted = true
  assert.equal(needsCompleteMix('audio', duck), false)
  const muted = doc({ normalize: 'voice' })
  muted.tracks[0].muted = true
  assert.equal(needsCompleteMix('audio', muted), false)
})
test('full mix receives actual master gain once while plain clips retain live master control', () => {
  const quick = prepareAudioPreview(doc())
  assert.equal(quick.gain, 0.5)
  assert.equal(quick.document.masterGain, 1)
  for (const p of [{ normalize: 'voice' }, { compressor: 'gentle' }]) {
    const ready = prepareAudioPreview(doc(p))
    assert.equal(ready.gain, 1)
    assert.equal(ready.document.masterGain, 0.5)
  }
})
test('pitch-preserving speed edits share finalized sound and master gain across audio and video seeks', () => {
  for (const rate of [0.5, 2]) {
    const audio = doc()
    audio.tracks[0].clips[0].rate = rate
    assert.equal(needsCompleteMix('audio', audio), true)
    const prepared = prepareAudioPreview(audio)
    assert.equal(prepared.gain, 1)
    assert.equal(prepared.document.masterGain, audio.masterGain)
    const video = {
      tracks: [{ id: 'a', kind: 'audio' }],
      sounds: [{ ...audio.tracks[0].clips[0], trackId: 'a', preservePitch: true }]
    }
    assert.equal(needsCompleteMix('video', video), true)
    audio.tracks[0].clips[0].preservePitch = false
    video.sounds[0].preservePitch = false
    assert.equal(needsCompleteMix('audio', audio), false)
    assert.equal(needsCompleteMix('video', video), false)
    video.sounds[0].preservePitch = true
    video.sounds[0].freeze = true
    assert.equal(needsCompleteMix('video', video), false)
  }
  const muted = doc()
  muted.tracks[0].clips[0].rate = 0.5
  muted.tracks[0].muted = true
  assert.equal(needsCompleteMix('audio', muted), false)
  muted.tracks[0].muted = false
  muted.tracks.push({ id: 'solo', solo: true, clips: [] })
  assert.equal(needsCompleteMix('audio', muted), false)
})
test('visual, subtitle and naming edits reuse sound; source interval and selected stream change sound', () => {
  const video = {
    sounds: [{ ...doc().tracks[0].clips[0], trackId: 'a' }],
    tracks: [{ id: 'a', kind: 'audio', gain: 1 }],
    visuals: [],
    captions: []
  }
  const edited = structuredClone(video)
  edited.visuals = [{ rotation: 45 }]
  edited.captions = [{ text: 'caption' }]
  edited.sounds[0].name = 'new name'
  assert.equal(mixPreviewSignature('video', video), mixPreviewSignature('video', edited))
  edited.sounds[0].audioStream = 1
  assert.notEqual(mixPreviewSignature('video', video), mixPreviewSignature('video', edited))
  edited.sounds[0].audioStream = undefined
  edited.sounds[0].sourceIn = 4
  assert.notEqual(mixPreviewSignature('video', video), mixPreviewSignature('video', edited))
})
test('waits for complete processing, reuses ready job for chunks, and shows progress', async () => {
  const calls = [],
    states = []
  const client = new AudioMixPreviewClient(
    'audio',
    'workspace',
    async (path) => {
      calls.push(path)
      return path.endsWith('/start')
        ? response(job('running'))
        : path.includes('/chunk?')
          ? new Response('pcm')
          : response(job('ready'))
    },
    (state) => states.push(state?.state),
    0
  )
  const signal = new AbortController().signal,
    document = doc({ normalize: 'voice' })
  assert.equal(await (await client.load(document, 0, 12, signal)).text(), 'pcm')
  await client.load(document, 12, 12, signal)
  assert.equal(calls.filter((path) => path.endsWith('/start')).length, 1)
  assert.deepEqual(states, ['running', 'ready'])
  assert.equal(calls.filter((path) => path.includes('/chunk?')).length, 2)
})
test('pause aborts local waiting without cancelling another viewer; resume can reuse the server job', async () => {
  const calls = [],
    controller = new AbortController()
  let progress
  const client = new AudioMixPreviewClient(
    'audio',
    'workspace',
    async (path) => {
      calls.push(path)
      return response(job('running'))
    },
    () => progress?.(),
    1000
  )
  const published = new Promise((resolve) => (progress = resolve))
  const waiting = client.load(doc({ limiter: true }), 0, 12, controller.signal)
  await published
  controller.abort()
  await assert.rejects(waiting, { name: 'AbortError' })
  assert.equal(calls.length, 1)
  assert.equal(
    calls.some((path) => path.includes('/cancel')),
    false
  )
  await client.cancelPreparation()
  assert.equal(
    calls.some((path) => path.includes('/cancel')),
    true
  )
  client.dispose()
})
test('expired source invalidates ready reference and retries preparation on the next playback', async () => {
  let starts = 0,
    fail = true
  const client = new AudioMixPreviewClient(
    'audio',
    'workspace',
    async (path) => {
      if (path.endsWith('/start')) {
        starts++
        return response(job('ready'))
      }
      if (fail) throw new Error('声音源已变化')
      return new Response('pcm')
    },
    () => {},
    0
  )
  const signal = new AbortController().signal
  await assert.rejects(client.load(doc({ limiter: true }), 0, 1, signal), /声音源已变化/)
  fail = false
  await client.load(doc({ limiter: true }), 0, 1, signal)
  assert.equal(starts, 2)
})

test('closing a viewer during start waits for the assigned id and releases its interest without publishing', async (t) => {
  const start = deferred(),
    calls = [],
    states = []
  const client = new AudioMixPreviewClient(
    'audio',
    'workspace',
    async (path, options) => {
      calls.push({ path, options })
      return path.endsWith('/start') ? start.promise : response(job('cancelled'))
    },
    (state) => states.push(state),
    0,
    '11111111-1111-4111-8111-111111111111'
  )
  t.after(() => client.dispose())
  const waiting = client.load(doc({ limiter: true }), 0, 1, new AbortController().signal)
  const stopped = assert.rejects(waiting, { name: 'AbortError' })
  client.dispose()
  assert.equal(calls[0].options.signal.aborted, false)
  start.resolve(response(job('running')))
  await stopped
  assert.equal(calls.length, 2)
  assert.equal(new URL(calls[1].path, 'http://local').pathname, '/audio_mix_cache/mix-1/cancel')
  assert.equal(
    new URL(calls[1].path, 'http://local').searchParams.get('client_id'),
    '11111111-1111-4111-8111-111111111111'
  )
  assert.deepEqual(states, [])
})

test('a paused viewer keeps observing background completion and resumes without a second start', async (t) => {
  const running = deferred(),
    polled = deferred(),
    status = deferred(),
    completed = deferred(),
    calls = [],
    controller = new AbortController()
  const client = new AudioMixPreviewClient(
    'audio',
    'workspace',
    async (path) => {
      calls.push(path)
      if (path.endsWith('/start')) return response(job('running'))
      if (path.includes('/chunk?')) return new Response('final PCM')
      polled.resolve()
      return status.promise
    },
    (state) => {
      if (state?.state === 'running') running.resolve()
      if (state?.state === 'ready') completed.resolve()
    },
    0
  )
  t.after(() => client.dispose())
  const document = doc({ normalize: 'voice' }),
    waiting = client.load(document, 0, 1, controller.signal)
  const stopped = assert.rejects(waiting, { name: 'AbortError' })
  await running.promise
  controller.abort()
  await stopped
  await polled.promise
  assert.equal(
    calls.some((path) => path.includes('/cancel')),
    false
  )
  status.resolve(response(job('ready')))
  await completed.promise
  const resumed = await client.load(document, 8, 1, new AbortController().signal)
  assert.equal(await resumed.text(), 'final PCM')
  assert.equal(calls.filter((path) => path.endsWith('/start')).length, 1)
})

test('editing sound while paused releases the obsolete task and clears its status without submitting another mix', async (t) => {
  const running = deferred(),
    calls = [],
    states = [],
    controller = new AbortController()
  const client = new AudioMixPreviewClient(
    'audio',
    'workspace',
    async (path) => {
      calls.push(path)
      return response(job(path.includes('/cancel?') ? 'cancelled' : 'running'))
    },
    (state) => {
      states.push(state)
      if (state?.state === 'running') running.resolve()
    },
    1000
  )
  t.after(() => client.dispose())
  const waiting = client.load(doc({ limiter: true }), 0, 1, controller.signal),
    stopped = assert.rejects(waiting, { name: 'AbortError' })
  await running.promise
  controller.abort()
  await stopped
  client.observeDocument(doc({ normalize: 'voice' }))
  await Promise.resolve()
  assert.equal(calls.filter((path) => path.endsWith('/start')).length, 1)
  assert.equal(calls.filter((path) => path.includes('/cancel?')).length, 1)
  assert.equal(states.at(-1), null)
})

test('editing only pictures or captions while paused keeps the video sound observer', async (t) => {
  const running = deferred(),
    calls = [],
    states = [],
    controller = new AbortController(),
    document = {
      tracks: [{ id: 'a', kind: 'audio', processing: { limiter: true } }],
      sounds: [{ ...doc().tracks[0].clips[0], trackId: 'a' }],
      visuals: [],
      captions: []
    }
  const client = new AudioMixPreviewClient(
    'video',
    'workspace',
    async (path) => {
      calls.push(path)
      return response(job('running'))
    },
    (state) => {
      states.push(state)
      if (state?.state === 'running') running.resolve()
    },
    1000
  )
  t.after(() => client.dispose())
  const waiting = client.load(document, 0, 1, controller.signal),
    stopped = assert.rejects(waiting, { name: 'AbortError' })
  await running.promise
  controller.abort()
  await stopped
  const changed = structuredClone(document)
  changed.visuals.push({ rotation: 42 })
  changed.captions.push({ text: 'new subtitle' })
  client.observeDocument(changed)
  assert.equal(calls.length, 1)
  assert.equal(states.at(-1)?.state, 'running')
})

test('changing revision releases a late old start while only publishing and loading the new sound', async (t) => {
  const oldStart = deferred(),
    calls = [],
    states = []
  const client = new AudioMixPreviewClient(
    'audio',
    'workspace',
    async (path, options) => {
      calls.push(path)
      if (path.endsWith('/start')) {
        const body = JSON.parse(options.body)
        return body.document.tracks[0].processing.limiter
          ? oldStart.promise
          : response(job('ready', { id: 'new-sound', revision: 'new-revision' }))
      }
      if (path.includes('/cancel?')) return response(job('cancelled', { id: 'old-sound' }))
      return new Response('new PCM')
    },
    (state) => states.push(state),
    0
  )
  t.after(() => client.dispose())
  const oldLoad = client.load(doc({ limiter: true }), 0, 1, new AbortController().signal),
    oldStopped = assert.rejects(oldLoad, { name: 'AbortError' })
  const next = await client.load(doc({ normalize: 'voice' }), 0, 1, new AbortController().signal)
  assert.equal(await next.text(), 'new PCM')
  oldStart.resolve(response(job('running', { id: 'old-sound' })))
  await oldStopped
  assert.equal(calls.filter((path) => path.includes('/old-sound/cancel?')).length, 1)
  assert.equal(
    calls.some((path) => path.includes('/old-sound/chunk?')),
    false
  )
  assert.deepEqual(
    states.map((state) => state.id),
    ['new-sound']
  )
})

test('cancelling one viewer releases only its client id while a second viewer finishes the shared task', async (t) => {
  const owners = new Set(),
    observed = [deferred(), deferred()],
    calls = []
  let ready = false
  const request = async (path, options) => {
    const url = new URL(path, 'http://local')
    if (path.endsWith('/start')) {
      owners.add(JSON.parse(options.body).client_id)
      return response(job('running'))
    }
    const clientId = url.searchParams.get('client_id')
    calls.push({ path, clientId })
    if (path.includes('/cancel?')) {
      owners.delete(clientId)
      return response(job(owners.size ? 'running' : 'cancelled'))
    }
    if (path.includes('/chunk?')) return new Response('shared PCM')
    owners.add(clientId)
    return response(job(ready ? 'ready' : 'running'))
  }
  const clients = observed.map(
    (state, index) =>
      new AudioMixPreviewClient(
        'audio',
        'workspace',
        request,
        (value) => value?.state === 'running' && state.resolve(),
        1,
        `${index + 1}1111111-1111-4111-8111-111111111111`
      )
  )
  t.after(() => clients.forEach((client) => client.dispose()))
  const document = doc({ limiter: true }),
    first = clients[0].load(document, 0, 1, new AbortController().signal),
    stopped = assert.rejects(first, { name: 'AbortError' }),
    second = clients[1].load(document, 0, 1, new AbortController().signal)
  await Promise.all(observed.map((item) => item.promise))
  await clients[0].cancelPreparation()
  await stopped
  assert.deepEqual([...owners], ['21111111-1111-4111-8111-111111111111'])
  ready = true
  assert.equal(await (await second).text(), 'shared PCM')
  assert.deepEqual(
    calls.filter((call) => call.path.includes('/cancel?')).map((call) => call.clientId),
    ['11111111-1111-4111-8111-111111111111']
  )
})

test('a late released start cannot cancel a new preparation after editing and undoing to the same sound', async (t) => {
  const originalStart = deferred(),
    resumed = deferred(),
    finish = deferred(),
    owners = new Set()
  let starts = 0,
    cancelled = false
  const client = new AudioMixPreviewClient(
    'audio',
    'workspace',
    async (path, options) => {
      if (path.endsWith('/start')) {
        const body = JSON.parse(options.body)
        if (!body.document.tracks[0].processing.limiter)
          return response(job('ready', { id: 'other-sound' }))
        starts++
        owners.add(body.client_id)
        return starts === 1 ? originalStart.promise : response(job('running'))
      }
      const url = new URL(path, 'http://local')
      if (url.pathname.endsWith('/cancel')) {
        owners.delete(url.searchParams.get('client_id'))
        if (!owners.size) cancelled = true
        return response(job(cancelled ? 'cancelled' : 'running'))
      }
      if (url.pathname.endsWith('/chunk')) return new Response('current PCM')
      await finish.promise
      return response(job(cancelled ? 'cancelled' : 'ready'))
    },
    (state) => {
      if (starts === 2 && state?.id === 'mix-1' && state.state === 'running') resumed.resolve()
    },
    0
  )
  t.after(() => client.dispose())
  const document = doc({ limiter: true }),
    original = client.load(document, 0, 1, new AbortController().signal),
    stopped = assert.rejects(original, { name: 'AbortError' })
  await client.load(doc({ normalize: 'voice' }), 0, 1, new AbortController().signal)
  const current = client.load(document, 0, 1, new AbortController().signal),
    completes = assert.doesNotReject(current)
  await resumed.promise
  originalStart.resolve(response(job('running')))
  await stopped
  finish.resolve()
  await completes
  assert.equal(await (await current).text(), 'current PCM')
})

test('a failed background status request replaces the running progress with an actionable failure', async (t) => {
  const states = []
  const client = new AudioMixPreviewClient(
    'audio',
    'workspace',
    async (path) => {
      if (path.endsWith('/start')) return response(job('running'))
      throw new Error('connection lost')
    },
    (state) => states.push(state),
    0
  )
  t.after(() => client.dispose())
  await assert.rejects(
    client.load(doc({ limiter: true }), 0, 1, new AbortController().signal),
    /connection lost/
  )
  assert.equal(states.at(-1)?.state, 'failed')
  assert.match(states.at(-1)?.error ?? '', /connection lost/)
})
