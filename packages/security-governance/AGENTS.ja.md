# AGENTS.ja.md

このファイルは、`packages/security-governance` 配下で作業する agent 向けのガイドです。

## Package Role

`security-governance` は、security review とガバナンスツールをまとめる dependency-only aggregator です。[apm.yml](./apm.yml) を正本として扱ってください。

対象は、security とガバナンス能力に絞ります。security review、audit integrity、agent compliance、supply chain security が主な範囲です。

## 関連 Package

この package は、専門化された aggregator family の一部です。

- `basic-dev-foundation` — Git workflow 管理
- `github-automation` — CI/CD と PR 運用
- `visualization` — 図解とドキュメント視覚化ツール
- `agent-intelligence` — AI 能力と評価

## Editing Rules

- `README.md` と `README.ja.md` の意味と構造を同期する。
- `AGENTS.md` と `AGENTS.ja.md` の意味と構造を同期する。
- この directory に実体がない local skill、agent、prompt、instruction、MCP server は説明しない。
- `apm.yml` の dependencies を変更した場合は、同じ変更で両方の README も更新する。

## Validation

この package は dependency-only package です。documentation だけを変更した後は、利用できる場合にこの directory で以下を実行します。

```powershell
apm compile --dry-run
```

`apm compile --validate` は install 済みまたは local の APM content を必要とします。この package が `apm.yml` と documentation files だけの状態であれば、local `.apm/` content がないことを package bug と扱わず、validation は対象外として報告してください。
