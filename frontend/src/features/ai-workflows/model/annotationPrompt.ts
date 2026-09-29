import { studioLayerVisible, type StudioDocument } from '../../image-editor/public/document.ts'

export interface AnnotationPromptRules {
  rect: string
  arrow: string
  paint: string
}

export const defaultAnnotationPromptRules: Readonly<AnnotationPromptRules> = Object.freeze({
  rect: '修改方框内的区域: {批注}',
  arrow: '修改箭头指向的区域: {批注}',
  paint: '去掉涂抹标注，并编辑其覆盖的区域: {批注}'
})

export function validAnnotationTemplate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1000 && value.includes('{批注}')
}

export function readAnnotationPromptRules(value: unknown): AnnotationPromptRules {
  const saved = value && typeof value === 'object' ? (value as Partial<AnnotationPromptRules>) : {}
  return Object.fromEntries(
    (Object.keys(defaultAnnotationPromptRules) as (keyof AnnotationPromptRules)[]).map((key) => [
      key,
      validAnnotationTemplate(saved[key]) ? saved[key] : defaultAnnotationPromptRules[key]
    ])
  ) as unknown as AnnotationPromptRules
}

export function formatAnnotationPrompt(template: string, text: string, number: number): string {
  const oneLine = (value: string) => value.trim().replace(/\s*\r?\n\s*/g, ' ')
  return oneLine(template).replace(/\{批注\}|\{序号\}/g, (token) =>
    token === '{批注}' ? oneLine(text) : String(number)
  )
}

export function extractAnnotationPrompt(
  doc: StudioDocument | null,
  rules: AnnotationPromptRules = defaultAnnotationPromptRules
): string {
  if (!doc) return ''
  return doc.layers
    .flatMap((layer, index) => {
      if (
        (layer.kind !== 'guide' && layer.kind !== 'paint') ||
        !studioLayerVisible(doc, layer) ||
        !layer.prompt.trim()
      )
        return []
      const kind = layer.kind === 'paint' ? 'paint' : layer.shape
      const number = Number(/\s(\d+)$/.exec(layer.name)?.[1] ?? index + 1)
      return [
        {
          index,
          number,
          text: formatAnnotationPrompt(rules[kind], layer.prompt, number)
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
