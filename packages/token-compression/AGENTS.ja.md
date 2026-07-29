# 関連エージェント

## エージェント概要

`token-compression` パッケージは、単純で機械的に検証できる作業向けのローカル `cheap-action` advisory skill を提供します。

### cheap-action

- **目的:** 単純で機械的に検証できる作業の advisory な低コストルーティング
- **用途:** 名前付きコマンドの実行、grep ベースの検索、スコープ済み rename、routine な Git 操作、構造化 config 編集、構文レベルの修正
- **境界:** 決定的な検証手順があり、深い推論を必要としない場合だけ使う

## 統合ポイント

このスキルはリポジトリ内の他パッケージと組み合わせることができます：

- `agent-intelligence` — 圧縮効果の評価
- `recommended-dev-suite` — 限定された作業を標準開発ワークフローへ組み込む
- `basic-dev-foundation` — routine な Git と repository 操作に cheap routing を適用する

信頼できるローカル資産のリストについては [apm.yml](./apm.yml) を参照してください。
