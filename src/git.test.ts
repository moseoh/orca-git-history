// Runs real git against a throwaway repository, plus the parsers on edge-case output.
import { assert, test } from 'orca/testing'
import * as git from './git'
import { searchFiles } from './search'
import { createTestRepo } from './testing/repo'

test('workspace log pages through the branch, newest first', async () => {
  const repo = await createTestRepo()
  try {
    const first = await git.workspaceLog(repo.dir, 0)
    assert.deepEqual(
      first.commits.map((item) => [item.subject, item.author]),
      [
        ['Add d', 'Grace'],
        ['Move hello', 'Ada'],
        ['Shout b', 'Grace'],
        ['Add hello', 'Ada']
      ]
    )
    assert.equal(first.hasMore, false)
    assert.equal(first.commits[3]?.date, Date.parse('2024-01-01T10:00:00Z'))

    for (let index = 0; index < git.LIMITS.pageSize; index += 1) {
      await git.git(repo.dir, ['-c', 'user.name=Bot', '-c', 'user.email=bot@example.com', 'commit', '-q', '--allow-empty', '-m', `Empty ${index}`])
    }
    const page1 = await git.workspaceLog(repo.dir, 0)
    assert.equal(page1.commits.length, git.LIMITS.pageSize)
    assert.equal(page1.hasMore, true)
    const page2 = await git.workspaceLog(repo.dir, git.LIMITS.pageSize)
    assert.deepEqual(
      page2.commits.map((item) => item.subject),
      ['Add d', 'Move hello', 'Shout b', 'Add hello']
    )
    assert.equal(page2.hasMore, false)
    await assert.rejects(git.workspaceLog(repo.dir, -1), /page offset/)
  } finally {
    repo.dispose()
  }
})

test('file log follows the rename and records each path', async () => {
  const repo = await createTestRepo()
  try {
    const { commits, hasMore } = await git.fileLog(repo.dir, 'src/greet.ts', 0)
    assert.equal(hasMore, false)
    assert.deepEqual(
      commits.map((item) => [item.subject, item.path, item.oldPath]),
      [
        ['Add d', 'src/greet.ts', undefined],
        ['Move hello', 'src/greet.ts', 'hello.ts'],
        ['Shout b', 'hello.ts', undefined],
        ['Add hello', 'hello.ts', undefined]
      ]
    )
  } finally {
    repo.dispose()
  }
})

test('changed files list what a commit did, the root commit included', async () => {
  const repo = await createTestRepo()
  try {
    const { commits } = await git.workspaceLog(repo.dir, 0)
    const byName = (subject: string) => commits.find((item) => item.subject === subject)?.hash ?? ''
    assert.deepEqual((await git.changedFiles(repo.dir, byName('Move hello'))).files, [
      { status: 'R', path: 'src/greet.ts', oldPath: 'hello.ts', additions: 0, deletions: 0 }
    ])
    assert.deepEqual((await git.changedFiles(repo.dir, byName('Add d'))).files, [
      { status: 'M', path: 'src/greet.ts', additions: 1, deletions: 0 }
    ])
    const root = await git.changedFiles(repo.dir, byName('Add hello'))
    assert.deepEqual(
      root.files.map((item) => `${item.status} ${item.path}`).sort(),
      ['A README.md', 'A docs/greeting.md', 'A hello.ts', 'A src/util.ts']
    )
    await assert.rejects(git.changedFiles(repo.dir, '--all'), /Not a commit hash/)
  } finally {
    repo.dispose()
  }
})

