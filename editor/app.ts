// The Git History tab: the focused project's commits on the left; the picked commit's message,
// changed files and a side-by-side diff on the right. Plain DOM, all text set with textContent.
// All git work happens in the plugin worker (src/worker.ts), reached with orca.plugin.request.
import type { ChangedFile, Commit, CommitInfo, Workspace } from '../src/protocol'
import { ago, focusedWorkspace, type FocusedContext } from '../src/workspace'
import { parseDiff, type Hunk, type ParsedDiff, type Side } from './diff'
import { STYLES } from './styles'

type Child = Node | string | null | undefined | false
type Props = {
  class?: string
  text?: string
  title?: string
  onclick?: (event: Event) => void
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.class) node.className = props.class
  if (props.text !== undefined) node.textContent = props.text
  if (props.title) node.title = props.title
  if (props.onclick) node.addEventListener('click', props.onclick)
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(child)
  }
  return node
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function splitPath(path: string): { name: string; folder: string } {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? { name: path, folder: '' } : { name: path.slice(slash + 1), folder: path.slice(0, slash + 1) }
}

const dateFormat = new Intl.DateTimeFormat(orca.locale, { dateStyle: 'medium', timeStyle: 'short' })

type DiffMode = 'split' | 'unified'

const state = {
  workspace: null as Workspace | null,
  workspaces: null as Workspace[] | null,
  /** null: the whole project's log; a path: only commits that changed it. */
  file: null as string | null,
  commits: [] as Commit[],
  hasMore: false,
  loadingPage: false,
  selected: null as string | null,
  info: null as CommitInfo | null,
  changed: null as ChangedFile[] | null,
  changedTruncated: false,
  shownFile: null as ChangedFile | null,
  diff: null as ParsedDiff | null,
  mode: 'split' as DiffMode,
  /** Bumped when the list changes underneath, so late answers for the old one are dropped. */
  generation: 0
}

// ---------- layout ----------

const style = el('style')
style.textContent = STYLES
document.head.append(style)

const projectName = el('span', { class: 'project' })
const branchName = el('span', { class: 'branch' })
const searchInput = el('input')
searchInput.type = 'search'
searchInput.placeholder = 'Find a file to see only its history'
searchInput.spellcheck = false
const suggestions = el('div', { class: 'suggestions' })
suggestions.hidden = true
const fileChip = el('span', { class: 'chip' })
fileChip.hidden = true
const refreshButton = el('button', { class: 'btn', text: 'Refresh', onclick: () => void reload() })
const toolbar = el(
  'div',
  { class: 'toolbar' },
  projectName,
  branchName,
  el('span', { class: 'spacer' }),
  fileChip,
  el('div', { class: 'search' }, searchInput, suggestions),
  refreshButton
)

const list = el('div', { class: 'list' })
list.tabIndex = 0
const rows = el('div')
const listStatus = el('div', { class: 'status-line' })
list.append(rows, listStatus)
const detail = el('div', { class: 'detail' })
const body = el('div', { class: 'body' }, list, detail)
document.body.append(el('div', { class: 'app' }, toolbar, body))

// ---------- data ----------

async function followFocus(context: FocusedContext): Promise<void> {
  if (context !== null && (state.workspaces === null || focusedWorkspace(state.workspaces, context) === null)) {
    state.workspaces = (await orca.plugin.request('workspaces.list')).workspaces
  }
  const next = state.workspaces === null ? null : focusedWorkspace(state.workspaces, context)
  if (next?.id === state.workspace?.id && next !== null) return
  state.workspace = next
  state.file = null
  await reload()
}

async function reload(): Promise<void> {
  state.generation += 1
  state.commits = []
  state.hasMore = false
  state.selected = null
  clearDetail()
  renderToolbar()
  rows.replaceChildren()
  renderDetail()
  if (state.workspace === null) {
    listStatus.textContent = 'Click a project in the left sidebar, then open Git History again from the + menu.'
    return
  }
  await loadPage()
  const first = state.commits[0]
  if (first) void selectCommit(first.hash)
}

