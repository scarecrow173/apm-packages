# TODO: skill-discovery-protocol 汎用化

## Phase 1: Foundation

- [ ] Task 1: 共通 discovery 契約を定義する (M)
- [ ] Task 2: script-only 運用とゲート仕様を定義する (M)

## Checkpoint: Foundation

- [ ] flow 非依存の共通契約が確定している
- [ ] 成果物操作が script-only として規約化されている
- [ ] 人間レビューで汎用化方針が承認された

## Phase 2: Vertical Slices

- [ ] Task 3: Vertical Slice A - 共通生成パイプラインを実装する (M)
- [ ] Task 4: Vertical Slice B - 再現性/厳格性ゲートを実装する (M)
- [ ] Task 5: Vertical Slice C - implementation-flow を新プロトコルへ置換する (M)
- [ ] Task 6: Vertical Slice D - briefing-flow を新プロトコルへ置換する (M)

## Two-layer Artifacts

- [ ] Skill Reference Catalog 成果物を追加する（`skill-reference-catalog.md` / `.json`）
- [ ] Flow Profile 成果物を追加する（`*-profile.json`、`resolved_invocations` を含む）
- [ ] Flow Profile に `flow_stack.slots[]`（slot_type/activation/default）を統合する
- [ ] adapter YAML 必須キー（schema_version/adapter_id/protocol/scan/profile/classification/invocation_resolution/validation/render/artifacts）を固定化する
- [ ] adapter YAML 必須キーに `flow_stack` を含める
- [ ] classification は vocab ではなく taxonomy（id/label/description/match{capabilities/tags/description_patterns}）を正規形式に固定する
- [ ] classification に unmatched(action/category/severity) を導入し、action=assign 時は category を taxonomy id と一致必須にする
- [ ] scan スキーマを scopes.<scope>.enabled/roots 形式に固定化する
- [ ] general-adapter に全主要ハーネスの各スコープ roots を集約定義する
- [ ] スクリプトが extends マージ後の scopes を解決する規約を固定化する
- [ ] 既定値は `project.enabled=true`、他スコープは `false` にする
- [ ] adapter YAML 追加推奨キー（extends/enabled/priority/metadata）を固定化する
- [ ] extends はパス直書き禁止とし、参照名から skill-discovery-protocol/references の yaml|yml を解決する
- [ ] extends の入れ子継承を許可し、最上位まで再帰解決する規約を固定化する
- [ ] extends のマージ適用順を「最上位親 -> ... -> 直接親 -> 子 adapter」に固定化する
- [ ] extends の循環参照（例: a -> b -> a）を schema error として検出する
- [ ] extends マージ規則（object: 再帰マージ / scalar: 後勝ち / array: 子側置換）を固定化する
- [ ] scan.scopes の enabled/roots 必須チェックを extends 全マージ後の最終結果に対して実施する
- [ ] Skill Reference Catalog で「呼び出す可能性のあるスキル/能力」と能力スロット定義の統合列挙を固定化する
- [ ] Skill Reference Catalog に `execution_policy`（strictness/sequence_required/allow_step_reordering/allow_partial_application/guidance）を保持する
- [ ] 親フローの slot/capability 差し替え規約を Flow Profile の `resolved_invocations` 生成規約として固定化する
- [ ] invocation_resolution.overrides.slots のキーは Skill Reference Catalog の slot_id と一致し、`snake_case` 固定にする
- [ ] invocation_resolution.overrides.capabilities のキーは capability 識別子と一致し、`snake_case` 固定にする
- [ ] invocation_resolution.resolution_order（slot_override/capability_override/default_skill/provider_lookup）を固定化する
- [ ] invocation_resolution.unresolved.required/optional のポリシーを固定化する
- [ ] invocation_resolution.invalid_override.* のポリシーを固定化する
- [ ] `sdp` CLI を `generate` / `validate` / `query` に責務分離して固定する
- [ ] `sdp generate --adapter <adapter-yaml>` を正規入力インターフェースとして固定する
- [ ] `sdp validate --profile <flow-profile-json>` を検証インターフェースとして固定する
- [ ] `sdp query` で `flow-stack` / `execution-policy` を抽出できるようにする
- [ ] `sdp query` をサブコマンドレジストリ駆動にして拡張容易性を確保する
- [ ] `sdp query` に共通 profile ローダー + schema 事前検証を導入する
- [ ] `flow-stack --slot <id>` の抽出/フィルタを実装する
- [ ] `execution-policy --skill <name>` の抽出/フィルタを実装する
- [ ] 未知サブコマンド時の終了コード/ヘルプ表示/候補提示を標準化する
- [ ] サブコマンド追加を 1 handler 追加で完了できる実装規約を docs 化する
- [ ] `validation-report.json` の項目定義を固定化する
- [ ] 未使用 slot/override は `*-profile.json` と `validation-report` に警告記録のみを行う
- [ ] staleness を `validated_at` 基準で評価する
- [ ] deterministic 比較範囲（Flow Profile / profile+catalog artifacts / report timestamp除外）を固定する
- [ ] `overall_result = schema && staleness && deterministic` を固定する

