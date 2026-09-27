import { computed, onBeforeUnmount, ref, type Ref } from 'vue'
import type {
  StudioDocument,
  StudioGroup,
  StudioLayer,
  StudioDragItem,
  StudioDropTarget
} from '../model/imageStudioModel'
interface LayerDragOptions {
  draft: Ref<StudioDocument>
  isDisabled: () => boolean
  applyDrop: (source: StudioDragItem, target: StudioDropTarget) => void
}
/** Owns native layer dragging, row targets, overlay timing and autoscroll cleanup. */
export function useStudioLayerDrag({ draft, isDisabled, applyDrop }: LayerDragOptions) {
  const orderedLayers = computed(() => [...draft.value.layers].reverse())
  type LayerRow = { kind: 'group'; group: StudioGroup } | { kind: 'layer'; layer: StudioLayer }
  const layerRows = computed<LayerRow[]>(() => {
    const rows: LayerRow[] = [],
      shown = new Set<string>()
    for (const group of draft.value.groups)
      if (!draft.value.layers.some((layer) => layer.groupId === group.id)) {
        rows.push({ kind: 'group', group })
        shown.add(group.id)
      }
    for (const layer of orderedLayers.value) {
      const group = layer.groupId
        ? draft.value.groups.find((item) => item.id === layer.groupId)
        : undefined
      if (group && !shown.has(group.id)) {
        rows.push({ kind: 'group', group })
        shown.add(group.id)
      }
      if (!group || !group.collapsed) rows.push({ kind: 'layer', layer })
    }
    return rows
  })
  const dragItem = ref<StudioDragItem>()
  const dropTarget = ref<StudioDropTarget>()
  const dragZonesVisible = ref(false)
  let dragZoneFrame = 0
  let dragScrollFrame = 0
  let dragScrollArea: HTMLElement | null = null
  let dragScrollSpeed = 0
  function scrollDragList() {
    if (dragScrollArea && dragItem.value && dragScrollSpeed) {
      dragScrollArea.scrollTop += dragScrollSpeed
      dragScrollFrame = requestAnimationFrame(scrollDragList)
    } else dragScrollFrame = 0
  }
  function startDrag(event: DragEvent, kind: StudioDragItem['kind'], id: string) {
    if (isDisabled()) {
      event.preventDefault()
      return
    }
    dragItem.value = { kind, id }
    event.dataTransfer?.setData('text/plain', id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
    // Reveal overlays after the browser has captured the native drag source.
    cancelAnimationFrame(dragZoneFrame)
    dragZoneFrame = requestAnimationFrame(() => {
      dragZoneFrame = requestAnimationFrame(() => {
        dragZonesVisible.value = !!dragItem.value
      })
    })
  }
  function endDrag() {
    dragItem.value = undefined
    dropTarget.value = undefined
    cancelAnimationFrame(dragZoneFrame)
    dragZonesVisible.value = false
    cancelAnimationFrame(dragScrollFrame)
    dragScrollFrame = 0
    dragScrollSpeed = 0
    dragScrollArea = null
  }
  onBeforeUnmount(endDrag)
  function dragOver(event: DragEvent, kind: 'layer' | 'group' | 'top' | 'bottom', id = '') {
    if (!dragItem.value) return
    const row = event.currentTarget as HTMLElement
    const rect = row.getBoundingClientRect()
    const fraction = (event.clientY - rect.top) / rect.height
    const position = fraction < 0.5 ? 'before' : 'after'
    if (kind === 'top' || kind === 'bottom') dropTarget.value = { kind }
    else if (kind === 'group')
      dropTarget.value = {
        kind,
        id,
        position:
          dragItem.value.kind === 'layer' && fraction >= 0.25 && fraction <= 0.75
            ? 'inside'
            : position
      }
    else {
      const layer = draft.value.layers.find((item) => item.id === id)
      // The unindented gutter drops beside the whole group, never back into it.
      dropTarget.value =
        layer?.groupId && (event.clientX < rect.left + 20 || dragItem.value.kind === 'group')
          ? { kind: 'group', id: layer.groupId, position }
          : { kind, id, position }
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dragScrollArea = row.closest('.layer-list-area')
    const area = dragScrollArea?.getBoundingClientRect()
    dragScrollSpeed = area
      ? event.clientY < area.top + 28
        ? -7
        : event.clientY > area.bottom - 28
          ? 7
          : 0
      : 0
    if (dragScrollSpeed && !dragScrollFrame) dragScrollFrame = requestAnimationFrame(scrollDragList)
  }
  function dropItem() {
    const source = dragItem.value,
      target = dropTarget.value
    if (source && target) applyDrop(source, target)
    endDrag()
  }
  function dropClass(row: LayerRow) {
    const target = dropTarget.value
    if (!target || !('position' in target)) return ''
    if (target.kind === 'layer')
      return row.kind === 'layer' && row.layer.id === target.id ? 'drop-target' : ''
    return row.kind === 'group' && row.group.id === target.id ? 'drop-target' : ''
  }

  return {
    layerRows,
    dragItem,
    dropTarget,
    dragZonesVisible,
    startDrag,
    endDrag,
    dragOver,
    dropItem,
    dropClass
  }
}
