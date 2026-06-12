# doc-driven-dev Semantic Evaluation Fixes 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `doc-driven-dev` パッケージの semantic evaluation スコアを改善するため、lifecycle contract のずれ、trust boundary の不明瞭さ、meta-skill の過剰に強い活性化文言、`doc-status` の report output 未定義、`adr-doc` の context bloat を修正する。

**Architecture:** 変更は既存のパッケージ境界内に留める。workflow skill は引き続き `packages/doc-driven-dev/.apm/skills` 配下の純 Markdown とし、package-level explanation は `README*` と `AGENTS*` に置く。基本方針は behavioral rewrite ではなく documentation contract の修正を優先し、`SKILL.md` と `references/` の間で内容を移す場合も、package model を変えずに ambiguity と context weight を下げる目的に限定する。

**Tech Stack:** Markdown documentation, YAML adapter configuration, doc-driven-dev workflow skills, `pnpm --dir scripts/doc-driven-dev` validation commands

---

## File Structure

- `packages/doc-driven-dev/README.md`
  パッケージ全体の英語 lifecycle / trust-boundary 概要。
- `packages/doc-driven-dev/README.ja.md`
  パッケージ概要の日本語版。
- `packages/doc-driven-dev/AGENTS.md`
  パッケージ保守ルール、script trust boundary、validation workflow。
