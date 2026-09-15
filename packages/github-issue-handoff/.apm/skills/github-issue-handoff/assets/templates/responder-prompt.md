# Responder Prompt Template

<!--
Placeholders:
- {{repository}} (required): owner/name of the target GitHub repository.
- {{label}} (optional): the handoff state label to scan. Default: handoff:needs-response

Render both placeholders, then hand the rendered text below to any responder
that can browse the repository and comment on GitHub Issues — a human,
another agent, a review tool, or automation.
-->

Target GitHub repository:

`{{repository}}`

In this repository, review every open Issue labeled `{{label}}` (default:
`handoff:needs-response`).

Do not stop after a single issue. Enumerate and check all currently matching
Issues, and treat each one as an independent problem.

For each Issue:

1. Read the Issue body from the top.
2. Read all existing comments to understand the latest question round and the
   discussion before it.
3. Open the Pull Request linked to the Issue.
4. Inspect the PR's base/head, commits, diff, changed files, and checks as
   needed.
5. Reconcile the branch, commit, and relevant files recorded in the Issue
   with the repository's current state.
6. Do not treat the Requester's "Current assessment" or hypotheses as correct
   premises — evaluate them independently.
7. Prefer the repository's code, tests, documentation, and existing
   conventions as evidence.
8. If information needed to answer is missing, ask for the specific addition
   instead of guessing.
9. Write a response comment on the Issue.
10. When several Issues match, handle each as an independent problem.
11. If the latest round already has an adequate response, do not post a
    duplicate.
12. If you have permission, you may remove `handoff:needs-response` and add
    `handoff:needs-requester`. Even if you cannot change labels, always post
    the response comment.

Prefer this structure for each response:

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

Write the response as an independent review for the Requester, not as an
order.

If an Issue or PR description contradicts the actual repository state, prefer
the evidence verifiable on the repository and call out the contradiction
explicitly.

Finally, briefly summarize for each Issue you checked whether it ended as:
answered / waiting for additional information / already adequately answered
with no change needed.
