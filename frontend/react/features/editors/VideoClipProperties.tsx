import type { ReactNode } from 'react'
import {
  Button,
  Checkbox,
  ColorInput,
  Group,
  NumberInput,
  Select,
  Stack,
  Tabs,
  Text
} from '@mantine/core'
import {
  captionStyle,
  transformFor,
  type Caption,
  type VideoClip,
  type VideoTimelineDocument
} from './videoStudioModel'
import VideoKeyframesEditor from './VideoKeyframesEditor'
import VideoTransitionEditor from './VideoTransitionEditor'
import { visibleClipFades } from '../../../src/features/media-editor/model/audioTimeline'
import { videoAudioClip, setVideoSoundFades } from './videoSoundProperties'
const num = (v: string | number, fallback = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : fallback
export function CaptionProperties({
  cue,
  disabled,
  onChange
}: {
  cue: Caption
  disabled: boolean
  onChange: (cue: Caption) => void
}) {
  const style = captionStyle(cue)
  const update = (patch: Partial<typeof style>) =>
    onChange({ ...cue, style: { ...style, ...patch } })
  return (
    <Stack gap="xs">
      <Group grow>
        <NumberInput
          label="字号"
          value={style.fontSize}
          min={8}
          max={240}
          disabled={disabled}
          onChange={(v) => update({ fontSize: num(v, 32) })}
        />
        <Select
          label="字体"
          value={style.fontFamily}
          data={[
            { value: 'sans-serif', label: '黑体' },
            { value: 'serif', label: '宋体' },
            { value: 'monospace', label: '等宽' }
          ]}
          disabled={disabled}
          onChange={(v) => update({ fontFamily: v ?? 'sans-serif' })}
        />
      </Group>
      <Group grow>
        <ColorInput
          label="文字"
          value={style.color}
          format="hex"
          disabled={disabled}
          onChange={(color) => {
            if (/^#[0-9a-f]{6}$/i.test(color)) update({ color })
          }}
        />
        <ColorInput
          label="背景"
          value={style.background}
          format="hexa"
          disabled={disabled}
          onChange={(background) => {
            if (/^#[0-9a-f]{8}$/i.test(background)) update({ background })
          }}
        />
      </Group>
      <Group grow>
        <ColorInput
          label="描边"
          value={style.outlineColor}
          disabled={disabled}
          onChange={(outlineColor) => {
            if (/^#[0-9a-f]{6}$/i.test(outlineColor)) update({ outlineColor })
          }}
        />
        <NumberInput
          label="描边宽度"
          min={0}
          max={10}
          value={style.outlineWidth}
          disabled={disabled}
          onChange={(v) => update({ outlineWidth: num(v) })}
        />
      </Group>
      <Checkbox
        label="加粗"
        checked={style.bold}
        disabled={disabled}
        onChange={(e) => update({ bold: e.currentTarget.checked })}
      />
      <Select
        label="对齐"
        value={style.align}
        data={[
          { value: 'left', label: '左对齐' },
          { value: 'center', label: '居中' },
          { value: 'right', label: '右对齐' }
        ]}
        disabled={disabled}
        onChange={(v) => update({ align: v as typeof style.align })}
      />
      <Group grow>
        <NumberInput
          label="水平位置 %"
          value={style.x * 100}
          min={0}
          max={100}
          disabled={disabled}
          onChange={(v) => update({ x: num(v) / 100 })}
        />
        <NumberInput
          label="垂直位置 %"
          value={style.y * 100}
          min={0}
          max={100}
          disabled={disabled}
          onChange={(v) => update({ y: num(v) / 100 })}
        />
      </Group>
      <Checkbox
        label="自动换行"
        checked={style.wrap}
        disabled={disabled}
        onChange={(event) => update({ wrap: event.currentTarget.checked })}
      />
      <NumberInput
        label="文字最大宽度 %"
        value={style.maxWidth * 100}
        min={10}
        max={100}
        disabled={disabled || !style.wrap}
        onChange={(value) => update({ maxWidth: num(value, 90) / 100 })}
      />
    </Stack>
  )
}
export default function VideoClipProperties({
  clip,
  visual,
  disabled,
  timingDisabled = disabled,
  playhead,
  onChange,
  onUnlink,
  doc,
  fps = doc?.fps ?? 30,
  onSeek,
  onChangeDocument,
  onInteractionStart,
  onInteractionEnd,
  section = 'all',
  localPanel,
  trimPanel
}: {
  clip: VideoClip
  visual: boolean
  disabled: boolean
  timingDisabled?: boolean
  playhead: number
  onChange: (clip: VideoClip) => void
  onUnlink: () => void
  doc?: VideoTimelineDocument
  fps?: number
  onSeek?: (time: number) => void
  onChangeDocument?: (doc: VideoTimelineDocument) => void
  onInteractionStart?: () => void
  onInteractionEnd?: (cancelled?: boolean) => void
  section?: 'basic' | 'refine' | 'all'
  localPanel?: ReactNode
  trimPanel?: ReactNode
}) {
  const t = transformFor(clip)
  const update = (patch: Partial<typeof t>) => onChange({ ...clip, transform: { ...t, ...patch } })
  const color = clip.color ?? { brightness: 0, contrast: 1, saturation: 1 }
  const showBasic = section !== 'refine'
  const showRefine = section !== 'basic'
  const fades = visibleClipFades(videoAudioClip(clip))
  const changeFades = (fadeIn: number, fadeOut: number) =>
    onChange(
      visual
        ? {
            ...clip,
            fadeIn: Math.min(30, fadeIn),
            fadeOut: Math.min(30, fadeOut),
            envelopeOffset: 0,
            envelopeDuration: clip.duration
          }
        : setVideoSoundFades(clip, fadeIn, fadeOut)
    )
  const field = (
    label: string,
    key: 'x' | 'y' | 'scale' | 'rotation' | 'opacity',
    min: number,
    max: number,
    scale = 1
  ) => (
    <NumberInput
      label={label}
      value={t[key] * scale}
      min={min}
      max={max}
      step={key === 'rotation' ? 1 : 1}
      decimalScale={2}
      disabled={disabled}
      onChange={(v) => update({ [key]: num(v) / scale })}
    />
  )
  return (
    <Stack gap="sm">
      {showBasic && clip.linkId && (
        <Button variant="default" size="xs" disabled={timingDisabled} onClick={onUnlink}>
          解除音画关联
        </Button>
      )}
      {showBasic && (
        <Group grow>
          <NumberInput
            label="淡入（秒）"
            min={0}
            max={Math.min(30, clip.duration)}
            step={0.1}
            value={fades.fadeIn}
            disabled={disabled}
            onChange={(v) => changeFades(num(v), fades.fadeOut)}
          />
          <NumberInput
            label="淡出（秒）"
            min={0}
            max={Math.min(30, clip.duration)}
            step={0.1}
            value={fades.fadeOut}
            disabled={disabled}
            onChange={(v) => changeFades(fades.fadeIn, num(v))}
          />
        </Group>
      )}
      {showRefine && clip.kind !== 'image' && (
        <Group>
          <Checkbox
            label="倒放"
            checked={!!clip.reverse}
            disabled={timingDisabled || !!clip.freeze || clip.duration > 30}
            onChange={(e) => onChange({ ...clip, reverse: e.currentTarget.checked })}
          />
          {visual && (
            <Checkbox
              label="定格"
              checked={!!clip.freeze}
              disabled={timingDisabled}
              onChange={(e) =>
                onChange({ ...clip, freeze: e.currentTarget.checked, reverse: false })
              }
            />
          )}
        </Group>
      )}
      {showRefine && clip.kind !== 'image' && clip.duration > 30 && (
        <Text size="xs" c="dimmed">
          倒放片段最长 30 秒，可先拆分。
        </Text>
      )}
      {visual && showBasic && (
        <>
          <Text size="xs" fw={650}>
            画面
          </Text>
          <Select
            label="填充方式"
            value={t.fit}
            data={[
              { value: 'contain', label: '完整' },
              { value: 'cover', label: '填充' },
              { value: 'stretch', label: '拉伸' }
            ]}
            disabled={disabled}
            onChange={(v) => update({ fit: v as typeof t.fit })}
          />
          <Group grow>
            {field('水平偏移 %', 'x', -200, 200, 100)}
            {field('垂直偏移 %', 'y', -200, 200, 100)}
          </Group>
          <Group grow>
            {field('缩放 %', 'scale', 5, 400, 100)}
            {field('旋转 °', 'rotation', -360, 360)}
          </Group>
          <Group>
            <Checkbox
              label="水平翻转"
              checked={t.flipX}
              disabled={disabled}
              onChange={(e) => update({ flipX: e.currentTarget.checked })}
            />
            <Checkbox
              label="垂直翻转"
              checked={t.flipY}
              disabled={disabled}
              onChange={(e) => update({ flipY: e.currentTarget.checked })}
            />
          </Group>
          {field('不透明度 %', 'opacity', 0, 100, 100)}
        </>
      )}
      {visual && showRefine && (
        <Tabs
          defaultValue="animation"
          keepMounted
          styles={{
            tab: {
              paddingInline: 'var(--mantine-spacing-xs)',
              fontSize: 'var(--mantine-font-size-xs)'
            }
          }}
        >
          <Tabs.List grow>
            <Tabs.Tab value="animation">动画</Tabs.Tab>
            <Tabs.Tab value="transition">转场</Tabs.Tab>
            <Tabs.Tab value="crop">裁切</Tabs.Tab>
            <Tabs.Tab value="color">调色</Tabs.Tab>
            {localPanel && <Tabs.Tab value="local">局部与精调</Tabs.Tab>}
            {trimPanel && <Tabs.Tab value="trim">精剪</Tabs.Tab>}
          </Tabs.List>
          <Tabs.Panel value="animation" pt="sm">
            <VideoKeyframesEditor
              key={clip.id}
              clip={clip}
              disabled={disabled}
              playhead={playhead}
              fps={fps}
              onChange={onChange}
              onSeek={onSeek}
              onInteractionStart={onInteractionStart}
              onInteractionEnd={onInteractionEnd}
            />
          </Tabs.Panel>
          <Tabs.Panel value="transition" pt="sm">
            {doc && onChangeDocument ? (
              <VideoTransitionEditor
                key={clip.id}
                doc={doc}
                clip={clip}
                disabled={timingDisabled}
                onChange={onChangeDocument}
                onSeek={onSeek}
                onInteractionStart={onInteractionStart}
                onInteractionEnd={onInteractionEnd}
              />
            ) : (
              <Text size="xs" c="dimmed">
                选择同轨相邻画面编辑转场。
              </Text>
            )}
          </Tabs.Panel>
          <Tabs.Panel value="crop" pt="sm">
            <Text size="xs" c="dimmed" mb="xs">
              调整源画面的取景范围。
            </Text>
            <Group grow>
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <NumberInput
                  key={key}
                  label={{ x: '左 %', y: '上 %', width: '宽 %', height: '高 %' }[key]}
                  value={t.crop[key] * 100}
                  min={key === 'width' || key === 'height' ? 1 : 0}
                  max={100}
                  disabled={disabled}
                  onChange={(v) => {
                    const crop = { ...t.crop, [key]: num(v) / 100 }
                    crop.width = Math.min(crop.width, 1 - crop.x)
                    crop.height = Math.min(crop.height, 1 - crop.y)
                    crop.x = Math.min(crop.x, 0.99)
                    crop.y = Math.min(crop.y, 0.99)
                    crop.width = Math.max(0.01, crop.width)
                    crop.height = Math.max(0.01, crop.height)
                    update({ crop })
                  }}
                />
              ))}
            </Group>
          </Tabs.Panel>
          <Tabs.Panel value="color" pt="sm">
            <Group grow>
              {(['brightness', 'contrast', 'saturation'] as const).map((key) => (
                <NumberInput
                  key={key}
                  label={{ brightness: '亮度', contrast: '对比度', saturation: '饱和度' }[key]}
                  value={color[key]}
                  min={key === 'brightness' ? -1 : 0}
                  max={key === 'brightness' ? 1 : 3}
                  step={0.05}
                  decimalScale={2}
                  disabled={disabled}
                  onChange={(v) => onChange({ ...clip, color: { ...color, [key]: num(v) } })}
                />
              ))}
            </Group>
          </Tabs.Panel>
          {localPanel && (
            <Tabs.Panel value="local" pt="sm">
              {localPanel}
            </Tabs.Panel>
          )}
          {trimPanel && (
            <Tabs.Panel value="trim" pt="sm">
              {trimPanel}
            </Tabs.Panel>
          )}
          <Button
            mt="sm"
            size="xs"
            variant="subtle"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...clip,
                transform: undefined,
                color: undefined,
                keyframes: undefined,
                fadeIn: 0,
                fadeOut: 0
              })
            }
          >
            重置画面与动画
          </Button>
        </Tabs>
      )}
      {!visual && showRefine && trimPanel}
    </Stack>
  )
}
