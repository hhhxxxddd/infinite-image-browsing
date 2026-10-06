import type { ButtonHTMLAttributes } from 'react'
import './TimelineControls.css'

export default function TimelineTrimHandles({
  name,
  viewport,
  ...events
}: {
  name: string
  viewport: { start: number; end: number; left: number; width: number }
} & Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'
>) {
  return (['left', 'right'] as const).map((edge) => {
    const position = edge === 'left' ? viewport.start : viewport.end
    const visible = position >= viewport.left && position <= viewport.left + viewport.width
    const distance =
      edge === 'left' ? position - viewport.left : viewport.left + viewport.width - position
    const inset = visible && distance < 6 ? -distance : -6
    return (
      <button
        key={edge}
        type="button"
        className={`timeline-trim-handle edge-${edge}`}
        data-edge={edge}
        aria-label={`${edge === 'left' ? '裁剪片段起点' : '裁剪片段终点'}：${name}`}
        style={{ [edge]: inset, visibility: visible ? undefined : 'hidden' }}
        {...events}
      />
    )
  })
}
