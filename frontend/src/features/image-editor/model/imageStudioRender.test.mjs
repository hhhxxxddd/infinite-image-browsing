import assert from 'node:assert/strict'
import test from 'node:test'
import { renderStudioDocument, clearStudioImageCache } from './imageStudioRender.ts'
import { createImageLayer, createStudioDocument, createTextLayer } from './imageStudioModel.ts'

function canvas() {
  const paints = [],
    translations = []
  let clears = 0,
    resizes = 0,
    width = 0,
    height = 0
  const ctx = {
    setTransform() {},
    scale() {},
    fillRect() {},
    save() {},
    restore() {},
    rotate() {},
    beginPath() {},
    roundRect() {},
    clip() {},
    clearRect() {
      clears++
      paints.length = 0
    },
    translate(x, y) {
      translations.push([x, y])
    },
    drawImage(image) {
      paints.push(image)
    }
  }
  return {
    ctx,
    paints,
    translations,
    get clears() {
      return clears
    },
    get resizes() {
      return resizes
    },
    get width() {
      return width
    },
    set width(value) {
      width = value
      resizes++
    },
    get height() {
      return height
    },
    set height(value) {
      height = value
      resizes++
    },
    getContext() {
      return ctx
    }
  }
}

function images(t, deferred = false) {
  const previous = globalThis.Image,
    instances = []
  globalThis.Image = class {
    naturalWidth = 1280
    naturalHeight = 1280
    set src(value) {
      this.url = value
      instances.push(this)
      if (!deferred) queueMicrotask(() => this.onload())
    }
  }
  clearStudioImageCache()
  t.after(() => {
    globalThis.Image = previous
    clearStudioImageCache()
  })
  return instances
}

test('immutable drag frames reuse decoded images and canvas allocation, clearing previous transparent pixels', async (t) => {
  const loaded = images(t),
    target = canvas(),
    doc = createStudioDocument()
  doc.background = 'transparent'
  doc.layers = Array.from({ length: 20 }, (_, i) =>
    createImageLayer(`/${i}.png`, { x: i * 3, y: 20, width: 100, height: 100 })
  )
  const files = Object.fromEntries(
    doc.layers.map((layer) => [layer.path, { fullpath: layer.path, name: layer.name, date: '1' }])
  )
  for (let frame = 0; frame < 8; frame++) {
    const next = { ...doc, layers: doc.layers.map((layer) => ({ ...layer, x: layer.x + frame })) }
    assert.deepEqual(await renderStudioDocument(target, next, files, true), [])
    assert.equal(target.paints.length, 20)
  }
  assert.equal(loaded.length, 20)
  assert.equal(target.resizes, 2)
  assert.equal(target.clears, 8)
  const changed = { ...files, '/0.png': { ...files['/0.png'], date: '2' } }
  await renderStudioDocument(target, doc, changed, true)
  assert.equal(loaded.length, 21, 'a changed file version must still refresh its bitmap')
})

test('obsolete asynchronous frames never publish pixels after a newer interaction', async (t) => {
  const loaded = images(t, true),
    target = canvas(),
    doc = createStudioDocument()
  doc.layers = [createImageLayer('/photo.png', { x: 0, y: 0, width: 100, height: 100 })]
  const files = { '/photo.png': { fullpath: '/photo.png', name: 'photo.png', date: '1' } }
  const controller = new AbortController()
  const old = renderStudioDocument(
    target,
    doc,
    files,
    true,
    { kind: 'all' },
    1200,
    false,
    controller.signal
  )
  controller.abort()
  const next = { ...doc, layers: [{ ...doc.layers[0], x: 250 }] }
  const current = renderStudioDocument(target, next, files, true)
  assert.equal(loaded.length, 1)
  loaded[0].onload()
  await Promise.all([old, current])
  assert.equal(target.clears, 1)
  assert.deepEqual(target.translations, [[300, 50]])
})

