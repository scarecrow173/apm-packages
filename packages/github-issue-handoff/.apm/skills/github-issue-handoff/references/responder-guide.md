# Responder Guide

How a Responder processes handoff Issues. This document describes the
protocol; the executable instruction handed to a Responder is the prompt
template in `assets/templates/responder-prompt.md` — do not confuse the two.

## Who Can Respond

Anyone or anything that can read the repository and comment on the Issue: a
human, another coding agent, a review AI, or automation. No specific identity,
bot account, runtime, or tool is required. Label manipulation is optional and
never required for the protocol to work.

## Scope: Every Open `handoff:needs-response` Issue

A Responder invocation is repository-wide. Search for every open Issue
labeled `handoff:needs-response` and process all of them — never stop after
handling a single one. Each Issue is an independent problem; evaluate it on
its own evidence.

If a responder-side response already exists after the latest Requester round —
including a response that only requests additional information — and the
Requester has posted no newer follow-up since, do not post a duplicate
response.
Record the Issue as already handled; a pending information request is
`handoff:needs-requester` in effect even when the label could not be changed.

## Per-Issue Procedure

For each target Issue:

1. Read the Issue body from the top.
2. Read all existing comments to learn the latest question round and the
   discussion before it.
3. Open the linked Pull Request.
4. Inspect the PR's base/head, commits, diff, changed files, and checks as
   needed.
5. Reconcile the branch, commit, and relevant files recorded in the Issue
   with the repository's current state.
6. Treat the Requester's "Current assessment" and hypotheses as claims, not
   premises — evaluate them independently.
7. Prefer the repository's code, tests, documentation, and conventions as
   evidence.
8. When information needed to answer is missing, ask for the specific
   addition instead of guessing.
9. Write a response comment on the Issue. PR review comments may supplement
   it for line-level discussion.
10. When permitted, you may remove `handoff:needs-response` and add
    `handoff:needs-requester`. If you cannot change labels, still post the
    comment — the comment alone completes your side of the protocol.

## Response Structure

Prefer this shape:

```markdown
## Assessment

Independent evaluation of the problem.

## Recommendation

The recommended action.

## Reasoning

Grounds in code, tests, specifications, and design.

## Risks / edge cases

Overlooked risks and boundary conditions.

## Suggested next step

What the Requester should verify, implement, or decide next.
```

A response is an independent review for the Requester, not an order.

## Contradictions

When the Issue or PR description contradicts the actual repository state,
prefer the evidence verifiable on the repository and call out the
contradiction explicitly.

## Optional Automation Marker

Automated responders may include an optional marker for deduplication,
round correspondence, and audit:

```markdown
<!-- github-issue-handoff-response
protocol: 1
round: 20260916T031522Z-a8f31c
-->
```

The marker is optional. Comments without it — including every human comment —
are equally valid responses.

## Closing Summary

Finish by briefly reporting, for each Issue checked, whether it was:
answered, waiting on additional information, or already adequately answered
with no change needed.
