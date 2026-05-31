# TODO: skill-discovery-protocol 汎用化

## Phase 1: Foundation

- [ ] Task 1: 共通 discovery 契約を定義する (M)
- [ ] Task 2: script-only 運用とゲート仕様を定義する (M)

## Checkpoint: Foundation

- [ ] flow 非依存の共通契約が確定している
- [ ] 成果物操作が script-only として規約化されている
- [ ] 人間レビューで汎用化方針が承認された

## Phase 2: Vertical Slices

- [ ] Task 3: 共通生成パイプラインを実装する (M)
- [ ] Task 3A: Query サブコマンド拡張 (M)
- [ ] Task 4: 再現性/厳格性ゲートを実装する (M)
- [ ] Task 5: implementation-flow を新プロトコルへ置換する (M)
- [ ] Task 6: briefing-flow を新プロトコルへ置換する (M)

## Spec Deliverables

### Adapter YAML

- [ ] 必須キー（schema_version/adapter_id/protocol/scan/profile/flow_stack/classification/invocation_resolution/validation/render/artifacts/readable_outputs）を固定化する
- [ ] 推奨キー（extends/enabled/metadata）を固定化する
- [ ] `priority` キーを使用禁止（存在時 schema error）にする
- [ ] scan スキーマを scopes.<scope>.enabled/roots 形式に固定化する
- [ ] general-adapter に全主要ハーネスの各スコープ roots を集約定義する
- [ ] 既定値は `project.enabled=true`、他スコープは `false` にする
- [ ] extends はパス直書き禁止とし、参照名から references/{name}.yaml|yml を解決する
- [ ] extends の入れ子継承を許可し、最上位まで再帰解決する
- [ ] extends のマージ適用順を「最上位親 -> ... -> 直接親 -> 子 adapter」に固定化する
- [ ] extends の循環参照を schema error として検出する
- [ ] extends マージ規則（object: 再帰マージ / scalar: 後勝ち / array: 子側置換）を固定化する
- [ ] scan.scopes の enabled/roots 必須チェックを extends 全マージ後の最終結果に対して実施する
- [ ] classification は taxonomy（id/label/description/match{capabilities/tags/description_patterns}）を正規形式に固定する
- [ ] classification に unmatched(action/category/severity) を導入し矛盾組み合わせを schema error にする
- [ ] `validation.invocation.enabled` で invocation gate の一括有効/無効を制御する
- [ ] `readable_outputs` で Markdown sidecar 生成を制御する

### flow_stack

- [ ] Flow Profile に `flow_stack.slots[]`（slot_id/slot_type/activation/default）を統合する
- [ ] slot_id は `snake_case` 固定、adapter の `flow_stack.slots[]` 定義と一致
- [ ] slot_type は `layerable|exclusive`
- [ ] activation は `always|conditional|on_demand|gate`
- [ ] MVP では `default.skill` のみ許可、`default.capability` は将来拡張

### Skill Reference Catalog

- [ ] 各スキルが提供する capability（provides）を列挙する
- [ ] 各スキルが利用する capability（uses）を列挙する
- [ ] `uses[].override_allowed` で override 可否を宣言する
- [ ] `default_skill` を持てるが flow 固有の `resolved_skill` は持たない
- [ ] `execution_policy`（strictness/sequence_required/allow_step_reordering/allow_partial_application/guidance）を保持する
- [ ] flow 固有の invocation slot 定義は保持しない

### invocation_resolution

- [ ] overrides.slots のキーは `snake_case`、slot_id と一致
- [ ] overrides.capabilities のキーは `snake_case`、capability 識別子と一致
- [ ] resolution_order（slot_override/capability_override/default_skill/provider_lookup）を固定化する
- [ ] unresolved.required/optional のポリシーを固定化する
- [ ] invalid_override.* のポリシーを固定化する
- [ ] 解決結果は Flow Profile の `resolved_invocations` に保持する

### sdp CLI

