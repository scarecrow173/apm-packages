---
name: adr-doc
description: Use when proposing, writing, consulting, auditing, indexing, migration-planning, accepting, rejecting, deprecating, superseding, or enforcing Architecture Decision Records for coding agents using MADR 4.0.0.
license: MIT
---

# ADR Documentation Skill

Use this skill for Architecture Decision Records written as executable
specifications for coding agents. A human approves the decision; an agent
implements it. The ADR must contain everything the agent needs to write correct
code without asking follow-up questions.

## Philosophy

ADRs created with this skill are executable specifications for coding agents.

This means:

- Constraints must be explicit and measurable, not vibes.
- Decisions must be specific enough to act on, such as "use PostgreSQL 16 with
  pgvector" instead of "use a database".
- Consequences must map to concrete follow-up tasks.
- Non-goals must be stated to prevent scope creep.
- The ADR must be self-contained, with no tribal knowledge assumptions.
- The ADR must include an Implementation Plan: which files to touch, which
  patterns to follow, which patterns to avoid, which tests to write, and how to
  verify that the decision was implemented correctly.
- Decision history must be preserved. Do not rewrite old rationale just to fit a
  newer template.

## When to Write an ADR

Write or propose an ADR when a decision:

- Changes how the system is built, integrated, deployed, operated, or extended.
- Introduces a dependency, architecture pattern, infrastructure choice, API
  convention, data model, or cross-cutting rule.
- Is hard to reverse once code is written against it.
- Affects future humans or agents working in the codebase.
- Has real alternatives that were considered and rejected.
- Contradicts, supersedes, or refines an existing accepted ADR.

Do not create a new ADR for:

- Routine implementation choices within an established pattern.
- Small bug fixes or typo corrections.
- Decisions already captured in an existing ADR. Update, supersede, or append to
  that ADR instead.
- Style preferences already covered by linters or formatters.

When in doubt: if a future coding agent working in this codebase would benefit
from knowing why this choice was made before safely changing code, write the ADR.

## Proactive ADR Triggers

If you are an agent coding in a repo and you encounter any of these situations,
stop and propose an ADR before continuing:

- You are about to introduce a dependency that does not already exist in the
  project.
- You are about to create a new architectural pattern, such as a new way of
  handling errors, a new data access layer, or a new API convention that other
  code will need to follow.
- You are about to make a choice between two or more real alternatives and the
  trade-offs are non-obvious.
- You are about to change something that contradicts an existing accepted ADR.
- You realize you are writing a long code comment explaining architectural
  "why"; that reasoning belongs in an ADR.

How to propose: tell the human what decision you have hit, why it matters, and
ask if they want to capture it as an ADR.

If yes, run the full four-phase workflow. If no, note the decision in a
lightweight code comment or PR note when useful and move on.

## Creating an ADR: Four-Phase Workflow

Every ADR goes through four phases. Do not skip phases.

### Phase 0: Scan the Codebase

Before asking any questions, gather context from the repo:

1. Find existing ADRs.
   Use the directory rules in `references/adr-conventions.md`. Read existing
   records. Note:
   - Existing conventions: directory, naming, template style, index style.
   - Decisions that relate to or constrain the current one.
   - Any ADRs this new decision might supersede, refine, or relate to.
2. Check the tech stack.
   Read `package.json`, `pnpm-lock.yaml`, `go.mod`, `requirements.txt`,
   `pyproject.toml`, `Cargo.toml`, or equivalent files. Note relevant
   dependencies and versions.
3. Find related code patterns.
   If the decision involves a specific area, such as authentication, storage,
   job processing, API shape, or deployment, scan for existing implementations.
   Identify the specific files, directories, interfaces, tests, and patterns
   that will be affected by the decision.
4. Check for ADR references in code and docs.
   Look for `ADR-NNNN`, ADR filenames, and links to ADR directories in comments,
   documentation, PR notes, and issue templates. This reveals which existing
   decisions govern which parts of the codebase.
5. Note what you found.
   Carry this context into Phase 1. It should sharpen your questions and
   prevent the new ADR from contradicting existing decisions.

Do not draft an ADR from abstract requirements when concrete repository evidence
is available.

### Phase 1: Capture Intent (Socratic)

Interview the human to understand the decision space. Ask questions one at a
time, building on previous answers. Do not dump a list of questions.

Core questions, in roughly this order. Skip what is already clear from context
or Phase 0:

1. What are you deciding?
   Get a short, specific title. Push for a verb phrase, such as "Choose X",
   "Adopt Y", or "Replace Z with W".
2. Why now?
   What broke, what is changing, or what will break if nothing changes? This is
   the trigger.
