/** A property drag owns one preview transaction until it commits or is cancelled. */
export class EditorPointerGesture {
  private pending?: {
    scope: string
    restore: () => void
    complete: (cancelled: boolean) => void
    release: () => void
  }

  begin(
    scope: string,
    restore: () => void,
    complete: (cancelled: boolean) => void,
    release: () => void
  ) {
    this.finish(true)
    this.pending = { scope, restore, complete, release }
  }

  finish(cancelled = false) {
    const pending = this.pending
    if (!pending) return
    // Clear before callbacks: releasing capture can synchronously deliver lostPointerCapture.
    this.pending = undefined
    try {
      if (cancelled) pending.restore()
    } finally {
      try {
        pending.complete(cancelled)
      } finally {
        pending.release()
      }
    }
  }

  cancelIf(scope: string, disabled: boolean) {
    if (this.pending && (disabled || scope !== this.pending.scope)) this.finish(true)
  }
}
