import test from 'node:test'
import assert from 'node:assert/strict'
import { findManagedFolder, topLevelManagedFolders } from './folderScope.ts'

test('matches registered descendants without matching sibling prefixes', () => {
  const folder = { path: '/photos', alias: 'Images' }
  assert.equal(findManagedFolder([folder], '/photos/child'), folder)
  assert.equal(findManagedFolder([folder], '/photos/'), folder)
  assert.equal(findManagedFolder([folder], '/photos-other'), undefined)
  assert.equal(findManagedFolder([folder], '/Photos'), undefined)
})

test('recognizes Windows paths and prefers the closest registered directory', () => {
  const folders = [{ path: 'C:\\Photos' }, { path: 'C:\\Photos\\Favorites' }]
  assert.equal(findManagedFolder(folders, 'c:/photos/FAVORITES/2026', true), folders[1])
  assert.equal(findManagedFolder(folders, 'C:/Photos-extra', true), undefined)
  assert.equal(findManagedFolder(folders, undefined, true), undefined)
})

test('tree roots collapse nested registrations while preserving sibling paths', () => {
  const folders = [{path:'/photos'},{path:'/photos/child'},{path:'/photos-other'}]
  assert.deepEqual(topLevelManagedFolders(folders), [folders[0],folders[2]])
  assert.deepEqual(topLevelManagedFolders([{path:'C:\\Photos'},{path:'c:/photos/Child'},{path:'c:/PHOTOS'}],true),[{path:'C:\\Photos'}])
})
