import { FileNodeInfo } from '@/features/media-library/public'
import { uniqueFile } from '@/features/media-library/public'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useBatchDownloadStore = defineStore('useBatchDownloadStore', () => {
  const selectedFiles = ref<FileNodeInfo[]>([])
  const addFiles = (files: FileNodeInfo[]) => {
    selectedFiles.value = uniqueFile([...selectedFiles.value, ...files])
  }
  return {
    selectedFiles,
    addFiles
  }
})