- `packages/doc-driven-dev/AGENTS.ja.md`
  パッケージ保守ルールの日本語版。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md`
  lifecycle entrypoint contract と phase gate。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md`
  lifecycle entrypoint contract の日本語版。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md`
  詳細な英語 lifecycle reference。
- `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md`
  詳細な日本語 lifecycle reference。
- `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.md`
  英語 briefing meta-skill の activation / gate 文言。
- `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.ja.md`
  日本語 briefing meta-skill の activation / gate 文言。
- `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`
  英語 implementation meta-skill の activation / gate 文言。
- `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`
  日本語 implementation meta-skill の activation / gate 文言。
- `packages/doc-driven-dev/.apm/skills/doc-status/SKILL.md`
  英語 document audit verdict / output contract。
- `packages/doc-driven-dev/.apm/skills/doc-status/SKILL.ja.md`
  日本語 document audit verdict / output contract。
- `packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.md`
  英語 ADR workflow entrypoint。essential decision flow に絞って軽量化する対象。
- `packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.ja.md`
  日本語 ADR workflow entrypoint。
- `packages/doc-driven-dev/.apm/skills/adr-doc/references/*.md`
  split 後の詳細な ADR operational guidance。

### Task 1: Lifecycle Contract を整合させる

**Files:**

- Modify: `packages/doc-driven-dev/README.md`
- Modify: `packages/doc-driven-dev/README.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md`
- Test: `pnpm --dir scripts/doc-driven-dev run lint:md`

- [ ] **Step 1: plan workspace に fail する alignment checklist を書く**

```markdown
Alignment target:
- README の phase wording が lifecycle skill の wording と一致している
- `spec-doc + adr-doc` が briefing completion の output として説明されている
- `design-doc` が briefing の次 phase として一貫して説明されている
- 英語版と日本語版で意味が一致している
```

- [ ] **Step 2: 現在の mismatch を repo search で確認する**

Run: `rg -n "Phase 1|Phase 2|spec-doc \+ adr-doc|design-doc" packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle`
Expected: PASS。README と lifecycle skill で phase framing がずれている行が出る

- [ ] **Step 3: README の lifecycle summary を単一 contract に置き換える**

```markdown
両方の README で次の形に揃える:

Phase 1: `briefing-flow`
- `spec-doc` と `adr-doc` を含む、下流工程に必要な briefing output を生成する

Phase 2: `design-doc`
- 承認済み briefing output を実装可能な design に変換する
```

- [ ] **Step 4: lifecycle SKILL と flow-contract の phase 名と exit 条件を README に合わせる**

```markdown
lifecycle skill と flow-contract の両方で次の形に揃える:

- Phase 1 は briefing output が揃った時点で完了する
- `spec-doc` と `adr-doc` は Phase 1 completion の一部であり、競合する別 phase model ではない
- Phase 2 は `design-doc` から始まる
```

- [ ] **Step 5: 触った Markdown に対して lint を実行する**

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS。設定対象の package docs / workflow skills に markdownlint error がない

- [ ] **Step 6: Commit**

```bash
git add packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/SKILL.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-lifecycle/references/flow-contract.ja.md
git commit -m "docs: align doc-driven-dev lifecycle contract"
```

### Task 2: Optional External Routing と Discovery Boundary を文書化する

**Files:**

- Modify: `packages/doc-driven-dev/README.md`
- Modify: `packages/doc-driven-dev/README.ja.md`
- Modify: `packages/doc-driven-dev/AGENTS.md`
- Modify: `packages/doc-driven-dev/AGENTS.ja.md`
- Test: `pnpm --dir scripts/doc-driven-dev run lint:md`

- [ ] **Step 1: 編集前に disclosure text を書く**

```markdown
Required disclosures:
- `briefing-flow` は `steer-web-research` のような environment-provided skill に route することがある
- それらの skill は optional であり、この package には bundle されていない
- `skill-discovery-protocol` は `.agents/skills` や `apm_modules` のような local skill root を scan する
- 実際の routing は consumer environment で生成された `.sdp` profile に依存する
```

- [ ] **Step 2: adapter と AGENTS の根拠を確認する**

Run: `rg -n "steer-web-research|.agents/skills|apm_modules|skill-discovery-protocol" packages/doc-driven-dev/.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/assets/adapters/general.yaml packages/doc-driven-dev/AGENTS.md`
Expected: PASS。optional external route と broad discovery root を示す行が出る

- [ ] **Step 3: README と README.ja に package-level trust-boundary note を追加する**

```markdown
オーケストレーション説明の近くに次の短い note を追加する:

`briefing-flow` と `implementation-flow` は現在の環境で発見された skill に route できる。`steer-web-research` のような optional skill はこの package に bundle されておらず、生成された profile に存在する場合だけ使われる。
```

- [ ] **Step 4: AGENTS と AGENTS.ja に保守者向けの boundary note を追加する**

```markdown
package rule に短い note を追加する:

- `skill-discovery-protocol` は `.sdp` artifact 作成時に local skill root を読む
- environment-provided skill は bundle package content にならずに routing へ影響し得る
- adapter が non-bundled skill を参照する場合、package docs は optional external routing を明示すること
```

- [ ] **Step 5: lint を再実行する**

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS。設定対象ファイルに markdownlint regression がない

- [ ] **Step 6: Commit**

```bash
git add packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/AGENTS.md packages/doc-driven-dev/AGENTS.ja.md
git commit -m "docs: disclose discovery and routing boundaries"
```

### Task 3: Meta-Skill の Activation Language を弱める

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`
- Test: `pnpm --dir scripts/doc-driven-dev run lint:md`

- [ ] **Step 1: target policy language を書く**

```markdown
Target rule:
- 生成された profile が applicable と示した skill を使う
- user instruction は default routing policy を override できる
- emergency override または dispatch-specific override は 1 行の reason を記録する
- 環境内の全 skill が常に実行必須だとは書かない
```

- [ ] **Step 2: 強すぎる wording を search する**

Run: `rg -n "ALL available skills|must use them|This is not optional|Starting any .* work — invoke this skill FIRST" packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.md packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.ja.md packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`
Expected: PASS。英語版と日本語版の両方で hardline language が見つかる

- [ ] **Step 3: 両方の briefing-flow にある rule section を書き換える**

```markdown
次の policy shape を使う:

生成された profile が現在の作業に applicable と判断した skill は、user が明示的に routing decision を override していない限り使う。dispatch-specific override または emergency override を使う場合は、進行前に 1 行で reason を記録する。
```

- [ ] **Step 4: 両方の implementation-flow にある rule section を書き換える**

```markdown
次の policy shape を使う:

実装前に profile-based assessment と configuration を完了する。profile-selected skill は default として適用するが、explicit user override を許可し、non-default routing decision は記録する。
```

- [ ] **Step 5: lint を再実行する**

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS。触った workflow skill file に lint regression がない

- [ ] **Step 6: Commit**

```bash
git add packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.md packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.ja.md packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md
git commit -m "docs: refine meta-skill activation policy"
```

### Task 4: `doc-status` Report Contract を定義する

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/doc-status/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-status/SKILL.ja.md`
- Test: `pnpm --dir scripts/doc-driven-dev run lint:md`

- [ ] **Step 1: target output contract を書く**

```markdown
Required report sections:
- Verdict
- Blocking findings
- Warnings
- Relation errors
- Index gaps
- Next actions
```

- [ ] **Step 2: 現在の gap を確認する**

Run: `rg -n "Completable|Returned|Verdict|Blocking findings|Warnings|Relation errors|Index gaps|Next actions" packages/doc-driven-dev/.apm/skills/doc-status/SKILL.md packages/doc-driven-dev/.apm/skills/doc-status/SKILL.ja.md`
Expected: PASS。`Completable` と `Returned` はあるが、structured report contract はまだない

- [ ] **Step 3: 英語版 skill に output format を追加する**

```markdown
次の section を追加する:

## Output Contract

Return audit results using this structure:
- Verdict: `Completable` or `Returned`
- Blocking findings: progression を止める issue の一覧
- Warnings: non-blocking issue
- Relation errors: 壊れた internal link または inconsistent link
- Index gaps: 足りない registry / index entry
- Next actions: gate を通すために必要な最小 follow-up
```

- [ ] **Step 4: 日本語版 skill に対応する output format を追加する**

```markdown
同じ contract を日本語で追加する。package convention なら verdict label は `Completable` / `Returned` のまま維持する。
```

- [ ] **Step 5: lint を再実行する**

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS。更新した skill file に markdownlint regression がない

- [ ] **Step 6: Commit**

```bash
git add packages/doc-driven-dev/.apm/skills/doc-status/SKILL.md packages/doc-driven-dev/.apm/skills/doc-status/SKILL.ja.md
git commit -m "docs: define doc-status report contract"
```

### Task 5: `adr-doc` を Leaner Entry Skill と Richer References に分割する

**Files:**

- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/adr-maintenance.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/adr-maintenance.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/template-variants.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/template-variants.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/review-checklist.md`
- Modify: `packages/doc-driven-dev/.apm/skills/adr-doc/references/review-checklist.ja.md`
- Test: `pnpm --dir scripts/doc-driven-dev run lint:md`

- [ ] **Step 1: `SKILL.md` に残す内容と移す内容を整理する**

```markdown
`SKILL.md` に残す:
- when to use
- phase workflow
- mode selection
- intent summary gate
- draft / review / finalize flow

`references/` に移す:
- extended bootstrap guidance
- post-acceptance lifecycle detail
- long script usage examples
- category organization examples
- maintenance と review の詳細説明
```

- [ ] **Step 2: 編集前に current surface を測る**

Run: `rg -n "^## " packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.md packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.ja.md`
Expected: PASS。operational / reference-style な top-level section が多く出る

- [ ] **Step 3: 英語版 entry skill を core workflow に絞り、移動した内容は reference link に置き換える**

```markdown
移動した箇所には短い pointer text を置く:

For extended operational guidance, see:
- `references/adr-maintenance.md`
- `references/template-variants.md`
- `references/review-checklist.md`
```

- [ ] **Step 4: 日本語版 entry skill にも同じ split を適用し、対応する references 側へ詳細を移す**

```markdown
`SKILL.ja.md` を英語版と同じ構造に揃え、詳細な手順は対応する日本語 references へ移す。
```

- [ ] **Step 5: lint を再実行する**

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS。設定対象の package docs / ADR skill file に markdownlint regression がない

- [ ] **Step 6: Commit**

```bash
git add packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.md packages/doc-driven-dev/.apm/skills/adr-doc/SKILL.ja.md packages/doc-driven-dev/.apm/skills/adr-doc/references/adr-maintenance.md packages/doc-driven-dev/.apm/skills/adr-doc/references/adr-maintenance.ja.md packages/doc-driven-dev/.apm/skills/adr-doc/references/template-variants.md packages/doc-driven-dev/.apm/skills/adr-doc/references/template-variants.ja.md packages/doc-driven-dev/.apm/skills/adr-doc/references/review-checklist.md packages/doc-driven-dev/.apm/skills/adr-doc/references/review-checklist.ja.md
git commit -m "docs: trim adr-doc entry skill"
```

### Task 6: Script Trust-Boundary Documentation を補強する

**Files:**

- Modify: `packages/doc-driven-dev/AGENTS.md`
- Modify: `packages/doc-driven-dev/AGENTS.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.ja.md`
- Test: `pnpm --dir scripts/doc-driven-dev run lint:md`

- [ ] **Step 1: trust-boundary checklist を書く**

```markdown
明示すること:
- create/edit command は dry-run command でない限り即時書き込みする
- `--dir`, `--file`, `--out` は write location に影響する
- `build:scripts` は distributed JS output を再生成する
- `skill-discovery-protocol` は scan/profile/validate flow の一部として `.sdp` artifact を書き出す
```

- [ ] **Step 2: 現在の根拠を確認する**

Run: `rg -n "--write|--dry-run|--dir|--file|--out|build:scripts|.sdp" packages/doc-driven-dev/AGENTS.md packages/doc-driven-dev/AGENTS.ja.md packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.md packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.ja.md packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.md packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.ja.md`
Expected: PASS。partial disclosure はあるが、まとまった trust-boundary explanation はまだない

- [ ] **Step 3: AGENTS に maintenance-facing trust-boundary note を追加する**

```markdown
次の短い bullet を追加する:
- document creation command は即時に file を書く
- dry-run behavior は明示されている箇所にだけ存在する
- regeneration command は distributed JS output を置き換える
- path flag は generated artifact の書き込み先を変える
```

- [ ] **Step 4: `impl-doc` と `skill-discovery-protocol` に user-facing trust-boundary note を追加する**

```markdown
短い note を追加する:

- `impl-doc`: create / append / edit command は state-changing である
- `skill-discovery-protocol`: scan / profile / validate command は `.sdp` artifact を生成または更新する
```

- [ ] **Step 5: lint を再実行する**

Run: `pnpm --dir scripts/doc-driven-dev run lint:md`
Expected: PASS。触った docs / skills に markdownlint regression がない

- [ ] **Step 6: Commit**

```bash
git add packages/doc-driven-dev/AGENTS.md packages/doc-driven-dev/AGENTS.ja.md packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.md packages/doc-driven-dev/.apm/skills/impl-doc/SKILL.ja.md packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.md packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.ja.md
git commit -m "docs: clarify script trust boundaries"
```

## Self-Review

- Spec coverage:
  この plan は semantic evaluation の主要 finding をすべてカバーしている。lifecycle drift、optional external routing、meta-skill over-constraint、`doc-status` output ambiguity、`adr-doc` context bloat、script trust-boundary disclosure を対象にしている。
- Placeholder scan:
  `TODO`, `TBD`, deferred placeholder は入っていない。すべての task に exact file、command、expected outcome がある。
- Type consistency:
  `doc-driven-dev-lifecycle`, `briefing-flow`, `implementation-flow`, `doc-status`, `adr-doc`, `.sdp`, `steer-web-research` の識別子を全体で統一して使っている。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-12-doc-driven-dev-semantic-eval-fixes.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
