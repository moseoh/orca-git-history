// `orca plugin check` renders the panel once per scenario, each with the worker on a fresh
// host. `this-repo` points the worker at this plugin's own folder, so check runs real git.
import { defineCheck } from 'orca/testing'

export default defineCheck({
  'no-project': {
    results: { 'workspace.list': { workspaces: [], truncated: false } },
    events: [{ event: 'workspace.changed', payload: { context: null } }]
  },
  'this-repo': {
    results: {
      'workspace.list': {
        workspaces: [
          { id: 'self', kind: 'worktree', name: 'file-history', path: '.', branch: 'main', hostId: 'local' }
        ],
        truncated: false
      }
    },
    storage: { 'recent:self': ['src/panel.tsx', 'src/git.ts'] },
    events: [
      {
        event: 'workspace.changed',
        payload: { context: { displayName: 'file-history', branch: 'main', terminals: [] } }
      }
    ]
  }
})
