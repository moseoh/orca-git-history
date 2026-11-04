// Runs src/worker.ts's activate(orca) over a mock host whose workspace list points at a real
// throwaway repository.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'
import { createTestRepo } from './testing/repo'

function workspaceList(path: string) {
  return {
    workspaces: [
      { id: 'local', kind: 'worktree', name: 'demo', path, branch: 'main', hostId: null },
      { id: 'here', kind: 'folder', name: 'here', path, branch: null, hostId: 'local' },
      { id: 'remote', kind: 'worktree', name: 'far', path: '/srv/far', branch: 'main', hostId: 'ssh-1' }
    ],
    truncated: false
  }
}

test('lists only local workspaces', async () => {
  const repo = await createTestRepo()
  try {
    const host = mockHost({ results: { 'workspace.list': workspaceList(repo.dir) } })
    const worker = await mountWorker(main, { host })
    assert.deepEqual(await worker.request('workspaces.list'), {
      workspaces: [
        { id: 'local', name: 'demo', kind: 'worktree', branch: 'main' },
        { id: 'here', name: 'here', kind: 'folder', branch: null }
      ]
    })
    await assert.rejects(worker.request('files.search', { workspaceId: 'remote', query: 'x' }), /not on this computer/)
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    repo.dispose()
  }
})

test('reuses the workspace list between requests', async () => {
  const repo = await createTestRepo()
  try {
    const host = mockHost({ results: { 'workspace.list': workspaceList(repo.dir) } })
    const worker = await mountWorker(main, { host })
    await worker.request('workspace.log', { workspaceId: 'local', skip: 0 })
    await worker.request('workspace.log', { workspaceId: 'local', skip: 0 })
    await worker.request('files.search', { workspaceId: 'local', query: '' })
    assert.equal(host.callsOf('workspace.list').length, 1)
    await worker.deactivate()
  } finally {
    repo.dispose()
  }
})

test('answers the project log, a commit’s files and one file’s diff', async () => {
  const repo = await createTestRepo()
  try {
    const host = mockHost({ results: { 'workspace.list': workspaceList(repo.dir) } })
    const worker = await mountWorker(main, { host })
    const log = await worker.request('workspace.log', { workspaceId: 'local', skip: 0 })
    assert.deepEqual(
      log.commits.map((item) => item.subject),
      ['Add d', 'Move hello', 'Shout b', 'Add hello']
    )
    assert.equal(log.hasMore, false)
    const hash = log.commits[0]?.hash ?? ''
    assert.deepEqual(await worker.request('commit.files', { workspaceId: 'local', hash }), {
      files: [{ status: 'M', path: 'src/greet.ts' }],
      truncated: false
    })
    const { diff } = await worker.request('file.diff', { workspaceId: 'local', hash, path: 'src/greet.ts' })
    assert.match(diff, /^\+d$/m)
    await worker.deactivate()
  } finally {
    repo.dispose()
  }
})

test('searches tracked files and remembers files whose history was opened', async () => {
  const repo = await createTestRepo()
  try {
    const host = mockHost({ results: { 'workspace.list': workspaceList(repo.dir) } })
    const worker = await mountWorker(main, { host })
    const found = await worker.request('files.search', { workspaceId: 'local', query: 'greet' })
    assert.deepEqual(found, { files: ['src/greet.ts', 'docs/greeting.md'], total: 2, recent: [] })

    await worker.request('file.log', { workspaceId: 'local', path: 'src/util.ts', skip: 0 })
    const { commits } = await worker.request('file.log', { workspaceId: 'local', path: 'src/greet.ts', skip: 0 })
    assert.equal(commits.length, 4)
    // A later page does not count as opening the file again.
    await worker.request('file.log', { workspaceId: 'local', path: 'src/util.ts', skip: 50 })
    const empty = await worker.request('files.search', { workspaceId: 'local', query: '' })
    assert.deepEqual(empty.recent, ['src/greet.ts', 'src/util.ts'])
    assert.deepEqual(host.data().storage, { 'recent:local': ['src/greet.ts', 'src/util.ts'] })
    await worker.deactivate()
  } finally {
    repo.dispose()
  }
})

test('opens a file in the editor by its workspace-relative path', async () => {
  const repo = await createTestRepo()
  try {
    const host = mockHost({
      results: { 'workspace.list': workspaceList(repo.dir), 'editor.open': { opened: true } }
    })
    const worker = await mountWorker(main, { host })
    assert.deepEqual(await worker.request('file.open', { workspaceId: 'local', path: 'src/greet.ts' }), {
      opened: true
    })
    assert.deepEqual(host.callsOf('editor.open'), [{ workspaceId: 'local', path: 'src/greet.ts' }])
    await assert.rejects(worker.request('file.open', { workspaceId: 'local', path: '../etc/passwd' }), /Not a path/)
    assert.equal(host.callsOf('editor.open').length, 1)
    assert.deepEqual(worker.refusals, [])
    await worker.deactivate()
  } finally {
    repo.dispose()
  }
})
