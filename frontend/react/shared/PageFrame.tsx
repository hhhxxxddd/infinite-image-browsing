import { useEffect, useRef, type ReactNode } from 'react'

/** Keep page chrome outside the scrollable, rounded content surface. */
export function PageFrame({
  header,
  children,
  className = '',
  scrollKey
}: {
  header: ReactNode
  children: ReactNode
  className?: string
  scrollKey?: string
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [scrollKey])
  return (
    <div className={`omni-page-frame ${className}`}>
      <div className="omni-page-header">
        <div className="omni-page-header-inner">{header}</div>
      </div>
      <div className="omni-page-body" ref={bodyRef} tabIndex={-1}>
        {children}
      </div>
    </div>
  )
}
