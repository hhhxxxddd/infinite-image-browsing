<script setup lang="ts">
import { computed } from 'vue'
import dagre from '@dagrejs/dagre'
import { Handle, MarkerType, Position, VueFlow, type Edge, type Node } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import type { ComfyWorkflow } from '@/api/imageAi'

const props = defineProps<{
  workflow: ComfyWorkflow
  mainId: string
  referenceIds: string[]
  promptId: string
  negativePromptId: string
  maskId: string
  maskEnabled: boolean
  resultId: string
  selectedId: string
}>()
const emit = defineEmits<{ select: [id: string] }>()

type GraphData = { id: string; title: string; classType: string; role: string; kind: string }
const isLoadImage = (classType: string) => /LoadImage$/i.test(classType)
const isResult = (classType: string) => /SaveImage|PreviewImage/i.test(classType)

const graph = computed(() => {
  const source = props.workflow
  const ids = Object.keys(source)
  const edges: Edge[] = []
  const layout = new dagre.graphlib.Graph({ multigraph: true })
  layout.setGraph({ rankdir: 'LR', nodesep: 35, ranksep: 90, marginx: 32, marginy: 32 })
  layout.setDefaultEdgeLabel(() => ({}))
  for (const id of ids) layout.setNode(id, { width: 174, height: 77 })
  for (const [target, node] of Object.entries(source)) {
    for (const [field, value] of Object.entries(node.inputs)) {
      if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[1])) continue
      const from = String(value[0])
      if (!source[from]) continue
      const mask = value[1] === 1 && /mask/i.test(field)
      if (!props.maskEnabled && ((from === props.mainId && mask) || from === props.maskId)) continue
      edges.push({ id: `${from}:${target}:${field}`, source: from, target, label: field.split('.').slice(-1)[0] || field,
        type: 'smoothstep', animated: false, markerEnd: MarkerType.ArrowClosed,
        style: { stroke: mask ? '#8b69bf' : '#8da5bc', strokeWidth: mask ? 2 : 1.5,
          ...(mask ? { strokeDasharray: '5 4' } : {}) },
        labelStyle: { fill: '#61758a', fontSize: 10 },
        labelBgStyle: { fill: '#f8fbff', fillOpacity: .94 },
        labelBgPadding: [4, 2] })
      layout.setEdge(from, target, {}, `${target}:${field}`)
    }
  }
  dagre.layout(layout)
  const nodes: Node<GraphData>[] = ids.map(id => {
    const node = source[id]
    const referenceIndex = props.referenceIds.indexOf(id)
    const role = id === props.mainId ? '主图' : referenceIndex >= 0 ? `参考图 ${referenceIndex + 1}`
      : id === props.promptId && id === props.negativePromptId ? '正向 / 负向'
        : id === props.promptId ? '正向提示词' : id === props.negativePromptId ? '负向提示词' : id === props.maskId ? '遮罩'
        : id === props.resultId ? '结果' : ''
    const kind = isLoadImage(node.class_type) ? 'image' : isResult(node.class_type) ? 'result'
      : /text|prompt|clip/i.test(node.class_type) ? 'text' : 'process'
    const point = layout.node(id)
    return { id, type: 'workflow', position: { x: (point?.x ?? 0) - 87, y: (point?.y ?? 0) - 38.5 },
      selectable: true, draggable: false,
      data: { id, title: node._meta?.title || node.class_type, classType: node.class_type, role, kind } }
  })
  return { nodes, edges }
})

function selectNode(event: { node: Node }) { emit('select', event.node.id) }
</script>

<template>
  <div class="workflow-graph" aria-label="工作流节点关系图">
    <VueFlow :nodes="graph.nodes" :edges="graph.edges" :nodes-connectable="false" :nodes-draggable="false"
      :elements-selectable="true" :min-zoom="0.25" :max-zoom="2" fit-view-on-init @node-click="selectNode">
      <template #node-workflow="{ data }">
        <div class="graph-card" :class="[data.kind, { mapped: data.role, current: data.id === selectedId }]">
          <Handle type="target" :position="Position.Left" :connectable="false" />
          <span class="graph-card-top"><span class="graph-id">{{ data.id }}</span><span v-if="data.role" class="graph-role">{{ data.role }}</span></span>
          <strong :title="data.title">{{ data.title }}</strong>
          <small :title="data.classType">{{ data.classType }}</small>
          <Handle type="source" :position="Position.Right" :connectable="false" />
        </div>
      </template>
    </VueFlow>
  </div>
</template>

<style scoped>
.workflow-graph{width:100%;height:100%;min-height:450px;background:radial-gradient(circle,#dbe5ef 1px,transparent 1px) 0 0/18px 18px,var(--ui-canvas);overflow:hidden}
.workflow-graph :deep(.vue-flow__edge-textbg){rx:4px;ry:4px}
.workflow-graph :deep(.vue-flow__node-workflow){border:0;background:transparent}
.graph-card{display:flex;flex-direction:column;gap:4px;box-sizing:border-box;width:174px;height:77px;padding:9px 11px;border:1px solid #cbd8e5;border-radius:9px;background:var(--ui-surface);box-shadow:0 3px 10px #20344f12;color:var(--ui-text);text-align:left}
.graph-card.current{border-color:var(--primary-color);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary-color) 20%,transparent),0 6px 18px #20344f20}
.graph-card.mapped.image{border-left:4px solid #2680b9}.graph-card.mapped.text{border-left:4px solid #8b69bf}.graph-card.mapped.result{border-left:4px solid #27a17d}.graph-card.mapped.process{border-left:4px solid #8b69bf}
.graph-card-top{display:flex;align-items:center;justify-content:space-between;gap:6px;height:16px}.graph-id{color:var(--ui-muted);font-size:10px}.graph-role{max-width:95px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--primary-color);font-size:10px;font-weight:700}
.graph-card strong,.graph-card small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.graph-card strong{font-size:12px;line-height:16px}.graph-card small{color:var(--ui-muted);font-size:10px;line-height:14px}
.graph-card :deep(.vue-flow__handle){width:7px;height:7px;border:1px solid #8da5bc;background:#fff}
</style>
