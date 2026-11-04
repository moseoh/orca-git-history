// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
// Every request names a workspace by id; the worker looks up its folder, so a panel never
// passes a filesystem path, only paths relative to the workspace root.

export type Workspace = {
  id: string
  name: string
  kind: 'worktree' | 'folder'
  branch: string | null
}

export type Commit = {
  hash: string
  shortHash: string
  author: string
  /** Author time, ms since the epoch. */
  date: number
  subject: string
  /** The file's path in this commit (file history only). */
  path?: string
  /** The path before a rename in this commit (file history only). */
  oldPath?: string
}

export type LineCommit = Commit & { diff: string }

export type BlameLine = {
  line: number
  hash: string
  shortHash: string
  author: string
  date: number
  summary: string
  code: string
  /** Changed in the working tree, not committed yet. */
  uncommitted: boolean
}

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Local workspaces Orca knows (SSH and other hosts are left out). */
    'workspaces.list': { output: { workspaces: Workspace[] } }
    /** The newest commits of the workspace's checked-out branch. */
    'workspace.log': {
      input: { workspaceId: string }
      output: { commits: Commit[] }
    }
    /** Everything one commit changed in the workspace: file summary and full diff. */
    'commit.show': {
      input: { workspaceId: string; hash: string }
      output: { diff: string }
    }
    /** Tracked files matching `query`, best first; `recent` when the query is empty. */
    'files.search': {
      input: { workspaceId: string; query: string }
      output: { files: string[]; total: number; recent: string[] }
    }
    /** Commits that touched the file, following renames. Remembers the file as recent. */
    'file.history': {
      input: { workspaceId: string; path: string }
      output: { commits: Commit[] }
    }
    /** The diff one commit made to a file. */
    'commit.diff': {
      input: { workspaceId: string; hash: string; path: string; oldPath?: string }
      output: { diff: string }
    }
    /** Who last changed each line of the file as it is on disk. */
    'file.blame': {
      input: { workspaceId: string; path: string }
      output: { lines: BlameLine[]; truncated: boolean }
    }
    /** Commits that changed lines `start`..`end`, each with its diff of those lines. */
    'lines.history': {
      input: { workspaceId: string; path: string; start: number; end: number }
      output: { commits: LineCommit[] }
    }
    /** Opens the file in an Orca editor tab. */
    'file.open': {
      input: { workspaceId: string; path: string }
      output: { opened: boolean }
    }
  }
}