3. What constraints exist?
   Tech stack, timeline, budget, team size, existing code, operations,
   compliance, portability, and maintainability all count. Be concrete.
   Reference what you found in Phase 0, such as "I see the repo already uses X;
   does that constrain this decision?"
4. What does success look like?
   Capture measurable outcomes. Push past "it works" to specifics such as
   latency, throughput, developer experience, maintenance burden, operational
   safety, or migration completion.
5. What options have you considered?
   Capture at least two realistic options when possible. For each option, record
   the core trade-off. If there is only one plausible option, help articulate
   why alternatives were rejected.
6. What is your current lean?
   Capture the preferred option and why. This often reveals unstated priorities.
7. Who needs to know or approve?
   Capture decision-makers, consulted experts, and informed stakeholders for
   the MADR/RACI front matter.
8. What would an agent need to implement this?
   Which files, directories, interfaces, dependencies, configuration, tests, and
   patterns are affected? What existing patterns should the agent follow? What
   should it avoid? What verification would prove the implementation follows
   the decision?

Adaptive follow-ups: based on answers, probe deeper where the decision is fuzzy.
Common follow-ups:

- What is the worst-case outcome if this decision is wrong?
- What would make you revisit this in six months?
- Is there anything you are explicitly choosing not to do?
- What prior art, existing patterns, or accepted ADRs does this relate to?
- I found an existing ADR or code pattern; does this new decision interact with
  it?
- Which test command, manual review, or observable behavior would prove this was
  implemented correctly?

When to stop: you have enough when you can fill every section of the ADR,
including the Implementation Plan and Verification, without making things up. If
you are guessing at any section, ask another question.

Intent Summary Gate: before moving to Phase 2, present a structured summary of
what you captured and ask the human to confirm or correct it:

```markdown
Here's what I'm capturing for the ADR:

- Title: {title}
- Trigger: {why now}
- Constraints: {list}
- Options: {option 1} vs {option 2} [vs ...]
- Lean: {which option and why}
- Non-goals: {what is explicitly out of scope}
- Related ADRs/code: {what exists that this interacts with}
- Affected files/areas: {where in the codebase this lands}
- Verification: {how we will know it is implemented correctly}

Does this capture your intent? Anything to add or correct?
```

Do not proceed to Phase 2 until the human confirms the summary.

### Phase 2: Draft the ADR

1. Choose the ADR directory.
   Use `references/adr-conventions.md`. If one exists, use it. If none exists,
   create `docs/adr/` by default for this package.
2. Choose a filename strategy.
   If existing ADRs use numeric prefixes, continue that. Otherwise use slug-only
   filenames if that is the established repository convention.
3. Choose a template.
   Use `references/template-variants.md`.
   - Use `full` by default.
   - Use `minimal` only for simple, low-risk, local decisions with little
     meaningful trade-off.
   - Use `bare` or `bare-minimal` only when existing repository conventions
     already provide prose guidance.
4. Fill every section from the confirmed intent summary.
   Do not leave placeholder text. Every required section should contain real
   content. Optional sections should either contain useful content or be removed
   only when the template permits it.
5. Write the Implementation Plan.
   This is the most important section for agent-first ADRs. It tells the next
   agent exactly what to do. Include affected paths, dependencies,
   configuration, patterns to follow, patterns to avoid, migration steps,
   compatibility concerns, and expected tests when relevant.
6. Write Verification criteria as checkboxes.
   These must be specific enough that an agent can programmatically or manually
   check each item.
7. Connect related ADRs with front matter.
   Use `relations.supersedes`, `relations.superseded-by`, `relations.related`,
   and `relations.refines` as described in `references/adr-conventions.md`.
8. Generate the file.
   Preferred: run `scripts/new_adr.js`. It handles directory detection, naming,
   templates, metadata defaults, and index updates. If you cannot run scripts,
   copy a template from `assets/templates/` and fill it manually.

Preferred script examples:

```bash
node scripts/new_adr.js --title "Adopt ADRs"
node scripts/new_adr.js --title "Use PostgreSQL" --template full --dir docs/decisions
node scripts/new_adr.js --title "Use local cache" --template minimal
```

### Phase 3: Review Against Checklist

After drafting, review the ADR against the agent-readiness checklist in
`references/review-checklist.md`.

Present the review as a summary, not a raw checklist dump:

```markdown
ADR Review

Passes:
- {what is solid, such as context is self-contained, implementation plan names
  affected files, verification criteria are checkable}

Gaps found:
- {specific gap, such as Implementation Plan does not mention test files}
- {specific gap}

Recommendation:
{Finalize it / Fix the gaps first / Return to Phase 1 for fuzzy areas}
```

