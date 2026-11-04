// Turns one file's unified diff (`git show -- <path>`) into rows for a side-by-side view: the old
// file on the left, the new one on the right, removed and added lines paired up within a change.

export type Side = { line: number; text: string; kind: 'context' | 'del' | 'add' }
/** One row of the split view; a side is null where that file has no line. */
export type SplitRow = { left: Side | null; right: Side | null }
/** One line of the unified view, with its old and new line numbers. */
export type UnifiedRow = { old: number | null; new: number | null; text: string; kind: Side['kind'] }
/** `header` is git's whole `@@ -a,b +c,d @@ context` line. */
export type Hunk = { header: string; split: SplitRow[]; unified: UnifiedRow[] }
export type ParsedDiff = {
  /** What git says about the file besides its lines: new, deleted, renamed, binary. */
  notes: string[]
  binary: boolean
  hunks: Hunk[]
  additions: number
  deletions: number
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

const NOTE_PREFIXES = [
  'new file mode',
  'deleted file mode',
  'rename from',
  'rename to',
  'copy from',
  'copy to',
  'old mode',
  'new mode'
]

export function parseDiff(text: string): ParsedDiff {
  const result: ParsedDiff = { notes: [], binary: false, hunks: [], additions: 0, deletions: 0 }
  let hunk: Hunk | null = null
  let oldLine = 0
  let newLine = 0
  let removed: Side[] = []
  let added: Side[] = []

  // Pairs the removed and added lines of one change, so a changed line sits beside its old self.
  const flush = (): void => {
    if (hunk !== null) {
      const count = Math.max(removed.length, added.length)
      for (let index = 0; index < count; index += 1) {
        hunk.split.push({ left: removed[index] ?? null, right: added[index] ?? null })
      }
    }
    removed = []
    added = []
  }

  for (const line of text.split('\n')) {
    const header = HUNK.exec(line)
    if (header) {
      flush()
      oldLine = Number(header[1])
      newLine = Number(header[2])
      hunk = { header: line, split: [], unified: [] }
      result.hunks.push(hunk)
      continue
    }
    if (hunk === null) {
      if (line.startsWith('Binary files ')) {
        result.binary = true
        result.notes.push('Binary file changed')
      } else if (NOTE_PREFIXES.some((prefix) => line.startsWith(prefix))) {
        result.notes.push(line)
      }
      continue
    }
    const body = line.slice(1)
    if (line.startsWith('\\')) {
      // "\ No newline at end of file" describes the line before it.
    } else if (line.startsWith('-')) {
      removed.push({ line: oldLine, text: body, kind: 'del' })
      hunk.unified.push({ old: oldLine, new: null, text: body, kind: 'del' })
      oldLine += 1
      result.deletions += 1
    } else if (line.startsWith('+')) {
      added.push({ line: newLine, text: body, kind: 'add' })
      hunk.unified.push({ old: null, new: newLine, text: body, kind: 'add' })
      newLine += 1
      result.additions += 1
    } else if (line.startsWith(' ')) {
      flush()
      hunk.split.push({
        left: { line: oldLine, text: body, kind: 'context' },
        right: { line: newLine, text: body, kind: 'context' }
      })
      hunk.unified.push({ old: oldLine, new: newLine, text: body, kind: 'context' })
      oldLine += 1
      newLine += 1
    } else {
      // git prefixes every hunk line, so anything else (the end of the text) ends the hunk.
      flush()
      hunk = null
    }
  }
  flush()
  return result
}
