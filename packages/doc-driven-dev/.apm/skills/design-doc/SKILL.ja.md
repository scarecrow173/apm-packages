---
name: design-doc
description: spec/ADR と plan の間で、overview を含む設計成果物を作成・更新するときに使います。
license: MIT
---

# Design Documentation Skill

この skill は、承認済み spec/ADR と実装 plan の間をつなぐ設計成果物を作る
ために使います。

## ワークフロー

1. 上流文書を確認する。
   関連する spec、ADR、discovery を先に読みます。
2. overview-first 構成を維持する。
   `docs/designs/overview.md` を全体設計の入り口にします。
3. 詳細設計文書を作成する。

   ```bash
   node scripts/new_design.js --title "Design checkout orchestration" --from docs/specs/0001-define-checkout-flow.md --from docs/adr/0003-checkout-runtime.md
   ```

4. relation を記録する。
   上流 spec/ADR/discovery は `relations.derives-from` に記録します。
5. 少なくとも 1 つの詳細設計を承認する。
   plan 作成前に、overview 以外の設計文書で front matter
   `status: "approved"` を満たします（PLAN-DOC-GATE-001）。
   この条件を満たさない限り `plan-doc` は作成できません。
   承認はユーザー（または指定レビュアー）が行います。
   エージェントが自己承認してはなりません。

## フロントマター

詳細設計文書は共通 YAML front matter を使います。

```yaml
---
id: "DESIGN-0001"
type: "design"
status: "draft"
title: "Design checkout orchestration"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
owners: []
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
  defers: []
  deferred-by: []
---
```

ステータス値: `draft`, `approved`, `superseded`, `rejected`。

## Directory Contract

- `docs/designs/overview.md`: 全体設計の入口。
- `docs/designs/0001-<slug>.md` 以降: 詳細設計。
- `docs/designs/README.md`: スクリプトが更新する索引。

閲覧順序は `overview.md` -> 詳細設計です。

## リソース

- `scripts/new_design.js`: 詳細設計文書を作成し索引を更新します。
- `references/design-conventions.ja.md`: 命名、ステータス、relation、索引の規約。
- `assets/templates/design.ja.md`: 詳細設計の既定テンプレート。

## Graph Effect Outcome

`doc-driven-dev-graph` からこの skill が呼び出された場合、audit または delegate effect
ごとに次の footer を返します。prose による完了主張ではなく canonical evidence を使います。

```yaml
status: completed | retry | yield
evidence: <canonical Markdown path or ID>
```

approved design には `completed`、designated reviewer を待つ場合は `approval-required`
を理由とする `yield`、upstream user decision がない場合は `input-required` を理由とする
`yield` を使います。必須の `edgeId`、stage、effect identity、authoritative input scope、
proof field は
[`execution-outcome-contract.ja.md`](../doc-driven-dev-graph/references/execution-outcome-contract.ja.md)
で定義します。
