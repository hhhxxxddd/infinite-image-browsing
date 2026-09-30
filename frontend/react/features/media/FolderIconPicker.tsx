import { useEffect, useState } from 'react'
import { Button, Group, Modal, Stack, Text } from '@mantine/core'
import {
  IconArchive,
  IconBook,
  IconCamera,
  IconDisc,
  IconFolder,
  IconHeart,
  IconHome,
  IconLayoutGrid,
  IconMusic,
  IconPalette,
  IconPhoto,
  IconStar,
  IconTag,
  IconVideo
} from '@tabler/icons-react'
import { saveFolderIcon } from './mediaApi'
import { useMediaText } from './mediaLocale'

const choices = [
  ['folder', '文件夹', IconFolder],
  ['disk', '磁盘', IconDisc],
  ['photo', '图片', IconPhoto],
  ['video', '视频', IconVideo],
  ['camera', '相机', IconCamera],
  ['star', '收藏', IconStar],
  ['heart', '喜欢', IconHeart],
  ['book', '图册', IconBook],
  ['archive', '归档', IconArchive],
  ['work', '项目', IconLayoutGrid],
  ['music', '音乐', IconMusic],
  ['palette', '设计', IconPalette],
  ['tag', '分类', IconTag],
  ['home', '个人', IconHome]
] as const

export function FolderIcon({ value, size = 23 }: { value?: string; size?: number }) {
  const choice = choices.find(([id]) => id === value)
  if (value?.startsWith('data:image/png;base64,'))
    return <img className="ml-folder-custom-icon" src={value} alt="" />
  const Icon = choice?.[2] || IconFolder
  return <Icon size={size} stroke={1.65} />
}

export function FolderIconPicker({
  path,
  name,
  current,
  onClose,
  onSaved
}: {
  path: string
  name: string
  current: string
  onClose: () => void
  onSaved: (icon: string) => void
}) {
  const m = useMediaText()
  const [chosen, setChosen] = useState(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setChosen(current), [current, path])

  const upload = async (file?: File) => {
    if (!file) return
    if (
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) ||
      file.size > 5_000_000
    ) {
      setError(m('请选择不超过 5 MB 的 PNG、JPG、WebP 或 GIF 图片'))
      return
    }
    try {
      const image = await createImageBitmap(file)
      try {
        if (image.width > 4096 || image.height > 4096)
          throw new Error(m('图片边长不能超过 4096 像素'))
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 80
        const context = canvas.getContext('2d')
        if (!context) throw new Error(m('无法处理图片'))
        const scale = Math.min(64 / image.width, 64 / image.height)
        const width = image.width * scale
        const height = image.height * scale
        context.drawImage(image, (80 - width) / 2, (80 - height) / 2, width, height)
        const data = canvas.toDataURL('image/png')
        if (data.length > 90_000) throw new Error(m('图标处理后仍过大，请换一张图片'))
        setChosen(data)
        setError('')
      } finally {
        image.close()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m('无法处理图片'))
    }
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await saveFolderIcon(path, chosen)
      onSaved(chosen)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : m('保存目录图标失败'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal opened onClose={onClose} centered size={650} title={m('目录图标 · {name}', { name })}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {m('选择常用图标，或上传图片自动缩放为透明背景的方形图标。')}
        </Text>
        <div className="ml-icon-choices" role="group" aria-label={m('预设目录图标')}>
          <button className={!chosen ? 'active' : ''} type="button" onClick={() => setChosen('')}>
            <IconFolder size={24} stroke={1.6} />
            <span>{m('默认')}</span>
          </button>
          {choices.map(([id, label, Icon]) => (
            <button
              className={chosen === id ? 'active' : ''}
              key={id}
              type="button"
              onClick={() => setChosen(id)}
            >
              <Icon size={24} stroke={1.6} />
              <span>{m(label)}</span>
            </button>
          ))}
        </div>
        <Group gap="sm" wrap="wrap">
          <label className="ml-icon-upload">
            {m('上传图片')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              aria-label={m('上传目录图标图片')}
              onChange={(event) => {
                void upload(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
          <Text size="xs" c="dimmed">
            {m('最大 5 MB；缩放到 80×80，保留原图比例。')}
          </Text>
          {chosen.startsWith('data:image/png;base64,') && (
            <img className="ml-icon-preview" src={chosen} alt={m('自定义图标预览')} />
          )}
        </Group>
        {error && (
          <Text size="sm" c="red" role="alert">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {m('取消')}
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            {m('保存')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
