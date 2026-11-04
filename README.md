# File History

An [Orca](https://onorca.dev) plugin that shows the Git history of one file at a time in the
right sidebar.

- **Find a file**: type part of a path to search the workspace's tracked files. Files you looked
  at recently are listed when the box is empty.
- **History**: the commits that changed the file, following renames. Select one to see its diff.
- **Blame**: who last changed each line, including lines not committed yet. Press Enter or
  double-click a line to jump to its commit in History.
- **Lines**: enter a line range to see only the commits that changed those lines (`git log -L`).
- **Open file**: opens the file in an Orca editor tab.

The panel follows the workspace focused in Orca. Workspaces on SSH or other hosts are not
supported yet.

## Access it asks for

- Runs its own worker (`trusted-worker`), which runs `git` in the workspace folder.
- `workspace:read`: list workspaces and follow the focused one.
- `workspace:write`: open a file in an editor tab.
- `storage:own`: remember recent files per workspace.

## Develop

No build step: Orca loads the TypeScript as written.

```sh
orca plugin validate .
orca plugin test .         # unit tests, including real git against a throwaway repository
orca plugin check .        # renders the panel with the worker for each src/panel.check.ts scenario
npx tsc -p .               # type-check against .orca/types (written by `orca plugin types .`)
orca plugin dev watch .    # load this folder into Orca; Ctrl-C unloads it
```

Layout:

- `src/protocol.ts`: the panel ↔ worker requests.
- `src/worker.ts`: resolves the workspace folder and answers requests.
- `src/git.ts`: runs git and parses its output; `src/search.ts`: file search ranking.
- `src/panel.tsx`: the sidebar panel.
- `src/node.d.ts`: types for the few Node built-ins the worker uses, so no `@types/node` is needed.
