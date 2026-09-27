import { unescapeHtml } from '../../../shared/lib/unescapeHtml.ts'
import { parameterLine, parameterEntries } from './generationInfoDraft.ts'

// Fork from https://github.com/jiw0220/stable-diffusion-image-metadata/blob/main/src/index.ts
type ImageMeta = {
  prompt?: string
  negativePrompt?: string
  hashes?: Record<string, unknown>
  width?: number
  height?: number
  resources?: Resource[]
} & Record<string, unknown>

type Resource = {
  type: string
  name: string
  weight?: number
  hash?: string
}

const imageMetadataKeys: Array<[string, string]> = [
  ['Seed', 'seed'],
  ['CFG scale', 'cfgScale'],
  ['Sampler', 'sampler'],
  ['Steps', 'steps'],
  ['Clip skip', 'clipSkip'],
  ['Size', 'size']
]
const imageMetaKeyMap = new Map<string, string>(imageMetadataKeys)
const automaticExtraNetsRegex =
  /<(lora|lyco|hypernet):([^:>]+)(?::([-+]?(?:\d+(?:\.\d*)?|\.\d+)))?>/gi
const automaticNameHash = /^(.+?)(?:\(([a-f\d]+)\))?$/i
const getImageMetaKey = (key: string, keyMap: Map<string, string>) =>
  keyMap.get(key.trim()) ?? key.trim()
const stripKeys = ['Template: ', 'Negative Template: '] as const

export function parse(parameters: string): ImageMeta {
  const metadata: ImageMeta = {}
  if (!parameters) return metadata
  // Raw JSON/workflows are not prompt text. Preserve their source in the raw editor.
  if (/^\s*[\[{]/.test(parameters)) {
    try {
      JSON.parse(parameters)
      return metadata
    } catch {
      /* Weighted prompts may start with a bracket. */
    }
  }

  // 提取 extraJsonMetaInfo 字段
  const extraJsonMetaInfoMatch = parameters.match(/(?:^|\n)extraJsonMetaInfo:\s*(\{[\s\S]*\})\s*$/)
  if (extraJsonMetaInfoMatch) {
    try {
      metadata.extraJsonMetaInfo = JSON.parse(unescapeHtml(extraJsonMetaInfoMatch[1]))
      // 从原始参数中移除 extraJsonMetaInfo 部分
      parameters = parameters.replace(/(?:^|\n)extraJsonMetaInfo:\s*\{[\s\S]*\}\s*$/, '')
    } catch {
      // 解析失败，保留原始字符串
      metadata.extraJsonMetaInfo = extraJsonMetaInfoMatch[1]
    }
  }

  const metaLines = parameters.split('\n').filter((line) => {
    return line.trim() !== '' && !stripKeys.some((key) => line.startsWith(key))
  })

  const detailsLineIndex = metaLines.findIndex((line) => parameterLine.test(line))
  const detailsLine = metaLines[detailsLineIndex] || ''
  // Strip it from the meta lines
  if (detailsLineIndex > -1) metaLines.splice(detailsLineIndex, 1)
  // Match the writer grammar: quoted commas, escaped quotes, paths and nested JSON.
  for (const entry of parameterEntries(unescapeHtml(detailsLine))) {
    const separator = entry.indexOf(':')
    if (separator < 0) continue
    const key = getImageMetaKey(entry.slice(0, separator), imageMetaKeyMap)
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
    const text = entry.slice(separator + 1).trim()
    let value: unknown = text
    try {
      value = JSON.parse(text)
      // Seeds can exceed JavaScript's exact integer range; retain their original digits.
      if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value))
        value = text
    } catch {
      /* Unquoted names are valid. */
    }
    metadata[key === 'Hashes' ? 'hashes' : key] = value
  }

  // Extract prompts
  const [rawPrompt, ...negativePrompt] = metaLines
    .join('\n')
    .split('Negative prompt:')
    .map((x) => x.trim())

  // 确保 prompt 中不包含 extraJsonMetaInfo
  const prompt = rawPrompt.replace(/\nextraJsonMetaInfo:\s*\{[\s\S]*\}\s*$/, '').trim()

  metadata.prompt = prompt
  metadata.negativePrompt = negativePrompt.join(' ').trim()

  // Extract resources
  const extranets = [...prompt.matchAll(automaticExtraNetsRegex)]
  const resources: Resource[] = extranets.map(([, type, name, weight]) => ({
    type: type.toLowerCase(),
    name: name.trim(),
    ...(weight ? { weight: parseFloat(weight) } : {})
  }))

  const size = metadata.Size ?? metadata.size
  if (typeof size === 'string') {
    const match = size.match(/^(\d+)\s*[x×]\s*(\d+)$/)
    if (match) {
      metadata.width = Number(match[1])
      metadata.height = Number(match[2])
    }
  }

  if (typeof metadata['Model'] === 'string' && typeof metadata['Model hash'] === 'string') {
    const model = metadata['Model']
    const modelHash = metadata['Model hash']
    if (!metadata.hashes || typeof metadata.hashes !== 'object' || Array.isArray(metadata.hashes))
      metadata.hashes = {}
    if (!metadata.hashes['model']) metadata.hashes['model'] = modelHash

    resources.push({
      type: 'model',
      name: model,
      hash: modelHash
    })
  }

  if (metadata['Hypernet'] && metadata['Hypernet strength'])
    resources.push({
      type: 'hypernet',
      name: metadata['Hypernet'] as string,
      weight: parseFloat(metadata['Hypernet strength'] as string)
    })

  if (metadata['AddNet Enabled'] === 'True') {
    let i = 1

    while (true) {
      const fullname = metadata[`AddNet Model ${i}`]
      if (typeof fullname !== 'string' || !fullname) break
      const [, name, hash] = fullname.match(automaticNameHash) ?? []

      resources.push({
        type: String(metadata[`AddNet Module ${i}`] || 'lora').toLowerCase(),
        name: name?.trim() || fullname,
        hash,
        weight: parseFloat(metadata[`AddNet Weight ${i}`] as string)
      })
      i++
    }
  }

  metadata.resources = resources
  return metadata
}
