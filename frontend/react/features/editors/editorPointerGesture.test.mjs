import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('./editorPointerGesture.ts', import.meta.url), 'utf8')
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } })
const { EditorPointerGesture } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputText).toString('base64')}`
)

function start(scope = 'clip-a') {
  const gesture = new EditorPointerGesture(),
    events = []
  gesture.begin(
    scope,
    () => events.push('restore'),
    (cancelled) => events.push(['end', cancelled]),
    () => {
      events.push('release')
      gesture.finish(true)
    }
  )
  return { gesture, events }
}

test('one completed drag commits once even when release delivers lost capture', () => {
  const { gesture, events } = start()
  gesture.finish()
  gesture.finish()
  assert.deepEqual(events, [['end', false], 'release'])
})

test('Escape, pointer cancel, focus loss and unmount restore before discarding one preview transaction', () => {
  const { gesture, events } = start()
  gesture.finish(true)
  gesture.finish(true)
  assert.deepEqual(events, ['restore', ['end', true], 'release'])
})

test('selection and permission changes cancel, while unrelated rerenders preserve a held drag', () => {
  const { gesture, events } = start()
  gesture.cancelIf('clip-a', false)
  assert.deepEqual(events, [])
  gesture.cancelIf('clip-b', false)
  assert.deepEqual(events, ['restore', ['end', true], 'release'])
  const locked = start()
  locked.gesture.cancelIf('clip-a', true)
  assert.deepEqual(locked.events, ['restore', ['end', true], 'release'])
})

test('starting another drag cancels the previous owner before registering its callbacks', () => {
  const { gesture, events } = start()
  gesture.begin(
    'clip-b',
    () => events.push('new restore'),
    (cancelled) => events.push(['new end', cancelled]),
    () => events.push('new release')
  )
  gesture.finish()
  assert.deepEqual(events, ['restore', ['end', true], 'release', ['new end', false], 'new release'])
})

test('a rejected rollback still ends the transaction and releases capture', () => {
  const gesture = new EditorPointerGesture(),
    events = []
  gesture.begin(
    'clip-a',
    () => {
      throw new Error('readonly')
    },
    (cancelled) => events.push(['end', cancelled]),
    () => events.push('release')
  )
  assert.throws(() => gesture.finish(true), /readonly/)
  gesture.finish()
  assert.deepEqual(events, [['end', true], 'release'])
})
