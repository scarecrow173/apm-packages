# Briefing スキル発見プロトコル リファレンス

本フローはプロファイル管理に共通の `skill-discovery-protocol` を使用する。

## クイックリファレンス

| アクション | コマンド |
|-----------|---------|
| プロファイル生成 | `sdp generate --adapter .apm/skills/briefing-flow/references/briefing-adapter.yaml` |
| プロファイル検証 | `sdp validate --profile briefing-profile.json` |
| カテゴリ一覧 | `sdp query --profile briefing-profile.json categories` |
| スキルスタック確認 | `sdp query --profile briefing-profile.json flow-stack` |
| 解決状況確認 | `sdp query --profile briefing-profile.json resolution` |

## アダプター

フロー固有のアダプターは `references/briefing-adapter.yaml` にある。
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

## 旧プロトコルからの移行

旧形式の `briefing-profile.md`（マークダウン形式）は非推奨。
代わりに `briefing-profile.json` を使用すること。
