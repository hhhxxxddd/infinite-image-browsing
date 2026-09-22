import { watch, ref } from 'vue'
import {
  useWatchDocument
} from 'vue3-ts-util'
import { FileTransferData, getFileTransferDataFromDragEvent, toRawFileUrl } from '@/util/file'
import type { FileNodeInfo } from '@/api/files'
import { useHookShareState, global, events, sli } from '.'
import { copyFiles, moveFiles } from '@/api/files'
import { t } from '@/i18n'
import { createReactiveQueue } from '@/util'
import { Modal, Button, Checkbox } from 'ant-design-vue'
import * as Path from '@/util/path'

import { cloneDeep, uniqBy } from 'lodash-es'

export function useFileTransfer () {
  const { currLocation, sortedFiles, multiSelectedIdxs, eventEmitter, walker } =
    useHookShareState().toRefs()
  const recover = () => {
    multiSelectedIdxs.value = []
  }
  useWatchDocument('keydown', (event) => {
    if (event.key === 'Escape') recover()
  })
  watch(() => sortedFiles.value.map(file => file.fullpath), (paths, previous) => {
    const selected = new Set(multiSelectedIdxs.value.map(idx => previous[idx]))
    multiSelectedIdxs.value = paths.flatMap((path, idx) => selected.has(path) ? [idx] : [])
  }, { flush: 'sync' })

  const onFileDragStart = (e: DragEvent, idx: number) => {
    const file = cloneDeep(sortedFiles.value[idx])
    if (!file || !e.dataTransfer) { e.preventDefault(); return }
    sli.fileDragging = true
    const files = [file]
    let includeDir = file.type === 'dir'
    if (multiSelectedIdxs.value.includes(idx)) {
      const selectedFiles = multiSelectedIdxs.value.map((idx) => sortedFiles.value[idx])
      files.push(...selectedFiles)
      includeDir = selectedFiles.some((v) => v.type === 'dir')
    }
    const data: FileTransferData = {
      includeDir,
      loc: currLocation.value || 'search-result',
      path: uniqBy(files, 'fullpath').map((f) => f.fullpath),
      nodes: uniqBy(files, 'fullpath'),
      __id: 'FileTransferData'
    }
    if (!e.dataTransfer) return
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('application/x-iib-files', JSON.stringify(data))
    e.dataTransfer.setData('text/plain', JSON.stringify(data))
    e.dataTransfer.setData('text/uri-list', data.nodes.map(node => new URL(toRawFileUrl(node), window.location.href).href).join('\r\n'))
  }

  const onFileDragEnd = () => {
    sli.fileDragging = false
  }

  const onDrop = async (e: DragEvent) => {
    if (walker.value) {
      return
    }
    const data = getFileTransferDataFromDragEvent(e)
    if (!data) {
      return
    }
    const toPath = currLocation.value
    if (data.loc === toPath) {
      return
    }
    confirmFileTransfer(data, toPath, () => eventEmitter.value.emit('refresh'))
  }

  const onFileDropToFolder = async (e: DragEvent, target: FileNodeInfo) => {
    if (walker.value || target.type !== 'dir') {
      return false
    }
    const data = getFileTransferDataFromDragEvent(e)
    if (!data) {
      return false
    }
    const fromPath = Path.normalize(data.loc)
    const currPath = Path.normalize(currLocation.value || '')
    if (fromPath !== currPath) {
      return false
    }
    const toPath = Path.normalize(target.fullpath)
    const filtered = data.path
      .map(Path.normalize)
      .filter((p) => p !== toPath && !toPath.startsWith(p + '/'))
    if (!filtered.length) {
      return false
    }
    e.preventDefault()
    confirmFileTransfer({ ...data, path: filtered }, toPath, () => eventEmitter.value.emit('refresh'))
    return true
  }

  return {
    onFileDragStart,
    onDrop,
    multiSelectedIdxs,
    onFileDragEnd,
    onFileDropToFolder
  }
}

export const confirmFileTransfer = (data: FileTransferData, toPath: string, refresh = () => {}) => {
    if (global.conf?.is_readonly || !data.path.length) return
    toPath = Path.normalize(toPath)
    const paths = data.path.filter(path => {
      const source = Path.normalize(path)
      return source !== toPath && !toPath.startsWith(source + '/') && Path.getParentDirectory(source) !== toPath
    })
    if (!paths.length) return
    data = { ...data, path: paths, nodes: data.nodes.filter(node => paths.includes(node.fullpath)) }
    const q = createReactiveQueue()
    const continueOnError = ref(false)
    const onCopyBtnClick = async () => q.pushAction(async () => {
      await copyFiles(data.path, toPath, false, continueOnError.value)
      refresh()
      Modal.destroyAll()
    })

    const onMoveBtnClick = () => q.pushAction(async () => {
      await moveFiles(data.path, toPath, false, continueOnError.value)
      events.emit('removeFiles', { paths: data.path, loc: data.loc })
      refresh()
      Modal.destroyAll()
    })
    Modal.confirm({
      title: t('confirm') + '?',
      width: '60vw',
      content: () => <div>
        <div>
          {`${t('moveSelectedFilesTo')} ${toPath}`}
          <ol style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {data.path.map((v) => <li>{v.split(/[/\\]/).pop()}</li>)}
          </ol>
        </div>
        <div style={{ marginTop: '8px' }}>
          <Checkbox v-model:checked={continueOnError.value}>{t('continueOnError')}</Checkbox>
          <div style={{ color: '#888', fontSize: '12px', marginTop: '4px' }}>{t('continueOnErrorDesc')}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }} class="actions">
          <Button onClick={Modal.destroyAll}>{t('cancel')}</Button>
          <Button type="primary" loading={!q.isIdle} onClick={onCopyBtnClick}>{t('copy')}</Button>
          <Button type="primary" loading={!q.isIdle} onClick={onMoveBtnClick}>{t('move')}</Button>
        </div>
      </div>,
      maskClosable: true,
      wrapClassName: 'hidden-antd-btns-modal'
    })
  }
