# Deep-Dive Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `doc-driven-dev-apm` に、コードベース調査と一問ずつのソクラテス問答でユーザーの意図・制約・判断軸を深掘りする `deep-dive` スキルを追加する。また `adr-doc` は discovery や深掘りを持たない、ADR を文章化する専用スキルに整理する。

**Architecture:** `deep-dive` は `.apm/skills/deep-dive/` に置く純 Markdown の discovery skill とし、成果物は確認済みの intent 要約に限定する。内容は `mattpocock/skills` の `grill-me` が持つ「一問ずつ」「各質問に推奨回答を添える」「コードで答えられる問いは先に調査する」を取り込む。`adr-doc` は別責務として、与えられた判断材料を ADR に落とし込む文章化スキルへ縮退させる。ADR に必要な情報が欠ける場合、`adr-doc` は自分で深掘りせず、不足入力をユーザーまたは他エージェントへ request する。

**Tech Stack:** Markdown skill docs, localized `SKILL.md` / `SKILL.ja.md`, package README / AGENTS updates, Node test runner (`tsx --test`) for packaging regression checks.

---

### Task 1: `deep-dive` の導線と責務を定義する

**Files:**
- Modify: `packages/doc-driven-dev-apm/README.md`
- Modify: `packages/doc-driven-dev-apm/README.ja.md`
- Modify: `packages/doc-driven-dev-apm/AGENTS.md`

- [ ] **Step 1: README の skill 一覧に `deep-dive` を追加する**

`deep-dive` を独立した discovery skill として README に追加する。

```md
- `deep-dive`: interrogate intent, constraints, and decision axes through codebase-aware, one-question-at-a-time dialogue.
```

- [ ] **Step 2: README 本文に `deep-dive` の入出力を書く**

他スキルとの比較ではなく、`deep-dive` 自身の責務だけを定義する。

```md
### `deep-dive`

Use this skill when the request needs deeper interrogation before downstream
documents are trustworthy. It clarifies the real outcome, the binding
constraints, and the decision axes through codebase-aware dialogue. The output
is a confirmed intent summary; it does not create a discovery artifact by
itself.
```

- [ ] **Step 3: package AGENTS に workflow skill として追加する**

workflow skill 一覧へ追加し、コード生成ではなく対話主導の discovery skill であることを示す。

```md
| `deep-dive` | Codebase-aware interrogation of user intent, constraints, and decision axes | adapted from local Superpowers pattern + grill-me style |
```

- [ ] **Step 4: README 英日同期の確認観点を固定する**

英語版と日本語版で次を揃える。

```text
- `deep-dive`
- confirmed intent
- decision axes
- one question at a time
- codebase-aware / コードベース調査
```

### Task 2: `deep-dive` スキル本体を英日で追加する

**Files:**
- Create: `packages/doc-driven-dev-apm/.apm/skills/deep-dive/SKILL.md`
- Create: `packages/doc-driven-dev-apm/.apm/skills/deep-dive/SKILL.ja.md`

- [ ] **Step 1: 英語版 `SKILL.md` の front matter を作る**

スキル名は `deep-dive` で固定する。

```md
---
name: deep-dive
description: Use when the request needs deeper interrogation. Explore the codebase first, then ask one question at a time with a hypothesis and a recommended answer until the human confirms a concrete statement of intent and decision criteria.
license: MIT
---
```

- [ ] **Step 2: スキルの中核プロセスを 5 段階で定義する**

少なくとも以下を含める。

```md
1. Scan the codebase first when repository evidence can answer part of the question.
2. State a hypothesis and confidence number.
3. Ask one question at a time with:
   - Q:
   - GUESS:
   - RECOMMENDED:
4. Walk the design tree branch-by-branch until you can predict the next three reactions.
5. Restate the confirmed intent with outcome, user, why now, success, constraint, decision axes, and out of scope.
```

- [ ] **Step 3: `grill-me` 由来の原則を明文化する**

`deep-dive` の運用ルールを短く固定する。

```md
If a question can be answered by exploring the codebase, do that first.
Do not ask the human to restate facts already visible in the repository.
For each live question, provide your current guess and the recommendation you
would make if the user asked you to decide right now.
```

- [ ] **Step 4: 出力契約を confirmed intent に固定する**

出力は discovery artifact ではなく、会話上で確認された要約にする。

```md
Here's what I now think you want:

- Outcome:
- User:
- Why now:
- Success:
- Constraint:
- Decision axes:
- Out of scope:

Yes / no / refine?
```

- [ ] **Step 5: 日本語版 `SKILL.ja.md` を同構造で追加する**

訳語は次で固定する。

```text
confirmed intent -> 確認済み intent
guess -> 仮説
recommended answer -> 推奨回答
binding constraint -> 支配的制約
decision axes -> 判断軸
out of scope -> スコープ外
```

### Task 3: `adr-doc` を ADR 文章化専用スキルに縮退させる

**Files:**
- Modify: `packages/doc-driven-dev-apm/.apm/skills/adr-doc/SKILL.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/adr-doc/SKILL.ja.md`

- [ ] **Step 1: `adr-doc` から discovery / ソクラテス問答を削除する**

`adr-doc` の責務を「与えられた判断材料を ADR に文章化すること」に限定する。

```md
This skill does not perform broad discovery, ideation, or Socratic requirement
clarification. Use it when the decision is already concrete enough to be
written as an ADR, or when the missing inputs can be enumerated precisely.
```

- [ ] **Step 2: `adr-doc` の不足時挙動を request-only に固定する**

情報が足りなければ、自分で深掘りせず request を返す方針を明示する。

