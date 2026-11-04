// Runs real git against a throwaway repository, plus the parsers on edge-case output.
import { assert, test } from 'orca/testing'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as git from './git'
import { searchFiles } from './search'
import { createTestRepo } from './testing/repo'

test('file history follows the rename and records each path', async () => {
  const repo = await createTestRepo()
  try {
    const commits = await git.fileHistory(repo.dir, 'src/greet.ts')
    assert.deepEqual(
      commits.map((item) => [item.subject, item.author, item.path, item.oldPath]),
      [
        ['Add d', 'Grace', 'src/greet.ts', undefined],
        ['Move hello', 'Ada', 'src/greet.ts', 'hello.ts'],
        ['Shout b', 'Grace', 'hello.ts', undefined],
        ['Add hello', 'Ada', 'hello.ts', undefined]
      ]
    )
    assert.equal(commits[3]?.date, Date.parse('2024-01-01T10:00:00Z'))
    assert.equal(commits[0]?.shortHash, commits[0]?.hash.slice(0, commits[0].shortHash.length))
  } finally {
    repo.dispose()
  }
})

test('commit diff uses the path the file had in that commit', async () => {
  const repo = await createTestRepo()
  try {
    const commits = await git.fileHistory(repo.dir, 'src/greet.ts')
    const shout = commits.find((item) => item.subject === 'Shout b')
    assert.ok(shout)
    const diff = await git.commitDiff(repo.dir, shout.hash, shout.path ?? '', shout.oldPath)
    assert.match(diff, /^-b$/m)
    assert.match(diff, /^\+B$/m)
    const move = commits.find((item) => item.subject === 'Move hello')
    assert.ok(move)
    const rename = await git.commitDiff(repo.dir, move.hash, move.path ?? '', move.oldPath)
    assert.match(rename, /rename from hello\.ts/)
    await assert.rejects(git.commitDiff(repo.dir, '--help', 'src/greet.ts'), /Not a commit hash/)
  } finally {
    repo.dispose()
  }
})

test('workspace log lists the branch’s commits and a commit shows all its changes', async () => {
  const repo = await createTestRepo()
  try {
    const commits = await git.workspaceLog(repo.dir)
    assert.deepEqual(
      commits.map((item) => item.subject),
      ['Add d', 'Move hello', 'Shout b', 'Add hello']
    )
    const first = await git.commitShow(repo.dir, commits[3]?.hash ?? '')
    assert.match(first, /4 files changed/)
    assert.match(first, /^\+\+\+ b\/docs\/greeting\.md$/m)
    await assert.rejects(git.commitShow(repo.dir, 'HEAD; rm'), /Not a commit hash/)
  } finally {
    repo.dispose()
  }
})

test('blame names who last changed each line, including uncommitted ones', async () => {
  const repo = await createTestRepo()
  try {
    writeFileSync(join(repo.dir, 'src/greet.ts'), 'a\nB\nc\nd\ne\n')
    const { lines, truncated } = await git.blame(repo.dir, 'src/greet.ts')
    assert.equal(truncated, false)
    assert.deepEqual(
      lines.map((item) => [item.line, item.code, item.uncommitted ? 'working tree' : item.author]),
      [
        [1, 'a', 'Ada'],
        [2, 'B', 'Grace'],
        [3, 'c', 'Ada'],
        [4, 'd', 'Grace'],
        [5, 'e', 'working tree']
      ]
    )
    assert.equal(lines[1]?.summary, 'Shout b')
    assert.equal(lines[1]?.date, Date.parse('2024-02-01T10:00:00Z'))
  } finally {
    repo.dispose()
  }
})

test('line history lists the commits that touched a range, with their diffs', async () => {
  const repo = await createTestRepo()
  try {
    const commits = await git.lineHistory(repo.dir, 'src/greet.ts', 2, 2)
    assert.deepEqual(
      commits.map((item) => item.subject),
      ['Shout b', 'Add hello']
    )
    assert.match(commits[0]?.diff ?? '', /^\+B$/m)
    await assert.rejects(git.lineHistory(repo.dir, 'src/greet.ts', 3, 1), /line range/)
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
    await assert.rejects(git.fileHistory(join(repo.dir, 'nope'), 'x'), (error) => error instanceof git.GitError)
    await assert.rejects(git.blame(repo.dir, 'missing.ts'), /no such path|fatal/)
  } finally {
    repo.dispose()
  }
})

test('blame parser reuses commit details for repeated hashes', () => {
  const hash = 'a'.repeat(40)
  const output = [
    `${hash} 1 1 2`,
    'author Ada',
    'author-time 1700000000',
    'summary First',
    'filename x',
    '\tone',
    `${hash} 2 2`,
    'filename x',
    '\ttwo'
  ].join('\n')
  const lines = git.parseBlame(output)
  assert.deepEqual(
    lines.map((item) => [item.line, item.author, item.summary, item.code]),
    [
      [1, 'Ada', 'First', 'one'],
      [2, 'Ada', 'First', 'two']
    ]
  )
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
