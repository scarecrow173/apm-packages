# Dashboard Contract

## Report surface

The command emits one UTF-8, self-contained HTML file. It has no external CSS,
JavaScript, JSON, font, image, network, server, or watch dependency. Canonical
Markdown and Graph YAML are the only authorities. The report is a regenerable,
read-only snapshot and records collection and generation times.

The primary task surface is `#task-board`. Permanent lanes use
`data-kanban-lane="todo"`, `"in-progress"`, `"blocked"`, `"done"`, and
`"wont-do"`; an `unknown` lane appears for invalid status or parse-error tasks.
Cards use `data-task-card` and canonical `data-task-path` identity. They show
status, title, opaque ID, dependencies, plan membership, coverage, and separate
runnable/resumable projections. Duplicate opaque IDs are not merged. A waiting
todo remains in its canonical lane. Graph, route preview, plan task details,
document/relation tables, and diagnostics remain available.

The `#attention` section sits before diagnostics and groups hard blockers,
blocked-route reasons from the route preview, blocking findings, and task
graph issues into per-category panels with count badges; it reports that
nothing blocks progress when empty. Card readiness badges
aggregate runnable/resumable/blocked across plan memberships, and per-plan
membership details stay collapsed. The document table's free-text filter
matches only ID, title, and canonical path via `data-search-text`; type and
status stay on their dedicated selects.

The report is chart-first, in the style of monitoring dashboards. `#overview`
shows stat panels (accent-colored cards with tabular numerals) and `#charts`
renders inline panels: a task-status donut keyed to the kanban lane colors,
document-bucket horizontal bars, a graph-coverage gauge, and a findings
severity stacked bar plus the focused plan/focus facts. Charts are inline SVG
or CSS only; `role="img"`, `<title>`, and legend lists keep them readable
without color alone.

`#task-board` remains the primary task surface and stays unchanged. `#backlog`
lists canonical documents whose status is `draft` as cards — the pool of
candidates to review or start next — linked to their document-table rows.

A header pulse dot mirrors whether anything blocks progress (red while
blockers exist, otherwise green). The theme follows the viewer's color scheme
and can be overridden manually: a nav toggle button (or the `T` key) switches
`data-theme` on `<html>` and persists the choice in `localStorage`; without
JavaScript the `prefers-color-scheme` fallback still applies. Badges and pills
use translucent `color-mix` fills keyed to their semantic border color, the
sticky nav is translucent with a backdrop blur, and a faint grid backdrop sits
behind the page (disabled for print and reduced-motion).

The report keeps done/wont-do lanes folded, scrolls lane card lists inside each lane, and offers
a readiness filter plus expand/collapse controls for long detail sections. The
document filter state persists in a `#filter=` URL hash. All styling and
behavior is inline; the only image is a data-URI favicon. The `<style>` block
prepends vendored Pico CSS v2 classless (MIT) generated at build time, followed
by dashboard overrides that alias base tokens to `--pico-*` variables; semantic
lane/status colors keep their own light/dark palette. The markup follows Pico
classless conventions: `nav > ul` section links, `table.striped` tables, and a
`footer` regeneration note. No stylesheet is fetched at view time.

## Metrics and coverage

- Remaining means valid `todo`, `in-progress`, and `blocked` tasks. `done` is
  complete. `wont-do` is separate, remains in the valid denominator, and never
  satisfies a dependency.
- Completion is `done / validTaskTotal`; zero is shown as no applicable tasks.
  Invalid or unparseable tasks are counted separately.
- Repository task totals deduplicate by canonical path. Plan views can show a
  task for each plan membership. Orphan and graph-uncovered tasks remain visible.
- `draft`, `proposed`, and `capturing` are separate canonical document groups.
  Unmanaged Markdown does not receive an inferred status.
- Focus changes focused metrics but does not hide repository-wide inventory or
  draft counts. Ambiguous focus remains a `focus-required` blocker.
- `requiredAudits`, `commitGate`, runnable, and resumable are requirements or
  projections. They do not prove audit, commit, route, or execution occurred.
- Findings use the standard doc-status coverage. Parse failures, broken
  relations, graph issues, aliases outside graph coverage, and unmanaged
  documents remain visible rather than becoming success.

Before reporting counts, progress, lanes, blockers, or coverage, inspect the
newly generated HTML. User statements and CLI exit 0 are not snapshot evidence.
If inspection is unavailable, report only generation success and its path.

## CLI

```bash
mise exec -- node <doc-dashboard-skill-dir>/../doc-driven-dev-graph/scripts/build_dashboard.js --cwd <repo-root>
```

| Option | Contract |
| --- | --- |
| `--cwd <dir>` | Read root; defaults to `process.cwd()` and must be a directory. |
| `--graph <file>` | Graph path relative to process cwd; defaults to the bundled sibling YAML. |
| `--focus <id-or-path>` | Repeatable focus selector passed to existing resolution. |
| `--current <node>` | Enables route preview; an unknown node fails before generation. |
| `--signal <signal>` | Repeatable explicit signal; undeclared signals fail before generation. |
| `--out <file.html>` | Output relative to `--cwd`; default is `reports/doc-driven-dev/index.html`. |
| `--force` | Replaces an explicitly requested existing report without deleting it first. |
| `--help` | Prints usage and path bases without reading or generating a report. |

Output must be an `.html` file inside the target repository. Directories,
symlinks, and symlink ancestors that escape the repository are rejected. An
existing file requires `--force`. Rendering completes before a sibling
temporary file is created; exclusive initial publish and replacement rename
preserve old output on failure. Success prints `Dashboard written: <absolute
path>` and exits 0. Input, collection, or publication errors go to stderr and
exit 1. A failed regeneration leaves old HTML stale and it must not be
reported as the new result.
