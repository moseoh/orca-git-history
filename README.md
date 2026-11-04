# File History

An [Orca](https://onorca.dev) plugin that shows the Git history of the project you click in the
left sidebar: in a full editor tab, or in a right-sidebar panel.

## Git History tab

Open it from the tab bar **+** menu or the command palette: **Git History**.

- Commits on the left, newest first; scroll for older ones. Arrow keys move between commits.
- The picked commit's whole message, author, date and changed files (with added and removed line
  counts) on the right. Pick a file for its diff, **Split** (side by side) or **Unified**.
- **Find a file** narrows the list to the commits that changed that file, following renames.
- **Open file** opens the file in an editor tab; **File history** shows only that file's commits.

The tab is an untitled `.githistory` file used only as a handle: nothing is written to it.

## Panel

- **Commits**: the project's commits, 50 at a time (**Load more** for older ones). Expand a
  commit to list the files it changed; pick a file to see that file's diff.
- **Find a file**: type part of a path to search the workspace's tracked files, then pick one to
  list only the commits that changed it (following renames). Files looked at recently are kept
  under **Recent files**.
- **Open file**: opens the file in an Orca editor tab.

The panel follows the project focused in Orca; with none focused it asks you to click one.
Projects on SSH or other hosts are not supported yet.

## Access it asks for

- Runs its own worker (`trusted-worker`), which runs `git` in the workspace folder.
- `workspace:read`: list projects and follow the focused one.
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
- `editor/`: the Git History tab (`app.ts`), its side-by-side diff parser (`diff.ts`) and styles.
- `src/workspace.ts`: which workspace Orca has focused, shared by the panel and the tab.
- `src/node.d.ts`: types for the few Node built-ins the worker uses, so no `@types/node` is needed.
