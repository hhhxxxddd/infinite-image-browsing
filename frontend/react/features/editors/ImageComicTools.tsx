import {
  ActionIcon,
  Button,
  ColorInput,
  Group,
  NumberInput,
  Popover,
  Select,
  Stack,
  Text,
  Tooltip,
  SegmentedControl
} from '@mantine/core'
import { useState } from 'react'
import { IconLayoutBoard, IconMessageCircle } from '@tabler/icons-react'
import type {
  StudioDocument,
  StudioVectorLayer,
  StudioVectorShape
} from '../../../src/features/image-editor/model/imageStudioModel'
import {
  createStudioVector,
  studioBubblePresets,
  studioVectorPath
} from '../../../src/features/image-editor/model/imageStudioVectors'
import type { ImageTransformTool } from './ImageTransformTools'
import EditorParameterSlider from './EditorParameterSlider'
import './ImageComicTools.css'
import {
  comicLayouts,
  imageLayouts,
  studioLayoutFrames,
  type StudioLayoutPreset
} from '../../../src/features/image-editor/model/imageStudioLayouts'

export function VectorThumbnail({ shape }: { shape: StudioVectorShape }) {
  const vector = createStudioVector('shape', shape, { x: 0, y: 0, width: 120, height: 76 })
  if (shape === 'polygon')
    vector.points = [
      { x: 0.15, y: 0 },
      { x: 1, y: 0 },
      { x: 0.85, y: 1 },
      { x: 0, y: 1 }
    ]
  return (
    <svg viewBox="-4 -4 128 84" aria-hidden="true">
      <path
        d={studioVectorPath(vector)}
        fill="currentColor"
        fillOpacity=".12"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  )
}