- [ ] `sdp generate --adapter <adapter-yaml>` を正規入力インターフェースとする
- [ ] `sdp validate --profile <flow-profile-json>` で成果物を検証する
- [ ] `sdp validate --adapter <adapter-yaml>` で adapter 単体を検証する
- [ ] `sdp query --profile <file> <subcommand>` で情報を抽出する
- [ ] query をサブコマンドレジストリ駆動にして拡張容易性を確保する
- [ ] query に共通 profile ローダー + schema 事前検証を導入する
- [ ] `flow-stack [--slot <id>]` の抽出/フィルタを実装する
- [ ] `execution-policy [--skill <name>]` の抽出/フィルタを実装する
- [ ] `categories` / `category-skills` / `resolution` / `capability-skills` / `skill-detail` / `runtime-guidance` / `unresolved` / `validation-status` を実装する
- [ ] 未知サブコマンド時の終了コード/ヘルプ表示/候補提示を標準化する
- [ ] サブコマンド追加を 1 handler 追加で完了できる実装規約を docs 化する

### Validation & Gates

- [ ] schema gate: 必須キー・型・制約・snake_case 強制を検証する
- [ ] staleness gate: `validated_at` 基準の鮮度チェック（max_age_days/スキル増減）
- [ ] deterministic gate: Flow Profile / profile+catalog / report(timestamp除外) / MD sidecar で比較する
- [ ] blocking validations: adapter で `fail` 指定された invocation 検証を含む
- [ ] `overall_result = schema && staleness && deterministic && blocking_validations`
- [ ] 未使用 slot/override は警告記録のみ（overall に影響しない）
- [ ] `validation-report.json` の項目定義を固定化する

## Checkpoint: Replacement Complete

- [ ] implementation-flow と briefing-flow が共通プロトコルを利用している
- [ ] Flow Profile 成果物の操作が script-only に統一されている
- [ ] ゲート失敗時にフロー進行が停止する
- [ ] 2 層成果物（Skill Reference Catalog / Flow Profile）が両 flow で再現可能に生成される
- [ ] 未使用 slot/override は記録のみで、フロー停止条件になっていない
- [ ] 旧 flow が必要としていた情報を新 Flow Profile + `sdp query` から取得できる（情報等価性）

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

- [x] 共通成果物は `skill-reference-catalog + *-profile.json + validation-report` を採用
- [x] 旧 protocol は即時 deprecated（互換モードは設けない）
- [x] adapter 設定形式は YAML
- [x] adapter YAML は general のみ共通側に置き、flow 固有設定は flow 側 references パス入力で読む
- [x] `sdp generate` の入力は Adapter YAML（`--adapter`）に統一する
- [x] `sdp validate --adapter` で adapter 単体検証も可能にする
- [x] scan のスコープ別 roots は general-adapter に集約し、flow 側は差分のみ上書きする
- [x] extends は文字列配列で宣言順マージ、`priority` キーは使用禁止
- [x] extends の循環参照は schema error で停止し、最終マージ結果に対して検証する
- [x] Skill Reference Catalog は provides/uses/execution_policy を保持、flow 固有 resolved_skill は持たない
- [x] `uses[].override_allowed` で override 可否を宣言する
- [x] override 解決結果は `*-profile.json` の `resolved_invocations` に統合して扱う
- [x] 旧 default stack は `flow_stack.slots[]`（slot_type/activation/default）として Flow Profile に統合する
- [x] `sdp` のコマンド/サブコマンドは将来要件で拡張可能（現行セットは最小提案）
- [x] slot 識別子と mapping キーは `snake_case` 固定
- [x] override 検証は `sdp validate` で実施し、結果は `validation-report` に記録する
- [x] `validation.invocation.enabled` で invocation gate を一括制御可能にする
- [x] staleness は `validated_at` 基準
- [x] deterministic 比較対象は 3 種 + MD sidecar（readable_outputs 有効時）
- [x] `overall_result = schema && staleness && deterministic && blocking_validations`
- [x] テストは skill 単位で新規ファイルに分割
- [x] 置換時に旧 flow が必要としていた情報を新 Profile + query から取得できること（情報等価性）
