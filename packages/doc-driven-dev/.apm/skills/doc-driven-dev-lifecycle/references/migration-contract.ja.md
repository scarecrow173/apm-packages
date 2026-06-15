# doc-driven-dev-lifecycle Migration Contract

この文書は、既存の Markdown ドキュメントを `migrate_docs` で
doc-driven-dev の canonical tree へ取り込む契約を定義します。

## ライフサイクル上の位置づけ

migration は、既にドキュメントを持つリポジトリが doc-driven-dev を導入する
場合の任意の Phase -1 です。Phase 0 の `scaffold_docs` より前に実行します。

## Safety Rules

- 既定は dry-run です。
- `--apply` は変換済みの canonical document を作成します。
- 元の source document は保持します。
- 既存の canonical target file は上書きしません。
- 既存の canonical directory は既定で移行元から除外します。
- `docs/designs/overview.md` は引き続き `design-doc` が所有します。

## Supported Transformations

- 1 つ以上の `--from` directory から Markdown file を棚卸しします。
- 各 document を canonical docs tree に分類します。
- 既知の doc type を canonical front matter へ変換します。
- ADR、implementation record、experiment log は最小 metadata で内容を保持します。
- `--split-h1` 指定時は複数 H1 を持つ source file を分割します。

## Completion

- Dry-run report が全 source-to-target mapping を表示します。
- Apply run が report された file を作成します。
- 既存の source file は残ります。
- 生成後の canonical docs は `doc-status` で audit できます。
