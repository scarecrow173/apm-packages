# AGENTS.ja.md

このファイルは、`packages/doc-driven-dev` を変更する AI エージェント向けの実務ガイドです。

## 1. 目的と前提

- このパッケージは document-driven development を支える Skill 集です。
- 主な対象は `idea-doc（任意）-> briefing -> discovery-doc（任意）-> ADR/spec -> design -> plan -> task -> 実装 -> 監査` の流れです。
- 生成ドキュメントは YAML front matter + Markdown を前提にします。
- このガイドはパッケージ開発ルールを定義するものであり、パッケージ自身に doc-driven-dev 運用を必須化するものではありません。

## 2. リポジトリ内の責務分離

この文書中のパスは、明記しない限りリポジトリルート基準です。

- 実装ロジックの編集先（隔離された build workspace）:
  - `scripts/doc-driven-dev/src/skills/**/scripts/*.ts`
  - `scripts/doc-driven-dev/src/skills/**/scripts/lib/*.ts`
  - `scripts/doc-driven-dev/src/skills/lib/*.ts`
- 配布用 Skill 定義・テンプレート・参照資料の編集先:
  - `packages/doc-driven-dev/.apm/skills/**/SKILL.md`
  - `packages/doc-driven-dev/.apm/skills/**/references/**`
  - `packages/doc-driven-dev/.apm/skills/**/assets/templates/**`
- ビルド成果物（JS）:
  - `packages/doc-driven-dev/.apm/skills/**/scripts/*.js`
  - これは `pnpm --dir scripts/doc-driven-dev run build:scripts` で `scripts/doc-driven-dev/src` から生成される。

重要:

- スクリプト挙動を変えるときは `scripts/doc-driven-dev/src` を編集する。
- `build:scripts` は `packages/doc-driven-dev/.apm/skills/**/scripts` 配下の既存 `.js` を掃除して再生成する。
- `SKILL.md` や `references`、`assets/templates` は現在 scripts workspace から自動生成されないため、必要箇所を直接更新する。
- `skill-discovery-protocol` は `.sdp` 成果物の生成時に `.agents/skills`
  や `apm_modules` のような local skill root を走査する。
- environment-provided skill は bundle 済み package content ではなくても
  routing に影響し得るため、adapter が `steer-web-research` のような
  non-bundled skill を参照する場合は optional external routing を文書化する。

## 3. 作業フロー（パッケージ開発）

1. 既存文書と実装を先に読む。
2. 変更対象がスクリプト挙動なら `scripts/doc-driven-dev/src` を編集し、必要に応じて `packages/doc-driven-dev/.apm` 配下の参照資料やテンプレートも更新する。
3. `scripts/doc-driven-dev/src` を変更した場合は `pnpm --dir scripts/doc-driven-dev run build:scripts` を実行して `packages/doc-driven-dev/.apm/skills/**/scripts/*.js` を再生成する。
4. 変更後は `pnpm --dir scripts/doc-driven-dev test` と `pnpm --dir scripts/doc-driven-dev run lint:md` を実行し、結果を報告する。
5. 仕様互換性に影響する変更では、想定影響と移行方針を明記する。

## 4. 代表コマンド

リポジトリルートから scripts workspace を対象に実行:

```bash
pnpm --dir scripts/doc-driven-dev run build:scripts
pnpm --dir scripts/doc-driven-dev test
pnpm --dir scripts/doc-driven-dev run lint:md
```

必要に応じて、次は `packages/doc-driven-dev/` で実行:

```bash
apm compile --dry-run
apm compile --validate
```

補足:

- このパッケージでは環境により `apm compile --validate` が `.apm` 構成検出で失敗することがある。
- そのため回帰確認の主軸は `pnpm --dir scripts/doc-driven-dev test` を優先する。

## 5. スクリプト利用の注意

- `doc-status` 系 (`list_docs`, `audit_docs`) は基本 report-only。
- `adr-doc` の `update_index` と `relate_adr` は既定 dry-run。実書き込みには `--write` が必要。
- 破壊的変更を避け、まず dry-run / JSON 出力で確認してから反映する。
- document 作成コマンドは、明示的に dry-run または report-only と書かれて
  いない限り即時にファイルを書き込む。
- `--dir`、`--file`、`--out` のような path flag は、生成物や更新対象の
  書き込み先を変える。
- `pnpm --dir scripts/doc-driven-dev run build:scripts` は
  `packages/doc-driven-dev/.apm/skills/**/scripts/*.js` 配下の配布用
  JavaScript 出力を置き換える。

## 6. 変更時チェックリスト

- 変更意図に対応する Skill ドキュメントを更新したか。
- `scripts/doc-driven-dev/src` を変えた場合、`packages/doc-driven-dev/.apm/skills/**/scripts/*.js` を再生成したか。
- テスト (`pnpm --dir scripts/doc-driven-dev test`) が通るか。
- Markdown 変更時は `pnpm --dir scripts/doc-driven-dev run lint:md` を確認したか。

## 7. ワークフロースキル（実装フェーズ）

文書生成スキル（スクリプト・テンプレート・参照付き）に加え、このパッケージには実装フェーズ向けの**ワークフロースキル**が含まれます。これらは TypeScript ソースやコンパイル済みスクリプトを持たない、純粋な Markdown ガイダンススキルです。

