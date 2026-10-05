import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  IconCheck,
  IconX,
  IconArrowsMove,
  IconAlignLeft,
  IconAlignCenter,
  IconAlignRight,
  IconArrowBarUp,
  IconArrowBarDown,
  IconArrowsVertical,
  IconRestore
} from '@tabler/icons-react'
import {
  bounded,
  captionStyle,
  type Caption,
  type VideoClip,
  type VideoTimelineDocument,
  type VideoTransform
} from './videoStudioModel'
import {
  stageAlignTransform,
  stageBounds,
  stageCanEdit,
  stageGestureCanContinue,
  stageCaptionRects,
  stageClipGeometry,
  stageCropImageRect,
  stageCropRect,
  stageEditCrop,
  stageGestureResult,
  stageHitClip,
  stageHitRect,
  stageMoveCaption,
  stageMoveTransform,
  stagePatchTransform,
  stageRectCorners,
  stageResizeTransform,
  stageRotateTransform,
  stageToolsRect,
  stageViewportPoint,
  stageWorldToLocal,
  type StageAlignment,
  type StageClipGeometry,
  type StageGuide,
  type StagePoint,
  type StageRect
} from './videoStageInteraction'
import './VideoStage.css'
import { videoCaptionLines } from './videoCaptionLayout'
import {
  applyLocalVideoEffects,
  hasLocalVideoEffects,
  localRegionCoverage
} from './videoLocalEffects'

interface StageSource {
  source: CanvasImageSource
  width: number
  height: number
}
interface CropEditor {
  clip: VideoClip
  crop: VideoTransform['crop']
}
type StageDrag = { pointerId: number; start: StagePoint; changed: boolean; time: number } & (
  | {
      kind: 'move' | 'resize' | 'rotate'
      original: VideoClip
      latest: VideoClip
      geometry: StageClipGeometry
      corner?: number
    }
  | { kind: 'caption'; original: Caption; latest: Caption }
  | { kind: 'crop'; original: CropEditor; image: StageRect; corner?: number }
)
const points = (values: readonly StagePoint[]) => values.map((p) => `${p.x},${p.y}`).join(' ')
const alignmentTools = [
  ['left', '左对齐', IconAlignLeft],
  ['center', '水平居中', IconAlignCenter],
  ['right', '右对齐', IconAlignRight],
  ['top', '顶端对齐', IconArrowBarUp],
  ['middle', '垂直居中', IconArrowsVertical],
  ['bottom', '底端对齐', IconArrowBarDown]
] as const

