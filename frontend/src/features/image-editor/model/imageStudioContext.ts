import {
  studioLayerLocked,
  studioLayerVisible,
  type StudioDocument,
  type StudioLayer,
  type StudioPoint
} from './imageStudioModel.ts'
import { studioFrameContainsPoint } from './imageStudioGeometry.ts'
import { studioFrameOrder, studioVectorContains } from './imageStudioVectors.ts'
import { studioSelectionIds } from './imageStudioSelection.ts'

export type StudioMenuSelection = { layerIds: string[]; groupIds: string[] }
export type StudioMenuTarget = { kind: 'layer' | 'group'; id: string }

/** Hit the actual content, respecting clipping, rotation and visibility. */
export function studioContextHits(doc: StudioDocument, point: StudioPoint) {
  if (point.x < 0 || point.y < 0 || point.x > doc.width || point.y > doc.height) return []
  return studioFrameOrder(doc)
    .reverse()
    .filter((layer) => {
      if (!studioLayerVisible(doc, layer)) return false
      const frame = doc.layers.find((f) => f.id === layer.frameId && f.kind === 'frame')
      if (frame?.kind === 'frame' && !studioVectorContains(frame, point)) return false
      return layer.kind === 'frame' || layer.kind === 'shape'
        ? studioVectorContains(layer, point)
        : studioFrameContainsPoint(layer, point)
    })
}

export function studioContextTargets(doc: StudioDocument, hits: StudioLayer[]) {
  const targets: StudioMenuTarget[] = []
  const add = (target: StudioMenuTarget) => {
    if (!targets.some((item) => item.kind === target.kind && item.id === target.id))
      targets.push(target)
  }
  for (const hit of hits) {
    const frame = doc.layers.find((layer) => layer.id === hit.frameId)
    if (frame?.groupId) add({ kind: 'group', id: frame.groupId })
    if (frame) add({ kind: 'layer', id: frame.id })
    if (hit.groupId) add({ kind: 'group', id: hit.groupId })
    add({ kind: 'layer', id: hit.id })
  }
  return targets
}

/** A right click on any selected content keeps the whole mixed selection. */
export function studioContextSelection(
  doc: StudioDocument,
  selection: StudioMenuSelection,
  target?: StudioMenuTarget,
  canvas = false,
  enterMember = false
): StudioMenuSelection {
  if (!target) return { layerIds: [], groupIds: [] }
  if (
    !enterMember &&
    (target.kind === 'group'
      ? selection.groupIds.includes(target.id)
      : (canvas
          ? studioSelectionIds(doc, selection.layerIds, selection.groupIds)
          : selection.layerIds
        ).includes(target.id))
  )
    return selection
  if (target.kind === 'group') return { layerIds: [], groupIds: [target.id] }
  let layer = doc.layers.find((item) => item.id === target.id)
  if (!layer) return { layerIds: [], groupIds: [] }
  if (canvas && !enterMember) {
    layer = doc.layers.find((item) => item.id === layer?.frameId) || layer
    if (layer.groupId) return { layerIds: [], groupIds: [layer.groupId] }
  }
  return { layerIds: [layer.id], groupIds: [] }
}

/** Only locks affecting this selection; never unlock unrelated document content. */
export function studioContextLocks(doc: StudioDocument, selection: StudioMenuSelection) {
  const layers = new Set<string>()
  const groups = new Set<string>()
  const visit = (layer: StudioLayer) => {
    if (layer.locked) layers.add(layer.id)
    if (layer.groupId && doc.groups.some((g) => g.id === layer.groupId && g.locked))
      groups.add(layer.groupId)
  }
  for (const id of selection.groupIds)
    if (doc.groups.some((g) => g.id === id && g.locked)) groups.add(id)
  for (const id of studioSelectionIds(doc, selection.layerIds, selection.groupIds)) {
    const layer = doc.layers.find((l) => l.id === id)
    if (!layer) continue
    visit(layer)
    const frame = doc.layers.find((l) => l.id === layer.frameId)
    if (frame) visit(frame)
  }
  return { layerIds: [...layers], groupIds: [...groups] }
}

