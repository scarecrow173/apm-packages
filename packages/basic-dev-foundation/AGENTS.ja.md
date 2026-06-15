# AGENTS.ja.md

このファイルは、`packages/basic-dev-foundation` 配下で作業する agent 向けのガイドです。

## Package Role

`basic-dev-foundation` は、AI 支援開発の基礎を束ねる dependency-only aggregator です。[apm.yml](./apm.yml) を正本として扱ってください。

対象は、広く使える開発基盤に絞ります。APM usage、Git workflow、PR visibility、CI awareness、dependency hygiene、security review、audit integrity、diagram、research、governance、context management が主な範囲です。

## Editing Rules

- `README.md` と `README.ja.md` の意味と構造を同期する。
- `AGENTS.md` と `AGENTS.ja.md` の意味と構造を同期する。
- この directory に実体がない local skill、agent、prompt、instruction、MCP server は説明しない。
- `apm.yml` の dependencies を変更した場合は、同じ変更で両方の README も更新する。
- この package は `recommended-dev-suite` より保守的に保つ。重い workflow methodology は recommended package 側に分ける。

## Validation

この package は dependency-only package です。documentation だけを変更した後は、利用できる場合にこの directory で以下を実行します。

```powershell
apm compile --dry-run
```

`apm compile --validate` は install 済みまたは local の APM content を必要とします。この package が `apm.yml` と documentation files だけの状態であれば、local `.apm/` content がないことを package bug と扱わず、validation は対象外として報告してください。
