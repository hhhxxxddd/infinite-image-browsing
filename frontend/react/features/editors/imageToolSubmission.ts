/** Keep the same paid request identity until its response has been confirmed. */
export async function submitImageToolRequest<T>(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  fingerprint: string,
  send: (id: string) => Promise<T>
): Promise<T> {
  const key = `omnigallery:pending-image-tool-v1:${fingerprint}`
  const saved = storage.getItem(key)
  const id = saved && /^[a-f0-9-]{36}$/i.test(saved) ? saved : crypto.randomUUID()
  // Persist before sending. If storage fails, do not start an untraceable paid request.
  storage.setItem(key, id)
  const result = await send(id)
  if (storage.getItem(key) === id) storage.removeItem(key)
  return result
}
