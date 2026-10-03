import assert from 'node:assert/strict'
import test from 'node:test'
import { createTextLayer } from './imageStudioModel.ts'
import {
  createStudioTextPreset,
  layoutStudioText,
  studioTextWidth,
  studioTextCharacters
} from './imageStudioText.ts'

test('long multiline text fits within its layer at render time', () => {
  const layer = createTextLayer(
    { x: 0, y: 0, width: 180, height: 100 },
    '今天吃了三碗饭\n明天也要吃三碗饭'
  )
  layer.fontSize = 80
  const context = {
    font: '',
    measureText(text) {
      const size = Number(/\s([\d.]+)px/.exec(this.font)?.[1] ?? 1)
      return { width: [...text].length * size }
    }
  }
  const layout = layoutStudioText(context, layer)
  assert.ok(layout.fontSize < layer.fontSize)
  assert.equal(layout.lines.join(''), layer.text.replaceAll('\n', ''))
  assert.ok(layout.lines.every((line) => context.measureText(line).width <= layer.width - 8))
  assert.ok(layout.lines.length * layout.lineHeight <= layer.height - 8)
})

test('text presets fit small portrait and 4K canvases with distinct hierarchy', () => {
  for (const canvas of [
    { width: 200, height: 300 },
    { width: 3840, height: 2160 }
  ]) {
    const layers = ['title', 'subtitle', 'body'].map((preset) =>
      createStudioTextPreset(canvas, preset)
    )
    assert.deepEqual(
      layers.map((layer) => layer.name),
      ['标题', '副标题', '正文']
    )
    assert.ok(layers[0].fontSize > layers[1].fontSize && layers[1].fontSize > layers[2].fontSize)
    assert.deepEqual(
      layers.map((layer) => layer.bold),
      [true, false, false]
    )
    assert.equal(layers[2].align, 'left')
    for (const layer of layers) {
      assert.ok(layer.x >= 0 && layer.x + layer.width <= canvas.width)
      assert.ok(layer.y >= 0 && layer.y + layer.height <= canvas.height)
    }
  }
})

test('spaced text keeps composed accents and joined emoji as complete characters', () => {
  const text = 'e\u0301👩‍💻A'
  assert.deepEqual(studioTextCharacters(text), ['e\u0301', '👩‍💻', 'A'])
  const context = { measureText: () => ({ width: 30 }) }
  assert.equal(studioTextWidth(context, text, 5), 40)
})

test('letter spacing participates in wrapping and italic font measurement; larger line spacing fits every line', () => {
  const layer = createTextLayer({ x: 0, y: 0, width: 88, height: 120 }, 'ABCD\nEFGH')
  layer.fontSize = 20
  const ctx = { font: '', measureText: (text) => ({ width: [...text].length * 20 }) }
  const normal = layoutStudioText(ctx, layer)
  const spaced = layoutStudioText(ctx, { ...layer, italic: true, letterSpacing: 4 })
  assert.ok(spaced.lines.length > normal.lines.length)
  assert.ok(ctx.font.startsWith('italic 700 '))
  assert.ok(spaced.lines.every((line) => studioTextWidth(ctx, line, 4) <= layer.width - 8))
  const tall = layoutStudioText(ctx, { ...layer, lineHeight: 3 })
  assert.ok(tall.fontSize < normal.fontSize)
  assert.ok(tall.lines.length * tall.lineHeight <= layer.height - 8)
  assert.equal(studioTextWidth(ctx, 'AB', -2), 38)
  assert.equal(studioTextWidth(ctx, '', 8), 0)
})
