import { useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Group,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text
} from '@mantine/core'
import { IconLink, IconUnlink } from '@tabler/icons-react'
import EditorDisclosure from './EditorDisclosure'
import { clipLocked, type VideoTimelineDocument, type Lane } from './videoStudioModel'
import {
  linkSelectedVideoClips,
  synchronizeVideoPair,
  unlinkVideoClips,
  videoLinkMembers,
  type VideoLinkResult
} from './videoLinks'

export interface VideoLinkControlsProps {
  document: VideoTimelineDocument
  selectedIds: readonly string[]
  readonly?: boolean
  onApply: (document: VideoTimelineDocument, memberIds: string[]) => void
}
export default function VideoLinkControls({
  document,
  selectedIds,
  readonly = false,
  onApply
}: VideoLinkControlsProps) {
  const members = videoLinkMembers(document, selectedIds)
  const visuals = members.filter((item) => item.lane === 'visual').map((item) => item.clip)
  const sounds = members.filter((item) => item.lane === 'sound').map((item) => item.clip)
  const [visualId, setVisualId] = useState(''),
    [soundId, setSoundId] = useState('')
  const [move, setMove] = useState<Lane>('sound')
  const [offset, setOffset] = useState<string | number>(0)
  const [error, setError] = useState(''),
    [status, setStatus] = useState('')
  const memberKey = members.map(({ clip }) => clip.id).join('|')
  useEffect(() => {
    setVisualId((current) =>
      visuals.some((clip) => clip.id === current) ? current : (visuals[0]?.id ?? '')
    )
    setSoundId((current) =>
      sounds.some((clip) => clip.id === current) ? current : (sounds[0]?.id ?? '')
    )
    setError('')
    setStatus('')
  }, [memberKey])
  const visual = visuals.find((clip) => clip.id === visualId),
    sound = sounds.find((clip) => clip.id === soundId)
  const currentOffset = visual && sound ? sound.start - visual.start : 0
  useEffect(() => {
    setOffset(Math.round(currentOffset * 1e6) / 1e6)
  }, [visualId, soundId, currentOffset])
  const groups = new Set(members.flatMap(({ clip }) => (clip.linkId ? [clip.linkId] : [])))
  const locked = members.some(({ clip, lane }) => clipLocked(document, clip, lane))
  function apply(result: VideoLinkResult, message: string) {
    setError(result.error)
    if (result.error) {
      setStatus('')
      return
    }
    try {
      if (result.changedIds.length) onApply(result.document, result.memberIds)
      setStatus(result.changedIds.length ? message : '位置或关联未变化')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '未能更新音画关联')
      setStatus('')
    }
  }
  const sync = (value: number) =>
    apply(
      synchronizeVideoPair(document, visualId, soundId, { move, offsetSeconds: value, readonly }),
      move === 'sound' ? '已移动声音，画面位置不变' : '已移动画面，声音位置不变'
    )
  return (
    <Stack gap="xs">
      <Text size="xs" fw={650}>
        音画关联与同步
      </Text>
      {locked && (
        <Text size="xs" c="dimmed">
          所选或关联轨道已锁定，请先解锁。
        </Text>
      )}
      <Group grow>
        <Button
          size="xs"
          leftSection={<IconLink size={14} />}
          disabled={readonly || locked || !visuals.length || !sounds.length}
          onClick={() =>
            apply(
              linkSelectedVideoClips(document, selectedIds, { readonly }),
              `已关联 ${members.length} 个片段，现有偏移不变`
            )
          }
        >
          关联
        </Button>
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconUnlink size={14} />}
          disabled={readonly || locked || !groups.size}
          onClick={() =>
            apply(unlinkVideoClips(document, selectedIds, readonly), '已解除完整关联组')
          }
        >
          解除关联
        </Button>
      </Group>
      {!!visuals.length && !!sounds.length && (
        <EditorDisclosure title="同步起点">
          <Stack gap="xs">
            <Select
              label="画面"
              size="xs"
              value={visualId || null}
              allowDeselect={false}
              data={visuals.map((clip) => ({ value: clip.id, label: clip.name }))}
              onChange={(id) => setVisualId(id ?? '')}
            />
            <Select
              label="声音"
              size="xs"
              value={soundId || null}
              allowDeselect={false}
              data={sounds.map((clip) => ({ value: clip.id, label: clip.name }))}
              onChange={(id) => setSoundId(id ?? '')}
            />
            <SegmentedControl
              size="xs"
              aria-label="同步时移动哪一侧"
              value={move}
              onChange={(value) => setMove(value as Lane)}
              data={[
                { value: 'sound', label: '移动声音' },
                { value: 'visual', label: '移动画面' }
              ]}
            />
            <NumberInput
              size="xs"
              label="声音偏移（秒）"
              value={offset}
              onChange={setOffset}
              step={1 / document.fps}
              decimalScale={3}
              min={-21600}
              max={21600}
              disabled={readonly || locked}
            />
            <Group grow>
              <Button
                size="xs"
                variant="light"
                disabled={
                  readonly ||
                  locked ||
                  !visual ||
                  !sound ||
                  offset === '' ||
                  !Number.isFinite(Number(offset))
                }
                onClick={() => sync(Number(offset))}
              >
                应用偏移
              </Button>
              <Button
                size="xs"
                variant="default"
                disabled={readonly || locked || !visual || !sound}
                onClick={() => sync(0)}
              >
                两侧起点对齐
              </Button>
            </Group>
          </Stack>
        </EditorDisclosure>
      )}
      {error && (
        <Alert color="red" p="xs">
          {error}
        </Alert>
      )}
      {status && (
        <Text size="xs" c="dimmed" role="status">
          {status}
        </Text>
      )}
    </Stack>
  )
}