export function duplicateStudioItems(doc: StudioDocument, selection: StudioMenuSelection) {
  const ids = new Set(studioSelectionIds(doc, selection.layerIds, selection.groupIds))
  const groups = new Set(selection.groupIds)
  for (const layer of doc.layers)
    if (layer.frameId && ids.has(layer.frameId) && layer.groupId) groups.add(layer.groupId)
  const groupMap = new Map(
    doc.groups.filter((g) => groups.has(g.id)).map((g) => [g.id, crypto.randomUUID()])
  )
  const layerMap = new Map(
    doc.layers.filter((l) => ids.has(l.id)).map((l) => [l.id, crypto.randomUUID()])
  )
  if (!groupMap.size && !layerMap.size) return { document: doc, ...selection }
  const copies = doc.layers
    .filter((l) => ids.has(l.id))
    .map((layer) => ({
      ...structuredClone(layer),
      id: layerMap.get(layer.id) || layer.id,
      name: `${layer.name} 副本`,
      x: layer.x + 24,
      y: layer.y + 24,
      groupId: groupMap.get(layer.groupId || '') || layer.groupId,
      frameId: layerMap.get(layer.frameId || '') || layer.frameId
    }))
  // A partial group copy belongs next to its source, not above unrelated root layers.
  const inline = new Map(
    doc.layers
      .filter(
        (l) =>
          ids.has(l.id) &&
          l.groupId &&
          !groupMap.has(l.groupId) &&
          (!l.frameId || !layerMap.has(l.frameId))
      )
      .map((l) => [l.id, copies.find((copy) => copy.id === layerMap.get(l.id))])
  )
  const inlineIds = new Set([...inline.values()].map((l) => l?.id))
  const layers = [
    ...doc.layers.flatMap((layer) => {
      const copy = inline.get(layer.id)
      return copy ? [layer, copy] : [layer]
    }),
    ...copies.filter((layer) => !inlineIds.has(layer.id))
  ]
  return {
    document: {
      ...doc,
      layers,
      groups: [
        ...doc.groups.map((g) =>
          g.stackIndex === undefined
            ? g
            : {
                ...g,
                stackIndex:
                  g.stackIndex +
                  doc.layers.slice(0, g.stackIndex).filter((l) => inline.has(l.id)).length
              }
        ),
        ...doc.groups
          .filter((g) => groupMap.has(g.id))
          .map((g) => ({
            ...g,
            id: groupMap.get(g.id) || g.id,
            name: `${g.name} 副本`,
            stackIndex: layers.length
          }))
      ]
    },
    layerIds: selection.layerIds.flatMap((id) => layerMap.get(id) || []),
    groupIds: selection.groupIds.flatMap((id) => groupMap.get(id) || [])
  }
}

export type StudioOrder = 'up' | 'down' | 'top' | 'bottom'
type StackNode = { target: StudioMenuTarget; layer?: StudioLayer; children?: StackNode[] }

/** Sort sibling blocks without detaching layers from groups or clipping frames. */
export function orderStudioItems(
  doc: StudioDocument,
  selection: StudioMenuSelection,
  direction: StudioOrder
) {
  const ids = studioSelectionIds(doc, selection.layerIds, selection.groupIds)
  if (
    doc.layers.some((l) => ids.includes(l.id) && studioLayerLocked(doc, l)) ||
    doc.groups.some((g) => selection.groupIds.includes(g.id) && g.locked)
  )
    return doc
  const chosen = (node: StackNode) =>
    (node.target.kind === 'group' ? selection.groupIds : selection.layerIds).includes(
      node.target.id
    )
  const build = (frameId?: string): StackNode[] => {
    const nodes: StackNode[] = []
    const groups = new Map<string, StackNode>()
    for (const layer of doc.layers.filter((l) => l.frameId === frameId)) {
      const node: StackNode = {
        target: { kind: 'layer', id: layer.id },
        layer,
        children: layer.kind === 'frame' ? build(layer.id) : undefined
      }
      if (layer.groupId) {
        let group = groups.get(layer.groupId)
        if (!group) {
          group = { target: { kind: 'group', id: layer.groupId }, children: [] }
          groups.set(layer.groupId, group)
        } else nodes.splice(nodes.indexOf(group), 1)
        group.children?.push(node)
        nodes.push(group)
      } else nodes.push(node)
    }
    if (!frameId)
      for (const group of doc.groups.filter((g) => !doc.layers.some((l) => l.groupId === g.id))) {
        const at = nodes.findIndex(
          (n) =>
            doc.layers.findIndex((l) => l.id === (n.layer?.id || n.children?.at(-1)?.layer?.id)) >=
            (group.stackIndex ?? doc.layers.length)
        )
        nodes.splice(at < 0 ? nodes.length : at, 0, {
          target: { kind: 'group', id: group.id },
          children: []
        })
      }
    return nodes
  }
  let changed = false
  const sort = (nodes: StackNode[]): StackNode[] => {
    for (const node of nodes)
      if (!chosen(node) && node.children) node.children = sort(node.children)
    const result = [...nodes]
    if (direction === 'top' || direction === 'bottom') {
      const picked = nodes.filter(chosen),
        rest = nodes.filter((n) => !chosen(n))
      result.splice(
        0,
        result.length,
        ...(direction === 'top' ? [...rest, ...picked] : [...picked, ...rest])
      )
    } else if (direction === 'up') {
      for (let i = result.length - 2; i >= 0; i--)
        if (chosen(result[i]) && !chosen(result[i + 1]))
          [result[i], result[i + 1]] = [result[i + 1], result[i]]
    } else {
      for (let i = 1; i < result.length; i++)
        if (chosen(result[i]) && !chosen(result[i - 1]))
          [result[i], result[i - 1]] = [result[i - 1], result[i]]
    }
    if (nodes.some((node, i) => node !== result[i])) changed = true
    return result
  }
  const tree = sort(build())
  if (!changed) return doc
  const layers: StudioLayer[] = [],
    emptyPositions = new Map<string, number>()
  const flatten = (nodes: StackNode[]) => {
    for (const node of nodes) {
      if (node.layer) layers.push(node.layer)
      if (node.target.kind === 'group' && !node.children?.length)
        emptyPositions.set(node.target.id, layers.length)
      if (node.children) flatten(node.children)
    }
  }
  flatten(tree)
  return {
    ...doc,
    layers,
    groups: doc.groups.map((g) =>
      emptyPositions.has(g.id) ? { ...g, stackIndex: emptyPositions.get(g.id) } : g
    )
  }
}
