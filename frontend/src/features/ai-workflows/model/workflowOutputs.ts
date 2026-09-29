import type { StudioOutputMapping } from '../api/imageAi'

export function workflowOutputMappings(
  item?: { output_mappings?: StudioOutputMapping[] | null; output_node_id?: string } | null
): StudioOutputMapping[] {
  if (item?.output_mappings != null) return item.output_mappings
  return item?.output_node_id ? [{ node_id: item.output_node_id, label: '' }] : []
}
