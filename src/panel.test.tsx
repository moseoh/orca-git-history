// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
// The worker is stood in for by `requests`, so these tests cover only what the panel does.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { ago, DIFF_CHUNK, diffChunks, focusedWorkspace, projectItems } from './panel'
import type { Commit, Workspace } from './protocol'

const WORKSPACES: Workspace[] = [
  { id: 'w1', name: 'app', kind: 'worktree', branch: 'main' },
  { id: 'w2', name: 'app', kind: 'worktree', branch: 'feature' },
  { id: 'w3', name: 'notes', kind: 'folder', branch: null }
]

const commit = (letter: string, subject: string, extra: Partial<Commit> = {}): Commit => ({
  hash: letter.repeat(40),
  shortHash: letter.repeat(7),
  author: 'Ada',
  date: Date.now() - 3_600_000,
  subject,
  ...extra
})

const PROJECT_LOG = [commit('c', 'Tidy up'), commit('b', 'Shout b'), commit('a', 'Add a')]
const FILE_LOG = [commit('b', 'Shout b', { path: 'src/a.ts' }), commit('a', 'Add a', { path: 'src/old.ts' })]

const focusOn = (displayName: string, branch: string) => ({ context: { displayName, branch, terminals: [] } })

function host(options: { failLog?: boolean; pages?: boolean } = {}) {
  return mockHost({
    capabilities: ['workspace:read', 'workspace:write', 'storage:own'],
    requests: {
      'workspaces.list': () => ({ workspaces: WORKSPACES }),
      'workspace.log': ({ workspaceId, skip }) => {
        if (options.failLog) throw new Error('fatal: not a git repository')
        if (workspaceId === 'w2') return { commits: PROJECT_LOG.slice(0, 1), hasMore: false }
        if (options.pages) return { commits: PROJECT_LOG.slice(skip, skip + 2), hasMore: skip === 0 }
        return { commits: PROJECT_LOG, hasMore: false }
      },
      'file.log': () => ({ commits: FILE_LOG, hasMore: false }),
      'commit.files': () => ({
        files: [
          { status: 'M', path: 'src/a.ts' },
          { status: 'A', path: 'README.md' }
        ],
        truncated: false
      }),
      'file.diff': ({ hash, path }) => ({ diff: `diff ${hash.slice(0, 1)} ${path}\n+x` }),
      'files.search': ({ query }) => ({
        files: query === '' ? [] : ['src/a.ts', 'src/ab.ts'],
        total: query === '' ? 0 : 2,
        recent: ['src/recent.ts']
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

const C = (letter: string) => `c:${letter.repeat(40)}`

test('asks for a project until Orca focuses one', async () => {
  const view = await mount(panel, { host: host() })
  await view.emit('workspace.changed', { context: null })
  assert.ok(view.find({ label: 'No project selected' }))
  await view.unmount()
})

test('shows the focused project’s commits and follows focus to another project', async () => {
  const view = await mountFocused()
  assert.ok(view.find({ text: 'app' }))
  assert.ok(view.summary().some((line) => line.startsWith('Tree "Commits"')))
  assert.ok(view.find({ text: /Tidy up/ }))
  assert.ok(view.find({ label: 'Recent files' }))

  await view.emit('workspace.changed', focusOn('app', 'feature'))
  assert.equal(view.find({ text: /Shout b/ }), null)
  assert.ok(view.find({ text: /Tidy up/ }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a focused project Orca does not list locally is explained', async () => {
  const view = await mount(panel, { host: host() })
  await view.emit('workspace.changed', focusOn('far-away', 'main'))
  assert.ok(view.find({ label: 'far-away is not on this computer' }))
  await view.unmount()
})

test('expanding a commit lists its files; picking one shows only that file’s diff', async () => {
  const h = host()
  const view = await mountFocused(h)
  await view.selectItem({ label: 'Commits' }, C('b'))
  assert.deepEqual(view.expandedOf({ label: 'Commits' }), [C('b')])

  await view.selectItem({ label: 'Commits' }, `f:${'b'.repeat(40)}:src/a.ts`)
  assert.match(view.find({ label: 'Diff' })?.text ?? '', /diff b src\/a\.ts/)

  await view.press({ label: 'Open file' })
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})

test('the expand arrow loads a commit’s files too', async () => {
  const view = await mountFocused()
  await view.expand({ label: 'Commits' }, C('a'))
  assert.deepEqual(view.expandedOf({ label: 'Commits' }), [C('a')])
  await view.collapse({ label: 'Commits' }, C('a'))
  assert.deepEqual(view.expandedOf({ label: 'Commits' }), [])
  await view.unmount()
})

test('Load more appends the next page', async () => {
  const view = await mountFocused(host({ pages: true }))
  assert.equal(view.find({ text: /Add a/ }), null)
  await view.press({ text: 'Load more' })
  assert.ok(view.find({ text: /Add a/ }))
  assert.equal(view.find({ text: 'Load more' }), null)
  await view.unmount()
})

test('a searched file lists its commits; a commit shows the file at its old path', async () => {
  const view = await mountFocused()
  await view.type({ label: 'Find a file' }, 'a')
  await view.press({ label: 'a.ts' })
  assert.equal(view.valueOf({ label: 'Find a file' }), '')
  await view.selectItem({ label: 'Commits that changed this file' }, C('a'))
  assert.match(view.find({ label: 'Diff' })?.text ?? '', /diff a src\/old\.ts/)

  await view.press({ label: 'Back to project commits' })
  assert.ok(view.find({ label: 'Commits' }))
  assert.deepEqual(view.errors, [])
  await view.unmount()
})

test('a worker failure shows as a callout', async () => {
  const view = await mountFocused(host({ failLog: true }))
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

test('commit rows read message first, then sha, author and age', () => {
  const [row] = projectItems([commit('a', 'Add a', { date: 0 })], {})
  assert.equal(row?.label, 'Add a')
  assert.match(row?.description ?? '', /^\d+y · Ada · aaaaaaa$/)
  assert.equal(row?.hasChildren, true)
  assert.equal(ago(0, 59_000), 'now')
  assert.equal(ago(0, 5 * 60_000), '5m')
  assert.equal(ago(0, 3 * 3_600_000), '3h')
  assert.equal(ago(0, 2 * 86_400_000), '2d')
})

test('splits long diffs on line breaks', () => {
  const text = Array.from({ length: 3000 }, (_, index) => `+line ${index}`).join('\n')
  const chunks = diffChunks(text)
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => chunk.length <= DIFF_CHUNK))
  assert.equal(chunks.join('\n'), text)
})
