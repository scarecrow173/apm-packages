---
name: task-doc
description: plan、spec、ADR、他 task にリンクした実装単位を YAML フロントマター + Markdown で管理するときに使います。
license: MIT
---

# Task Documentation Skill

この skill は、実装とレビューが可能な小さな作業単位を管理するために使います。
task は、それが実装する plan、spec、ADR にリンクし、完了条件を具体的に
書く必要があります。

## 前提条件

<HARD-GATE>
task を作成するには、以下のいずれかを満たす必要がある:

1. **通常パス**: 参照する plan の `status` が `approved` 以上であること。
   `draft` の plan から task を派生させてはならない。
   plan が未承認の場合は、先に plan のレビューと承認を完了すること。
2. **緊急修正パス**: plan が存在しない場合、以下をすべて満たすこと:
   - 緊急性の理由を task 本文に 1 行記載する。
   - `relations.implements` または `relations.derives-from` で
     `approved` な spec-doc または adr-doc を参照する。
   - 参照する spec/ADR も存在しない場合は、先に spec-doc または
     adr-doc を作成すること（簡潔でも可）。

どちらのパスも満たさない場合、task を作成してはならない。
</HARD-GATE>

## ワークフロー

1. 参照する plan の `status` が `approved` であることを確認する。
   plan が存在しない緊急修正の場合は、上記前提条件の緊急修正パスを
   満たしていることを確認する。
2. ひとまとまりの実装単位として task を作成する。

   ```bash
   node scripts/new_task.js --title "Wire checkout button" --plan docs/plans/0001-implement-checkout-flow.md
   ```

   作成スクリプトは `references/task-conventions.ja.md` に従い、
   `assets/templates/task.md` を使います。スクリプトを実行できない場合は、
   このテンプレートをコピーして手動で埋めます。

3. 意味付き relation を使う。
   生成された task は plan を `relations.implements` と
   `relations.depends-on` に記録します。
4. ステータスを更新する。
   `todo`, `in-progress`, `blocked`, `done`, `wont-do` を使います。
5. task は小さく保つ。
   無関係なファイル、挙動、検証経路が混ざる場合は分割します。

## 完了条件の要件

すべての task に `## 検証` セクションを含め、少なくとも 1 つの
機械検証可能なコマンドを記載してください。人手のみの確認は補足として
許容されますが、唯一の検証手段にしてはいけません。

**必須フォーマット:**

```markdown
## 検証

- [ ] `npm test -- --filter=checkout-button` が exit 0
- [ ] `grep -r 'CheckoutButton' src/components/` がマッチを返す
- [ ] 手動: Storybook でボタンが描画される（補足のみ）
```

**ルール:**

1. 少なくとも 1 項目は、期待される終了コードまたは出力パターン付きの
   実行可能コマンドであること。
2. コマンドは修正なしにコピーペーストで実行できること（プレースホルダー禁止）。
3. 自動チェックが不可能な場合は理由を文書化し、自動化の
   フォローアップ task を追加する。

すべての検証コマンドがパスするまで、task を `done` に移動できません。

## リソース

- `scripts/new_task.js`: task を作成し、索引を更新します。
- `references/task-conventions.ja.md`: task のディレクトリ、ファイル名、
  ステータス、relation、必須内容、索引の規約です。
- `assets/templates/task.md`: 既定の task 本文テンプレートです。
- `assets/templates/task.ja.md`: 日本語で手動作成するときの task 本文テンプレートです。
