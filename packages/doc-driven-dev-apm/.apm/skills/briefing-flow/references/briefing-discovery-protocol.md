# Briefing Skill Discovery Protocol

Execute this protocol when `briefing-profile.md` does not exist or is
detected as stale. The output is a generated `briefing-profile.md` at
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

**Note:** Scan sources are identical to the `implementation-flow` Skill Discovery
Protocol. The difference lies in the classification categories.

## Step 2: Classify Discovered Skills

Assign each skill to a Briefing category based on its description and purpose.
Each skill belongs to exactly one category.

| Category | Assignment Rule | Examples |
| -------- | -------------- | -------- |
| Frame | Skill *structures problems or options* (problem definition, divergent thinking, option organization) | `idea-refine`, `brainstorming`, `interview-me` |
| Discover | Skill *explores and finds information* (external search, information gathering) | `steer-web-research`, web research tools |
| Research | Skill *conducts deep-dive investigation* (primary source reference, doc verification) | `source-driven-development` |
| Validate | Skill *verifies accuracy and completeness of information* (adversarial analysis, assumption checking) | `doubt-driven-development` |
| Document | Skill *produces formal documents* (specifications, ADRs) | `spec-doc`, `adr-doc` |
| Meta | Skill *orchestrates other skills* (this skill itself) | `briefing-flow`, `doc-driven-dev-flow` |

**Classification criteria:**

- Skill description mentions "explore", "search", "find", "gather" → Discover
- Skill description mentions "structure", "organize", "define", "refine" → Frame
- Skill description mentions "verify", "validate", "adversarial" → Validate
- Skill description mentions "spec", "ADR", "document", "record" → Document
- Skill description mentions "investigate", "reference", "evidence" → Research
- None of the above → likely `excluded` for briefing

**Note:** Skills that belong to Implementation categories (Process, Build, Domain,
Tooling, Review) are normally `excluded` during briefing. However, if they have
secondary applicability to Frame or Validate, they may be `conditional`.

## Step 3: Determine Activation Mode

For each skill, assign an activation mode:

| Mode | Meaning | Criteria |
| ---- | ------- | -------- |
| always-on | Applied to every briefing | Document-category skills (spec-doc, adr-doc) are always needed |
| conditional | Applied when information state matches condition | Triggered by Entry Decision or task characteristics |
| excluded | Not used for briefing in this repository | Implementation-phase-only skills, irrelevant domains |

**Briefing-specific activation rules:**

| Condition | Skills Activated |
| --------- | ---------------- |
| Entry Decision = A-1 (Problem Framing) | All Frame-category always-on + conditional |
| Entry Decision = A-2 (Option Framing) | Frame-category (especially comparison/evaluation) |
| Entry Decision = A-3 (Combined Discovery) | Evaluate all conditional across categories |
| Entry Decision = A-5 (Research Required) | Discover + Research categories |
| External APIs/libraries are involved | Discover + Research categories |
| Multiple implementation approaches exist | Frame + Validate categories |
| Unprecedented architectural decisions | Research + Validate categories |

## Step 4: Classify Execution Mode (Rigid vs Flexible)

For each skill, determine how strictly its process must be followed:

| Mode | Definition | How to Apply | Examples |
| ---- | ---------- | ------------ | -------- |
| Rigid | Specifies a strict step-by-step process | Follow exactly; do not skip or reorder steps | `spec-doc` (template required), `adr-doc` (MADR format required) |
| Flexible | Specifies principles over procedures | Apply the spirit; adapt to context | `idea-refine` (diverge→converge principle), `brainstorming` (interactive exploration) |

**Classification criteria:**

- **Rigid** if the skill defines numbered steps, explicit phases, or a mandatory template.
- **Flexible** if the skill defines goals, principles, or checklists without strict ordering.

## Step 5: Define Default Stack

Select the `always-on` skills that form the base for every briefing. Order by:

1. **Frame** skills first (they structure the problem)
2. **Document** skills last (they produce the output)

Discover, Research, and Validate are always `conditional` — activated by Entry Decision and information state.

**Minimum default stack example:**

```text
1. [Document] spec-doc — always-on (every briefing produces a specification)
2. [Document] adr-doc — always-on (every briefing produces an ADR)
```

Frame-category skills are activated when Entry Decision is anything other than A-4 (Direct Start).

## Step 6: Generate `briefing-profile.md`

Write the profile to the repository root using the template from
`assets/templates/briefing-profile-template.md` and validated against
`references/briefing-profile-schema.md`. Present the generated profile
to the user for review before proceeding.

## Step 7: Staleness Check (when profile exists)

If `briefing-profile.md` already exists, validate:

1. All listed skill sources still exist.
2. No new skill directories have appeared that are unlisted.
3. `last_validated` date is within 30 days.

If any check fails, re-run from Step 1.
