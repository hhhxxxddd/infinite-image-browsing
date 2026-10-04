import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Group, Modal, SegmentedControl, Stack, Switch, Text } from '@mantine/core'
import { apiFetch } from '../../shared/apiClient'
import type { FileNodeInfo } from '../../../src/shared/types/fileNode'
import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel'
import {
  applyStudioMerge,
  prepareStudioMerge,
  type StudioMergeBackground
} from '../../../src/features/image-editor/model/imageStudioMerge'
import { exportStudioBlob } from '../../../src/features/image-editor/model/studioExport'
import { blobToBase64 } from '../../../src/shared/lib/blobEncoding'

export default function ImageMergeModal({
  document,
  layerIds,
  groupIds,
  assetInfo,
  onClose,
  onApply
}: {
  document: StudioDocument
  layerIds: string[]
  groupIds: string[]
  assetInfo: Record<string, FileNodeInfo>
  onClose: () => void
  onApply: (source: StudioDocument, result: ReturnType<typeof applyStudioMerge>) => void
}) {
  const [background, setBackground] = useState<StudioMergeBackground>('transparent')
  const [keepOriginals, setKeepOriginals] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  async function merge() {
    if (running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      const plan = prepareStudioMerge(document, layerIds, groupIds, background)
      const blob = await exportStudioBlob(plan.document, assetInfo, 'png', {
        kind: 'selection',
        ids: plan.ids
      })
      if (!alive.current) return
      const saved = await apiFetch<{ path: string }>('/image-editor-assets', {
        method: 'POST',
        body: JSON.stringify({ png_base64: await blobToBase64(blob) })
      })
      if (!alive.current) return
      onApply(
        document,
        applyStudioMerge(document, layerIds, groupIds, saved.path, plan.bounds, keepOriginals)
      )
      onClose()
    } catch (reason) {
      if (alive.current) setError(reason instanceof Error ? reason.message : '合成失败')
    } finally {
      running.current = false
      if (alive.current) setBusy(false)
    }
  }
  return (
    <Modal
      opened
      onClose={() => {
        if (!busy) onClose()
      }}
      title="合成为图片"
      size="xs"
      centered
      closeOnEscape={!busy}
      closeOnClickOutside={!busy}
      withCloseButton={!busy}
    >
      <Stack gap="md">
        {error && <Alert color="red">{error}</Alert>}
        <Stack gap={6}>
          <Text size="sm">底色</Text>
          <SegmentedControl
            fullWidth
            disabled={busy}
            value={background}
            onChange={(value) => setBackground(value as StudioMergeBackground)}
            data={[
              { value: 'transparent', label: '透明底' },
              { value: 'white', label: '纯白底' }
            ]}
          />
        </Stack>
        <Switch
          label="保留原图层"
          checked={keepOriginals}
          disabled={busy}
          onChange={(event) => setKeepOriginals(event.currentTarget.checked)}
        />
        <Group justify="flex-end">
          <Button variant="default" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button loading={busy} onClick={() => void merge()}>
            合成
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
