import { canvasContext } from '@/shared/lib/canvasContext'
import { getErrorMessage } from '@/shared/lib/errorMessage'
import { ref } from 'vue'
import { message, Modal } from 'ant-design-vue'

import {
  saveComposedImage,
  type FileNodeInfo,
  type ImageEditRecord
} from '@/features/media-library/public'

import { chooseLocalDirectory } from '@/features/media-library/public'

import { studioExportDocument, type StudioDocument } from '../model/imageStudioModel'
import { renderStudioDocument } from '../model/imageStudioRender'

import type { Ref } from 'vue'
import type { ImageEditorProps } from '../model/imageEditorContract'
import { blobToBase64 } from '@/shared/lib/blobEncoding'
interface StudioOutputOptions {
  props: Readonly<ImageEditorProps>
  draft: Ref<StudioDocument>
  flush: () => void
  snapshot: () => string
  isAdjusting: () => boolean
  artifactSaved: () => void
  mediaSaved: (file: FileNodeInfo, overwrite: boolean, record: ImageEditRecord) => void
}
export function useStudioOutput({
  props,
  draft,
  flush,
  snapshot,
  isAdjusting,
  artifactSaved,
  mediaSaved
}: StudioOutputOptions) {
  const format = ref<'png' | 'jpeg'>('png')
  const exportArea = ref<'content' | 'canvas'>(props.initialExportArea || 'content')
  const exporting = ref(false)
  const saveArtifactOpen = ref(false)
  const savingArtifact = ref(false)
  const artifactName = ref('')
  const syncToLibrary = ref(false)
  const syncDirectory = ref('')
  async function exportBlob(
    exportDoc = studioExportDocument(draft.value, exportArea.value === 'content')
  ): Promise<Blob> {
    flush()
    if (exportDoc.width * exportDoc.height > 100_000_000)
      throw new Error('输出图片超过一亿像素，请缩小画布')
    const target = document.createElement('canvas')
    const failures = await renderStudioDocument(target, exportDoc, props.assetInfo, false)
    if (failures.length) throw new Error('无法读取图层：' + failures.join('、'))
    if (!props.mediaFile && format.value === 'jpeg') {
      const ctx = canvasContext(target)
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, target.width, target.height)
    }
    const blob = await new Promise<Blob | null>((resolve) =>
      target.toBlob(
        resolve,
        !props.mediaFile && format.value === 'jpeg' ? 'image/jpeg' : 'image/png',
        0.93
      )
    )
    if (!blob) throw new Error('导出失败，请缩小画布尺寸')
    return blob
  }
  async function exportImage() {
    if (exporting.value) return
    exporting.value = true
    try {
      const blob = await exportBlob()
      const url = URL.createObjectURL(blob),
        link = document.createElement('a')
      link.href = url
      link.download =
        draft.value.name.replace(/[\\/:*?"<>|]/g, '_') + (format.value === 'jpeg' ? '.jpg' : '.png')
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      message.success('图片已下载')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败')
    } finally {
      exporting.value = false
    }
  }
  async function saveMedia(overwrite = false) {
    const mediaFile = props.mediaFile
    if (!mediaFile || savingArtifact.value || props.readonly) return
    if (isAdjusting()) {
      message.info('请先完成当前调整')
      return
    }
    const run = async () => {
      savingArtifact.value = true
      try {
        const exportDoc = studioExportDocument(draft.value, exportArea.value === 'content')
        const blob = await exportBlob(exportDoc)
        const imageBase64 = await blobToBase64(blob)
        const { file, record: savedRecord } = await saveComposedImage(
          mediaFile.fullpath,
          exportDoc.width,
          exportDoc.height,
          imageBase64,
          overwrite,
          JSON.parse(snapshot()),
          exportArea.value,
          props.editRevision
        )
        mediaSaved(file, overwrite, savedRecord)
        message.success(overwrite ? '已覆盖原图' : '已保存副本')
      } catch (error) {
        message.error(getErrorMessage(error, '保存失败'))
      } finally {
        savingArtifact.value = false
      }
    }
    if (overwrite)
      Modal.confirm({
        title: '覆盖原图？',
        content:
          '将替换原文件，保留标签和描述，同时保存编辑记录与素材快照。' +
          (/\.jpe?g$/i.test(props.mediaFile.name) ? ' JPG 的透明区域将填充为白色。' : ''),
        okText: '覆盖原图',
        okType: 'danger',
        onOk: run
      })
    else await run()
  }
  function openSaveArtifact() {
    artifactName.value = draft.value.name + (format.value === 'jpeg' ? '.jpg' : '.png')
    syncToLibrary.value = false
    syncDirectory.value = ''
    saveArtifactOpen.value = true
  }
  async function browseSyncDirectory() {
    try {
      const selected = await chooseLocalDirectory()
      if (selected) syncDirectory.value = selected
    } catch {
      message.error('无法选择文件夹，请手动输入目录')
    }
  }
  async function saveArtifact() {
    if (savingArtifact.value) return
    if (!artifactName.value.trim()) {
      message.warning('请输入素材名称')
      return
    }
    if (syncToLibrary.value && !syncDirectory.value.trim()) {
      message.warning('请选择媒体库目录')
      return
    }
    savingArtifact.value = true
    try {
      const blob = await exportBlob()
      const imageBase64 = await blobToBase64(blob)
      if (!props.persistArtifact) throw new Error('当前编辑入口不支持保存工作区素材')
      const result = await props.persistArtifact({
        workspaceId: props.workspaceId,
        name: artifactName.value.trim(),
        format: format.value,
        imageBase64,
        syncDirectory: syncToLibrary.value ? syncDirectory.value.trim() : undefined
      })
      artifactSaved()
      saveArtifactOpen.value = false
      message.success(result.synced ? '已保存到工作区素材，并同步到媒体库' : '已保存到工作区素材')
    } catch (error) {
      message.error(getErrorMessage(error, '保存素材失败'))
    } finally {
      savingArtifact.value = false
    }
  }

  return {
    format,
    exportArea,
    exporting,
    saveArtifactOpen,
    savingArtifact,
    artifactName,
    syncToLibrary,
    syncDirectory,
    exportImage,
    saveMedia,
    openSaveArtifact,
    browseSyncDirectory,
    saveArtifact
  }
}
