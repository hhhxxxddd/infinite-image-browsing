import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultAnnotationPromptRules,
  extractAnnotationPrompt,
  formatAnnotationPrompt,
  mergeAnnotationPrompt,
  readAnnotationPromptRules,
  validAnnotationTemplate
} from './annotationPrompt.ts'
import {
  createStudioDocument,
  createGuideLayer,
  createPaintLayer
} from '../../image-editor/model/imageStudioModel.ts'

test('mixed annotations follow numeric labels with stable ties and one line per annotation', () => {
  const doc = createStudioDocument()
  const frame = { x: 0, y: 0, width: 50, height: 50 }
  const box = {
    ...createGuideLayer(frame),
    name: '提示框 10',
    prompt: '保留颜色',
    color: '#00ff00'
  }
  const arrow = { ...createGuideLayer(frame, 'arrow'), name: '箭头 2', prompt: '增加\n纹理' }
  const paint = { ...createPaintLayer(50, 50), name: '涂抹 1', prompt: '替换背景' }
  const otherBox = { ...box, id: 'other', name: '提示框 2', prompt: '调整亮度' }
  doc.layers = [box, arrow, paint, otherBox]
  assert.equal(
    extractAnnotationPrompt(doc),
    '去掉涂抹标注，并编辑其覆盖的区域: 替换背景\n修改箭头指向的区域: 增加 纹理\n修改方框内的区域: 调整亮度\n修改方框内的区域: 保留颜色'
  )
})

test('hidden layers, hidden groups and empty annotations are excluded', () => {
  const doc = createStudioDocument()
  doc.groups = [{ id: 'hidden', visible: false }]
  const paint = createPaintLayer(50, 50)
  doc.layers = [
    { ...paint, prompt: '隐藏', visible: false },
    { ...paint, prompt: '隐藏组', groupId: 'hidden' },
    paint
  ]
  assert.equal(extractAnnotationPrompt(doc), '')
  assert.equal(extractAnnotationPrompt(null), '')
})

test('manual prompt edits survive extraction and unchanged extraction does not duplicate text', () => {
  assert.equal(mergeAnnotationPrompt('原有要求', '', '批注一'), '原有要求\n批注一')
  assert.equal(mergeAnnotationPrompt('原有要求\n批注一', '', '批注一'), '原有要求\n批注一')
  assert.equal(mergeAnnotationPrompt('原有要求\n批注一', '批注一', '批注二'), '原有要求\n批注二')
  assert.equal(mergeAnnotationPrompt('人为改写', '批注一', '批注一'), '人为改写')
  assert.equal(mergeAnnotationPrompt('人为改写', '批注一', '批注二'), '人为改写\n批注二')
  assert.equal(mergeAnnotationPrompt('', '批注一', '批注一'), '批注一')
})

test('custom rules apply per annotation type, preserve numbering and refresh an extracted block', () => {
  const doc = createStudioDocument()
  const frame = { x: 0, y: 0, width: 50, height: 50 }
  doc.layers = [
    { ...createGuideLayer(frame), name: '提示框 3', prompt: '替换背景' },
    { ...createGuideLayer(frame, 'arrow'), name: '箭头 1', prompt: '增加\n纹理' },
    { ...createPaintLayer(50, 50), name: '涂抹 2', prompt: '调整颜色' }
  ]
  const rules = readAnnotationPromptRules({
    rect: 'Box {序号}: {批注}',
    arrow: '{批注} (arrow {序号})',
    paint: 'Paint {序号}: {批注}'
  })
  const previous = extractAnnotationPrompt(doc)
  const next = extractAnnotationPrompt(doc, rules)
  assert.equal(next, '增加 纹理 (arrow 1)\nPaint 2: 调整颜色\nBox 3: 替换背景')
  assert.equal(mergeAnnotationPrompt(`整体要求\n${previous}`, previous, next), `整体要求\n${next}`)
  assert.deepEqual(readAnnotationPromptRules(JSON.parse(JSON.stringify(rules))), rules)
})

test('legacy, damaged or incomplete saved rules fall back independently without mutating defaults', () => {
  assert.deepEqual(readAnnotationPromptRules(null), defaultAnnotationPromptRules)
  assert.deepEqual(readAnnotationPromptRules('bad'), defaultAnnotationPromptRules)
  assert.deepEqual(readAnnotationPromptRules({ rect: '{批注}', arrow: '', paint: 10 }), {
    ...defaultAnnotationPromptRules,
    rect: '{批注}'
  })
  assert.equal(validAnnotationTemplate('没有占位符'), false)
  assert.equal(validAnnotationTemplate(`${'a'.repeat(1000)}{批注}`), false)
  assert.equal(validAnnotationTemplate('{批注}'), true)
})

test('formatting is one line and annotation contents are inserted literally', () => {
  assert.equal(
    formatAnnotationPrompt('  Edit {序号}:\n{批注}  ', ' a\r\nb $& {序号} ', 4),
    'Edit 4: a b $& {序号}'
  )
  assert.equal(formatAnnotationPrompt('{批注} / {批注}', '要求', 1), '要求 / 要求')
})
