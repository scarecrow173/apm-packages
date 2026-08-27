# AGENTS.md

このファイルは、リポジトリルートで作業するエージェント向けの実務ガイドです。
より深いディレクトリに別の `AGENTS.md` がある場合は、その配下のファイルには
そちらの指示が優先されます。

## 0. 環境経由の実行（作業中に必須）

mise の shims は uv との無限ループ回避のため PATH から除外されています。
**リポジトリ管理のツールを必要とするコマンドは `mise exec --` 経由で実行してください。**

```text
mise exec -- <command> [args...]
```

`mise exec --` を使用しないと `uv`、`python`、`node` などのバージョン管理が
機能せず、コマンドが見つからないか、誤ったバージョンで実行される場合があります。

## 1. Scope

- このファイル中のパスは、コマンドブロックで明示しない限りリポジトリルート基準です。
- このリポジトリは複数の APM パッケージをまとめる monorepo 形式のインデックスです。
- パッケージ manifest と配布 assets は `packages/<name>/` 配下にあります。
- build workspace、source code、tests は `scripts/<name>/` 配下にあることがあります。
- `apm.yml`、`README.md`、`README.ja.md` などのルートレベルファイルや共有設定は、リポジトリ全体に適用されます。

## 2. Documentation Synchronization

- ローカライズされた sibling を持つ文書は、意味と構成を同期してください。
- 日本語版ドキュメントを terminal や script から読むときは、コンソール上で文字化けして見えることだけを根拠に、ファイル破損と判断しないでください。まず `Get-Content -Encoding utf8`、Node/Python の UTF-8 読み、または UTF-8 を正しく保持する editor で実内容を確認してください。
- 日本語文書を mojibake や破損として報告する前に、ファイル内容の破損と、shell encoding、code page、font、hex view 表示などの表示経路の問題を切り分けてください。
- これは次のような組み合わせに適用されます。
  - `*.md` と `*.ja.md`
  - 英語版と日本語版の package README
  - 英語版と日本語版の skill reference、template、spec
- 片方の言語で実質的な内容を変更したら、可能であれば同じ変更内で他方も更新してください。
- source 側が更新されたのに、localized 版だけが中途半端に古いまま残る状態を避けてください。可能な範囲で、追加・削除・並び順も揃えてください。
- localized 版を意図的に遅らせる場合は、そのズレが分かるように summary で明示してください。

## 3. Change Workflow

- 編集前に既存ドキュメントと package ごとのガイダンスを読んでください。
- 挙動と文書の整合を保てる範囲で、できるだけ最小の変更を優先してください。
- `scripts/<name>/` 配下の package code を編集した場合、user-facing な挙動が変わるなら `packages/<name>/.apm/**` 配下の配布 docs も更新してください。
- 完了を主張する前に、関連する validation や test を実行してください。

## 4. Ignore / Housekeeping

- 生成キャッシュやローカル作業ディレクトリを version control に含めないでください。
- 繰り返し発生する transient artifact は `.gitignore` に追加してください。
- `.pnpm-store/` のような workspace 専用 cache directory はコミットしないでください。
