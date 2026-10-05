import {
  readStudioDocument,
  type StudioDocument
} from '../../../src/features/image-editor/model/imageStudioModel.ts'

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[\w-]{1,80}$/.test(value)
const booleans = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => value[key] === undefined || typeof value[key] === 'boolean')
const numbers = (value: Record<string, unknown>, keys: string[]) =>
  keys.every((key) => value[key] === undefined || finite(value[key]))
const colors = (value: Record<string, unknown>, keys: string[], transparent = false) =>
  keys.every(
    (key) =>
      value[key] === undefined ||
      (transparent && value[key] === 'transparent') ||
      (typeof value[key] === 'string' && /^#[\da-f]{6}$/i.test(value[key]))
  )
const point = (value: unknown) =>
  object(value) &&
  finite(value.x) &&
  finite(value.y) &&
  value.x >= 0 &&
  value.x <= 1 &&
  value.y >= 0 &&
  value.y <= 1

/** Version recovery must not use the ordinary loader's damaged-layer repair behavior. */
export function readStudioVersionDocument(value: unknown, expectedId?: string): StudioDocument {
  const fail = (): never => {
    throw new Error('图片制作版本不完整或已损坏，未恢复任何内容')
  }
  if (
    !object(value) ||
    value.version !== 2 ||
    !identifier(value.id) ||
    (expectedId !== undefined && value.id !== expectedId) ||
    !finite(value.width) ||
    !finite(value.height) ||
    !Number.isInteger(value.width) ||
    !Number.isInteger(value.height) ||
    value.width < 1 ||
    value.width > 16384 ||
    value.height < 1 ||
    value.height > 16384 ||
    !Array.isArray(value.layers) ||
    (value.groups !== undefined && !Array.isArray(value.groups)) ||
    !colors(value, ['background'], true) ||
    (value.backgroundView !== undefined &&
      !['checkerboard', 'plain'].includes(value.backgroundView as string))
  )
    return fail()
  const layers = value.layers
  const groups = value.groups ?? []
  if (!Array.isArray(groups)) return fail()
  const groupIds = new Set<string>()
  for (const group of groups) {
    if (
      !object(group) ||
      !identifier(group.id) ||
      groupIds.has(group.id) ||
      (group.name !== undefined && typeof group.name !== 'string') ||
      !booleans(group, ['visible', 'locked', 'collapsed']) ||
      !numbers(group, ['stackIndex'])
    )
      return fail()
    groupIds.add(group.id)
  }
  const ids = new Set<string>()
  const frameIds = new Set(
    layers.flatMap((layer) =>
      object(layer) && layer.kind === 'frame' && identifier(layer.id) ? [layer.id] : []
    )
  )
  for (const layer of layers) {
    if (
      !object(layer) ||
      !identifier(layer.id) ||
      ids.has(layer.id) ||
      !['image', 'text', 'guide', 'mask', 'paint', 'frame', 'shape'].includes(
        layer.kind as string
      ) ||
      !['x', 'y', 'width', 'height', 'rotation', 'opacity'].every((key) => finite(layer[key])) ||
      (layer.width as number) <= 0 ||
      (layer.height as number) <= 0 ||
      !booleans(layer, ['visible', 'locked', 'flipX', 'flipY']) ||
      !colors(layer, ['color', 'stroke']) ||
      !colors(layer, ['fill'], true) ||
      !numbers(layer, ['strokeWidth', 'radius']) ||
      (layer.name !== undefined && typeof layer.name !== 'string') ||
      (layer.groupId !== undefined && !groupIds.has(layer.groupId as string)) ||
      (layer.frameId !== undefined && !frameIds.has(layer.frameId as string))
    )
      return fail()
    ids.add(layer.id)
    if (layer.kind === 'image') {
      if (
        typeof layer.path !== 'string' ||
        layer.path.length > 2048 ||
        !numbers(layer, ['zoom', 'focusX', 'focusY', 'brightness', 'contrast', 'radius']) ||
        (layer.fit !== undefined && !['cover', 'contain', 'stretch'].includes(layer.fit as string))
      )
        return fail()
      const crop = layer.crop
      if (
        crop !== undefined &&
        (!object(crop) ||
          !['x', 'y', 'width', 'height'].every((key) => finite(crop[key])) ||
          (crop.width as number) <= 0 ||
          (crop.height as number) <= 0)
      )
        return fail()
      if (
        layer.correction !== undefined &&
        (!object(layer.correction) ||
          !numbers(layer.correction, ['horizontal', 'vertical', 'center', 'rotation']))
      )
        return fail()
    }
    if (layer.kind === 'text') {
      if (
        typeof layer.text !== 'string' ||
        !booleans(layer, ['bold', 'italic', 'underline', 'strike']) ||
        !numbers(layer, ['fontSize', 'lineHeight', 'letterSpacing']) ||
        (layer.align !== undefined && !['left', 'center', 'right'].includes(layer.align as string))
      )
        return fail()
      if (layer.effects !== undefined) {
        if (!object(layer.effects)) return fail()
        for (const kind of ['fill', 'stroke', 'shadow', 'glow', 'background']) {
          const effect = layer.effects[kind]
          if (
            effect !== undefined &&
            (!object(effect) ||
              !booleans(effect, ['enabled']) ||
              !colors(effect, ['color', 'endColor']) ||
              !numbers(effect, [
                'angle',
                'width',
                'distance',
                'blur',
                'range',
                'radius',
                'opacity'
              ]) ||
              (effect.mode !== undefined && !['solid', 'gradient'].includes(effect.mode as string)))
          )
            return fail()
        }
      }
    }
    if (
      (layer.kind === 'guide' || layer.kind === 'paint') &&
      layer.prompt !== undefined &&
      typeof layer.prompt !== 'string'
    )
      return fail()
    if (layer.kind === 'guide' && !['rect', 'arrow'].includes(layer.shape as string)) return fail()
    if (layer.kind === 'paint' || layer.kind === 'mask') {
      if (!Array.isArray(layer.strokes)) return fail()
      for (const stroke of layer.strokes) {
        if (
          !object(stroke) ||
          !['paint', 'erase'].includes(stroke.mode as string) ||
          !finite(stroke.size) ||
          stroke.size <= 0 ||
          !Array.isArray(stroke.points) ||
          !stroke.points.length ||
          !stroke.points.every(point)
        )
          return fail()
      }
    }
    if (
      (layer.kind === 'shape' || layer.kind === 'frame') &&
      ((layer.points !== undefined &&
        (!Array.isArray(layer.points) ||
          layer.points.length !== 4 ||
          !layer.points.every(point))) ||
        (layer.shape !== undefined &&
          ![
            'rect',
            'ellipse',
            'polygon',
            ...(layer.kind === 'shape' ? ['speech', 'thought', 'burst'] : [])
          ].includes(layer.shape as string)) ||
        (layer.tail !== undefined && !point(layer.tail)) ||
        (layer.kind === 'frame' && layer.frameId !== undefined))
    )
      return fail()
  }
  const parsed = readStudioDocument(value)
  if (
    !parsed ||
    parsed.id !== value.id ||
    parsed.layers.length !== layers.length ||
    parsed.groups.length !== groups.length ||
    parsed.layers.some(
      (layer, index) => layer.id !== layers[index].id || layer.kind !== layers[index].kind
    )
  )
    return fail()
  for (let index = 0; index < layers.length; index++) {
    const source = layers[index]
    const layer = parsed.layers[index]
    // The loader caps stroke/point counts. A version must never silently lose painted content.
    if (
      (layer.kind === 'paint' || layer.kind === 'mask') &&
      (layer.strokes.length !== source.strokes.length ||
        layer.strokes.some(
          (stroke, strokeIndex) =>
            stroke.points.length !== source.strokes[strokeIndex].points.length
        ))
    )
      return fail()
  }
  return parsed
}
