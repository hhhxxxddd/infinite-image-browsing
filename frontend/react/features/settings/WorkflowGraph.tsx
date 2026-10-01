import { memo, useEffect, useMemo, useState } from 'react'
import dagre from '@dagrejs/dagre'
import { useComputedColorScheme } from '@mantine/core'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { StudioWorkflowPresetInput } from '../../../src/features/ai-workflows/model/imageAIContracts'

type WorkflowNode = Node<
  {
    title: string
    classType: string
    role: string
    kind: string
    current: boolean
  },
  'workflow'
>

const WorkflowNodeCard = memo(function WorkflowNodeCard({ id, data }: NodeProps<WorkflowNode>) {
  return (
    <div
      className={`workflow-node ${data.kind}${data.role ? ' is-mapped' : ''}${data.current ? ' is-current' : ''}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="workflow-node-top">
        <span>{id}</span>
        <span>{data.role}</span>
      </div>
      <strong title={data.title}>{data.title}</strong>
      <small title={data.classType}>{data.classType}</small>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})
const nodeTypes = { workflow: WorkflowNodeCard }

export default function WorkflowGraph({
  draft,
  selectedId,
  focusRevision,
  onSelect
}: {
  draft: StudioWorkflowPresetInput
  selectedId: string
  focusRevision: number
  onSelect: (id: string) => void
}) {
  const scheme = useComputedColorScheme('light')
  const [instance, setInstance] = useState<ReactFlowInstance<WorkflowNode, Edge> | null>(null)
  const layout = useMemo(() => {
    const graph = new dagre.graphlib.Graph({ multigraph: true })
    graph.setGraph({ rankdir: 'LR', nodesep: 35, ranksep: 90, marginx: 32, marginy: 32 })
    graph.setDefaultEdgeLabel(() => ({}))
    Object.keys(draft.workflow).forEach((id) => graph.setNode(id, { width: 174, height: 77 }))
    const edges: Edge[] = []
    for (const [target, node] of Object.entries(draft.workflow)) {
      for (const [input, value] of Object.entries(node.inputs)) {
        if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[1])) continue
        const source = String(value[0])
        if (!draft.workflow[source]) continue
        const isMask = value[1] === 1 && /mask/i.test(input)
        if (
          draft.mask_enabled === false &&
          ((source === draft.image_node_id && isMask) || source === draft.mask_node_id)
        )
          continue
        const id = `${source}:${target}:${input}`
        graph.setEdge(source, target, {}, id)
        edges.push({
          id,
          source,
          target,
          type: 'smoothstep',
          label: input,
          markerEnd: { type: MarkerType.ArrowClosed },
          style: {
            stroke: isMask ? 'var(--omni-accent-ink)' : 'var(--omni-muted)',
            strokeWidth: isMask ? 2 : 1.5,
            ...(isMask ? { strokeDasharray: '5 4' } : {})
          },
          labelStyle: { fontSize: 10, fill: 'var(--omni-muted)' },
          labelBgStyle: { fill: 'var(--omni-surface)' }
        })
      }
    }
    dagre.layout(graph)
    return {
      edges,
      positions: Object.fromEntries(
        Object.keys(draft.workflow).map((id) => {
          const point = graph.node(id)
          return [id, { x: point.x - 87, y: point.y - 38.5 }]
        })
      )
    }
  }, [draft.workflow, draft.image_node_id, draft.mask_node_id, draft.mask_enabled])
  const nodes: WorkflowNode[] = useMemo(
    () =>
      Object.entries(draft.workflow).map(([id, node]) => {
        const referenceIndex = draft.reference_slots.findIndex((slot) => slot.node_id === id)
        const outputIndex = (draft.output_mappings || []).findIndex(
          (mapping) => mapping.node_id === id
        )
        const role =
          id === draft.image_node_id
            ? '主图'
            : referenceIndex >= 0
              ? `参考图 ${referenceIndex + 1}`
              : id === draft.prompt_node_id && id === draft.negative_prompt_node_id
                ? '正向 / 负向'
                : id === draft.prompt_node_id
                  ? '正向提示词'
                  : id === draft.negative_prompt_node_id
                    ? '负向提示词'
                    : id === draft.mask_node_id
                      ? '遮罩'
                      : outputIndex >= 0
                        ? `结果 ${outputIndex + 1}`
                        : ''
        return {
          id,
          type: 'workflow',
          position: layout.positions[id],
          selected: id === selectedId,
          draggable: false,
          width: 174,
          height: 77,
          data: {
            title: node._meta?.title || node.class_type,
            classType: node.class_type,
            role,
            kind: /LoadImage$/i.test(node.class_type)
              ? 'image'
              : /SaveImage|PreviewImage/i.test(node.class_type)
                ? 'result'
                : /text|prompt|clip/i.test(node.class_type)
                  ? 'text'
                  : 'process',
            current: id === selectedId
          }
        }
      }),
    [draft, layout.positions, selectedId]
  )
  useEffect(() => {
    if (selectedId && instance && focusRevision > 0)
      void instance.fitView({
        nodes: [{ id: selectedId }],
        maxZoom: 1.1,
        minZoom: 0.5,
        padding: 1,
        duration: 220
      })
  }, [selectedId, instance, focusRevision])
  return (
    <div className="workflow-graph" aria-label="工作流节点关系图">
      <ReactFlow<WorkflowNode, Edge>
        nodes={nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        onInit={setInstance}
        onNodeClick={(_, node) => onSelect(node.id)}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        minZoom={0.25}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        colorMode={scheme}
        deleteKeyCode={null}
      >
        <Background gap={18} size={1} color="var(--omni-border-strong)" />
        <Controls showInteractive={false} aria-label="工作流缩放与适应画面" />
      </ReactFlow>
    </div>
  )
}