```md
If the ADR cannot be written completely, stop and produce a missing-input
request that names:
- what information is missing
- why the ADR needs it
- whether it should come from the user, another agent, or repository evidence
```

- [ ] **Step 3: `adr-doc` の出力モードを 2 つに限定する**

ADR 草案か、不足入力 request かのどちらかだけにする。

```md
Output mode A: Draft the ADR.
Output mode B: Emit a missing-input request instead of drafting incomplete ADR text.
```

- [ ] **Step 4: ADR 文章化に必要な最小入力を明文化する**

少なくとも以下が必要であることを `adr-doc` に書く。

```text
- decision title
- trigger / why now
- constraints
- options or chosen direction
- consequences
- implementation scope
- verification expectations
```

- [ ] **Step 5: 日本語版も同じ責務に揃える**

英日で次を一致させる。

```text
- `adr-doc` は ADR を文章化する
- `adr-doc` は深掘りしない
- `adr-doc` は足りない入力をユーザーまたは他エージェントへ request する
```

### Task 4: 回帰テストで責務分離を固定する

**Files:**
- Create: `packages/doc-driven-dev-apm/tests/deep-dive.test.ts`
- Modify: `packages/doc-driven-dev-apm/package.json`

- [ ] **Step 1: `deep-dive` の packaging テストを追加する**

英日双方の skill ファイル、front matter、主要キーワードを検証する。

```ts
test("deep-dive skill exists in both locales", () => {
  const en = fs.readFileSync(path.resolve(__dirname, "../.apm/skills/deep-dive/SKILL.md"), "utf8");
  const ja = fs.readFileSync(path.resolve(__dirname, "../.apm/skills/deep-dive/SKILL.ja.md"), "utf8");

  assert.match(en, /^name: deep-dive$/m);
  assert.match(ja, /^name: deep-dive$/m);
  assert.match(en, /Ask one question at a time/i);
  assert.match(en, /If a question can be answered by exploring the codebase/i);
  assert.match(ja, /一問ずつ/);
  assert.match(ja, /コードベース/);
});
```

- [ ] **Step 2: `adr-doc` の責務縮退を固定するテストを追加する**

`adr-doc` が `deep-dive` を参照しつつ、自分では discovery をしないことを検証する。

```ts
test("adr-doc references deep-dive and request-only fallback", () => {
  const adr = fs.readFileSync(path.resolve(__dirname, "../.apm/skills/adr-doc/SKILL.md"), "utf8");

  assert.match(adr, /deep-dive/);
  assert.match(adr, /missing-input request/i);
  assert.doesNotMatch(adr, /Full Socratic Interview/i);
});
```

- [ ] **Step 3: 対象テストを先に回す**

```bash
pnpm -C .\packages\doc-driven-dev-apm exec tsx --test tests/deep-dive.test.ts
```

期待結果:

```text
PASS packages/doc-driven-dev-apm/tests/deep-dive.test.ts
```

- [ ] **Step 4: 既存テスト群への副作用がないことを確認する**

```bash
pnpm -C .\packages\doc-driven-dev-apm exec tsx --test tests/adr-doc.test.ts tests/doc-suite.test.ts tests/deep-dive.test.ts
```

期待結果:

```text
All selected tests pass with exit code 0.
```

### Task 5: 最終同期と検証を完了する

**Files:**
- Modify: `packages/doc-driven-dev-apm/README.md`
- Modify: `packages/doc-driven-dev-apm/README.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/deep-dive/SKILL.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/deep-dive/SKILL.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/adr-doc/SKILL.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/adr-doc/SKILL.ja.md`

- [ ] **Step 1: Markdown lint を回す**

```bash
pnpm -C .\packages\doc-driven-dev-apm run lint:md
```

期待結果:

```text
exit 0
```

- [ ] **Step 2: package テストを回す**

```bash
pnpm -C .\packages\doc-driven-dev-apm test
```

期待結果:

```text
exit 0
```

- [ ] **Step 3: 英日構造同期を目視確認する**

確認観点は次のとおり。

```text
- 見出し順が一致している
- `deep-dive` の役割説明が一致している
- `adr-doc` が文章化専用になっている
- `adr-doc` の不足時挙動が request に統一されている
- `grill-me` 由来の「一問ずつ」「推奨回答付き」「コードで答えられる問いは先に調査」が両言語に入っている
```

- [ ] **Step 4: 実装サマリで責務分離を明記する**

最終報告では少なくとも次を明記する。

```text
- `deep-dive`: intent / constraints / decision axes extraction
- `adr-doc`: ADR drafting and missing-input requests
```

## Self-Review

1. **Spec coverage:** この計画は、新規 workflow skill `deep-dive` の追加、`adr-doc` の ADR 文章化専用化、不足入力 request モードの追加、README/AGENTS の導線更新、最小限の packaging regression test までを含んでいる。新しい doc type や CLI はスコープ外として意図的に外している。

2. **Placeholder scan:** `TBD`、`TODO`、曖昧な「あとで決める」は残していない。新スキル名、ファイルパス、検証コマンドは固定した。

3. **Type consistency:** 新スキル名は全文で `deep-dive` に統一し、責務語彙は `confirmed intent`、`decision axes`、`one question at a time`、`recommended answer`、`codebase-aware` で揃えている。`adr-doc` は ADR drafting と missing-input request だけを担い、discovery をしない構成で一貫している。

## Execution Handoff

Plan complete and saved to `packages/doc-driven-dev-apm/docs/superpowers/plans/2026-06-09-deep-dive-skill.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
