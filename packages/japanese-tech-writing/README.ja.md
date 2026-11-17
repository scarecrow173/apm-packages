# japanese-tech-writing

日本語の技術書、技術記事、解説文などの執筆・推敲に利用する Agent Skill `japanese-tech-writing` を配布する APM パッケージです。

段落と論証の構成、論理の厳密さ、読み手の負荷、視点と語り、演出の抑制、LLM 特有の空疎な表現、翻訳調の比喩、冗長さを点検する文章規範を含みます。独立した Skill であり、`doc-driven-dev` への依存はありません。

## インストール

マーケットプレイス経由:

```bash
apm marketplace add scarecrow173/apm-packages
apm install japanese-tech-writing@apm-packages
```

または、利用するプロジェクトの `apm.yml` で直接指定:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages/packages/japanese-tech-writing#main
```

登録後は `apm install` を実行してください。Skill は `.apm/skills/japanese-tech-writing/SKILL.md` に収録しています。

## 出典・ライセンス

- 原著者: [k16shikano](https://gist.github.com/k16shikano)
- 原本: [japanese-tech-writing / SKILL.md](https://gist.github.com/k16shikano/fd287c3133457c4fd8f5601d34aa817d)
- 取り込み対象の Gist revision: `8f2d57610a73efc97d743c9b0b0ecb1002e09fa4`
- 原本のライセンス: [Unlicense](https://gist.github.com/k16shikano/67625f2a7d96e3bbdfae8d571a936063)

原本のルールを APM から利用するために同梱した版です。Skill の文章は元の Gist を基にしており、メタデータと Markdown の体裁を APM 用に調整しています。アップストリームの変更は自動反映されません。取り込む場合は Gist の revision と差分を確認して更新してください。

## 検証

パッケージのディレクトリで:

```bash
mise exec -- apm compile --dry-run
mise exec -- apm compile --validate
```
