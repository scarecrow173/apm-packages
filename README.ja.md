# apm-packages

このリポジトリは、skill、agent、prompt、instruction など複数の APM パッケージを一元管理するマーケットプレイスインデックスです。

また、次の 2 つの aggregator package も公開します:

- `basic-dev-foundation`: 基礎的な APM と workflow helper をまとめた bundle
- `recommended-dev-suite`: このリポジトリの上位 workflow package を追加した広めの bundle

## 環境アクティベート（作業開始前に必須）

mise の shims は uv との無限ループ回避のため PATH から除外されています。
**セッション開始時に必ず `mise activate` を実行してから作業してください。**

| プラットフォーム | コマンド |
|---|---|
| Windows (PowerShell) | `mise activate pwsh \| Out-String \| Invoke-Expression` |
| macOS / Linux (bash) | `eval "$(mise activate bash)"` |
| macOS / Linux (zsh) | `eval "$(mise activate zsh)"` |

アクティベートしないと `uv`, `python`, `node` などのバージョン管理が効かず、
コマンドが見つからないか誤ったバージョンで実行されます。

## インストール

利用者側は `apm.yml` でこのコレクション全体を依存先として登録できます：

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages#v0.1.0
```

またはローカル開発時：

```bash
pnpm clean
apm install .
```

ローカルで `apm install` する前に `pnpm clean` を推奨します。
依存パッケージのテストファイルに含まれる不可視 Unicode 文字による
一時的なブロックを回避しやすくなります。

## リポジトリ構成

**monorepo-hybrid** レイアウトです：

- Root `apm.yml` はマーケットプレイスインデックスであり、全ローカルパッケージを列挙します。
- `packages/` 配下の各パッケージは `apm.yml` と配布用 `.apm/` 資産を持ちます。
- build workspace、TypeScript ソース、テストは `scripts/<package-name>/` 配下にある場合があります。

```text
apm.yml                                  # marketplace index
packages/
  basic-dev-foundation/
    apm.yml                              # package manifest
    .apm/
      instructions/
    README.md
    README.ja.md
    AGENTS.md
    AGENTS.ja.md
  recommended-dev-suite/
    apm.yml                              # package manifest
    .apm/
      instructions/
    README.md
    README.ja.md
    AGENTS.md
    AGENTS.ja.md
  doc-driven-dev/
    apm.yml                              # package manifest
    .apm/
      skills/
    README.md
    README.ja.md
  steer-enterprise-web-research/
    apm.yml                              # package manifest
    .apm/
      agents/
      skills/
      prompts/
      instructions/
    README.md
    README.ja.md
    docs/
    examples/
    research/
scripts/
  doc-driven-dev/                        # build workspace, TS source, tests
  steer-enterprise-web-research/         # build workspace, TS source, tests
```

このリポジトリ内のパス参照は、`packages/doc-driven-dev/.apm/...` と
`scripts/doc-driven-dev/...` のようなリポジトリルート基準を優先すると、
manifest / 配布ツリーと build / test ツリーを混同しにくくなります。

## パッケージの追加方法

1. `packages/` 配下にパッケージ名の新しいディレクトリを作成します。
2. その中に `apm.yml` マニフェストと `.apm/` ディレクトリ構造を配置します。
3. Root の `apm.yml` の marketplace ブロックに新パッケージエントリを追加します。
4. CI/CD でタグ付けしてリリースします（[Releasing from any CI](https://microsoft.github.io/apm/producer/releasing-from-any-ci/) 参照）。
