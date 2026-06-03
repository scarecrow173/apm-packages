---
name: doubt-driven-development
description: Subjects every non-trivial decision to a fresh-context adversarial review before it stands. Use when correctness matters more than speed, when working in unfamiliar code, when stakes are high, or any time a confident output would be cheaper to verify now than to debug later.
license: MIT
origin: addyosmani/agent-skills (MIT)
---

# Doubt-Driven Development

## Overview

A confident answer is not a correct one. Long sessions accumulate context that quietly turns assumptions into "facts" without anyone noticing. Doubt-driven development is the discipline of materializing a fresh-context reviewer — biased to **disprove**, not approve — before any non-trivial output stands.

This is not a post-hoc code review. This is an in-flight posture: non-trivial decisions get cross-examined while course-correction is still cheap.

## When to Use

A decision is **non-trivial** when at least one of these is true:

- It introduces or modifies branching logic
- It crosses a module or service boundary
- It asserts a property the type system or compiler cannot verify (thread safety, idempotence, ordering, invariants)
- Its correctness depends on context the future reader cannot see
- Its blast radius is irreversible (production deploy, data migration, public API change)

Apply the skill when:

- About to make an architectural decision under uncertainty
- About to commit non-trivial code
- About to claim a non-obvious fact ("this is safe", "this scales", "this matches the spec")
- Working in code you don't fully understand

**When NOT to use:**

- Mechanical operations (renaming, formatting, file moves)
- Following a clear, unambiguous user instruction
- Reading or summarizing existing code
- One-line changes with obvious correctness
- Pure tooling operations (running tests, listing files)
- The user has explicitly asked for speed over verification

If you doubt every keystroke, you ship nothing. The skill applies only to non-trivial decisions as defined above.

## The Process

Copy this checklist when applying the skill:

```
Doubt cycle:
- [ ] Step 1: CLAIM — wrote the claim + why-it-matters
- [ ] Step 2: EXTRACT — isolated artifact + contract, stripped reasoning
- [ ] Step 3: DOUBT — invoked fresh-context reviewer with adversarial prompt
- [ ] Step 4: RECONCILE — classified every finding against the artifact text
- [ ] Step 5: STOP — met stop condition (trivial findings, 3 cycles, or user override)
```

### Step 1: CLAIM — Surface what stands

Name the decision in two or three lines:

```
CLAIM: "The new caching layer is thread-safe under the
        read-heavy workload described in the spec."
WHY THIS MATTERS: a race here corrupts user data and is
                  hard to detect in QA.
```

If you can't write the claim that compactly, you have a vibe, not a decision. Surface it before scrutinizing it.

### Step 2: EXTRACT — Smallest reviewable unit

A fresh-context reviewer needs the **artifact** and the **contract**, not the journey.

- Code: the diff or the function — not the whole file
- Decision: the proposal in 3–5 sentences plus the constraints it has to satisfy
- Assertion: the claim plus the evidence that supposedly supports it

Strip your reasoning. If you hand over conclusions, you'll get back validation of your conclusions. The unit must be small enough that a reviewer can hold it in mind in one read — if it's a 500-line PR, decompose first.

### Step 3: DOUBT — Invoke the fresh-context reviewer

The reviewer's prompt **must be adversarial**. Framing decides the answer.

```
Adversarial review. Find what is wrong with this artifact.
Assume the author is overconfident. Look for:
- Unstated assumptions
- Edge cases not handled
- Hidden coupling or shared state
- Ways the contract could be violated
- Existing conventions this might break
- Failure modes under unexpected input

Do NOT validate. Do NOT summarize. Find issues, or state
explicitly that you cannot find any after thorough examination.

ARTIFACT: <paste artifact>
CONTRACT: <paste contract>
```

**Pass ARTIFACT + CONTRACT only. Do NOT pass the CLAIM.** Handing the reviewer your conclusion biases it toward agreement.

#### Cross-model escalation

A single-model reviewer shares blind spots with the original author. A different-architecture model catches them.

**Interactive sessions: always offer cross-model after single-model review.**

> *"Single-model review complete. Want a cross-model second opinion? Options: external CLI review, manual external review (you paste it elsewhere), or skip."*

