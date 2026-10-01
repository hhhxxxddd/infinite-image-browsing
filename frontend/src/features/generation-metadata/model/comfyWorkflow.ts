type ObjectValue = Record<string, unknown>
const objectValue = (value: unknown): value is ObjectValue =>
  !!value && typeof value === 'object' && !Array.isArray(value)

export interface ComfyWorkflow {
  nodeCount: number
  json: string
}

/** Prefer an editable ComfyUI graph over its API execution prompt, but expose both read-only. */
export function findComfyWorkflow(...sources: unknown[]): ComfyWorkflow | undefined {
  const queue = sources.map((value) => ({ value, depth: 0 }))
  const seen = new Set<object>()
  let apiGraph: ComfyWorkflow | undefined
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const entry = queue[cursor]
    let value = entry.value
    if (typeof value === 'string') {
      const text = value.trim().replace(/^(?:workflow|prompt):\s*/i, '')
      if (!text.startsWith('{')) continue
      try {
        value = JSON.parse(text)
      } catch {
        continue
      }
    }
    if (!objectValue(value) || seen.has(value)) continue
    seen.add(value)
    if (
      Array.isArray(value.nodes) &&
      value.nodes.length > 0 &&
      value.nodes.every(
        (node) =>
          objectValue(node) &&
          (typeof node.id === 'number' || typeof node.id === 'string') &&
          typeof node.type === 'string'
      ) &&
      (Array.isArray(value.links) || 'last_node_id' in value || 'version' in value)
    ) {
      return {
        nodeCount: value.nodes.length,
        get json() {
          return JSON.stringify(value, null, 2)
        }
      }
    }
    const nodes = Object.entries(value)
    if (
      !apiGraph &&
      nodes.length > 0 &&
      nodes.every(
        ([id, node]) =>
          /^\d+$/.test(id) &&
          objectValue(node) &&
          typeof node.class_type === 'string' &&
          objectValue(node.inputs)
      )
    ) {
      apiGraph = {
        nodeCount: nodes.length,
        get json() {
          return JSON.stringify(value, null, 2)
        }
      }
    }
    if (entry.depth >= 5) continue
    for (const [key, child] of Object.entries(value)) {
      // EXIF descriptions can carry a prefixed JSON workflow as well as named metadata fields.
      if (
        /^(?:workflow|prompt|extra_pnginfo|extraJsonMetaInfo|metadata|ImageDescription|UserComment|parameters)$/i.test(
          key
        ) ||
        (typeof child === 'string' && /^\s*(?:workflow|prompt):\s*\{/i.test(child))
      ) {
        queue.push({ value: child, depth: entry.depth + 1 })
      }
    }
  }
  return apiGraph
}
