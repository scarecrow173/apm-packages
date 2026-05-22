---
name: steer-web-research
description: Use this skill for web research, deep research, current-information investigation, source comparison, tool/paper discovery, technology landscape research, evidence-backed reports, or any task that asks for iterative search, audit, reflection, or re-search. It implements a SteER/Enterprise-Deep-Research style loop: task decomposition, diversity-aware search planning, adaptive pause decisions, evidence ledger, reflection, and sufficiency-based termination.
license: MIT
---

# SteER Web Research Skill

## Purpose

Perform evidence-backed research through an iterative loop instead of one-shot search. Use this when the user asks for current information, public web investigation, academic/tool discovery, comparison of approaches, market/technology landscape research, or a report that must include citations and source quality assessment.

This skill is instruction-only by default. It assumes the host agent may have one or more of these capabilities:

- Web search
- Page fetch/read
- Academic search
- GitHub/repository search
- File/document search
- MCP tools
- Shell/scripts

If no search or retrieval tool is available, do not invent findings. Explain that the environment lacks retrieval access and produce a research plan only.

## Core Model

Maintain these working artifacts under `research/` unless the user specifies another directory:

- `research/todo.md`: task plan and state
- `research/persona.md`: inferred user goals, constraints, preferences, and open uncertainties
- `research/query-log.md`: all search queries and why they were run
- `research/evidence-ledger.md`: source-by-source extracted evidence
- `research/running-summary.md`: compressed synthesis after each loop
- `research/audit.md`: coverage, contradiction, freshness, and citation audit
- `research/final-report.md`: final answer/report

For small chat-only tasks, you may keep this state mentally, but still follow the same sections in the answer.

## Algorithm

### 0. Scope and Persona Initialization

Extract:

- User objective
- Required output format
- Time sensitivity
- Geography or jurisdiction
- Domain constraints
- Source preferences
- Exclusions
- Risk level
- Decision the user is trying to make

Create a lightweight persona model:

```markdown
# Persona / Intent Model

- User objective:
- Audience:
- Must-cover aspects:
- Nice-to-have aspects:
- Recency requirement:
- Source quality bar:
- Known constraints:
- Unknowns:
- Steering preference:
  - Ask early for high-level forks.
  - Do not interrupt for low-risk detail.
```

Ask a clarification only when at least one is true:

- Multiple interpretations would materially change search direction.
- The user's required decision cannot be inferred.
- Jurisdiction, date, product/version, or target audience is essential.
- Continuing would likely waste substantial search effort.

Otherwise proceed and state assumptions.

### 1. Todo-driven Decomposition

Create 3-7 initial tasks. Each task must have:

- ID
- Status: `pending`, `in-progress`, `completed`, or `canceled`
- Priority: 5-10
- Domain: `official`, `general_web`, `academic`, `github`, `docs`, `enterprise`, or `other`
- Evidence target
- Dependencies
- Provenance: `initial_query`, `knowledge_gap`, or `steering`

Use this template:

```markdown
| ID | Status | Priority | Domain | Task | Evidence target | Dependency | Provenance |
|---|---|---:|---|---|---|---|---|
| T1 | pending | 9 | official | ... | ... | - | initial_query |
```

### 2. Diversity-aware Search Planning

For each iteration, generate candidate search directions. Include:

- Direct keyword query
- Official-source query
- Alternative terminology query
- Critical/negative query
- Recent-update query when time-sensitive
- Implementation/GitHub query when technical
- Academic query when research-oriented

Select a diverse subset. Avoid near-duplicate queries. Prefer complementary facets over many small variants.

Use this query plan template:

```markdown
| Query ID | Task ID | Query | Domain/tool | Rationale | Expected evidence | Freshness need |
|---|---|---|---|---|---|---|
```

### 3. Adaptive Pause Decision

At each major fork, decide whether to pause. Use this practical score:

```text
pause_gain =
  alignment_gain
+ ambiguity_risk
+ contradiction_risk
+ cost_of_wrong_branch
+ user_control_value
- interruption_cost
```

Pause when `pause_gain` is high. Continue autonomously when uncertainty is low or easily reversible.

Pause triggers:

