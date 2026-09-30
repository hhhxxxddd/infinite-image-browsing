import { useMemo } from 'react'
import { ComparisonView } from '../media/ComparisonView'
import type { MediaFile } from '../media/mediaApi'

export interface ComparisonFile {
  fullpath: string
  name: string
}

/** Saved comparison tabs use the same complete viewer as media selections. */
export function ComparisonPage({ left, right }: { left: ComparisonFile; right: ComparisonFile }) {
  const files = useMemo<MediaFile[]>(
    () =>
      [left, right].map((file) => ({
        ...file,
        type: 'file',
        date: '',
        created_time: '',
        size: '',
        bytes: 0
      })),
    [left.fullpath, left.name, right.fullpath, right.name]
  )
  return <ComparisonView files={files} mode="compare" onClose={() => undefined} embedded />
}

export default ComparisonPage