async function loadPage(): Promise<void> {
  const workspace = state.workspace
  if (workspace === null || state.loadingPage) return
  const mine = state.generation
  state.loadingPage = true
  listStatus.textContent = 'Loading…'
  try {
    const skip = state.commits.length
    const page =
      state.file === null
        ? await orca.plugin.request('workspace.log', { workspaceId: workspace.id, skip })
        : await orca.plugin.request('file.log', { workspaceId: workspace.id, path: state.file, skip })
    if (mine !== state.generation) return
    state.commits.push(...page.commits)
    state.hasMore = page.hasMore
    appendRows(page.commits)
    listStatus.textContent =
      state.commits.length === 0 ? 'No commits yet.' : state.hasMore ? '' : state.commits.length === 1 ? '1 commit' : `${state.commits.length} commits`
  } catch (reason) {
    if (mine === state.generation) listStatus.replaceChildren(el('div', { class: 'error', text: message(reason) }))
  } finally {
    if (mine === state.generation) state.loadingPage = false
  }
}

function clearDetail(): void {
  state.info = null
  state.changed = null
  state.changedTruncated = false
  state.shownFile = null
  state.diff = null
}

async function selectCommit(hash: string): Promise<void> {
  const workspace = state.workspace
  if (workspace === null || state.selected === hash) return
  state.selected = hash
  clearDetail()
  markSelectedRow()
  renderDetail()
  const mine = state.generation
  try {
    const [info, changed] = await Promise.all([
      orca.plugin.request('commit.info', { workspaceId: workspace.id, hash }),
      orca.plugin.request('commit.files', { workspaceId: workspace.id, hash })
    ])
    if (mine !== state.generation || state.selected !== hash) return
    state.info = info
    state.changed = changed.files
    state.changedTruncated = changed.truncated
    // In a file's history, open that file's diff straight away; otherwise the first file.
    const entry = state.commits.find((item) => item.hash === hash)
    const wanted = state.file === null ? null : (entry?.path ?? state.file)
    const pick = changed.files.find((item) => item.path === wanted) ?? (changed.files.length === 1 ? changed.files[0] : undefined)
    renderDetail()
    if (pick) await showFile(pick)
  } catch (reason) {
    if (mine === state.generation && state.selected === hash) renderDetail(message(reason))
  }
}

async function showFile(file: ChangedFile): Promise<void> {
  const workspace = state.workspace
  const hash = state.selected
  if (workspace === null || hash === null) return
  state.shownFile = file
  state.diff = null
  renderDetail()
  try {
    const { diff } = await orca.plugin.request('file.diff', {
      workspaceId: workspace.id,
      hash,
      path: file.path,
      ...(file.oldPath === undefined ? {} : { oldPath: file.oldPath })
    })
    if (state.selected !== hash || state.shownFile !== file) return
    state.diff = parseDiff(diff)
    renderDetail()
    scrollToDiff()
  } catch (reason) {
    if (state.shownFile === file) renderDetail(message(reason))
  }
}

async function openInEditor(path: string): Promise<void> {
  const workspace = state.workspace
  if (workspace === null) return
  try {
    await orca.plugin.request('file.open', { workspaceId: workspace.id, path })
  } catch (reason) {
    renderDetail(message(reason))
  }
}

async function showFileHistory(path: string | null): Promise<void> {
  state.file = path
  searchInput.value = ''
  hideSuggestions()
  await reload()
}

// ---------- toolbar and file search ----------

