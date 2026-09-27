/** Read a user-facing error from an HTTP rejection or a local operation. */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    if ('response' in error && typeof error.response === 'object' && error.response !== null) {
      const response = error.response
      if ('data' in response && typeof response.data === 'object' && response.data !== null) {
        const data = response.data
        if ('detail' in data && typeof data.detail === 'string' && data.detail.trim()) {
          return data.detail
        }
      }
    }
    if ('message' in error && typeof error.message === 'string' && error.message.trim()) {
      return error.message
    }
  }
  return typeof error === 'string' && error.trim() ? error : fallback
}