- ワークフロースキルは `packages/doc-driven-dev/.apm/skills/<name>/` にのみ配置（対応する `scripts/doc-driven-dev/src/skills/<name>/` は不要）。
  - 将来コードを持つ場合でも、実装は `packages/doc-driven-dev/` 直下ではなく `scripts/doc-driven-dev/src` 側に置く。
- `references/` や `assets/templates/` サブディレクトリに補助ドキュメントやプロンプトテンプレートを含む場合がある。
- `pnpm --dir scripts/doc-driven-dev run build:scripts` の対象外。
- 編集時は `packages/doc-driven-dev/.apm/skills/<name>/SKILL.md`（および `.ja.md`）を直接更新する。

ここに含まれる workflow / meta skill:

| スキル | 目的 | 出典 |
| --- | --- | --- |
| doc-driven-dev-lifecycle | メタスキル: 6 フェーズの文書ライフサイクル全体をオーケストレーションする | original |
| briefing-flow | メタスキル: briefing と spec/ADR 準備を動的にオーケストレーションする | original |
| implementation-flow | メタスキル: implementation profile を通じて全利用可能な実装スキルを発見・ルーティングする | original |
| skill-discovery-protocol | flow-neutral な skill catalog / profile を生成・検証する | original |

## 8. メタスキル活性化ルール

このパッケージは、document-driven development の異なるフェーズをオーケストレーションする 3 つのメタスキルを含みます。未定義な動作を避けるため、ユーザーリクエストごとに正確に **1 つ** のメタスキルが活動状態にある必要があります。

### 活性化マトリックス

| メタスキル | 入力トリガー条件 | 責務 | 相互排斥 |
| --- | --- | --- | --- |
| `doc-driven-dev-lifecycle` | ユーザーが 6 フェーズ全体を明示的に呼び出した OR 他のエントリポイントが合致しない | Phase 1-6 統括・委譲（Phase 1 は briefing-flow へ、Phase 5+ は implementation-flow へ） | `briefing-flow` が既に活動中の場合は活性化しない OR Phase 5+ が明示的ターゲットの場合は活性化しない（→ implementation-flow のみ） |
| `briefing-flow` | ユーザーが briefing/discovery/spec/ADR 作成を明示的に呼び出した OR lifecycle が Phase 1 を委譲 | Phase A-D の discovery・spec + ADR 並行配信・skill stack 組み立て | `doc-driven-dev-lifecycle` が既に Phase 2-6 を駆動中の場合は活性化しない OR コード実装を明示的ターゲットの場合は活性化しない（→ implementation-flow のみ） |
| `implementation-flow` | ユーザーがタスク実行/コード実装を明示的に呼び出した OR lifecycle が Phase 5 を委譲 | Phase A-E のタスク実行・review gate 強制・利用可能な実装スキルの発見・ルーティング | 文書作成がターゲットの場合は活性化しない（→ lifecycle または briefing-flow） OR briefing/design 進行中の場合は活性化しない |

### 配信判定ツリー

```text
エントリリクエスト
├─ "lifecycle" または "6-phase" または "end-to-end" キーワードを含む？
│  └─ YES → doc-driven-dev-lifecycle
│
├─ "briefing" または "discovery" または "spec" または "adr" キーワードを含む？
│  └─ YES → briefing-flow
│
├─ "implement" または "code" または "execute" または "task" キーワードを含む？
│  └─ YES → implementation-flow
│
└─ 明確なメタスキルシグナルなし → リクエストコンテキストを相談
   ├─ spec/ADR 作成中 → briefing-flow
   ├─ 設計が承認済み、planning/task フェーズ中 → lifecycle または implementation-flow（コンテキスト依存）
   └─ 不明 → ユーザーに説明請求
```

### 保証

1. **単一活動メタスキル**: ユーザー向けリクエストごとに、アクティブなメタスキルは最大 1 つ。メタスキル間の委譲は明示的フェーズゲートで制御され、並行活性化は起きない。
2. **クロス活性化ループなし**: `lifecycle` が `briefing-flow`（Phase 1）に委譲する場合、`briefing-flow` はユーザーが新たに明示的に呼び出さない限り、`lifecycle` や `implementation-flow` を同時に活性化しない。
3. **フェーズ境界強制**: フェーズゲートが満たされたら、次のメタスキルは明示的ユーザー要求または文書化された委譲でのみ活性化。単独で起動してはいけない。

### テスト

統合テストは以下を検証:

- 活性化競合の検出（2 つのメタスキルが同じリクエストで競争）
- Review gate 名の正規化（Phase E の `requesting-code-review` 名は canonical）
- 委譲境界の遵守（Phase 1 完了前 Phase 2 活性化禁止）

参照: `scripts/doc-driven-dev/tests/integration/activation-conflict-detector.test.ts` および `review-gate-contract.test.ts`

## 9. 非目標

- 無関係な大規模リファクタ。
- このパッケージ自身の変更作業に対して、ADR/spec/plan/task の作成や relation 管理を必須化すること。
- 既存 index や relation の整合性を壊す変更。
