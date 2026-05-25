# Doc-Driven Dev APM Package

このパッケージは、spec-driven / document-driven development のための
再利用可能な skill 群を提供します。生成されるドキュメントは YAML
フロントマター + Markdown 形式で、ライフサイクルステータス、外部出典、
spec / ADR / design / plan / task 間の意味付き relation を管理できます。

spec と ADR を同じ discovery output から並列作成する dual-track モデルを
採用しています。

- `idea-refine`: 粗いアイデアを選択肢、前提、質問に整理します。
- `brainstorming`: 意図を明確にし、spec + ADR（並列）にルーティングします。
- `spec-doc`: 実装前に何を作るかを定義します。
- `adr-doc`: すべての技術判断を Architecture Decision Records として記録します。
- `design-doc`: plan 前に overview-first の設計成果物を作成します。
- `plan-doc`: 承認済み spec + ADR + design を実装計画に変換します。
- `task-doc`: 実装単位と依存関係を管理します。
- `doc-status`: ステータス、索引、relation を一覧・監査します。

## 定義

### doc-driven-dev mainline

すべての作業が従うドキュメントフロー:

```
idea-refine OR brainstorming
  → spec-doc + adr-doc   (並列: 同じ discovery output から作成)
  → design-doc           (overview + 詳細設計)
  → plan-doc             (spec / ADR / 承認済み design から派生)
  → task-doc
```

- **Spec** は WHAT、WHY、SCOPE に答えます。
- **ADR** は HOW に答え、すべての技術判断を代替案と根拠付きで記録します。
- **並列作成**: brainstorming が十分なコンテキストを生んだら、spec と ADR
  は異なる側面を扱うため同時に書けます。
- **plan 前に design gate**: `plan-doc` は承認済み `design-doc` を必須とし、
  spec の要件と ADR の技術制約を取り込みます。

mainline 上の skill: `idea-refine`, `brainstorming`, `spec-doc`, `adr-doc`,
`design-doc`, `plan-doc`, `task-doc`。

### doc-driven-dev parallel track

spec と ADR は**並列トラック**を形成します。同じ上流 discovery artifact
から派生し、補完的な関心事を扱います。

| | spec-doc | adr-doc |
|---|---------|--------|
| 答えるもの | What / Why / Scope | How / Which / Why-this-over-that |
| トリガー | あらゆる feature や変更 | 代替案のある技術判断 |
| ブロッキング | plan には approved spec が必要 | plan は accepted ADR を参照 |
| 出力 | 受け入れ基準 | 実装制約 |

- brainstorming がプロダクト要件と技術判断の両方を明らかにしたら、
  spec と ADR を並列で書きます。
- 純粋なプロダクト作業（architecture 判断なし）なら spec のみで十分です。
- 純粋に横断的な判断（単一 feature に紐づかない）なら ADR のみで十分です。
- 自明に見える判断も含め、すべての意思決定を ADR に記録し、
  将来のエージェントが根拠を理解できるようにします。

## インストール

この monorepo から:

```bash
apm install ./packages/doc-driven-dev-apm --target codex
```

公開後に利用側リポジトリから:

```bash
apm install scarecrow173/apm-packages#v0.1.0
```

## 検証

```bash
apm compile --validate
apm compile --dry-run
tsx --test tests/*.test.ts
```

## 同梱 Skill

### `idea-refine`

作業が粗い構想、機会、困りごと、解決案から始まるときに使います。
`docs/ideas/` に artifact を作成し、生のアイデア、問題の兆候、選択肢、
前提、次の質問を記録します。

### `brainstorming`

後続文書を書く前に、対話で意図を明確にするために使います。
`docs/discovery/` に artifact を作成し、`spec-doc` + `adr-doc` へ
並列でルーティングします。

### `adr-doc`

MADR 4.0.0 ADR を扱うときにこの skill を使います。すべての技術判断は
ADR として記録され、spec と同じ discovery output から並列で作成されます。

- MADR テンプレートから新しい ADR を作成する
- コーディングエージェント向けの実装計画と検証基準を書く
- ADR 一覧を出し、エージェント対応状況をレビューする
- ADR の構造と索引整合性を監査する
- Implementation Plan のコードリンクと ADR relation を確認・管理する
- ADR 索引を再生成する
- ファイルを変更せずに移行レポートを作成する

### `spec-doc`

`docs/specs/` に YAML フロントマター付き spec を作成します。実装計画に
入る前に、意図、範囲、要件、受け入れ基準、出典を記録します。

### `design-doc`

`docs/designs/` に設計成果物を作成します。必須の `overview.md` と
詳細設計文書を管理し、`plan-doc` の hard gate として機能します。

### `plan-doc`

`docs/plans/` に実装計画を作成します。上流の spec を
`relations.implements` で、design / ADR を `relations.derives-from` で
リンクします。

### `task-doc`

`docs/tasks/` に実装 task を作成します。plan を `relations.implements` と
`relations.depends-on` でリンクし、task 用のステータスで進捗を管理します。

### `doc-status`

生成されたドキュメントを一覧・監査します。必須フロントマター、
ステータス値、ローカル relation、索引を検証し、`relations.source` の
外部 URL は出典として許可します。

## 共通 Relation

新しく生成される spec、design、plan、task は意味付き relation を使います。

```yaml
relations:
  source: []
  implements: []
  implemented-by: []
  depends-on: []
  blocks: []
  supersedes: []
  superseded-by: []
  related: []
  refines: []
  refined-by: []
  derives-from: []
  derived-by: []
  verifies: []
  verified-by: []
  references: []
```

`source` は外部出典や一次情報に使います。`references` は補助資料に使います。
その他のフィールドは、リンク先ドキュメントの種別ではなく、内部文書間の
関係の意味を表します。

## 推奨ライフサイクル

```text
idea-refine OR brainstorming
  -> spec-doc + adr-doc  (並列: 何を定義 + 判断を記録)
  -> design-doc          (overview-first の設計ゲート)
  -> plan-doc            (spec / ADR / 承認済み design から派生)
  -> task-doc            (実行単位)
  -> implementation
  -> doc-status
```

dual-track モデル: **spec + ADR（並列）→ design → plan → task**。
Spec は何を作るべきか、なぜ、範囲、受け入れ基準を定義します。
ADR はすべての技術判断を代替案と根拠付きで記録します。
brainstorming が十分なコンテキストを生んだら、両方を並列で書きます。
Design が plan への橋渡しを行います。
