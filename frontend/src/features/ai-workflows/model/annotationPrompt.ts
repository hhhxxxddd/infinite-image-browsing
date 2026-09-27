import { studioLayerVisible, type StudioDocument } from '../../image-editor/public/document.ts'

export function extractAnnotationPrompt(doc: StudioDocument | null): string {
  if (!doc) return ''
  return doc.layers
    .flatMap((layer, index) => {
      if (
        (layer.kind !== 'guide' && layer.kind !== 'paint') ||
        !studioLayerVisible(doc, layer) ||
        !layer.prompt.trim()
      )
        return []
      const instruction =
        layer.kind === 'paint'
          ? '去掉涂抹标注，并编辑其覆盖的区域'
          : layer.shape === 'arrow'
            ? '修改箭头指向的区域'
            : '修改方框内的区域'
      return [
        {
          index,
          number: Number(/\s(\d+)$/.exec(layer.name)?.[1] ?? index + 1),
          text: `${instruction}: ${layer.prompt.trim().replace(/\s*\r?\n\s*/g, ' ')}`
        }
      ]
    })
    .sort((a, b) => a.number - b.number || a.index - b.index)
    .map((item) => item.text)
    .join('\n')
}

// Refresh only an untouched extracted block; preserve any text the user has rewritten.
export function mergeAnnotationPrompt(current: string, previous: string, next: string): string {
  if (!next || current.includes(next) || (next === previous && current.trim())) return current
  if (previous && current.includes(previous)) return current.replace(previous, next)
  return [current.trimEnd(), next].filter(Boolean).join('\n')
}
