import { Portal } from '@mantine/core'
import { useLayoutEffect, useState, type RefObject } from 'react'

type GlowBounds = { left: number; top: number; width: number; height: number; focused: boolean }

/** Paint outside the scroll viewport so the glow can cross the sidebar seam. */
export function AISearchGlow({ target }: { target: RefObject<HTMLFormElement | null> }) {
  const [bounds, setBounds] = useState<GlowBounds | null>(null)

  useLayoutEffect(() => {
    const form = target.current
    if (!form) return
    let frame = 0
    const measure = () => {
      const rect = form.getBoundingClientRect()
      const next = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        focused: form.contains(document.activeElement)
      }
      setBounds((previous) =>
        previous &&
        Object.keys(next).every(
          (key) => previous[key as keyof GlowBounds] === next[key as keyof GlowBounds]
        )
          ? previous
          : next
      )
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(form)
    window.addEventListener('resize', schedule)
    document.addEventListener('scroll', schedule, true)
    form.addEventListener('focusin', schedule)
    form.addEventListener('focusout', schedule)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('scroll', schedule, true)
      form.removeEventListener('focusin', schedule)
      form.removeEventListener('focusout', schedule)
    }
  }, [target])

  if (!bounds || !bounds.width || !bounds.height) return null
  const { focused, ...style } = bounds
  return (
    <Portal>
      <div
        className={`ml-ai-search-glow${focused ? ' is-focused' : ''}`}
        style={style}
        aria-hidden="true"
      />
    </Portal>
  )
}
