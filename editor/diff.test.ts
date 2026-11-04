import { assert, test } from 'orca/testing'
import { parseDiff } from './diff'

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,5 @@ export function greet() {',
  ' one',
  '-two',
  '-three',
  '+TWO',
  ' four',
  '+five',
  '+six',
  '\\ No newline at end of file',
  ''
].join('\n')

test('pairs removed and added lines of one change side by side', () => {
  const diff = parseDiff(DIFF)
  assert.equal(diff.hunks.length, 1)
  assert.equal(diff.hunks[0]?.header, '@@ -1,4 +1,5 @@ export function greet() {')
  assert.deepEqual(
    diff.hunks[0]?.split.map((row) => [row.left && `${row.left.line}${row.left.kind[0]} ${row.left.text}`, row.right && `${row.right.line}${row.right.kind[0]} ${row.right.text}`]),
    [
      ['1c one', '1c one'],
      ['2d two', '2a TWO'],
      ['3d three', null],
      ['4c four', '3c four'],
      [null, '4a five'],
      [null, '5a six']
    ]
  )
  assert.equal(diff.additions, 3)
  assert.equal(diff.deletions, 2)
})

test('unified rows carry both line numbers', () => {
  const rows = parseDiff(DIFF).hunks[0]?.unified ?? []
  assert.deepEqual(
    rows.map((row) => [row.old, row.new, row.kind]),
    [
      [1, 1, 'context'],
      [2, null, 'del'],
      [3, null, 'del'],
      [null, 2, 'add'],
      [4, 3, 'context'],
      [null, 4, 'add'],
      [null, 5, 'add']
    ]
  )
})

test('notes renames, new files and binary changes', () => {
  const renamed = parseDiff('diff --git a/x b/y\nsimilarity index 100%\nrename from x\nrename to y\n')
  assert.deepEqual(renamed.notes, ['rename from x', 'rename to y'])
  assert.equal(renamed.hunks.length, 0)
  const binary = parseDiff('diff --git a/i.png b/i.png\nnew file mode 100644\nBinary files /dev/null and b/i.png differ\n')
  assert.equal(binary.binary, true)
  assert.deepEqual(binary.notes, ['new file mode 100644', 'Binary file changed'])
})

test('several hunks keep their own line numbers', () => {
  const diff = parseDiff('@@ -1,1 +1,1 @@\n-a\n+b\n@@ -10,2 +10,2 @@ ctx\n x\n-y\n+z\n')
  assert.equal(diff.hunks.length, 2)
  assert.deepEqual(diff.hunks[1]?.split[1], {
    left: { line: 11, text: 'y', kind: 'del' },
    right: { line: 11, text: 'z', kind: 'add' }
  })
})
