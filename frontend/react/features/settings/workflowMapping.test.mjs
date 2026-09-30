import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableScalarFields,
  maskFromMainImage,
  setImageRole,
  validateWorkflowMappings
} from './workflowMapping.ts'

function draft() {
  return {
    name: '测试工作流',
    purpose: 'image_edit',
    workflow: {
      1: { class_type: 'LoadImage', inputs: { image: 'source.png' } },
      2: { class_type: 'LoadImage', inputs: { image: 'reference.png' } },
      3: { class_type: 'TextPrompt', inputs: { text: '', strength: 0.7, enabled: true } },
      4: { class_type: 'PreviewImage', inputs: { images: ['1', 0] } }
    },
    image_node_id: '1',
    image_input: 'image',
    mask_node_id: '',
    mask_input: '',
    mask_enabled: false,
    prompt_node_id: '3',
    prompt_input: 'text',
    negative_prompt_node_id: '',
    negative_prompt_input: '',
    output_node_id: '4',
    output_mappings: [{ node_id: '4', label: '' }],
    reference_slots: [{ node_id: '2', input: 'image' }],
    parameters: []
  }
}

test('switching image roles preserves a single main and ordered reference slots', () => {
  const original = draft()
  const promoted = setImageRole(original, '2', 'main')
  assert.equal(original.image_node_id, '1')
  assert.equal(promoted.image_node_id, '2')
  assert.deepEqual(promoted.reference_slots, [])
  const referenced = setImageRole(promoted, '1', 'reference')
  assert.deepEqual(referenced.reference_slots, [{ node_id: '1', input: 'image' }])
  assert.equal(validateWorkflowMappings(referenced), null)
})

test('main image alpha mask conflicts with an independent mask node', () => {
  const current = draft()
  current.workflow['4'].inputs.mask = ['1', 1]
  current.workflow['5'] = {
    class_type: 'LoadImageMask',
    inputs: { image: 'mask.png', channel: 'alpha' }
  }
  current.mask_node_id = '5'
  current.mask_input = 'image'
  assert.equal(maskFromMainImage(current.workflow, '1'), true)
  assert.match(validateWorkflowMappings(current), /无需再映射独立遮罩/)
  const resolved = setImageRole(current, '1', 'main')
  assert.equal(resolved.mask_node_id, '')
  assert.equal(resolved.mask_enabled, true)
  assert.equal(validateWorkflowMappings(resolved), null)
})

test('parameter fields exclude reserved inputs and reject duplicate targets', () => {
  const current = draft()
  assert.deepEqual(
    availableScalarFields(current).map((field) => `${field.node_id}.${field.input}`),
    ['3.strength', '3.enabled']
  )
  current.parameters = [
    {
      id: 'a',
      name: '强度',
      kind: 'number',
      number_display: 'slider',
      targets: [{ node_id: '3', input: 'strength' }],
      options: [],
      minimum: 0,
      maximum: 1,
      step: 0.1
    }
  ]
  assert.equal(validateWorkflowMappings(current), null)
  current.parameters.push({ ...current.parameters[0], id: 'b', name: '重复强度' })
  assert.match(validateWorkflowMappings(current), /重复/)
})

test('select option values must match every mapped field', () => {
  const current = draft()
  current.parameters = [
    {
      id: 'choice',
      name: '预设',
      kind: 'select',
      number_display: 'input',
      targets: [
        { node_id: '3', input: 'strength' },
        { node_id: '3', input: 'enabled' }
      ],
      options: [{ name: '默认', values: ['0.7', 'true'] }],
      minimum: null,
      maximum: null,
      step: null
    }
  ]
  assert.equal(validateWorkflowMappings(current), null)
  current.parameters[0].options[0].values[1] = 'maybe'
  assert.match(validateWorkflowMappings(current), /类型不匹配/)
  current.parameters[0].options[0].values = ['0.7']
  assert.match(validateWorkflowMappings(current), /字段数量无效/)
})

test('duplicate output nodes are rejected before saving', () => {
  const current = draft()
  current.output_mappings.push({ node_id: '4', label: '第二份' })
  assert.match(validateWorkflowMappings(current), /结果节点重复/)
})

test('audio and video presets can save parameters without image result mappings', () => {
  for (const purpose of ['audio_creation', 'video_creation']) {
    const current = {
      ...draft(),
      purpose,
      workflow: {
        1: { class_type: 'LoadAudio', inputs: { audio: 'source.mp3', gain: 0.5 } }
      },
      image_node_id: '',
      image_input: '',
      prompt_node_id: '',
      prompt_input: '',
      reference_slots: [],
      output_node_id: '',
      output_mappings: [],
      parameters: [
        {
          id: 'gain',
          name: '增益',
          kind: 'number',
          targets: [{ node_id: '1', input: 'gain' }],
          options: [],
          minimum: 0,
          maximum: 1,
          step: 0.1
        }
      ]
    }
    assert.equal(validateWorkflowMappings(current), null)
    current.parameters[0].targets = [{ node_id: '1', input: 'missing' }]
    assert.match(validateWorkflowMappings(current), /非标量字段/)
  }
})

test('reference slots stop at thirteen and invalid mask channels cannot be saved', () => {
  const current = draft()
  for (let index = 5; index < 17; index++) {
    current.workflow[String(index)] = {
      class_type: 'LoadImage',
      inputs: { image: `${index}.png` }
    }
    current.reference_slots.push({ node_id: String(index), input: 'image' })
  }
  assert.equal(current.reference_slots.length, 13)
  current.workflow['17'] = { class_type: 'LoadImage', inputs: { image: '17.png' } }
  assert.equal(setImageRole(current, '17', 'reference'), current)
  current.mask_node_id = '18'
  current.mask_input = 'image'
  current.workflow['18'] = {
    class_type: 'LoadImageMask',
    inputs: { image: 'mask.png', channel: 'none' }
  }
  assert.match(validateWorkflowMappings(current), /有效的 channel/)
})
