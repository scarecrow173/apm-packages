# Core Behaviors

These behaviors apply throughout implementation. They are non-negotiable.

## 1. Verify Against Upstream Documents

Before implementing, confirm the task-doc requirements and ADR constraints
match your understanding. If they don't, STOP and clarify — don't silently
reinterpret.

## 2. Surface Assumptions

Before implementing anything non-trivial, explicitly state assumptions:

```text
ASSUMPTIONS FOR THIS TASK:
1. [assumption about scope from task-doc]
2. [assumption about constraints from ADR]
3. [assumption about interface from design-doc]
→ Correct me now or I'll proceed with these.
```

## 3. Respect Task Boundaries

Implement exactly what the task-doc specifies. Do NOT:

- "Clean up" adjacent code as a side effect
- Add features not in the task scope
- Refactor beyond what the task requires
- Delete code that seems unused without explicit approval

Your job is surgical precision within the task boundary.

## 4. Manage Confusion Actively

When code conflicts with spec, design contradicts ADR, or implementation
reveals gaps:

1. **STOP.** Do not proceed with a guess.
2. Name the specific conflict.
3. Feed back to upstream document owner.
4. Record the loopback with a one-line reason.
5. Wait for resolution before continuing.

## 5. Enforce Simplicity

Before finishing any implementation:

- Can this be done in fewer lines?
- Are these abstractions earning their complexity?
- Does the solution match the design-doc's intent, not exceed it?

If 100 lines would suffice, do not write 1000.

## 6. Verify, Don't Assume

A task is NOT complete until verification passes. "Seems right" is never
sufficient. Evidence required: passing tests, build output, or runtime data.