Only surface failures and notable strengths. Do not recite every passing
checkbox.

If there are gaps, propose specific fixes. Do not just flag problems; offer
solutions and ask the human to approve. Do not finalize until the ADR passes the
checklist or the human explicitly accepts the gaps.

Useful review commands:

```bash
node scripts/review_adr.js --dir docs/adr
node scripts/audit_adr.js --dir docs/adr
node scripts/check_code_links.js --dir docs/adr
```

## Consulting ADRs (Read Workflow)

Agents should read existing ADRs before implementing changes in a codebase that
has them. This is not part of the create-an-ADR workflow; it is a standalone
operation any agent should do.

### When to Consult ADRs

- Before starting work on a feature that touches architecture, data flow, API
  design, infrastructure, dependencies, or cross-cutting conventions.
- When you encounter a pattern in the code and wonder why it is done that way.
- Before proposing a change that might contradict an existing decision.
- When a human says "check the ADRs" or "there is a decision about this".
- When you find an ADR reference in a code comment, PR, issue, or document.

### How to Consult ADRs

1. Find the ADR directory and index.
   Use `scripts/list_adrs.js` or the directory rules in
   `references/adr-conventions.md`.
2. Scan titles, statuses, and relations.
   Focus on `accepted` ADRs because these are active decisions. Also note
   `superseded`, `deprecated`, `related`, and `refines` relationships.
3. Read relevant ADRs fully.
   Do not just read the title. Read context, decision, consequences, non-goals,
   relations, Implementation Plan, and Verification.
4. Respect accepted decisions.
   If an accepted ADR says to use PostgreSQL, do not propose switching to
   MongoDB without creating a new ADR that supersedes it.
5. Follow the Implementation Plan.
   When implementing code in an area governed by an ADR, follow the patterns
   specified in the Implementation Plan.
6. Report conflicts.
   If code and ADRs disagree, flag the conflict to the human instead of silently
   choosing one.
7. Reference ADRs in your work.
   Add lightweight ADR references in code comments and PR descriptions where
   they improve discoverability.

Helpful commands:

```bash
node scripts/list_adrs.js --dir docs/adr
node scripts/audit_adr.js --dir docs/adr
node scripts/review_adr.js --dir docs/adr
node scripts/check_code_links.js --dir docs/adr
```

## Code and ADR Linking

ADRs should be bidirectionally linked to the code they govern.

### ADR to Code

The Implementation Plan section names specific files, directories, and patterns:

```markdown
## Implementation Plan

- Affected paths: `src/db/`, `src/config/database.ts`, `tests/integration/`
- Pattern to follow: all database queries go through `src/db/client.ts`
- Pattern to avoid: direct database clients in route handlers
```

### Code to ADR

When implementing code guided by an ADR, add a lightweight comment referencing
the ADR at the main entry point for that decision:

```typescript
// ADR-0004: Use SQLite for test database.
// See: docs/adr/0004-use-sqlite-for-test-database.md
import Database from "better-sqlite3";
```

Keep these references sparse. Add one at the entry point, not on every line. The
goal is discoverability for future agents.

### Why This Matters

- An agent working in a governed area can find which ADRs apply.
- An agent reading an ADR can find the code that implements it.
- When an ADR is superseded, code references make it easier to find what needs
  updating.

## Other Operations

### Update an Existing ADR

1. Identify the intent:
   - Accept or reject: change status and add final context when needed.
   - Deprecate: set status to `deprecated` and explain the replacement path.
   - Supersede: create a new ADR and link both ways with `relations`.
   - Refine: create or update a related ADR and use `relations.refines`.
   - Add learnings: append to `## More Information` with a date stamp. Do not
     rewrite history.
2. Prefer narrow edits.
   Status changes, relation updates, and dated notes are acceptable in-place
   edits. Do not rewrite old rationale to sound more current.
3. Validate after editing:

```bash
node scripts/audit_adr.js --dir docs/adr
node scripts/review_adr.js --dir docs/adr
node scripts/update_index.js --dir docs/adr --write
```

Use `scripts/relate_adr.js` for relation updates:

```bash
node scripts/relate_adr.js --from 0002-new.md --to 0001-old.md --relation supersedes --write
```

### Post-Acceptance Lifecycle

After an ADR is accepted:

1. Create implementation tasks.
   Each item in the Implementation Plan and each follow-up in Consequences
   should become a trackable task, issue, ticket, or TODO.
2. Reference the ADR in PRs.
   Link to the ADR in PR descriptions, such as "Implements ADR-0004".
3. Add code references.
   Add sparse ADR comments at key implementation points.
