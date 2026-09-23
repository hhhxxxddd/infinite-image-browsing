import assert from 'node:assert/strict'
import test from 'node:test'
import { remapFolderPath } from './folderRenamePath.ts'

test('renamed folder updates open descendants without touching sibling tabs', () => {
  assert.equal(remapFolderPath('/photos/old', '/photos/old', '/photos/new'), '/photos/new')
  assert.equal(remapFolderPath('/photos/old/deep', '/photos/old', '/photos/new'), '/photos/new/deep')
  assert.equal(remapFolderPath('/photos/older', '/photos/old', '/photos/new'), undefined)
})

test('Windows paths match independent of slash and case', () => {
  assert.equal(remapFolderPath('C:\\Photos\\Old\\Deep', 'c:/photos/old', 'C:\\Photos\\New', true), 'C:\\Photos\\New\\Deep')
})
