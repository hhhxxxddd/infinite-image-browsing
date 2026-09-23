import test from 'node:test'
import assert from 'node:assert/strict'
import { folderMoveTarget } from './folderMove.ts'

test('plans a move between category nodes', () => {
  assert.equal(folderMoveTarget('/photos/favorites', '/photos/archive', ['/photos']), '/photos/archive/favorites')
})

test('rejects root moves, loops, and moves to the current parent', () => {
  assert.throws(() => folderMoveTarget('/photos', '/archive', ['/photos']), /根目录/)
  assert.throws(() => folderMoveTarget('/photos/a', '/photos/a/child', ['/photos']), /自身/)
  assert.throws(() => folderMoveTarget('/photos/a', '/photos', ['/photos']), /目标位置/)
})

test('compares Windows paths without case or slash differences', () => {
  assert.throws(() => folderMoveTarget('C:\\Photos\\A', 'c:/photos/a/child', ['C:\\Photos'], true), /自身/)
  assert.equal(folderMoveTarget('C:\\Photos\\A', 'C:\\Photos\\B', ['C:\\Photos'], true), 'C:\\Photos\\B\\A')
})

test('keeps moves inside managed folders and protects nested registered folders', () => {
  assert.throws(() => folderMoveTarget('/other/a', '/photos', ['/photos']), /已添加文件夹内/)
  assert.throws(() => folderMoveTarget('/photos/a', '/other', ['/photos']), /目标必须/)
  assert.throws(() => folderMoveTarget('/photos/a', '/photos/b', ['/photos', '/photos/a/nested']), /包含已添加/)
})