## Checkpoint: Replacement Complete

- [ ] implementation-flow と briefing-flow が共通プロトコルを利用している
- [ ] Flow Profile 成果物の操作が script-only に統一されている
- [ ] ゲート失敗時にフロー進行が停止する
- [ ] 2 層成果物（Skill Reference Catalog / Flow Profile）が両 flow で再現可能に生成される
- [ ] 未使用 slot/override は記録のみで、フロー停止条件になっていない

## Phase 3: Hardening and Rollout

- [ ] Task 7: 回帰テストと検証導線を整備する (M)
- [ ] Task 8: 旧プロトコル整理と移行ガイドを整備する (S)

## Checkpoint: Release Readiness

- [ ] `pnpm run build:scripts` pass
- [ ] `pnpm test` pass
- [ ] `pnpm run lint:md` pass
- [ ] 置換完了が人間レビューで承認された

---

## Fixed Decisions

- [ ] 共通成果物は `skill-reference-catalog + *-profile.json + validation-report` を採用
- [ ] 旧 protocol は即時 deprecated
- [ ] adapter 設定形式は YAML
- [ ] adapter YAML は general のみ共通側に置き、flow 固有設定は flow 側 references パス入力で読む
- [ ] `sdp generate` の入力は Adapter YAML（`--adapter`）に統一する
- [ ] scan のスコープ別 roots は general-adapter に集約し、flow 側は差分のみ上書きする
- [ ] extends は入れ子継承を許可し、最上位親から子 adapter の順で適用する
- [ ] extends の循環参照は schema error で停止し、最終マージ結果に対して scan.scopes 検証を行う
- [ ] Skill Reference Catalog で「呼び出す可能性のあるスキル/能力」と能力スロット定義を統合して列挙する
- [ ] override 解決結果は `*-profile.json` の `resolved_invocations` に統合して扱う
- [ ] 旧 default stack は `flow_stack.slots[]`（slot_type/activation/default）として Flow Profile に統合する
- [ ] Skill Reference Catalog は各スキルに `execution_policy` を保持する
- [ ] `sdp` のコマンド/サブコマンドは将来要件で拡張可能とし、現行セットは最小提案である旨を明記する
- [ ] slot 識別子と mapping キーは `snake_case` 固定
- [ ] override 検証は `sdp validate` で実施し、結果は `validation-report` に記録する
- [ ] 必須キー欠落時に schema gate が失敗する fixture テストを追加する
- [ ] staleness は `validated_at` 基準
- [ ] deterministic 比較対象（Flow Profile / profile+catalog artifacts / report timestamp除外）を 3 種に固定
- [ ] fail 条件は schema/staleness/deterministic のみ
- [ ] 旧 protocol 参照の互換モードは設けない
- [ ] テストは skill 単位で新規ファイルに分割
