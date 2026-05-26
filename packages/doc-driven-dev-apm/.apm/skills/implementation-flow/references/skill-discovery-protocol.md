# Skill Discovery Protocol

Execute this protocol when `implementation-profile.md` does not exist or is
detected as stale. The output is a generated `implementation-profile.md` at
the repository root.

## Step 1: Scan All Skill Sources

Scan the following locations in order. For each, collect skill name,
description (from front matter or first heading), and source path.

| Priority | Source | What to Look For |
| -------- | ------ | ---------------- |
| 1 | `.apm/skills/` | Directories containing `SKILL.md` |
| 2 | `.agents/skills/` | Directories containing `SKILL.md` |
| 3 | `.github/skills/` | Skill markdown files (GitHub Copilot) |
| 3 | `.github/agents/` | Agent persona files `*.agent.md` |
| 3 | `.cursor/rules/` | Rule markdown files (Cursor) |
| 3 | `.claude/commands/` | Command files (Claude Code) |
| 3 | `.gemini/skills/` | Skill files (Gemini CLI) |
| 3 | `.gemini/commands/` | Command TOML files (Gemini CLI) |
| 3 | `.opencode/skills/` | Skill files (OpenCode) |
| 4 | System skills | Skills listed in agent context/instructions |
| 5 | `apm_modules/` | Installed packages with skills |
| 6 | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` | Skills referenced in root instruction files |
| 6 | `.cursorrules`, `.windsurfrules` | Inline skill content |
| 6 | `.github/copilot-instructions.md` | Referenced skills |

## Step 2: Classify Discovered Skills

Assign each skill to exactly one category based on its description and purpose:

| Category | Assignment Rule |
| -------- | -------------- |
| Process | Skill determines *how to approach* (debugging, planning, task breakdown) |
| Build | Skill structures *how to execute* (TDD, incremental, frontend, API design) |
| Verify | Skill validates *correctness* (doc verification, adversarial review, security) |
| Review | Skill provides *post-implementation gates* (code review, performance audit) |
| Domain | Skill is *language/framework/platform-specific* (TypeScript, React, Python) |
| Tooling | Skill governs *tool usage* (git, CI/CD, browser devtools) |
| Meta | Skill *orchestrates other skills* (this skill, doc-driven-dev-flow) |

## Step 3: Determine Activation Mode

For each skill, assign an activation mode:

| Mode | Meaning | Criteria |
| ---- | ------- | -------- |
| always-on | Applied to every task | Core methodology skills (e.g., TDD, incremental) |
| conditional | Applied when task matches condition | Triggered by task characteristics |
| excluded | Not used in this repository | Irrelevant to repo's technology/domain |

## Step 4: Classify Execution Mode (Rigid vs Flexible)

For each skill, determine how strictly its process must be followed:

| Mode | Definition | How to Apply | Examples |
| ---- | ---------- | ------------ | -------- |
| Rigid | Specifies a strict step-by-step process | Follow exactly; do not skip or reorder steps | TDD (RED-GREEN-REFACTOR), systematic-debugging (5-step diagnosis) |
| Flexible | Specifies principles over procedures | Apply the spirit; adapt to context | source-driven-development (verify against docs), code-review (multi-axis evaluation) |

**Classification criteria:**

- **Rigid** if the skill defines numbered steps, explicit phases, or a mandatory sequence.
- **Flexible** if the skill defines goals, principles, or checklists without strict ordering.

Record the execution mode in the profile so agents know whether to follow the skill literally or adapt it.

## Step 5: Define Default Stack

Select the `always-on` skills that form the base for every task. Order by:

1. **Process** skills first (they determine approach)
2. **Build** skills second (they structure execution)
3. **Verify** skills third (they validate)
4. **Review** skills last (they close the loop)

Domain and Tooling skills are always `conditional` — activated by task characteristics.

## Step 6: Generate `implementation-profile.md`

Write the profile to the repository root using the template from
`assets/templates/implementation-profile-template.md` and validated against
`references/implementation-profile-schema.md`. Present the generated profile
to the user for review before proceeding.

## Step 7: Staleness Check (when profile exists)

If `implementation-profile.md` already exists, validate:

1. All listed skill sources still exist.
2. No new skill directories have appeared that are unlisted.
3. `last_validated` date is within 30 days.
