import { aspectRatioPresets } from '../../../src/shared/lib/aspectRatioPresets'

export default function ImageAspectRatios({
  value,
  onChange,
  disabled = false
}: {
  value: string
  onChange: (value: string, ratio: number) => void
  disabled?: boolean
}) {
  return (
    <div className="react-image-ratio-grid" role="group" aria-label="预设比例">
      {aspectRatioPresets.map(({ label, width, height }) => {
        const key = `${width}:${height}`
        const scale = 27 / Math.max(width, height)
        const w = width * scale,
          h = height * scale
        return (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-pressed={value === key}
            disabled={disabled}
            onClick={() => onChange(key, width / height)}
          >
            <svg viewBox="0 0 40 36" width="40" height="36" aria-hidden="true">
              <rect
                x={(40 - w) / 2}
                y={(36 - h) / 2}
                width={w}
                height={h}
                rx="1"
                fill="currentColor"
                fillOpacity="0.08"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d={`M ${20 - w / 2 + 3} ${18 + h / 2 - 3} L ${20 + w / 2 - 3} ${18 - h / 2 + 3}`}
                stroke="currentColor"
                strokeWidth="0.8"
                strokeDasharray="2 2"
                opacity="0.5"
              />
            </svg>
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
