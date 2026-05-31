# スキル発見プロトコル リファレンス

このフローはプロファイル管理に共通の `skill-discovery-protocol` を使用する。

## クイックリファレンス

| アクション | コマンド |
|-----------|---------|
| プロファイル生成 | `sdp generate --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml` |
| プロファイル検証 | `sdp validate --profile implementation-profile.json` |
| カテゴリ一覧 | `sdp query --profile implementation-profile.json categories` |
| スキルスタック確認 | `sdp query --profile implementation-profile.json flow-stack` |
| 解決確認 | `sdp query --profile implementation-profile.json resolution` |

## アダプター

フロー固有のアダプターは `assets/adapters/implementation-adapter.yaml` にある。
`general` アダプターを拡張し、以下を定義する:
- 実装固有のタクソノミー（Process/Build/Verify/Review/Domain/Tooling/Meta）
- フロースタックスロット
- 呼び出し解決オーバーライド

## 旧プロトコルからの移行

旧 `implementation-profile.md`（マークダウン形式）は非推奨。
代わりに `implementation-profile.json` を使用する。`sdp query` コマンドが
同等の情報抽出機能を提供する。
