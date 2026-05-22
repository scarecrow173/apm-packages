# APM の使い方

## producer 側ワークフロー

```bash
apm compile --validate
apm compile --dry-run
apm audit
apm pack --archive -o dist
```

## consumer 側ワークフロー

このパッケージを使いたいリポジトリで次を実行します。

```bash
apm install <owner>/<repo>#v0.1.0
```

ローカル検証では次のように使います。

```bash
  apm install ..
```

## バージョニング

再現可能なインストールのため、Git tag で固定します。

初期タグの例:

```bash
git tag v0.1.0
git push origin v0.1.0
```

利用側は、継続的に最新版を追いたい場合を除き、`main` のような可変ブランチからのインストールを避けるべきです。

## ターゲット

このパッケージでは次を設定しています。

```yaml
target:
  - codex
  - copilot
```

Claude、Cursor、OpenCode、Gemini、Windsurf も対象にする場合は、`apm.yml` を変更してください。
