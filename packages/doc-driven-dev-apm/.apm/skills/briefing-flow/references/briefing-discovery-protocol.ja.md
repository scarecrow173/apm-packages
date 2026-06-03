# Briefing スキル発見プロトコル リファレンス

本フローはプロファイル管理に共通の `skill-discovery-protocol` を使用する。

## クイックリファレンス

このフローからは `sdp` を直接呼ばず、`skill-discovery-protocol` を呼び出す。

- Adapter path: `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`
- Expected profile path: `.sdp/briefing-flow-default/briefing-profile.json`
- Expected inference artifact: `.sdp/skill-reference-inferences.json`
- プロファイルの生成・検証・参照は `skill-discovery-protocol` に依頼する。

## アダプター

フロー固有のアダプターは `assets/adapters/briefing-adapter.yaml` にある。
`general` アダプターを拡張し、以下を定義する:

- Briefing 固有のタクソノミー（Frame/Discover/Research/Validate/Document/Meta）
- フロースタックスロット（frame_structure/discover_gather/validate_check/document_output）
- 呼び出し解決ルール

## Entry Decision との統合

Entry Decision（A-1 〜 A-5）は Phase B でスキルの活性化を駆動する:

- A-1（Problem Framing）/ A-2（Option Framing）→ frame カテゴリ優先
- A-3（Combined Discovery）→ 全カテゴリ考慮
- A-5（Research Required）→ discover/research カテゴリ優先
- A-4（Direct Start）→ document カテゴリのみ

これらの決定はどの `flow_stack.slots` が活性化されるかに影響し、プロファイル構造自体には影響しない。
