import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../../shared/apiClient'
import { decodeLevels } from '../../../src/features/media-editor/model/audioLevels'
import { ContinuousPreviewEngine, type AudioPlayRequest } from './continuousAudioEngine'
import { prepareVideoAudioPreview } from './videoAudioPreview'
import type { VideoTimelineDocument } from './videoStudioModel'
import { AudioMixPreviewClient, type MixPreparation } from './audioMixPreview'

export function useVideoAudioPreview(options: {
  workspaceId: string
  onTime: (time: number) => void
  onEnded?: () => void
  onError?: (cause: unknown) => void
}) {
  const callbacks = useRef(options)
  callbacks.current = options
  const engine = useRef<ContinuousPreviewEngine<VideoTimelineDocument> | null>(null)
  const mixClient = useRef<AudioMixPreviewClient | null>(null)
  const [preparation, setPreparation] = useState<MixPreparation | null>(null)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [levels, setLevels] = useState({ left: 0, right: 0 })
  const workspaceId = options.workspaceId
  const stop = useCallback(() => engine.current?.stop(), [])
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
    async (request: AudioPlayRequest<VideoTimelineDocument>) => {
      if (!engine.current) {
        const context = new AudioContext({ sampleRate: 48000 })
        const client = new AudioMixPreviewClient('video', workspaceId, apiRequest, setPreparation)
        mixClient.current = client
        engine.current = new ContinuousPreviewEngine(
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
            levels: (left, right) => setLevels({ left, right }),
            ended: () => callbacks.current.onEnded?.(),
            error: (cause) => callbacks.current.onError?.(cause)
          },
          prepareVideoAudioPreview
        )
      }
      await engine.current.play(request)
    },
    [workspaceId]
  )
  const update = useCallback((request: Omit<AudioPlayRequest<VideoTimelineDocument>, 'start'>) => {
    mixClient.current?.observeDocument(request.document)
    engine.current?.update(request)
  }, [])
  const cancelPreparation = async () => {
    stop()
    try {
      await mixClient.current?.cancelPreparation()
    } catch (cause) {
      callbacks.current.onError?.(cause)
    }
  }
  return { play, stop, update, playing, buffering, levels, preparation, cancelPreparation }
}
