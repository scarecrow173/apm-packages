# AGENTS.ja.md

このファイルは、`packages/doc-driven-dev` を変更する AI エージェント向けの実務ガイドです。

## 1. 目的と前提

- このパッケージは document-driven development を支える Skill 集です。
- 主な対象は `idea -> brainstorming -> ADR/spec -> plan -> task -> 実装 -> 監査` の流れです。
- 生成ドキュメントは YAML front matter + Markdown を前提にします。
- このガイドはパッケージ開発ルールを定義するものであり、パッケージ自身に doc-driven-dev 運用を必須化するものではありません。

## 2. リポジトリ内の責務分離

- 実装ロジックの編集先:
  - `src/skills/**/scripts/*.ts`
  - `src/skills/**/scripts/lib/*.ts`
  - `src/skills/lib/*.ts`
- 配布用 Skill 定義・テンプレート・参照資料の編集先:
  - `.apm/skills/**/SKILL.md`
  - `.apm/skills/**/references/**`
  - `.apm/skills/**/assets/templates/**`
- ビルド成果物（JS）:
  - `.apm/skills/**/scripts/*.js`
  - これは `pnpm run build:scripts` で `src` から生成される。

重要:

- スクリプト挙動を変えるときは `src` を編集する。
- `build:scripts` は `.apm/skills/**/scripts` 配下の既存 `.js` を掃除して再生成する。
- `SKILL.md` や `references`、`assets/templates` は現在 `src` から自動生成されないため、必要箇所を直接更新する。

## 3. 作業フロー（パッケージ開発）

1. 既存文書と実装を先に読む。
2. 変更対象がスクリプト挙動なら `src` を編集し、必要に応じて `.apm` 配下の参照資料やテンプレートも更新する。
3. `src` を変更した場合は `pnpm run build:scripts` を実行して配布用 `.js` を再生成する。
4. 変更後は `pnpm test` と `pnpm run lint:md` を実行し、結果を報告する。
5. 仕様互換性に影響する変更では、想定影響と移行方針を明記する。

## 4. 代表コマンド

パッケージルートで実行:

```bash
pnpm run build:scripts
pnpm test
pnpm run lint:md
```

必要に応じて:

```bash
apm compile --dry-run
apm compile --validate
```

補足:

- このパッケージでは環境により `apm compile --validate` が `.apm` 構成検出で失敗することがある。
- そのため回帰確認の主軸は `pnpm test` を優先する。

## 5. スクリプト利用の注意

- `doc-status` 系 (`list_docs`, `audit_docs`) は基本 report-only。
- `adr-doc` の `update_index` と `relate_adr` は既定 dry-run。実書き込みには `--write` が必要。
- 破壊的変更を避け、まず dry-run / JSON 出力で確認してから反映する。

## 6. 変更時チェックリスト

- 変更意図に対応する Skill ドキュメントを更新したか。
- `src` を変えた場合、`.apm/skills/**/scripts/*.js` を再生成したか。
- テスト (`pnpm test`) が通るか。
- Markdown 変更時は `pnpm run lint:md` を確認したか。

## 7. ワークフロースキル（実装フェーズ）

文書生成スキル（スクリプト・テンプレート・参照付き）に加え、このパッケージには実装フェーズ向けの**ワークフロースキル**が含まれます。これらは TypeScript ソースやコンパイル済みスクリプトを持たない、純粋な Markdown ガイダンススキルです。

- ワークフロースキルは `.apm/skills/<name>/` にのみ配置（対応する `src/skills/<name>/` は不要）。
- `references/` や `assets/templates/` サブディレクトリに補助ドキュメントやプロンプトテンプレートを含む場合がある。
- `pnpm run build:scripts` の対象外。
- 編集時は `.apm/skills/<name>/SKILL.md`（および `.ja.md`）を直接更新する。

含まれるワークフロースキル:

| スキル | 目的 | 出典 |
|--------|------|------|
| implementation-flow | メタスキル: implementation-profile.md を通じて全利用可能スキルを発見・ルーティングする動的オーケストレーター | original |
| source-driven-development | 公式ドキュメントに基づく実装 | addyosmani/agent-skills (MIT) |
| incremental-implementation | 薄い垂直スライスでの漸進的実装 | addyosmani/agent-skills (MIT) |
| doubt-driven-development | 敵対的フレッシュコンテキストレビュー | addyosmani/agent-skills (MIT) |
| test-driven-development | RED-GREEN-REFACTOR サイクル | obra/superpowers (MIT) |
| systematic-debugging | 4フェーズ根本原因プロセス | obra/superpowers (MIT) |
| subagent-driven-development | 2段階レビュー付きタスクディスパッチ | obra/superpowers (MIT) |
| dispatching-parallel-agents | 独立タスクの並行サブエージェント | obra/superpowers (MIT) |
| requesting-code-review | レビュー依頼チェックリスト | obra/superpowers (MIT) |
| receiving-code-review | レビューフィードバック受領プロセス | obra/superpowers (MIT) |

## 8. 非目標

- 無関係な大規模リファクタ。
- このパッケージ自身の変更作業に対して、ADR/spec/plan/task の作成や relation 管理を必須化すること。
- 既存 index や relation の整合性を壊す変更。
