# AGENTS.ja.md

このファイルは、`packages/recommended-dev-suite` 配下で作業する agent 向けのガイドです。

## Package Role

`recommended-dev-suite` は、推奨 AI 支援開発 workflow を束ねる dependency-only aggregator です。[apm.yml](./apm.yml) を正本として扱ってください。

対象は、basic foundation を超える workflow の深さです。brainstorming、idea refinement、interview-style clarification、subagent execution、code review loop、systematic debugging、TDD、source-driven work、incremental delivery、CI/CD automation、simplification、context engineering を主な範囲とします。

## Editing Rules

- `README.md` と `README.ja.md` の意味と構造を同期する。
- `AGENTS.md` と `AGENTS.ja.md` の意味と構造を同期する。
- この directory に実体がない local skill、agent、prompt、instruction、MCP server は説明しない。
- `apm.yml` の dependencies を変更した場合は、同じ変更で両方の README も更新する。
- baseline で意見の少ない dependencies は `basic-dev-foundation` に置き、この package は recommended workflow methodology に使う。

## Validation

この package は dependency-only package です。documentation だけを変更した後は、利用できる場合にこの directory で以下を実行します。

```powershell
apm compile --dry-run
```

`apm compile --validate` は install 済みまたは local の APM content を必要とします。この package が `apm.yml` と documentation files だけの状態であれば、local `.apm/` content がないことを package bug と扱わず、validation は対象外として報告してください。
