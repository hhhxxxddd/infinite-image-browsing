import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../shared/apiClient'
import { decodeLevels } from '../../../src/features/media-editor/model/audioLevels'
import { ContinuousAudioEngine, type AudioPlayRequest } from './continuousAudioEngine'
import { AudioMixPreviewClient, type MixPreparation } from './audioMixPreview'

export function useContinuousAudioPreview(options: {
  workspaceId: string
  onTime: (time: number) => void
  onEnded?: () => void
  onError?: (error: unknown) => void
}) {
  const callbacks = useRef(options)
  callbacks.current = options
  const engine = useRef<ContinuousAudioEngine | null>(null)
  const mixClient = useRef<AudioMixPreviewClient | null>(null)
  const [preparation, setPreparation] = useState<MixPreparation | null>(null)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [levels, setLevels] = useState({ left: 0, right: 0 })
  const [peak, setPeak] = useState(0)
  const workspaceId = options.workspaceId
  const stop = useCallback(() => engine.current?.stop(), [])
  const update = useCallback((request: Omit<AudioPlayRequest, 'start'>) => {
    mixClient.current?.observeDocument(request.document)
    engine.current?.update(request)
  }, [])
  useEffect(
    () => () => {
      engine.current?.dispose()
      engine.current = null
      mixClient.current?.dispose()
      mixClient.current = null
    },
    [workspaceId]
  )
  const play = useCallback(
    async (request: AudioPlayRequest) => {
      if (!engine.current) {
        const context = new AudioContext({ sampleRate: 48000 })
        const client = new AudioMixPreviewClient('audio', workspaceId, apiRequest, setPreparation)
        mixClient.current = client
        engine.current = new ContinuousAudioEngine(
          context,
          async (document, start, duration, signal) => {
            const response = await client.load(document, start, duration, signal)
            const levels = decodeLevels(response.headers.get('X-Audio-Level-Peaks') ?? '')
            const buffer = await context.decodeAudioData(await response.arrayBuffer())
            return { buffer, levels }
          },
          {
            time: (time) => callbacks.current.onTime(time),
            state: (playing, buffering) => {
              setPlaying(playing)
              setBuffering(buffering)
            },
            levels: (left, right) => {
              setLevels({ left, right })
              setPeak((previous) => Math.max(previous, left, right))
            },
            ended: () => callbacks.current.onEnded?.(),
            error: (error) => callbacks.current.onError?.(error)
          }
        )
      }
      await engine.current.play(request)
    },
    [workspaceId]
  )
  return {
    playing,
    buffering,
    levels,
    peak,
    preparation,
    cancelPreparation: async () => {
      stop()
      try {
        await mixClient.current?.cancelPreparation()
      } catch (error) {
        callbacks.current.onError?.(error)
      }
    },
    resetPeak: () => setPeak(0),
    play,
    update,
    pause: stop,
    stop
  }
}