function renderToolbar(): void {
  const workspace = state.workspace
  projectName.textContent = workspace?.name ?? 'Git History'
  branchName.textContent = workspace?.branch && workspace.branch !== workspace.name ? workspace.branch : ''
  searchInput.disabled = workspace === null
  refreshButton.disabled = workspace === null
  fileChip.hidden = state.file === null
  if (state.file !== null) {
    fileChip.replaceChildren(
      el('span', { text: `History of ${state.file}`, title: state.file }),
      el('button', { class: 'btn ghost', text: '✕', title: 'Show all commits', onclick: () => void showFileHistory(null) })
    )
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchSeq = 0
let activeSuggestion = -1
let suggestionPaths: string[] = []

function hideSuggestions(): void {
  suggestions.hidden = true
  activeSuggestion = -1
}

function renderSuggestions(paths: string[], heading: string): void {
  suggestionPaths = paths
  activeSuggestion = paths.length > 0 ? 0 : -1
  if (paths.length === 0) {
    suggestions.replaceChildren(el('div', { class: 'suggestion', text: heading === 'Recent' ? 'Type part of a file name' : 'No tracked file matches' }))
  } else {
    suggestions.replaceChildren(
      ...paths.map((path, index) => {
        const { name, folder } = splitPath(path)
        const item = el('div', { class: `suggestion${index === 0 ? ' active' : ''}` }, el('span', { text: name }), el('span', { class: 'dir', text: folder }))
        item.addEventListener('mousedown', (event) => {
          event.preventDefault()
          void showFileHistory(path)
        })
        return item
      })
    )
  }
  suggestions.hidden = false
}

async function runSearch(): Promise<void> {
  const workspace = state.workspace
  if (workspace === null) return
  const text = searchInput.value
  const seq = ++searchSeq
  try {
    const answer = await orca.plugin.request('files.search', { workspaceId: workspace.id, query: text })
    if (seq !== searchSeq || document.activeElement !== searchInput) return
    if (text.trim() === '') renderSuggestions(answer.recent, 'Recent')
    else renderSuggestions(answer.files.slice(0, 30), 'Files')
  } catch {
    hideSuggestions()
  }
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void runSearch(), 120)
})
searchInput.addEventListener('focus', () => void runSearch())
searchInput.addEventListener('blur', () => hideSuggestions())
searchInput.addEventListener('keydown', (event) => {
  if (suggestions.hidden) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (suggestionPaths.length === 0) return
    const step = event.key === 'ArrowDown' ? 1 : -1
    activeSuggestion = (activeSuggestion + step + suggestionPaths.length) % suggestionPaths.length
    suggestions.querySelectorAll('.suggestion').forEach((node, index) => node.classList.toggle('active', index === activeSuggestion))
    suggestions.children[activeSuggestion]?.scrollIntoView({ block: 'nearest' })
  } else if (event.key === 'Enter') {
    const path = suggestionPaths[activeSuggestion]
    if (path !== undefined) void showFileHistory(path)
  } else if (event.key === 'Escape') {
    hideSuggestions()
  }
})

// ---------- commit list ----------

function appendRows(commits: readonly Commit[]): void {
  const fragment = document.createDocumentFragment()
  for (const commit of commits) {
    const subject = commit.oldPath === undefined ? commit.subject : `${commit.subject} (renamed from ${commit.oldPath})`
    const row = el(
      'div',
      { class: 'row', onclick: () => void selectCommit(commit.hash) },
      el('div', { class: 'subject', text: subject, title: subject }),
      el('div', { class: 'when', text: ago(commit.date), title: dateFormat.format(commit.date) }),
      el('div', { class: 'meta' }, el('span', { text: commit.author }), el('span', { class: 'mono', text: commit.shortHash }))
    )
    row.dataset.hash = commit.hash
    if (commit.hash === state.selected) row.classList.add('selected')
    fragment.append(row)
  }
  rows.append(fragment)
}

function markSelectedRow(): void {
  for (const node of Array.from(rows.children) as HTMLElement[]) {
    const on = node.dataset.hash === state.selected
    node.classList.toggle('selected', on)
    if (on) node.scrollIntoView({ block: 'nearest' })
  }
}

list.addEventListener('scroll', () => {
  if (state.hasMore && list.scrollTop + list.clientHeight > list.scrollHeight - 400) void loadPage()
})

