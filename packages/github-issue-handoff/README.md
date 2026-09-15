# github-issue-handoff

`github-issue-handoff` is an APM package containing a single skill of the same
name. It gives a local coding agent a durable way to ask for independent
judgment: persist a reviewable repository state on GitHub, ask a structured
question in an Issue linked to a Draft PR, hand the user a portable Responder
prompt, and resume later from the answers.

A Responder is anyone or anything that can browse the repository and comment
on a GitHub Issue — a human, another coding agent, a review AI, or
automation. The protocol never depends on a specific product or service.

## Install

Install the package with APM:

```bash
apm install github-issue-handoff
```

Or reference this repository directly:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages/packages/github-issue-handoff
```

The distributed skill lives under `.apm/skills/github-issue-handoff/`.

## Prerequisites

- `git` and the GitHub CLI (`gh`), authenticated (`gh auth status`).
- A GitHub remote on the working repository, with Issues enabled.
- Permission to create branches, push, and open Issues and Pull Requests.

Branch, commit, and push are mandatory protocol elements: a handoff starts
from a reviewable branch with pushed checkpoint commits, never from
local-only state. If repository policy forbids pushing, the protocol cannot
complete and fails explicitly — it never degrades to an Issue-only note.

## How a handoff works

1. **Investigate locally first.** Reproduce, inspect code, tests, errors,
   logs, and docs; only escalate when outside review adds value.
2. **Prepare the branch.** Reuse a dedicated task branch or create one; keep
   unrelated changes out.
3. **Commit the reviewable state.** Reproduction, current implementation,
   failing tests, drafts — only what the Responder needs, with a commit
   message that explains intent, verification, and open uncertainty.
4. **Push, then create the Issue.** The structured Issue records the
   question, context, findings, current assessment, repository state, and
   what review is requested.
5. **Open a linked Draft PR.** The PR body carries a closing reference
   (`Closes #<n>`), so merging the PR closes the Issue. Draft status marks
   that the decision is still open.
6. **Show the Responder prompt.** The agent renders the template with the
   real repository and label and displays the complete prompt to the user.
7. **Continue or yield.** Independent work continues; the handoff is marked
   `handoff:blocking` only when everything left depends on the answer.
8. **Resume and resolve.** Responses — including plain human comments — are
   weighed against repository evidence, implemented, verified, merged, and
   the Issue's closure is confirmed (closing it explicitly if the merge did
   not).

The Issue is the record of the question; the PR is the record of its
implementation. The Issue is normally closed by the merge, not before it.

## Labels

- `handoff` — protocol participant.
- `handoff:needs-response` — awaiting a Responder.
- `handoff:needs-requester` — awaiting the Requester.
- `handoff:blocking` — all remaining work is response-dependent.

The two pending states are mutually exclusive. Responders are never required
to manage labels.

## Roles

**Requester** — the working agent: investigates, prepares branch, commits,
pushes, opens Issue + Draft PR, shows the prompt, evaluates responses,
finishes, merges, verifies closure.

**Responder** — any commenting entity: reviews all open
`handoff:needs-response` Issues, inspects each linked PR's diff, commits, and
files, and answers with an independent assessment.

## Responder prompt

`assets/templates/responder-prompt.md` (English) and
`responder-prompt.ja.md` (Japanese) are reusable prompt templates, rendered
at handoff time with the target repository (`{{repository}}`) and label
(`{{label}}`, default `handoff:needs-response`).

Two properties matter:

- The prompt is **repository-wide** — it directs the Responder to every open
  `handoff:needs-response` Issue, so repeated or periodic invocations never
  strand an unanswered handoff.
- The Requester **shows the rendered prompt to the user** when the handoff is
  created — the user can paste it to a person, another agent, or any review
  workflow.

## Blocking

`handoff:blocking` means every remaining meaningful task waits on the
response. Anything less keeps working.

## Security

Never place secrets — `.env` contents, tokens, keys, cookies, credentials, or
sensitive customer data — in Issues, PRs, commit messages, or Responder
prompts. A private repository does not change this.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `gh` not found / not authenticated | Install GitHub CLI and run `gh auth login`. |
| Non-GitHub remote or ambiguous repository | The protocol stops rather than guessing; pass an explicit `owner/repo`. |
| Issues disabled or permission errors | Enable Issues / grant permissions; the skill reports the failing operation. |
| Push forbidden by policy or branch protection | Handoff cannot complete — reported explicitly, no Issue-only fallback. |
| Issue still open after PR merge | Check the closing reference, then post a resolution comment and close the Issue. |
| PR closed unmerged | Not a completed handoff — decide replacement, redesign, or not-planned and update the Issue. |

## Validate

From the repository root:

```bash
pnpm --dir scripts/github-issue-handoff test
pnpm --dir scripts/github-issue-handoff run lint:md
```

From this package directory:

```bash
apm compile --dry-run
apm compile --validate
```