test('commit info has the whole message, parents and author', async () => {
  const repo = await createTestRepo()
  try {
    await git.git(repo.dir, ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', 'commit', '-q', '--allow-empty', '-m', 'Subject line', '-m', 'Body one.\n\nBody two.'])
    const { commits } = await git.workspaceLog(repo.dir, 0)
    const info = await git.commitInfo(repo.dir, commits[0]?.hash ?? '')
    assert.equal(info.message, 'Subject line\n\nBody one.\n\nBody two.')
    assert.equal(info.author, 'Ada')
    assert.equal(info.email, 'ada@example.com')
    assert.deepEqual(info.parents, [commits[1]?.hash])
    const root = await git.commitInfo(repo.dir, commits[commits.length - 1]?.hash ?? '')
    assert.deepEqual(root.parents, [])
  } finally {
    repo.dispose()
  }
})

test('numstat parser reads renames and binary files', () => {
  const counts = git.parseNumstat('3\t1\tsrc/a.ts\0-\t-\timg.png\0' + '0\t0\t\0old.ts\0new.ts\0')
  assert.deepEqual([...counts.entries()], [
    ['src/a.ts', { additions: 3, deletions: 1 }],
    ['img.png', null],
    ['new.ts', { additions: 0, deletions: 0 }]
  ])
})

test('a merge lists and diffs what it brought in from the other branch', async () => {
  const repo = await createTestRepo()
  try {
    const run = (args: string[]) =>
      git.git(repo.dir, ['-c', 'user.name=Ada', '-c', 'user.email=ada@example.com', ...args])
    await run(['checkout', '-q', '-b', 'side'])
    await run(['rm', '-q', 'docs/greeting.md'])
    await run(['commit', '-q', '-m', 'Drop greeting'])
    await run(['checkout', '-q', 'main'])
    await run(['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'])
    const merge = (await git.workspaceLog(repo.dir, 0)).commits[0]
    assert.equal(merge?.subject, 'Merge side')
    assert.deepEqual((await git.changedFiles(repo.dir, merge.hash)).files, [
      { status: 'D', path: 'docs/greeting.md', additions: 0, deletions: 1 }
    ])
    assert.match(await git.fileDiff(repo.dir, merge.hash, 'docs/greeting.md'), /^-hi$/m)
  } finally {
    repo.dispose()
  }
})

test('file diff shows one file in one commit, rename sides included', async () => {
  const repo = await createTestRepo()
  try {
    const { commits } = await git.fileLog(repo.dir, 'src/greet.ts', 0)
    const shout = commits.find((item) => item.subject === 'Shout b')
    assert.ok(shout)
    const diff = await git.fileDiff(repo.dir, shout.hash, shout.path ?? '', shout.oldPath)
    assert.match(diff, /^-b$/m)
    assert.match(diff, /^\+B$/m)
    assert.ok(!diff.includes('README'))
    const move = commits.find((item) => item.subject === 'Move hello')
    assert.ok(move)
    assert.match(await git.fileDiff(repo.dir, move.hash, move.path ?? '', move.oldPath), /rename from hello\.ts/)
    await assert.rejects(git.fileDiff(repo.dir, '--help', 'src/greet.ts'), /Not a commit hash/)
  } finally {
    repo.dispose()
  }
})

test('paths that leave the workspace or look like options are refused', async () => {
  for (const bad of ['', '/etc/passwd', '../x', 'a/../../x', '-p', 'a//b', 'a\\b']) {
    assert.throws(() => git.checkRelativePath(bad), /Not a path inside/)
  }
  assert.equal(git.checkRelativePath('src/a b.ts'), 'src/a b.ts')
})

test('git errors carry git’s own first line', async () => {
  const repo = await createTestRepo()
  try {
    await assert.rejects(git.workspaceLog(`${repo.dir}/nope`, 0), (error) => error instanceof git.GitError)
    await assert.rejects(git.fileDiff(repo.dir, 'abcdef1', 'x'), /fatal|bad|unknown/)
  } finally {
    repo.dispose()
  }
})

test('long diffs are cut on a line break', () => {
  const diff = Array.from({ length: 30_000 }, (_, index) => `+line ${index}`).join('\n')
  const capped = git.capDiff(diff)
  assert.ok(capped.length <= git.LIMITS.diffChars + 20)
  assert.match(capped, /\n… diff truncated$/)
})

test('search ranks file-name matches first and needs every word', () => {
  const files = ['src/greet.ts', 'docs/greeting.md', 'greet/index.ts', 'src/util.ts', 'README.md']
  assert.deepEqual(searchFiles(files, 'greet').files, ['src/greet.ts', 'docs/greeting.md', 'greet/index.ts'])
  assert.deepEqual(searchFiles(files, 'src greet').files, ['src/greet.ts'])
  assert.deepEqual(searchFiles(files, '  '), { files: [], total: 0 })
  assert.equal(searchFiles(files, 'READ').files[0], 'README.md')
})
