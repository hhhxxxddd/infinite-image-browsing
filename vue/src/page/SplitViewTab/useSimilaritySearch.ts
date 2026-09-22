import { onBeforeUnmount, ref } from 'vue'
import { searchSimilarImages, type SimilarityResult } from '@/api/similarity'
import { toImageThumbnailUrl } from '@/util/file'
import type { FileNodeInfo } from '@/api/files'
import type { SearchFilters } from '@/api/db'

// Reference bytes and results belong to this view, never to saved workspace settings.
export function useSimilaritySearch(getFilters: () => Partial<SearchFilters> = () => ({})) {
  const reference = ref<{name: string; preview: string; path?: string; data?: string}>()
  const minimum = ref(70)
  const loading = ref(false)
  const error = ref('')
  const result = ref<SimilarityResult>()
  let version = 0
  let controller: AbortController | undefined
  let reader: FileReader | undefined

  function cancel() {
    version++
    controller?.abort()
    reader?.abort()
    loading.value = false
  }
  function clear() {
    cancel()
    reference.value = undefined
    result.value = undefined
    error.value = ''
  }
  async function search() {
    const source = reference.value
    if (!source?.path && !source?.data) return
    cancel()
    const request = version
    controller = new AbortController()
    loading.value = true
    error.value = ''
    result.value = undefined
    try {
      const response = await searchSimilarImages({...getFilters(), minimum: minimum.value,
        ...(source.path ? {path: source.path} : {image_base64: source.data})}, controller.signal)
      if (request === version) result.value = response
    } catch {
      if (request === version) error.value = '搜图失败，请确认参考图片可以读取，并检查本地服务。'
    } finally {
      if (request === version) loading.value = false
    }
  }
  function chooseFile(file: File) {
    clear()
    if (file.size > 20 * 1024 * 1024) { error.value = '参考图片请勿超过 20 MB'; return }
    reference.value = {name: file.name, preview: ''}
    loading.value = true
    const selection = version
    reader = new FileReader()
    reader.onload = () => {
      if (selection !== version) return
      const preview = String(reader?.result)
      reference.value = {name: file.name, preview, data: preview.split(',')[1]}
      void search()
    }
    reader.onerror = () => {
      if (selection !== version) return
      loading.value = false
      error.value = '无法读取所选图片，请重新选择'
    }
    reader.readAsDataURL(file)
  }
  function choosePath(path: string) {
    clear()
    reference.value = {path, name: path.split(/[\\/]/).pop() || path,
      preview: toImageThumbnailUrl({fullpath: path} as FileNodeInfo)}
    void search()
  }
  onBeforeUnmount(cancel)
  return {reference, minimum, loading, error, result, clear, search, chooseFile, choosePath}
}
