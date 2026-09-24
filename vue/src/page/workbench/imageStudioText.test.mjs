import assert from 'node:assert/strict'
import test from 'node:test'
import { createTextLayer } from './imageStudioModel.ts'
import { layoutStudioText } from './imageStudioText.ts'

test('long multiline text fits within its layer at render time', () => {
  const layer = createTextLayer({ x: 0, y: 0, width: 180, height: 100 }, '今天吃了三碗饭\n明天也要吃三碗饭')
  layer.fontSize = 80
  const context = { font: '', measureText(text) {
    const size = Number(/\s([\d.]+)px/.exec(this.font)?.[1] ?? 1)
    return { width: [...text].length * size }
  } }
  const layout = layoutStudioText(context, layer)
  assert.ok(layout.fontSize < layer.fontSize)
  assert.equal(layout.lines.join(''), layer.text.replaceAll('\n', ''))
  assert.ok(layout.lines.every(line => context.measureText(line).width <= layer.width - 8))
  assert.ok(layout.lines.length * layout.lineHeight <= layer.height - 8)
})
