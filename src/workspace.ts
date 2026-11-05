// For the Git History tab: which workspace Orca has focused, and short ages.
import type { Workspace } from './protocol'

export type FocusedContext = { branch: string; displayName: string } | null

/**
 * The local workspace Orca has focused; null when none matches. Orca names the focused project
 * only by name and branch, so both must match: a project of the same name on a remote Orca server
 * or over SSH is never mistaken for a local one. A folder project Orca reports without a branch
 * matches by name.
 */
export function focusedWorkspace(list: readonly Workspace[], context: FocusedContext): Workspace | null {
  if (context === null) return null
  const named = list.filter((item) => item.name === context.displayName)
  return (
    named.find((item) => (item.branch ?? '') === context.branch) ??
    named.find((item) => item.kind === 'folder' && context.branch === '') ??
    null
  )
}

/** "5m", "3h", "2d", "4mo", "1y": short enough for a narrow row. */
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

