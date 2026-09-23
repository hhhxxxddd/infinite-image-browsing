import type { FileNodeInfo } from '@/api/files'
import { axiosInst } from '@/api'

const candidate = /\.(gif|webp|png|avif)$/i
const pending = new Map<string, Promise<boolean>>()

export function mayBeAnimatedImage(name: string): boolean {
  return candidate.test(name)
}

export function isAnimatedImage(file: FileNodeInfo): Promise<boolean> {
  if (!mayBeAnimatedImage(file.name)) return Promise.resolve(false)
  const key = `${file.fullpath}\0${file.date}`
  let request = pending.get(key)
  if (!request) {
    request = axiosInst.value.get<{ animated: boolean }>('/media_motion', { params: { path: file.fullpath } })
      .then(response => response.data.animated)
      .catch(error => { pending.delete(key); throw error })
    pending.set(key, request)
  }
  return request
}
