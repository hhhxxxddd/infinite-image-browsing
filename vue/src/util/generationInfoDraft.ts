export const parameterLine = /^(?:Steps|Sampler|Schedule type|Scheduler|CFG scale|Seed|Size|Model|Model hash|LoRA|Lora hashes|Hashes|AddNet Model \d+|Clip skip|Denoising strength):\s*/
export function readGenerationDraft(raw: string) {
  let text = raw.replace(/\r\n/g, '\n')
  const extraMatch = text.match(/(?:^|\n)extraJsonMetaInfo:\s*([\s\S]*)$/)
  const extra = extraMatch?.[1] ?? ''
  if (extraMatch) text = text.slice(0, extraMatch.index)
  const lines = text.split('\n')
  const paramsIndex = lines.findIndex(line => parameterLine.test(line))
  const parameters = paramsIndex >= 0 ? lines.splice(paramsIndex, 1)[0] : ''
  const prompt = lines.join('\n')
  const negativeIndex = prompt.indexOf('Negative prompt:')
  return {
    positive: (negativeIndex < 0 ? prompt : prompt.slice(0, negativeIndex)).trim(),
    negative: negativeIndex < 0 ? '' : prompt.slice(negativeIndex + 'Negative prompt:'.length).trim(),
    parameters, extra,
    rawPreferred: /^\s*[\[{]/.test(raw) || (paramsIndex >= 0 && lines.slice(paramsIndex).some(line => line.trim()))
  }
}
export function writeGenerationDraft(draft: ReturnType<typeof readGenerationDraft>) {
  if (draft.extra.trim()) {
    const extra = JSON.parse(draft.extra)
    if (!extra || Array.isArray(extra) || typeof extra !== 'object') throw new Error('补充信息需要是 JSON 对象')
  }
  const params = draft.parameters.trim().split('\n').map(line => line.trim()).filter(Boolean).join(', ')
  if (params && !parameterLine.test(params)) throw new Error('参数请以 Seed、Steps、Model 等参数名开头；其他字段可填写到补充信息')
  return [draft.positive.trim(), `Negative prompt: ${draft.negative.trim()}`, params,
    draft.extra.trim() ? `extraJsonMetaInfo: ${draft.extra.trim()}` : ''].filter(Boolean).join('\n')
}

// Split only commas outside quoted strings and structured values.
export function parameterEntries(text: string): string[] {
  const parts: string[] = []
  let start = 0, depth = 0, quoted = false, escaped = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (escaped) { escaped = false; continue }
    if (char === String.fromCharCode(92) && quoted) { escaped = true; continue }
    if (char === '"') quoted = !quoted
    if (quoted) continue
    if (char === '{' || char === '[') depth++
    if (char === '}' || char === ']') depth--
    if (char === ',' && depth === 0) { parts.push(text.slice(start, i).trim()); start = i + 1 }
  }
  parts.push(text.slice(start).trim())
  return parts.filter(Boolean)
}
export function readParameter(text: string, key: string): string {
  const entry = parameterEntries(text).find(entry => entry.slice(0, entry.indexOf(':')).trim() === key)
  if (!entry) return ''
  const value = entry.slice(entry.indexOf(':') + 1).trim()
  try { const decoded = JSON.parse(value); return typeof decoded === 'string' ? decoded : value } catch { return value }
}
export function setParameter(text: string, key: string, value: string): string {
  const parts = parameterEntries(text)
  const index = parts.findIndex(entry => entry.slice(0, entry.indexOf(':')).trim() === key)
  const encoded = /[,"\n]/.test(value) ? JSON.stringify(value) : value
  if (index >= 0) {
    if (value.trim()) parts[index] = `${key}: ${encoded}`
    else parts.splice(index, 1)
  } else if (value.trim()) parts.push(`${key}: ${encoded}`)
  return parts.join(', ')
}
