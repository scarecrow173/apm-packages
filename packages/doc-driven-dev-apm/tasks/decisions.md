# Architecture Decisions: skill-discovery-protocol

## Architecture Decisions (AD)

| ID | Decision |
| --- | --- |
| AD-1 | `skill-discovery-protocol` は新規スキルとして実装し、flow の references には内蔵しない |
| AD-2 | profile 成果物の更新は常に専用スクリプトのみ許可 |
| AD-3 | 冪等性ゲートを必須化する（同一入力で 2 回実行して差分 0 を確認） |
| AD-4 | 既存プロトコルの文言・分類をそのまま移植しない。汎用契約を先に定義し、flow 依存は adapter 層に閉じ込める |
| AD-5 | 検証は `schema gate + staleness gate + deterministic render gate` の 3 層で行う |
| AD-6 | プロトコル標準成果物は機械可読（JSON）と人間可読（Markdown）の二重出力 |
| AD-7 | Skill Reference Catalog には、各スキルが提供・利用する capability と実行ポリシーを列挙し、flow 固有の slot 定義は持たせない |
| AD-8 | adapter 設定形式は YAML に統一 |
| AD-9 | 旧 protocol 文書は即時 deprecated とし、移行導線のみ残す |
| AD-10 | override 解決結果は Flow Profile（`*-profile.json`）の `resolved_invocations` に保持 |
| AD-11 | slot 定義は具体スキル名を持たず、`snake_case` 能力スロットで定義 |
| AD-12 | Flow Profile（`*-profile.json`）を正とし、Markdown は人間レビュー用の派生成果物 |
| AD-13 | `sdp query --profile <file>` コマンド群で必要最小限の情報抽出を提供 |
| AD-14 | `sdp` は生成(`generate`)・検証(`validate`)・参照抽出(`query`)に責務分離 |
| AD-15 | 旧 default stack は `flow_stack.slots[]` に汎用化して統合 |
| AD-16 | Skill Reference Catalog に `execution_policy` を標準化 |
| AD-17 | Catalog は provides/uses を保持、Flow Profile が flow 固有の classification/resolved_invocations/runtime_guidance を保持 |
| AD-18 | `extends` は文字列配列で宣言し、宣言順にマージ。`priority` キーは使用禁止 |
| AD-19 | `overall_result = schema && staleness && deterministic && blocking_validations` |

## Human Review Decisions

以下はレビューで確定した方針。

- 共通成果物は `skill-reference-catalog + *-profile.json + validation-report` を採用
- 旧 protocol は即時 deprecated
- adapter YAML は general のみ共通側に置き、flow 固有設定は flow 側 references パス入力で読み込む
- Skill Reference Catalog は「提供 capability」と「利用 capability + default_skill」を保持し、flow 固有の slot 定義や resolved_skill は持たない
- 旧 default stack は `flow_stack.slots[]`（slot_type/activation/default）として Flow Profile に統合。MVP では `default.skill` のみ許可
- override 解決結果は `*-profile.json` の `resolved_invocations` に統合
- override 検証は `sdp validate` で実施し、結果は `validation-report` に記録
- staleness は `validated_at` を基準日として評価
- deterministic gate は「Flow Profile」「Flow Profile + catalog artifacts」「validation-report のタイムスタンプ項目除外」で比較
- `overall_result = schema && staleness && deterministic && blocking_validations`
- 置換時の互換モードは設けず、旧 protocol 参照は即時削除
- テストは skill 単位で新規ファイルに分割
- `sdp` のコマンド/サブコマンドは将来要件で拡張可能、現行セットは最小提案
