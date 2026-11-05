// Runs git in a workspace folder and turns its output into plain data. Parsers are exported
// separately so they can be tested without a repository.
import { execFile } from 'node:child_process'
import type { ChangedFile, Commit, CommitInfo, CommitPage } from './protocol'

export const LIMITS = {
  /** Commits one page of a log holds. */
  pageSize: 50,
  /** Characters of one file's diff sent to the tab. */
  diffChars: 60_000,
  /** Files listed for one commit. */
  changedFiles: 500
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

export const NOT_A_REPOSITORY =
  "This project's folder isn't a Git repository. Git History reads the repository at the project's root."

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
          const detail = (stderr || error.message).trim().split('\n')[0] ?? ''
          reject(new GitError(/not a git repository/i.test(detail) ? NOT_A_REPOSITORY : detail || 'git failed'))
          return
        }
        resolve(stdout)
      }
    )
  })
}

/** A repo-relative path the tab may ask about: no absolute paths, no `..`, no options. */
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

function checkHash(hash: string): string {
  if (!/^[0-9a-f]{4,40}$/.test(hash)) throw new GitError(`Not a commit hash: ${hash}`)
  return hash
}

function checkSkip(skip: number): number {
  if (!Number.isInteger(skip) || skip < 0) throw new GitError(`Not a page offset: ${skip}`)
  return skip
}

function parseHeader(line: string): Commit {
  const [hash = '', shortHash = '', author = '', time = '0', ...subject] = line.split(FIELD)
  return { hash, shortHash, author, date: Number(time) * 1000, subject: subject.join(FIELD) }
}

/** One `--name-status` line → the file and how it changed. */
function parseNameStatus(line: string): ChangedFile | null {
  const [code = '', first, second] = line.split('\t')
  if (first === undefined || !/^[ACDMRTUXB]/.test(code)) return null
  const status = code[0] as ChangedFile['status']
  if ((status === 'R' || status === 'C') && second !== undefined) {
    return { status, path: second, oldPath: first }
  }
  return { status, path: first }
}

/** `git ls-files -z` output → paths. */
export function parseLsFiles(output: string): string[] {
  return output.split('\0').filter((path) => path.length > 0)
}

/**
 * `git log` with {@link COMMIT_FORMAT}, optionally `--name-status`, → commits. With name-status
 * (file history), each commit records the path the file had in it and the path before a rename.
 */
export function parseLog(output: string): Commit[] {
  const commits: Commit[] = []
  for (const record of output.split(RECORD)) {
    const lines = record.split('\n').filter((line) => line.length > 0)
    const header = lines.shift()
    if (header === undefined) continue
    const commit = parseHeader(header)
    const change = lines.map(parseNameStatus).find((item) => item !== null)
    if (change) {
      commit.path = change.path
      if (change.oldPath !== undefined) commit.oldPath = change.oldPath
    }
    commits.push(commit)
  }
  return commits
}

/** `git diff-tree --name-status` output → changed files. */
export function parseChangedFiles(output: string): ChangedFile[] {
  return output
    .split('\n')
    .map(parseNameStatus)
    .filter((item): item is ChangedFile => item !== null)
}

/**
 * `git diff-tree --numstat -z` output → added/removed line counts by new path; null counts for
 * a binary file. A rename record is `add\tdel\t\0old\0new\0`.
 */
export function parseNumstat(output: string): Map<string, { additions: number; deletions: number } | null> {
  const counts = new Map<string, { additions: number; deletions: number } | null>()
  const parts = output.split('\0')
  for (let index = 0; index < parts.length; index += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(parts[index] ?? '')
    if (!match) continue
    let path = match[3] ?? ''
    if (path === '') {
      // Rename or copy: the next two parts are the old and new paths.
      path = parts[index + 2] ?? ''
      index += 2
    }
    counts.set(
      path,
      match[1] === '-' ? null : { additions: Number(match[1]), deletions: Number(match[2]) }
    )
  }
  return counts
}

