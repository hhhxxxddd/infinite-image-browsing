import test from 'node:test'
import assert from 'node:assert/strict'
import { getShortcutStrFromEvent, matchBrowseShortcut, browseShortcuts, imageStudioShortcuts } from './shortcut.ts'

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

test('browse actions use fixed keys with no modifiers', () => {
  assert.equal(matchBrowseShortcut('Delete'), 'delete')
  assert.equal(matchBrowseShortcut('KeyD'), 'download')
  assert.equal(matchBrowseShortcut('KeyL'), 'toggle_tag_like')
  assert.equal(matchBrowseShortcut('Ctrl + KeyD'), undefined)
  assert.equal(matchBrowseShortcut('Shift + Delete'), undefined)
  assert.equal(matchBrowseShortcut('KeyF'), undefined)
  assert.equal(browseShortcuts.find(item => item.keys === 'Delete')?.action, '删除选中媒体／当前文件')
  assert.ok(imageStudioShortcuts.some(item => item.keys === 'Ctrl / Cmd + G'))
})
