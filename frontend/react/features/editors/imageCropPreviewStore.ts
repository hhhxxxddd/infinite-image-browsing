import type { StudioFrame } from '../../../src/features/image-editor/model/imageStudioModel'

/** Share the current crop gesture with its dimension inputs without redrawing the editor shell. */
export function createImageCropPreview() {
  let preview: { original: StudioFrame; frame: StudioFrame } | undefined
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const listener of listeners) listener()
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    frame(original: StudioFrame) {
      return preview?.original === original ? preview.frame : original
    },
    publish(original: StudioFrame, frame: StudioFrame) {
      if (preview?.original === original && preview.frame === frame) return
      preview = { original, frame }
      notify()
    },
    clear() {
      if (!preview) return
      preview = undefined
      notify()
    }
  }
}

export type ImageCropPreview = ReturnType<typeof createImageCropPreview>
