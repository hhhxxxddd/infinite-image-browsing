import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createStudioDocument,
  createTextLayer,
  readStudioDocument,
  scaleStudioDocument,
  studioContentBounds,
  studioExportDocument
} from './imageStudioModel.ts'
import { readStudioTextEffects, studioTextEffectInsets } from './imageStudioTextEffects.ts'
import {
  clearStudioTextCache,
  paintStudioText,
  paintStudioTextLayer,
  retainStudioTextCache
} from './imageStudioTextRender.ts'

function composition() {
  const doc = createStudioDocument()
  doc.width = doc.height = 1000
  const layer = createTextLayer({ x: 300, y: 300, width: 200, height: 100 }, 'AB\nCD')
  layer.effects = readStudioTextEffects({
    fill: { mode: 'gradient', endColor: '#ef4444', angle: 0 },
    stroke: { enabled: true, color: '#ffffff', width: 4 },
    shadow: { enabled: true, color: '#000000', angle: 0, distance: 20, blur: 10 },
    glow: { enabled: true, color: '#60a5fa', range: 5 },
    background: { enabled: true, color: '#111827', radius: 6, opacity: 0.4 }
  })
  doc.layers = [layer]
  return { doc, layer }
}

test('all text effects survive reopening, including settings retained behind disabled switches', () => {
  const { doc, layer } = composition()
  layer.effects.glow.enabled = false
  const restored = readStudioDocument(JSON.parse(JSON.stringify(doc))).layers[0]
  assert.deepEqual(restored.effects, layer.effects)
  assert.equal(restored.color, layer.color)
  delete layer.effects
  assert.equal(readStudioDocument(doc).layers[0].effects, undefined)
  const malformed = readStudioTextEffects({
    stroke: { enabled: true, width: Infinity, color: 'url(evil)' },
    background: { opacity: -5 }
  })
  assert.equal(malformed.stroke.width, 2)
  assert.equal(malformed.stroke.color, '#ffffff')
  assert.equal(malformed.background.opacity, 0)
})

test('content export includes effect tails through mirroring and rotation, and disabled effects do not inflate bounds', () => {
  const { doc, layer } = composition()
  assert.deepEqual(studioTextEffectInsets(layer), { left: 17, right: 52, top: 32, bottom: 32 })
  assert.deepEqual(studioContentBounds(doc), { x: 283, y: 268, width: 269, height: 164 })
  layer.flipX = true
  assert.deepEqual(studioContentBounds(doc), { x: 248, y: 268, width: 269, height: 164 })
  layer.rotation = 90
  assert.deepEqual(studioContentBounds(doc), { x: 318, y: 198, width: 164, height: 269 })
  const exported = studioExportDocument(doc, true)
  assert.deepEqual([exported.width, exported.height], [164, 269])
  assert.deepEqual(exported.layers[0].effects, layer.effects)
  assert.equal(doc.layers[0].x, 300)
  layer.effects.stroke.enabled = layer.effects.shadow.enabled = layer.effects.glow.enabled = false
  layer.flipX = false
  layer.rotation = 0
  assert.deepEqual(studioContentBounds(doc), { x: 300, y: 300, width: 200, height: 100 })
})

test('scaling a document scales effect dimensions but leaves colors, direction, opacity and source unchanged', () => {
  const { doc, layer } = composition()
  const scaled = scaleStudioDocument(doc, 2000, 2000).layers[0]
  assert.equal(scaled.effects.stroke.width, 8)
  assert.equal(scaled.effects.shadow.distance, 40)
  assert.equal(scaled.effects.shadow.blur, 20)
  assert.equal(scaled.effects.glow.range, 10)
  assert.equal(scaled.effects.background.radius, 12)
  assert.equal(scaled.effects.background.opacity, 0.4)
  assert.equal(scaled.effects.fill.endColor, layer.effects.fill.endColor)
  assert.equal(layer.effects.stroke.width, 4)
})

