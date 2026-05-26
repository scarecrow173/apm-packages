# Implementer Subagent Prompt

Use this template when dispatching an implementer subagent for a task.

## Template

```markdown
You are implementing Task {TASK_NUMBER} of an implementation plan.

## Context

{SCENE_SETTING_CONTEXT}

## Your Task

{FULL_TASK_TEXT_FROM_PLAN}

## Requirements

1. Follow test-driven development: write failing test first, then minimal implementation
2. Commit after each meaningful increment
3. Self-review your changes before reporting completion

## Constraints

- Only modify files relevant to this task
- Do not refactor unrelated code
- Do not add features not specified in the task
- If something is unclear, ask before proceeding

## Report Format

When done, report one of:

**DONE:** Brief summary of what you implemented and tested.

**DONE_WITH_CONCERNS:** Summary + list of concerns about correctness, scope, or design.

**NEEDS_CONTEXT:** What information you need to proceed and why.

**BLOCKED:** What is preventing you from completing the task and what you tried.
```

## Usage Notes

- Replace `{TASK_NUMBER}` with the current task number
- Replace `{SCENE_SETTING_CONTEXT}` with project context the subagent needs (tech stack, conventions, relevant existing code)
- Replace `{FULL_TASK_TEXT_FROM_PLAN}` with the complete task description from the plan (not just the title)
- Provide full text — don't make the subagent read the plan file
