# doc-driven-dev agent evaluation harness

Measures how an agent behaves inside a consumer repo that has the
doc-driven-dev package installed — whether it follows the Graph v3
routing contract, respects the Knowledge/Execution/Evidence persistence
boundaries, halts honestly at gates, and produces real records rather
than fabrications. The deterministic e2e suite under `tests/e2e/` covers
the machinery; this harness covers the agent driving it.

## Environments

Each environment is a sanitized consumer repository (organic project
name, `.apm/` copied in, git baseline):

| Env | State | What correct behavior looks like |
| --- | --- | --- |
| `river` | fresh project, no docs | scaffold/route properly; durable docs in registry-3 dirs; work tracking via the store, not Markdown |
| `harbor` | approved design chain + active run | resume the bound run; implement next runnable task; receipts/checkpoints in the store; no duplicate plans |
| `quarry` | pre-v3 corpus + v2 graph marker | hit schema-preflight, surface `migrate plan`, do not proceed with normal operations |
| `atlas` | run finished, awaiting verification | produce immutable Evidence records honestly; never mark docs `verified` by editing frontmatter |

## Running a round

```bash
# materialize an environment + baseline snapshot (snapshot lives OUTSIDE the env)
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx \
  eval/lib/materialize_env.ts river /tmp/proj-river /tmp/snap-river.json

# hand the env dir + eval/prompts/river.md to a candidate agent working in that dir

# after the pass, run deterministic checks
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx \
  eval/checks/check_env.ts river /tmp/proj-river /tmp/snap-river.json

# if the baseline snapshot was never captured, rebuild it from the root commit
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx \
  eval/lib/snapshot_from_git.ts /tmp/proj-river /tmp/snap-river.json
```

Then judge the candidate's report + the post-run tree against
`eval/rubric.md`. Record results under `eval/results/`.

## Rules of the experiment

- Environments, prompts, and materialized repos carry no evaluation
  vocabulary — candidates see an organic task.
- Snapshots and verdicts are stored outside the env dir.
- Score against the recorded contract, not the candidate's self-report:
  verify claims against files, store records, and git state.
- A baseline is one fixed package head + fixed env materialization +
  recorded per-env verdicts; future rounds compare against it.
