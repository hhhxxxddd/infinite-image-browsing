import { ActionIcon, Button, NumberInput, SegmentedControl, Tooltip } from '@mantine/core'
import { IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import AudioClipEnvelope from './AudioClipEnvelope'
import {
  addSoundEditorGainPoint,
  editSoundEditorGainPoint,
  soundEditorGainPoint
} from './soundEditorGainPoint'
import {
  visibleClipFades,
  type AudioClip
} from '../../../src/features/media-editor/model/audioTimeline'
import './TimelineSoundEditor.css'

export type SoundEditorMode = 'fades' | 'gain'

/** One dock below the track list, sharing its visible time window and playhead. */
export default function TimelineSoundEditor({
  clip,
  trackName,
  headerWidth,
  zoom,
  viewportLeft,
  viewportWidth,
  mode,
  onModeChange,
  readonly,
  playhead,
  onClose,
  onBegin,
  onChange,
  onEnd,
  onAudition
}: {
  clip: AudioClip
  trackName: string
  headerWidth: number
  zoom: number
  viewportLeft: number
  viewportWidth: number
  mode: SoundEditorMode
  onModeChange: (mode: SoundEditorMode) => void
  readonly: boolean
  playhead: number
  onClose: () => void
  onBegin: () => void
  onChange: (clip: AudioClip) => void
  onEnd: (cancel: boolean) => void
  onAudition?: (edge: 'start' | 'end') => void
}) {
  const [pointSelection, setPointSelection] = useState<{
    clipId: string
    time: number | null
    index: number
  }>({ clipId: clip.id, time: null, index: -1 })
  const selectedTime = pointSelection.clipId === clip.id ? pointSelection.time : null
  // Video previews arrive on the next frame. Keep the selected input mounted while a point moves.
  const selectedPoint =
    soundEditorGainPoint(clip, selectedTime) ??
    (pointSelection.clipId === clip.id
      ? soundEditorGainPoint(clip, clip.gainPoints?.[pointSelection.index]?.time ?? null)
      : null)
  const numericGesture = useRef<typeof pointSelection | null>(null)
  const endRef = useRef(onEnd)
  endRef.current = onEnd
  useEffect(
    () => () => {
      if (numericGesture.current) {
        numericGesture.current = null
        endRef.current(true)
      }
    },
    [clip.id, mode, readonly]
  )
  const selectPoint = (
    time: number | null,
    nextClip = clip,
    index = selectedPoint?.index ?? -1
  ) => {
    const point = soundEditorGainPoint(nextClip, time)
    setPointSelection({
      clipId: clip.id,
      time,
      index: time === null ? -1 : (point?.index ?? index)
    })
  }
  const endNumeric = (cancel = false) => {
    const gesture = numericGesture.current
    if (!gesture) return
    numericGesture.current = null
    if (cancel) setPointSelection(gesture)
    onEnd(cancel)
  }
  const beginNumeric = () => {
    if (readonly || numericGesture.current) return
    numericGesture.current = pointSelection
    onBegin()
  }
  const editPoint = (patch: { local?: number; gain?: number }) => {
    if (readonly) return
    const next = editSoundEditorGainPoint(clip, selectedPoint?.point.time ?? null, patch)
    if (!next || next.clip === clip) return
    beginNumeric()
    selectPoint(next.time, next.clip)
    onChange(next.clip)
  }
  const commitPoint = (next: AudioClip, time: number | null) => {
    if (readonly) return
    selectPoint(time, next)
    if (next === clip) return
    onBegin()
    onChange(next)
    onEnd(false)
  }
  const guides = mode === 'gain' ? [4, 2, 1, 0] : [1, 0]
  const maxGain = mode === 'gain' ? 4 : 1
  const guideTop = (gain: number) => 4 + ((46 - (gain / maxGain) * 40) / 52) * 68
  return (
    <section className="timeline-sound-editor" role="region" aria-label={`声音编辑：${clip.name}`}>
      <header className="timeline-sound-editor-toolbar">
        <div className="timeline-sound-editor-heading">
          <strong>声音编辑</strong>
          <span className="timeline-sound-editor-target" title={`${trackName} → ${clip.name}`}>
            <b>{trackName}</b>
            <span aria-hidden="true"> → </span>
            {clip.name}
          </span>
        </div>
        <SegmentedControl
          size="xs"
          aria-label="声音编辑模式"
          value={mode}
          data={[
            { value: 'fades', label: '淡入淡出' },
            { value: 'gain', label: '音量曲线' }
          ]}
          onChange={(value) => onModeChange(value as SoundEditorMode)}
        />
        {onAudition && (
          <div className="timeline-sound-editor-audition">
            <Button size="compact-xs" variant="subtle" onClick={() => onAudition('start')}>
              试听片头
            </Button>
            <Button size="compact-xs" variant="subtle" onClick={() => onAudition('end')}>
              试听片尾
            </Button>
          </div>
        )}
        <Tooltip label="收起声音编辑">
          <ActionIcon variant="subtle" size="sm" aria-label="收起声音编辑" onClick={onClose}>
            <IconX size={14} />
          </ActionIcon>
        </Tooltip>
      </header>
      <div
        className="timeline-sound-editor-body"
        style={{ gridTemplateColumns: `${headerWidth}px minmax(0, 1fr)` }}
      >
        <div className="timeline-sound-editor-label">
          <span>{mode === 'gain' ? '曲线音量' : '淡化强度'}</span>
          {guides.map((gain) => (
            <small
              className="timeline-sound-editor-scale"
              key={gain}
              style={{ top: guideTop(gain) }}
              title={gain === 1 ? '保持片段原有音量' : undefined}
            >
              {gain * 100}%
            </small>
          ))}
        </div>
        <div className="timeline-sound-editor-lane">
          {guides.map((gain) => (
            <i
              key={gain}
              className={`timeline-sound-editor-guide ${gain === 1 ? 'is-unity' : ''}`}
              style={{ top: guideTop(gain) }}
            />
          ))}
          <div
            className="timeline-sound-editor-envelope"
            style={{ left: clip.start * zoom - viewportLeft, width: clip.duration * zoom }}
          >
            <AudioClipEnvelope
              clip={clip}
              zoom={zoom}
              left={viewportLeft}
              width={viewportWidth}
              editGain={mode === 'gain'}
              readonly={readonly}
              onBegin={onBegin}
              onChange={onChange}
              onEnd={onEnd}
              selectedTime={selectedPoint?.point.time ?? null}
              onSelectGainPoint={(time, index) => selectPoint(time, clip, index)}
            />
          </div>
          <div
            className="timeline-sound-editor-playhead"
            style={{ left: playhead * zoom - viewportLeft }}
          />
        </div>
      </div>
      <div className="timeline-sound-editor-values">
        {mode === 'gain' ? (
          <>
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<IconPlus size={12} />}
              disabled={readonly || (clip.gainPoints?.length ?? 0) >= 128}
              onClick={() => {
                const next = addSoundEditorGainPoint(clip, playhead - clip.start)
                if (next) commitPoint(next.clip, next.time)
              }}
            >
              添加点
            </Button>
            {selectedPoint ? (
              <div
                className="timeline-sound-editor-point-values"
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && numericGesture.current) {
                    event.preventDefault()
                    event.stopPropagation()
                    endNumeric(true)
                    ;(event.target as HTMLElement).blur()
                  } else if (event.key === 'Enter') (event.target as HTMLElement).blur()
                }}
              >
                <span>时间</span>
                <NumberInput
                  size="xs"
                  aria-label="音量点片段内时间（秒）"
                  suffix=" 秒"
                  min={0}
                  max={clip.duration}
                  step={0.1}
                  decimalScale={3}
                  value={selectedPoint.local}
                  disabled={readonly}
                  onBlur={() => endNumeric()}
                  onChange={(value) => {
                    if (typeof value === 'number') editPoint({ local: value })
                  }}
                />
                <span>音量</span>
                <NumberInput
                  size="xs"
                  aria-label="音量点音量（百分比）"
                  suffix="%"
                  min={0}
                  max={400}
                  step={5}
                  decimalScale={1}
                  value={Math.round(selectedPoint.point.gain * 1000) / 10}
                  disabled={readonly}
                  onBlur={() => endNumeric()}
                  onChange={(value) => {
                    if (typeof value === 'number') editPoint({ gain: value / 100 })
                  }}
                />
                <Tooltip label="删除音量点">
                  <ActionIcon
                    variant="subtle"
                    size="sm"
                    aria-label="删除音量点"
                    disabled={readonly}
                    onClick={() => {
                      const gainPoints = (clip.gainPoints ?? []).filter(
                        (_, index) => index !== selectedPoint.index
                      )
                      const next = gainPoints.find(
                        (point) =>
                          point.time >= clip.envelopeOffset &&
                          point.time <= clip.envelopeOffset + clip.duration
                      )
                      commitPoint({ ...clip, gainPoints }, next?.time ?? null)
                    }}
                  >
                    <IconTrash size={13} />
                  </ActionIcon>
                </Tooltip>
              </div>
            ) : (
              <span className="timeline-sound-editor-empty">
                {clip.gainPoints?.length ? '未选中音量点' : '无音量点'}
              </span>
            )}
            {!!clip.gainPoints?.length && (
              <Button
                variant="subtle"
                size="compact-xs"
                disabled={readonly}
                onClick={() => commitPoint({ ...clip, gainPoints: [] }, null)}
              >
                清除曲线
              </Button>
            )}
          </>
        ) : null}
        {readonly && <span className="timeline-sound-editor-readonly">只读或已锁定</span>}
      </div>
    </section>
  )
}

/** Passive fade extents on a selected clip; editing happens in the separate dock. */
export function SoundClipFadePreview({ clip }: { clip: AudioClip }) {
  const fades = visibleClipFades(clip)
  return (
    <span className="timeline-sound-fade-preview" aria-hidden="true">
      {!!fades.fadeIn && (
        <i className="is-fade-in" style={{ width: `${(fades.fadeIn / clip.duration) * 100}%` }} />
      )}
      {!!fades.fadeOut && (
        <i className="is-fade-out" style={{ width: `${(fades.fadeOut / clip.duration) * 100}%` }} />
      )}
    </span>
  )
}
