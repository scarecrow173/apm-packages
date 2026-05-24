---
name: plan-doc
description: 承認済み spec または ADR を、意味付き YAML relation を持つ実装計画に変換するときに使います。
license: MIT
---

# Plan Documentation Skill

この skill は、spec または ADR が実装可能な状態になった後で使います。
plan は、何をどの順序で実装するか、どの文書を実装または派生元にするか、
どの検証で実装完了とみなすかを明確にします。

## ワークフロー

1. 上流の spec または ADR を全文読む。
   タイトルや記憶だけで plan を作らないでください。
2. 上流文書が実装可能か確認する。
   spec は `approved`、ADR は `accepted` を優先します。draft/proposed から
   作る場合はリスクを明示します。
3. plan を作成する。

   ```bash
   node scripts/new_plan.js --title "Implement checkout flow" --implements docs/specs/0001-define-checkout-flow.md
   ```

   作成スクリプトは `references/plan-conventions.ja.md` に従い、
   `assets/templates/plan.md` を使います。スクリプトを実行できない場合は、
   このテンプレートをコピーして手動で埋めます。

4. relation を記録する。
   生成された plan は上流文書を `relations.implements` と
   `relations.derives-from` に記録します。
5. plan を実装可能な粒度にする。
   影響ファイル、挙動、テスト、移行手順、検証コマンドを具体化します。

## ステータス

Plan のステータス値: `draft`, `approved`, `in-progress`, `blocked`,
`completed`, `superseded`。

## リソース

- `scripts/new_plan.js`: plan を作成し、索引を更新します。
- `references/plan-conventions.ja.md`: plan のディレクトリ、ファイル名、
  ステータス、relation、必須内容、索引の規約です。
- `assets/templates/plan.md`: 既定の plan 本文テンプレートです。
- `assets/templates/plan.ja.md`: 日本語で手動作成するときの plan 本文テンプレートです。