list.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const index = state.commits.findIndex((item) => item.hash === state.selected)
  const next = state.commits[Math.min(state.commits.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]
  if (next) void selectCommit(next.hash)
  if (event.key === 'ArrowDown' && index >= state.commits.length - 5 && state.hasMore) void loadPage()
})

// ---------- detail ----------

function renderDetail(problem?: string): void {
  const top = detail.scrollTop
  if (state.selected === null) {
    detail.replaceChildren(el('div', { class: 'empty', text: state.workspace === null ? '' : 'Pick a commit.' }))
    return
  }
  const info = state.info
  const head = info
    ? el(
        'div',
        { class: 'commit-head' },
        el('h2', { text: info.message.split('\n')[0] ?? '' }),
        info.message.includes('\n') ? el('pre', { text: info.message.slice(info.message.indexOf('\n') + 1).trim() }) : null,
        el(
          'div',
          { class: 'facts' },
          el('span', { text: `${info.author} <${info.email}>` }),
          el('span', { text: `${dateFormat.format(info.date)} (${ago(info.date)} ago)` }),
          el('span', { class: 'mono', text: info.hash }),
          info.parents.length > 1 ? el('span', { text: `merge of ${info.parents.map((item) => item.slice(0, 7)).join(' + ')}` }) : null,
          info.committer !== info.author ? el('span', { text: `committed by ${info.committer}` }) : null
        )
      )
    : el('div', { class: 'status-line', text: 'Loading commit…' })
  const parts = [head, problem ? el('div', { class: 'error', text: problem }) : null, renderFiles(), renderDiff()]
  detail.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null))
  detail.scrollTop = top
}

function renderFiles(): HTMLElement | null {
  const changed = state.changed
  if (changed === null) return null
  if (changed.length === 0) return el('div', { class: 'notes', text: 'This commit changed no files.' })
  return el(
    'div',
    { class: 'files' },
    ...changed.map((file) => {
      const { name, folder } = splitPath(file.path)
      const counts =
        file.additions === undefined
          ? el('span', { class: 'counts', text: 'binary' })
          : el('span', { class: 'counts' }, el('span', { class: 'plus', text: `+${file.additions}` }), ' ', el('span', { class: 'minus', text: `−${file.deletions ?? 0}` }))
      const item = el(
        'div',
        { class: `file${state.shownFile?.path === file.path ? ' selected' : ''}`, onclick: () => void showFile(file) },
        el('span', { class: `badge ${file.status}`, text: file.status }),
        el('span', { class: 'path', title: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path }, el('span', { class: 'dir', text: folder }), name),
        counts
      )
      return item
    }),
    state.changedTruncated ? el('div', { class: 'notes', text: 'More files changed than are listed.' }) : null
  )
}

function renderDiff(): HTMLElement | null {
  const file = state.shownFile
  if (file === null) return null
  const parsed = state.diff
  // A whole added or deleted file has nothing to pair, so it reads better as one column.
  const oneSided = file.status === 'A' || file.status === 'D'
  const mode: DiffMode = oneSided ? 'unified' : state.mode
  const modeButton = (choice: DiffMode, label: string) =>
    el('button', {
      class: `btn${mode === choice ? ' on' : ''}`,
      text: label,
      onclick: () => {
        state.mode = choice
        renderDetail()
      }
    })
  const head = el(
    'div',
    { class: 'diff-head' },
    el('span', { class: 'path', text: file.oldPath ? `${file.oldPath} → ${file.path}` : file.path }),
    el('span', { class: 'spacer' }),
    oneSided ? null : modeButton('split', 'Split'),
    oneSided ? null : modeButton('unified', 'Unified'),
    file.status === 'D' ? null : el('button', { class: 'btn', text: 'Open file', onclick: () => void openInEditor(file.path) }),
    file.status === 'D' || state.file === file.path
      ? null
      : el('button', { class: 'btn', text: 'File history', onclick: () => void showFileHistory(file.path) })
  )
  const wrap = el('div', { class: 'diff-wrap' }, head)
  if (parsed === null) {
    wrap.append(el('div', { class: 'status-line', text: 'Loading diff…' }))
    return wrap
  }
  if (parsed.notes.length > 0) wrap.append(el('div', { class: 'notes', text: parsed.notes.join(' · ') }))
  if (parsed.hunks.length === 0) {
    if (parsed.notes.length === 0) wrap.append(el('div', { class: 'notes', text: 'No text changes.' }))
    return wrap
  }
  wrap.append(mode === 'split' ? splitTable(parsed.hunks) : unifiedTable(parsed.hunks))
  return wrap
}

