# Distribution verification — `devin plugins install` evidence log (issue `#217`)

Reproduction contract: every recorded command below was run on the
recorded date and platform against the real `devin` CLI and the public
`scarecrow173/apm-packages` GitHub repository. Re-run blocks verbatim to
reproduce; divergence means `devin` CLI behavior or the published tree
drifted and this log must be re-verified — never blanket-passed.

## 1. Environment

- date: 2026-11-17
- platform: windows, git-bash (commands run via `mise exec --`)
- worktree: `.worktrees/pstack-devin-217` (branch `feat/pstack-devin-issue-217`)
- devin: `devin 3000.12.57 (96542e930752)`
- pre-state: `devin plugins list` → `No plugins installed.`;
  `%APPDATA%\devin\cli\plugins\` held only `discovered.json`/`lock.json`
  (+ `.lock` sidecars)

## 2. Source syntax — `devin plugins install --help`

Recorded verbatim because the flag semantics are easy to misread:

```text
Install a plugin from a source (auto-installs its required plugins).

A source is a GitHub `owner/repo`, a git URL, or a local path. Append `#path/to/plugin` when the plugin is below a git repository's root. A repository with no plugin manifest but skills under `skills/<name>/SKILL.md` installs as a skills-only plugin named after the repository.

Usage: devin.exe plugins install [OPTIONS] <SOURCE>

Arguments:
  <SOURCE>
          The plugin source (e.g. `acme/review-tools`, `acme/plugins#plugins/review`, a git URL, or `./path`)

Options:
  -y, --yes
          Skip the interactive trust prompt

      --local
          Install on this machine only, without adding the plugin to your personal plugins

  -h, --help
          Print help (see a summary with '-h')
```

Read carefully:

- `--local` is a **scope** flag (this machine only, not your personal
  plugin set). It is **not** the local-path selector — a local path is
  passed directly as `<SOURCE>`.
- The git-subdirectory form is `owner/repo#path/to/plugin` (or
  `git-url#path`). Both forms below were exercised for real.

Removal scope must match install scope: `devin plugins remove --help`
states `--local` "Fails for plugins that are in your personal plugins",
so a `--local` install is removed with `remove <name> --local -y`, and a
personal-plugins install with `remove <name> -y`.

## 3. Path A — local working tree, `--local` scope

```bash
mise exec -- devin plugins install "G:/repositry/apm-packages/.worktrees/pstack-devin-217/packages/pstack-devin/devin-plugin" --local -y
```

Output (verbatim):

```text
This install will add:
  • pstack v0.1.0
      /pstack:architect
      /pstack:arena
      /pstack:automate-me
      /pstack:benchmark-checklist
      /pstack:blast-radius
      /pstack:bro
      /pstack:correct
      /pstack:create-formal-verification-skill
      /pstack:create-verification-skill
      /pstack:figure-it-out
      /pstack:how
      /pstack:in-your-own-words
      /pstack:interrogate
      /pstack:ketchup
      /pstack:ketchup-video
      /pstack:maintain-formal-verification-skill
      /pstack:maintain-verification-skill
      /pstack:make-bot-ui
      /pstack:no-comments
      /pstack:poteto-help
      /pstack:poteto-mode
      /pstack:principle-attack-the-premise
      /pstack:principle-boundary-discipline
      /pstack:principle-build-the-lever
      /pstack:principle-encode-lessons-in-structure
      /pstack:principle-exhaust-the-design-space
      /pstack:principle-experience-first
      /pstack:principle-explain-the-number
      /pstack:principle-fix-root-causes
      /pstack:principle-foundational-thinking
      /pstack:principle-guard-the-context-window
      /pstack:principle-laziness-protocol
      /pstack:principle-make-operations-idempotent
      /pstack:principle-migrate-callers-then-delete-legacy-apis
      /pstack:principle-minimize-reader-load
      /pstack:principle-model-the-domain
      /pstack:principle-never-block-on-the-human
      /pstack:principle-outcome-oriented-execution
      /pstack:principle-prove-it-works
      /pstack:principle-redesign-from-first-principles
      /pstack:principle-separate-before-serializing-shared-state
      /pstack:principle-sequence-verifiable-units
      /pstack:principle-subtract-before-you-add
      /pstack:principle-test-behavior-not-implementation
      /pstack:principle-type-system-discipline
      /pstack:recall
      /pstack:reflect
      /pstack:setup-pstack
      /pstack:setup-pstack-devin
      /pstack:sharpen
      /pstack:show-me-your-work
      /pstack:statechart
      /pstack:swarm
      /pstack:tdd
      /pstack:teach
      /pstack:technical-writing
      /pstack:typescript-best-practices
      /pstack:unslop
      /pstack:why
      rule: AGENTS.md (always on)
✓ Installed pstack.
```