export default function ImageComicTools({
  tool,
  disabled,
  onTool,
  onClose,
  onVector,
  onBubble,
  document,
  onLayout,
  onLibrary,
  onSave
}: {
  document: StudioDocument
  tool: ImageTransformTool
  disabled: boolean
  onTool: (tool: ImageTransformTool) => void
  onClose: () => void
  onVector: (kind: 'frame' | 'shape', shape: StudioVectorShape) => void
  onBubble: (shape: (typeof studioBubblePresets)[number]['shape']) => void
  onLayout: (frames: StudioVectorLayer[]) => void
  onLibrary: (kind: 'layout' | 'image') => void
  onSave: (kind: 'layout' | 'image') => void
}) {
  const [tab, setTab] = useState('comic'),
    [margin, setMargin] = useState(3.5),
    [gap, setGap] = useState(2.5)
  const [preset, setPreset] = useState<StudioLayoutPreset>('comic-hero')
  const hasFrames = document.layers.some((layer) => layer.kind === 'frame')
  return (
    <>
      {(['shapes', 'layout'] as const).map((key) => (
        <Popover
          key={key}
          opened={tool === key}
          onChange={(open) => (open ? onTool(key) : onClose())}
          position="right-start"
          offset={12}
          width={320}
          withinPortal
          portalProps={{ target: '.react-editor-shell' }}
          shadow="md"
          zIndex={65}
        >
          <Popover.Target>
            <Tooltip label={key === 'layout' ? '版式' : '形状'}>
              <ActionIcon
                aria-label={key === 'layout' ? '版式' : '形状'}
                variant={tool === key ? 'light' : 'subtle'}
                disabled={disabled}
                onClick={() => (tool === key ? onClose() : onTool(key))}
              >
                {key === 'layout' ? <IconLayoutBoard size={18} /> : <IconMessageCircle size={18} />}
              </ActionIcon>
            </Tooltip>
          </Popover.Target>
          <Popover.Dropdown
            className={`react-image-tool-popover react-image-rail-popover react-comic-popover${key === 'layout' ? ' react-layout-popover' : ''}`}
          >
            <Stack gap="sm" className={key === 'layout' ? 'react-layout-panel' : undefined}>
              <Text fw={700} size="sm">
                {key === 'layout' ? '版式' : '形状'}
              </Text>
              {key === 'layout' && (
                <SegmentedControl
                  size="xs"
                  value={tab}
                  onChange={(value) => {
                    setTab(value)
                    if (value === 'basic') setPreset('single')
                    if (value === 'comic') setPreset('comic-hero')
                  }}
                  data={[
                    { value: 'basic', label: '基础拼图' },
                    { value: 'comic', label: '漫画分镜' },
                    { value: 'frame', label: '单个画框' }
                  ]}
                />
              )}
              <Stack
                gap="sm"
                key={key === 'layout' ? tab : key}
                className={key === 'layout' ? 'react-layout-content' : undefined}
              >
                {key === 'layout' && tab !== 'frame' && (
                  <>
                    <div className="react-comic-presets">
                      {(tab === 'basic' ? imageLayouts : comicLayouts).map((item) => {
                        const frames = studioLayoutFrames(
                          { width: 120, height: 100 },
                          item.key,
                          margin / 100,
                          gap / 100
                        )
                        return (
                          <button
                            type="button"
                            key={item.key}
                            aria-pressed={preset === item.key}
                            onClick={() => setPreset(item.key)}
                          >
                            <svg viewBox="0 0 120 100" aria-hidden="true">
                              {frames.map((frame, i) => (
                                <path
                                  key={i}
                                  d={studioVectorPath(frame)}
                                  transform={`translate(${frame.x} ${frame.y})`}
                                  fill="currentColor"
                                  fillOpacity=".12"
                                  stroke="currentColor"
                                  strokeWidth="1.4"
                                />
                              ))}
                            </svg>
                            <span>{item.label}</span>
                          </button>
                        )
                      })}
                    </div>
                    <Group grow>
                      <NumberInput
                        size="xs"
                        label="页边距 %"
                        value={margin}
                        min={0}
                        max={15}
                        step={0.5}
                        onChange={(v) => typeof v === 'number' && setMargin(v)}
                      />
                      <NumberInput
                        size="xs"
                        label="格间距 %"
                        value={gap}
                        min={0}
                        max={10}
                        step={0.5}
                        onChange={(v) => typeof v === 'number' && setGap(v)}
                      />
                    </Group>
                    <Button
                      size="xs"
                      onClick={() =>
                        onLayout(studioLayoutFrames(document, preset, margin / 100, gap / 100))
                      }
                    >
                      应用版式
                    </Button>
                  </>
                )}
                {(key === 'shapes' || tab === 'frame') && (
                  <>
                    <div className="react-comic-presets">
                      {key === 'layout'
                        ? (['rect', 'ellipse', 'polygon'] as const).map((shape) => (
                            <button
                              type="button"
                              key={shape}
                              onClick={() => onVector('frame', shape)}
                            >
                              <VectorThumbnail shape={shape} />
                              <span>
                                {
                                  { rect: '矩形画框', ellipse: '椭圆画框', polygon: '斜边画框' }[
                                    shape
                                  ]
                                }
                              </span>
                            </button>
                          ))
                        : studioBubblePresets.map((preset) => (
                            <button
                              type="button"
                              key={preset.shape}
                              onClick={() => onBubble(preset.shape)}
                            >
                              <VectorThumbnail shape={preset.shape} />
                              <span>{preset.name}</span>
                            </button>
                          ))}
                    </div>
                    {key === 'shapes' && (
                      <>
                        <Text size="xs" c="dimmed">
                          基础形状
                        </Text>
                        <div className="react-comic-presets">
                          {(['rect', 'ellipse', 'polygon'] as const).map((shape) => (
                            <button
                              type="button"
                              key={shape}
                              onClick={() => onVector('shape', shape)}
                            >
                              <VectorThumbnail shape={shape} />
                              <span>
                                {{ rect: '矩形', ellipse: '椭圆', polygon: '四边形' }[shape]}
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {key === 'layout' && (
                      <Text size="xs" c="dimmed">
                        选中画框后添加图片，双击进入内容；拖动菱形点调整斜边。
                      </Text>
                    )}
                  </>
                )}
              </Stack>
              {key === 'layout' && (
                <Stack gap="xs" className="react-layout-footer" role="group" aria-label="版式模板">
                  <Group grow>
                    <Button size="compact-xs" variant="default" onClick={() => onLibrary('layout')}>
                      版式模板
                    </Button>
                    <Button size="compact-xs" variant="default" onClick={() => onLibrary('image')}>
                      整页模板
                    </Button>
                  </Group>
                  <Group grow>
                    <Tooltip label="请先应用版式或添加画框" disabled={hasFrames}>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        disabled={disabled || !hasFrames}
                        onClick={() => onSave('layout')}
                      >
                        保存当前版式
                      </Button>
                    </Tooltip>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      disabled={disabled || !document.layers.length}
                      onClick={() => onSave('image')}
                    >
                      保存整页
                    </Button>
                  </Group>
                </Stack>
              )}
            </Stack>
          </Popover.Dropdown>
        </Popover>
      ))}
    </>
  )
}

export function ImageVectorProperties({
  layer,
  disabled,
  onChange,
  onAddImage
}: {
  layer: StudioVectorLayer
  disabled: boolean
  onChange: (change: Partial<StudioVectorLayer>) => void
  onAddImage: () => void
}) {
  return (
    <Stack gap="xs">
      {layer.kind === 'frame' && (
        <>
          <Button size="compact-xs" variant="default" disabled={disabled} onClick={onAddImage}>
            向画框添加图片
          </Button>
          <Text size="xs" c="dimmed">
            拖动画框整体移动，缩放边界改变裁切。双击进入内容。
          </Text>
        </>
      )}
      <Select
        size="xs"
        label="形状"
        value={layer.shape}
        disabled={disabled}
        data={[
          { value: 'rect', label: '矩形' },
          { value: 'ellipse', label: '椭圆' },
          { value: 'polygon', label: '四边形' },
          ...(layer.kind === 'shape'
            ? [
                { value: 'speech', label: '对白气泡' },
                { value: 'thought', label: '思考气泡' },
                { value: 'burst', label: '强调气泡' }
              ]
            : [])
        ]}
        onChange={(value) => onChange({ shape: value as StudioVectorShape })}
      />
      <Group grow>
        <ColorInput
          size="xs"
          label="填充"
          value={layer.fill}
          disabled={disabled}
          onChange={(fill) => onChange({ fill })}
        />
        <ColorInput
          size="xs"
          label="描边"
          value={layer.stroke}
          disabled={disabled}
          onChange={(stroke) => onChange({ stroke })}
        />
      </Group>
      <Button
        size="compact-xs"
        variant="subtle"
        disabled={disabled}
        onClick={() => onChange({ fill: layer.fill === 'transparent' ? '#ffffff' : 'transparent' })}
      >
        {layer.fill === 'transparent' ? '恢复填充' : '设为透明填充'}
      </Button>
      <EditorParameterSlider
        label="描边"
        resetValue={2}
        formatValue={(v) => `${Math.round(v * 10) / 10}px`}
        min={0}
        max={Math.max(10, Math.round(Math.min(layer.width, layer.height) / 5))}
        value={layer.strokeWidth}
        disabled={disabled}
        onChange={(strokeWidth) => onChange({ strokeWidth })}
      />
      {layer.shape === 'rect' && (
        <EditorParameterSlider
          label="圆角"
          resetValue={0}
          formatValue={(v) => `${Math.round(v * 10) / 10}px`}
          min={0}
          max={Math.round(Math.min(layer.width, layer.height) / 2)}
          value={layer.radius}
          disabled={disabled}
          onChange={(radius) => onChange({ radius })}
        />
      )}
      {(layer.shape === 'speech' || layer.shape === 'thought') && (
        <Group grow>
          <NumberInput
            size="xs"
            label="尾巴位置 %"
            value={Math.round(layer.tail.x * 100)}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(v) =>
              typeof v === 'number' && onChange({ tail: { ...layer.tail, x: v / 100 } })
            }
          />
          <NumberInput
            size="xs"
            label="尾巴长度 %"
            value={Math.round((layer.tail.y - 0.8) * 500)}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(v) =>
              typeof v === 'number' && onChange({ tail: { ...layer.tail, y: 0.8 + v / 500 } })
            }
          />
        </Group>
      )}
    </Stack>
  )
}
