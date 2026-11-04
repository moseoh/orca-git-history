// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// The worker is stood in for by `requests`, so these tests cover only what the panel does.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { DIFF_CHUNK, diffChunks, focusedWorkspace } from './panel'
import type { BlameLine, Commit, Workspace } from './protocol'

const WORKSPACES: Workspace[] = [
  { id: 'w1', name: 'app', kind: 'worktree', branch: 'main' },
  { id: 'w2', name: 'app', kind: 'worktree', branch: 'feature' },
  { id: 'w3', name: 'notes', kind: 'folder', branch: null }
]

const COMMITS: Commit[] = [
  { hash: 'b'.repeat(40), shortHash: 'bbbbbbb', author: 'Grace', date: 2, subject: 'Shout b', path: 'src/a.ts' },
  { hash: 'a'.repeat(40), shortHash: 'aaaaaaa', author: 'Ada', date: 1, subject: 'Add a', path: 'src/a.ts' }
]

const PROJECT_LOG: Commit[] = [
  { hash: 'c'.repeat(40), shortHash: 'ccccccc', author: 'Ada', date: 3, subject: 'Tidy up' },
  ...COMMITS
]

const BLAME: BlameLine[] = [
  { line: 1, hash: 'a'.repeat(40), shortHash: 'aaaaaaaa', author: 'Ada', date: 1, summary: 'Add a', code: 'one', uncommitted: false },
  { line: 2, hash: '0'.repeat(40), shortHash: '00000000', author: 'Not Committed Yet', date: 3, summary: '', code: 'two', uncommitted: true }
]

const focusOn = (displayName: string, branch: string) => ({ context: { displayName, branch, terminals: [] } })

function host(failLog = false) {
  return mockHost({
    capabilities: ['workspace:read', 'workspace:write', 'storage:own'],
    requests: {
      'workspaces.list': () => ({ workspaces: WORKSPACES }),
      'workspace.log': ({ workspaceId }) => {
        if (failLog) throw new Error('fatal: not a git repository')
        return { commits: workspaceId === 'w2' ? PROJECT_LOG.slice(0, 1) : PROJECT_LOG }
      },
      'commit.show': ({ hash }) => ({ diff: ` src/a.ts | 1 +\n\ndiff for ${hash.slice(0, 1)}` }),
      'files.search': ({ query }) => ({
        files: query === '' ? [] : ['src/a.ts', 'src/ab.ts'],
        total: query === '' ? 0 : 2,
        recent: ['src/recent.ts']
      }),
      'file.history': () => ({ commits: COMMITS }),
      'commit.diff': ({ hash }) => ({ diff: `diff for ${hash.slice(0, 1)}\n+x` }),
      'file.blame': () => ({ lines: BLAME, truncated: false }),
      'lines.history': ({ start }) => ({
        commits: [{ ...COMMITS[0]!, diff: `@@ line ${start} @@\n+B` }]
      }),
      'file.open': () => ({ opened: true })
    }
  })
}

async function mountFocused(h = host()) {
  const view = await mount(panel, { host: h })
  await view.emit('workspace.changed', focusOn('app', 'main'))
  return view
}

test('asks for a project until Orca focuses one', async () => {
  const view = await mount(panel, { host: host() })
  await view.emit('workspace.changed', { context: null })
  assert.ok(view.find({ label: 'No project selected' }))
  assert.equal(view.find({ label: 'Workspace' }), null)
  await view.unmount()
})

test('shows the focused project’s commits and follows focus to another project', async () => {
  const view = await mountFocused()
  assert.ok(view.find({ text: 'app' }))
  assert.deepEqual(view.rowsOf({ label: 'Commits' }), PROJECT_LOG.map((item) => item.hash))
  assert.ok(view.find({ label: 'recent.ts' }))

  await view.selectRows({ label: 'Commits' }, [PROJECT_LOG[0]!.hash])
  assert.match(view.find({ label: 'Changes' })?.text ?? '', /diff for c/)

  await view.emit('workspace.changed', focusOn('app', 'feature'))
  assert.deepEqual(view.rowsOf({ label: 'Commits' }), [PROJECT_LOG[0]!.hash])
  assert.equal(view.find({ label: 'Changes' }), null)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a focused project Orca does not list locally is explained', async () => {
  const view = await mount(panel, { host: host() })
  await view.emit('workspace.changed', focusOn('far-away', 'main'))
  assert.ok(view.find({ label: 'far-away is not on this computer' }))
  await view.unmount()
})

test('finds a file, shows its history and a commit diff, then goes back', async () => {
  const view = await mountFocused()
  await view.type({ label: 'Find a file' }, 'a')
  await view.press({ label: 'a.ts' })
  assert.equal(view.valueOf({ label: 'Find a file' }), '')
  assert.deepEqual(view.rowsOf({ label: 'Commits that changed this file' }), [COMMITS[0]!.hash, COMMITS[1]!.hash])

  await view.selectRows({ label: 'Commits that changed this file' }, [COMMITS[1]!.hash])
  assert.match(view.find({ label: 'Diff' })?.text ?? '', /diff for a/)

  await view.press({ text: 'Open file' })
  await view.press({ label: 'Back to project commits' })
  assert.ok(view.find({ label: 'Commits' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('blame jumps to the commit in History', async () => {
  const view = await mountFocused()
  await view.type({ label: 'Find a file' }, 'a')
  await view.press({ label: 'a.ts' })
  await view.select({ label: 'File views' }, 'blame')
  assert.deepEqual(view.rowsOf({ label: 'Blame' }), ['1', '2'])
  await view.activateRow({ label: 'Blame' }, '1')
  assert.equal(view.valueOf({ label: 'File views' }), 'history')
  assert.deepEqual(view.valueOf({ label: 'Commits that changed this file' }), [COMMITS[1]!.hash])
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('line history shows the commits and diff for a range', async () => {
  const view = await mountFocused()
  await view.type({ label: 'Find a file' }, 'a')
  await view.press({ label: 'a.ts' })
  await view.select({ label: 'File views' }, 'lines')
  await view.type({ label: 'From line' }, '7')
  await view.press({ text: 'Show' })
  assert.deepEqual(view.rowsOf({ label: 'Commits that changed these lines' }), [COMMITS[0]!.hash])
  assert.match(view.find({ label: 'Line diff' })?.text ?? '', /line 7/)
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a worker failure shows as a callout', async () => {
  const view = await mountFocused(host(true))
  assert.ok(view.summary().includes('Callout danger "Git could not answer"'))
  await view.unmount()
})

test('matches the focused workspace by name and branch', () => {
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'app', branch: 'feature' })?.id, 'w2')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'app', branch: 'other' })?.id, 'w1')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'notes', branch: '' })?.id, 'w3')
  assert.equal(focusedWorkspace(WORKSPACES, { displayName: 'zzz', branch: 'main' }), null)
  assert.equal(focusedWorkspace(WORKSPACES, null), null)
})

test('splits long diffs on line breaks', () => {
  const text = Array.from({ length: 3000 }, (_, index) => `+line ${index}`).join('\n')
  const chunks = diffChunks(text)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => chunk.length <= DIFF_CHUNK))
  assert.equal(chunks.join('\n'), text)
})
