import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { generationDetails } from '../src/util/generationDetails.ts'
import { findComfyWorkflow } from '../src/util/comfyWorkflow.ts'

// Synthetic CPU benchmark, not an end-to-end browser or large-library measurement.
const workflow = {
  version: 0.4,
  nodes: Array.from({ length: 10_000 }, (_, id) => ({
    id, type: 'ExampleNode', pos: [id, id], size: [200, 100],
    widgets_values: ['sample text '.repeat(10)], inputs: [], outputs: [],
  })),
  links: [],
}
const meta = { seed: 0, steps: 20, extraJsonMetaInfo: { workflow } }
assert.deepEqual(generationDetails(meta).primary, generationDetails(meta, undefined, undefined, false).primary)
assert.equal(findComfyWorkflow(meta).nodeCount, 10_000)
assert.deepEqual(JSON.parse(findComfyWorkflow(meta).json), workflow)

function measure(label, fn) {
  for (let i = 0; i < 5; i++) fn()
  const samples = []
  for (let round = 0; round < 5; round++) {
    const start = performance.now()
    for (let i = 0; i < 20; i++) fn()
    samples.push((performance.now() - start) / 20)
  }
  samples.sort((a, b) => a - b)
  console.log(`${label}: ${samples[2].toFixed(3)} ms/call (median of 5 rounds, 20 calls/round)`)
}

console.log(`Node ${process.version}; workflow: ${workflow.nodes.length} nodes, ${Buffer.byteLength(JSON.stringify(workflow))} bytes`)
measure('Full details, including hidden extras', () => generationDetails(meta))
measure('Compact details, visible fields only', () => generationDetails(meta, undefined, undefined, false))
measure('Workflow detection plus copy serialization', () => findComfyWorkflow(meta).json)
measure('Workflow badge detection only', () => findComfyWorkflow(meta).nodeCount)
