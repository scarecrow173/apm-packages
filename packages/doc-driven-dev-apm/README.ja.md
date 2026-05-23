# Doc-Driven Dev APM Package

このパッケージは、ドキュメント駆動開発向けの再利用可能な skill 群を提供します。

最初に同梱する skill は `adr-doc` です。これは MADR 4.0.0 を前提に、
Architecture Decision Record の作成、監査、索引更新、移行計画レポートを
支援し、コーディングエージェントが直接実装できる判断記録を作るための
ワークフローです。

将来の skill は `.apm/skills/` 配下に横並びで追加できます。例:

- `rfc`
- `design`
- `spec`
- `task`
- `architecture`

## インストール

この monorepo から:

```bash
apm install ./packages/doc-driven-dev-apm --target codex
```

公開後に利用側リポジトリから:

```bash
apm install scarecrow173/apm-packages#v0.1.0
```

## 検証

```bash
apm compile --validate
apm compile --dry-run
node --test tests/*.test.js
```

## 同梱 Skill

### `adr-doc`

MADR 4.0.0 ADR を扱うときにこの skill を使います。

- MADR テンプレートから新しい ADR を作成する
- コーディングエージェント向けの実装計画と検証基準を書く
- ADR 一覧を出し、エージェント対応状況をレビューする
- ADR の構造と索引整合性を監査する
- Implementation Plan のコードリンクと ADR 関係を確認・管理する
- ADR 索引を再生成する
- ファイルを書き換えずに移行レポートを作成する
