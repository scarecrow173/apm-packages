# Doc-Driven Dev APM Package

このパッケージは、spec-driven / document-driven development のための
再利用可能な skill 群を提供します。生成されるドキュメントは YAML
フロントマター + Markdown 形式で、ライフサイクルステータス、外部出典、
ADR / spec / plan / task 間の意味付き relation を管理できます。

`adr-doc` をアーキテクチャ判断の中核 workflow として維持し、
idea refinement と brainstorming から始まるドキュメントライフサイクルを
提供します。

- `idea-refine`: 粗いアイデアを選択肢、前提、質問に整理します。
- `brainstorming`: 意図を明確にし、ADR、spec、plan、task にルーティングします。
- `spec-doc`: 実装前に何を作るかを定義します。
- `plan-doc`: 承認済み spec または ADR を実装計画に変換します。
- `task-doc`: 実装単位と依存関係を管理します。
- `doc-status`: ステータス、索引、relation を一覧・監査します。

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
`docs/discovery/` に artifact を作成し、ADR、spec、plan、task への
document routing 判断を記録します。

### `adr-doc`

MADR 4.0.0 ADR を扱うときにこの skill を使います。

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

### `plan-doc`

`docs/plans/` に実装計画を作成します。上流の spec または ADR を
`relations.implements` と `relations.derives-from` でリンクします。

### `task-doc`

`docs/tasks/` に実装 task を作成します。plan を `relations.implements` と
`relations.depends-on` でリンクし、task 用のステータスで進捗を管理します。

### `doc-status`

生成されたドキュメントを一覧・監査します。必須フロントマター、
ステータス値、ローカル relation、索引を検証し、`relations.source` の
外部 URL は出典として許可します。

## 共通 Relation

新しく生成される spec、plan、task は意味付き relation を使います。

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
idea-refine
  -> brainstorming
  -> ADR / spec routing
  -> plan-doc
  -> task-doc
  -> implementation
  -> doc-status
```

ADR は、代替案や長期的影響を持つ技術判断が必要なときに推奨します。
Spec は、何を作るべきか、なぜ必要か、誰のためか、範囲、実装向けの挙動、
受け入れ基準を明確にする必要があるときに推奨します。