This question is mandatory in every interactive doubt cycle. The user — not the agent — decides whether the cost is worth it.

**Non-interactive contexts** (CI, autonomous-loop, scheduled runs):

- Cross-model is **skipped**, and the skip must be **announced**: *"Cross-model skipped: non-interactive context."*

**Safety rules for external CLI invocation:**

1. Check the tool is in PATH and working before passing the full prompt.
2. Confirm the exact invocation with the user before running.
3. Pass ARTIFACT + CONTRACT + adversarial prompt only. No session context, no CLAIM.
4. Use a read-only sandbox to prevent unintended modifications.
5. Write the prompt to a file and pipe via stdin — never interpolate artifacts into shell arguments.
6. If the CLI is unavailable or fails, surface the failure explicitly and offer alternatives.

### Step 4: RECONCILE — Fold findings back

The reviewer's output is data, not verdict. **You are still the orchestrator.** Re-read the artifact text against each finding before classifying.

For each finding, classify in this **precedence order**:

1. **Contract misread** — reviewer misunderstood constraints; fix contract first, re-classify next cycle.
2. **Valid + actionable** — real issue requiring a change. Change the artifact, re-loop.
3. **Valid trade-off** — real but acceptable cost. Document explicitly.
4. **Noise** — correct under context the reviewer didn't have. Note it, move on.

A fresh reviewer can be wrong because it lacks context. Don't defer just because it's "fresh."

### Step 5: STOP — Bounded loop, not recursion

Stop when:

- Next iteration returns only trivial or already-considered findings, **or**
- 3 cycles completed (escalate to user, don't grind a fourth alone), **or**
- User explicitly says "ship it"

If after 3 cycles the reviewer still surfaces substantive issues, the artifact may not be ready. Surface this to the user.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I'm confident, skip the doubt step" | Confidence correlates poorly with correctness on novel problems. |
| "Spawning a reviewer is expensive" | Debugging a wrong commit in production is more expensive. |
| "The reviewer will just nitpick" | Constrain the prompt to "issues that would make this fail under the contract." |
| "I'll do doubt at the end with review" | Post-hoc review catches wrong directions too late. Doubt-driven catches them early. |
| "If I doubt every step I'll never ship" | The skill applies to non-trivial decisions, not every keystroke. |
| "The reviewer disagreed so I was wrong" | Disagreement is information, not verdict. Classify, then decide. |

## Red Flags

- Spawning a fresh-context reviewer for a one-line rename or formatting change
- Treating reviewer output as authoritative without re-reading the artifact text
- Looping >3 cycles without escalating to the user
- Prompting the reviewer with "is this good?" instead of "find issues"
- Skipping doubt under time pressure on a high-stakes decision
- Re-spawning fresh-context on an unchanged artifact
- **Doubt theater**: across 2+ cycles where reviewer surfaced substantive findings, zero classified as actionable. You are validating, not doubting. Stop and escalate.
- Doubting only after committing
- Silently skipping cross-model in an interactive doubt cycle
- Passing the CLAIM to the reviewer (biases toward agreement)

## Interaction with Other Skills

- **requesting-code-review**: complementary. Code review is post-hoc PR verdict; doubt-driven is in-flight per-decision. Use both.
- **source-driven-development**: SDD verifies facts about frameworks against official docs. Doubt-driven verifies your reasoning about the artifact.
- **test-driven-development**: TDD's RED step is doubt made concrete — a failing test is a disproof attempt.
- **systematic-debugging**: when the reviewer surfaces a real failure mode, drop into the debugging skill to localize and fix.

## Verification

After applying doubt-driven development:

- [ ] Every non-trivial decision was named explicitly as a CLAIM before standing
- [ ] At least one fresh-context review per non-trivial artifact
- [ ] The reviewer received ARTIFACT + CONTRACT — NOT the CLAIM, NOT your reasoning
- [ ] The reviewer's prompt was adversarial ("find issues"), not validating ("is it good")
- [ ] Findings were classified against the artifact text using the precedence order
- [ ] A stop condition was met (trivial findings, 3 cycles, or user override)
- [ ] In interactive mode, cross-model was explicitly offered to the user
- [ ] In non-interactive mode, cross-model was skipped and the skip was announced