test('zoom redraws a small document at higher pixel density, reuses image decoding, and leaves native export size intact', async (t) => {
  const loaded = images(t),
    target = canvas(),
    doc = createStudioDocument()
  doc.width = 200
  doc.height = 300
  doc.layers = [createImageLayer('/photo.png', { x: 0, y: 0, width: 200, height: 300 })]
  const files = { '/photo.png': { fullpath: '/photo.png', name: 'photo.png', date: '1' } }
  await renderStudioDocument(target, doc, files, true, { kind: 'all' }, 1200, false, undefined, 3)
  assert.deepEqual([target.width, target.height], [600, 900])
  await renderStudioDocument(target, doc, files, true, { kind: 'all' }, 1200, false, undefined, 6)
  assert.deepEqual([target.width, target.height], [1200, 1800])
  assert.equal(loaded.length, 1)
  assert.deepEqual(
    target.translations,
    [
      [100, 150],
      [100, 150]
    ],
    'document coordinates do not change with preview density'
  )
  await renderStudioDocument(
    target,
    doc,
    files,
    false,
    { kind: 'all' },
    Infinity,
    false,
    undefined,
    6
  )
  assert.deepEqual([target.width, target.height], [200, 300])
  assert.deepEqual([doc.width, doc.height], [200, 300])
})

test('text styles, spacing, decoration and mirroring paint identically in preview and export', async () => {
  const doc = createStudioDocument()
  doc.layers = [
    {
      ...createTextLayer({ x: 0, y: 0, width: 200, height: 100 }, 'AB'),
      fontSize: 20,
      italic: true,
      underline: true,
      strike: true,
      letterSpacing: 5,
      flipX: true,
      align: 'right'
    }
  ]
  const draw = async (preview) => {
    const target = canvas(),
      calls = []
    Object.assign(target.ctx, {
      rect() {},
      measureText(text) {
        return { width: [...text].length * 10 }
      },
      fillText(text, x, y) {
        calls.push(['text', text, x, y, this.font])
      },
      moveTo(x, y) {
        calls.push(['decoration-start', x, y])
      },
      lineTo(x, y) {
        calls.push(['decoration-end', x, y])
      },
      stroke() {
        calls.push(['stroke'])
      },
      scale(x, y) {
        calls.push(['scale', x, y])
      }
    })
    await renderStudioDocument(target, doc, {}, preview)
    return calls
  }
  const preview = await draw(true)
  assert.deepEqual(preview, await draw(false))
  assert.ok(preview.some((call) => call[0] === 'scale' && call[1] === -1 && call[2] === 1))
  const glyphs = preview.filter((call) => call[0] === 'text')
  assert.equal(glyphs[0][1], 'A')
  assert.equal(glyphs[1][2] - glyphs[0][2], 15)
  assert.ok(glyphs[0][4].startsWith('italic 700 20px'))
  const starts = preview.filter((call) => call[0] === 'decoration-start')
  const ends = preview.filter((call) => call[0] === 'decoration-end')
  assert.equal(starts.length, 2)
  assert.deepEqual(
    ends.map((call, i) => call[1] - starts[i][1]),
    [25, 25]
  )
})

test('image flips are applied around the rotated frame in every fit mode, in preview and export', async (t) => {
  images(t)
  for (const fit of ['cover', 'contain', 'stretch']) {
    for (const [flipX, flipY] of [
      [true, false],
      [false, true],
      [true, true]
    ]) {
      const doc = createStudioDocument()
      const layer = {
        ...createImageLayer('/photo.png', { x: 20, y: 30, width: 200, height: 100 }),
        fit,
        flipX,
        flipY,
        rotation: 90,
        crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.4 }
      }
      doc.layers = [layer, createImageLayer('/plain.png', { x: 0, y: 0, width: 10, height: 20 })]
      const files = Object.fromEntries(
        doc.layers.map((item) => [item.path, { fullpath: item.path, name: item.name }])
      )
      const draw = async (preview) => {
        const target = canvas(),
          calls = []
        for (const name of ['save', 'translate', 'rotate', 'scale', 'restore'])
          target.ctx[name] = (...args) => calls.push([name, ...args])
        target.ctx.drawImage = (_image, ...args) => calls.push(['draw', ...args])
        await renderStudioDocument(target, doc, files, preview)
        return calls
      }
      const calls = await draw(true)
      assert.deepEqual(calls, await draw(false))
      assert.deepEqual(calls.slice(1, 5), [
        ['save'],
        ['translate', 120, 80],
        ['rotate', Math.PI / 2],
        ['scale', flipX ? -1 : 1, flipY ? -1 : 1]
      ])
      const firstDraw = calls.find((call) => call[0] === 'draw')
      assert.deepEqual(firstDraw.slice(1, 5), [128, 256, 640, 512])
      const restore = calls.findIndex((call) => call[0] === 'restore')
      assert.deepEqual(calls.slice(restore, restore + 5), [
        ['restore'],
        ['save'],
        ['translate', 5, 10],
        ['rotate', 0],
        ['scale', 1, 1]
      ])
    }
  }
})
