import { diff_match_patch, type Diff } from 'diff-match-patch'

export interface TextSegment {
  text: string
  changed: boolean
}

export interface TextDiff {
  left: TextSegment[]
  right: TextSegment[]
}

/** Google diff engine for word-level media comparison. */
export function comparisonTextDiff(left: string, right: string): TextDiff {
  const engine = new diff_match_patch()
  engine.Diff_Timeout = 0.5
  const diffs: Diff[] = engine.diff_main(left, right, true)
  engine.diff_cleanupSemantic(diffs)
  return {
    left: diffs
      .filter(([operation]) => operation !== 1)
      .map(([operation, text]) => ({ text, changed: operation === -1 })),
    right: diffs
      .filter(([operation]) => operation !== -1)
      .map(([operation, text]) => ({ text, changed: operation === 1 }))
  }
}
