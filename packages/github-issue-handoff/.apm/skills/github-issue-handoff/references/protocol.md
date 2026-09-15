# Requester Protocol

The complete Requester-side lifecycle for `github-issue-handoff`. The summary
lives in `SKILL.md`; this document is the operational detail.

## Roles

**Requester** — the agent doing the work. Responsible for investigating the
problem, preparing a reviewable branch, committing relevant state, pushing,
creating the Issue, creating and linking the PR, showing the Responder prompt
to the user, evaluating responses, following up, finishing the implementation,
and confirming the Issue closed after merge.

**Responder** — any entity that can read the repository and comment on the
Issue: a human, another coding agent, a review AI, or automation. Do not
require a specific identity, bot account, runtime, API, marker, or label
permission. A plain Issue comment is a valid response.

## Preconditions

Before starting a handoff, establish:

- `git` is available and the working tree is a repository.
- `gh` (GitHub CLI) is available and authenticated (`gh auth status`).
- The remote is a GitHub repository and Issues are enabled.
- Repository detection order: explicit repository argument → `gh repo view` →
  `git remote`. If the target repository is still ambiguous, stop — never
  create Issues or PRs in a guessed repository. The repository embedded in the
  Responder prompt must match the one the handoff was created in.

## Local Investigation Gate

Do not open a handoff on first sight of a problem. First:

1. reproduce or precisely identify the problem;
2. inspect relevant code, tests, errors, and logs;
3. inspect repository documentation;
4. form hypotheses and perform cheap verification;
5. decide whether independent review adds value.

If local investigation can settle the question cheaply, settle it locally.

## Branch

A handoff requires a working branch the Responder can reference.

- Reuse the current task branch when it is dedicated to this change.
- If on the default branch or an unrelated branch, create a new branch.
- Follow repository naming conventions. With none, a name like
  `handoff/<short-topic>` is a reasonable default; the format is not part of
  the protocol.

Before creating the branch confirm, at minimum: repository, current branch,
intended base branch, working tree state, and current HEAD. Do not let
unrelated working-tree changes leak into the handoff branch.

## Checkpoint Commit

The checkpoint commit is the Responder's reviewable baseline — not a dump.

- Include only state the Responder needs: the reproduction, the current
  implementation, failing or added tests, relevant configuration, draft
  designs, migrations, schemas, and relevant documentation.
- Exclude unrelated refactors, unrelated formatting, editor artifacts,
  caches, temporary output, unrelated experiments, and secrets.
- Inspect `git status`, `git diff`, and `git diff --cached` before committing.
- Split into multiple commits when that improves reviewability.

Commit messages follow the repository's convention. The subject states what
changed; the body explains, as needed, why this checkpoint exists, what
behavior is implemented, what has been verified, what remains uncertain, and
why the handoff was requested. Never write credentials, tokens, private data,
or sensitive log content into a commit message.

## Push

Push the branch and checkpoint commit to the remote before creating the
Issue — a Responder cannot review state that exists only locally.

If repository policy, user instruction, or branch protection forbids the push,
stop and report that the handoff protocol cannot be completed under the
current repository policy. Do not silently fall back to an Issue-only handoff.

## Issue and Draft PR

Create the Issue with the format in `issue-format.md`, then create the PR.

- The PR is mandatory. An Issue without a PR is not a started handoff.
- Create the PR as a Draft — it exists for review, not for merge yet. Follow
  the repository workflow only if it does not use Draft PRs.
