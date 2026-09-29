import {
  scaleStudioDocument,
  type StudioDocument
} from '../../image-editor/model/imageStudioModel.ts'
import type { TransformFrame, TransformSize } from '../../image-editor/model/imageTransform.ts'

/** Crop the complete AI input, including annotations and transparent padding, without flattening. */
export function cropAIInputDocument(
  doc: StudioDocument,
  crop: TransformFrame,
  output: TransformSize
): StudioDocument {
  const result = structuredClone(doc)
  result.width = crop.width
  result.height = crop.height
  for (const layer of result.layers) {
    layer.x -= crop.x
    layer.y -= crop.y
  }
  return scaleStudioDocument(result, output.width, output.height)
}
