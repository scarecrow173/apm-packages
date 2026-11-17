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
- 取り込み済み Gist revision: [`upstream.json`](./upstream.json) に記録
- 原本のライセンス: [Unlicense](https://gist.github.com/k16shikano/67625f2a7d96e3bbdfae8d571a936063)

## Gist の自動同期

原本の Skill を配布リポジトリに同梱しています。GitHub Actions の [自動同期ワークフロー](../../.github/workflows/japanese-tech-writing-upstream.yml) が毎日 03:17 UTC に Gist の最新コミットを確認し、更新があればテストと APM 検証を通して `main` に直接コミットします。Actions の `workflow_dispatch` から手動実行も可能です。変更がなければコミットは作成しません。

同期対象は Gist の `SKILL.md` のみです。本文は維持し、frontmatter の `license` を `Unlicense` に正規化します。`upstream.json` に取り込んだ Gist のコミット ID を記録し、ルートの `apm.lock.yaml` のハッシュも更新します。名前・ライセンス・frontmatter の構造が予期せず変わった場合、または検証に失敗した場合は自動反映せず Actions を失敗させます。

これは上流の文章規範を信頼して自動配布する設定です。更新した内容は次回の `apm install` または明示的なアップグレードで利用側に届きます。既存のインストール先が即時に書き換わるわけではありません。

## ローカル検証

リポジトリルートで:

```bash
python3 -m unittest discover -s scripts/japanese-tech-writing -p "test_*.py" -v
```

同期待ちの Gist を手動取得する場合:

```bash
git clone --depth=1 https://gist.github.com/fd287c3133457c4fd8f5601d34aa817d.git /tmp/japanese-tech-writing-gist
python3 scripts/japanese-tech-writing/sync.py \
  --source /tmp/japanese-tech-writing-gist/SKILL.md \
  --revision "$(git -C /tmp/japanese-tech-writing-gist rev-parse HEAD)"
```

## 検証

パッケージのディレクトリで:

```bash
mise exec -- apm compile --dry-run
mise exec -- apm compile --validate
```
