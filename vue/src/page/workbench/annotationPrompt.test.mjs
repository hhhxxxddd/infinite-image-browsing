import assert from 'node:assert/strict'
import test from 'node:test'
import { extractAnnotationPrompt, mergeAnnotationPrompt } from './annotationPrompt.ts'
import { createStudioDocument, createGuideLayer, createPaintLayer } from './imageStudioModel.ts'

test('mixed annotations follow numeric labels with stable ties and one line per annotation', () => {
  const doc = createStudioDocument()
  const frame = { x: 0, y: 0, width: 50, height: 50 }
  const box = { ...createGuideLayer(frame), name: '提示框 10', prompt: '保留颜色', color: '#00ff00' }
  const arrow = { ...createGuideLayer(frame, 'arrow'), name: '箭头 2', prompt: '增加\n纹理' }
  const paint = { ...createPaintLayer(50, 50), name: '涂抹 1', prompt: '替换背景' }
  const otherBox = { ...box, id: 'other', name: '提示框 2', prompt: '调整亮度' }
  doc.layers = [box, arrow, paint, otherBox]
  assert.equal(extractAnnotationPrompt(doc), '去掉涂抹标注，并编辑其覆盖的区域: 替换背景\n修改箭头指向的区域: 增加 纹理\n修改方框内的区域: 调整亮度\n修改方框内的区域: 保留颜色')
})

test('hidden layers, hidden groups and empty annotations are excluded', () => {
  const doc = createStudioDocument()
  doc.groups = [{ id: 'hidden', visible: false }]
  const paint = createPaintLayer(50, 50)
  doc.layers = [{ ...paint, prompt: '隐藏', visible: false }, { ...paint, prompt: '隐藏组', groupId: 'hidden' }, paint]
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