/** `git show -s` with {@link INFO_FORMAT} → the commit's details. */
export function parseInfo(output: string): CommitInfo {
  const [hash = '', author = '', email = '', time = '0', committer = '', parents = '', ...message] =
    output.split(FIELD)
  return {
    hash,
    author,
    email,
    date: Number(time) * 1000,
    committer,
    parents: parents.split(' ').filter((item) => item.length > 0),
    message: message.join(FIELD).trimEnd()
  }
}

const INFO_FORMAT = `--format=%H${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%cn${FIELD}%P${FIELD}%B`

export function capDiff(diff: string): string {
  if (diff.length <= LIMITS.diffChars) return diff
  const cut = diff.lastIndexOf('\n', LIMITS.diffChars)
  return `${diff.slice(0, cut === -1 ? LIMITS.diffChars : cut)}\n… diff truncated`
}

/** Asks for one commit more than a page so the answer knows whether another page exists. */
function page(commits: Commit[]): CommitPage {
  return { commits: commits.slice(0, LIMITS.pageSize), hasMore: commits.length > LIMITS.pageSize }
}

export async function listFiles(cwd: string): Promise<string[]> {
  return parseLsFiles(await git(cwd, ['ls-files', '-z']))
}

/** A page of the checked-out branch's commits, newest first. */
export async function workspaceLog(cwd: string, skip: number): Promise<CommitPage> {
  const output = await git(cwd, [
    'log',
    `--skip=${checkSkip(skip)}`,
    `-n${LIMITS.pageSize + 1}`,
    COMMIT_FORMAT
  ])
  return page(parseLog(output))
}

/** A page of the commits that changed one file, following renames. */
export async function fileLog(cwd: string, path: string, skip: number): Promise<CommitPage> {
  const output = await git(cwd, [
    'log',
    '--follow',
    '--name-status',
    `--skip=${checkSkip(skip)}`,
    `-n${LIMITS.pageSize + 1}`,
    COMMIT_FORMAT,
    '--',
    checkRelativePath(path)
  ])
  return page(parseLog(output))
}

/** The files one commit changed, against its first parent (a merge lists what it brought in). */
export async function changedFiles(
  cwd: string,
  hash: string
): Promise<{ files: ChangedFile[]; truncated: boolean }> {
  const base = ['diff-tree', '--no-commit-id', '-r', '-M', '--root', '-m', '--first-parent']
  const [names, numbers] = await Promise.all([
    git(cwd, [...base, '--name-status', checkHash(hash)]),
    git(cwd, [...base, '--numstat', '-z', hash])
  ])
  const counts = parseNumstat(numbers)
  const files = parseChangedFiles(names).map((file) => {
    const count = counts.get(file.path)
    return count ? { ...file, ...count } : file
  })
  return { files: files.slice(0, LIMITS.changedFiles), truncated: files.length > LIMITS.changedFiles }
}

export async function commitInfo(cwd: string, hash: string): Promise<CommitInfo> {
  return parseInfo(await git(cwd, ['show', '-s', INFO_FORMAT, checkHash(hash)]))
}

/** The diff one commit made to one file; `oldPath` keeps a rename's both sides. */
export async function fileDiff(
  cwd: string,
  hash: string,
  path: string,
  oldPath?: string
): Promise<string> {
  const paths = [checkRelativePath(path)]
  if (oldPath !== undefined && oldPath !== path) paths.push(checkRelativePath(oldPath))
  const output = await git(cwd, [
    'show',
    '--format=',
    '-M',
    '-m',
    '--first-parent',
    checkHash(hash),
    '--',
    ...paths
  ])
  return capDiff(output.replace(/^\n+/, '').trimEnd())
}

/** The checked-out branch of the repository at `cwd`; null when it is no repository or HEAD is detached. */
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const branch = (await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim()
    return branch === '' ? null : branch
  } catch {
    return null
  }
}
