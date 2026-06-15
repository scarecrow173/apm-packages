# doc-driven-dev-lifecycle docs tree scaffold 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `doc-driven-dev-lifecycle` に、consumer repo の `docs/` 配下を bootstrap する scaffold 機能を追加し、Phase 1 の briefing 以前に canonical な文書ツリーを組み立てられるようにする。

**Architecture:** 既存の doc 生成ロジックは `scripts/doc-driven-dev` 側に集約されているため、scaffold も同じ build/test 流儀に乗せる。実装は 1) lifecycle skill の Phase 0/Bootstrap 契約、2) consumer repo へ実際に `docs/` ツリーを書き出す TypeScript command、3) その command を支える共通 helper、4) 分散された Markdown 記述の更新、の 4 層に分ける。scaffold は idempotent にして、既存ファイルを壊さず missing な directory と index を補うだけにする。`docs/designs/overview.md` は design-doc の専属責務として残し、scaffold では生成しない。

**Tech Stack:** TypeScript, Node.js `node:test`, `tsx`, `esbuild`, Markdown documentation, existing `doc-driven-dev` skill packaging

---

## Scope

この作業は 1 本の実装ストリームとしてまとめる。対象は `doc-driven-dev-lifecycle` の bootstrap/scaffold 能力と、それを支える `scripts/doc-driven-dev` の生成コードおよびテスト群である。

含めるもの:

- consumer repo の `docs/` 配下に canonical tree を作る scaffold command
- `doc-driven-dev-lifecycle` の Phase 0 / Bootstrap 契約
- lifecycle README と日英 skill docs の説明更新
- scaffold のユニットテストと build 確認
- `docs/designs/overview.md` は `design-doc` にのみ任せ、scaffold では作らない

含めないもの:

- `briefing-flow` / `implementation-flow` の routing 変更
- `spec-doc` / `plan-doc` / `task-doc` の個別生成ロジックの再設計
- 既存の document front matter schema 変更
- 既存 docs の内容改稿を伴う大規模な wording overhaul

---

## Upstream Documents

- `packages/doc-driven-dev/README.md`
- `packages/doc-driven-dev/README.ja.md`
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md`
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md`
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md`
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md`

## Design Inputs

- `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`
- `scripts/doc-driven-dev/build/build-skill-scripts.ts`
- `scripts/doc-driven-dev/tests/doc-suite.test.ts`
- `scripts/doc-driven-dev/tests/adr-doc.test.ts`

---

## File Map

| Path | Responsibility | Notes |
|------|----------------|-------|
| `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts` | 共通の docs tree/scaffold helper を追加する | `createDocument()` と同じ front matter / index のルールを再利用する |
| `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/scaffold_docs.ts` | scaffold command の CLI entrypoint | `--cwd` を受け、consumer repo の `docs/` を bootstrap する |
| `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-scaffold.test.ts` | scaffold の振る舞いを検証する | empty repo と partially populated repo の両方を cover する |
| `packages/doc-driven-dev/README.md` | scaffold/Phase 0 の説明を追加する | lifecycle summary に bootstrap を追記する |
| `packages/doc-driven-dev/README.ja.md` | scaffold/Phase 0 の日本語説明を追加する | 英語版と意味を揃える |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md` | lifecycle entrypoint に Phase 0 を追加する | scaffold が briefing より前に走る契約を明示する |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md` | lifecycle entrypoint の日本語版を更新する | Phase 0 の exit 条件と idempotency を記載する |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/bootstrap-contract.md` | scaffold の canonical tree 契約を定義する | 新規 reference として detailed rules を分離する |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/bootstrap-contract.ja.md` | bootstrap 契約の日本語版 | 英語版と structure を揃える |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md` | Phase 0 を含む flow contract に更新する | Phase 1 前のゲート条件を追加する |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md` | flow contract の日本語版を更新する | Phase 0 の説明を一致させる |

---

## Dependency Graph

| Step | Depends on | Blocks |
|------|------------|--------|
| A | existing doc-suite helpers | B, C |
| B | A | D |
| C | A | D |
| D | B, C | E |
| E | D | F |

Critical path は `A → B → D → E` で、helper を固めてから command を追加し、その後 docs と tests を更新する。README と skill docs の更新は command 実装と並行できるが、Phase 0 の wording は command 契約が固まってから揃える。

---

## Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | scaffold が既存の `docs/` を上書きしてしまう | medium | high | `mkdir` / `writeFile` 前に存在確認を行い、既存 content は維持する |
| 2 | Phase 0 を足した結果、既存の lifecycle 文言と README がずれる | high | medium | 英語版と日本語版を同一 task で更新し、最終的に `rg` で wording を照合する |
| 3 | canonical tree の範囲が曖昧で、実装後に追加ディレクトリが必要になる | medium | medium | scaffold 対象を bootstrap contract に固定し、未知のディレクトリは gap として記録する |
| 4 | build で新 script が配布されない | low | high | `pnpm --dir scripts/doc-driven-dev run build:scripts` を verification に入れる |
| 5 | empty repo の scaffold は通るが、partially populated repo で index 生成が壊れる | medium | medium | partially populated repo の test case を先に書く |

