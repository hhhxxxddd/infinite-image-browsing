import { useEffect, useRef, useState } from 'react'
import { NumberInput, type NumberInputProps } from '@mantine/core'
import { commitVideoTimingInput } from './videoTimelineInteraction'

export default function VideoTimingInput({
  value,
  onCommit,
  ...props
}: Omit<NumberInputProps, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'> & {
  value: number
  onCommit: (value: number) => number
}) {
  const [draft, setDraft] = useState<string | number>(value)
  const cancelled = useRef(false)
  useEffect(() => setDraft(value), [value, props.disabled])
  const commit = () => {
    setDraft(
      props.disabled ? value : commitVideoTimingInput(draft, value, onCommit, cancelled.current)
    )
    cancelled.current = false
  }
  return (
    <NumberInput
      {...props}
      value={draft}
      onChange={setDraft}
      clampBehavior="none"
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          cancelled.current = true
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}
