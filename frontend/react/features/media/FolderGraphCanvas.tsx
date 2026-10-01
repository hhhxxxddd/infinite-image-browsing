import { useLayoutEffect, useRef, type ReactNode } from 'react'
import {
  folderGraphViewport,
  rememberFolderGraphScroll
} from '../../../src/features/media-library/model/folderGraphViewport'

export function FolderGraphCanvas({
  path,
  label,
  children
}: {
  path: string
  label: string
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const host = ref.current
    const content = host?.firstElementChild
    if (host && content instanceof HTMLElement)
      return rememberFolderGraphScroll(host, content, path, folderGraphViewport)
  }, [path])
  return (
    <section ref={ref} className="ml-graph-canvas" aria-label={label}>
      {children}
    </section>
  )
}
