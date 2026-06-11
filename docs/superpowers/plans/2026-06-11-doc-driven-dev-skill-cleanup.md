# Doc-Driven Dev Skill Cleanup 実装計画

> **エージェント向け:** 必須サブスキル: この計画の実行には `superpowers:subagent-driven-development`（推奨）または `superpowers:executing-plans` を使い、タスクごとに進めること。進捗管理にはチェックボックス (`- [ ]`) を使うこと。

**Goal:** `packages/doc-driven-dev` から外部コピー由来の workflow skill 11 個を削除し、残るスキル群・パッケージ説明・日英ドキュメント・フロー系メタスキルの参照を整合した状態に戻す。

**Architecture:** 今回の変更はパッケージ構成の整理であり、実装コード追加は含まない。まず `.apm/skills/` 配下の対象スキルディレクトリを削除し、その後に `README`、`AGENTS`、`apm.yml`、および `briefing-flow` / `implementation-flow` / `skill-discovery-protocol` 周辺の説明を、削除後の実際の同梱スキル集合に合わせて更新する。最後に検索ベースの残参照確認とパッケージ検証コマンドを走らせ、整理後の一貫性を確認する。

**Tech Stack:** Markdown, APM package layout, PowerShell, `rg`, `pnpm`, `apm`

---

## ファイル構成

