import { useEffect, useMemo, useRef, useState } from 'react'
import AudioMixPreparation from './AudioMixPreparation'
import { ActionIcon, Alert, Group, ScrollArea, Slider, Stack, Text, Tooltip } from '@mantine/core'
import { IconPlayerPause, IconPlayerPlay } from '@tabler/icons-react'
import { apiUrl } from '../../shared/apiClient'
import { readEditorSnapshot } from './editorSnapshot'
import type { EditorVersionKind } from './editorVersionModel'
import { formatTimelineTime } from './timelineTime'
import { useContinuousAudioPreview } from './useContinuousAudioPreview'
import { useVideoAudioPreview } from './useVideoAudioPreview'
import VideoStage from './VideoStage'
import { useVideoMedia } from './useVideoMedia'
import {
  clipTrack,
  previewSourceTime,
  timelineEnd,
  trackIdFor,
  trackAudible,
  type VideoClip,
  type VideoTimelineDocument
} from './videoStudioModel'
import { videoPreviewActive, videoPreviewTime } from './videoPreviewPosition'
import './EditorSnapshotPreview.css'

function sourceUrl(clip: VideoClip) {
  if (clip.path.startsWith('workspace-artifact:'))
    return apiUrl(`/workspace_artifacts/${encodeURIComponent(clip.path.slice(19))}/file`)
  return clip.kind === 'image'
    ? apiUrl(`/img/${encodeURIComponent(clip.name)}?path=${encodeURIComponent(clip.path)}`)
    : apiUrl(`/stream_video?path=${encodeURIComponent(clip.path)}`)
}
function SnapshotVideoFrame({
  document,
  time,
  workspaceId,
  playing = false,
  soundBuffering = false,
  onBufferingChange,
  onError
}: {
  document: VideoTimelineDocument
  time: number
  workspaceId: string
  playing?: boolean
  soundBuffering?: boolean
  onBufferingChange?: (waiting: boolean) => void
  onError?: (message: string) => void
}) {
  const media = useVideoMedia(workspaceId, true)
  const videos = useRef<Record<string, HTMLVideoElement | null>>({})
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState<string[]>([])
  const end = timelineEnd(document)
  const clips = document.visuals
    .filter(
      (clip) => videoPreviewActive(clip, time, end) && !clipTrack(document, clip, 'visual')?.hidden
    )
    .sort(
      (a, b) =>
        document.tracks.findIndex((track) => track.id === trackIdFor(a, 'visual')) -
          document.tracks.findIndex((track) => track.id === trackIdFor(b, 'visual')) ||
        a.start - b.start
    )
  const captions = document.captions.filter((cue) => videoPreviewActive(cue, time, end))
  const frameTime = videoPreviewTime(time, end, document.fps, [...clips, ...captions])
  const key = clips.map((clip) => `${clip.id}:${clip.path}`).join('|')
  const buffering = waiting.some((id) => clips.some((clip) => clip.id === id))
  function markWaiting(id: string, value: boolean) {
    setWaiting((current) =>
      value
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((item) => item !== id)
    )
  }
  function failed(clip: VideoClip) {
    const message = `无法预览素材：${clip.name}，可返回编辑器重新链接`
    markWaiting(clip.id, false)
    setError(message)
    onError?.(message)
  }
  useEffect(() => onBufferingChange?.(buffering), [buffering, onBufferingChange])
  const url = (clip: VideoClip) => media.proxyUrl(clip.path) ?? sourceUrl(clip)
  function seek(clip: VideoClip, video: HTMLVideoElement) {
    const target = previewSourceTime(
      clip,
      frameTime,
      document.fps,
      media.infos[clip.path]?.fps ?? document.fps
    )
    if (
      video.readyState &&
      !video.seeking &&
      Math.abs(video.currentTime - target) >
        (playing && !clip.reverse && !clip.freeze ? 0.15 : 0.5 / document.fps)
    )
      video.currentTime = target
  }
  useEffect(() => {
    let live = true
    setError('')
    for (const clip of new Map(clips.map((clip) => [clip.path, clip])).values())
      void media.load(clip, true).catch(() => {
        if (live) failed(clip)
      })
    return () => {
      live = false
    }
  }, [key, media.load])
  useEffect(() => {
    for (const clip of clips) {
      const video = videos.current[clip.id]
      if (video) {
        seek(clip, video)
        video.playbackRate = clip.rate
        if (playing && !buffering && !soundBuffering && !clip.reverse && !clip.freeze) {
          if (video.paused) void video.play().catch(() => failed(clip))
        } else if (!video.paused) video.pause()
      }
    }
  }, [frameTime, key, media.infos, playing, buffering, soundBuffering])
  return (
    <Stack gap={4}>
      {error && <Alert color="red">{error}</Alert>}
      {media.error && <Alert color="red">{media.error}</Alert>}
      <div className="editor-snapshot-frame">
        <VideoStage
          doc={document}
          clips={clips}
          captions={captions}
          time={frameTime}
          playing={playing && !buffering && !soundBuffering}
          videos={videos.current}
          url={url}
          readonly
          onSelect={() => {}}
        />
      </div>
      <div hidden>
        {clips
          .filter((clip) => clip.kind === 'video')
          .map((clip) => (
            <video
              key={`${clip.id}:${clip.path}`}
              ref={(node) => {
                videos.current[clip.id] = node
              }}
              src={url(clip)}
              muted
              preload="auto"
              crossOrigin="anonymous"
              playsInline
              onLoadStart={() => markWaiting(clip.id, true)}
              onWaiting={() => markWaiting(clip.id, true)}
              onCanPlay={() => markWaiting(clip.id, false)}
              onPlaying={() => markWaiting(clip.id, false)}
              onLoadedMetadata={(event) => seek(clip, event.currentTarget)}
              onSeeked={() => markWaiting(clip.id, false)}
              onError={() => failed(clip)}
            />
          ))}
      </div>
    </Stack>
  )
}

