# runtime_guidance 選択拡張 実装計画

> **エージェント向け:** 必須サブスキル: `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` を使い、この計画をタスクごとに実装してください。進捗管理にはチェックボックス (`- [ ]`) を使います。

**Goal:** `runtime_guidance` を、flow が現在のタスクや状況に応じて候補スキルを選ぶためのソフトな選択シグナルとして使えるようにする。

**Architecture:** `execution_policy` をハード制約の層として維持しつつ、`runtime_guidance` を候補の優先順位に影響できる構造化メタデータへ拡張する。`skill-discovery-protocol` はこのメタデータを flow profile に載せ、flow スキルは profile 読み込み後にそれを参照する。あいまいさが残る場合は決定論的なタイブレークで安定性を保つ。

**Tech Stack:** Markdown ドキュメント、`src/skills/skill-discovery-protocol/scripts` 配下の TypeScript、生成済み `.apm` JavaScript、`tests/skills/skill-discovery-protocol` の既存テスト群

---

## Task 1: `runtime_guidance` を選択シグナルとして定義する

**Files:**

- Modify: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/overview.md`
- Modify: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/flow-profile.md`
- Modify: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/skill-reference-catalog.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/schema-reference.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/protocol-contract.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/schema-reference.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/cli-reference.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/assets/templates/briefing-profile-template.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/assets/templates/briefing-profile-template.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/assets/templates/implementation-profile-template.ja.md`

- [ ] **Step 1: 新しい優先順位ルールを明示する**

候補選択の順序を以下のようにドキュメントへ明記する:

```text
1. execution_policy をハード制約として適用する
2. 残った候補を runtime_guidance で順位付けする
3. classification + slot 順 + skill 名で決定論的にタイブレークする
```

- [ ] **Step 2: 順位付けに使う runtime_guidance のペイロードを定義する**

profile の例と schema の説明を、単なる自由文ではなく構造化された guidance entry に更新する:

```json
{
  "skill": "documentation-and-adrs",
  "context": "adr_authoring",
  "guidance": "タスクがアーキテクチャ寄りで、成果物が意思決定記録である場合に優先する。",
  "priority_delta": 20,
  "prefer_when": ["adr_authoring", "design_decision"],
  "avoid_when": ["pure_copy_edit"]
}
```

- [ ] **Step 3: フォールバック動作を明確にする**

`runtime_guidance` が存在しない、または候補を十分に差別化できない場合は、flow が決定論的な profile データだけで動くことを明記する:

```text
flow_stack -> classification -> resolved_invocations -> execution_policy -> stable tie-break
```

この挙動は英語版と日本語版の flow ドキュメントの両方に反映する。

## Task 2: データモデルと profile 生成を拡張する

**Files:**

- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/types.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/schemas/inference.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/schemas/catalog.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/schemas/profile.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/inference.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/profile.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/resolver.ts`
- Create: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/runtime_guidance_ranker.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/query/runtime_guidance.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/query/resolution.ts`
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/query/loader.ts`

- [ ] **Step 1: 構造化された runtime_guidance の型を追加する**

candidate ranking に使える、表示用の自由文よりも豊かな shared type を導入する:

```ts
export type RuntimeGuidance = {
  skill: string;
  context: string;
  guidance: string;
  priority_delta: number;
  prefer_when: string[];
  avoid_when: string[];
};
```

この形を inference、catalog、profile の各 schema に通して、runtime profile が自由文の再解釈なしに guidance を運べるようにする。

- [ ] **Step 2: runtime_guidance を「解決後メモ」から「候補メタデータ」に変える**

profile 生成を、`resolved_invocations` だけに依存する形から、候補集合に対して guidance を適用できる形へ変更する。flow が final choice を固める前に guidance を参照できるようにするのが目的。

以下のような決定論的なシグネチャを持つ helper を導入する:

```ts
rankCandidates(candidates, guidanceEntries, executionPolicies) -> rankedCandidates
```

この helper は次を行う:

```text
1. execution_policy に違反する候補を除外する
2. skill/context が一致する guidance の delta を加点する
3. 同点は決定論的な順序を維持する
```

- [ ] **Step 3: 既存の resolver 動作をフォールバックとして維持する**

候補集合に適用可能な guidance がない場合は、resolver は現状と同じ決定論的な結果を返す。これにより、新しい ranking signal を段階的に導入しつつ互換性を維持できる。

## Task 3: flow に runtime_guidance を参照させ、テストで固定する

**Files:**

- Modify: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/SKILL.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/SKILL.ja.md`
- Modify: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/generate.test.ts`
- Modify: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/query.test.ts`
- Modify: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/query-regression.test.ts`
- Modify: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/integration.test.ts`
- Create: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/runtime-guidance-ranking.test.ts`

- [ ] **Step 1: flow の指示を、execution_policy の後に runtime_guidance を読む形へ更新する**

flow のドキュメントでは、active stack の組み立てを次の順で説明する:

```text
flow_stack を読む
execution_policy を確認する
runtime_guidance を読む
候補を順位付けする
active skill stack を宣言する
```

これにより、ハード制約が先で、runtime_guidance が明示的なソフト選択子であることが分かる。

- [ ] **Step 2: guidance-aware ranking の focused test を追加する**

少なくとも次のケースをカバーする専用テストファイルを追加する:

```text
runtime_guidance が一方の候補を他方より優先する
execution_policy が不適格候補を順位付け前に除外する
同点は決定論的順序にフォールバックする
guidance が無い場合は現状の挙動を維持する
```

- [ ] **Step 3: 既存の query と integration テストを更新する**

query テストでは `runtime-guidance` が新しい構造化 shape を返すことを確認し、integration テストでは guidance を持つ profile で候補順が変わる一方、解決済みスキル自体は意図通りに保たれることを確認する。

## Task 4: ビルド・検証・差分確認を行う

**Files:**

- Test: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/*.ts`
- Test: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/scripts/*.js`
- Test: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/*.test.ts`
- Test: `packages/doc-driven-dev-apm/docs/specs/skills/skill-discovery-protocol/*.md`

- [ ] **Step 1: バンドル済みスクリプトを再生成する**

実行:

```bash
pnpm run build:scripts
```

期待結果: 生成済みの `.apm/skills/skill-discovery-protocol/scripts/*.js` に、新しい runtime-guidance-aware の挙動が反映される。

- [ ] **Step 2: focused test set を実行する**

実行:

```bash
pnpm -s exec tsx --test \
  tests/skills/skill-discovery-protocol/runtime-guidance-ranking.test.ts \
  tests/skills/skill-discovery-protocol/generate.test.ts \
  tests/skills/skill-discovery-protocol/query.test.ts \
  tests/skills/skill-discovery-protocol/query-regression.test.ts \
  tests/skills/skill-discovery-protocol/integration.test.ts
```

期待結果: exit `0`

- [ ] **Step 3: profile と flow ドキュメントを spot-check する**

更新後のドキュメントが一貫して次を表していることを確認する:

```text
execution_policy = hard constraints
runtime_guidance = soft ranking signal
```

あわせて、profile の例が `resolved_invocations` の決定論性を保っていること、そして新しい guidance フィールドが曖昧さを導入していないことを確認する。

