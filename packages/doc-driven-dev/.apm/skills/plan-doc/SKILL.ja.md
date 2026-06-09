---
name: plan-doc
description: 承認済みの spec または ADR を実装計画に落とし込むときに使います。スコープ分割、ファイル責務の整理、小さなタスク分解、検証、意味のある YAML relation を含む plan を作る場面に向いています。
license: MIT
---

# Plan Documentation Skill

この skill は、上流文書が実装可能な状態になった後で使います。
plan は、何をどの順序で実装するか、どの文書を実装または派生元にするか、
どの検証で実装完了とみなすかを明確にします。

## スコープ確認

spec が複数の独立したサブシステムにまたがる場合は、原則として 1 つの plan に
押し込まないでください。各サブシステムを独立に実装・検証できるなら、
plan は分割します。1 つの plan にまとめるのは、同じクリティカルパスと
同じリリース意図を共有する場合だけにします。

## ワークフロー

1. 上流の spec を全文読む。
   タイトルや記憶だけで plan を作らないでください。
2. スコープを先に確認する。
   1 つの実装ストリームとして扱えるかを見ます。サブシステムをまたぐなら、
   分割するか、分割する前提を plan に明示します。
3. 上流文書が実装可能か確認する。
   spec は `approved` を優先します。draft/proposed から作る場合は
   リスクを明示します。
4. design gate 条件を確認する。
   `docs/designs/overview.md` が存在し、overview 以外の design 文書で
   front matter `status: "approved"` が少なくとも 1 件必要です。
5. task を書く前にファイル責務を整理する。
   plan が触るファイル、モジュール、doc、または ownership boundary を列挙します。
   詳細が不明なら、プレースホルダを作らず gap として記録します。
6. 関連 ADR を確認する。
   ADR が実装アプローチを制約または情報提供する場合は参照します。
   plan に ADR は必須ではありませんが、spec と並列で作成された関連 ADR は
   認識し、取り込む必要があります。
7. plan を作成する。

   ```bash
   node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md --design docs/designs/0001-design-checkout-orchestration.md
   ```

   作成スクリプトは `references/plan-conventions.ja.md` に従い、
   `assets/templates/plan.md` を使います。スクリプトを実行できない場合は、
   `assets/templates/plan.ja.md` をコピーして手動で埋めます。

8. relation を記録する。
   生成された plan は上流 spec を `relations.implements` に、
   関連 design と ADR を `relations.derives-from` に記録します。
9. plan を実装可能な粒度にする。
   影響ファイル、挙動、テスト、移行手順、検証コマンドを具体化します。
   1 ステップは 1 つのアクションにしてください。
   プレースホルダや曖昧な指示は避けます。

design gate を満たさない場合、スクリプトは次の固定文言で失敗します。

`PLAN-DOC-GATE-001: approved design-doc is required before creating a plan. Ensure docs/designs/overview.md exists and provide at least one design doc with front matter status: "approved".`

## 実装準備マトリクス

`approved` に進める前に、すべての plan に以下のセクションを含めてください。

### ファイル表

plan で作成・変更するファイルやモジュールと、それぞれの責務を一覧化します。
責務は狭く保ち、別のエンジニアが plan の分解を再読なしで理解できる状態にします。

| Path | Responsibility | Notes |
|------|----------------|-------|
| `path/to/file.ts` | X を担当 | Y と一緒に変更 |
| `path/to/test.ts` | X を検証 | 実装より先に追加 |

ファイル一覧が不完全なら、その gap を明示してください。

### 依存グラフ

ステップ間の実行順依存を一覧化します。シンプルな表または Mermaid 図を使います。

| ステップ | 依存先 | ブロック先 |
|----------|--------|------------|
| A        | —      | B, C       |
| B        | A      | D          |

クリティカルパスと並行実行可能なステップを特定してください。

### タスク粒度

各タスクは、実装者が迷わず 1 つのアクションとして完了できる粒度にします。
テスト作成、テスト実行、実装、再実行、コミットは、別々の行動なら分けてください。

- 良い例: 「失敗するテストを書く」
- 良い例: 「対象テストを実行して失敗を確認する」
- 良い例: 「最小限のコード変更を入れる」
- 良い例: 「対象テストを再実行して成功を確認する」
- 悪い例: 「機能を実装して動作確認する」
- 悪い例: 「バリデーションと edge case を対応する」

### リスク登録簿

| # | リスク | 発生可能性 | 影響度 | 緩和策 |
|---|--------|-----------|--------|--------|
| 1 | (記述) | 低/中/高  | 低/中/高 | (対策) |

最低限、データ損失リスク、破壊的変更リスク、外部依存の可用性リスクを含めます。

### ロールバック戦略

不可逆なステップ（マイグレーション、公開 API 変更、データ変換）ごとに:

- **トリガー**: ロールバックが必要になる条件。
- **手順**: 元に戻す具体的なコマンドまたはステップ。
- **検証**: ロールバック成功を確認する方法。

### 検証マトリクス

| ステップ | 検証コマンドまたは基準 | 合格条件 |
|----------|------------------------|----------|
| A        | `npm test -- --filter=checkout` | exit 0、リグレッションなし |
| B        | 手動: UI が描画されることを確認 | スクリーンショットが spec と一致 |

各ステップに少なくとも 1 つの検証エントリが必要です。

### 自己レビュー

plan を進める前に、元の文書ともう一度照らし合わせます。

1. spec coverage: すべての spec 要求に対応するタスクがありますか。
2. placeholder scan: `TBD`、`TODO`、`implement later` などの曖昧表現を除去しましたか。
3. consistency check: ファイルパス、relation key、status 値、コマンド、用語は plan 全体で一致していますか。

### レビュー用ハンドオフ

レビュー担当がスタイルではなく実質的な gap に集中できるよう、残っている前提と
未解決の質問をまとめます。

- 意図的に gap として残した内容を列挙する。
- 実装開始前に解消が必要な依存関係を列挙する。
- plan の根拠になった上流 spec、design docs、ADR を示す。

## ステータス

Plan のステータス値: `draft`, `approved`, `in-progress`, `blocked`,
`completed`, `superseded`。

## 禁止事項

- 関係のないサブシステムを 1 つの plan に押し込まないでください。
- ファイル責務を名前なしで曖昧にしないでください。
- `TBD`、`TODO`、`implement later` のようなプレースホルダ表現は使わないでください。
- テスト作成、テスト実行、実装、検証を分けられるなら 1 つにまとめないでください。
- 不明点を隠さず、詳細を捏造せず、gap として記録してください。
- 各ステップの検証エントリを省略しないでください。
- リポジトリの plan ディレクトリ規約を確認せずに、別リポジトリの想定を流用しないでください。

## リソース

- `scripts/new_plan.js`: plan を作成し、索引を更新します。
- `references/plan-conventions.ja.md`: plan のディレクトリ、ファイル名、
  ステータス、relation、必須内容、索引の規約です。
- `assets/templates/plan.md`: 既定の plan 本文テンプレートです。
