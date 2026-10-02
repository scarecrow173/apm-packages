# AGENTS.md

`packages/review-protocol` を保守するエージェント向けのガイドです。

## Scope

このディレクトリは配布用の `review-protocol` APM パッケージであり、
ドキュメントのみの skill パッケージです（runtime なし）。`.apm/`
配下の配布 assets が権威です。再生成が必要なコードはありません。
構造テストは `scripts/review-protocol/tests/` にあります。

## ローカライゼーション

すべての英語ドキュメントには、見出し構造が同一で意味が同期した
`.ja.md` の sibling があります。`README`、`AGENTS`、`SKILL`、すべての
`references/*` が対象です。同じ変更で両方を更新してください。

## Protocol の不変条件

skill の内容を編集するときは以下を維持してください:

- **Evidence gate** — reviewer の出力は Issue Candidate のみ。
  artifact は主張だけで変更されません。修正を許可するのは
  Validator の `CONFIRMED` verdict のみです。
- **Role separation** — 少なくとも 2 人の独立した reviewer（A は
  cooperative、B は adversarial）を並列に配置し、exploration 完了まで
  cross-talk させません。Validator と Judge は別の role であり、
  独自に review を開始しません。
- **Issue Candidate 契約** — すべての candidate は Claim、Location、
  Failure Scenario、Impact、Evidence、Proposed Severity、Validation
  Method を持ちます。具体的な Failure Scenario のない candidate は
  issue ではありません。
- **Severity 契約** — P0/P1 は blocking、P2/P3 は non-blocking。
  severity は実際の影響で決定し、reviewer の確信度では決定しません。
- **Bounded iteration** — 自動修正は CONFIRMED な P0/P1 のみで、
  確定した root cause に scope を限定します。完全な re-review は
  最大 2 サイクルで、その後は人間へ escalate します。
- **停止条件** — 完了とは acceptance criteria の成立 + 客観的
  チェックの合格 + 未解決の CONFIRMED な P0/P1 がないこと。残った
  P2/P3 は決して block しません。
- **Verdict 契約** — 最終 verdict は `ACCEPT`、
  `ACCEPT WITH NON-BLOCKING NOTES`、`BLOCKED` のいずれか 1 つです。
- **Harness neutrality** — skill は特定の製品、runtime、subagent
  mechanism を要求せず、AI 製品名を挙げません。

## 検証

リポジトリルートから:

```bash
mise exec -- pnpm --dir scripts/review-protocol test
mise exec -- pnpm --dir scripts/review-protocol run lint:md
```

このパッケージのディレクトリから:

```bash
mise exec -- apm compile --dry-run
mise exec -- apm compile --validate
```

その後 `git diff --check` を確認してください。
