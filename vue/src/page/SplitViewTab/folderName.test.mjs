import test from 'node:test'
import assert from 'node:assert/strict'
import { childFolderPath } from './folderName.ts'

test('creates exactly one child under Linux, drive roots and Windows network paths', () => {
  assert.equal(childFolderPath('/photos/', ' 收藏 '), '/photos/收藏')
  assert.equal(childFolderPath('/', 'pictures'), '/pictures')
  assert.equal(childFolderPath('E:\\', '图片', true), 'E:\\图片')
  assert.equal(childFolderPath('\\\\server\\share\\', '图片', true), '\\\\server\\share\\图片')
})

test('rejects empty names and paths that could escape or create nested folders', () => {
  for (const name of ['', '  ', '.', '..', '../other', 'a/b', 'a\\b', 'a\0b']) {
    assert.throws(() => childFolderPath('/photos', name))
  }
})

test('applies Windows filename rules only on Windows', () => {
  for (const name of ['CON', 'nul.txt', 'COM1', 'Lpt9.jpg', 'name.', 'a:b', 'a?b', 'a*b']) {
    assert.throws(() => childFolderPath('E:\\Photos', name, true))
  }
  assert.equal(childFolderPath('/photos', 'a:b'), '/photos/a:b')
  assert.equal(childFolderPath('E:\\Photos', 'console', true), 'E:\\Photos\\console')
})
