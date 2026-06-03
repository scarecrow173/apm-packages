# スキル発見プロトコル リファレンス

このフローはプロファイル管理に共通の `skill-discovery-protocol` を使用する。

## クイックリファレンス

このフローからは `sdp` を直接呼ばず、`skill-discovery-protocol` を呼び出す。

- Adapter path: `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
- Expected profile path: `.sdp/implementation-flow-default/implementation-flow-profile.json`
- Expected inference artifact: `.sdp/skill-reference-inferences.json`
- プロファイルの生成・検証・参照は `skill-discovery-protocol` に依頼する。

## アダプター

フロー固有のアダプターは `assets/adapters/implementation-adapter.yaml` にある。
`general` アダプターを拡張し、以下を定義する:
- 実装固有のタクソノミー（Process/Build/Verify/Review/Domain/Tooling/Meta）
- フロースタックスロット
- 呼び出し解決オーバーライド
