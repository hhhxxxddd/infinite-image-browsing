import test from 'node:test'
import assert from 'node:assert/strict'
import { comparisonTextDiff } from './comparisonTextDiff.ts'

test('text comparison preserves both originals and highlights changed words', () => {
  const left = 'Prompt: blue mountain\nSteps: 20'
  const right = 'Prompt: red mountain\nSteps: 30'
  const result = comparisonTextDiff(left, right)
  assert.equal(result.left.map((part) => part.text).join(''), left)
  assert.equal(result.right.map((part) => part.text).join(''), right)
  assert.ok(result.left.some((part) => part.changed && part.text.includes('blue')))
  assert.ok(result.right.some((part) => part.changed && part.text.includes('red')))
})
