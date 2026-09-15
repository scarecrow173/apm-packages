# Issue and PR Format

The artifact formats for `github-issue-handoff`: labels, Issue title and body,
machine-readable metadata, the linked Pull Request, and follow-up comments.

## Labels

Recommended label set:

- `handoff` — this Issue participates in the handoff protocol.
- `handoff:needs-response` — the latest question round awaits a Responder.
- `handoff:needs-requester` — the Requester should inspect a new response.
- `handoff:blocking` — all remaining meaningful work depends on a response.

`handoff:needs-response` and `handoff:needs-requester` are mutually
exclusive: exactly one of them should be present at a time. Never require the
Responder to change labels — label updates on their side are optional.

The Requester ensures these labels exist on the repository before creating
the Issue (`gh label create` as needed). The repository-wide Responder scan
discovers handoffs by `handoff:needs-response`, so at minimum `handoff` and
`handoff:needs-response` must be applicable — otherwise the handoff fails
closed.

## Issue Title

```text
[Handoff] <concise problem summary>
```

Example: `[Handoff] Choose retry semantics for FooService`

## Issue Body

Mandatory sections: `Question`, `Context`, `Findings`, `Current assessment`,
`Repository state`, `Requested review`. Include `Options considered`,
`Verification performed`, and `Blocking` when they carry information.

```markdown
## Question

The specific question you want answered.

## Context

What is being implemented and why this judgment is needed.

## Findings

Facts already established.

- ...
- ...

## Options considered

Only when relevant.

### Option A

...

### Option B

...

## Current assessment

The Requester's current judgment and its basis.

## Repository state

Branch: `<branch>`
Commit: `<sha>`
Base: `<base>`

Relevant files:

- `path/to/file`
- `path/to/file`

## Verification performed

Tests, investigations, and experiments already run.

## Requested review

The specific points the Responder should evaluate.

## Blocking

`true` / `false`
```

## Metadata Comment

Every handoff Issue body carries a machine-readable HTML comment:

```markdown
<!-- github-issue-handoff
protocol: 1
round: 20260916T031522Z-a8f31c
requester: local-agent
branch: feature/example
commit: abc123...
blocking: false
-->
```

Requirements:

- `protocol` — the protocol version (`1`).
- `round` — a unique ID per question round, e.g. a UTC timestamp plus a short
  discriminator: `20260916T031522Z-a8f31c`. Issue a new round ID for every
  follow-up round on the same Issue.
- `branch`, `commit` — the pushed reviewable state for this round.
- `blocking` — whether all remaining work is response-dependent.
- The comment must not disturb Markdown rendering and must not require any
  specific product or tool in its schema.

## Pull Request

The PR is created as a Draft (unless the repository workflow has no Draft
concept), based on the branch the change will finally merge into. Its body
must contain a closing reference to the Issue — `Closes #<n>`, or
`Fixes`/`Resolves` per repository convention. `Related to #<n>` alone does
not create the merge-to-close link.

Minimum PR body:

```markdown
## Summary

What the current changes do.

## Handoff

Closes #<issue-number>

Handoff round: `<round-id>`

## Review context

The main places the Responder should look.

- `path/to/file`

## Current status

- [ ] External response incorporated
- [ ] Implementation complete
- [ ] Tests passing
- [ ] Ready for merge

## Known uncertainty

The question currently awaiting a response.
```

When the repository has an existing PR template, prefer it and fold this
information in.

## Follow-up Comment Format

Follow-up rounds stay on the same Issue:

```markdown
## Follow-up

The additional question.

## New findings

What was learned since the last round.

## Current assessment

The updated judgment.

## Repository state

Commit: `<latest pushed sha>`

<!-- github-issue-handoff
protocol: 1
round: 20260916T045501Z-b91e02
requester: local-agent
branch: feature/example
commit: def456...
blocking: false
-->
```

Every round's metadata comment carries the full field set — a follow-up must
record its own `round`, `branch`, `commit`, and `blocking` so that tooling can
reconstruct the state of the latest round alone.

Then transition the state label back to `handoff:needs-response`.
