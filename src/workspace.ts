// Shared by the panel and the Git History tab: which workspace Orca has focused, and short ages.
import type { Workspace } from './protocol'

export type FocusedContext = { branch: string; displayName: string } | null

/** The workspace Orca has focused, matched by name and branch; null when none matches. */
export function focusedWorkspace(list: readonly Workspace[], context: FocusedContext): Workspace | null {
  if (context === null) return null
  return (
    list.find((item) => item.name === context.displayName && (item.branch ?? '') === context.branch) ??
    list.find((item) => item.name === context.displayName) ??
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

