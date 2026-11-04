// Test helper: a throwaway Git repository with a known history. Orca never loads this file.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from '../git'

export type TestRepo = { dir: string; dispose(): void }

async function commit(dir: string, author: string, date: string, message: string): Promise<void> {
  await git(dir, ['add', '-A'])
  await git(dir, [
    '-c',
    `user.name=${author}`,
    '-c',
    `user.email=${author.toLowerCase()}@example.com`,
    'commit',
    '-q',
    `--date=${date}`,
    '-m',
    message
  ])
}

/**
 * History of `src/greet.ts`, which starts as `hello.ts`:
 * 1. Ada adds hello.ts (lines a, b, c), README.md, src/util.ts and docs/greeting.md
 * 2. Grace changes line 2 to B
 * 3. Ada moves hello.ts to src/greet.ts
 * 4. Grace appends line d
 */
export async function createTestRepo(): Promise<TestRepo> {
  const dir = mkdtempSync(join(tmpdir(), 'file-history-'))
  const write = (path: string, text: string): void => writeFileSync(join(dir, path), text)
  await git(dir, ['init', '-q', '-b', 'main'])
  mkdirSync(join(dir, 'src'))
  mkdirSync(join(dir, 'docs'))
  write('README.md', '# demo\n')
  write('hello.ts', 'a\nb\nc\n')
  write('src/util.ts', 'export const x = 1\n')
  write('docs/greeting.md', 'hi\n')
  await commit(dir, 'Ada', '2024-01-01T10:00:00Z', 'Add hello')
  write('hello.ts', 'a\nB\nc\n')
  await commit(dir, 'Grace', '2024-02-01T10:00:00Z', 'Shout b')
  await git(dir, ['mv', 'hello.ts', 'src/greet.ts'])
  await commit(dir, 'Ada', '2024-03-01T10:00:00Z', 'Move hello')
  write('src/greet.ts', 'a\nB\nc\nd\n')
  await commit(dir, 'Grace', '2024-04-01T10:00:00Z', 'Add d')
  return { dir, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}
