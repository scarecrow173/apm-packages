# Phase 1: Foundation

## Task 1: 共通 discovery 契約を定義する

**Description:**
`skill-discovery-protocol` が扱う入力（scan source, classification policy, activation policy）と
出力（profile artifact, validation report）の共通契約を定義する。flow 固有のカテゴリ語彙は
拡張ポイントとして分離し、プロトコル本体は中立化する。

**Acceptance criteria:**

- [ ] プロトコルの canonical steps（load_adapter/scan_skills/build_skill_reference_catalog/classify_skills/resolve_invocations/build_flow_profile/render_outputs/validate_outputs）が定義される
- [ ] scan スキーマで project/user/organization/builtin の複数スコープを扱える
- [ ] 既定設定が `project` のみ有効であることが明文化される
- [ ] `scan.scopes.<scope>.enabled/roots` の契約が定義され、`general-adapter` に全主要ハーネスの roots を集約している
- [ ] flow 固有カテゴリを taxonomy + `classification.unmatched` として差し替え可能な設定モデルが定義される
- [ ] 生成物と検証レポートのフォーマットが明文化される

**Verification:**

- [ ] 規約文書レビューで `implementation-flow` 依存語が本体契約に残っていないことを確認
- [ ] `pnpm run lint:md` が通る

**Dependencies:** None

**Files likely touched:**

- `.apm/skills/skill-discovery-protocol/SKILL.md`
- `.apm/skills/skill-discovery-protocol/SKILL.ja.md`
- `.apm/skills/skill-discovery-protocol/references/protocol-contract.md`
- `.apm/skills/skill-discovery-protocol/references/protocol-contract.ja.md`

---

## Task 2: スクリプト駆動の成果物操作ルールを定義する

**Description:**
成果物の作成・更新・再検証を手動編集禁止にし、必ず script command を経由させる運用規約と
ゲート条件を定義する。合わせて build 経路（`src/skills/**/scripts/*.ts` → `.apm/skills/**/scripts/*.js`）との
整合を設計する。

**Acceptance criteria:**

- [ ] 「成果物操作は script only」の規約が英日で記載される
- [ ] 生成スクリプト、更新スクリプト、検証スクリプトの責務分離が定義される
- [ ] ゲート失敗時の終了コードとエラーメッセージ方針が定義される
- [ ] adapter YAML スキーマ（必須キー群 + 追加推奨キー）が定義される
- [ ] adapter YAML の `flow_stack.slots[]` スキーマ（slot_type/activation/default）が定義される
- [ ] `invocation_resolution` は Flow Profile の `resolved_invocations` 生成規約として明文化される
- [ ] slot 識別子と mapping キーの命名規約が `snake_case` 固定で定義される
- [ ] `snake_case` でない capability / slot_id / override key は schema error とする検証規約が定義される
- [ ] Skill Reference Catalog の `execution_policy` 契約が定義される
- [ ] `extends` はパス直書きを禁止し、参照名解決（`references/{name}.yaml|yml`）で定義される
- [ ] `scan.scopes` を `general-adapter` 集約 + flow 差分上書きで解決する規約が定義される
- [ ] `classification.taxonomy` と `classification.unmatched` の検証規約が定義される
- [ ] script 経由操作の CLI 面を `sdp generate` / `sdp validate` / `sdp query` に分離する規約が定義される

**Verification:**

- [ ] 規約文書に manual edit 禁止と例外条件が明記されている
- [ ] `pnpm run lint:md` が通る
- [ ] スキーマ不足キー時に schema gate が失敗することを fixture で確認する
- [ ] 入れ子 `extends` を最上位から順に解決できることを fixture で確認する
- [ ] `extends` 循環参照が schema gate で失敗することを fixture で確認する
- [ ] `scan.scopes` の `enabled=true` かつ `roots` 空が最終マージ結果で検出されることを fixture で確認する

**Dependencies:** Task 1

**Files likely touched:**

- `.apm/skills/skill-discovery-protocol/references/operation-policy.md`
- `.apm/skills/skill-discovery-protocol/references/operation-policy.ja.md`
- `.apm/skills/skill-discovery-protocol/references/gate-spec.md`
- `.apm/skills/skill-discovery-protocol/references/gate-spec.ja.md`
- `.apm/skills/skill-discovery-protocol/references/general-adapter.yaml`

---

## Checkpoint: Foundation

- [ ] プロトコル本体仕様が flow 非依存で定義されている
- [ ] script-only 運用とゲート仕様が確定している
- [ ] 人間レビューで「汎用化方針」に合意できる
