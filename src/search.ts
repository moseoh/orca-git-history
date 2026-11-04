// Picks the files a typed query means: every space-separated word must appear in the path
// (case-insensitive); matches in the file name rank above matches only in folders.

export const MAX_RESULTS = 50

function score(path: string, words: readonly string[]): number | null {
  const lower = path.toLowerCase()
  const name = lower.slice(lower.lastIndexOf('/') + 1)
  let total = 0
  for (const word of words) {
    if (!lower.includes(word)) return null
    if (name === word) total += 100
    else if (name.startsWith(word)) total += 60
    else if (name.includes(word)) total += 40
    else total += 10
  }
  // Shallower and shorter paths first among equals.
  return total * 1000 - path.length
}

export function searchFiles(
  files: readonly string[],
  query: string
): { files: string[]; total: number } {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 0)
  if (words.length === 0) return { files: [], total: 0 }
  const matches: { path: string; score: number }[] = []
  for (const path of files) {
    const value = score(path, words)
    if (value !== null) matches.push({ path, score: value })
  }
  matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  return { files: matches.slice(0, MAX_RESULTS).map((match) => match.path), total: matches.length }
}
