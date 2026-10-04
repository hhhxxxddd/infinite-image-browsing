import { useSyncExternalStore } from 'react'
import type { StudioDocument } from '../../../src/features/image-editor/model/imageStudioModel'
import { studioLayerVisible } from '../../../src/features/image-editor/model/imageStudioModel'
import type { ImageTransformPreview } from './imageTransformPreviewStore'
import './ImageProcessingOverlay.css'

export default function ImageProcessingOverlay({
  document,
  preview,
  layerIds,
  labels
}: {
  document: StudioDocument
  preview: ImageTransformPreview
  layerIds: string[]
  labels: Record<string, string>
}) {
  const doc = useSyncExternalStore(preview.subscribe, () => preview.document(document))
  return (
    <>
      {doc.layers
        .filter((layer) => layerIds.includes(layer.id) && studioLayerVisible(doc, layer))
        .map((layer) => (
          <div
            key={layer.id}
            className="react-image-processing-overlay"
            role="status"
            aria-label={`${layer.name}：${labels[layer.id]}`}
            style={{
              left: `${(layer.x / doc.width) * 100}%`,
              top: `${(layer.y / doc.height) * 100}%`,
              width: `${(layer.width / doc.width) * 100}%`,
              height: `${(layer.height / doc.height) * 100}%`,
              transform: `rotate(${layer.rotation}deg)`
            }}
          >
            <span>{labels[layer.id]}</span>
          </div>
        ))}
    </>
  )
}
