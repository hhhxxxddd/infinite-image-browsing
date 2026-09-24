import { parameterEntries, readGenerationDraft } from './generationInfoDraft.ts'

export interface GenerationResource {
  type: string
  name: string
  hash?: string
  weight?: number
}

const resourceToken = /<(?:lora|lyco|hypernet):[^>]+>/gi
const resourceParameter = /^(?:Model(?: hash)?|LoRA|Lora hashes|Hashes|AddNet (?:Enabled|Model \d+|Module \d+|Weight(?: A| B)? \d+)|Hypernet(?: strength)?)$/i
const resourceJsonKey = /^(?:model|model_name|ckpt_name|unet_name|lora|loras|lora_name|lora hashes|checkpoint|resources)$/i
const isName = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/^(?:none|null|unknown)$/i.test(value.trim())

export function getGenerationResources(meta: Record<string, unknown>): GenerationResource[] {
  const result: GenerationResource[] = []
  function add(type: string, name: unknown, hash?: unknown, weight?: unknown) {
    if (!isName(name)) return
    const normalizedType = type.toLowerCase() === 'model' ? 'model' : type.toLowerCase() === 'lora' ? 'lora' : type.toLowerCase()
    const existing = result.find(item => item.type === normalizedType && item.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())
    const candidate: GenerationResource = {
      type: normalizedType,
      name: name.trim(),
      ...(isName(hash) ? { hash: hash.trim() } : {}),
      ...(typeof weight === 'number' && Number.isFinite(weight) ? { weight } : {}),
    }
    if (existing) {
      if (!existing.hash && candidate.hash) existing.hash = candidate.hash
      if (existing.weight == null && candidate.weight != null) existing.weight = candidate.weight
    } else result.push(candidate)
  }

  add('model', meta.Model ?? meta.model, meta['Model hash'])
  if (Array.isArray(meta.resources)) {
    for (const resource of meta.resources) {
      if (resource && typeof resource === 'object') {
        const entry = resource as Record<string, unknown>
        add(String(entry.type ?? ''), entry.name, entry.hash, entry.weight)
      }
    }
  }
  for (const value of [meta.LoRA, meta.Lora, meta.lora]) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') add('lora', item)
        else if (item && typeof item === 'object') {
          const entry = item as Record<string, unknown>
          add('lora', entry.name, entry.hash, entry.weight ?? entry.value)
        }
      }
    } else if (typeof value === 'string') {
      for (const name of value.split(';')) add('lora', name)
    }
  }
  if (typeof meta['Lora hashes'] === 'string') {
    for (const entry of meta['Lora hashes'].split(',')) {
      const separator = entry.lastIndexOf(':')
      if (separator > 0) add('lora', entry.slice(0, separator), entry.slice(separator + 1))
    }
  }
  return result
}

function stripResourceFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripResourceFields)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key, entry]) =>
      !resourceJsonKey.test(key) || (key.toLowerCase() === 'model' && Array.isArray(entry)))
      .map(([key, entry]) => [key, stripResourceFields(entry)]))
  }
  return typeof value === 'string' ? value.replace(resourceToken, '').trim() : value
}

/** Copy prompts and non-resource parameters without leaking model or LoRA names. */
export function copyableGenerationInfo(raw: string): string {
  if (!raw.trim()) return ''
  if (/^\s*[\[{]/.test(raw)) {
    try { return JSON.stringify(stripResourceFields(JSON.parse(raw)), null, 2) }
    catch { return '' }
  }
  const draft = readGenerationDraft(raw)
  const clean = (text: string) => text.replace(resourceToken, '').replace(/[ \t]+,/g, ',').replace(/,\s*,/g, ',').trim()
  const params = parameterEntries(draft.parameters).filter(entry => !resourceParameter.test(entry.slice(0, entry.indexOf(':')).trim())).join(', ')
  let extra = ''
  if (draft.extra.trim()) {
    try { extra = `extraJsonMetaInfo: ${JSON.stringify(stripResourceFields(JSON.parse(draft.extra)))}` }
    catch { /* Do not copy an unparsed resource-bearing metadata block. */ }
  }
  return [clean(draft.positive), draft.negative ? `Negative prompt: ${clean(draft.negative)}` : '', params, extra]
    .filter(Boolean).join('\n')
}
