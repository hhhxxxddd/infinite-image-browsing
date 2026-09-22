import test from 'node:test'
import assert from 'node:assert/strict'
import { getShortcutStrFromEvent, formatShortcut, shortcutRestriction } from './shortcut.ts'

test('normalizes physical keys while retaining every modifier', () => {
  assert.equal(getShortcutStrFromEvent({key:'d', code:'KeyD', altKey:true}), 'Alt + KeyD')
  assert.equal(getShortcutStrFromEvent({key:'D', code:'KeyD', shiftKey:true, ctrlKey:true, metaKey:true, altKey:true}), 'Shift + Ctrl + Cmd + Alt + KeyD')
  assert.equal(getShortcutStrFromEvent({key:'Delete', code:'Delete'}), 'Delete')
  assert.equal(getShortcutStrFromEvent({key:'Escape', code:'Escape'}), 'Esc')
})

test('does not record modifiers or IME composition as shortcuts', () => {
  for (const key of ['Shift','Control','Meta','Alt','AltGraph']) assert.equal(getShortcutStrFromEvent({key}), '')
  assert.equal(getShortcutStrFromEvent({key:'a', code:'KeyA', isComposing:true}), '')
})

test('rejects fixed and browser shortcuts but allows useful custom bindings', () => {
  for (const key of ['Esc','ArrowDown','Ctrl + ArrowUp','Digit0','Shift + KeyR','Equal','Ctrl + KeyA','Cmd + KeyW','Alt + F4']) assert.notEqual(shortcutRestriction(key), '', key)
  for (const key of ['KeyD','Delete','Alt + KeyD','Shift + Digit1','F2']) assert.equal(shortcutRestriction(key), '', key)
  assert.equal(formatShortcut('Ctrl + KeyD'), 'Ctrl + D')
  assert.equal(formatShortcut('Alt + Digit1'), 'Alt + 1')
})