4. Check verification criteria.
   Once implementation is complete, walk through the Verification checkboxes.
   Update `## More Information` with results when useful.
5. Revisit when triggers fire.
   If the ADR specified revisit conditions, monitor for those conditions.

### Index

If the repo has an ADR index file, often `README.md` or `index.md`, keep it
updated. Preferred:

```bash
node scripts/update_index.js --dir docs/adr --write
```

Otherwise, add a bullet entry for the new ADR manually and keep ordering
consistent with the repository convention.

### Bootstrap

When introducing ADRs to a repo that has none, create the first ADR explaining
why the project will use ADRs:

```bash
node scripts/new_adr.js --title "Adopt architecture decision records" --dir docs/adr
```

Then edit the generated ADR so it contains real context for the repository, not
generic boilerplate. Use `scripts/update_index.js --write` if the index needs to
be refreshed after manual edits.

### Categories

For repos with many ADRs, organize by subdirectory:

```text
docs/adr/
  backend/
    0001-use-postgresql.md
  frontend/
    0001-use-react.md
  infrastructure/
    0001-use-terraform.md
```

Numbers are local to each category. Choose a categorization scheme early and
document it in the index. Use categories by architectural layer, domain, or team
only when a flat directory is becoming hard to scan.

## Maintenance Rules

- Treat `references/adr-conventions.md` as the authoritative ADR convention.
- Use `references/adr-maintenance.md` for tool-specific safety behavior and
  review focus.
- Treat MADR 4.0.0 as the ADR-specific baseline for this skill.
- Do not apply MADR rules to future non-ADR document skills.
- Prefer explicit user confirmation before using `--write` in a repository with
  existing ADRs.
- Preserve history. Append context instead of replacing old rationale.

## Resources

### scripts

- `scripts/new_adr.js`: create a new ADR from a MADR template, using repository
  conventions.
- `scripts/list_adrs.js`: list ADR metadata, statuses, and relations.
- `scripts/audit_adr.js`: validate front matter, required sections,
  placeholders, local links, relation links, and index coverage.
- `scripts/review_adr.js`: review agent-readiness.
- `scripts/check_code_links.js`: check Implementation Plan code references.
- `scripts/update_index.js`: update ADR index files; dry-run by default.
- `scripts/relate_adr.js`: add bidirectional ADR relations.
- `scripts/migrate_report.js`: report migration actions toward MADR 4.0.0
  without changing files.

### references

- `references/adr-conventions.md`: directory, filename, status, relations,
  mutability, index, and category conventions.
- `references/template-variants.md`: when to choose `full`, `minimal`, `bare`,
  or `bare-minimal`.
- `references/review-checklist.md`: agent-readiness checklist for Phase 3.
- `references/adr-maintenance.md`: safe defaults and audit focus.
- `references/madr-4.md`: MADR 4.0.0 source handling, license, and template
  notes.

### assets

- `assets/templates/madr-4-full.md`: default full MADR template with
  agent-first sections.
- `assets/templates/madr-4-minimal.md`: minimal MADR template for simple,
  low-risk decisions.
- `assets/templates/madr-4-bare.md`: full section structure without guidance
  prose.
- `assets/templates/madr-4-bare-minimal.md`: minimal section structure without
  guidance prose.

## Script Usage

From the target repo root:

```bash
# Full ADR, default template
node /path/to/adr-doc/scripts/new_adr.js --title "Choose database" --status proposed

# Minimal ADR for a simple local decision
node /path/to/adr-doc/scripts/new_adr.js --title "Use local cache" --template minimal

# Explicit directory
node /path/to/adr-doc/scripts/new_adr.js --title "Choose database" --template full --dir docs/decisions

# List and audit
node /path/to/adr-doc/scripts/list_adrs.js --dir docs/adr
node /path/to/adr-doc/scripts/audit_adr.js --dir docs/adr

# Review agent-readiness and code references
node /path/to/adr-doc/scripts/review_adr.js --dir docs/adr
node /path/to/adr-doc/scripts/check_code_links.js --dir docs/adr

# Update index
node /path/to/adr-doc/scripts/update_index.js --dir docs/adr --write

# Relate ADRs
node /path/to/adr-doc/scripts/relate_adr.js --from 0002-new.md --to 0001-old.md --relation supersedes --write

# Migration report only
node /path/to/adr-doc/scripts/migrate_report.js --dir docs/adr
```

Notes:

- Scripts auto-detect ADR directory and filename strategy.
- Use `--dir` to override directory detection.
- Use `--json` on reporting scripts when machine-readable output is needed.
- Reporting scripts do not write files by default.
