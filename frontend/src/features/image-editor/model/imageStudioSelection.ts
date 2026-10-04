import {
  createStudioGroup,
  moveStudioLayersToGroup,
  studioLayerLocked,
  type StudioDocument,
  type StudioLayer
} from './imageStudioModel.ts'

/** Groups and clipping frames select their complete contents, including hidden members. */
export function studioSelectionIds(
  doc: StudioDocument,
  layerIds: string[],
  groupIds: string[] = []
) {
  const ids = new Set(layerIds)
  for (const layer of doc.layers)
    if (layer.groupId && groupIds.includes(layer.groupId)) ids.add(layer.id)
  const frames = new Set(
    doc.layers
      .filter((layer) => layer.kind === 'frame' && ids.has(layer.id))
      .map((layer) => layer.id)
  )
  return doc.layers
    .filter((layer) => ids.has(layer.id) || (layer.frameId && frames.has(layer.frameId)))
    .map((layer) => layer.id)
}

export function regroupStudioSelection(
  doc: StudioDocument,
  layerIds: string[],
  groupIds: string[],
  name: string
) {
  const ids = studioSelectionIds(doc, layerIds, groupIds)
  if (
    doc.groups.some((g) => groupIds.includes(g.id) && g.locked) ||
    doc.layers.some((l) => ids.includes(l.id) && studioLayerLocked(doc, l))
  )
    return { document: doc, groupId: '' }
  const group = createStudioGroup(name)
  const staged = { ...doc, groups: [...doc.groups, group] }
  const result = moveStudioLayersToGroup(staged, ids, group.id)
  const affected = new Set([
    ...groupIds,
    ...doc.layers.filter((l) => ids.includes(l.id)).map((l) => l.groupId)
  ])
  result.layers = result.layers.map((layer) => {
    if (!ids.includes(layer.id)) return layer
    const original = doc.layers.find((l) => l.id === layer.id)
    if (!original) return layer
    return {
      ...layer,
      visible:
        original.visible && doc.groups.find((g) => g.id === original.groupId)?.visible !== false,
      ...(original.frameId && ids.includes(original.frameId) ? { frameId: original.frameId } : {})
    }
  })
  result.groups = result.groups.filter(
    (g) => !affected.has(g.id) || result.layers.some((l) => l.groupId === g.id)
  )
  return { document: result, groupId: group.id }
}

export function deleteStudioSelection(doc: StudioDocument, layerIds: string[], groupIds: string[]) {
  const ids = new Set(studioSelectionIds(doc, layerIds, groupIds))
  if (
    doc.groups.some((g) => groupIds.includes(g.id) && g.locked) ||
    doc.layers.some((l) => ids.has(l.id) && studioLayerLocked(doc, l))
  )
    return doc
  const layers = doc.layers.filter((l) => !ids.has(l.id))
  const affected = new Set(doc.layers.filter((l) => ids.has(l.id)).map((l) => l.groupId))
  return {
    ...doc,
    layers,
    groups: doc.groups.filter(
      (g) =>
        !groupIds.includes(g.id) && (!affected.has(g.id) || layers.some((l) => l.groupId === g.id))
    )
  }
}

export function moveStudioSelection(doc: StudioDocument, ids: string[], dx: number, dy: number) {
  const selected = new Set(studioSelectionIds(doc, ids))
  if (doc.layers.some((l) => selected.has(l.id) && studioLayerLocked(doc, l))) return doc
  return {
    ...doc,
    layers: doc.layers.map((l) => (selected.has(l.id) ? { ...l, x: l.x + dx, y: l.y + dy } : l))
  }
}

/** Duplicate every selected layer in place, or a whole group as a new group. */
export function duplicateStudioSelection(
  doc: StudioDocument,
  layerIds: string[],
  groupId?: string
) {
  const group = doc.groups.find((item) => item.id === groupId)
  const selected = new Set(layerIds)
  for (const layer of doc.layers)
    if (
      layer.frameId &&
      (selected.has(layer.frameId) ||
        (doc.layers.find((frame) => frame.id === layer.frameId)?.groupId === group?.id && !!group))
    )
      selected.add(layer.id)
  const members = doc.layers.filter(
    (layer) => (group && layer.groupId === group.id) || selected.has(layer.id)
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
        groupId: copiedGroup && layer.groupId === group?.id ? copiedGroup.id : layer.groupId
      }
    ])
  )
  const frameGroups = new Map<string, string>()
  for (const layer of members) {
    const copy = copies.get(layer.id)
    if (!copy) continue
    if (layer.frameId && copies.has(layer.frameId)) {
      copy.frameId = copies.get(layer.frameId)?.id
      if (layer.groupId && layer.groupId !== group?.id) {
        if (!frameGroups.has(layer.groupId)) frameGroups.set(layer.groupId, crypto.randomUUID())
        copy.groupId = frameGroups.get(layer.groupId)
      }
    }
  }
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
    document: {
      ...doc,
      layers,
      groups: [
        ...groups,
        ...doc.groups
          .filter((g) => frameGroups.has(g.id))
          .map((g) => ({ ...g, id: frameGroups.get(g.id) || g.id }))
      ]
    },
    layerIds: [...copies.values()]
      .filter(
        (layer) => !layer.frameId || ![...copies.values()].some((f) => f.id === layer.frameId)
      )
      .map((layer) => layer.id),
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
