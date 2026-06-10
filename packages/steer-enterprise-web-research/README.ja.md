# SteER Enterprise Web Research APM Package

これは、SteER / Enterprise Deep Research 型の Web 調査ワークフローを配布するための APM パッケージです。

次をまとめてパッケージ化しています。

- モデルが必要時に呼び出す調査スキル
- 再利用可能な deep research prompt
- 明示的に呼び出せる調査 agent
- リポジトリに常駐する instruction
- 調査状態を管理するテンプレート
- 構造監査用の軽量スクリプト

Codex と GitHub Copilot で使うことを主目的にしつつ、ソースは APM の標準的な `.apm/` レイアウトに寄せています。

## Git リポジトリからインストールする

このディレクトリを Git リポジトリとして公開した後、利用側リポジトリで次のようにインストールします。

```bash
apm install <owner>/<repo>#v0.1.0
```

ローカル検証では、このパッケージディレクトリから次のように使います。

```bash
apm install .
```

リリース前に検証・プレビューします。

```bash
apm compile --validate
apm compile --dry-run
```

オフライン配布用 bundle を作る場合は、次を実行します。

```bash
apm pack --archive -o dist
```

利用側は生成された bundle を次のようにインストールできます。

```bash
apm install ./dist/steer-enterprise-web-research-0.1.0.tar.gz
```

## 内容

```text
.apm/
  instructions/
    steer-web-research.instructions.md
  skills/
    steer-web-research/
      SKILL.md
      SKILL.ja.md
  prompts/
    steer-deep-research.prompt.md
    steer-deep-research.prompt.ja.md
    steer-deep-research-ja.prompt.md
  agents/
    steer-enterprise-web-research.agent.md
    steer-enterprise-web-research.agent.ja.md
docs/
research/
scripts/
```

## 使い方

エージェントに SteER web research skill を使わせます。

```text
Use the steer-web-research skill to research <topic>.
Run iterative search, maintain an evidence ledger, audit the findings, and produce a cited final report.
```

または prompt を呼び出します。

```text
/steer-deep-research
```

日本語で使う場合は、次を使えます。

```text
/steer-deep-research-ja
```

## 監査スクリプト開発

監査スクリプトのソースは以下に配置します。

- `scripts/steer-enterprise-web-research/src/research_audit.ts`

生成された build 成果物は以下に配置されます。

- `packages/steer-enterprise-web-research/scripts/research_audit.js`

隔離された scripts ワークスペースから build と test を実行します。

```bash
pnpm --dir scripts/steer-enterprise-web-research test
pnpm --dir scripts/steer-enterprise-web-research build
```

## 注意

このパッケージ自体は検索 API を実装しません。Codex、GitHub Copilot、または MCP 対応エージェントが利用できる search、fetch、GitHub、academic、file、enterprise retrieval などのツールを使うよう指示するものです。

取得ツールがない環境では、調査結果を捏造してはなりません。その場合は調査計画だけを作成します。

## リリースチェックリスト

1. `apm compile --validate` を実行する。
2. `apm compile --dry-run` を実行する。
3. `apm audit` を実行する。
4. 例として `v0.1.0` のようなタグを切る。
5. scratch repository からタグ指定でインストールテストする。
6. 必要に応じて `apm pack --archive -o dist` を実行する。
