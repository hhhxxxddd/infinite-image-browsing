import { captionStyle, type Caption } from './videoStudioModel.ts'

/** Preserves explicit breaks and wraps at word boundaries, falling back to characters for long words. */
export function wrapVideoCaption(text: string, width: number, measure: (text: string) => number) {
  const result: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    const tokens = paragraph.match(/[^\S\n]+|[A-Za-z0-9_'’\-]+|./gu) ?? []
    for (const token of tokens) {
      if (measure(line + token) <= width) {
        line += token
        continue
      }
      if (line.trim()) {
        result.push(line.trimEnd())
        line = ''
      }
      const clean = token.trimStart()
      if (measure(clean) <= width) {
        line = clean
        continue
      }
      for (const char of clean) {
        if (line && measure(line + char) > width) {
          result.push(line)
          line = ''
        }
        line += char
      }
    }
    result.push(line.trimEnd())
  }
  return result
}
export function videoCaptionLines(
  cue: Caption,
  canvasWidth: number,
  measure: (text: string, font: string) => number
) {
  const style = captionStyle(cue),
    font = `${style.bold ? 'bold ' : ''}${style.fontSize}px ${style.fontFamily}`
  return style.wrap
    ? wrapVideoCaption(cue.text, canvasWidth * style.maxWidth, (text) => measure(text, font))
    : cue.text.split('\n')
}
