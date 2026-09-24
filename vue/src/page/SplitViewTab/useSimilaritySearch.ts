import { computed, onBeforeUnmount, ref } from 'vue'
import { searchSimilarImages, type SimilarityResult } from '@/api/similarity'
import { toImageThumbnailUrl } from '@/util/file'
import type { FileNodeInfo } from '@/api/files'
import type { SearchFilters } from '@/api/db'

// Reference bytes and results belong to this view, never to saved workspace settings.
export function useSimilaritySearch(getFilters: () => Partial<SearchFilters> = () => ({})) {
  const reference = ref<{name: string; preview: string; path?: string; data?: string}>()
  const method = ref<'qwen' | 'hash'>('qwen')
  const minimum = ref(0)
  const loading = ref(false)
  const error = ref('')
  const rawResult = ref<SimilarityResult>()
  const result = computed(() => rawResult.value && ({
    ...rawResult.value,
    files: rawResult.value.files.filter(file => file.similarity >= minimum.value)
  }))
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
    rawResult.value = undefined
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
    rawResult.value = undefined
    try {
      // Fetch the best candidates once. Changing the score threshold then only
      // filters these already-ranked results instead of rescanning the disk.
      const response = await searchSimilarImages({...getFilters(), minimum: 0, method: method.value,
        ...(source.path ? {path: source.path} : {image_base64: source.data})}, controller.signal)
      if (request === version) rawResult.value = response
    } catch {
      if (request === version) error.value = '搜图失败，请确认参考图片可以读取，并检查本地服务。'
    } finally {
      if (request === version) loading.value = false
    }
  }
  function chooseFile(file: File, name = file.name) {
    clear()
    if (file.size > 50 * 1024 * 1024) { error.value = '参考图片请勿超过 50 MB'; return }
    reference.value = {name, preview: ''}
    loading.value = true
    const selection = version
    reader = new FileReader()
    reader.onload = () => {
      if (selection !== version) return
      const preview = String(reader?.result)
      reference.value = {name, preview, data: preview.split(',')[1]}
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
  function chooseMethod(value: 'qwen' | 'hash') {
    if (value === method.value) return
    method.value = value
    minimum.value = value === 'hash' ? 70 : 0
    void search()
  }
  onBeforeUnmount(cancel)
  return {reference, method, chooseMethod, minimum, loading, error, result, clear, search, chooseFile, choosePath}
}