function context() {
  const calls = []
  const ctx = {
    globalAlpha: 1,
    calls,
    save() {},
    restore() {},
    beginPath() {},
    clip() {},
    scale() {},
    translate() {},
    measureText(text) {
      return { width: [...text].length * 10 }
    },
    createLinearGradient(...coords) {
      const gradient = {
        stops: [],
        addColorStop(position, color) {
          this.stops.push([position, color])
        }
      }
      calls.push(['gradient', coords, gradient])
      return gradient
    },
    rect(...args) {
      calls.push(['clip', ...args])
    },
    roundRect(...args) {
      calls.push(['background', ...args])
    },
    fill() {
      calls.push(['background-fill', this.fillStyle, this.globalAlpha])
    },
    fillText(text, x, y) {
      calls.push([
        'text',
        text,
        x,
        y,
        this.shadowColor,
        this.shadowBlur,
        this.shadowOffsetX,
        this.shadowOffsetY
      ])
    },
    strokeText(text, x, y) {
      calls.push(['outline', text, x, y, this.strokeStyle, this.lineWidth])
    },
    moveTo() {},
    lineTo() {},
    stroke() {},
    drawImage(...args) {
      calls.push(['bitmap', ...args])
    }
  }
  return ctx
}

test('shared text painter renders multiline gradient, outline, background and density-correct soft effects', () => {
  const { layer } = composition()
  layer.fontSize = 20
  layer.letterSpacing = 5
  const ctx = context()
  paintStudioText(ctx, layer, 3)
  const gradient = ctx.calls.find((c) => c[0] === 'gradient')
  assert.deepEqual(gradient[1], [-100, -0, 100, 0])
  assert.deepEqual(gradient[2].stops, [
    [0, layer.color],
    [1, '#ef4444']
  ])
  assert.ok(ctx.calls.some((c) => c[0] === 'background-fill' && c[2] === 0.4))
  assert.ok(ctx.calls.some((c) => c[0] === 'text' && c[4] === '#60a5fa' && c[5] === 15))
  assert.ok(
    ctx.calls.some((c) => c[0] === 'text' && c[4] === '#000000' && c[5] === 30 && c[6] === 60)
  )
  assert.equal(ctx.calls.filter((c) => c[0] === 'outline').length, 4)
  assert.equal(ctx.shadowBlur, 0)
  assert.equal(ctx.shadowOffsetX, 0)
  assert.deepEqual(
    ctx.calls.find((c) => c[0] === 'clip'),
    ['clip', -117, -82, 269, 164]
  )
})

test('preview effect bitmaps are reused while moving, rotating and fading; edits and zoom invalidate them; export paints native density', (t) => {
  const previous = globalThis.document,
    bitmaps = []
  globalThis.document = {
    createElement() {
      const ctx = context()
      const bitmap = { width: 0, height: 0, ctx, getContext: () => ctx }
      bitmaps.push(bitmap)
      return bitmap
    }
  }
  clearStudioTextCache()
  t.after(() => {
    globalThis.document = previous
    clearStudioTextCache()
  })
  const { layer } = composition(),
    target = {},
    ctx = context()
  for (let i = 0; i < 8; i++)
    paintStudioTextLayer(
      ctx,
      { ...layer, x: i, rotation: i * 10, opacity: i / 10, flipX: i % 2 === 0 },
      target,
      2,
      true
    )
  assert.equal(bitmaps.length, 1)
  paintStudioTextLayer(ctx, { ...layer, text: 'Changed' }, target, 2, true)
  assert.equal(bitmaps.length, 2)
  paintStudioTextLayer(ctx, { ...layer, text: 'Changed' }, target, 3, true)
  assert.equal(bitmaps.length, 3)
  const changedEffect = structuredClone(layer)
  changedEffect.effects.glow.range = 24
  paintStudioTextLayer(ctx, changedEffect, target, 3, true)
  assert.equal(bitmaps.length, 4, 'changing an effect must regenerate its bitmap')
  paintStudioTextLayer(ctx, layer, target, 1, false)
  assert.deepEqual([bitmaps.at(-1).width, bitmaps.at(-1).height], [269, 164])
  retainStudioTextCache(target, new Set())
  paintStudioTextLayer(ctx, layer, target, 3, true)
  assert.equal(bitmaps.length, 6)
})
