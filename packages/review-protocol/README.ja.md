# review-protocol

`review-protocol` は同名の skill を 1 つ含む APM パッケージです。
spec・design・plan・implementation・code・document といった artifact の
review を、際限のない comment loop ではなく、境界付き・evidence 駆動の
process に変えます。

## インストール

このリポジトリを marketplace として登録し、名前でインストールします:

```bash
apm marketplace add scarecrow173/apm-packages
apm install review-protocol@apm-packages
```

または monorepo のサブディレクトリを version selector 付きで直接参照します:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages/packages/review-protocol#main
```

配布される skill は `.apm/skills/review-protocol/` 配下にあります。

## 仕組み

1. **評価基準を確定する** — purpose、must requirements、constraints、
   assumptions、許容できない失敗、scope。不明確な基準は risk となり、
   理想を捏造しません。
2. **客観的チェックを先に実行する** — 主観的な review の前に build、
   type check、lint、test、schema validation、diff review を行います。
3. **独立した reviewer を 2 人並列に派遣する** — Reviewer A は
   artifact が目的に対して necessary かつ sufficient かを確認し、
   Reviewer B は failure mode を探索します。review 途中で互いの
   findings を見ることはありません。
4. **findings は Issue Candidate** — 各 candidate は Claim、Location、
   Failure Scenario、Impact、Evidence、Proposed Severity、Validation
   Method を持ちます。主張だけでは何も変更されません。
5. **Validator** — 別の role が各 candidate を、利用可能な最も客観的
   な方法で `CONFIRMED`、`REJECTED`、`UNVERIFIED` に検証します。
6. **Judge** — 別の role が false positive を落とし、root cause で
   dedupe し、severity を割り当て、blocking を決定します。
7. **CONFIRMED な P0/P1 のみ修正する** — 確定した root cause に scope
   を限定します。P2/P3 は報告するだけで反復しません。
8. **停止する** — acceptance criteria が成立し、confirmed な blocking
   issue が残っていないとき。完全な re-review は最大 2 サイクルで、
   その後は人間へ escalate します。

## Roles

| Role | 責務 |
| --- | --- |
| Coordinator | protocol を実行する。artifact を保持する agent。 |
| Reviewer A | Cooperative review — purpose への適合、sufficiency、consistency。 |
| Reviewer B | Adversarial review — edge case、failure mode、隠れた assumption。 |
| Validator | Issue Candidate を証拠に照らして検証する。 |
| Judge | 検証済みの結果を統合し、severity と blocking を決定する。 |

## Severity

| Level | 意味 | Blocking |
| --- | --- | --- |
| P0 | 受け入れると重大で回復困難な失敗になる | Yes |
| P1 | artifact の目的を実質的に妨げる | Yes |
| P2 | 限定的な問題または non-blocking な改善 | No |
| P3 | style、好み、任意の cleanup | No |

## 最終 verdict

`ACCEPT`、`ACCEPT WITH NON-BLOCKING NOTES`、`BLOCKED` のいずれかです。
いずれかの `ACCEPT` verdict に到達すれば review は終了し、`BLOCKED`
は人間へ escalate します。

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
