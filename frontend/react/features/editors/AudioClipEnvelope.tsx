import './AudioClipEnvelope.css'
import { useRef, type PointerEvent } from 'react'
import {
  clipEnvelope,
  setClipFades,
  visibleClipFades,
  type AudioClip
} from '../../../src/features/media-editor/model/audioTimeline'
import { automationGain } from '../../../src/features/media-editor/model/audioProcessing'
import {
  insertGainPoint,
  moveGainPoint
} from '../../../src/features/media-editor/model/audioEnvelopeEditing'

type Drag = { clip: AudioClip; mode: 'point' | 'in' | 'out'; index: number }
/** Gain automation remains anchored to the original envelope through trims and splits. */
export default function AudioClipEnvelope({
  clip,
  zoom,
  left,
  width,
  editGain,
  readonly,
  onBegin,
  onChange,
  onEnd
}: {
  clip: AudioClip
  zoom: number
  left: number
  width: number
  editGain: boolean
  readonly: boolean
  onBegin: () => void
  onChange: (clip: AudioClip) => void
  onEnd: (cancel: boolean) => void
}) {
  const drag = useRef<Drag | null>(null)
  const from = Math.max(0, (left - clip.start * zoom) / zoom)
  const to = Math.min(clip.duration, (left + width - clip.start * zoom) / zoom)
  if (to <= from) return null
  const localWidth = Math.max(1, (to - from) * zoom)
  const gainY = (gain: number) => 44 - Math.max(0, Math.min(4, gain)) * 9
  const coords = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      local: from + (event.clientX - rect.left) / zoom,
      gain: (44 - ((event.clientY - rect.top) / rect.height) * 52) / 9
    }
  }
  const points = Array.from({ length: Math.min(300, Math.ceil(localWidth / 4)) + 1 }, (_, i) => {
    const local = from + ((to - from) * i) / Math.min(300, Math.ceil(localWidth / 4))
    return `${(local - from) * zoom},${gainY(editGain ? automationGain(clip.gainPoints, clip.envelopeOffset + local) : clipEnvelope({ ...clip, gain: 1, gainPoints: [] }, local))}`
  }).join(' ')
  const visibleFades = visibleClipFades(clip)
  const fadeIn = visibleFades.fadeIn
  const fadeOut = clip.duration - visibleFades.fadeOut
  const finish = (cancel: boolean) => {
    if (!drag.current) return
    drag.current = null
    onEnd(cancel)
  }
  return (
    <svg
      className={`audio-clip-envelope ${editGain ? 'is-editing-gain' : ''}`}
      style={{ left: from * zoom, width: localWidth }}
      viewBox={`0 0 ${localWidth} 52`}
      preserveAspectRatio="none"
      aria-label={editGain ? '直接编辑音量曲线' : '淡入淡出曲线'}
      tabIndex={readonly ? -1 : 0}
      onPointerDown={(event) => {
        if (readonly || event.button !== 0) return
        const target = event.target as SVGElement
        const mode = target.dataset.mode as Drag['mode'] | undefined
        if (!mode && !editGain) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.focus()
        onBegin()
        let original = clip,
          index = Number(target.dataset.index ?? -1)
        if (!mode) {
          const position = coords(event)
          original = { ...clip, gainPoints: insertGainPoint(clip, position.local, position.gain) }
          index = (original.gainPoints ?? []).findIndex(
            (p) =>
              Math.abs(
                p.time -
                  (clip.envelopeOffset + Math.max(0, Math.min(clip.duration, position.local)))
              ) <
              1 / 48000
          )
          onChange(original)
        }
        drag.current = { clip: original, mode: mode ?? 'point', index }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current) return
        event.preventDefault()
        event.stopPropagation()
        const { local, gain } = coords(event)
        if (current.mode === 'point')
          onChange({
            ...current.clip,
            gainPoints: moveGainPoint(current.clip, current.index, local, gain)
          })
        else {
          const fades = visibleClipFades(current.clip)
          onChange(
            current.mode === 'in'
              ? setClipFades(current.clip, local, fades.fadeOut)
              : setClipFades(current.clip, fades.fadeIn, current.clip.duration - local)
          )
        }
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        finish(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          event.preventDefault()
          event.stopPropagation()
          finish(true)
        }
      }}
    >
      <polyline className="audio-envelope-line" points={points} />
      {editGain &&
        (clip.gainPoints ?? []).map((point, index) => {
          const local = point.time - clip.envelopeOffset
          return local >= from && local <= to ? (
            <circle
              key={index}
              cx={(local - from) * zoom}
              cy={gainY(point.gain)}
              r={4}
              data-mode="point"
              data-index={index}
              className="audio-envelope-point"
              role="slider"
              tabIndex={readonly ? -1 : 0}
              aria-label={`音量点 ${index + 1}`}
              aria-valuemin={0}
              aria-valuemax={400}
              aria-valuenow={Math.round(point.gain * 100)}
              onKeyDown={(event) => {
                if (readonly) return
                if (
                  [
                    'Delete',
                    'Backspace',
                    'ArrowUp',
                    'ArrowDown',
                    'ArrowLeft',
                    'ArrowRight'
                  ].includes(event.key)
                ) {
                  event.preventDefault()
                  event.stopPropagation()
                  onBegin()
                  onChange({
                    ...clip,
                    gainPoints:
                      event.key === 'Delete' || event.key === 'Backspace'
                        ? (clip.gainPoints ?? []).filter((_, i) => i !== index)
                        : moveGainPoint(
                            clip,
                            index,
                            local +
                              (event.key === 'ArrowLeft'
                                ? -1 / 48000
                                : event.key === 'ArrowRight'
                                  ? 1 / 48000
                                  : 0),
                            point.gain +
                              (event.key === 'ArrowUp'
                                ? 0.05
                                : event.key === 'ArrowDown'
                                  ? -0.05
                                  : 0)
                          )
                  })
                  onEnd(false)
                }
              }}
            />
          ) : null
        })}
      {!readonly && !editGain && (
        <>
          {fadeIn >= from && fadeIn <= to && (
            <rect
              x={Math.max(0, Math.min(localWidth - 12, (fadeIn - from) * zoom - 6))}
              y={1}
              width={12}
              height={12}
              data-mode="in"
              className="audio-fade-handle"
              role="slider"
              tabIndex={0}
              aria-label="淡入手柄"
              aria-valuemin={0}
              aria-valuemax={clip.duration}
              aria-valuenow={visibleFades.fadeIn}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                event.stopPropagation()
                const step = event.altKey ? 1 / 48000 : event.shiftKey ? 0.5 : 0.05
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? clip.duration
                      : visibleFades.fadeIn + (event.key === 'ArrowLeft' ? -step : step)
                onBegin()
                onChange(setClipFades(clip, next, visibleFades.fadeOut))
                onEnd(false)
              }}
            >
              <title>拖动淡入</title>
            </rect>
          )}
          {fadeOut >= from && fadeOut <= to && (
            <rect
              x={Math.max(0, Math.min(localWidth - 12, (fadeOut - from) * zoom - 6))}
              y={1}
              width={12}
              height={12}
              data-mode="out"
              className="audio-fade-handle"
              role="slider"
              tabIndex={0}
              aria-label="淡出手柄"
              aria-valuemin={0}
              aria-valuemax={clip.duration}
              aria-valuenow={visibleFades.fadeOut}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                event.preventDefault()
                event.stopPropagation()
                const step = event.altKey ? 1 / 48000 : event.shiftKey ? 0.5 : 0.05
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? clip.duration
                      : visibleFades.fadeOut + (event.key === 'ArrowLeft' ? step : -step)
                onBegin()
                onChange(setClipFades(clip, visibleFades.fadeIn, next))
                onEnd(false)
              }}
            >
              <title>拖动淡出</title>
            </rect>
          )}
        </>
      )}
    </svg>
  )
}
