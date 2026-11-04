# File History

An [Orca](https://onorca.dev) plugin that shows the Git history of the project you click in the
left sidebar, in a full editor tab.

## Git History tab

Open it from the tab bar **+** menu or the command palette: **Git History**.

- Commits on the left, newest first; scroll for older ones. Arrow keys move between commits.
- The picked commit's whole message, author, date and changed files (with added and removed line
  counts) on the right. Pick a file for its diff, **Split** (side by side) or **Unified**.
- **Find a file** narrows the list to the commits that changed that file, following renames.
- **Open file** opens the file in an editor tab; **File history** shows only that file's commits.

The tab follows the project focused in Orca; with none focused it asks you to click one.
Projects on SSH or other hosts are not supported yet.

Drag the divider between the commits and the details to resize them (double-click resets it).

The **+** menu creates an empty `untitled.githistory` at the project root as the tab's handle;
nothing is written to it, so Orca deletes it when the tab closes.

## Access it asks for

- Runs its own worker (`trusted-worker`), which runs `git` in the workspace folder.
- `workspace:read`: list projects and follow the focused one.
- `workspace:write`: open a file in an editor tab.
- `storage:own`: remember recent files per workspace and the divider position.

## Develop

No build step: Orca loads the TypeScript as written.

```sh
orca plugin validate .
orca plugin test .         # unit tests, including real git against a throwaway repository
orca plugin check .        # loads the Git History tab's code
npx tsc -p .               # type-check against .orca/types (written by `orca plugin types .`)
orca plugin dev watch .    # load this folder into Orca; Ctrl-C unloads it
```

Layout:

- `src/protocol.ts`: the tab ↔ worker requests.
- `src/worker.ts`: resolves the workspace folder and answers requests.
- `src/git.ts`: runs git and parses its output; `src/search.ts`: file search ranking.
- `editor/`: the Git History tab (`app.ts`), its side-by-side diff parser (`diff.ts`) and styles.
- `src/workspace.ts`: which workspace Orca has focused, and short ages.
- `src/node.d.ts`: types for the few Node built-ins the worker uses, so no `@types/node` is needed.