/** Preview and hit testing share export coordinates. Alpha hits sample only one pixel from the current frame. */
export default function VideoStage({
  doc,
  clips,
  captions,
  time,
  playing,
  videos,
  url,
  onSelect,
  selectedId,
  readonly = false,
  onChangeClip,
  onChangeCaption,
  onSelectCaption,
  onInteractionStart,
  onInteractionEnd,
  showSafeArea = false,
  onEditingFrame,
  cropRequest
}: {
  doc: VideoTimelineDocument
  clips: VideoClip[]
  captions: Caption[]
  time: number
  playing: boolean
  videos: Record<string, HTMLVideoElement | null>
  url: (clip: VideoClip) => string
  onSelect: (id: string) => void
  selectedId?: string
  readonly?: boolean
  onChangeClip?: (clip: VideoClip) => void
  onChangeCaption?: (caption: Caption) => void
  onSelectCaption?: (id: string) => void
  onInteractionStart?: () => void
  onInteractionEnd?: (cancelled?: boolean) => void
  showSafeArea?: boolean
  onEditingFrame?: (frame: HTMLCanvasElement | null) => void
  cropRequest?: { clipId: string; sequence: number } | null
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    wrapper = useRef<HTMLDivElement>(null)
  const images = useRef(new Map<string, HTMLImageElement>()),
    sources = useRef(new Map<string, StageSource>())
  const alphaCanvas = useRef<HTMLCanvasElement | null>(null),
    drag = useRef<StageDrag | null>(null)
  const localPlane = useRef<HTMLCanvasElement | null>(null)
  const [, setMediaRevision] = useState(0),
    [displayScale, setDisplayScale] = useState(1)
  const [viewport, setViewport] = useState({ width: 0, height: 0 })
  const [guides, setGuides] = useState<StageGuide[]>([]),
    [cropEditor, setCropEditor] = useState<CropEditor | null>(null)
  const [showAlign, setShowAlign] = useState(false)
  const current = useRef({
    doc,
    clips,
    captions,
    time,
    playing,
    videos,
    url,
    cropEditor,
    readonly,
    onChangeClip,
    onChangeCaption,
    onInteractionEnd,
    selectedId,
    onEditingFrame
  })
  current.current = {
    doc,
    clips,
    captions,
    time,
    playing,
    videos,
    url,
    cropEditor,
    readonly,
    onChangeClip,
    onChangeCaption,
    onInteractionEnd,
    selectedId,
    onEditingFrame
  }
  useEffect(() => {
    const node = wrapper.current
    if (!node) return
    const observer = new ResizeObserver(() => {
      const rect = node.getBoundingClientRect()
      setDisplayScale(Math.max(0.001, Math.min(rect.width / doc.width, rect.height / doc.height)))
      setViewport({ width: rect.width, height: rect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [doc.width, doc.height])
  useEffect(() => {
    let frame = 0,
      active = true,
      previousDoc: VideoTimelineDocument | undefined
    let previousTime = -1,
      previousMedia = '',
      imageRevision = 0,
      previousDimensions = ''
    let previousCrop: CropEditor | null | undefined
    let editingStamp = ''
    const draw = () => {
      const node = canvas.current,
        ctx = node?.getContext('2d')
      if (!node || !ctx) return
      const {
        doc,
        clips,
        captions,
        time,
        videos,
        url,
        cropEditor,
        selectedId,
        playing,
        onEditingFrame
      } = current.current
      const mediaStamp =
        clips
          .map((c) => `${c.id}:${videos[c.id]?.readyState}:${videos[c.id]?.currentTime}`)
          .join('|') +
        ':' +
        imageRevision +
        ':' +
        selectedId +
        ':' +
        playing
      if (
        previousDoc === doc &&
        previousTime === time &&
        previousMedia === mediaStamp &&
        previousCrop === cropEditor
      ) {
        frame = requestAnimationFrame(draw)
        return
      }
      previousDoc = doc
      previousTime = time
      previousMedia = mediaStamp
      previousCrop = cropEditor
      const ratio = Math.min(1, 1280 / doc.width, 720 / doc.height),
        w = Math.round(doc.width * ratio),
        h = Math.round(doc.height * ratio)
      if (node.width !== w || node.height !== h) {
        node.width = w
        node.height = h
      }
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      sources.current.clear()
      for (const clip of clips) {
        if (clip.kind === 'image') {
          const src = url(clip)
          let image = images.current.get(src)
          if (!image) {
            image = new Image()
            image.onload = () => {
              imageRevision++
              if (active) setMediaRevision((value) => value + 1)
            }
            image.src = src
            images.current.set(src, image)
            if (images.current.size > 64)
              images.current.delete(images.current.keys().next().value ?? '')
          }
          if (image.complete && image.naturalWidth)
            sources.current.set(clip.id, {
              source: image,
              width: image.naturalWidth,
              height: image.naturalHeight
            })
        } else {
          const video = videos[clip.id]
          if (video && video.readyState >= 2 && video.videoWidth)
            sources.current.set(clip.id, {
              source: video,
              width: video.videoWidth,
              height: video.videoHeight
            })
        }
      }
      const dimensions = [...sources.current]
        .map(([id, source]) => `${id}:${source.width}:${source.height}`)
        .join('|')
      if (dimensions !== previousDimensions) {
        previousDimensions = dimensions
        setMediaRevision((value) => value + 1)
      }
      ctx.save()
      ctx.scale(w / doc.width, h / doc.height)
      const editingSource = cropEditor ? sources.current.get(cropEditor.clip.id) : undefined
      if (editingSource) {
        const source = editingSource,
          rect = stageCropImageRect(doc, source)
        ctx.drawImage(source.source, rect.x, rect.y, rect.width, rect.height)
      } else {
        for (const clip of clips) {
          const source = sources.current.get(clip.id)
          if (!source) continue
          const g = stageClipGeometry(doc, clip, time, source)
          if (!g) continue
          const t = g.transform,
            crop = t.crop,
            color = clip.color ?? { brightness: 0, contrast: 1, saturation: 1 }
          const needsFrame = !!onEditingFrame && selectedId === clip.id && !playing
          const hasEffects = hasLocalVideoEffects(clip.localEffects)
          let plane: HTMLCanvasElement | null = null
          if (needsFrame || hasEffects) {
            const planeRatio = Math.min(1, 640 / doc.width, 360 / doc.height),
              pw = Math.max(1, Math.round(doc.width * planeRatio)),
              ph = Math.max(1, Math.round(doc.height * planeRatio))
            plane = localPlane.current ?? (localPlane.current = document.createElement('canvas'))
            if (plane.width !== pw || plane.height !== ph) {
              plane.width = pw
              plane.height = ph
            }
            const local = plane.getContext('2d', { willReadFrequently: true })
            if (local) {
              local.clearRect(0, 0, pw, ph)
              local.save()
              local.scale(pw / doc.width, ph / doc.height)
              local.drawImage(
                source.source,
                source.width * crop.x,
                source.height * crop.y,
                source.width * crop.width,
                source.height * crop.height,
                (doc.width - g.drawn.width) / 2,
                (doc.height - g.drawn.height) / 2,
                g.drawn.width,
                g.drawn.height
              )
              local.restore()
              if (needsFrame) {
                const stamp = `${clip.id}:${clip.path}:${JSON.stringify(crop)}:${t.fit}:${time}:${source.width}:${source.height}:${videos[clip.id]?.currentTime}:${imageRevision}:${w}:${h}`
                if (stamp !== editingStamp) {
                  const snapshot = document.createElement('canvas')
                  snapshot.width = pw
                  snapshot.height = ph
                  snapshot.getContext('2d')?.drawImage(plane, 0, 0)
                  editingStamp = stamp
                  onEditingFrame?.(snapshot)
                }
              }
              if (hasEffects) {
                try {
                  applyLocalVideoEffects(plane, clip.localEffects)
                } catch {
                  /* Keep the current readable source if a preview frame is not yet available. */
                }
              }
            }
          }
          ctx.save()
          ctx.globalAlpha = Math.max(0, Math.min(1, t.opacity))
          ctx.translate(g.center.x, g.center.y)
          ctx.rotate((t.rotation * Math.PI) / 180)
          ctx.scale(t.scale * (t.flipX ? -1 : 1), t.scale * (t.flipY ? -1 : 1))
          ctx.beginPath()
          ctx.rect(-doc.width / 2, -doc.height / 2, doc.width, doc.height)
          ctx.clip()
          ctx.filter = `brightness(${1 + color.brightness}) contrast(${color.contrast}) saturate(${color.saturation})`
          if (plane && hasEffects)
            ctx.drawImage(plane, -doc.width / 2, -doc.height / 2, doc.width, doc.height)
          else
            ctx.drawImage(
              source.source,
              source.width * crop.x,
              source.height * crop.y,
              source.width * crop.width,
              source.height * crop.height,
              -g.drawn.width / 2,
              -g.drawn.height / 2,
              g.drawn.width,
              g.drawn.height
            )
          ctx.restore()
        }
        for (const cue of captions) {
          const s = captionStyle(cue),
            lines = videoCaptionLines(cue, doc.width, (text, font) => {
              ctx.save()
              ctx.font = font
              const width = ctx.measureText(text).width
              ctx.restore()
              return width
            }),
            lineHeight = s.fontSize * 1.2
          ctx.save()
          ctx.font = `${s.bold ? 'bold ' : ''}${s.fontSize}px ${s.fontFamily}`
          ctx.textAlign = s.align
          ctx.textBaseline = 'middle'
          const x = s.x * doc.width,
            y = s.y * doc.height
          lines.forEach((line, i) => {
            const yy = y + (i - (lines.length - 1) / 2) * lineHeight,
              width = ctx.measureText(line).width
            ctx.fillStyle = s.background
            ctx.fillRect(
              x - (s.align === 'center' ? width / 2 : s.align === 'right' ? width : 0) - 4,
              yy - lineHeight / 2,
              width + 8,
              lineHeight
            )
            if (s.outlineWidth) {
              ctx.strokeStyle = s.outlineColor
              ctx.lineWidth = s.outlineWidth * 2
              ctx.lineJoin = 'round'
              ctx.strokeText(line, x, yy)
            }
            ctx.fillStyle = s.color
            ctx.fillText(line, x, yy)
          })
          ctx.restore()
        }
      }
      ctx.restore()
      if (!playing && !sources.current.has(selectedId ?? '') && editingStamp) {
        editingStamp = ''
        onEditingFrame?.(null)
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      for (const image of images.current.values()) image.onload = null
    }
  }, [])
  const selectedClip = clips.find((clip) => clip.id === selectedId),
    selectedCaption = captions.find((cue) => cue.id === selectedId)
  const selectedSource = selectedClip ? sources.current.get(selectedClip.id) : undefined
  const geometry =
    selectedClip && selectedSource
      ? stageClipGeometry(doc, selectedClip, time, selectedSource)
      : null
  const clipEditable =
    !!selectedClip && !!onChangeClip && stageCanEdit(doc, selectedClip, readonly, playing)
  const captionEditable = !!selectedCaption && !!onChangeCaption && !readonly && !playing
  const measure = (text: string, font: string) => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return 0
    ctx.save()
    ctx.font = font
    const width = ctx.measureText(text).width
    ctx.restore()
    return width
  }
  const captionRects = selectedCaption ? stageCaptionRects(doc, selectedCaption, measure) : []
  const selection =
    geometry?.corners ??
    (captionRects.length
      ? stageRectCorners(stageBounds(captionRects.flatMap(stageRectCorners)))
      : [])
  const point = (event: { clientX: number; clientY: number }) => {
    const rect = wrapper.current?.getBoundingClientRect()
    if (!rect) return { x: -1, y: -1 }
    return stageViewportPoint(
      { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      doc,
      { x: event.clientX, y: event.clientY }
    )
  }
  const sampleAlpha = (source: StageSource, pixel: StagePoint) => {
    const node = alphaCanvas.current ?? (alphaCanvas.current = document.createElement('canvas'))
    node.width = 1
    node.height = 1
    const ctx = node.getContext('2d', { willReadFrequently: true })
    if (!ctx) return 1
    try {
      ctx.drawImage(
        source.source,
        Math.max(0, Math.min(source.width - 1, pixel.x)),
        Math.max(0, Math.min(source.height - 1, pixel.y)),
        1,
        1,
        0,
        0,
        1,
        1
      )
      return ctx.getImageData(0, 0, 1, 1).data[3] / 255
    } catch {
      return 1
    }
  }
  const finish = (cancelled = false, updateOverlay = true) => {
    const active = drag.current
    if (!active) return
    drag.current = null
    if (updateOverlay) setGuides([])
    if (active.kind === 'crop') {
      if (cancelled && updateOverlay) setCropEditor(active.original)
    } else {
      if (cancelled && active.changed) {
        if (active.kind === 'caption')
          current.current.onChangeCaption?.(
            stageGestureResult(active.original, active.latest, true)
          )
        else
          current.current.onChangeClip?.(stageGestureResult(active.original, active.latest, true))
      }
      current.current.onInteractionEnd?.(cancelled)
    }
    if (wrapper.current?.hasPointerCapture(active.pointerId))
      wrapper.current.releasePointerCapture(active.pointerId)
  }
  const finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => () => finishRef.current(true, false), [])
  useEffect(() => {
    if (!cropRequest) return
    const snapshot = current.current
    const clip = snapshot.clips.find((item) => item.id === cropRequest.clipId)
    const source = clip ? sources.current.get(clip.id) : undefined
    if (
      !clip ||
      !source ||
      snapshot.selectedId !== clip.id ||
      !stageCanEdit(snapshot.doc, clip, snapshot.readonly, snapshot.playing) ||
      !snapshot.onChangeClip
    )
      return
    const cropGeometry = stageClipGeometry(snapshot.doc, clip, snapshot.time, source)
    if (!cropGeometry) return
    finishRef.current(true)
    setCropEditor({ clip, crop: { ...cropGeometry.transform.crop } })
    setShowAlign(false)
  }, [cropRequest])
  const canContinue = (active: StageDrag) => {
    const id = active.kind === 'crop' ? active.original.clip.id : active.original.id
    const clip = doc.visuals.find((item) => item.id === id)
    return stageGestureCanContinue(
      { id, time: active.time },
      {
        selectedId,
        time,
        visible: (active.kind === 'caption' ? captions : clips).some((item) => item.id === id),
        editable:
          !readonly &&
          !playing &&
          (active.kind === 'caption' || (!!clip && stageCanEdit(doc, clip)))
      }
    )
  }
  useEffect(() => {
    const active = drag.current
    if (active && !canContinue(active)) finish(true)
    if (
      cropEditor &&
      (readonly ||
        playing ||
        cropEditor.clip.id !== selectedId ||
        doc.visuals.find((clip) => clip.id === cropEditor.clip.id) !== cropEditor.clip ||
        !clips.some((clip) => clip.id === cropEditor.clip.id) ||
        !doc.visuals.some((c) => c.id === cropEditor.clip.id && stageCanEdit(doc, c)))
    )
      setCropEditor(null)
    // The props ref supplies current callbacks without restarting the gesture.
  }, [readonly, playing, doc.tracks, doc.visuals, clips, captions, selectedId, time])
  const start = (event: ReactPointerEvent, action: StageDrag) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    drag.current = action
    wrapper.current?.focus({ preventScroll: true })
    wrapper.current?.setPointerCapture(event.pointerId)
    if (action.kind !== 'crop') onInteractionStart?.()
  }
  const beginClip = (
    event: ReactPointerEvent,
    clip: VideoClip,
    kind: 'move' | 'resize' | 'rotate' = 'move',
    corner?: number
  ) => {
    const source = sources.current.get(clip.id),
      g = source ? stageClipGeometry(doc, clip, time, source) : null
    if (!g || !onChangeClip || !stageCanEdit(doc, clip, readonly, playing)) return
    start(event, {
      kind,
      pointerId: event.pointerId,
      start: point(event),
      changed: false,
      time,
      original: clip,
      latest: clip,
      geometry: g,
      corner
    })
  }
  const beginCrop = (event: ReactPointerEvent, corner?: number) => {
    if (!cropEditor || !clipEditable) return
    const source = sources.current.get(cropEditor.clip.id)
    if (!source) return
    start(event, {
      kind: 'crop',
      pointerId: event.pointerId,
      start: point(event),
      changed: false,
      time,
      original: cropEditor,
      image: stageCropImageRect(doc, source),
      corner
    })
  }
  const pointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0 || cropEditor) return
    const p = point(event)
    if (p.x < 0 || p.y < 0 || p.x > doc.width || p.y > doc.height) return
    for (const cue of [...captions].reverse()) {
      if (!stageCaptionRects(doc, cue, measure).some((r) => stageHitRect(r, p))) continue
      onSelectCaption?.(cue.id)
      if (!readonly && !playing && onChangeCaption)
        start(event, {
          kind: 'caption',
          pointerId: event.pointerId,
          start: p,
          changed: false,
          time,
          original: cue,
          latest: cue
        })
      return
    }
    for (const clip of [...clips].reverse()) {
      const source = sources.current.get(clip.id),
        g = source ? stageClipGeometry(doc, clip, time, source) : null
      if (
        !source ||
        !g ||
        !stageHitClip(g, p, (pixel) => {
          let alpha = sampleAlpha(source, pixel)
          if (clip.localEffects) {
            const local = stageWorldToLocal(g, p)
            for (const region of clip.localEffects.regions)
              if (region.effect === 'mask')
                alpha *=
                  1 -
                  localRegionCoverage(
                    region,
                    Math.floor(local.x + doc.width / 2),
                    Math.floor(local.y + doc.height / 2),
                    doc.width,
                    doc.height
                  )
          }
          return alpha
        })
      )
        continue
      onSelect(clip.id)
      beginClip(event, clip)
      return
    }
  }
  const pointerMove = (event: ReactPointerEvent) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    if (!canContinue(active)) {
      finish(true)
      return
    }
    const p = point(event),
      delta = { x: p.x - active.start.x, y: p.y - active.start.y }
    if (!active.changed && Math.hypot(delta.x, delta.y) * displayScale < 2) return
    active.changed = true
    if (active.kind === 'crop') {
      setCropEditor({
        ...active.original,
        crop: stageEditCrop(active.image, active.original.crop, delta, active.corner)
      })
      return
    }
    if (readonly || playing) {
      finish(true)
      return
    }
    if (active.kind === 'caption') {
      active.latest = stageMoveCaption(
        doc,
        active.original,
        delta,
        event.altKey ? 0 : 6 / displayScale
      )
      onChangeCaption?.(active.latest)
    } else {
      if (!stageCanEdit(doc, active.original)) {
        finish(true)
        return
      }
      let patch: Partial<VideoTransform>
      if (active.kind === 'resize') {
        const corner = active.corner ?? 0,
          origin = active.geometry.corners[corner]
        patch = stageResizeTransform(
          active.geometry,
          corner,
          { x: origin.x + delta.x, y: origin.y + delta.y },
          event.altKey
        )
      } else if (active.kind === 'rotate')
        patch = stageRotateTransform(active.geometry, active.start, p, event.shiftKey)
      else {
        const others = clips
          .filter((c) => c.id !== active.original.id)
          .flatMap((c) => {
            const source = sources.current.get(c.id),
              g = source ? stageClipGeometry(doc, c, time, source) : null
            return g ? [stageBounds(g.corners)] : []
          })
        const moved = stageMoveTransform(
          active.geometry,
          delta,
          event.altKey ? 0 : 6 / displayScale,
          others
        )
        patch = moved.patch
        setGuides(moved.guides)
      }
      active.latest = stagePatchTransform(active.original, time, patch)
      onChangeClip?.(active.latest)
    }
  }
  const align = (alignment: StageAlignment) => {
    if (selectedClip && geometry && clipEditable) {
      onInteractionStart?.()
      onChangeClip?.(
        stagePatchTransform(selectedClip, time, stageAlignTransform(geometry, alignment))
      )
      onInteractionEnd?.()
    } else if (selectedCaption && captionEditable && captionRects.length) {
      const b = stageBounds(captionRects.flatMap(stageRectCorners))
      const delta = {
        x:
          alignment === 'left'
            ? -b.x
            : alignment === 'right'
              ? doc.width - b.x - b.width
              : alignment === 'center'
                ? doc.width / 2 - b.x - b.width / 2
                : 0,
        y:
          alignment === 'top'
            ? -b.y
            : alignment === 'bottom'
              ? doc.height - b.y - b.height
              : alignment === 'middle'
                ? doc.height / 2 - b.y - b.height / 2
                : 0
      }
      onInteractionStart?.()
      onChangeCaption?.(stageMoveCaption(doc, selectedCaption, delta))
      onInteractionEnd?.()
    }
  }
  const cropSource = cropEditor ? sources.current.get(cropEditor.clip.id) : undefined
  const cropImage = cropSource ? stageCropImageRect(doc, cropSource) : null
  const cropRect = cropImage && cropEditor ? stageCropRect(cropImage, cropEditor.crop) : null
  const radius = 5 / displayScale
  const rotationAnchor = geometry
    ? {
        x: (geometry.corners[0].x + geometry.corners[1].x) / 2,
        y: (geometry.corners[0].y + geometry.corners[1].y) / 2
      }
    : null
  const rotateHandle =
    rotationAnchor && geometry
      ? (() => {
          const dx = rotationAnchor.x - geometry.center.x,
            dy = rotationAnchor.y - geometry.center.y,
            length = Math.max(0.001, Math.hypot(dx, dy))
          return {
            x: bounded(
              rotationAnchor.x + ((dx / length) * 24) / displayScale,
              radius * 2,
              doc.width - radius * 2
            ),
            y: bounded(
              rotationAnchor.y + ((dy / length) * 24) / displayScale,
              radius * 2,
              doc.height - radius * 2
            )
          }
        })()
      : null
  const handles = (cropRect ? stageRectCorners(cropRect) : selection).concat(
    !cropRect && rotateHandle ? [rotateHandle] : []
  )
  const toolRect = stageToolsRect(
    viewport,
    handles.map((handle) => ({
      x: handle.x * displayScale + (viewport.width - doc.width * displayScale) / 2,
      y: handle.y * displayScale + (viewport.height - doc.height * displayScale) / 2
    })),
    { width: (cropEditor ? 3 : 1 + (showAlign ? 6 : 0)) * 28 + 6, height: 34 }
  )
  return (
    <div
      ref={wrapper}
      className={`video-stage-editor${playing ? ' is-playing' : ''}${cropEditor ? ' is-cropping' : ''}`}
      tabIndex={0}
      role="group"
      aria-label="视频画面预览"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(event) => {
        pointerMove(event)
        finish()
      }}
      onPointerCancel={() => finish(true)}
      onLostPointerCapture={() => finish(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) finish(true)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          if (drag.current) finish(true)
          else if (cropEditor) setCropEditor(null)
          else setShowAlign(false)
          event.preventDefault()
          event.stopPropagation()
          return
        }
        if (
          event.target !== event.currentTarget ||
          cropEditor ||
          !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
        )
          return
        const step = event.shiftKey ? 10 : 1,
          delta = {
            x: event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0,
            y: event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
          }
        if (selectedClip && geometry && clipEditable) {
          event.preventDefault()
          event.stopPropagation()
          onInteractionStart?.()
          onChangeClip?.(
            stagePatchTransform(selectedClip, time, stageMoveTransform(geometry, delta).patch)
          )
          onInteractionEnd?.()
        } else if (selectedCaption && captionEditable) {
          event.preventDefault()
          event.stopPropagation()
          onInteractionStart?.()
          onChangeCaption?.(stageMoveCaption(doc, selectedCaption, delta))
          onInteractionEnd?.()
        }
      }}
    >
      <canvas ref={canvas} className="video-preview-canvas" aria-label="视频合成画面" />
      {!playing && !readonly && (
        <svg
          className="video-stage-overlay"
          viewBox={`0 0 ${doc.width} ${doc.height}`}
          aria-hidden="true"
        >
          {showSafeArea && (
            <rect
              x={doc.width * 0.05}
              y={doc.height * 0.05}
              width={doc.width * 0.9}
              height={doc.height * 0.9}
              className="video-stage-safe-area"
            />
          )}
          {guides.map((guide, index) => (
            <line
              key={index}
              className="video-stage-guide"
              x1={guide.axis === 'x' ? guide.position : 0}
              y1={guide.axis === 'y' ? guide.position : 0}
              x2={guide.axis === 'x' ? guide.position : doc.width}
              y2={guide.axis === 'y' ? guide.position : doc.height}
            />
          ))}
          {cropRect && cropImage ? (
            <>
              <path
                className="video-stage-crop-shade"
                fillRule="evenodd"
                d={`M0 0H${doc.width}V${doc.height}H0Z M${cropRect.x} ${cropRect.y}h${cropRect.width}v${cropRect.height}h${-cropRect.width}Z`}
              />
              <rect
                {...cropRect}
                className="video-stage-selection video-stage-move-target"
                onPointerDown={(event) => beginCrop(event)}
              />
              {[1, 2].map((n) => (
                <g key={n} className="video-stage-crop-grid">
                  <line
                    x1={cropRect.x + (cropRect.width * n) / 3}
                    x2={cropRect.x + (cropRect.width * n) / 3}
                    y1={cropRect.y}
                    y2={cropRect.y + cropRect.height}
                  />
                  <line
                    x1={cropRect.x}
                    x2={cropRect.x + cropRect.width}
                    y1={cropRect.y + (cropRect.height * n) / 3}
                    y2={cropRect.y + (cropRect.height * n) / 3}
                  />
                </g>
              ))}
              {stageRectCorners(cropRect).map((p, index) => (
                <circle
                  key={index}
                  cx={p.x}
                  cy={p.y}
                  r={radius}
                  className={`video-stage-handle is-corner-${index}`}
                  onPointerDown={(event) => beginCrop(event, index)}
                />
              ))}
            </>
          ) : selection.length ? (
            <>
              <polygon
                points={points(selection)}
                className={`video-stage-selection${clipEditable || captionEditable ? ' is-editable' : ' is-locked'}`}
              />
              {clipEditable &&
                geometry &&
                geometry.corners.map((p, index) => (
                  <circle
                    key={index}
                    cx={p.x}
                    cy={p.y}
                    r={radius}
                    className={`video-stage-handle is-corner-${index}`}
                    onPointerDown={(event) => {
                      if (selectedClip) beginClip(event, selectedClip, 'resize', index)
                    }}
                  />
                ))}
              {clipEditable && rotationAnchor && rotateHandle && (
                <>
                  <line
                    className="video-stage-rotation-stem"
                    x1={rotationAnchor.x}
                    y1={rotationAnchor.y}
                    x2={rotateHandle.x}
                    y2={rotateHandle.y}
                  />
                  <circle
                    cx={rotateHandle.x}
                    cy={rotateHandle.y}
                    r={radius}
                    className="video-stage-handle is-rotation"
                    onPointerDown={(event) => {
                      if (selectedClip) beginClip(event, selectedClip, 'rotate')
                    }}
                  />
                </>
              )}
            </>
          ) : null}
        </svg>
      )}
      {!playing && !readonly && (clipEditable || captionEditable) && (
        <div
          className="video-stage-tools"
          style={{ left: toolRect.x, top: toolRect.y }}
          role="toolbar"
          aria-label={cropEditor ? '裁剪画面' : '画面工具'}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {cropEditor ? (
            <>
              <button
                type="button"
                title="重置裁剪"
                aria-label="重置裁剪"
                onClick={() =>
                  setCropEditor({ ...cropEditor, crop: { x: 0, y: 0, width: 1, height: 1 } })
                }
              >
                <IconRestore size={16} />
              </button>
              <button
                type="button"
                title="取消裁剪"
                aria-label="取消裁剪"
                onClick={() => setCropEditor(null)}
              >
                <IconX size={16} />
              </button>
              <button
                type="button"
                title="应用裁剪"
                aria-label="应用裁剪"
                className="is-primary"
                onClick={() => {
                  if (!selectedClip || !clipEditable) return
                  onInteractionStart?.()
                  onChangeClip?.(stagePatchTransform(selectedClip, time, { crop: cropEditor.crop }))
                  onInteractionEnd?.()
                  setCropEditor(null)
                }}
              >
                <IconCheck size={16} />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                title="对齐画面"
                aria-label="对齐画面"
                aria-expanded={showAlign}
                className={showAlign ? 'is-active' : ''}
                onClick={() => setShowAlign(!showAlign)}
              >
                <IconArrowsMove size={16} />
              </button>
              {showAlign &&
                alignmentTools.map(([value, label, Icon]) => (
                  <button
                    type="button"
                    key={value}
                    title={label}
                    aria-label={label}
                    onClick={() => align(value)}
                  >
                    <Icon size={16} />
                  </button>
                ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
