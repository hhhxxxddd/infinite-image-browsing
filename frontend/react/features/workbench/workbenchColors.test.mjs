import assert from 'node:assert/strict'
import test from 'node:test'
import { workbenchAccentProps, workbenchColorPresets } from './workbenchColors.ts'

test('automatic colors stay stable and explicit colors take precedence across work IDs', () => {
  assert.deepEqual(workbenchAccentProps('work-one'), workbenchAccentProps('work-one'))
  assert.deepEqual(workbenchAccentProps('work-one', 'bad-color'), workbenchAccentProps('work-one'))
  for (const preset of workbenchColorPresets) {
    const first = workbenchAccentProps('work-one', preset.color)
    assert.equal(first['data-accent'], preset.id)
    assert.deepEqual(first, workbenchAccentProps('work-two', preset.color.toUpperCase()))
  }
  const custom = workbenchAccentProps('work-one', '#135')
  assert.equal(custom['data-accent'], 'custom')
  assert.deepEqual(custom, workbenchAccentProps('work-two', '#113355'))
})
