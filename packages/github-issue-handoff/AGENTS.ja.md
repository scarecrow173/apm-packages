# AGENTS.md

`packages/github-issue-handoff` を保守するエージェント向けのガイドです。

## Scope

このディレクトリは配布用の `github-issue-handoff` APM パッケージであり、
ドキュメントのみの skill パッケージです（runtime なし）。`.apm/` 配下の
配布 assets が権威です。再生成が必要なコードはありません。構造テストは
`scripts/github-issue-handoff/tests/` にあります。

## ローカライゼーション

すべての英語ドキュメントには、見出し構造が同一で意味が同期した
`.ja.md` の sibling があります。`README`、`AGENTS`、`SKILL`、すべての
`references/*`、`assets/templates/responder-prompt` が対象です。同じ変更で
両方を更新してください。

## Protocol の不変条件

skill の内容を編集するときは以下を維持してください:

- **5 つの必須 artifact** — reviewable branch、push 済み checkpoint
  commit、handoff Issue、linked Draft PR、ユーザーへ表示した展開済み
  Responder prompt。Issue だけ、PR だけの handoff は完了ではありません。
- **Issue より先に push** — local-only の handoff は不可。policy が push を
  禁止する場合は明示的に失敗させ、静かに劣化させません。
- **closing linkage** — PR 本文は `Closes` / `Fixes` / `Resolves #<n>` を
  使用。merge 後に Issue の close を検証し、auto-close が失敗した完了済み
  Issue は明示的に close します。merge されていない PR は完了した
  handoff ではありません。
- **label 契約** — `handoff` に加えて `handoff:needs-response` /
  `handoff:needs-requester` のどちらか 1 つ（排他）。残作業がすべて
  response 依存の場合のみ `handoff:blocking`。Responder に label 変更を
  必須要求しません。
- **Responder prompt** — repository-wide（open の
  `handoff:needs-response` Issue すべて対象、単一 Issue ではない）、
  responder 非依存（製品・identity・ツール要件なし）、handoff 時に展開・
  表示する。`responder-guide` は protocol の説明、`responder-prompt` は
  実行指示です。混同しないでください。
- **回答の評価** — plain な comment も有効な response。response は検証
  済みの repository 証拠より下位です。

## 検証

リポジトリルートから:

```bash
mise exec -- pnpm --dir scripts/github-issue-handoff test
mise exec -- pnpm --dir scripts/github-issue-handoff run lint:md
```

このパッケージのディレクトリから:

```bash
mise exec -- apm compile --dry-run
mise exec -- apm compile --validate
```

その後 `git diff --check` を確認してください。
