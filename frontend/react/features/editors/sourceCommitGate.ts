/** The parent's commit may already mutate the timeline and cannot be cancelled by closing its UI. */
export function createSourceCommitGate() {
  let committing = false
  return {
    get committing() {
      return committing
    },
    requestClose(close: () => void) {
      if (committing) return false
      close()
      return true
    },
    async run<T>(commit: () => T | Promise<T>, onChange: (value: boolean) => void): Promise<T> {
      if (committing) throw new Error('素材正在提交，请稍候')
      // Update synchronously: a close event can arrive before React renders disabled controls.
      committing = true
      onChange(true)
      try {
        return await commit()
      } finally {
        committing = false
        onChange(false)
      }
    }
  }
}