/** Read-only snapshot: viewing/seeking never restores or writes the current production document. */
export default function EditorSnapshotPreview({
  kind,
  document,
  workspaceId
}: {
  kind: EditorVersionKind
  document: unknown
  workspaceId: string
}) {
  const snapshot = useMemo(() => readEditorSnapshot(kind, document), [kind, document])
  const [time, setTime] = useState(0)
  const [error, setError] = useState('')
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [visualWaiting, setVisualWaiting] = useState(false)
  const videoActive = useRef(false)
  const position = useRef(time)
  position.current = time
  const videoPolicy = useRef({ videoPlaying, visualWaiting })
  videoPolicy.current = { videoPlaying, visualWaiting }
  const audio = useContinuousAudioPreview({
    workspaceId,
    onTime: setTime,
    onError: (cause) => setError(cause instanceof Error ? cause.message : '版本试听失败')
  })
  const videoAudio = useVideoAudioPreview({
    workspaceId,
    onTime: (value) => {
      if (videoPolicy.current.videoPlaying && !videoPolicy.current.visualWaiting) setTime(value)
    },
    onEnded: () => {
      videoActive.current = false
      setVideoPlaying(false)
      setTime(snapshot.duration)
    },
    onError: (cause) => {
      videoActive.current = false
      setVideoPlaying(false)
      setError(cause instanceof Error ? cause.message : '版本试听失败')
    }
  })
  const hasSounds =
    snapshot.kind === 'video' &&
    snapshot.document.sounds.some((clip) => trackAudible(snapshot.document, clip))
  useEffect(() => {
    if (snapshot.kind !== 'video' || !videoPlaying || visualWaiting || !hasSounds) {
      videoActive.current = false
      videoAudio.stop()
      return
    }
    if (!videoActive.current) {
      videoActive.current = true
      void videoAudio.play({
        document: snapshot.document,
        start: position.current,
        end: snapshot.duration
      })
    }
  }, [snapshot, videoPlaying, visualWaiting, hasSounds, videoAudio.play, videoAudio.stop])
  useEffect(() => {
    if (snapshot.kind !== 'video' || !videoPlaying || hasSounds || visualWaiting) return
    let frame = 0,
      previous = performance.now()
    const tick = (now: number) => {
      const elapsed = Math.min(0.2, (now - previous) / 1000)
      previous = now
      setTime((value) => {
        const next = Math.min(snapshot.duration, value + elapsed)
        if (next >= snapshot.duration) setVideoPlaying(false)
        return next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [snapshot, videoPlaying, hasSounds, visualWaiting])
  const duration = Math.max(snapshot.duration, 0.001)
  function seek(value: number) {
    audio.stop()
    videoAudio.stop()
    videoActive.current = false
    setVideoPlaying(false)
    setTime(Math.max(0, Math.min(value, snapshot.duration)))
  }
  const activeText = snapshot.lanes
    .filter((lane) => !lane.disabled)
    .flatMap((lane) => lane.items)
    .filter(
      (item) => item.type === 'text' && time >= item.start && time < item.start + item.duration
    )
  return (
    <Stack gap="xs" className="editor-snapshot-preview">
      {snapshot.kind === 'video' && (
        <SnapshotVideoFrame
          document={snapshot.document}
          time={time}
          workspaceId={workspaceId}
          playing={videoPlaying}
          soundBuffering={hasSounds && videoAudio.buffering}
          onBufferingChange={setVisualWaiting}
          onError={(message) => {
            setVideoPlaying(false)
            videoAudio.stop()
            setError(message)
          }}
        />
      )}
      {error && <Alert color="red">{error}</Alert>}
      {snapshot.kind === 'audio' && activeText.length > 0 && (
        <Text size="xs">{activeText.map((item) => item.label).join(' · ')}</Text>
      )}
      <Group gap="xs" wrap="nowrap">
        <Tooltip
          label={
            (snapshot.kind === 'audio' ? audio.playing : videoPlaying)
              ? '暂停版本试听'
              : '试听此版本'
          }
        >
          <ActionIcon
            aria-label={
              (snapshot.kind === 'audio' ? audio.playing : videoPlaying)
                ? '暂停版本试听'
                : '试听此版本'
            }
            disabled={!snapshot.duration}
            variant="light"
            onClick={() => {
              setError('')
              if (snapshot.kind === 'video') {
                if (videoPlaying) {
                  videoAudio.stop()
                  videoActive.current = false
                  setVideoPlaying(false)
                } else {
                  if (time >= snapshot.duration) setTime(0)
                  setVideoPlaying(true)
                }
              } else if (audio.playing) audio.stop()
              else
                void audio.play({
                  document: snapshot.document,
                  start: time >= snapshot.duration ? 0 : time,
                  end: snapshot.duration
                })
            }}
          >
            {(snapshot.kind === 'audio' ? audio.playing : videoPlaying) ? (
              <IconPlayerPause size={15} />
            ) : (
              <IconPlayerPlay size={15} />
            )}
          </ActionIcon>
        </Tooltip>
        <Text size="xs" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatTimelineTime(time)} / {formatTimelineTime(snapshot.duration)}
        </Text>
        {(audio.buffering ||
          (videoPlaying && (visualWaiting || (hasSounds && videoAudio.buffering)))) && (
          <Text size="xs" c="dimmed">
            准备试听…
          </Text>
        )}
      </Group>
      <AudioMixPreparation
        job={snapshot.kind === 'audio' ? audio.preparation : videoAudio.preparation}
        onCancel={() => {
          if (snapshot.kind === 'audio') void audio.cancelPreparation()
          else {
            setVideoPlaying(false)
            void videoAudio.cancelPreparation()
          }
        }}
      />
      <Slider
        aria-label="版本预览位置"
        value={time}
        min={0}
        max={duration}
        step={snapshot.kind === 'video' ? 1 / snapshot.document.fps : 0.01}
        onChange={seek}
        disabled={!snapshot.duration}
        label={formatTimelineTime}
      />
      <ScrollArea h={Math.min(180, Math.max(40, snapshot.lanes.length * 35))}>
        <div className="editor-snapshot-timeline">
          {snapshot.lanes.map((lane) => (
            <div
              key={lane.id}
              className={`editor-snapshot-lane ${lane.disabled ? 'is-disabled' : ''}`}
            >
              <Text size="xs" truncate title={lane.name}>
                {lane.name}
              </Text>
              <div className="editor-snapshot-lane-content">
                {lane.items.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`editor-snapshot-item is-${item.type}`}
                    title={`${item.label} · ${formatTimelineTime(item.start)} — ${formatTimelineTime(item.start + item.duration)}`}
                    aria-label={`预览 ${item.label} ${formatTimelineTime(item.start)}`}
                    style={{
                      left: `${(item.start / duration) * 100}%`,
                      width: `${(item.duration / duration) * 100}%`
                    }}
                    onClick={() => seek(item.start)}
                  >
                    {item.label}
                  </button>
                ))}
                <i
                  className="editor-snapshot-cursor"
                  style={{ left: `${(time / duration) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {!snapshot.lanes.some((lane) => lane.items.length) && (
            <Text size="xs" c="dimmed">
              空时间线
            </Text>
          )}
        </div>
      </ScrollArea>
    </Stack>
  )
}