function hunkRow(hunk: Hunk, columns: number): HTMLTableRowElement {
  const cell = el('td', { text: hunk.header })
  cell.colSpan = columns
  return el('tr', { class: 'hunk' }, cell)
}

function sideCells(side: Side | null, which: 'left' | 'right'): HTMLTableCellElement[] {
  if (side === null) return [el('td', { class: 'num none' }), el('td', { class: `code ${which} none` })]
  const kind = side.kind === 'context' ? '' : side.kind
  return [el('td', { class: `num ${kind}`, text: String(side.line) }), el('td', { class: `code ${which} ${kind}`, text: side.text })]
}

/** Fixed column widths: with `table-layout: fixed` the first row (a full-width hunk header)
 *  would otherwise split the width evenly. */
function columns(...widths: string[]): HTMLTableColElement {
  const group = el('colgroup')
  for (const width of widths) {
    const col = el('col')
    col.style.width = width
    group.append(col)
  }
  return group as unknown as HTMLTableColElement
}

function splitTable(hunks: readonly Hunk[]): HTMLTableElement {
  const table = el('table', { class: 'diff split' }, columns('48px', 'calc(50% - 48px)', '48px', 'calc(50% - 48px)'))
  const fragment = document.createDocumentFragment()
  for (const hunk of hunks) {
    fragment.append(hunkRow(hunk, 4))
    for (const row of hunk.split) fragment.append(el('tr', {}, ...sideCells(row.left, 'left'), ...sideCells(row.right, 'right')))
  }
  table.append(fragment)
  return table
}

function unifiedTable(hunks: readonly Hunk[]): HTMLTableElement {
  const table = el('table', { class: 'diff unified' }, columns('48px', '48px', 'auto'))
  const fragment = document.createDocumentFragment()
  for (const hunk of hunks) {
    fragment.append(hunkRow(hunk, 3))
    for (const row of hunk.unified) {
      const kind = row.kind === 'context' ? '' : row.kind
      const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '
      fragment.append(
        el(
          'tr',
          {},
          el('td', { class: `num ${kind}`, text: row.old === null ? '' : String(row.old) }),
          el('td', { class: `num ${kind}`, text: row.new === null ? '' : String(row.new) }),
          el('td', { class: `code ${kind}`, text: `${sign} ${row.text}` })
        )
      )
    }
  }
  table.append(fragment)
  return table
}

function scrollToDiff(): void {
  const target = detail.querySelector('.diff-wrap')
  if (target instanceof HTMLElement && target.offsetTop > detail.scrollTop + detail.clientHeight - 80) {
    detail.scrollTo({ top: Math.max(0, target.offsetTop - 8) })
  }
}

// ---------- start ----------

export async function start(): Promise<void> {
  renderToolbar()
  renderDetail()
  listStatus.textContent = 'Waiting for Orca…'
  // Orca waits for an editor to take its document; this tab only uses the file as a handle.
  void orca.document?.get()
  let seen = false
  orca.on('workspace.changed', (payload) => {
    seen = true
    void followFocus(payload.context).catch((reason) => renderDetail(message(reason)))
  })
  try {
    const context = await orca.host.call('workspace.readContext')
    if (!seen) await followFocus(context)
  } catch (reason) {
    listStatus.replaceChildren(el('div', { class: 'error', text: message(reason) }))
  }
}
