import type { ButtonHTMLAttributes } from 'react'
import { Tooltip } from '@mantine/core'
import './TimelineControls.css'

export default function TimelineTrackAction({
  tooltip,
  title,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tooltip?: string }) {
  return (
    <Tooltip
      label={tooltip ?? title ?? props['aria-label']}
      openDelay={250}
      events={{ hover: true, focus: true, touch: false }}
      withinPortal
    >
      <span className="timeline-track-action">
        <button {...props} type="button">
          {children}
        </button>
      </span>
    </Tooltip>
  )
}
