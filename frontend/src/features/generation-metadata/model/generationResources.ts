import {
  parameterEntries,
  readGenerationDraft,
  writeGenerationDraft
} from './generationInfoDraft.ts'

export interface GenerationResource {
  type: string
  name: string
  hash?: string
  weight?: number
}

const resourceToken = /<(?:lora|lyco|hypernet):[^>]+>/gi
const resourceParameter =
  /^(?:Model(?: hash)?|LoRA|Lora hashes|Hashes|AddNet (?:Enabled|Model \d+|Module \d+|Weight(?: A| B)? \d+)|Hypernet(?: strength)?)$/i
const resourceJsonKey =
  /^(?:model|model_name|ckpt_name|unet_name|lora|loras|lora_name|lora hashes|checkpoint|resources)$/i
const isName = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && !/^(?:none|null|unknown)$/i.test(value.trim())

export function getGenerationResources(meta: Record<string, unknown>): GenerationResource[] {
  const result: GenerationResource[] = []
  const byKey = new Map<string, GenerationResource>()
  function add(type: string, name: unknown, hash?: unknown, weight?: unknown, override = false) {
    if (!isName(name)) return
    const normalizedType = ['model', 'checkpoint'].includes(type.toLowerCase())
      ? 'model'
      : type.toLowerCase()
    const key = `${normalizedType}\0${name.trim().toLocaleLowerCase()}`
    const existing = byKey.get(key)
    const candidate: GenerationResource = {
      type: normalizedType,
      name: name.trim(),
      ...(isName(hash) ? { hash: hash.trim() } : {}),
      ...(typeof weight === 'number' && Number.isFinite(weight) ? { weight } : {})
    }
    if (existing) {
      if ((override || !existing.hash) && candidate.hash) existing.hash = candidate.hash
      if ((override || existing.weight == null) && candidate.weight != null)
        existing.weight = candidate.weight
    } else {
      result.push(candidate)
      byKey.set(key, candidate)
    }
  }

  add('model', meta.Model ?? meta.model, meta['Model hash'])
  add('vae', meta.VAE, meta['VAE hash'])
  add('upscaler', meta['Hires upscaler'] ?? meta.Upscaler)
  add('embedding', meta.Embedding)
  add('controlnet', meta.ControlNet)
  const extraResources = (meta.extraJsonMetaInfo as Record<string, unknown> | undefined)?.resources
  for (const collection of [meta.resources, extraResources]) {
    if (!Array.isArray(collection)) continue
    for (const resource of collection) {
      if (resource && typeof resource === 'object') {
        const entry = resource as Record<string, unknown>
        add(
          String(entry.type ?? ''),
          entry.name,
          entry.hash,
          entry.weight,
          collection === extraResources
        )
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
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, entry]) =>
            !resourceJsonKey.test(key) || (key.toLowerCase() === 'model' && Array.isArray(entry))
        )
        .map(([key, entry]) => [key, stripResourceFields(entry)])
    )
  }
  return typeof value === 'string' ? value.replace(resourceToken, '').trim() : value
}

/** Copy prompts and non-resource parameters without leaking model or LoRA names. */
export function copyableGenerationInfo(raw: string): string {
  if (!raw.trim()) return ''
  if (/^\s*[\[{]/.test(raw)) {
    try {
      return JSON.stringify(stripResourceFields(JSON.parse(raw)), null, 2)
    } catch {
      return ''
    }
  }
  const draft = readGenerationDraft(raw)
  const clean = (text: string) =>
    text
      .replace(resourceToken, '')
      .replace(/[ \t]+,/g, ',')
      .replace(/,\s*,/g, ',')
      .trim()
  const params = parameterEntries(draft.parameters)
    .filter((entry) => !resourceParameter.test(entry.slice(0, entry.indexOf(':')).trim()))
    .join(', ')
  let extra = ''
  if (draft.extra.trim()) {
    try {
      extra = `extraJsonMetaInfo: ${JSON.stringify(stripResourceFields(JSON.parse(draft.extra)))}`
    } catch {
      /* Do not copy an unparsed resource-bearing metadata block. */
    }
  }
  return [
    clean(draft.positive),
    draft.negative ? `Negative prompt: ${clean(draft.negative)}` : '',
    params,
    extra
  ]
    .filter(Boolean)
    .join('\n')
}

/** Add a typed resource without rewriting source prompts or unrelated metadata. */
export function appendGenerationResource(raw: string, resource: GenerationResource) {
  const draft = readGenerationDraft(raw)
  if (draft.rawPreferred) throw new Error('此格式请使用原文编辑，避免改变工作流结构')
  if (!resource.name.trim()) throw new Error('请填写资源名称')
  if (resource.weight != null && !Number.isFinite(resource.weight))
    throw new Error('权重必须是有效数字')
  const extra = draft.extra.trim() ? JSON.parse(draft.extra) : {}
  if (!extra || Array.isArray(extra) || typeof extra !== 'object')
    throw new Error('补充信息需要是 JSON 对象')
  if (extra.resources != null && !Array.isArray(extra.resources))
    throw new Error('原有 resources 不是列表，请先在原文编辑中检查')
  const resources = [...(extra.resources ?? [])]
  const entry = { ...resource, name: resource.name.trim() }
  const index = resources.findIndex(
    (item) =>
      item?.type === entry.type && String(item?.name).toLowerCase() === entry.name.toLowerCase()
  )
  if (index < 0) resources.push(entry)
  else resources[index] = { ...resources[index], ...entry }
  draft.extra = JSON.stringify({ ...extra, resources })
  return writeGenerationDraft(draft)
}

/** Vue number inputs emit numbers when valid, and an empty string when cleared. */
export function parseResourceWeight(value: string | number): number | undefined {
  if (typeof value === 'string' && !value.trim()) return undefined
  const weight = Number(value)
  if (!Number.isFinite(weight)) throw new Error('权重必须是有效数字')
  return weight
}
