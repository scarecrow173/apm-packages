---
name: github-issue-handoff
description: Use when a coding task needs an independent judgment that local investigation cannot settle — architecture or API/data-model decisions with multiple defensible options, unresolved root causes after real debugging, requirement-vs-behavior contradictions, security-sensitive or hard-to-reverse changes — or when resuming work from responses on an existing handoff Issue. Not for routine tasks or problems that tests, lint, or repository docs already settle.
license: MIT
---

# GitHub Issue Handoff

A handoff persists a durable, reviewable repository state on GitHub — a
dedicated branch, pushed checkpoint commits, a structured Issue, and a linked
Draft PR — so that any third party can evaluate a specific question and answer
asynchronously through Issue comments.

- **Requester**: the working agent that opens, maintains, and resolves the
  handoff.
- **Responder**: ANY entity that can read the repository and comment on a
  GitHub Issue — a human, another coding agent, a review AI, or automation.
  Never require a specific product, runtime, account, or proprietary tool.

The Issue records the question. The branch, commits, and linked PR record the
exact code being judged. The Responder prompt is a portable instruction the
user can hand to any responder; it is not a runtime for one.

## When to Use

Hand off when an independent review adds real value:

- architecture, API contract, or data-model decisions that are expensive or
  difficult to reverse
- multiple defensible options with meaningful trade-offs
- concurrency, consistency, security-sensitive, or destructive-migration
  decisions
- root cause still unknown after genuine debugging
- a requirement that contradicts existing behavior
- independent evaluation of your own hypothesis, severity, or scope

Do NOT hand off:

- syntax errors, formatter or lint results, problems a test run settles
- questions the repository documentation already answers
- small implementation details you can safely try
- decisions where sufficient evidence already exists

## Investigate Before Handoff

Never escalate on first sight of a problem. First:

1. reproduce or identify the problem,
2. inspect the relevant code, tests, errors, logs, and repository docs,
3. form hypotheses and perform cheap verification,
4. only then decide whether outside review adds value.

## Handoff Lifecycle

1. Confirm repository, current branch, intended base, working tree, and HEAD.
   Reuse the current task branch if it is dedicated to this change; otherwise
   create one (for example `handoff/<short-topic>` — follow repo convention).
2. Commit only the state the Responder needs — reproduction, current
   implementation, failing tests, drafts, schemas, docs. Inspect
   `git status`, `git diff`, and `git diff --cached` first. Never mix in
   unrelated changes, artifacts, caches, or secrets.
3. Push the branch. A local-only handoff is not a handoff.
4. Create the handoff Issue with the format in `references/issue-format.md`.
5. Create a Draft PR whose body links the Issue with a closing keyword
   (`Closes #<n>`). Base = the branch the change will finally merge into.
6. Render `assets/templates/responder-prompt.md` with the real repository and
   label, and show the complete prompt to the user — a file path alone is not
   sufficient.
7. Continue independent work. Yield only when every remaining meaningful task
   depends on the response.
8. On resume, read the Issue, new comments, linked PR, and latest pushed
   commit; evaluate responses against repository evidence — never implement
   them blindly.
9. Finish implementation, run validation, push, merge the PR, and verify the
   Issue actually closed.

Full Requester protocol: `references/protocol.md`.
Issue/PR/metadata format: `references/issue-format.md`.
Responder-side protocol: `references/responder-guide.md`.

## Invariants

- All five artifacts are mandatory: reviewable branch, pushed checkpoint
  commit, handoff Issue, linked Draft PR, user-visible rendered prompt.
- Push before Issue. If repository policy forbids push, stop and report that
  the handoff protocol cannot be completed — never fall back to an
  Issue-only handoff.
- The PR must reach the Issue via a closing keyword, not "Related to".
- Labels: `handoff` plus exactly one state —
  `handoff:needs-response` (awaiting Responder) or
  `handoff:needs-requester` (awaiting Requester); add `handoff:blocking`
  only when all remaining work is response-dependent. Ensure the labels
  exist on the repository before the Issue (`gh label create`) — without
  `handoff:needs-response` the Responder sweep cannot discover the
  handoff, so a failure there fails the handoff closed.
- Plain human comments are valid responses. Responder label edits are
  optional, never required.
- Commit messages are permanent history: state intent, current behavior,
  what was verified, and what remains uncertain — no secrets, ever.
- After merge, verify the Issue closed; if auto-close failed, comment the
  merged PR reference and close it explicitly. An unmerged closed PR is
  never a completed handoff.

## Blocking

Mark `handoff:blocking` only when remaining meaningful work is entirely
response-dependent. Creating the Issue is never by itself a reason to stop.

## Failure Reporting

If the lifecycle fails partway, report exactly which artifacts were created
and where it stopped. Partial success is not a completed handoff.
