import assert from 'node:assert/strict'
import test from 'node:test'
import {
  materialScrollSettled,
  materialScrollTarget,
  stepMaterialScroll
} from './materialScrollMotion.ts'

function settle(state, maxScroll) {
  for (let index = 0; index < 120; index++) {
    state = stepMaterialScroll(state, maxScroll, 1 / 60, true)
    assert.ok(state.position >= -24 && state.position <= maxScroll + 24)
  }
  assert.ok(materialScrollSettled(state))
  return state
}

test('wheel distance is followed gradually and settles without multiplying trackpad momentum', () => {
  let target = 0
  for (const delta of [120, 45, 22, 8, 3, 2]) target = materialScrollTarget(target, delta, 1000)
  const state = stepMaterialScroll({ position: 0, target, velocity: 0 }, 1000, 1 / 60, false)
  assert.ok(state.position > 0 && state.position < target)
  assert.equal(settle(state, 1000).position, 200)
})

test('both edges resist additional input, bound the pull and release immediately on reversal', () => {
  let left = 0
  let right = 1000
  for (let index = 0; index < 20; index++) {
    left = materialScrollTarget(left, -120, 1000)
    right = materialScrollTarget(right, 120, 1000)
  }
  assert.equal(left, -24)
  assert.equal(right, 1024)
  assert.equal(materialScrollTarget(left, 30, 1000), 6)
  assert.equal(materialScrollTarget(right, -30, 1000), 994)
  assert.equal(materialScrollTarget(990, 20, 1000), 1002)
})

test('a released edge pull springs back to each boundary without leaking scroll distance', () => {
  for (const [position, target, boundary] of [
    [0, -24, 0],
    [1000, 1024, 1000]
  ]) {
    let state = { position, target, velocity: 0 }
    for (let index = 0; index < 6; index++) state = stepMaterialScroll(state, 1000, 1 / 60, false)
    assert.ok(Math.abs(state.position - boundary) > 10)
    assert.equal(settle(state, 1000).position, boundary)
  }
})

test('a strip without overflow still pulls in both directions and returns to its only boundary', () => {
  for (const delta of [-120, 120]) {
    const target = materialScrollTarget(0, delta, 0)
    let state = { position: 0, target, velocity: 0 }
    for (let index = 0; index < 6; index++) state = stepMaterialScroll(state, 0, 1 / 60, false)
    assert.ok(Math.abs(state.position) > 10 && Math.abs(state.position) <= 24)
    assert.equal(settle(state, 0).position, 0)
    const reversed = materialScrollTarget(target, -delta, 0)
    assert.ok(reversed * delta < 0)
    assert.equal(settle({ ...state, target: reversed }, 0).position, 0)
  }
})

test('damping feels the same at 30, 60 and 120 Hz', () => {
  const results = [30, 60, 120].map((hz) => {
    let state = { position: 0, target: 600, velocity: 0 }
    for (let index = 0; index < hz / 5; index++)
      state = stepMaterialScroll(state, 1000, 1 / hz, false)
    return state
  })
  for (const state of results) {
    assert.ok(Math.abs(state.position - results[0].position) < 0.000001)
    assert.ok(Math.abs(state.velocity - results[0].velocity) < 0.000001)
  }
})

test('changing direction during motion settles at the latest target', () => {
  let state = stepMaterialScroll({ position: 500, target: 800, velocity: 0 }, 1000, 0.05, false)
  state.target = materialScrollTarget(state.target, -450, 1000)
  assert.equal(settle(state, 1000).position, 350)
  const resumed = stepMaterialScroll({ position: 0, target: -24, velocity: -100 }, 1000, 10, true)
  assert.ok(Number.isFinite(resumed.position) && Number.isFinite(resumed.velocity))
  assert.equal(settle(resumed, 1000).position, 0)
})
