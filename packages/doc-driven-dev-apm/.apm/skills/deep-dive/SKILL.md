---
name: deep-dive
description: Use when the request needs deeper interrogation. Explore the codebase first, then ask one question at a time with a hypothesis and a recommended answer until the human confirms a concrete statement of intent and decision criteria.
license: MIT
---

# Deep Dive

Use this skill when the request is still underspecified in the ways that matter
for downstream work. The goal is not to generate options or draft documents. It
is to surface the real outcome, the binding constraints, and the decision axes
that future documents or implementation work will depend on.

## When to Use

Apply this skill when:

- the request sounds conventional but not concrete
- the user has not said which trade-offs matter most
- success criteria are vague
- the agent would otherwise have to guess at constraints, scope edges, or who
  the work is really for
- there is repository context that should change the questions you ask

Do not use this skill for:

- trivial, mechanical changes
- pure information requests
- writing specs, ADRs, or plans directly
- brainstorming multiple solution directions

## Core Rules

1. Explore the codebase first when repository evidence can answer part of the
   question.
2. Ask one question at a time.
3. Every live question must include:
   - `Q:` the question
   - `GUESS:` your current hypothesis
   - `RECOMMENDED:` the answer you would choose right now and why
4. Walk the decision tree branch-by-branch instead of dumping a questionnaire.
5. Stop when the user has confirmed a concrete statement of intent.

## Process

### Step 1: Scan the codebase first

Before asking, gather the repository evidence that should shape the interview.

- Read the relevant docs, configs, and code paths.
- Note existing constraints and patterns.
- Do not ask the human to restate facts already visible in the repository.

If a question can be answered by exploring the codebase, do that first.

### Step 2: State your hypothesis

Write down your best current read and confidence level.

```text
HYPOTHESIS: You want ...
CONFIDENCE: ~40% - missing: ...
```

Confidence below ~70% should include a short reason.

### Step 3: Ask one question at a time

Format every question like this:

```text
Q: ...
GUESS: ...
RECOMMENDED: ...
```

Rules:

- wait for the answer before asking the next question
- prefer the shortest question that resolves the next branch
- keep surfacing your assumptions rather than hiding them

### Step 4: Walk the decision tree

Use follow-ups to refine:

- desired outcome
- target user
- why now
- success criteria
- binding constraints
- decision axes
- out-of-scope items

Keep going until you can predict the user's likely reaction to the next three
questions you would ask.

### Step 5: Restate the confirmed intent

Deliver a concise summary:

```text
Here's what I now think you want:

- Outcome:
- User:
- Why now:
- Success:
- Constraint:
- Decision axes:
- Out of scope:

Yes / no / refine?
```

That confirmed summary is the output of this skill.

## Interaction Style

- Be direct.
- Ask one question at a time.
- Prefer repository evidence over avoidable questions.
- Give a recommendation with each question, not just a prompt.
- Do not widen into solution ideation unless the user explicitly changes modes.

## Handoffs

After a confirmed summary:

- hand off to `spec-doc` when requirements are ready to be written
- hand off to `adr-doc` when a concrete technical decision is ready to be
  drafted as an ADR
- hand off to a separate exploration skill only if the user explicitly wants
  ideation

## Verification

After applying this skill:

- [ ] Repository evidence was checked before asking avoidable questions
- [ ] The first turn stated a hypothesis and confidence level
- [ ] Each live question included `Q`, `GUESS`, and `RECOMMENDED`
- [ ] Questions were asked one at a time
- [ ] The final output was a confirmed intent summary with outcome, user, why
      now, success, constraint, decision axes, and out of scope
