import type {
  StudioDocument,
  StudioLayer
} from '../../../src/features/image-editor/model/imageStudioModel'

/** Gesture frames are shared by the canvas and inspector without updating the editor shell. */
export function createImageTransformPreview() {
  let frame: { original: StudioDocument; document: StudioDocument } | undefined
  const listeners = new Set<() => void>()
  function notify() {
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    document(original: StudioDocument): StudioDocument {
      return frame?.original === original ? frame.document : original
    },
    layer(original: StudioLayer): StudioLayer {
      if (frame?.original.layers.find((layer) => layer.id === original.id) !== original)
        return original
      return frame.document.layers.find((layer) => layer.id === original.id) ?? original
    },
    publish(original: StudioDocument, document: StudioDocument) {
      if (frame?.original === original && frame.document === document) return
      frame = { original, document }
      notify()
    },
    clear() {
      if (!frame) return
      frame = undefined
      notify()
    }
  }
}

export type ImageTransformPreview = ReturnType<typeof createImageTransformPreview>