- exit: `0`

```bash
mise exec -- devin plugins list
```

Output (verbatim):

```text
Installed plugins

  • pstack v0.1.0

```

```bash
mise exec -- devin plugins info pstack
```

Output (verbatim — this is the canonical content listing; §4 shows the
GitHub install's `info` differs only in the `source:` line):

```text
Plugin: pstack
  version: 0.1.0
  source: G:\repositry\apm-packages\.worktrees\pstack-devin-217\packages\pstack-devin\devin-plugin
  description: if you want to go fast, go deep first. pstack helps you write less, but higher quality code. rigorous agent workflows you can parallelize with confidence.

Skills
  /pstack:architect - Sketch types, signatures, and module structure before code, then stay in the loop while implementation fills in. Use for /architect, 'architect this', 'design this', or non-trivial work where jumping to code would lock in the wrong shape.
  /pstack:arena - Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape.
  /pstack:automate-me - Use for "automate me", "create/update/refresh my -mode skill", "turn/capture my preferences or working style into a skill", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill via create-skill + unslop, optionally pulling fresh evidence from recent transcripts.
  /pstack:benchmark-checklist - Vet a perf measurement (limiter, tuning, limits, errors, repeatability, relevance, and whether the work happened) before you report or act on it. Use when you run a benchmark or report a speedup or regression you measured.
  /pstack:blast-radius - Find what a change could break somewhere else before it ships, beyond the diff, and prove the one fact it's safe because of by running real code instead of writing it up. Use for 'blast radius of X', 'what could this break', or reviewing a small diff you don't trust.
  /pstack:bro - Restate the last message in plain human language, with no jargon.
  /pstack:correct - Find the mistakes agents keep repeating in this repo and make each one impossible. Try architecture first, then types, then a lint whose error names the fix, then a test, and write docs last. Prove each check fails on a real past mistake. Repeat this each time the operator corrects you. Use for /correct.
  /pstack:create-formal-verification-skill - Generate a project-local skill that formally verifies the code where a bug costs the most and tests reach the least, in any language, with whichever verification tool fits. Use for /create-formal-verification-skill, "model-check this race", "prove this invariant", or when concurrency, retries, state machines, parsers, or unsafe code need more than tests.
  /pstack:create-verification-skill - Generate a project-local verification skill that drives your app the way a user does — any language, framework, or platform. Use for /create-verification-skill, "make a control skill for this repo", or when a project has no scripted way to prove UI/CLI/service behavior.
  /pstack:figure-it-out - Design an auditable playbook when no narrower one fits: a large migration, an ambitious multi-part change, or work a human reviews after stepping away. Scales rigor to the task, runs a hypothesis loop, and logs decisions. Use for /figure-it-out or 'figure it out'.
  /pstack:how - Use for "how does X work", code walkthroughs before changing something, and placement / ownership / layering questions ("where should this live", "which package owns this", "is this the right layer"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation.
  /pstack:in-your-own-words - Restate in your own words what you think the user's goals are and what problem they're trying to solve. Use for /in-your-own-words.
  /pstack:interrogate - Use for "interrogate", "adversarial review", "multi-model review", "challenge this", "stress test this code", "find blind spots", or "tear this apart". Adversaries try to break a change or design, and only findings proven by a run survive.
  /pstack:ketchup - Catch the user up on what changed in this chat since their last message, in plain words and small visuals. List every item waiting on them with what they need to decide it from the reply alone. Use for /ketchup.
  /pstack:ketchup-video - Catch the user up like /ketchup, with a short subtitled video of slides for what happened and the waiting calls as text under it. Use for /ketchup-video.
  /pstack:maintain-formal-verification-skill - Bring a project's formal verification back in line with the code after the code changes: find the commits that touched verified code, update the model, harness, or properties to describe the code as it is now, rerun, and say whether each failure is drift in the verification or a bug in the code. Use for /maintain-formal-verification-skill, "is the model still true to the code", or after merges and refactors that touched verified code without rechecking it.
  /pstack:maintain-verification-skill - Periodic pass that keeps a project's verification skill and feature map honest: parallel source readers per feature, one live session driving every feature, at most one PR of proven corrections. Use for /maintain-verification-skill or "audit the verify skill".
  /pstack:make-bot-ui - Use when building a custom UI (page, dashboard, buttons) that should wake a Grok Bot over a webhook, when the user must provide a webhook sender key, or when exposing that UI on Tailscale.
  /pstack:no-comments - Spawn Comment Sicko, fix accepted findings, and offer encodings for claimed constraints.
  /pstack:poteto-help - Guides users through pstack setup, /poteto-mode, and picking the skill, playbook, or principle for a task. Type /poteto-help with a question.
  /pstack:poteto-mode - poteto's agent style for concise, detailed responses, deliberate subagents, unslopped prose, simple code, and verified work. Use for poteto, /poteto-mode, or requests to work in this style.
  /pstack:principle-attack-the-premise - Apply when two or more fixes that share one premise have failed the same gate. Write the premise down and test it directly before you write another fix that assumes it.
  /pstack:principle-boundary-discipline - Apply when wiring validation, error handling, or framework adapters. Concentrate guards at system boundaries (CLI, config, network, external APIs); trust internal types and keep business logic in pure functions.
  /pstack:principle-build-the-lever - Apply to any non-trivial work, not just bulk work: edits, migrations, analyses, checks. Build the tool that does it or proves it (codemod, script, generator, or a skill your subagents follow) instead of working by hand. The tool is the artifact a reviewer can rerun.
  /pstack:principle-encode-lessons-in-structure - Apply when you catch yourself writing the same instruction a second time, or notice a recurring correction. Encode the rule as a lint, metadata flag, runtime check, or script instead of more text.
  /pstack:principle-exhaust-the-design-space - Apply when facing a novel UI interaction or architectural decision with no precedent in the codebase. Build 2-3 competing prototypes and compare side by side before committing.
  /pstack:principle-experience-first - Apply when product, UX, or feature-scope tradeoffs come up. Choose user delight over implementation convenience; ship fewer polished features over more rough ones.
  /pstack:principle-explain-the-number - Apply before you measure, and before you trust, report, or act on a number you measured: a speedup, a regression, a throughput, a latency, or an eval result. Find what limits it, and rule out that it measured something other than the work you think.
  /pstack:principle-fix-root-causes - Apply when debugging. Trace each symptom back to the first place the system went wrong and fix it there. A guard is a fix only when the state it handles is legitimate.
  /pstack:principle-foundational-thinking - Apply before writing logic: choosing core types and data structures, sequencing scaffold-vs-feature work, asking what concurrent actors share. Get the data structures right so downstream code becomes obvious.
  /pstack:principle-guard-the-context-window - Apply when context is filling up: large outputs, long files, repeated reads, fan-out planning. Route bulk to subagents; keep summaries in the main thread, not raw payloads.
  /pstack:principle-laziness-protocol - Apply when refactoring, evaluating diff size, or tempted to add abstractions, layers, or signal threading. Bias toward deletion and the smallest change that solves the problem.
  /pstack:principle-make-operations-idempotent - Apply when designing commands, lifecycle steps, or processing loops that run amid crashes, restarts, and retries. Converge to the same end state regardless of partial prior runs.
  /pstack:principle-migrate-callers-then-delete-legacy-apis - Apply when introducing a new internal API while old callers still exist. Migrate callers and delete the old API in the same wave instead of preserving compatibility layers.
  /pstack:principle-minimize-reader-load - Apply when reviewing or shaping code that's hard to trace. Count layers between question and answer, and hidden state in the reader's head; collapse one-caller wrappers and shrink mutable scope.
  /pstack:principle-model-the-domain - Apply when writing stateful logic, or when code branches a lot or repeats a shape assumption across files.
  /pstack:principle-never-block-on-the-human - Apply when tempted to ask 'should I do X?' on reversible work.
  /pstack:principle-outcome-oriented-execution - Apply during planned rewrites and migrations with explicit phase boundaries. Converge on the target architecture; don't preserve smooth intermediate states with throwaway compatibility code.
  /pstack:principle-prove-it-works - Apply after completing a task, before declaring done. Verify against the real artifact (run the feature, read the actual value, inspect the diff), not a proxy, self-report, or 'it compiles.'
  /pstack:principle-redesign-from-first-principles - Apply when integrating a new requirement into an existing design.
  /pstack:principle-separate-before-serializing-shared-state - Apply when concurrent actors might write to the same file, branch, key, or state object. Eliminate the sharing first; serialize structurally only when one shared writer is a real invariant.
  /pstack:principle-sequence-verifiable-units - Apply to multi-step work (sweeps, migrations, runs of similar edits) and to how you stack commits and PRs. Break work into small units that each end in a verifiable state, check each before the next, and order delivery so the sequence proves itself to a reviewer.
  /pstack:principle-subtract-before-you-add - Apply when sequencing an addition, refactor, or rewrite. Remove dead code, redundant validators, and stub references first, then build on the simpler base.
  /pstack:principle-test-behavior-not-implementation - Apply when you write, change, or keep a test. Assert what the code's users can observe, so that the test fails when that behavior breaks and keeps passing when only the internals change.
  /pstack:principle-type-system-discipline - Apply when designing types, reviewing a function signature, or writing code in any statically-typed language. Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, exhaust variants, derive from authoritative schemas.
  /pstack:recall - Reconstruct your recent working context from your own chat history, live state, and the shared record (user reports, prior fixes, incidents), then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what have I been working on', 'where did I leave off', before starting or resuming work.
  /pstack:reflect - Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
  /pstack:setup-pstack - Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes an always-applied rule that overrides the skill defaults. Use for /setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
  /pstack:setup-pstack-devin - Configure which models pstack uses per role and at what reasoning budget on Devin. Detects models via `devin models list` and writes an always-on Devin rule plus model-pinned custom subagent profiles that override the skill defaults. Use for /pstack:setup-pstack, "configure pstack models", "pstack budget", or changing pstack's model choices.
  /pstack:sharpen - Make a task deeper, not bigger, then rewrite the prompt. Use for /sharpen.
  /pstack:show-me-your-work - Keep a reviewable decision trail for long-running or unattended work: a TSV log with one row per decision (what, why, evidence, result). Local by default; commit it when a reviewer needs the trail to trust the result. Use for /show-me-your-work, autonomous or multi-phase runs, or work a human reviews after stepping away.
  /pstack:statechart - Check a TLA+ model of a system that moves between states, such as a product flow, a protocol, or a service, and draw it as a Mermaid statechart. The report gives the shortest path to each state that breaks a rule. Use for /statechart, or to show a bug as a path through states.
  /pstack:swarm - Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration.
  /pstack:tdd - Use only when the user explicitly asks for TDD, a failing test, or a regression test, OR when the bug has an obvious cheap local test target. Skip when the test path is unclear, expensive, integration-heavy, or not requested.
  /pstack:teach - Explain a body of work plainly so a person actually understands it. Runs the `how` and `why` skills and weaves what they find into one clear explanation. Use for 'teach me this', 'help me really understand X', 'explain this change or subsystem to me'.
  /pstack:technical-writing - Layered technical-writing standard: Diátaxis structure, Google developer style sentences, STE instruction rules, Global English syntax. Use for /technical-writing or when writing or reviewing docs, RFCs, readmes, PR descriptions, or commit messages.
  /pstack:typescript-best-practices - TypeScript best practices. Use when reading or editing any .ts or .tsx file.
  /pstack:unslop - Cut AI tells from any writing.
  /pstack:why - Use for 'why does X work this way', 'why we picked Y', design rationale, regressions, postmortems, or data-backed thresholds. Returns a cited read on decisions and tradeoffs. Use how for runtime behavior.

Agents
  pstack:comment-sicko - A deranged comment-hater that savors deletion and condemns workaround code.
  pstack:poteto-agent - Delegate subagent for code-writing and helper tasks spawned during a `/pstack:poteto-mode` run. Use for delegates, not as the runner for `/pstack:poteto-mode` itself. Spawn a fresh `poteto-agent` for each new task, and resume one only in the strict cases that poteto-mode's Subagents section names. Reads the `poteto-mode` skill's `SKILL.md` in full before any work, including its inline Principles index. Substituting `subagent_general` skips that read and drifts.

Hooks
  (none)

Rules
  • AGENTS.md (always on)

MCP servers
  (none)

Required plugins: (none)

Optional plugins: (none)

Forbidden plugins: (none)
```

Required-content check against the listing above:

- skills include `/pstack:poteto-mode` and `/pstack:setup-pstack-devin` ✓
- agents include `pstack:poteto-agent` and `pstack:comment-sicko` ✓
- one always-on rule (`AGENTS.md`); no hooks, MCP servers, or required /
  optional / forbidden plugins ✓

Removal and post-state:

```bash
mise exec -- devin plugins remove pstack --local -y
# ✓ Removed pstack.                                    (exit 0)

mise exec -- devin plugins list
# No plugins installed.                                (exit 0)
```

## 4. Path B — GitHub `owner/repo#subdir`

```bash
mise exec -- devin plugins install "scarecrow173/apm-packages#packages/pstack-devin/devin-plugin" -y
```

Output (verbatim — the 60-line plugin/skills block is byte-identical to
§3; the two annotated trailing lines are the only additions):

```text
This install will add:
  • pstack v0.1.0
      /pstack:architect
      /pstack:arena
      /pstack:automate-me
      /pstack:benchmark-checklist
      /pstack:blast-radius
      /pstack:bro
      /pstack:correct
      /pstack:create-formal-verification-skill
      /pstack:create-verification-skill
      /pstack:figure-it-out
      /pstack:how
      /pstack:in-your-own-words
      /pstack:interrogate
      /pstack:ketchup
      /pstack:ketchup-video
      /pstack:maintain-formal-verification-skill
      /pstack:maintain-verification-skill
      /pstack:make-bot-ui
      /pstack:no-comments
      /pstack:poteto-help
      /pstack:poteto-mode
      /pstack:principle-attack-the-premise
      /pstack:principle-boundary-discipline
      /pstack:principle-build-the-lever
      /pstack:principle-encode-lessons-in-structure
      /pstack:principle-exhaust-the-design-space
      /pstack:principle-experience-first
      /pstack:principle-explain-the-number
      /pstack:principle-fix-root-causes
      /pstack:principle-foundational-thinking
      /pstack:principle-guard-the-context-window
      /pstack:principle-laziness-protocol
      /pstack:principle-make-operations-idempotent
      /pstack:principle-migrate-callers-then-delete-legacy-apis
      /pstack:principle-minimize-reader-load
      /pstack:principle-model-the-domain
      /pstack:principle-never-block-on-the-human
      /pstack:principle-outcome-oriented-execution
      /pstack:principle-prove-it-works
      /pstack:principle-redesign-from-first-principles
      /pstack:principle-separate-before-serializing-shared-state
      /pstack:principle-sequence-verifiable-units
      /pstack:principle-subtract-before-you-add
      /pstack:principle-test-behavior-not-implementation
      /pstack:principle-type-system-discipline
      /pstack:recall
      /pstack:reflect
      /pstack:setup-pstack
      /pstack:setup-pstack-devin
      /pstack:sharpen
      /pstack:show-me-your-work
      /pstack:statechart
      /pstack:swarm
      /pstack:tdd
      /pstack:teach
      /pstack:technical-writing
      /pstack:typescript-best-practices
      /pstack:unslop
      /pstack:why
      rule: AGENTS.md (always on)
This plugin will be added to your personal plugins, applying to your cloud sessions and other devices.
✓ Installed pstack.
▲ plugin is installed locally but not synced: EOF while parsing a value at line 1 column 0
```

- exit: `0`
- the `#subdir` form **works** against public `main` — no alternate
  syntax (`repo:subdir`, `owner/repo/subdir`) was needed
- `▲ plugin is installed locally but not synced: EOF while parsing a
  value at line 1 column 0` is a cloud-sync warning, not an install
  failure: the plugin installed and is fully usable on this machine;
  the personal-plugins sync to other devices/cloud sessions failed on
  this host (no reachable sync endpoint). Recorded verbatim because a
  synced install would print the same block without the `▲` line.

`devin plugins list` output was byte-identical to §3
(`• pstack v0.1.0`). `devin plugins info pstack` differed from §3 in
exactly one line — recorded verbatim via `diff info-local.txt
info-gh.txt`:

```text
3c3
<   source: G:\repositry\apm-packages\.worktrees\pstack-devin-217\packages\pstack-devin\devin-plugin
---
>   source: https://github.com/scarecrow173/apm-packages#packages/pstack-devin/devin-plugin
```

So the GitHub install resolves to the same `pstack v0.1.0` content —
same skills, agents, and always-on rule — provenance differs only in
`source:`.

Removal and post-state:

```bash
mise exec -- devin plugins remove pstack -y
# ✓ Removed pstack.                                    (exit 0)

mise exec -- devin plugins list
# No plugins installed.                                (exit 0)
```

Note the scope pairing: this install went to personal plugins, so
`remove --local` would have failed; plain `remove -y` removed it.

## 5. APM path — re-affirmed, not a Devin plugin install

The `apm install` consumer path was exercised for real in
`docs/l3-verification.md` ("Consumer probe — 2026-11-17 (path source)"):
a scratch consumer installed this package via a `path:` dependency and
APM deployed exactly three files:

```text
.agents/skills/setup-pstack-devin/SKILL.md
.agents/skills/setup-pstack-devin/scripts/roles.json
.agents/skills/setup-pstack-devin/scripts/setup.mjs
```

The repo root consumer shows the same shape in `apm.lock.yaml`
(`local_path` entry `pstack-devin` → `deployed_files` =
`.agents/skills/setup-pstack-devin{,/SKILL.md,/scripts/roles.json,/scripts/setup.mjs}`).

> **`apm install` ≠ `devin plugins install`.** `apm install` deploys
> only this package's `.apm/` primitives — today that is the single
> `setup-pstack-devin` skill. It cannot install or activate the Devin
> plugin: the `/pstack:*` skills, `pstack:*` agents, and the always-on
> `AGENTS.md` rule live only in `devin-plugin/`, and the only path that
> activates them is `devin plugins install` (§3/§4). Choose per goal:
>
> | Goal | Command |
> | --- | --- |
> | Full pstack on Devin CLI | `devin plugins install scarecrow173/apm-packages#packages/pstack-devin/devin-plugin` |
> | `setup-pstack-devin` skill via APM targets | `apm install` of `scarecrow173/apm-packages` subdir `packages/pstack-devin` (or the repo-root dev dependency) |

## 6. Name collision — upstream also ships `pstack`

Upstream `cursor/plugins` ships a plugin that is also named `pstack`
(upstream manifest `version: 0.15.42`, preserved verbatim at
`devin-plugin/plugin.json`; ours is `.devin-plugin/plugin.json`,
`version: 0.1.0`). Only one `pstack` can be installed at a time —
installing the second collides on name.

`devin plugins info pstack` provenance fields disambiguate which one is
installed:

| Field | This package | Upstream `cursor/plugins` |
| --- | --- | --- |
| `version:` | `0.1.0` | `0.15.42` |
| `source:` | `https://github.com/scarecrow173/apm-packages#packages/pstack-devin/devin-plugin` (or the local path used) | `https://github.com/cursor/plugins#…` |
| skills marker | `/pstack:setup-pstack-devin` present | no `setup-pstack-devin` skill |

If several installed plugins share the name, `devin plugins remove`
accepts "a disambiguated `owner/repo` label" (per `remove --help`).
If the wrong `pstack` is installed, remove it and install with the full
`scarecrow173/apm-packages#packages/pstack-devin/devin-plugin` source —
never a bare `pstack` name, which is not a valid `<SOURCE>` anyway.

## 7. Release + marketplace procedure

Plugin release (version bump and publish):

1. Bump `version:` in `packages/pstack-devin/apm.yml` **and**
   `"version"` in `packages/pstack-devin/overlay/.devin-plugin/plugin.json`
   together — `build` hard-fails on drift between them
   (`scripts/pstack-devin/src/build.ts`: `.devin-plugin/plugin.json
   version drift`). The upstream `plugin.json` `version` (`0.15.42`) is
   upstream's own and is **not** the release version.
2. `mise exec -- pnpm --dir scripts/pstack-devin run build`
3. `mise exec -- pnpm --dir scripts/pstack-devin run check-generated`
   (committed `devin-plugin/` must equal a fresh rebuild)
4. Commit and push to `main` — `devin plugins install owner/repo#subdir`
   resolves against the pushed `HEAD`; consumers pick up the new release
   via `devin plugins update pstack`.

APM-side changes (`.apm/` primitives): run `mise exec -- apm install`
at the repository root to regenerate `apm.lock.yaml`'s deployed-files
attestation, and inside `packages/pstack-devin/` to regenerate the
package lockfile. Never hand-edit either lockfile.

Marketplace registration: root `apm.yml` carries the entry
(`marketplace.packages`):

```yaml
  - name: pstack-devin
    category: workflow
    source: scarecrow173/apm-packages
    subdir: packages/pstack-devin
```

`scripts/pstack-devin` `check:marketplace` (wired into `verify:l3`)
pins the registration invariants — missing dep entry, missing
marketplace entry, or stale lockfile path all fail loudly.

## 8. `.gitignore` audit

Verified with `git check-ignore -v` on 2026-11-17:

| Path | Result | Rule |
| --- | --- | --- |
| `packages/pstack-devin/devin-plugin/` | **not ignored** (exit 1) — tracked; `git ls-files` reports 553 files | — |
| `packages/pstack-devin/build/` | ignored | `packages/pstack-devin/.gitignore:6` `/build/` (also root `.gitignore` `packages/**/build/`) |
| `packages/pstack-devin/apm_modules/` | ignored | `packages/pstack-devin/.gitignore:10` `apm_modules/` (also root `.gitignore` `**/apm_modules/`) |

Audit caveat: directory-only patterns (trailing `/`) only match paths
git can identify as directories — pass the existing directory or a path
inside it (e.g. `build/x.txt`) to `git check-ignore`; a bare
non-existent `build` reports "not ignored" even though the pattern would
exclude it once created.
