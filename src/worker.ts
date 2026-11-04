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
/** How long Orca's workspace list is reused before asking again. */
const WORKSPACE_LIST_TTL_MS = 10_000

type LocalWorkspace = Workspace & { path: string }

/** Orca reports this computer as `'local'` (older builds: null); anything else is SSH or another host. */
function isLocal(hostId: string | null): boolean {
  return hostId === null || hostId === 'local'
}

export default function activate(orca: OrcaWorkerApi): void {
  const fileLists = new Map<string, { at: number; files: Promise<string[]> }>()
  let workspaceList: { at: number; workspaces: Promise<LocalWorkspace[]> } | null = null

  function localWorkspaces(fresh = false): Promise<LocalWorkspace[]> {
    if (!fresh && workspaceList !== null && Date.now() - workspaceList.at < WORKSPACE_LIST_TTL_MS) {
      return workspaceList.workspaces
    }
    const workspaces = orca.host.call('workspace.list').then((answer) =>
      answer.workspaces
        .filter((workspace) => isLocal(workspace.hostId))
        .map(({ id, name, kind, branch, path }) => ({ id, name, kind, branch, path }))
    )
    workspaceList = { at: Date.now(), workspaces }
    workspaces.catch(() => {
      workspaceList = null
    })
    return workspaces
  }

  async function folderOf(workspaceId: string): Promise<string> {
    const find = async (fresh: boolean) =>
      (await localWorkspaces(fresh)).find((item) => item.id === workspaceId)
    const workspace = (await find(false)) ?? (await find(true))
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
    workspaces: (await localWorkspaces(true)).map(({ id, name, kind, branch }) => ({
      id,
      name,
      kind,
      branch
    }))
  }))

  orca.panels.handle('workspace.log', async ({ workspaceId, skip }) =>
    git.workspaceLog(await folderOf(workspaceId), skip)
  )

  orca.panels.handle('file.log', async ({ workspaceId, path, skip }) => {
    const answer = await git.fileLog(await folderOf(workspaceId), path, skip)
    if (skip === 0) await remember(workspaceId, path)
    return answer
  })

  orca.panels.handle('commit.files', async ({ workspaceId, hash }) =>
    git.changedFiles(await folderOf(workspaceId), hash)
  )

  orca.panels.handle('file.diff', async ({ workspaceId, hash, path, oldPath }) => ({
    diff: await git.fileDiff(await folderOf(workspaceId), hash, path, oldPath)
  }))

  orca.panels.handle('files.search', async ({ workspaceId, query }) => {
    const folder = await folderOf(workspaceId)
    const recent = await recentOf(workspaceId)
    if (query.trim().length === 0) return { files: [], total: 0, recent }
    return { ...searchFiles(await filesOf(workspaceId, folder), query), recent }
  })

  orca.panels.handle('file.open', async ({ workspaceId, path }) => {
    git.checkRelativePath(path)
    await folderOf(workspaceId)
    const { opened } = await orca.host.call('editor.open', { workspaceId, path })
    return { opened }
  })
}