- Two or more plausible research directions with different outputs
- Conflicting high-quality evidence
- Evidence is insufficient after two loops
- User preference would determine relevance
- Search cost is about to increase significantly
- Sensitive enterprise/private data boundary is unclear
- A source requires login, payment, scraping, or policy-sensitive access

When pausing, present 2-5 concrete options and a recommended default. Do not ask open-ended vague questions.

### 4. Retrieval and Evidence Ledger

For each source, capture:

```markdown
| Source ID | URL/Location | Title | Publisher/Owner | Date | Source type | Reliability | Key evidence | Supports task | Limitations |
|---|---|---|---|---|---|---|---|---|---|
```

Reliability labels:

- `primary`: official documentation, original paper, source repository, standards body, legal/regulatory authority
- `high`: reputable journalism, well-maintained project docs, established analyst/research org
- `medium`: expert blog, community docs, package metadata
- `low`: forum/social post, SEO content, unsourced claims

Rules:

- Prefer primary sources for factual claims.
- For current product/tool behavior, prefer official docs, changelogs, source repositories, and release notes.
- For controversial claims, include at least two independent perspectives.
- Track negative evidence: searches that failed or sources that contradicted earlier assumptions.
- Do not cite sources you did not actually inspect.
- Do not overquote. Paraphrase and cite.

### 5. Reflection Loop

After each iteration, update `running-summary.md` with:

- Confirmed findings
- Unsupported but plausible leads
- Contradictions
- Remaining gaps
- Next searches
- Tasks to cancel or reprioritize

Reflection checklist:

```markdown
## Coverage
- [ ] All must-cover aspects have evidence.
- [ ] Each high-priority task is completed or explicitly marked unresolved.

## Evidence
- [ ] Important factual claims have sources.
- [ ] Current/changing facts are supported by recent or official sources.
- [ ] Primary sources were preferred where available.

## Contradictions
- [ ] Conflicting claims are identified.
- [ ] Source quality explains which claim is more credible.

## Search Quality
- [ ] At least one official/primary-source search was attempted where applicable.
- [ ] At least one critical/negative search was attempted.
- [ ] Duplicates were removed.

## User Alignment
- [ ] Assumptions are explicit.
- [ ] The answer format matches the user's requested decision.
```

If the audit fails, run another targeted search loop unless:

- The environment lacks search access.
- The unresolved gap is explicitly marked as unavailable.
- Further searching is unlikely to improve confidence.

### 6. Termination Criteria

Stop only when one of these is true:

- All high-priority tasks are complete and each key conclusion is supported.
- Remaining gaps are low-impact and disclosed.
- Sources are exhausted after at least two distinct search strategies.
- The user asks to stop.

Do not stop merely because a plausible answer exists. Stop when evidence sufficiency is met.

### 7. Final Report Format

Use this structure unless the user asks otherwise:

```markdown
# Research Report: <topic>

## Scope and Assumptions

## Executive Summary

## Key Findings

## Evidence Matrix

| Claim | Support | Source IDs | Confidence | Notes |
|---|---|---|---|---|

## Analysis

## Gaps / Uncertainties

## Recommendations or Next Actions

## Source List
```

Confidence labels:

- `High`: primary or multiple independent strong sources
- `Medium`: credible but incomplete or indirect evidence
- `Low`: limited, stale, or single-source evidence

## Search Domain Guidance

### Official sources

Use first for product behavior, API features, pricing, policies, standards, laws, release changes, and vendor capabilities.

### Academic sources

Use for papers, benchmarks, methodology, empirical claims, and scientific/technical novelty.

### GitHub/repository sources

Use for implementation status, installability, license, commit activity, issues, releases, and examples. Do not treat README claims as sufficient when source code, releases, or issues contradict them.

### Enterprise/internal sources

Use only when the user explicitly asks or the task is about internal documents/projects. Respect permissions. Do not expose sensitive data in the final report unless the user needs it and has asked for it.

### Social/professional sources

Use only through allowed tools and public/legal access paths. Do not scrape protected content or bypass login walls. Treat social claims as low reliability unless corroborated.

## Failure Modes to Avoid

- One-shot report with no evidence audit
- Too many similar searches
- Premature stopping
- Hiding contradictions
- Confusing source popularity with reliability
- Treating old docs as current
- Treating generated summaries as primary evidence
- Asking the user too often for low-value choices
- Continuing autonomously through high-impact ambiguity
