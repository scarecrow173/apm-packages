---
name: plan-doc
description: 承認済み spec または ADR を、意味付き YAML relation を持つ実装計画に変換するときに使います。
license: MIT
---

# Plan Documentation Skill

この skill は、spec が実装可能な状態になった後で使います。
plan は、何をどの順序で実装するか、どの文書を実装または派生元にするか、
どの検証で実装完了とみなすかを明確にします。

このパッケージのライフサイクルでは、典型的な上流パスは:
**spec + ADR（並列）→ plan** です。Plan は spec と並列で作成された
ADR の両方から派生します。

## ワークフロー

1. 上流の spec を全文読む。
   タイトルや記憶だけで plan を作らないでください。
2. 上流文書が実装可能か確認する。
   spec は `approved` を優先します。draft/proposed から
   作る場合はリスクを明示します。
3. 関連 ADR を確認する。
   ADR が実装アプローチを制約または情報提供する場合は参照します。
   plan に ADR は必須ではありませんが、spec と並列で作成された
   関連 ADR は認識し、取り込む必要があります。
4. plan を作成する。

   ```bash
   node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md
   ```

   作成スクリプトは `references/plan-conventions.ja.md` に従い、
   `assets/templates/plan.md` を使います。スクリプトを実行できない場合は、
   このテンプレートをコピーして手動で埋めます。

4. relation を記録する。
   生成された plan は上流 spec を `relations.implements` に、
   関連 ADR を `relations.derives-from` に記録します。
5. plan を実装可能な粒度にする。
   影響ファイル、挙動、テスト、移行手順、検証コマンドを具体化します。

## 実装準備マトリクス

`approved` に進める前に、すべての plan に以下のセクションを含めてください。

### 依存グラフ

ステップ間の実行順依存を一覧化します。シンプルな表または Mermaid 図を使います。

| ステップ | 依存先 | ブロック先 |
|----------|--------|------------|
| A        | —      | B, C       |
| B        | A      | D          |

クリティカルパスと並行実行可能なステップを特定してください。

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

## ステータス

Plan のステータス値: `draft`, `approved`, `in-progress`, `blocked`,
`completed`, `superseded`。

## リソース

- `scripts/new_plan.js`: plan を作成し、索引を更新します。
- `references/plan-conventions.ja.md`: plan のディレクトリ、ファイル名、
  ステータス、relation、必須内容、索引の規約です。
- `assets/templates/plan.md`: 既定の plan 本文テンプレートです。
- `assets/templates/plan.ja.md`: 日本語で手動作成するときの plan 本文テンプレートです。
