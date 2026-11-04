import { assert, test } from 'orca/testing'
import type { Workspace } from './protocol'
import { ago, focusedWorkspace } from './workspace'

const WORKSPACES: Workspace[] = [
  { id: 'w1', name: 'app', kind: 'worktree', branch: 'main' },
  { id: 'w2', name: 'app', kind: 'worktree', branch: 'feature' },
  { id: 'w3', name: 'notes', kind: 'folder', branch: null }
]

test('matches the focused workspace by name and branch', () => {
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'app', branch: 'feature' })?.id, 'w2')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'app', branch: 'other' })?.id, 'w1')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'notes', branch: '' })?.id, 'w3')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'zzz', branch: 'main' }), null)
  assert.equal(focusedWorkspace(WORKSPACES, null), null)
})

test('ages read short', () => {
  assert.equal(ago(0, 59_000), 'now')
  assert.equal(ago(0, 5 * 60_000), '5m')
  assert.equal(ago(0, 3 * 3_600_000), '3h')
  assert.equal(ago(0, 2 * 86_400_000), '2d')
})
