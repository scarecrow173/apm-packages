# Phase 2: Vertical Slices

## Task 3: 共通生成パイプラインを実装する

**Description:**
`classify -> render` を一気通貫で実行し、対象プロファイルを出力する共通スクリプト群を実装する。
同一入力で安定ソート・安定レンダリングを保証し、冪等な成果物更新を実現する。

**Acceptance criteria:**

- [ ] adapter YAML を入力に共通生成コマンドで Flow Profile を新規生成できる
- [ ] adapter YAML を入力に既存 Flow Profile の更新コマンドが動作する
- [ ] `sdp scan` / `sdp infer` / `sdp profile` で profile/catalog/report の生成・更新が実行できる
- [ ] 同一入力で再実行したときファイル差分が発生しない
- [ ] `skill-reference-catalog.md/.json` がプロトコル成果物として生成される
- [ ] `*-profile.json`（Flow Profile）が生成され、`resolved_invocations` を保持する
- [ ] `*-profile.json`（Flow Profile）が生成され、`flow_stack.slots[]` を保持する
- [ ] Skill Reference Catalog に `execution_policy` が出力される
- [ ] `sdp query --profile <file> categories|category-skills|resolution|flow-stack|execution-policy` が動作する
- [ ] プロトコル成果物の並び順が安定し、再実行で順序差分が出ない

**Verification:**

- [ ] `pnpm run build:scripts` 後に `.apm/skills/skill-discovery-protocol/scripts/*.js` が生成される
- [ ] テストで 2 回連続実行して出力一致を確認
- [ ] `pnpm test` が通る
- [ ] 生成結果に Skill Reference Catalog と Flow Profile が含まれることをテストで確認

**Dependencies:** Task 2

**Files likely touched:**

- `src/skills/skill-discovery-protocol/scripts/new_profile.ts`
- `src/skills/skill-discovery-protocol/scripts/update_profile.ts`
- `src/skills/skill-discovery-protocol/scripts/query_profile.ts`
- `src/skills/skill-discovery-protocol/scripts/lib/*.ts`
- `.apm/skills/skill-discovery-protocol/assets/templates/profile-template.md`
- `tests/doc-suite.test.ts`

---

## Task 3A: Query サブコマンド拡張

**Description:**
`sdp query` の拡張を安全に継続できるよう、サブコマンド実装をレジストリ駆動にし、
Flow Profile と Skill Reference Catalog の抽出ロジックを責務分離して実装する。

**Acceptance criteria:**

- [ ] query エントリポイントにサブコマンドレジストリ（name -> handler）を導入する
- [ ] 共通入力層として profile ローダーと schema 事前検証を実装する
- [ ] 共通出力層として `json|md|table` のレンダラ抽象を実装する
- [ ] 既存サブコマンド（`categories` / `category-skills` / `resolution`）をレジストリ構成へ移設する
- [ ] 新規 `flow-stack` ハンドラを実装し、`--slot` フィルタをサポートする
- [ ] 新規 `execution-policy` ハンドラを実装し、`--skill` フィルタをサポートする
- [ ] `capability-skills` / `skill-detail` / `runtime-guidance` / `unresolved` / `validation-status` を実装する
- [ ] 未知サブコマンド時の終了コード/ヘルプ表示/候補提示のエラー規約を実装する
- [ ] サブコマンド追加時に 1 ファイル追加で拡張できる開発規約を docs に明記する

**Verification:**

- [ ] 既存サブコマンド回帰テスト（正常/該当なし/入力不正）が pass
- [ ] `flow-stack --slot` と `execution-policy --skill` のフィルタテストが pass
- [ ] 未知サブコマンド時に非 0 終了 + ヘルプ表示となることをテストで確認
- [ ] サブコマンド追加テンプレートに従った最小追加でテストが pass

**Dependencies:** Task 3

**Files likely touched:**

- `src/skills/skill-discovery-protocol/scripts/query_profile.ts`
- `src/skills/skill-discovery-protocol/scripts/lib/query/*.ts`
- `src/skills/skill-discovery-protocol/scripts/lib/render/*.ts`
- `tests/skills/skill-discovery-protocol/query/*.test.ts`

---

## Task 4: 再現性と厳格性のゲートを実装する

**Description:**
schema 検証、staleness 検証、deterministic 検証（再実行差分ゼロ）を行うゲートスクリプトを実装し、
プロトコル運用の品質下限を自動で強制する。

**Acceptance criteria:**

