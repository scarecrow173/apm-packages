---
name: task-doc
description: plan、spec、ADR、他 task にリンクした実装単位を YAML フロントマター + Markdown で管理するときに使います。
license: MIT
---

# Task Documentation Skill

この skill は、実装とレビューが可能な小さな作業単位を管理するために使います。
task は、それが実装する plan、spec、ADR にリンクし、完了条件を具体的に
書く必要があります。

## ワークフロー

1. 関連する plan または上流文書を読む。
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

## リソース

- `scripts/new_task.js`: task を作成し、索引を更新します。
- `references/task-conventions.ja.md`: task のディレクトリ、ファイル名、
  ステータス、relation、必須内容、索引の規約です。
- `assets/templates/task.md`: 既定の task 本文テンプレートです。
- `assets/templates/task.ja.md`: 日本語で手動作成するときの task 本文テンプレートです。
