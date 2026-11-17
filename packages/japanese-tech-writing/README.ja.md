# japanese-tech-writing

日本語の技術書・記事・解説文の執筆や推敲に使う [k16shikano 氏の Japanese Tech Writing Skill](https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d) を、APM の Git 依存として導入する aggregator パッケージです。

Skill 本体はこのリポジトリにコピーしません。正本は Gist の `SKILL.md` です。`doc-driven-dev` への依存はありません。

## インストール

マーケットプレイス経由:

```bash
apm marketplace add scarecrow173/apm-packages
apm install japanese-tech-writing@apm-packages
```

または、利用するプロジェクトの `apm.yml` に直接指定:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages/packages/japanese-tech-writing#main
```

登録後は `apm install` を実行します。APM は Gist に含まれる Skill を対象ランタイムの Skill ディレクトリ（APM 0.33.0 の `agent-skills` ターゲットでは `.agents/skills/japanese-tech-writing/`）に展開します。

## 依存関係と更新

このパッケージの `apm.yml` には、次の Git URL 依存を宣言しています。

```yaml
dependencies:
  apm:
    - git: https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d.git
      alias: japanese-tech-writing
```

APM のロックファイルは解決したコミットを固定します。**Gist の変更は再インストールだけでは必ずしも取り込まれません。** 最新の参照を取り込む際は、利用側プロジェクトで次を実行します。

```bash
apm update
```

CI など非対話環境では `apm update --yes` を使えます。定期的に更新したいプロジェクトは自身の CI で実行してください。このパッケージ独自の Gist 複製・同期ジョブはありません。

## 出典とライセンス

- 原著者: [k16shikano](https://gist.github.com/k16shikano)
- 正本: [Gist / japanese-tech-writing](https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d)
- 上流 Skill のライセンス: [Unlicense](https://gist.github.com/k16shikano/67625f2a7d96e3bbdfae8d571a936063)
- この aggregator のマニフェスト: MIT

上流 Skill はインストール時に直接取得されます。更新履歴と内容は Gist 側を参照してください。