- 削除: `packages/doc-driven-dev/.apm/skills/brainstorming/`
- 削除: `packages/doc-driven-dev/.apm/skills/dispatching-parallel-agents/`
- 削除: `packages/doc-driven-dev/.apm/skills/doubt-driven-development/`
- 削除: `packages/doc-driven-dev/.apm/skills/idea-refine/`
- 削除: `packages/doc-driven-dev/.apm/skills/incremental-implementation/`
- 削除: `packages/doc-driven-dev/.apm/skills/receiving-code-review/`
- 削除: `packages/doc-driven-dev/.apm/skills/requesting-code-review/`
- 削除: `packages/doc-driven-dev/.apm/skills/source-driven-development/`
- 削除: `packages/doc-driven-dev/.apm/skills/subagent-driven-development/`
- 削除: `packages/doc-driven-dev/.apm/skills/systematic-debugging/`
- 削除: `packages/doc-driven-dev/.apm/skills/test-driven-development/`
- 修正: `packages/doc-driven-dev/README.md`
- 修正: `packages/doc-driven-dev/README.ja.md`
- 修正: `packages/doc-driven-dev/AGENTS.md`
- 修正: `packages/doc-driven-dev/AGENTS.ja.md`
- 修正: `packages/doc-driven-dev/apm.yml`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.ja.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.ja.md`
- 必要に応じて修正: `packages/doc-driven-dev/docs/specs/skills/skill-discovery-protocol/*.md`

### Task 1: 削除対象と参照マップを確定する

**Files:**
- 確認: `packages/doc-driven-dev/.apm/skills/`
- 確認: `packages/doc-driven-dev/README.md`
- 確認: `packages/doc-driven-dev/README.ja.md`
- 確認: `packages/doc-driven-dev/AGENTS.md`
- 確認: `packages/doc-driven-dev/AGENTS.ja.md`
- 確認: `packages/doc-driven-dev/apm.yml`

- [ ] **Step 1: 削除対象ディレクトリの現存を確認する**

Run:

```powershell
Get-ChildItem packages/doc-driven-dev/.apm/skills -Directory | Select-Object -ExpandProperty Name
```

Expected: 指定された 11 個の削除対象が、ディレクトリ名として正確に存在している。

- [ ] **Step 2: 削除対象スキル名への参照箇所を事前に洗い出す**

Run:

```powershell
rg -n "brainstorming|dispatching-parallel-agents|doubt-driven-development|idea-refine|incremental-implementation|receiving-code-review|requesting-code-review|source-driven-development|subagent-driven-development|systematic-debugging|test-driven-development" packages/doc-driven-dev
```

Expected: `README`、`AGENTS`、flow 系 skill、spec 文書などにヒットが出る。これを後続の修正チェックリストとして使う。

- [ ] **Step 3: 削除後に残す同梱スキル集合を確認する**

Run:

```powershell
Get-ChildItem packages/doc-driven-dev/.apm/skills -Directory | Select-Object -ExpandProperty Name | Sort-Object
```

Expected: 計画上の残存候補は `adr-doc`、`briefing-flow`、`deep-dive`、`design-doc`、`doc-driven-dev-flow`、`doc-status`、`impl-doc`、`implementation-flow`、`plan-doc`、`skill-discovery-protocol`、`spec-doc`、`task-doc` であることを確認できる。

- [ ] **Step 4: 削除前の基準状態を確認する**

Run:

```powershell
git diff -- packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/AGENTS.md packages/doc-driven-dev/AGENTS.ja.md packages/doc-driven-dev/apm.yml
```

Expected: まだ変更が入っていないことを確認できる。以後の差分確認の基準にする。

### Task 2: 外部コピー由来のスキルディレクトリを削除する

**Files:**
- 削除: `packages/doc-driven-dev/.apm/skills/brainstorming/`
- 削除: `packages/doc-driven-dev/.apm/skills/dispatching-parallel-agents/`
- 削除: `packages/doc-driven-dev/.apm/skills/doubt-driven-development/`
- 削除: `packages/doc-driven-dev/.apm/skills/idea-refine/`
- 削除: `packages/doc-driven-dev/.apm/skills/incremental-implementation/`
- 削除: `packages/doc-driven-dev/.apm/skills/receiving-code-review/`
- 削除: `packages/doc-driven-dev/.apm/skills/requesting-code-review/`
- 削除: `packages/doc-driven-dev/.apm/skills/source-driven-development/`
- 削除: `packages/doc-driven-dev/.apm/skills/subagent-driven-development/`
- 削除: `packages/doc-driven-dev/.apm/skills/systematic-debugging/`
- 削除: `packages/doc-driven-dev/.apm/skills/test-driven-development/`

- [ ] **Step 1: 指定された 11 個のスキルディレクトリを削除する**

Run:

```powershell
$targets = @(
  "brainstorming",
  "dispatching-parallel-agents",
  "doubt-driven-development",
  "idea-refine",
  "incremental-implementation",
  "receiving-code-review",
  "requesting-code-review",
  "source-driven-development",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development"
)
$targets | ForEach-Object {
  Remove-Item -LiteralPath ("packages/doc-driven-dev/.apm/skills/" + $_) -Recurse -Force
}
```

Expected: 対象の 11 ディレクトリだけが削除され、それ以外の package 内容には手が入らない。

- [ ] **Step 2: 対象ディレクトリが残っていないことを確認する**

Run:

```powershell
$targets = @(
  "brainstorming",
  "dispatching-parallel-agents",
  "doubt-driven-development",
  "idea-refine",
  "incremental-implementation",
  "receiving-code-review",
  "requesting-code-review",
  "source-driven-development",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development"
)
$targets | ForEach-Object {
  "{0}: {1}" -f $_, (Test-Path ("packages/doc-driven-dev/.apm/skills/" + $_))
}
```

Expected: すべて `False` になる。

- [ ] **Step 3: 削除差分を単独で確認する**

Run:

```powershell
git diff -- packages/doc-driven-dev/.apm/skills
```

Expected: 指定された 11 スキルの削除だけが差分として現れる。

- [ ] **Step 4: ディレクトリ削除だけを 1 コミットにまとめる**

Run:

```bash
git add packages/doc-driven-dev/.apm/skills
git commit -m "chore(doc-driven-dev): remove copied workflow skills"
```

Expected: スキル削除だけを含むコミットが作成される。

### Task 3: パッケージ文書を残存スキル集合に合わせて更新する

**Files:**
- 修正: `packages/doc-driven-dev/README.md`
- 修正: `packages/doc-driven-dev/README.ja.md`
- 修正: `packages/doc-driven-dev/AGENTS.md`
- 修正: `packages/doc-driven-dev/AGENTS.ja.md`
- 修正: `packages/doc-driven-dev/apm.yml`

- [ ] **Step 1: パッケージ概要とフロー説明から削除済みスキルを外す**

`README.md` と `README.ja.md` の以下を更新する:

```text
- 上部の skill 一覧から `idea-refine` と `brainstorming` を削除する。
- `idea-refine OR deep-dive OR brainstorming` のような開始導線を、残る discovery/entry skill のみで表現し直す。
- mainline / parallel track / recommended lifecycle に残っている削除済みスキル名を除去する。
- "Workflow Skills (Implementation Phase)" の表から削除対象 11 スキルを外す。
- 外部由来スキルを同梱している前提の origin / provenance 説明を削るか書き換える。
```

Expected: `README` の英日両方が、実際に同梱されるスキルだけを説明する状態になる。

- [ ] **Step 2: パッケージ向け AGENTS ガイドの workflow skill 一覧を更新する**

`AGENTS.md` と `AGENTS.ja.md` の以下を更新する:

```text
- workflow skill が pure-markdown guidance である説明は維持する。
- ただし一覧表は残存する workflow / meta skill だけに絞る。
- 削除した imported skill の provenance 行は削除する。
- package purpose や主フロー説明が削除済みスキル同梱を前提にしている場合は合わせて修正する。
```

Expected: `AGENTS` の記述が `.apm/skills/` の実体と一致する。

- [ ] **Step 3: `apm.yml` の説明文を現在の同梱内容に合わせる**

次の記述:

```yaml
description: Document-driven development skills for idea refinement, brainstorming, ADRs, specs, plans, tasks, and document status auditing.
```

を、例えば次のような削除後の実態に合う文言へ差し替える:

```yaml
description: Document-driven development skills for discovery orchestration, ADRs, specs, designs, plans, tasks, implementation records, and document status auditing.
```

Expected: パッケージメタデータが、既に削除したスキルを宣伝しなくなる。

- [ ] **Step 4: 英日ペアの差分をまとめて確認する**

Run:

```powershell
git diff -- packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/AGENTS.md packages/doc-driven-dev/AGENTS.ja.md packages/doc-driven-dev/apm.yml
```

Expected: 英日ペアで見出し構成と意味が揃っており、削除済みスキルへの参照が意図なく残っていない。

- [ ] **Step 5: 文書整合の変更を 1 コミットにまとめる**

Run:

```bash
git add packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/AGENTS.md packages/doc-driven-dev/AGENTS.ja.md packages/doc-driven-dev/apm.yml
git commit -m "docs(doc-driven-dev): align package docs with retained skills"
```

Expected: 文書と manifest の整合変更だけを含むコミットが作成される。

### Task 4: flow / protocol 系スキルと spec 文書の残参照を監査する

**Files:**
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/briefing-flow/SKILL.ja.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/implementation-flow/SKILL.ja.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.md`
- 必要に応じて修正: `packages/doc-driven-dev/.apm/skills/skill-discovery-protocol/SKILL.ja.md`
- 必要に応じて修正: `packages/doc-driven-dev/docs/specs/skills/skill-discovery-protocol/*.md`

- [ ] **Step 1: 残した flow / protocol 資産の中に削除済みスキル名が残っていないか検索する**

Run:

```powershell
rg -n "brainstorming|dispatching-parallel-agents|doubt-driven-development|idea-refine|incremental-implementation|receiving-code-review|requesting-code-review|source-driven-development|subagent-driven-development|systematic-debugging|test-driven-development" packages/doc-driven-dev/.apm/skills/briefing-flow packages/doc-driven-dev/.apm/skills/implementation-flow packages/doc-driven-dev/.apm/skills/skill-discovery-protocol packages/doc-driven-dev/docs/specs/skills/skill-discovery-protocol
```

Expected: package 固有の stale な参照だけが抽出されるか、ヒットが 0 件になる。

- [ ] **Step 2: package 固有の前提に依存する古い例示だけを書き換える**

修正時のルール:

```text
- flow-neutral な一般論は残してよい。
- ただし、この package に同梱されているスキル例として削除済みスキル名を挙げている箇所は置き換える。
- package 内例示が必要なら、`deep-dive`、`design-doc`、`plan-doc`、`task-doc`、`briefing-flow`、`implementation-flow` など残存スキルを使う。
```

Expected: retained meta skill は抽象性を維持しつつ、この package の現実と矛盾する例示は解消される。

- [ ] **Step 3: 修正後に package 全体の対象スキル名検索を再実行する**

Run:

```powershell
rg -n "brainstorming|dispatching-parallel-agents|doubt-driven-development|idea-refine|incremental-implementation|receiving-code-review|requesting-code-review|source-driven-development|subagent-driven-development|systematic-debugging|test-driven-development" packages/doc-driven-dev
```

Expected: ヒットが 0 件になるか、意図的に残した履歴言及だけに絞られる。

- [ ] **Step 4: stale 参照除去を 1 コミットにまとめる**

Run:

```bash
git add packages/doc-driven-dev/.apm/skills/briefing-flow packages/doc-driven-dev/.apm/skills/implementation-flow packages/doc-driven-dev/.apm/skills/skill-discovery-protocol packages/doc-driven-dev/docs/specs/skills/skill-discovery-protocol
git commit -m "docs(doc-driven-dev): remove stale references to deleted bundled skills"
```

Expected: flow / protocol 周辺の参照整理だけを含むコミットが作成される。

### Task 5: 整理後の package を検証する

**Files:**
- 検証: `packages/doc-driven-dev/**`

- [ ] **Step 1: `.apm/skills/` 配下の残存ディレクトリ一覧を確認する**

Run:

```powershell
Get-ChildItem packages/doc-driven-dev/.apm/skills -Directory | Select-Object -ExpandProperty Name | Sort-Object
```

Expected: 残る 12 個のスキルディレクトリだけが表示される。

- [ ] **Step 2: Markdown lint を実行する**

Run:

```bash
pnpm -C packages/doc-driven-dev run lint:md
```

Expected: exit code `0`。

- [ ] **Step 3: package test を実行する**

Run:

```bash
pnpm -C packages/doc-driven-dev test
```

Expected: exit code `0`。

- [ ] **Step 4: APM compile 系の検証を実行する**

Run:

```bash
pnpm -C packages/doc-driven-dev exec apm compile --dry-run
pnpm -C packages/doc-driven-dev exec apm compile --validate
```

Expected: `--dry-run` は成功し、`--validate` も成功するか、少なくとも `AGENTS.md` に既知として書いてある `.apm` discovery 起因の環境依存失敗だけが再現される。

- [ ] **Step 5: 最終差分と作業ツリーを確認する**

Run:

```powershell
git status --short
git diff -- packages/doc-driven-dev
```

Expected: 意図した package 整理差分だけが残る。

- [ ] **Step 6: 最終統合コミットを作る**

Run:

```bash
git add packages/doc-driven-dev
git commit -m "chore(doc-driven-dev): curate bundled skills"
```

Expected: 途中でスライスコミットを積んでいない場合はここで最終コミットが作られる。すでにコミット済みなら no-op でもよい。

## セルフレビュー

- 要件カバー: 物理削除、package 文書修正、flow/protocol 参照監査、最終検証まで含めている。
- プレースホルダ確認: `TODO` / `TBD` のような未具体化項目は含まない。
- 整合性確認: スキル名、対象ファイル、検証コマンドは各タスク間で一貫している。

計画は `docs/superpowers/plans/2026-06-11-doc-driven-dev-skill-cleanup.md` に保存済み。実行は次の 2 通り:

**1. Subagent-Driven（推奨）** - タスクごとに新しい subagent を起こして進める

**2. Inline Execution** - このセッションでそのまま順に実行する

**どちらで進めるか指定してください。**
