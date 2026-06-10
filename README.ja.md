# apm-packages

このリポジトリは、skill、agent、prompt、instruction など複数の APM パッケージを一元管理するマーケットプレイスインデックスです。

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
- `packages/` 配下の各パッケージは自己完結した `apm.yml` を持ちます。

```text
apm.yml                                  # marketplace index
packages/
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
```

## パッケージの追加方法

1. `packages/` 配下にパッケージ名の新しいディレクトリを作成します。
2. その中に `apm.yml` マニフェストと `.apm/` ディレクトリ構造を配置します。
3. Root の `apm.yml` の marketplace ブロックに新パッケージエントリを追加します。
4. CI/CD でタグ付けしてリリースします（[Releasing from any CI](https://microsoft.github.io/apm/producer/releasing-from-any-ci/) 参照）。
