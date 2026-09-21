---
name: doc-dashboard
description: Use when the user wants an offline HTML dashboard of doc-driven development progress, graph gates, remaining tasks, or draft documents.
license: MIT
---

# Document Progress Dashboard

Generate one manually created, offline HTML snapshot for inspection. This is a
reporting capability, not an orchestration entrypoint. Canonical Markdown and
Graph YAML remain authoritative. Read [the dashboard contract](references/dashboard-contract.md)
for the complete CLI, coverage, and metric definitions.

## Workflow

1. Resolve the target repository and this skill's installed directory.
2. Pass `--focus`, `--current`, and `--signal` only when the caller explicitly
   supplies them. Omit unknown values; never infer an execution position from
   document status.
3. Resolve the sibling bundled script from this skill directory, then run it:

   ```bash
   mise exec -- node ../doc-driven-dev-graph/scripts/build_dashboard.js --cwd <repo-root>
   ```

   The relative script path is relative to the installed skill directory, not
   the caller's working directory. Resolve it to an absolute path before
   execution. Use the consumer repository's documented Node runner when it does
   not use mise.

4. Add `--out` only for a requested repository-relative HTML destination. Use
   `--force` when the user requests regeneration of an existing report.
5. Inspect the newly generated HTML before reporting counts, progress, lanes,
   blockers, or coverage. Report the link, generation timestamp, observed
   counts, important blockers, and coverage limitations from that file. If the
   new file cannot be inspected, report only the generation path and say that
   snapshot facts are unverified.

## Reading the report

The task board is the primary surface. It has permanent `todo`, `in-progress`,
`blocked`, `done`, and `wont-do` lanes, plus an `unknown` lane for invalid
status or parse-error tasks. Cards show title, opaque ID, canonical path,
dependencies, plan membership, coverage, and separate runnable/resumable
readiness projections. A dependency-waiting todo remains in the todo lane.
Graph topology, route preview, plan task details, documents, relations, and
diagnostics remain available as supporting views.

## Boundaries

- Treat the board as a read-only snapshot. It has no drag, status editing, or
  Markdown persistence behavior.
- Do not edit statuses, approve documents, repair relations, rebuild indexes,
  dispatch delegates, or commit changes.
- Do not synthesize verification signals or claim that a supplied current node
  was observed. Runnable and resumable are projections, not execution proof.
- Do not start a server, watch process, network request, or external asset load.
- Do not add a graph node or invent an `EffectOutcome` for report generation.
- Use `doc-status` for audit detail and `doc-driven-dev-graph` for explicit
  routing requests; do not activate either as an additional orchestrator.
- Exit 0 proves that a report was generated, not that the graph is healthy. A
  failed regeneration must never be reported as a new result using stale HTML.
