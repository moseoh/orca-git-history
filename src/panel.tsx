// No build step: Orca strips the types and compiles the JSX when the panel loads.
// The panel follows the workspace focused in Orca's left sidebar: it shows that project's recent
// commits, and a file's history, blame and line history once a file is picked. All git work
// happens in src/worker.ts.
import {
  atom,
  Button,
  Callout,
  CodeView,
  EmptyState,
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
  Tab,
  Table,
  Tabs,
  Text,
  type PanelContext,
  type TableColumn,
  type TableRow
} from 'orca'
import type { BlameLine, Commit, LineCommit, Workspace } from './protocol'

type View = 'history' | 'blame' | 'lines'
type FocusedContext = { branch: string; displayName: string } | null

/** Largest piece of a diff one CodeView shows; a long diff is split into several. */
export const DIFF_CHUNK = 12_000

/** null until Orca reports focus; `none` when no workspace is focused or it is not local. */
const focus = atom<{ state: 'waiting' } | { state: 'none'; name: string | null } | { state: 'ok'; workspace: Workspace }>({
  state: 'waiting'
})
const query = atom('')
const results = atom<{ files: string[]; total: number }>({ files: [], total: 0 })
const recent = atom<string[]>([])
const projectLog = atom<Commit[] | null>(null)
const projectCommit = atom<string | null>(null)
const projectDiff = atom<string | null>(null)
const file = atom<string | null>(null)
const view = atom<View>('history')
const history = atom<Commit[] | null>(null)
const commit = atom<string | null>(null)
const diff = atom<string | null>(null)
const blame = atom<{ lines: BlameLine[]; truncated: boolean } | null>(null)
const lineStart = atom('')
const lineEnd = atom('')
const lineCommits = atom<LineCommit[] | null>(null)
const lineCommit = atom<string | null>(null)
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
  set(loading, label)
  set(error, null)
  try {
    const value = await work()
    return mine === generation ? value : undefined
  } catch (reason) {
    if (mine === generation) set(error, message(reason))
    return undefined
  } finally {
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

function clearFile(): void {
  generation += 1
  set(file, null)
  set(history, null)
  set(commit, null)
  set(diff, null)
  set(blame, null)
  set(lineCommits, null)
  set(lineCommit, null)
  set(error, null)
  set(loading, null)
}

async function showWorkspace(workspace: Workspace | null, name: string | null): Promise<void> {
  const current = read(focus)
  if (workspace !== null && current.state === 'ok' && current.workspace.id === workspace.id) return
  clearFile()
  set(query, '')
  set(results, { files: [], total: 0 })
  set(recent, [])
  set(projectLog, null)
  set(projectCommit, null)
  set(projectDiff, null)
  if (workspace === null) {
    set(focus, { state: 'none', name })
    return
  }
  set(focus, { state: 'ok', workspace })
  await Promise.all([loadProjectLog(), search('')])
}

async function loadProjectLog(): Promise<void> {
  const id = workspaceId()
  if (id === null) return
  const answer = await run('Loading commits', () => plugin.request('workspace.log', { workspaceId: id }))
  if (answer) set(projectLog, answer.commits)
}

async function showProjectCommit(hash: string): Promise<void> {
  const id = workspaceId()
  if (id === null) return
  set(projectCommit, hash)
  set(projectDiff, null)
  const answer = await run('Loading commit', () => plugin.request('commit.show', { workspaceId: id, hash }))
  if (answer && read(projectCommit) === hash) set(projectDiff, answer.diff)
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

async function loadView(next: View): Promise<void> {
  set(view, next)
  const id = workspaceId()
  const path = read(file)
  if (id === null || path === null) return
  if (next === 'history' && read(history) === null) {
    const answer = await run('Loading history', () =>
      plugin.request('file.history', { workspaceId: id, path })
    )
    if (answer) set(history, answer.commits)
  }
  if (next === 'blame' && read(blame) === null) {
    const answer = await run('Running blame', () =>
      plugin.request('file.blame', { workspaceId: id, path })
    )
    if (answer) set(blame, answer)
  }
}

async function openFile(path: string): Promise<void> {
  clearFile()
  set(file, path)
  set(query, '')
  set(view, 'history')
  await loadView('history')
}

async function backToProject(): Promise<void> {
  clearFile()
  await search('')
}

async function showCommit(hash: string): Promise<void> {
  const id = workspaceId()
  const path = read(file)
  if (id === null || path === null) return
  set(commit, hash)
  set(diff, null)
  const entry = read(history)?.find((item) => item.hash === hash)
  const answer = await run('Loading diff', () =>
    plugin.request('commit.diff', {
      workspaceId: id,
      hash,
      path: entry?.path ?? path,
      ...(entry?.oldPath === undefined ? {} : { oldPath: entry.oldPath })
    })
  )
  if (answer && read(commit) === hash) set(diff, answer.diff)
}

async function blameToHistory(key: string): Promise<void> {
  const line = read(blame)?.lines.find((item) => String(item.line) === key)
  if (line === undefined || line.uncommitted) return
  await loadView('history')
  await showCommit(line.hash)
}

async function runLineHistory(): Promise<void> {
  const id = workspaceId()
  const path = read(file)
  if (id === null || path === null) return
  const start = Number(read(lineStart))
  const end = read(lineEnd).trim() === '' ? start : Number(read(lineEnd))
  set(lineCommits, null)
  set(lineCommit, null)
  const answer = await run('Loading line history', () =>
    plugin.request('lines.history', { workspaceId: id, path, start, end }, { timeoutMs: 120_000 })
  )
  if (answer) {
    set(lineCommits, answer.commits)
    set(lineCommit, answer.commits[0]?.hash ?? null)
  }
}

async function openInEditor(): Promise<void> {
  const id = workspaceId()
  const path = read(file)
  if (id === null || path === null) return
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
}

const COMMIT_COLUMNS: TableColumn[] = [
  { key: 'hash', label: 'SHA', width: 'xs' },
  { key: 'subject', label: 'Message', width: 'auto', minWidth: 'sm' },
  { key: 'author', label: 'Author', width: 'sm', hideBelow: 'sm' },
  { key: 'date', label: 'When', width: 'sm' }
]

function commitRows(commits: readonly Commit[]): TableRow[] {
  return commits.map((item) => ({
    key: item.hash,
    cells: {
      hash: item.shortHash,
      subject: item.oldPath === undefined ? item.subject : `${item.subject} (renamed)`,
      author: item.author,
      date: { type: 'relative', at: item.date, format: 'short' }
    }
  }))
}

const BLAME_COLUMNS: TableColumn[] = [
  { key: 'line', label: 'Line', width: 'xs', align: 'end' },
  { key: 'code', label: 'Code', width: 'auto', minWidth: 'md' },
  { key: 'author', label: 'Author', width: 'sm', hideBelow: 'md' },
  { key: 'date', label: 'When', width: 'sm', hideBelow: 'sm' },
  { key: 'hash', label: 'SHA', width: 'xs', hideBelow: 'sm' }
]

function blameRows(lines: readonly BlameLine[]): TableRow[] {
  return lines.map((item) => ({
    key: String(item.line),
    cells: {
      line: item.line,
      code: item.code,
      author: item.uncommitted ? 'You' : item.author,
      date: item.uncommitted ? 'Not committed' : { type: 'relative', at: item.date, format: 'short' },
      hash: item.uncommitted ? '' : item.shortHash
    }
  }))
}

function Diff(props: { text: string | null; label: string }) {
  if (props.text === null) return null
  if (props.text.length === 0) return <Text muted>No changes in this commit.</Text>
  const chunks = diffChunks(props.text)
  return (
    <Stack gap="xs">
      {chunks.map((chunk, index) => (
        <CodeView
          code={chunk}
          language="diff"
          label={chunks.length === 1 ? props.label : `${props.label} (${index + 1}/${chunks.length})`}
          maxHeight="lg"
        />
      ))}
    </Stack>
  )
}

function FileList(props: { label: string; files: readonly string[] }) {
  return (
    <List label={props.label}>
      {props.files.map((path) => (
        <ListItem
          title={path.slice(path.lastIndexOf('/') + 1)}
          description={path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : undefined}
          icon="file"
          onPress={() => openFile(path)}
        />
      ))}
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

function ProjectView() {
  const commits = read(projectLog)
  const selected = read(projectCommit)
  const last = read(recent)
  return (
    <Stack gap="sm">
      {last.length > 0 ? (
        <Stack gap="xs">
          <Text muted size="xs" weight="medium">
            Recent files
          </Text>
          <FileList label="Recent files" files={last.slice(0, 5)} />
        </Stack>
      ) : null}
      {commits === null ? null : (
        <Stack gap="xs">
          <Text muted size="xs" weight="medium">
            Commits
          </Text>
          <Table
            label="Commits"
            columns={COMMIT_COLUMNS}
            rows={commitRows(commits)}
            selectionMode="single"
            selected={selected === null ? [] : [selected]}
            onSelectionChange={({ keys }) => (keys[0] === undefined ? undefined : showProjectCommit(keys[0]))}
            emptyText="No commits yet."
            maxHeight="md"
          />
        </Stack>
      )}
      <Diff text={read(projectDiff)} label="Changes" />
    </Stack>
  )
}

function HistoryView() {
  const commits = read(history)
  if (commits === null) return null
  const selected = read(commit)
  return (
    <Stack gap="sm">
      <Table
        label="Commits that changed this file"
        columns={COMMIT_COLUMNS}
        rows={commitRows(commits)}
        selectionMode="single"
        selected={selected === null ? [] : [selected]}
        onSelectionChange={({ keys }) => (keys[0] === undefined ? undefined : showCommit(keys[0]))}
        emptyText="No commits touch this file yet."
        maxHeight="md"
      />
      <Diff text={read(diff)} label="Diff" />
    </Stack>
  )
}

function BlameView() {
  const result = read(blame)
  if (result === null) return null
  return (
    <Stack gap="sm">
      <Text muted size="xs">
        Double-click or press Enter on a line to see its commit in History.
      </Text>
      <Table
        label="Blame"
        columns={BLAME_COLUMNS}
        rows={blameRows(result.lines)}
        onRowAction={({ key }) => blameToHistory(key)}
        emptyText="The file is empty."
        maxHeight="lg"
      />
      {result.truncated ? (
        <Text muted size="xs">
          Showing the first {result.lines.length} lines.
        </Text>
      ) : null}
    </Stack>
  )
}

function LinesView() {
  const commits = read(lineCommits)
  const selected = read(lineCommit)
  const shown = commits?.find((item) => item.hash === selected) ?? null
  return (
    <Stack gap="sm">
      <Row gap="xs" align="end">
        <Input label="From line" placeholder="10" value={read(lineStart)} onChange={(value) => set(lineStart, value)} onSubmit={() => runLineHistory()} />
        <Input label="To line" placeholder="20" value={read(lineEnd)} onChange={(value) => set(lineEnd, value)} onSubmit={() => runLineHistory()} />
        <Button icon="search" disabled={read(lineStart).trim() === ''} onPress={runLineHistory}>
          Show
        </Button>
      </Row>
      {commits === null ? null : (
        <Table
          label="Commits that changed these lines"
          columns={COMMIT_COLUMNS}
          rows={commitRows(commits)}
          selectionMode="single"
          selected={selected === null ? [] : [selected]}
          onSelectionChange={({ keys }) => set(lineCommit, keys[0] ?? null)}
          emptyText="No commits changed these lines."
          maxHeight="md"
        />
      )}
      {shown === null ? null : <Diff text={shown.diff} label="Line diff" />}
    </Stack>
  )
}

function FileView(props: { path: string }) {
  return (
    <Stack gap="sm">
      <Row gap="xs" align="center" justify="between">
        <Row gap="xs" align="center">
          <IconButton icon="close" label="Back to project commits" size="sm" variant="ghost" onPress={backToProject} />
          <Text weight="semibold" truncate>
            {props.path}
          </Text>
        </Row>
        <Button size="sm" variant="outline" icon="open-external" onPress={openInEditor}>
          Open file
        </Button>
      </Row>
      <Tabs label="File views" value={read(view)} onChange={(value) => void loadView(value as View)}>
        <Tab value="history" label="History" icon="branch">
          <HistoryView />
        </Tab>
        <Tab value="blame" label="Blame" icon="file-text">
          <BlameView />
        </Tab>
        <Tab value="lines" label="Lines" icon="filter">
          <LinesView />
        </Tab>
      </Tabs>
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
      {text.trim() !== '' ? <SearchResults /> : path === null ? <ProjectView /> : <FileView path={path} />}
      {busy === null ? null : <Spinner label={busy} />}
    </Stack>
  )
}