- Base the PR on the branch the change will finally merge into (usually the
  default branch, or the repository's integration branch).
- Link with a closing keyword (`Closes #<n>`; `Fixes`/`Resolves` per repo
  convention). `Related to #<n>` alone is not sufficient.
- Ensure the Responder can reach the diff, commits, changed files, and checks
  from the PR.

## Responder Prompt

After the artifacts exist, render the Responder prompt and show it to the user.

- Render `assets/templates/responder-prompt.md` with the actual `owner/repo`
  and the label (default `handoff:needs-response`). Show the complete rendered
  prompt inline — pointing at the template path is not sufficient.
- Also report: Issue URL, PR URL, branch, checkpoint commit SHA, and whether
  the handoff is blocking.
- The prompt is repository-wide by design: it directs the Responder to every
  open `handoff:needs-response` Issue, not only the one just created.
- Re-show the prompt on a new handoff, when the user asks, when the template
  or parameters changed, or when a follow-up clearly needs Responder
  attention. Routine resumes do not require re-showing it.

## Continue or Yield

Creating a handoff is not a reason to stop. Continue independent tasks. If new
relevant changes occur, commit and push them through the normal workflow so
the PR reflects them.

Mark `handoff:blocking` and yield only when all remaining meaningful work
depends on the unresolved response.

## Follow-up Rounds

Keep follow-up questions on the same Issue — do not spawn new Issues for the
same problem. Each round gets a fresh round ID (see `issue-format.md`).

If relevant code changed since the last round, modify → verify → commit →
push first, then post the follow-up recording the latest pushed SHA. A purely
textual follow-up needs no new commit.

After a follow-up, transition `handoff:needs-requester` back to
`handoff:needs-response`.

## Resume

When resuming:

1. find the relevant open handoff Issue;
2. read the Issue body and all new comments;
3. inspect the linked PR and latest pushed commit;
4. identify response candidates — plain comments count;
5. compare each response against repository evidence;
6. update your assessment;
7. continue, follow up, or resolve.

Labels are hints for finding state — never the sole authority on whether a
response exists.

## Evaluating Responses

A response is an independent review, not a command. Rank evidence as:
verified evidence, repository behavior, tests, documented requirements,
established constraints — then responder opinion. When a response
contradicts repository evidence, prefer the evidence; verify further or
follow up if needed.

## Completion

When the response is incorporated and implementation is complete:

1. run required validation;
2. commit final changes with a meaningful message and push;
3. update the PR, and mark ready for review when appropriate;
4. merge the PR;
5. verify the Issue actually closed — a closing keyword in the body is not
   proof.

If the Issue is still open after merge, determine why (broken closing
reference, wrong Issue number, base-branch condition, unusual workflow). When
the implementation is genuinely complete, post a final `## Resolution`
comment naming the merged PR and the verification performed, then close the
Issue explicitly. Never leave a completed handoff open.

If the PR was closed unmerged, that is not success: state the disposition
(replacement PR, follow-up/redesign, or not planned) and handle the Issue
accordingly.

Before closing an Issue confirm: the question is resolved, the implementation
is reflected in the PR, validation is complete, the PR relationship exists,
the PR disposition is clear, no follow-up is unresolved, and the final
repository state is traceable.

## Error Handling

| Failure | Required behavior |
| --- | --- |
| `git` unavailable | Report and stop; no handoff is possible. |
| `gh` unavailable or unauthenticated | Report and stop; ask the user to install or authenticate. |
| Repository detection failure or non-GitHub remote | Report and stop; never guess a target. |
| Issues disabled or insufficient permissions | Report which operation failed and stop. |
| Label setup failure | Note it on the Issue; labels are protocol hints, not the sole state authority. |
| Branch/commit/push failure | Report the failure point; do not create the Issue. |
| Issue creation failure | Report; do not create a dangling PR. |
| PR creation failure | Report the Issue URL and the missing PR; the handoff is incomplete until the PR exists. |
| Malformed protocol metadata | Record the correct metadata in the next round; keep the human-readable body authoritative. |
| Missing linked PR | Recreate the linkage before treating the handoff as started. |

## Secret Safety

Never embed in Issues, PRs, commit messages, or prompts: `.env` contents, API
keys, tokens, passwords, cookies, Authorization headers, private keys,
secret-bearing configuration, or sensitive customer data. A private
repository does not make secret posting acceptable.

## Concurrency

Multiple handoffs are independent: each maps an Issue to a PR, a branch, a
current round, a current commit, and a state label. The Responder prompt is
repository-wide and sweeps every `handoff:needs-response` Issue in one pass.
Keep the two scopes distinct: Requester lifecycle is per Issue; Responder
invocation is per repository.