---

## Rollback Strategy

この変更にはデータ移行はない。rollback は新しい scaffold command と文言更新を取り消すだけで足りる。

- **Trigger:** scaffold が既存ファイルを誤って更新する、または Phase 0 文言が利用者の期待と合わない。
- **Procedure:** 新規の `scaffold_docs.ts` と関連 test を削除し、`README*` と `doc-driven-dev-lifecycle` の Phase 0 追加を revert する。生成物が `.apm/skills/**/scripts/*.js` に出ていれば build で再生成し直すか、該当 generated file を削除する。
- **Verification:** `pnpm --dir scripts/doc-driven-dev test` と `pnpm --dir scripts/doc-driven-dev run lint:md` が rollback 後に元の状態へ戻ることを確認する。

---

## Task Breakdown

### Task 1: scaffold 仕様を test で固定する

**Files:**

- Create: `scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-scaffold.test.ts`
- Modify: `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts` (必要なら helper 追加前提の import 形を確認)

- [ ] **Step 1: empty repo で作るべき docs tree を test に書く**

```ts
const expectedPaths = [
  "docs/ideas/README.md",
  "docs/discovery/README.md",
  "docs/specs/README.md",
  "docs/designs/README.md",
  "docs/plans/README.md",
  "docs/tasks/README.md",
  "docs/adr/README.md",
  "docs/impl/ir/README.md",
  "docs/impl/exp/README.md",
];
```

- [ ] **Step 2: partially populated repo では既存ファイルを壊さない test を書く**

```ts
fs.mkdirSync(path.join(repo, "docs/specs"), { recursive: true });
fs.writeFileSync(path.join(repo, "docs/specs/README.md"), "# existing\n", "utf8");
```

期待する assert:

```ts
assert.equal(fs.readFileSync(path.join(repo, "docs/specs/README.md"), "utf8"), "# existing\n");
assert.equal(fs.existsSync(path.join(repo, "docs/designs/overview.md")), false);
```

- [ ] **Step 3: scaffold command の exit code と stdout を固定する**

```ts
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /Created docs tree scaffold/);
```

- [ ] **Step 4: targeted test を実行して fail を確認する**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-scaffold.test.ts`
Expected: FAIL. `scaffold_docs.ts` がまだ存在しないため command not found 相当で落ちる。

- [ ] **Step 5: commit**

```bash
git add scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-scaffold.test.ts
git commit -m "test: define doc-driven-dev lifecycle scaffold contract"
```

### Task 2: docs tree scaffold helper と command を実装する

**Files:**

- Modify: `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`
- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/scaffold_docs.ts`

- [ ] **Step 1: canonical docs tree を helper に抽出する**

```ts
const scaffoldTargets = [
  { dir: "docs/ideas", index: "README.md" },
  { dir: "docs/discovery", index: "README.md" },
  { dir: "docs/specs", index: "README.md" },
  { dir: "docs/designs", index: "README.md" },
  { dir: "docs/plans", index: "README.md" },
  { dir: "docs/tasks", index: "README.md" },
  { dir: "docs/adr", index: "README.md" },
  { dir: "docs/impl/ir", index: "README.md" },
  { dir: "docs/impl/exp", index: "README.md" },
];
```

- [ ] **Step 2: scaffold helper を idempotent に実装する**

```ts
function scaffoldDocsTree(cwd: string): { created: string[]; updated: string[] } {
  // create missing dirs
  // create missing README files
  // do not create docs/designs/overview.md; design-doc owns it
}
```

要件:

- 既存 README は上書きしない
- `docs/designs/overview.md` は scaffold しない
- 生成したファイル一覧を返す

- [ ] **Step 3: CLI entrypoint を追加する**

```ts
#!/usr/bin/env node
const { scaffoldDocsTree } = require("../../lib/doc_suite_utils.ts");

async function main() {
  const cwd = process.cwd();
  const result = scaffoldDocsTree(cwd);
  console.log(`Created docs tree scaffold in ${cwd}`);
  for (const file of result.created) console.log(`Created ${file}`);
}
```

- [ ] **Step 4: targeted test を実行して green にする**

Run: `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-scaffold.test.ts`
Expected: PASS. empty repo と partially populated repo の両方で scaffold が idempotent に動く。

- [ ] **Step 5: script 配布を再生成する**

