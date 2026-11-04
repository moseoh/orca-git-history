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

/** One page of a log; `hasMore` when older commits follow. */
export type CommitPage = { commits: Commit[]; hasMore: boolean }

/** A file one commit changed: Added, Modified, Deleted, Renamed, Copied, Type change, ... */
export type ChangedFile = {
  status: 'A' | 'C' | 'D' | 'M' | 'R' | 'T' | 'U' | 'X' | 'B'
  path: string
  oldPath?: string
  /** Lines added and removed; absent for a binary file. */
  additions?: number
  deletions?: number
}

/** One commit in full, for the Git History tab's details pane. */
export type CommitInfo = {
  hash: string
  author: string
  email: string
  /** Author time, ms since the epoch. */
  date: number
  committer: string
  parents: string[]
  /** The whole message: subject, blank line, body. */
  message: string
}

export {}

declare module 'orca' {
  interface PluginRequests {
    /** Local workspaces Orca knows (SSH and other hosts are left out). */
    'workspaces.list': { output: { workspaces: Workspace[] } }
    /** A page of the workspace's checked-out branch, newest first, from `skip`. */
    'workspace.log': {
      input: { workspaceId: string; skip: number }
      output: CommitPage
    }
    /** A page of the commits that changed one file, following renames. Remembers it as recent. */
    'file.log': {
      input: { workspaceId: string; path: string; skip: number }
      output: CommitPage
    }
    /** The files one commit changed. */
    'commit.files': {
      input: { workspaceId: string; hash: string }
      output: { files: ChangedFile[]; truncated: boolean }
    }
    /** One commit's author, parents and whole message. */
    'commit.info': {
      input: { workspaceId: string; hash: string }
      output: CommitInfo
    }
    /** The diff one commit made to one file. */
    'file.diff': {
      input: { workspaceId: string; hash: string; path: string; oldPath?: string }
      output: { diff: string }
    }
    /** Tracked files matching `query`, best first, and the files looked at recently. */
    'files.search': {
      input: { workspaceId: string; query: string }
      output: { files: string[]; total: number; recent: string[] }
    }
    /** Opens the file in an Orca editor tab. */
    'file.open': {
      input: { workspaceId: string; path: string }
      output: { opened: boolean }
    }
  }
}
