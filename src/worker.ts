// The plugin's worker: runs git in the chosen workspace's folder and answers the panel.
// Orca starts it on the panel's first plugin.request; a save restarts it, so anything that must
// outlive a restart (recent files) lives in orca.storage.
import type { OrcaWorkerApi } from 'orca/worker'
import * as git from './git'
import type { Workspace } from './protocol'
import { searchFiles } from './search'

const RECENT_LIMIT = 15
/** How long a workspace's `git ls-files` answer is reused while someone types. */
const FILE_LIST_TTL_MS = 30_000

type LocalWorkspace = Workspace & { path: string }

/** Orca reports this computer as `'local'` (older builds: null); anything else is SSH or another host. */
function isLocal(hostId: string | null): boolean {
  return hostId === null || hostId === 'local'
}

export default function activate(orca: OrcaWorkerApi): void {
  const fileLists = new Map<string, { at: number; files: Promise<string[]> }>()

  async function localWorkspaces(): Promise<LocalWorkspace[]> {
    const { workspaces } = await orca.host.call('workspace.list')
    return workspaces
      .filter((workspace) => isLocal(workspace.hostId))
      .map(({ id, name, kind, branch, path }) => ({ id, name, kind, branch, path }))
  }

  async function folderOf(workspaceId: string): Promise<string> {
    const workspace = (await localWorkspaces()).find((item) => item.id === workspaceId)
    if (workspace === undefined) {
      throw new Error('That workspace is gone or is not on this computer.')
    }
    return workspace.path
  }

  function filesOf(workspaceId: string, folder: string): Promise<string[]> {
    const cached = fileLists.get(workspaceId)
    if (cached !== undefined && Date.now() - cached.at < FILE_LIST_TTL_MS) return cached.files
    const files = git.listFiles(folder)
    fileLists.set(workspaceId, { at: Date.now(), files })
    files.catch(() => fileLists.delete(workspaceId))
    return files
  }

  async function recentOf(workspaceId: string): Promise<string[]> {
    const value = await orca.storage.get(`recent:${workspaceId}`)
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  }

  async function remember(workspaceId: string, path: string): Promise<void> {
    const recent = [path, ...(await recentOf(workspaceId)).filter((item) => item !== path)]
    await orca.storage.set(`recent:${workspaceId}`, recent.slice(0, RECENT_LIMIT))
  }

  orca.panels.handle('workspaces.list', async () => ({
    workspaces: (await localWorkspaces()).map(({ id, name, kind, branch }) => ({
      id,
      name,
      kind,
      branch
    }))
  }))

  orca.panels.handle('workspace.log', async ({ workspaceId }) => ({
    commits: await git.workspaceLog(await folderOf(workspaceId))
  }))

  orca.panels.handle('commit.show', async ({ workspaceId, hash }) => ({
    diff: await git.commitShow(await folderOf(workspaceId), hash)
  }))

  orca.panels.handle('files.search', async ({ workspaceId, query }) => {
    const folder = await folderOf(workspaceId)
    const recent = await recentOf(workspaceId)
    if (query.trim().length === 0) return { files: [], total: 0, recent }
    return { ...searchFiles(await filesOf(workspaceId, folder), query), recent }
  })

  orca.panels.handle('file.history', async ({ workspaceId, path }) => {
    const commits = await git.fileHistory(await folderOf(workspaceId), path)
    await remember(workspaceId, path)
    return { commits }
  })

  orca.panels.handle('commit.diff', async ({ workspaceId, hash, path, oldPath }) => ({
    diff: await git.commitDiff(await folderOf(workspaceId), hash, path, oldPath)
  }))

  orca.panels.handle('file.blame', async ({ workspaceId, path }) =>
    git.blame(await folderOf(workspaceId), path)
  )

  orca.panels.handle('lines.history', async ({ workspaceId, path, start, end }) => ({
    commits: await git.lineHistory(await folderOf(workspaceId), path, start, end)
  }))

  orca.panels.handle('file.open', async ({ workspaceId, path }) => {
    git.checkRelativePath(path)
    await folderOf(workspaceId)
    const { opened } = await orca.host.call('editor.open', { workspaceId, path })
    return { opened }
  })
}