Run: `pnpm --dir scripts/doc-driven-dev run build:scripts`
Expected: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/scaffold_docs.js` が生成される。

- [ ] **Step 6: commit**

```bash
git add scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/scaffold_docs.ts packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/scaffold_docs.js scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-scaffold.test.ts
git commit -m "feat: add lifecycle docs tree scaffold"
```

### Task 3: lifecycle 文書に Phase 0 / Bootstrap を反映する

**Files:**

- Modify: `packages/doc-driven-dev/README.md`
- Modify: `packages/doc-driven-dev/README.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/bootstrap-contract.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/bootstrap-contract.ja.md`

- [ ] **Step 1: Phase 0 の文言を README と SKILL に反映する**

```markdown
Phase 0: Bootstrap / Scaffold
- consumer repo の canonical な `docs/` tree を作る
- 既存ファイルを壊さず、以後の briefing と planning の前提を整える
```

- [ ] **Step 2: bootstrap contract を reference に切り出す**

```markdown
Contract topics:
- canonical directories
- idempotency
- existing-file preservation
- `docs/designs/overview.md` は scaffold の責務外であること
- command output expectations
```

- [ ] **Step 3: flow contract の phase table を更新する**

```markdown
| 0 | docs/ tree を bootstrap する | scaffold-docs | canonical docs tree が存在し、既存 content を壊さない |
```

- [ ] **Step 4: 日英の文言を同一意味で揃える**

```markdown
英語版と日本語版で次の意味を一致させる:
- scaffold は briefing の前に動く
- scaffold は docs tree の missing 部分だけを補う
- scaffold は lifecycle の entrypoint を置き換えない
```

- [ ] **Step 5: Markdown lint を実行する**

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS. 触った lifecycle docs と README に markdownlint regression がない。

- [ ] **Step 6: commit**

```bash
git add packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/bootstrap-contract.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/bootstrap-contract.ja.md
git commit -m "docs: add lifecycle docs tree bootstrap phase"
```

### Task 4: 回帰と配布を確認する

**Files:**

- No new source files
- Verify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/scaffold_docs.js`

- [ ] **Step 1: build 後の distributed script を確認する**

Run: `Get-ChildItem -Path "F:\repositry\apm-packages\packages\doc-driven-dev\.apm\skills\doc-driven-dev-lifecycle\scripts" -Force`
Expected: `scaffold_docs.js` が存在する。

- [ ] **Step 2: full test suite を実行する**

Run: `pnpm --dir scripts/doc-driven-dev test`
Expected: PASS。既存の doc creation / audit / discovery テストに回帰がない。

- [ ] **Step 3: markdown lint を再実行する**

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS。README と lifecycle docs の wording が整合している。

- [ ] **Step 4: commit**

```bash
git add packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/*.md scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts scripts/doc-driven-dev/src/skills/doc-driven-dev-lifecycle/scripts/scaffold_docs.ts scripts/doc-driven-dev/tests/doc-driven-dev-lifecycle-scaffold.test.ts packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/scaffold_docs.js
git commit -m "test: verify doc-driven-dev lifecycle scaffold"
```

---

## Verification

| Step | Verification command or criteria | Pass condition |
|------|----------------------------------|----------------|
| Task 1 | `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-scaffold.test.ts` | scaffold test fails before implementation |
| Task 2 | `pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-driven-dev-lifecycle-scaffold.test.ts` | scaffold test passes after helper + command implementation |
| Task 2 | `pnpm --dir scripts/doc-driven-dev run build:scripts` | `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/scripts/scaffold_docs.js` is generated |
| Task 3 | `pnpm --dir scripts/doc-driven-dev run lint:md` | markdownlint passes on touched docs |
| Task 4 | `pnpm --dir scripts/doc-driven-dev test` | full suite stays green |
| Task 4 | `pnpm --dir scripts/doc-driven-dev run lint:md` | docs wording remains consistent after all edits |

---

## Open Questions / Gaps

- canonical docs tree は `docs/ideas` と `docs/discovery` を含める。
- scaffold の command 名を `scaffold_docs` にするか `bootstrap_docs` にするかは、実装時に CLI の語感を見て最終決定する。計画上は scaffold という意味に固定する。
- `docs/designs/overview.md` は `design-doc` にのみ任せ、scaffold では作成しない。

---

## Self-Review

- [ ] 仕様カバレッジ: Phase 0 / Bootstrap, canonical docs tree, idempotency, README 更新, generated script 配布, `overview.md` 非生成をすべて Task に落とした。
- [ ] Placeholder scan: `TODO`, `TBD`, `implement later`, `add validation` のような曖昧語を本文から除去した。
- [ ] 一貫性チェック: `doc-driven-dev-lifecycle`, `scaffold_docs`, `docs/designs/overview.md`, `build:scripts`, `lint:md` の用語を全体で統一した。

---

## Review Handoff

- 前提: consumer repo の `docs/` tree を bootstrap するのが目的で、package 自身の docs ではない。
- 前提: scaffold は既存コンテンツを壊さず、missing 部分だけを補う。
- 残件: なし。canonical docs tree は `docs/ideas` と `docs/discovery` を含める前提で確定し、`docs/designs/overview.md` は design-doc に委ねる。
- 参照すべき upstream: `packages/doc-driven-dev/README.md`, `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md`, `scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`
