# AGENTS.ja.md

このファイルは、`packages/doc-driven-dev` を変更する AI エージェント向けの実務ガイドです。

## 1. 目的と前提

- このパッケージは document-driven development を支える Skill 集です。
- 主な対象は `briefing -> ADR/spec -> design -> plan -> task -> 実装 -> 監査` の流れです。
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
|--------|------|------|
| briefing-flow | メタスキル: briefing と spec/ADR 準備を動的にオーケストレーションする | original |
| doc-driven-dev-flow | メタスキル: 6 フェーズの文書ライフサイクル全体をオーケストレーションする | original |
| implementation-flow | メタスキル: implementation profile を通じて全利用可能な実装スキルを発見・ルーティングする | original |
| skill-discovery-protocol | flow-neutral な skill catalog / profile を生成・検証する | original |

## 8. 非目標

- 無関係な大規模リファクタ。
- このパッケージ自身の変更作業に対して、ADR/spec/plan/task の作成や relation 管理を必須化すること。
- 既存 index や relation の整合性を壊す変更。
