import type { ButtonHTMLAttributes } from 'react'
import { IconFlag } from '@tabler/icons-react'
import { formatTimelineTime } from './timelineTime'
import './TimelineControls.css'

export default function TimelineMarker({
  name,
  time,
  note,
  selected,
  className = '',
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  name: string
  time: number
  note?: string
  selected: boolean
}) {
  const label = `${name} · ${formatTimelineTime(time)}`
  return (
    <button
      {...props}
      type="button"
      className={`timeline-marker ${className}`}
      title={note ? `${label}\n${note}` : label}
      aria-label={label}
      aria-pressed={selected}
    >
      <IconFlag size={12} aria-hidden="true" />
    </button>
  )
}
