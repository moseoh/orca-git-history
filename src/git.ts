// Runs git in a workspace folder and turns its output into plain data. Parsers are exported
// separately so they can be tested without a repository.
import { execFile } from 'node:child_process'
import type { BlameLine, Commit, LineCommit } from './protocol'

export const LIMITS = {
  /** Commits `file.history` returns. */
  historyCommits: 300,
  /** Commits `lines.history` returns. */
  lineCommits: 100,
  /** Lines `file.blame` returns. */
  blameLines: 2000,
  /** Characters kept per blamed line of code. */
  blameCode: 200,
  /** Characters of one diff sent to the panel. */
  diffChars: 200_000
} as const

const FIELD = '\x1f'
const RECORD = '\x1e'
/** One commit header: hash, short hash, author, author time (s), subject. */
const COMMIT_FORMAT = `--format=${RECORD}%H${FIELD}%h${FIELD}%an${FIELD}%at${FIELD}%s`

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}

/** Runs `git <args>` in `cwd` and resolves with stdout. */
export function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', '-c', 'color.ui=never', ...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30_000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C' }
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = (stderr || error.message).trim().split('\n')[0]
          reject(new GitError(detail || 'git failed'))
          return
        }
        resolve(stdout)
      }
    )
  })
}

/** A repo-relative path the panel may ask about: no absolute paths, no `..`, no options. */
export function checkRelativePath(path: string): string {
  const parts = path.split('/')
  if (
    path.length === 0 ||
    path.startsWith('/') ||
    path.startsWith('-') ||
    path.includes('\\') ||
    path.includes('\0') ||
    parts.some((part) => part === '..' || part === '')
  ) {
    throw new GitError(`Not a path inside the workspace: ${path}`)
  }
  return path
}

function parseHeader(line: string): Commit {
  const [hash = '', shortHash = '', author = '', time = '0', ...subject] = line.split(FIELD)
  return { hash, shortHash, author, date: Number(time) * 1000, subject: subject.join(FIELD) }
}

/** `git ls-files -z` output → paths. */
export function parseLsFiles(output: string): string[] {
  return output.split('\0').filter((path) => path.length > 0)
}

/**
 * `git log --follow --name-status` with {@link COMMIT_FORMAT} → commits, each with the path the
 * file had in that commit (and the path before, for a rename).
 */
export function parseHistory(output: string): Commit[] {
  const commits: Commit[] = []
  for (const record of output.split(RECORD)) {
    const lines = record.split('\n').filter((line) => line.length > 0)
    const header = lines.shift()
    if (header === undefined) continue
    const commit = parseHeader(header)
    const status = lines.find((line) => /^[ACDMRTUXB]/.test(line))
    if (status !== undefined) {
      const [code = '', first = '', second] = status.split('\t')
      if ((code.startsWith('R') || code.startsWith('C')) && second !== undefined) {
        commit.path = second
        commit.oldPath = first
      } else {
        commit.path = first
      }
    }
    commits.push(commit)
  }
  return commits
}

/** `git blame --porcelain` → one entry per line of the file. */
export function parseBlame(output: string): BlameLine[] {
  const commits = new Map<string, { author: string; date: number; summary: string }>()
  const lines: BlameLine[] = []
  let current: { hash: string; line: number } | null = null
  for (const raw of output.split('\n')) {
    if (raw.startsWith('\t')) {
      if (current === null) continue
      const info = commits.get(current.hash) ?? { author: '', date: 0, summary: '' }
      lines.push({
        line: current.line,
        hash: current.hash,
        shortHash: current.hash.slice(0, 8),
        author: info.author,
        date: info.date,
        summary: info.summary,
        code: raw.slice(1, 1 + LIMITS.blameCode),
        uncommitted: /^0+$/.test(current.hash)
      })
      current = null
      continue
    }
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(raw)
    if (header) {
      const hash = header[1] as string
      current = { hash, line: Number(header[2]) }
      if (!commits.has(hash)) commits.set(hash, { author: '', date: 0, summary: '' })
      continue
    }
    if (current === null) continue
    const info = commits.get(current.hash)
    if (info === undefined) continue
    if (raw.startsWith('author ')) info.author = raw.slice('author '.length)
    else if (raw.startsWith('author-time ')) info.date = Number(raw.slice('author-time '.length)) * 1000
    else if (raw.startsWith('summary ')) info.summary = raw.slice('summary '.length)
  }
  return lines
}

/** `git log -L` with {@link COMMIT_FORMAT} → commits, each with the diff of that line range. */
export function parseLineHistory(output: string): LineCommit[] {
  const commits: LineCommit[] = []
  for (const record of output.split(RECORD)) {
    if (record.trim().length === 0) continue
    const newline = record.indexOf('\n')
    const header = newline === -1 ? record : record.slice(0, newline)
    const diff = newline === -1 ? '' : record.slice(newline + 1).replace(/^\n+/, '').trimEnd()
    commits.push({ ...parseHeader(header), diff: capDiff(diff) })
  }
  return commits
}

export function capDiff(diff: string): string {
  if (diff.length <= LIMITS.diffChars) return diff
  const cut = diff.lastIndexOf('\n', LIMITS.diffChars)
  return `${diff.slice(0, cut === -1 ? LIMITS.diffChars : cut)}\n… diff truncated`
}

export async function listFiles(cwd: string): Promise<string[]> {
  return parseLsFiles(await git(cwd, ['ls-files', '-z']))
}

export async function fileHistory(cwd: string, path: string): Promise<Commit[]> {
  const output = await git(cwd, [
    'log',
    '--follow',
    '--name-status',
    `-n${LIMITS.historyCommits}`,
    COMMIT_FORMAT,
    '--',
    checkRelativePath(path)
  ])
  return parseHistory(output)
}

/** The diff one commit made to a file; `oldPath` keeps a rename's both sides. */
export async function commitDiff(
  cwd: string,
  hash: string,
  path: string,
  oldPath?: string
): Promise<string> {
  if (!/^[0-9a-f]{4,40}$/.test(hash)) throw new GitError(`Not a commit hash: ${hash}`)
  const paths = [checkRelativePath(path)]
  if (oldPath !== undefined && oldPath !== path) paths.push(checkRelativePath(oldPath))
  const output = await git(cwd, ['show', '--format=', '--find-renames', hash, '--', ...paths])
  return capDiff(output.trimEnd())
}

export async function blame(
  cwd: string,
  path: string
): Promise<{ lines: BlameLine[]; truncated: boolean }> {
  const all = parseBlame(await git(cwd, ['blame', '--porcelain', '--', checkRelativePath(path)]))
  return { lines: all.slice(0, LIMITS.blameLines), truncated: all.length > LIMITS.blameLines }
}

export async function lineHistory(
  cwd: string,
  path: string,
  start: number,
  end: number
): Promise<LineCommit[]> {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    throw new GitError('Enter a line range such as 10 to 20.')
  }
  const output = await git(cwd, [
    'log',
    `-n${LIMITS.lineCommits}`,
    COMMIT_FORMAT,
    `-L${start},${end}:${checkRelativePath(path)}`
  ])
  return parseLineHistory(output)
}
