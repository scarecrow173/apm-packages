---
name: adr-doc
description: Use when proposing, writing, consulting, auditing, indexing, migration-planning, accepting, rejecting, deprecating, superseding, or enforcing Architecture Decision Records for coding agents using MADR 4.0.0. Use `deep-dive` first when the decision still needs deeper interrogation.
license: MIT
---

# ADR Documentation Skill

Use this skill for Architecture Decision Records written as executable
specifications for coding agents. A human approves the decision; an agent
implements it. The ADR must contain everything the agent needs to write correct
code without asking follow-up questions.

This skill may ask narrow ADR-specific gap-fill questions. Broad intent
discovery and Socratic interrogation belong in `deep-dive`.

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

In this package's lifecycle, all decisions are recorded as ADRs. ADR and spec
are created in parallel from the same discovery output when both product
requirements and technical decisions are clear.

- During **brainstorming**: cross-cutting conventions, platform choices.
- During **spec writing** (parallel): a requirement reveals a technology
  decision, write the ADR alongside the spec.
- During **planning**: implementation approach requires a recorded choice.
- During **implementation**: an agent encounters an architectural fork.

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

## Emergency Fix Scenario

Even during emergencies (production incidents, imminent SLA breach), record a
minimal ADR if the change involves a technical decision.

Conditions for the emergency path:
- Time pressure can be objectively justified.
- State the reason for urgency in the ADR body (one line).

Emergency path procedure:
1. Create a brief ADR with title, decision, rationale, and impact.
   Set `status: "draft"`.
2. After incident resolution, complete Phases 0-3 and update `status` to
   `proposed` or above. Target completion within one week of resolution.

The emergency path is strictly an exception; it does not apply to routine work.

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

Except when the Emergency Fix Scenario (above) applies, every ADR goes through
four phases. Do not skip phases.

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

### Phase 1: Capture Intent

Phase 1 has two modes. Choose based on whether upstream context exists.

#### Mode Selection

```text
IF a discovery artifact (docs/discovery/) OR spec (docs/specs/) already
   captures this decision's context:
  -> Mode A: Extract from upstream
ELSE (triggered mid-implementation, cross-cutting decision, or the decision is
   still too fuzzy to draft safely):
  -> Mode B: Request deep-dive or missing inputs
```

#### Mode A: Extract from Upstream

Use this mode when a brainstorming discovery artifact or spec already exists for
the decision being recorded.

1. **Read the upstream artifact fully.**
   Identify the decision-relevant portions: intent, constraints, options,
   recommendation, non-goals, and open questions.

2. **Map upstream content to ADR structure:**
   - Title <- upstream recommendation + decision description
   - Trigger <- upstream intent / "why now" / problem signals
   - Constraints <- upstream constraints section
   - Options <- upstream options section (with trade-offs)
   - Lean <- upstream recommendation
   - Non-goals <- upstream scope exclusions or "Not Doing" list

3. **Ask only for gaps**: information the upstream did not capture.
   Typical gap-fill questions:

   - Who needs to know or approve this decision?
     (Governance context for MADR/RACI front matter.)
   - What would an agent need to implement this?
     (Affected files, directories, interfaces, dependencies, configuration,
     tests, patterns to follow, patterns to avoid, and verification criteria.)
   - Are there constraints or trade-offs that surfaced after the brainstorming
     was written?
   - What verification would prove the decision was implemented correctly?

   Ask gap-fill questions one at a time. Skip any that are already answered in
   the upstream or Phase 0.

4. **Proceed to Intent Summary Gate** (below).

#### Mode B: Request Deep-Dive or Missing Inputs

Use this mode when no upstream brainstorming or spec exists, or when Phase 0
still leaves the decision too underdefined to draft safely.

Do not run a broad Socratic interview inside `adr-doc`. Instead, request the
missing decision material, or hand off to `deep-dive` when the decision itself
needs to be clarified through codebase-aware dialogue.

Return a concise request like this:

```markdown
ADR Missing Inputs

- Missing: <item>
  Why needed: <reason>
  Request from: <user | another agent | repository evidence>

Recommendation:
- Run `deep-dive`
- Ask the user directly
- Gather repository evidence from <path or area>
```

Once the missing inputs or `deep-dive` summary come back, resume `adr-doc` and
continue through the normal workflow.

#### Adaptive Follow-ups (Mode A or after deep-dive)

Based on answers, probe deeper where the ADR content is still fuzzy.
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
you are still guessing at a section, request that missing input instead of
inventing it.

#### Intent Summary Gate

Before moving to Phase 2, present a structured summary of what you captured and
ask the human to confirm or correct it:

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
   Use the shared meaning-based `relations` fields described in
   `references/adr-conventions.md`.
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

## Post-Acceptance Lifecycle

After an ADR is accepted:

1. Turn Implementation Plan items and follow-up consequences into trackable
   tasks.
2. Reference the ADR in PRs, for example `Implements ADR-0004`.
3. Add sparse code references at the main implementation entry points.
4. Check Verification items after implementation.
5. Revisit the ADR when its stated revisit conditions fire.

For index maintenance, bootstrap patterns, and category layout, see
`references/adr-maintenance.md`.

## Operational References

Keep this entry skill focused on deciding whether an ADR is needed and creating
or reviewing it through Phases 0-3. For extended operational guidance, use:

- `references/adr-maintenance.md` for consulting existing ADRs, updating
  accepted ADRs, index maintenance, bootstrap patterns, category layout, and
  script examples.
- `references/template-variants.md` for template selection details.
- `references/review-checklist.md` for agent-readiness review criteria and
  review-summary expectations.

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
