import { useMemo, useState, type ComponentProps, type RefObject } from 'react'
import type {
  StudioDocument,
  StudioTextLayer
} from '../../../src/features/image-editor/model/imageStudioModel'
import { layoutStudioText } from '../../../src/features/image-editor/model/imageStudioText'
import { studioFontFamily } from '../../../src/features/image-editor/model/imageStudioFonts'

export default function ImageInlineTextEditor({
  layer,
  document,
  displayWidth,
  displayHeight,
  textRef,
  ...events
}: Omit<ComponentProps<'textarea'>, 'style' | 'value' | 'ref'> & {
  layer: StudioTextLayer
  document: StudioDocument
  displayWidth: number
  displayHeight: number
  textRef: RefObject<HTMLTextAreaElement | null>
}) {
  const [measure] = useState(() => window.document.createElement('canvas').getContext('2d'))
  const layout = useMemo(
    () => (measure ? layoutStudioText(measure, layer) : undefined),
    [measure, layer]
  )
  const scale = displayWidth / document.width
  const fontSize = Math.max(12, (layout?.fontSize ?? layer.fontSize) * scale)
  const lineHeight = layer.lineHeight ?? 1.24
  return (
    <textarea
      {...events}
      ref={textRef}
      className="react-image-inline-text"
      aria-label="画布文字编辑"
      value={layer.text}
      style={{
        left: `${(layer.x / document.width) * 100}%`,
        top: `${(layer.y / document.height) * 100}%`,
        width: `${(layer.width / document.width) * 100}%`,
        height: `${(layer.height / document.height) * 100}%`,
        paddingInline: Math.max(4, 4 * scale),
        paddingTop: Math.max(
          4,
          ((layer.height / document.height) * displayHeight -
            (layout?.lines.length ?? 1) * fontSize * lineHeight) /
            2
        ),
        paddingBottom: Math.max(4, 4 * scale),
        fontFamily: studioFontFamily(layer.font),
        fontSize,
        lineHeight,
        fontWeight: layer.bold ? 700 : 400,
        fontStyle: layer.italic ? 'italic' : 'normal',
        textDecoration:
          [layer.underline && 'underline', layer.strike && 'line-through']
            .filter(Boolean)
            .join(' ') || 'none',
        letterSpacing: (layer.letterSpacing ?? 0) * scale,
        textAlign: layer.align,
        transform: `rotate(${layer.rotation}deg) scale(${layer.flipX ? -1 : 1}, ${layer.flipY ? -1 : 1})`
      }}
    />
  )
}
