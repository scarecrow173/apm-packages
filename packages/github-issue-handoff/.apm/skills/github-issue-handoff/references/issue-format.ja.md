# Issue と PR のフォーマット

`github-issue-handoff` の artifact 形式です。label、Issue のタイトルと本文、
機械可読 metadata、linked Pull Request、follow-up コメントを定義します。

## Label

推奨 label セット:

- `handoff` — この Issue は handoff protocol に参加している。
- `handoff:needs-response` — 最新の質問 round が Responder の回答待ち。
- `handoff:needs-requester` — Requester が新しい response を確認すべき状態。
- `handoff:blocking` — 残っている意味のある作業がすべて response 依存。

`handoff:needs-response` と `handoff:needs-requester` は排他的で、同時には
どちらか一方だけが存在します。Responder に label 変更を必須要求しません。
Responder 側の label 更新は任意です。

## Issue タイトル

```text
[Handoff] <concise problem summary>
```

例: `[Handoff] Choose retry semantics for FooService`

## Issue 本文

必須セクション: `Question`、`Context`、`Findings`、`Current assessment`、
`Repository state`、`Requested review`。`Options considered`、
`Verification performed`、`Blocking` は情報を持つ場合に含めます。

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

## Metadata コメント

すべての handoff Issue 本文には、機械可読な HTML コメントを含めます:

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

要件:

- `protocol` — protocol version（`1`）。
- `round` — 質問 round ごとの一意な ID。例: UTC timestamp + 短い識別子
  `20260916T031522Z-a8f31c`。同じ Issue 内の follow-up round ごとに新しい
  round ID を発行します。
- `branch`、`commit` — この round の push 済み reviewable state。
- `blocking` — 残作業がすべて response 依存かどうか。
- このコメントは Markdown 表示を妨げてはいけません。また schema の要件に
  特定の製品名やツールを含めてはいけません。

## Pull Request

PR は Draft として作成します（repository の workflow に Draft の概念がない
場合を除く）。base は変更が最終的に merge される branch です。本文には
Issue への closing reference を必ず含めます。`Closes #<n>`、または
repository 規約に応じて `Fixes` / `Resolves` を使います。
`Related to #<n>` だけでは merge→close のリンクになりません。

PR 本文の最小構成:

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

repository に既存の PR template がある場合はそれを優先しつつ、必要な情報を
組み込んでください。

## Follow-up コメントの形式

follow-up round は同じ Issue 上で行います:

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
round: ...
-->
```

その後、state label を `handoff:needs-response` へ戻します。