- [ ] `sdp validate` コマンドで schema 違反を検出できる
- [ ] stale チェックで `validated_at` 基準の 30 日超過・スキル増減を検出できる
- [ ] deterministic チェックで順序ゆらぎと不安定レンダリングを検出できる
- [ ] validate コマンドで Skill Reference Catalog の整合性を検証できる
- [ ] `resolved_invocations` の検証で未使用/未解決 slot は警告記録される
- [ ] `validation-report` に全検証結果が出力される
- [ ] `overall_result` が `schema && staleness && deterministic && blocking_validations` で算出される
- [ ] `*-profile.json` の schema と query 応答形式を検証できる
- [ ] `flow_stack.slots[]` と `execution_policy` の schema を検証できる

**Verification:**

- [ ] 異常 fixture を使った失敗ケースがテスト化される
- [ ] 正常ケースで gate コマンドが 0 終了する
- [ ] `sdp validate` 正常で終了コード 0、失敗時は非 0
- [ ] `pnpm test` が通る
- [ ] override 有/無の両 fixture で Flow Profile の `resolved_invocations` を検証するテストが pass
- [ ] 未使用 slot fixture で「警告記録されるが停止しない」ことをテストで確認
- [ ] 入れ子 `extends` のマージ規則が期待どおり適用されることを fixture で確認
- [ ] `extends` の解決順が正しいことをテストで確認
- [ ] `sdp query` の主要サブコマンドが正しく抽出することをテストで確認

**Dependencies:** Task 3, Task 3A

**Files likely touched:**

- `src/skills/skill-discovery-protocol/scripts/validate_profile.ts`
- `src/skills/skill-discovery-protocol/scripts/check_staleness.ts`
- `src/skills/skill-discovery-protocol/scripts/check_idempotency.ts`
- `.apm/skills/skill-discovery-protocol/references/profile-schema.md`
- `tests/doc-suite.test.ts`

---

## Task 5: implementation-flow を新プロトコルに置換する

**Description:**
`implementation-flow` の discovery 記述を新スキル呼び出しに置換し、
profile 生成/更新/検証を共通スクリプト経由に統一する。

**Acceptance criteria:**

- [ ] `implementation-flow` が `skill-discovery-protocol` を参照する
- [ ] `implementation-profile.md` の操作が script command に置き換わる
- [ ] 旧 protocol 参照を即時削除し、互換モードを設けない
- [ ] 旧 flow が必要としていた情報を新 Flow Profile + `sdp query` から取得できる（情報等価性）

**Verification:**

- [ ] 置換後に `implementation-profile` 生成テストが pass
- [ ] 既存 `implementation-flow` 関連テストが回帰しない
- [ ] `pnpm test` が通る

**Dependencies:** Task 4

**Files likely touched:**

- `.apm/skills/implementation-flow/SKILL.md`
- `.apm/skills/implementation-flow/SKILL.ja.md`
- `.apm/skills/implementation-flow/references/skill-discovery-protocol.md`
- `.apm/skills/implementation-flow/references/skill-discovery-protocol.ja.md`

---

## Task 6: briefing-flow を新プロトコルに置換する

**Description:**
`briefing-flow` でも discovery 記述を共通プロトコル参照へ移行し、
`briefing-profile.md` のライフサイクルを script + gate で管理する。

**Acceptance criteria:**

- [ ] `briefing-flow` が共通運用へ切り替わる
- [ ] `briefing-profile.md` の操作が script-only で定義される
- [ ] Entry Decision による上位ロジックは保持される
- [ ] 旧 flow が必要としていた情報を新 Flow Profile + `sdp query` から取得できる（情報等価性）

**Verification:**

- [ ] 置換後に `briefing-profile` 生成/検証テストが pass
- [ ] `briefing-flow` completion gate の要件が維持される
- [ ] `pnpm test` が通る

**Dependencies:** Task 4

**Files likely touched:**

- `.apm/skills/briefing-flow/SKILL.md`
- `.apm/skills/briefing-flow/SKILL.ja.md`
- `.apm/skills/briefing-flow/references/briefing-discovery-protocol.md`
- `.apm/skills/briefing-flow/references/briefing-discovery-protocol.ja.md`

---

## Checkpoint: Replacement Complete

- [ ] implementation-flow / briefing-flow の両方が共通プロトコルを利用している
- [ ] profile 成果物更新が script-only で統一されている
- [ ] ゲート未通過時に flow が進行しないことを確認できる
- [ ] 2 層成果物が両 flow で再現可能に出力される
