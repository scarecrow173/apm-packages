# {{title}}

## 目的

<!-- この plan が何を作るのかを 1 文で書く。 -->

## スコープ

<!-- 1 つの実装ストリームか、分割すべきかを明示する。境界をはっきり書く。 -->

## 上流文書

- <!-- spec または ADR の path -->

## Design Inputs

- <!-- docs/designs/ 配下の承認済み design doc path -->

## ファイル表

- `path/to/file.ts` - <!-- 責務 -->
- `path/to/test.ts` - <!-- 責務 -->

## 実装順序

- [ ] <!-- 1 action のみ -->
- [ ] <!-- 1 action のみ -->

## 依存関係とリスク

- <!-- dependency, blocker, risk -->

## Task 分解

- <!-- task candidate または分解ルール -->

## 検証

- [ ] <!-- command, test, review step, or observable behavior -->

## 未解決事項 / gap

- <!-- 不明点を明示する -->

## 自己レビュー

- [ ] spec の要求がすべて task に対応している
- [ ] placeholder が残っていない
- [ ] file path、relation、status、用語が整合している

## 実装ハンドオフ

- 推奨方式: <!-- inline 実行、または委譲型またはサブエージェント対応の実装 -->
- 独立して進められる作業ストリーム: <!-- task ID を列挙する、または無しと書く -->
- dispatch 前のユーザー承認: 必須
- 承認された場合: 現在の環境で利用可能な実装・委譲能力を発見し、review checkpoint 付きで task ごとに実行する。
- 承認されない、または利用可能な能力がない場合: 同じ依存グラフと検証マトリクスを使って inline 実行する。

## レビュー用ハンドオフ

- <!-- assumption、未解決 dependency、レビュー時の注目点 -->
