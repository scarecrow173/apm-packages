---
name: cheap-action
description: コマンド実行、grep 検索、スコープ済み rename、軽微な config 編集、構文修正、ファイル移動、routine な Git 操作など、単純・機械的・検証可能な依頼で使う。ハーネスが対応していれば、必要なツールを使える最も低コストなモデルまたは委譲経路へ回す。
---

# Cheap Action

このスキルは、推論が少なく、境界が明確で、機械的な検証手順をすぐ示せる作業だけに使う。

## 対象

- 名前付きコマンドやスクリプトを実行し、結果を報告する。
- grep 風検索、ファイル一覧、diff 要約、routine な Git status / stage / commit 確認を行う。
- スコープ済み rename、import / include 修正、単純な型注釈、コメント更新、構造化 config 編集、構文レベル修正、import 更新を伴うファイル移動などの機械的編集を行う。

## 対象外

planning、design、code review、debugging、architecture、security、policy 判断、破壊的操作、広いコード理解、曖昧な意図推定、公開、デプロイ、権限変更、秘密情報の扱いでは current reasoning model を使う。

## 手順

1. 境界のある作業と検証手順を言語化する。
2. ハーネスが必要なツールを使える低コストモデルまたは委譲経路を提供していれば、それを使う。
3. 使えない場合は、切り替えたふりをせず現在のモデルで続ける。
4. 境界のある作業だけを実行する。
5. 結果を機械的に検証する。
6. 範囲が広がる、検証に失敗する、曖昧さが出る場合は current/default reasoning model に戻す。

## 出力

実行した作業、検証結果、必要な出力やファイルパス、cheap routing を使わなかった理由があればそれを報告する。
