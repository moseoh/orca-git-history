// The Git History tab's styles, from Orca's theme variables so light and dark both work.
export const STYLES = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--orca-background); color: var(--orca-foreground);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: hidden;
}
button { font: inherit; color: inherit; }
.app { display: grid; grid-template-rows: auto 1fr; height: 100vh; }
.toolbar {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px;
  border-bottom: 1px solid var(--orca-border);
}
.toolbar .project { font-weight: 600; white-space: nowrap; }
.toolbar .branch { color: var(--orca-muted-foreground); white-space: nowrap; }
.toolbar .spacer { flex: 1; }
.search { position: relative; width: min(420px, 45vw); }
.search input {
  width: 100%; padding: 5px 8px; border-radius: var(--orca-radius, 6px);
  border: 1px solid var(--orca-input); background: transparent; color: inherit; font: inherit;
}
.search input:focus { outline: 2px solid var(--orca-ring); outline-offset: -1px; }
.suggestions {
  position: absolute; z-index: 10; top: calc(100% + 4px); left: 0; right: 0; max-height: 320px;
  overflow: auto; background: var(--orca-popover); color: var(--orca-popover-foreground);
  border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 6px);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.25);
}
.suggestion { display: flex; gap: 8px; padding: 5px 10px; cursor: pointer; }
.suggestion:hover, .suggestion.active { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.suggestion .dir { color: var(--orca-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px 2px 8px; max-width: 40vw;
  border-radius: 999px; background: var(--orca-secondary); color: var(--orca-secondary-foreground);
}
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn {
  border: 1px solid var(--orca-border); background: transparent; border-radius: var(--orca-radius, 6px);
  padding: 3px 9px; cursor: pointer; white-space: nowrap;
}
.btn:hover { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.btn.ghost { border-color: transparent; padding: 2px 6px; }
.btn.on { background: var(--orca-secondary); color: var(--orca-secondary-foreground); }
.body { display: grid; grid-template-columns: minmax(340px, 42%) 1fr; min-height: 0; }
@media (max-width: 900px) { .body { grid-template-columns: 1fr; grid-template-rows: 40% 60%; } }
.list { overflow: auto; border-right: 1px solid var(--orca-border); min-height: 0; }
.row {
  display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; padding: 6px 12px; cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--orca-border) 50%, transparent);
}
.row:hover { background: color-mix(in srgb, var(--orca-accent) 55%, transparent); }
.row.selected { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.row .subject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row .when { color: var(--orca-muted-foreground); font-size: 12px; white-space: nowrap; }
.row .meta { grid-column: 1 / -1; color: var(--orca-muted-foreground); font-size: 12px; display: flex; gap: 10px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.status-line { padding: 10px 12px; color: var(--orca-muted-foreground); }
.detail { overflow: auto; min-height: 0; }
.empty { display: grid; place-items: center; height: 100%; color: var(--orca-muted-foreground); text-align: center; padding: 24px; }
.commit-head { padding: 14px 16px 10px; border-bottom: 1px solid var(--orca-border); }
.commit-head h2 { margin: 0 0 6px; font-size: 15px; }
.commit-head pre { margin: 6px 0 8px; white-space: pre-wrap; font: inherit; color: var(--orca-muted-foreground); }
.facts { display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--orca-muted-foreground); font-size: 12px; }
.files { padding: 6px 0; border-bottom: 1px solid var(--orca-border); }
.file {
  display: grid; grid-template-columns: 18px 1fr auto; gap: 8px; align-items: center;
  padding: 3px 16px; cursor: pointer;
}
.file:hover { background: color-mix(in srgb, var(--orca-accent) 55%, transparent); }
.file.selected { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.file .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file .path .dir { color: var(--orca-muted-foreground); }
.badge { font: 600 11px ui-monospace, monospace; text-align: center; border-radius: 3px; }
.badge.A { color: #3fb950; } .badge.D { color: #f85149; } .badge.M { color: #d29922; }
.badge.R, .badge.C { color: #58a6ff; }
.counts { font-size: 12px; white-space: nowrap; }
.counts .plus { color: #3fb950; } .counts .minus { color: #f85149; }
.diff-head {
  position: sticky; top: 0; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 6px 16px;
  background: var(--orca-card); color: var(--orca-card-foreground); border-bottom: 1px solid var(--orca-border);
}
.diff-head .spacer { flex: 1; }
.diff-head .path { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notes { padding: 8px 16px; color: var(--orca-muted-foreground); }
table.diff { width: 100%; border-collapse: collapse; table-layout: fixed; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
table.diff td { padding: 0 8px; vertical-align: top; white-space: pre-wrap; word-break: break-all; }
table.diff td.num {
  text-align: right; color: var(--orca-muted-foreground); user-select: none;
  white-space: nowrap; word-break: normal;
}
table.diff tr.hunk td { background: color-mix(in srgb, #58a6ff 12%, transparent); color: var(--orca-muted-foreground); padding: 3px 8px; }
td.del { background: color-mix(in srgb, #f85149 16%, transparent); }
td.add { background: color-mix(in srgb, #3fb950 16%, transparent); }
td.num.del { background: color-mix(in srgb, #f85149 24%, transparent); }
td.num.add { background: color-mix(in srgb, #3fb950 24%, transparent); }
td.none { background: color-mix(in srgb, var(--orca-muted) 55%, transparent); }
table.diff.split td.code.left { border-right: 1px solid var(--orca-border); }
.error { margin: 10px 16px; padding: 8px 10px; border-radius: 6px; color: #f85149; border: 1px solid color-mix(in srgb, #f85149 50%, transparent); }
`
