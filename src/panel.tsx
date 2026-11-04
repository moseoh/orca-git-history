// No build step: Orca strips the types and compiles the JSX when the panel loads.
// The panel follows the workspace focused in Orca's left sidebar. It lists that project's commits
// as a tree (expand a commit for the files it changed, pick a file for its diff), or, once a file
// is searched for, the commits that changed that file. All git work happens in src/worker.ts.
import {
  atom,
  Button,
  Callout,
  CodeView,
  Collapsible,
  EmptyState,
  host,
  IconButton,
  Input,
  List,
  ListItem,
  on,
  plugin,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Text,
  Tree,
  update,
  type IconName,
  type PanelContext,
  type TreeItem
} from 'orca'
import type { ChangedFile, Commit, Workspace } from './protocol'

type FocusedContext = { branch: string; displayName: string } | null
type Focus =
  | { state: 'waiting' }
  | { state: 'none'; name: string | null }
  | { state: 'ok'; workspace: Workspace }
/** The file whose diff is shown: changed by `hash`, at `path` (and `oldPath` before a rename). */
type Shown = { key: string; hash: string; path: string; oldPath?: string }

/** Largest piece of a diff one CodeView shows; a long diff is split into several. */
export const DIFF_CHUNK = 12_000
/** A request answered faster than this shows no spinner. */
const SPINNER_DELAY_MS = 300

const focus = atom<Focus>({ state: 'waiting' })
const query = atom('')
const results = atom<{ files: string[]; total: number }>({ files: [], total: 0 })
const recent = atom<string[]>([])
/** null: the project's commits; a path: that file's commits. */
const file = atom<string | null>(null)
const log = atom<{ commits: Commit[]; hasMore: boolean } | null>(null)
const expanded = atom<string[]>([])
const changes = atom<Record<string, { files: ChangedFile[]; truncated: boolean }>>({})
const shown = atom<Shown | null>(null)
const diff = atom<string | null>(null)
const loading = atom<string | null>(null)
const error = atom<string | null>(null)

/** Bumped on every new workspace or file, so a slow answer for an old one is dropped. */
let generation = 0

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function workspaceId(): string | null {
  const current = read(focus)
  return current.state === 'ok' ? current.workspace.id : null
}

async function run<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
  const mine = generation
  set(error, null)
  const timer = setTimeout(() => {
    if (mine === generation) set(loading, label)
  }, SPINNER_DELAY_MS)
  try {
    const value = await work()
    return mine === generation ? value : undefined
  } catch (reason) {
    if (mine === generation) set(error, message(reason))
    return undefined
  } finally {
    clearTimeout(timer)
    if (mine === generation) set(loading, null)
  }
}

/** The workspace Orca has focused, matched by name and branch; null when none matches. */
export function focusedWorkspace(list: readonly Workspace[], context: FocusedContext): Workspace | null {
  if (context === null) return null
  return (
    list.find((item) => item.name === context.displayName && (item.branch ?? '') === context.branch) ??
    list.find((item) => item.name === context.displayName) ??
    null
  )
}

/** Splits a diff on line breaks into pieces of at most {@link DIFF_CHUNK} characters. */
export function diffChunks(text: string): string[] {
  const chunks: string[] = []
  let rest = text
  while (rest.length > DIFF_CHUNK) {
    const cut = rest.lastIndexOf('\n', DIFF_CHUNK)
    const end = cut <= 0 ? DIFF_CHUNK : cut
    chunks.push(rest.slice(0, end))
    rest = rest.slice(end + (rest[end] === '\n' ? 1 : 0))
  }
  chunks.push(rest)
  return chunks
}

