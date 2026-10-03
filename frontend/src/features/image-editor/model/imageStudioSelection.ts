import { studioLayerLocked, type StudioDocument, type StudioLayer } from './imageStudioModel.ts'

/** Duplicate every selected layer in place, or a whole group as a new group. */
export function duplicateStudioSelection(
  doc: StudioDocument,
  layerIds: string[],
  groupId?: string
) {
  const group = doc.groups.find((item) => item.id === groupId)
  const selected = new Set(layerIds)
  const members = doc.layers.filter((layer) =>
    group ? layer.groupId === group.id : selected.has(layer.id)
  )
  if (!group && !members.length) return { document: doc, layerIds: [], groupId: undefined }
  const copiedGroup = group
    ? {
        ...group,
        id: crypto.randomUUID(),
        name: `${group.name} 副本`,
        stackIndex: doc.layers.length
      }
    : undefined
  const copies = new Map<string, StudioLayer>(
    members.map((layer) => [
      layer.id,
      {
        ...structuredClone(layer),
        id: crypto.randomUUID(),
        name: `${layer.name} 副本`,
        x: layer.x + 24,
        y: layer.y + 24,
        groupId: copiedGroup?.id ?? layer.groupId
      }
    ])
  )
  const layers = copiedGroup
    ? [...doc.layers, ...copies.values()]
    : doc.layers.flatMap((layer) => {
        const copy = copies.get(layer.id)
        return copy ? [layer, copy] : [layer]
      })
  const groups = copiedGroup
    ? [...doc.groups, copiedGroup]
    : doc.groups.map((item) =>
        item.stackIndex === undefined
          ? item
          : {
              ...item,
              stackIndex:
                item.stackIndex +
                doc.layers.slice(0, item.stackIndex).filter((layer) => copies.has(layer.id)).length
            }
      )
  return {
    document: { ...doc, layers, groups },
    layerIds: [...copies.values()].map((layer) => layer.id),
    groupId: copiedGroup?.id
  }
}

/** Group children move within their parent; root layers move around whole group blocks. */
export function orderStudioSelection(
  doc: StudioDocument,
  layerIds: string[],
  edge: 'top' | 'bottom'
) {
  const selected = new Set(layerIds)
  const moving = doc.layers.filter((layer) => selected.has(layer.id))
  if (!moving.length || moving.some((layer) => studioLayerLocked(doc, layer))) return doc
  let layers = doc.layers
  for (const groupId of new Set(moving.map((layer) => layer.groupId).filter(Boolean))) {
    const members = layers.filter((layer) => layer.groupId === groupId)
    const picked = members.filter((layer) => selected.has(layer.id))
    const rest = members.filter((layer) => !selected.has(layer.id))
    const ordered = edge === 'top' ? [...rest, ...picked] : [...picked, ...rest]
    let index = 0
    layers = layers.map((layer) => (layer.groupId === groupId ? ordered[index++] : layer))
  }
  const root = moving.filter((layer) => !layer.groupId)
  const rest = layers.filter((layer) => layer.groupId || !selected.has(layer.id))
  layers = edge === 'top' ? [...rest, ...root] : [...root, ...rest]
  if (layers.every((layer, index) => layer === doc.layers[index])) return doc
  return { ...doc, layers }
}
