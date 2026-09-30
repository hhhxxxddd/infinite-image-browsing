declare module 'diff-match-patch' {
  export type Diff = [-1 | 0 | 1, string]

  export class diff_match_patch {
    Diff_Timeout: number
    diff_main(left: string, right: string, checkLines?: boolean): Diff[]
    diff_cleanupSemantic(diffs: Diff[]): void
  }
}
