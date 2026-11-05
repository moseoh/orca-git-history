import { assert, test } from 'orca/testing'
import type { Workspace } from './protocol'
import { ago, focusedWorkspace } from './workspace'

const WORKSPACES: Workspace[] = [
  { id: 'w1', name: 'app', kind: 'worktree', branch: 'main' },
  { id: 'w2', name: 'app', kind: 'worktree', branch: 'feature' },
  { id: 'w3', name: 'notes', kind: 'folder', branch: null },
  { id: 'w4', name: 'site', kind: 'folder', branch: 'main' }
]

test('matches the focused workspace by name and branch', () => {
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'app', branch: 'feature' })?.id, 'w2')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'app', branch: 'main' })?.id, 'w1')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'zzz', branch: 'main' }), null)
  assert.equal(focusedWorkspace(WORKSPACES, null), null)
})

test('a folder project matches with its checkout branch or with none', () => {
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'notes', branch: '' })?.id, 'w3')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'site', branch: 'main' })?.id, 'w4')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'site', branch: '' })?.id, 'w4')
})

test('a same-named project elsewhere (remote server, SSH) is not taken for a local one', () => {
  // `notes` here is a plain folder; a remote `notes` on branch main must not resolve to it.
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'notes', branch: 'main' }), null)
  // A local `app` exists on main and feature; a remote `app` on another branch matches neither.
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'app', branch: 'release' }), null)
})

test('ages read short', () => {
  assert.equal(ago(0, 59_000), 'now')
  assert.equal(ago(0, 5 * 60_000), '5m')
  assert.equal(ago(0, 3 * 3_600_000), '3h')
  assert.equal(ago(0, 2 * 86_400_000), '2d')
})