/** "5m", "3h", "2d", "4mo", "1y": short enough for a sidebar row. */
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.floor(days / 30)}mo`
  return `${Math.floor(days / 365)}y`
}

const commitKey = (hash: string): string => `c:${hash}`
const fileKey = (hash: string, path: string): string => `f:${hash}:${path}`

const STATUS_ICON: Record<ChangedFile['status'], IconName> = {
  A: 'add',
  C: 'copy',
  D: 'delete',
  M: 'edit',
  R: 'next',
  T: 'edit',
  U: 'warning',
  X: 'warning',
  B: 'warning'
}

function splitPath(path: string): { name: string; folder: string | undefined } {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? { name: path, folder: undefined } : { name: path.slice(slash + 1), folder: path.slice(0, slash) }
}

function commitDescription(item: Commit): string {
  return `${ago(item.date)} · ${item.author} · ${item.shortHash}`
}

/** Tree items for the project's commits; an expanded commit lists the files it changed. */
export function projectItems(
  commits: readonly Commit[],
  loaded: Readonly<Record<string, { files: ChangedFile[] }>>
): TreeItem[] {
  return commits.map((item) => {
    const files = loaded[item.hash]?.files
    return {
      key: commitKey(item.hash),
      label: item.subject,
      description: commitDescription(item),
      ...(files === undefined
        ? { hasChildren: true }
        : {
            children: files.map((change) => {
              const { name, folder } = splitPath(change.path)
              return {
                key: fileKey(item.hash, change.path),
                label: name,
                icon: STATUS_ICON[change.status],
                ...(folder === undefined ? {} : { description: folder })
              }
            })
          })
    }
  })
}

/** Tree items for one file's commits; picking one shows that commit's diff of the file. */
export function fileItems(commits: readonly Commit[]): TreeItem[] {
  return commits.map((item) => ({
    key: commitKey(item.hash),
    label: item.oldPath === undefined ? item.subject : `${item.subject} (renamed)`,
    description: commitDescription(item)
  }))
}

function clearList(): void {
  generation += 1
  set(log, null)
  set(expanded, [])
  set(changes, {})
  set(shown, null)
  set(diff, null)
  set(error, null)
  set(loading, null)
}

async function showWorkspace(workspace: Workspace | null, name: string | null): Promise<void> {
  const current = read(focus)
  if (workspace !== null && current.state === 'ok' && current.workspace.id === workspace.id) return
  clearList()
  set(file, null)
  set(query, '')
  set(results, { files: [], total: 0 })
  set(recent, [])
  if (workspace === null) {
    set(focus, { state: 'none', name })
    return
  }
  set(focus, { state: 'ok', workspace })
  await Promise.all([loadPage(), search('')])
}

/** Loads the first page of the current list, or the next one with `more`. */
async function loadPage(more = false): Promise<void> {
  const id = workspaceId()
  if (id === null) return
  const path = read(file)
  const skip = more ? (read(log)?.commits.length ?? 0) : 0
  const answer = await run('Loading commits', () =>
    path === null
      ? plugin.request('workspace.log', { workspaceId: id, skip })
      : plugin.request('file.log', { workspaceId: id, path, skip })
  )
  if (answer === undefined || read(file) !== path) return
  update(log, (previous) => ({
    commits: more && previous !== null ? [...previous.commits, ...answer.commits] : answer.commits,
    hasMore: answer.hasMore
  }))
}

async function search(text: string): Promise<void> {
  set(query, text)
  const id = workspaceId()
  if (id === null) return
  try {
    const answer = await plugin.request('files.search', { workspaceId: id, query: text })
    if (read(query) !== text || workspaceId() !== id) return
    set(results, { files: answer.files, total: answer.total })
    set(recent, answer.recent)
  } catch (reason) {
    set(error, message(reason))
  }
}

async function openFile(path: string): Promise<void> {
  clearList()
  set(file, path)
  set(query, '')
  await loadPage()
  void search('')
}

async function backToProject(): Promise<void> {
  clearList()
  set(file, null)
  await loadPage()
}

async function loadChanges(hash: string): Promise<void> {
  const id = workspaceId()
  if (id === null || read(changes)[hash] !== undefined) return
  const answer = await run('Loading changed files', () => plugin.request('commit.files', { workspaceId: id, hash }))
  if (answer) update(changes, (previous) => ({ ...previous, [hash]: answer }))
}

async function toggleCommit(hash: string, open: boolean): Promise<void> {
  const key = commitKey(hash)
  update(expanded, (keys) => (open ? [...keys.filter((item) => item !== key), key] : keys.filter((item) => item !== key)))
  if (open) await loadChanges(hash)
}

async function showDiff(next: Shown): Promise<void> {
  const id = workspaceId()
  if (id === null) return
  set(shown, next)
  set(diff, null)
  const answer = await run('Loading diff', () =>
    plugin.request('file.diff', {
      workspaceId: id,
      hash: next.hash,
      path: next.path,
      ...(next.oldPath === undefined ? {} : { oldPath: next.oldPath })
    })
  )
  if (answer && read(shown)?.key === next.key) set(diff, answer.diff)
}

async function select(key: string): Promise<void> {
  const path = read(file)
  if (key.startsWith('c:')) {
    const hash = key.slice(2)
    if (path === null) {
      await toggleCommit(hash, !read(expanded).includes(key))
      return
    }
    const entry = read(log)?.commits.find((item) => item.hash === hash)
    await showDiff({
      key,
      hash,
      path: entry?.path ?? path,
      ...(entry?.oldPath === undefined ? {} : { oldPath: entry.oldPath })
    })
    return
  }
  if (key.startsWith('f:')) {
    const rest = key.slice(2)
    const hash = rest.slice(0, rest.indexOf(':'))
    const changed = read(changes)[hash]?.files.find((item) => fileKey(hash, item.path) === key)
    if (changed === undefined) return
    await showDiff({
      key,
      hash,
      path: changed.path,
      ...(changed.oldPath === undefined ? {} : { oldPath: changed.oldPath })
    })
  }
}

async function openInEditor(path: string): Promise<void> {
  const id = workspaceId()
  if (id === null) return
  try {
    await plugin.request('file.open', { workspaceId: id, path })
  } catch (reason) {
    set(error, message(reason))
  }
}

export function setup(ctx: PanelContext): void {
  let context: FocusedContext | undefined
  let workspaces: Workspace[] | null = null
  const follow = async (): Promise<void> => {
    if (context === undefined) return
    // Re-read the list when the focused workspace is new to us (just created, say).
    if (context !== null && (workspaces === null || focusedWorkspace(workspaces, context) === null)) {
      try {
        workspaces = (await plugin.request('workspaces.list')).workspaces
      } catch (reason) {
        set(error, message(reason))
        return
      }
    }
    const match = workspaces === null ? null : focusedWorkspace(workspaces, context)
    await showWorkspace(match, context?.displayName ?? null)
  }
  ctx.subscriptions.push(
    on('workspace.changed', (payload) => {
      context = payload.context
      void follow()
    })
  )
  // The event replays the current focus to a new subscriber, but ask too, so the panel never
  // waits on that first event alone.
  void host
    .call('workspace.readContext')
    .then((answer) => {
      if (context !== undefined) return
      context = answer
      void follow()
    })
    .catch((reason) => set(error, message(reason)))
}

function FileList(props: { label: string; files: readonly string[] }) {
  return (
    <List label={props.label}>
      {props.files.map((path) => {
        const { name, folder } = splitPath(path)
        return <ListItem title={name} description={folder} icon="file" onPress={() => openFile(path)} />
      })}
    </List>
  )
}

function SearchResults() {
  const found = read(results)
  if (found.files.length === 0) return <Text muted size="sm">No tracked file matches.</Text>
  return (
    <Stack gap="xs">
      <FileList label="Matching files" files={found.files} />
      {found.total > found.files.length ? (
        <Text muted size="xs">
          Showing {found.files.length} of {found.total}. Type more to narrow it.
        </Text>
      ) : null}
    </Stack>
  )
}

function DiffView() {
  const current = read(shown)
  const text = read(diff)
  if (current === null || text === null) return null
  const chunks = text.length === 0 ? [] : diffChunks(text)
  return (
    <Stack gap="xs">
      <Row gap="xs" align="center" justify="between">
        <Text size="sm" weight="medium" truncate>
          {current.path}
        </Text>
        <IconButton icon="open-external" label="Open file" size="sm" variant="ghost" onPress={() => openInEditor(current.path)} />
      </Row>
      {chunks.length === 0 ? (
        <Text muted size="sm">
          No text changes (binary file or mode change).
        </Text>
      ) : (
        chunks.map((chunk, index) => (
          <CodeView
            code={chunk}
            language="diff"
            label={chunks.length === 1 ? 'Diff' : `Diff (${index + 1}/${chunks.length})`}
            maxHeight="lg"
          />
        ))
      )}
    </Stack>
  )
}

function CommitTree() {
  const current = read(log)
  if (current === null) return null
  const path = read(file)
  const items = path === null ? projectItems(current.commits, read(changes)) : fileItems(current.commits)
  return (
    <Stack gap="xs">
      <Tree
        label={path === null ? 'Commits' : 'Commits that changed this file'}
        items={items}
        selected={read(shown)?.key}
        expanded={read(expanded)}
        maxHeight={read(shown) === null ? 'lg' : 'md'}
        onSelect={({ key }) => select(key)}
        onToggle={({ key, expanded: open }) => (key.startsWith('c:') ? toggleCommit(key.slice(2), open) : undefined)}
      />
      {current.commits.length === 0 ? <Text muted size="sm">No commits yet.</Text> : null}
      {current.hasMore ? (
        <Button size="sm" variant="ghost" onPress={() => loadPage(true)}>
          Load more
        </Button>
      ) : null}
    </Stack>
  )
}

export default function Panel() {
  const current = read(focus)
  if (current.state === 'waiting') return <Spinner label="Waiting for Orca" />
  if (current.state === 'none') {
    return (
      <EmptyState
        icon="folder"
        title={current.name === null ? 'No project selected' : `${current.name} is not on this computer`}
        description={
          current.name === null
            ? 'Click a project in the left sidebar to see its Git history.'
            : 'File History works with local projects only for now.'
        }
      />
    )
  }
  const { workspace } = current
  const path = read(file)
  const text = read(query)
  const last = read(recent)
  const busy = read(loading)
  const problem = read(error)
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center">
        <Text weight="semibold" truncate>
          {workspace.name}
        </Text>
        {workspace.branch === null || workspace.branch === workspace.name ? null : (
          <Text muted size="sm" truncate>
            {workspace.branch}
          </Text>
        )}
      </Row>
      <Input
        label="Find a file"
        labelHidden
        type="search"
        placeholder="Find a file to see its history"
        value={text}
        onChange={(value) => void search(value)}
      />
      {problem === null ? null : (
        <Callout tone="danger" title="Git could not answer">
          <Text>{problem}</Text>
        </Callout>
      )}
      {text.trim() !== '' ? (
        <SearchResults />
      ) : (
        <Stack gap="sm">
          {path === null ? (
            last.length === 0 ? null : (
              <Collapsible title="Recent files" description={`${last.length}`}>
                <FileList label="Recent files" files={last} />
              </Collapsible>
            )
          ) : (
            <Row gap="xs" align="center">
              <IconButton icon="close" label="Back to project commits" size="sm" variant="ghost" onPress={backToProject} />
              <Text weight="medium" truncate>
                {path}
              </Text>
            </Row>
          )}
          <CommitTree />
          <DiffView />
        </Stack>
      )}
      {busy === null ? null : <Spinner label={busy} />}
    </Stack>
  )
}
