# Doc-Driven Development Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** doc-driven-dev の Graph、残存タスク、draft 文書、進行を妨げる理由を、手動生成する単一 HTML で確認できるようにする。

**Architecture:** canonical Markdown と Graph Definition YAML を既存の projector / inspector / document audit で読み、表示用の不変 snapshot を組み立てる。Graph package 内の `build_dashboard` が自己完結した HTML を生成し、新しい `doc-dashboard` skill が読み取りと生成を案内する。状態更新、route の実行、承認、修復は行わない。

**Tech Stack:** 既存 TypeScript、Node.js 20 対応の esbuild bundle、`node:test` + `tsx`、依存追加なしの HTML / CSS / SVG / 小さな inline JavaScript。

## Global Constraints

- ユーザー指定: **単一HTMLを手動生成**。
- 本文書は設計・実装計画。2026-09-21 の追加指示で、ブランチを作成してサブエージェント方式で実装することが承認された。文書の approved 化は含めない。
- 実行系コマンドは `mise exec -- <command>` を使う。
- Markdown / YAML が唯一の状態 authority。HTML と snapshot は再生成可能な表示物。
- Graph の条件、gate、priority、task runnable 判定を表示側で再実装しない。
- TypeScript source を変更し、配布 JavaScript は `build:scripts` で生成する。手編集しない。
- 配布 skill、README、参照文書は EN / JA の意味・構造を同期する。
- ID は opaque string として扱う。旧連番 / UUIDv7+Base62 を受け入れ、ID 順を時系列と解釈しない。
- ネットワーク、CDN、Web server、watch process、外部 link 疎通確認は初版に不要。
- 既存の Graph Definition、one-edge route、Run-to-Yield、EffectOutcome の契約を変更しない。
- 既存の user-owned / untracked file を変更・削除しない。

---

## 1. 調査結果と設計判断

2026-09-21、repository HEAD `559ac44` の source と配布 contract を調査した。

| 既存資産 | 再利用する契約 | 注意点 |
| --- | --- | --- |
| `src/skills/doc-driven-dev-graph/scripts/lib/graph_definition.ts` | `loadGraphDefinition` | YAML の schema / node / condition 検証 |
| `src/skills/doc-driven-dev-graph/scripts/lib/graph_cli.ts` | `resolveGraphPath` | source / bundle の相対配置に依存する |
| `src/skills/doc-driven-dev-graph/scripts/lib/graph_inspector.ts` | `inspectGraphDefinition` / `GraphInspection` | 静的な topology。runtime の現在地とは異なる |
| `src/skills/doc-driven-dev-graph/scripts/lib/graph_state.ts` | `projectGraphState` / `GraphState` v2 | focus、gate、signal、blocker、選択 task graph。現在ノードの永続値はない |
| `src/skills/doc-driven-dev-graph/scripts/lib/graph_router.ts` | `evaluateRouteDecision` / `RouteDecision` | route と explanation を一度の同じ評価から得る |
| `src/skills/doc-driven-dev-graph/scripts/lib/task_graph.ts` | `buildTaskGraph` / `TaskGraphResult` v1 | `resumableActive` と `runnable` が別。`wont-do` は依存を満たさない |
| `src/skills/doc-driven-dev-graph/scripts/lib/artifact_graph.ts` | `scanArtifactGraph` / `ArtifactRecord` | canonical path と relation を収集。title / updated は含まない |
| `src/skills/lib/doc_report.ts` | `collectFindings` / `summarizeHealth` | 共有 document model、安定した finding、オフライン audit |
| `src/skills/lib/doc_repository.ts` | `RepositoryDocument` / `Finding` | title、status、updated、parseError、canonical / unmanaged の区別 |
| `build/build-skill-scripts.ts` | `src/skills/**/scripts/*.ts` の自動 bundle | `scripts/lib/` は entrypoint から除外。新しい build 設定は不要 |

上記 `src/` と `build/` は `scripts/doc-driven-dev/` 相対。

### 選択肢

| 案 | 利点 | 負担 / 制約 | 判断 |
| --- | --- | --- | --- |
| 既存 TypeScript API → snapshot → 単一 HTML | 同じ判定を使える。配布 bundle は Node だけで実行可能 | collection / rendering の薄い adapter が必要 | 採用 |
| 複数 CLI の JSON を subprocess で収集 | 公開 CLI のみで組み立てられる | 繰り返し scan、失敗処理、snapshot の時点ずれが増える | 不採用 |
| 常駐 Web app / watch | 常時更新・大規模操作に向く | server、watch、配布、接続管理が必要 | 初版対象外 |

### 既存スキルとの責務

- `doc-dashboard`: 表示物を生成する report capability。新しい orchestrator にはしない。
- `doc-status`: findings と audit verdict の authority を維持する。
- `doc-driven-dev-graph`: Graph Definition / state / routing の authority を維持する。
- dashboard を見る要求は `doc-dashboard`、文書監査だけの要求は `doc-status`、進行そのものを行う要求は既存 graph / implementation flow に渡す。
- スクリプトは **graph skill の scripts 内**に配置する。新しい skill 内に bundle すると、既存 `resolveGraphPath` の `__dirname` 前提が崩れるため。

## 2. 利用者に見せるもの

```text
┌ 文書駆動開発の進行状況 ─ 生成時刻 / 対象 / focus / snapshot 表示 ┐
│ 残存 12 │ done 8 │ wont-do 2 │ draft 5 │ blocking findings 3    │
├ Graph ──────────────────────────────────────────────────────┤
│ Execution Graph の node / edge 図 + 全 edge の条件・priority 表  │
│ 現在ノード: 未指定 / 指定値    次の遷移: 評価なし / route と理由 │
│ gate 一覧、hard blocker、required audit、commit gate           │
├ plan ごとのタスク ───────────────────────────────────────────┤
│ plan / status / done / 残存 / wont-do / 依存上 runnable / active │
│ 展開: task の status・依存・停止理由・canonical path            │
├ 草案とレビュー候補 ──────────────────────────────────────────┤
│ draft / proposed / capturing を別ラベルで表示、種別・検索で絞込 │
├ 文書間の関係 / diagnostics ──────────────────────────────────┤
│ lineage・task-dependency・evidence・contextual の関係表         │
│ findings、壊れた relation、孤立 task、対象外 / 不明情報         │
└─────────────────────────────────────────────────────────────┘
```

- 日本語 UI を初版の既定値とする。status、rule ID、node ID は原文を保持。
- 全体集計と focus 集計を区別する。focus を指定しても全体の draft を消さない。
- 検索は ID / title / path の部分一致、文書種別 / status の絞り込み。ローカル表示だけを変更する。
- 各文書は HTML 内の詳細へリンクする。canonical path はコピー可能な plain text として表示する。
- ローカル Markdown への直接リンクは初版では提供しない。HTML を移動しても内部リンクは保たれる。
- 本文全体、owners、任意 front matter は HTML に埋め込まない。title / status / updated / relation / finding の必要情報のみを含める。
- 生成日時と「この画面は生成時点の状態。更新はコマンドを再実行」を明記する。
- SVG が見えない場合も node / edge 表が完全な代替になる。色だけで状態を伝えない。

### 現在地と次の作業

`GraphState` には current node がないため、文書 status から実行中ノードを推測しない。

- `--current` なし: current は `null`、route preview も `null`。「現在ノード未指定」と表示する。
- `--current <node>` あり: 指定値を明記し、既存 evaluator を一度だけ呼ぶ。これは**指定条件からの遷移プレビュー**であり、実行履歴の証明ではない。
- `--signal` は明示された値だけ入力する。Graph Definition の signal condition / `runtimeSignals` にない値は CLI error。
- `implementation-verified` / `exit-audit-pass` / `commit-waived` を dashboard が補完しない。audit findings がゼロでも `exit-audit-pass` は付けない。
- focus が曖昧なら `focus-required` を表示する。勝手に plan を選ばない。全体 inventory はそのまま表示可能。
- `requiredAudits` と `commitGate` は必要条件として表示する。監査済み・commit 済みとは表示しない。

### 残存タスクと草案の定義

| 表示 | 定義 |
| --- | --- |
| 残存 | 有効な task status の `todo` / `in-progress` / `blocked` |
| 完了 | `done` のみ |
| 見送り | `wont-do`。完了数に入れず、依存解決にも使わない |
| 完了率 | `done / validTaskTotal`。分母ゼロは「対象なし」。見送りは分母に含める |
| 不明 task | `type: task` だが status 不正 / parse error。上記の率から除き別件数を表示 |
| 依存上 runnable | plan 別 `TaskGraphResult.runnable`。Graph gate を通過した保証はない |
| 再開候補 | `resumableActive`。`active` 全体とは区別 |
| 草案 | canonical 文書で status が厳密に `draft` |
| レビュー候補 | `proposed`。draft と合算しない |
| 記録中 | `capturing`。draft と合算しない |
| unmanaged 文書 | canonical contract 外の Markdown。status を推測しない |

task graph の `blocked` 配列には `wont-do` も含まれるため、配列長を残存 blocked 数として使わない。
依存で待っている todo、明示的 blocked、再開不能な in-progress は、status と dependency eligibility を別列にする。
同一 task が複数 plan に含まれる場合、plan 別には各 plan で表示するが、全体件数は path で一度だけ数える。
孤立 task と invalid task も全体 inventory から落とさない。

### 収集範囲と不完全な情報

- Graph / task 解析は既存 `scanArtifactGraph` の canonical roots を使う。初版に独自 `--task-dir` は追加しない。
- `collectFindings(cwd, { type: "all", externalLinks: false })` の model で title / updated / parseError を補う。
- model が見つけた canonical 文書と artifact records は path で外部結合する。Graph 未対応の alias directory は `graphCovered: false` として表示する。
- `docs/superpowers/plans/**` のような unmanaged 文書は「管理対象外」に表示する。この計画自身にも canonical draft status を捏造しない。
- index / README は inventory の文書数に入れない。
- impl 記録は inventory に含める。ただし既存 `collectFindings(all)` は専用 `audit_impl_record` の全検証を保証しない。「標準 doc-status audit の範囲」と明記し、完全な exit audit と同一視しない。
- 壊れた front matter / duplicate ID / cycle / broken relation は取得できた finding / graph issue のまま表示する。理由を成功に置換しない。
- I/O や collector 自体の例外は生成失敗とし、新しい成功 HTML を作らない。空 inventory は「0 件」と欠落 gate を表示し、成功扱いの進捗率を出さない。
- 複数既存 API が scan するため、OS レベルの原子的 snapshot は保証しない。開始・終了時刻を記録し、生成中の編集を避ける利用契約にする。初版では scanner の統合 refactor を行わない。

## 3. 公開 CLI と出力契約

```bash
# 配布 skill: 自分自身の場所から sibling graph skill を解決する
mise exec -- node <doc-dashboard-skill-dir>/../doc-driven-dev-graph/scripts/build_dashboard.js --cwd <repo-root>

# monorepo の source を開発時に実行
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx src/skills/doc-driven-dev-graph/scripts/build_dashboard.ts --cwd ../..

# focus と現在ノードを明示して生成
mise exec -- node packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_dashboard.js --cwd . --focus docs/plans/example.md --current task-graph --out reports/doc-driven-dev/index.html
```

| 引数 | 契約 |
| --- | --- |
| `--cwd <dir>` | 読み取り対象。省略時 `process.cwd()`。実在する directory 必須 |
| `--graph <file>` | 既存 `resolveGraphPath` に合わせ process cwd 相対。省略時 bundle 隣接の標準 YAML |
| `--focus <id-or-path>` | 繰り返し可能。既存 focus resolution に渡す |
| `--current <node>` | 省略時 preview なし。不明 node は error |
| `--signal <signal>` | 繰り返し可能。明示 signal を UI でも区別 |
| `--out <file.html>` | `--cwd` 相対。既定 `reports/doc-driven-dev/index.html` |
| `--force` | 既存出力ファイルの置換を許可。文書の更新は許可しない |
| `--help` | 入出力の相対 path 基準を含む usage。読み取り・生成をしない |

出力は UTF-8 の HTML 一つ。外部 CSS / JS / JSON / font / image は不要。
内部用 snapshot schema は `schemaVersion: 1` とし、公開 JSON CLI は初版に追加しない。
stdout は `Dashboard written: <absolute path>`、stderr は失敗理由。
exit 0 はレポート生成成功であり、文書や Graph が健全という意味ではない。exit 1 は入力 / 読み取り / 出力エラー。
無効 focus は既存 state の blocker として HTML に残す。不明 current / signal / 引数は生成前に拒否する。

書き込み規則:

- `.html` 以外、directory、symlink の出力先を拒否する。
- 出力は repo 配下に限定する。既存 ancestor の realpath を辿って symlink による repo 外への脱出も拒否する。
- 既存 file は `--force` なしで拒否する。skill はユーザーが生成した既存レポートの更新を求めた場合のみ `--force` を渡す。
- 検証と render を完了してから sibling temporary file に `wx` で書く。
- 初回は `linkSync(temp, out)` の排他的作成、置換は `renameSync(temp, out)`。失敗時は元 HTML を削除せず、temp だけ除去して error。
- hard link 非対応 filesystem では初回生成を明示的に失敗させる。非原子的 fallback で既存出力を壊さない。
- `--force` でも先に既存 file を delete しない。Windows の rename 失敗時は旧 HTML を保持する。
- `.gitignore` に `/reports/doc-driven-dev/` を追加する。consumer repo の ignore は skill が勝手に変更しない。

## 4. File Structure と実装順

パスの略記はこの表だけに使う。各 task の Files は実パスを列挙する。

| 新規 / 更新ファイル | 責務 |
| --- | --- |
| `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_model.ts` | snapshot / inventory 型と集計・分類の純粋関数 |
| `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_collect.ts` | 既存 API を結合して snapshot を収集 |
| `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_render.ts` | HTML、CSS、フィルタ、表、詳細の rendering |
| `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_svg.ts` | execution topology の静的 SVG |
| `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_cli.ts` | 引数・path 検証と一つの HTML の publish |
| `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/build_dashboard.ts` | 薄い CLI entrypoint |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_dashboard.js` | build で生成する配布 entrypoint |
| `scripts/doc-driven-dev/tests/doc-dashboard-{model,collect,render,cli,contract}.test.ts` | task ごとの contract tests |
| `packages/doc-driven-dev/.apm/skills/doc-dashboard/SKILL.md` / `SKILL.ja.md` | 起動条件と実行ワークフロー |
| `packages/doc-driven-dev/.apm/skills/doc-dashboard/references/dashboard-contract.md` / `.ja.md` | CLI、件数、現在地、failure、coverage 契約 |
| `packages/doc-driven-dev/README.md` / `README.ja.md` | 新 capability の案内 |
| `packages/doc-driven-dev/.apm/skills/doc-status/SKILL.md` / `SKILL.ja.md` | HTML が欲しい場合の導線 |
| `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md` / `SKILL.ja.md` | read-only な dashboard の導線 |
| `scripts/doc-driven-dev/package.json` | 新規 EN / JA 文書を `lint:md` 対象に追加 |
| `.gitignore` | 既定出力を除外 |

依存順: **Task 1 → Task 2 → Task 3 → Task 4 → Task 5**。
既存 Graph YAML、GraphState schema、routing DSL、生成器、APM manifest の変更は不要。

### Task 1: 表示モデルと分類を固定する

**Files:**

- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_model.ts`
- Test: `scripts/doc-driven-dev/tests/doc-dashboard-model.test.ts`

**Interfaces:**

- Consumes: 既存 `GraphInspection`, `GraphState`, `RouteDecision`, `TaskGraphResult`, `Finding`, `HealthReport`。
- Produces: 下記型、および `summarizeTasks`, `documentBucket`。

- [ ] **Step 1: 集計の failing test を追加する。**

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { documentBucket, summarizeTasks } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_model";

test("wont-do and invalid status are not completion", () => {
  assert.deepEqual(summarizeTasks([
    { path: "a.md", status: "done" },
    { path: "b.md", status: "wont-do" },
    { path: "c.md", status: "todo" },
    { path: "d.md", status: "in-progress" },
    { path: "e.md", status: "blocked" },
    { path: "f.md", status: "draft" },
    { path: "c.md", status: "todo" },
  ]), { total: 5, done: 1, wontDo: 1, remaining: 3, unknown: 1, doneRatio: 0.2 });
  assert.equal(summarizeTasks([]).doneRatio, null);
  assert.equal(documentBucket("draft"), "draft");
  assert.equal(documentBucket("proposed"), "proposed");
  assert.equal(documentBucket("capturing"), "capturing");
  assert.equal(documentBucket(null), "other");
});
```

- [ ] **Step 2: FAIL を確認する。**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-dashboard-model.test.ts`

Expected: 新 module / export がないため FAIL。

- [ ] **Step 3: 型と集計を実装する。**

`dashboard_model.ts` の imports と contract:

```typescript
import type { GraphInspection } from "./graph_inspector";
import type { GraphState } from "./graph_state";
import type { RouteDecision } from "./graph_router";
import type { TaskGraphResult } from "./task_graph";
import type { Finding } from "../../../lib/doc_repository";
import type { HealthReport } from "../../../lib/doc_report";

export type InventoryItem = {
  path: string; id: string | null; type: string | null;
  title: string; status: string | null; updated: string | null;
  kind: "canonical" | "unmanaged"; graphCovered: boolean;
  parseError: string | null;
};
export type PlanView = {
  path: string; status: string | null; graph: TaskGraphResult;
};
export type DashboardSnapshot = {
  schemaVersion: 1;
  startedAt: string; generatedAt: string; repositoryName: string;
  requested: { focus: string[]; current: string | null; signals: string[] };
  definition: GraphInspection; state: GraphState;
  decision: RouteDecision | null;
  inventory: InventoryItem[]; plans: PlanView[];
  findings: Finding[]; health: HealthReport;
  coverageNotes: string[];
};
export type TaskSummary = {
  total: number; done: number; wontDo: number;
  remaining: number; unknown: number; doneRatio: number | null;
};

export function documentBucket(status: string | null): "draft" | "proposed" | "capturing" | "other" {
  return status === "draft" || status === "proposed" || status === "capturing" ? status : "other";
}

export function summarizeTasks(rows: readonly { path: string; status: string | null }[]): TaskSummary {
  const unique = [...new Map(rows.map(row => [row.path, row])).values()];
  const valid = new Set(["todo", "in-progress", "blocked", "done", "wont-do"]);
  const count = (status: string) => unique.filter(row => row.status === status).length;
  const total = unique.filter(row => valid.has(row.status ?? "")).length;
  const done = count("done");
  return { total, done, wontDo: count("wont-do"),
    remaining: count("todo") + count("in-progress") + count("blocked"),
    unknown: unique.length - total, doneRatio: total === 0 ? null : done / total };
}
```

parser error のある row は呼び出し元で status を `null` にして集計する。
inventory に `body` / `owners` / `frontMatter` をコピーしない。

- [ ] **Step 4: Step 2 の test を再実行し PASS を確認する。**
- [ ] **Step 5: この deliverable を commit する。**

```bash
git add scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_model.ts scripts/doc-driven-dev/tests/doc-dashboard-model.test.ts
git commit -m "feat(doc-driven-dev): define dashboard snapshot and progress metrics"
```

### Task 2: 既存 projection と audit から snapshot を収集する

**Files:**

- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_collect.ts`
- Test: `scripts/doc-driven-dev/tests/doc-dashboard-collect.test.ts`

**Interfaces:**

- Consumes: Task 1 の型、既存 `loadGraphDefinition`, `inspectGraphDefinition`, `scanArtifactGraph`, `projectGraphState`, `buildTaskGraph`, `evaluateRouteDecision`, `collectFindings`, `summarizeHealth`。
- Produces: `collectDashboard(options: CollectDashboardOptions): Promise<DashboardSnapshot>`。
- Produces: `CollectDashboardOptions = { cwd: string; graphPath: string; focus: string[]; current?: string; signals: string[]; now?: () => string }`。

- [ ] **Step 1: draft が gate 判定と独立して残る test を書く。**

```typescript
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectDashboard } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_collect";

test("draft inventory survives missing focus and incomplete bootstrap", async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-collect-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, "docs/specs"), { recursive: true });
  const file = path.join(cwd, "docs/specs/example.md");
  const content = "---\nid: SPEC-0001\ntype: spec\nstatus: draft\ntitle: 草案\ncreated: '2026-09-21'\nupdated: '2026-09-21'\nowners: []\nrelations: {}\n---\n# 草案\n";
  fs.writeFileSync(file, content);
  const graphPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");
  const report = await collectDashboard({ cwd, graphPath, focus: [], signals: [], now: () => "2026-09-21T00:00:00Z" });
  assert.equal(report.decision, null);
  assert.equal(report.requested.current, null);
  assert.equal(report.inventory.find(row => row.path === "docs/specs/example.md")?.status, "draft");
  assert.ok(report.state.blockers.includes("bootstrap-incomplete"));
  assert.equal(fs.readFileSync(file, "utf8"), content);
  assert.ok(!report.state.signals.includes("exit-audit-pass"));
});
```

- [ ] **Step 2: FAIL を確認する。**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-dashboard-collect.test.ts`

Expected: collector module がないため FAIL。

- [ ] **Step 3: collector を実装する。**

imports は同階層の Graph modules、`../../../lib/doc_report`、`dashboard_model` から追加する。
収集順序と return shape は以下に固定する。

```typescript
export type CollectDashboardOptions = {
  cwd: string; graphPath: string; focus: string[];
  current?: string; signals: string[]; now?: () => string;
};

export async function collectDashboard(options: CollectDashboardOptions): Promise<DashboardSnapshot> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const definition = loadGraphDefinition(options.graphPath);
  if (options.current !== undefined && !Object.hasOwn(definition.nodes, options.current)) {
    throw new Error(`Unknown graph node: ${options.current}`);
  }
  const declared = new Set([
    ...Object.values(definition.conditions).flatMap(c => c.kind === "signal" ? [c.signal] : []),
    ...(definition.runtimeSignals ?? []),
  ]);
  for (const signal of options.signals) {
    if (!declared.has(signal)) throw new Error(`Unknown signal not declared by graph definition: ${signal}`);
  }
  const collected = await collectFindings(options.cwd, { type: "all", externalLinks: false });
  const artifacts = scanArtifactGraph({ cwd: options.cwd });
  const state = projectGraphState({ cwd: options.cwd, graphId: definition.id,
    focus: options.focus, signals: options.signals });
  const decision = options.current === undefined ? null
    : evaluateRouteDecision({ current: options.current, definition, state });
  const inventoryByPath = new Map<string, InventoryItem>();
  for (const doc of collected.model.documents) {
    if (doc.kind === "index") continue;
    inventoryByPath.set(doc.path, {
      path: doc.path, id: doc.id, type: doc.type, title: doc.title ?? doc.path,
      status: doc.status, updated: doc.updated, kind: doc.kind,
      graphCovered: false, parseError: doc.parseError,
    });
  }
  for (const record of artifacts.records) {
    const prior = inventoryByPath.get(record.path);
    inventoryByPath.set(record.path, {
      path: record.path, id: record.id, type: record.type,
      title: prior?.title ?? record.path, status: record.status,
      updated: prior?.updated ?? null, kind: "canonical", graphCovered: true,
      parseError: prior?.parseError ?? (record.relationIssues.some(issue => issue.startsWith("invalid-document:")) ? "invalid-document" : null),
    });
  }
  const inventory = [...inventoryByPath.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const plans = artifacts.records.filter(record => record.type === "plan").map(record => ({
    path: record.path, status: record.status,
    graph: buildTaskGraph({ cwd: options.cwd, plan: record.path }),
  }));
  return { schemaVersion: 1, startedAt, generatedAt: now(),
    repositoryName: path.basename(path.resolve(options.cwd)),
    requested: { focus: [...options.focus], current: options.current ?? null, signals: [...options.signals] },
    definition: inspectGraphDefinition(definition), state, decision, inventory, plans,
    findings: collected.findings, health: summarizeHealth(collected, collected.findings),
    coverageNotes: ["標準 doc-status audit。専用 impl-record audit の代替ではありません。",
      "生成中の編集に対する原子的 snapshot は保証しません。",
      "Graph 対象外の文書は inventory のみ。現在ノードは指定値です。"],
  };
}
```

`path` と参照した型・関数の imports を明示する。Graph library 自体は変更しない。
既存 doc model の `documents` は index 以外を含む。unmanaged が inventory に残ることを test で固定する。

- [ ] **Step 4: focused integration cases を追加して再実行する。**

同 test file に以下を追加する。既存 test file を import してその test 全体を起動しない。

```typescript
import matter from "gray-matter";
import { loadGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import { projectGraphState } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_state";
import { evaluateRouteDecision } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_router";
import { buildTaskGraph } from "../src/skills/doc-driven-dev-graph/scripts/lib/task_graph";

for (const scenario of ["done", "wont-do", "active", "active-waiting", "cycle", "duplicate", "orphan", "invalid", "empty", "unmanaged", "alias"]) {
  test(`collector preserves canonical semantics: ${scenario}`, async t => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-case-"));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const write = (relative: string, data: Record<string, unknown>, body = "# Example\n") => {
      const file = path.join(cwd, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, matter.stringify(body, {
        title: "Example", created: "2026-09-21", updated: "2026-09-21", owners: [], relations: {}, ...data,
      }));
    };
    const planPath = "docs/plans/example.md";
    if (scenario !== "empty") {
      write(planPath, { id: "PLAN-0001", type: "plan", status: "draft" });
      write("docs/tasks/a.md", { id: "TASK-0001", type: "task",
        status: scenario.startsWith("active") ? "in-progress" : "todo",
        relations: { implements: ["PLAN-0001"], "depends-on": ["TASK-0002"] } });
      write("docs/tasks/b.md", { id: "TASK-0002", type: "task",
        status: scenario === "wont-do" ? "wont-do" : scenario === "active-waiting" || scenario === "cycle" ? "todo" : "done",
        relations: { implements: ["PLAN-0001"], ...(scenario === "cycle" ? { "depends-on": ["TASK-0001"] } : {}) } });
    }
    if (scenario === "duplicate") {
      write("docs/plans/second.md", { id: "PLAN-0002", type: "plan", status: "draft" });
      write("docs/tasks/duplicate.md", { id: "TASK-0001", type: "task", status: "todo", relations: { implements: ["PLAN-0002"] } });
    }
    if (scenario === "orphan") write("docs/tasks/orphan.md", { id: "TASK-0003", type: "task", status: "todo" });
    if (scenario === "invalid") fs.writeFileSync(path.join(cwd, "docs/tasks/invalid.md"), "---\nid: [\n---\n");
    if (scenario === "unmanaged") {
      fs.mkdirSync(path.join(cwd, "docs/superpowers/plans"), { recursive: true });
      fs.writeFileSync(path.join(cwd, "docs/superpowers/plans/raw.md"), "# Human plan\n");
    }
    if (scenario === "alias") write("docs/spec/alias.md", { id: "SPEC-0001", type: "spec", status: "draft" });
    const graphPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");
    const definition = loadGraphDefinition(graphPath);
    const focus = scenario === "empty" ? [] : [planPath];
    const report = await collectDashboard({ cwd, graphPath, focus, signals: [], current: "task-graph" });
    assert.deepEqual(report.state, projectGraphState({ cwd, graphId: definition.id, focus, signals: [] }));
    assert.deepEqual(report.decision, evaluateRouteDecision({ current: "task-graph", definition, state: report.state }));
    if (scenario !== "empty") assert.deepEqual(report.plans.find(plan => plan.path === planPath)?.graph,
      buildTaskGraph({ cwd, plan: planPath }));
    if (scenario === "unmanaged") assert.equal(report.inventory.find(row => row.path.endsWith("raw.md"))?.kind, "unmanaged");
    if (scenario === "alias") assert.equal(report.inventory.find(row => row.path.endsWith("alias.md"))?.graphCovered, false);
    if (scenario === "orphan") assert.ok(report.inventory.some(row => row.path.endsWith("orphan.md")));
    if (scenario === "invalid") assert.ok(report.inventory.some(row => row.parseError !== null));
    await assert.rejects(collectDashboard({ cwd, graphPath, focus, signals: [], current: "unknown-node" }), /Unknown graph node/);
    await assert.rejects(collectDashboard({ cwd, graphPath, focus, signals: ["undeclared-signal"] }), /Unknown signal/);
  });
}
```

これらは gate を意図的に未充足に保ち、阻害理由があっても inventory と plan 別 DAG を取得できることを検証する。Task 1 の集計 test と組み合わせ、findings と task count を混同しない。

- [ ] **Step 5: collector と test を commit する。**

```bash
git add scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_collect.ts scripts/doc-driven-dev/tests/doc-dashboard-collect.test.ts
git commit -m "feat(doc-driven-dev): collect dashboard using canonical graph and audit APIs"
```

### Task 3: オフライン HTML と execution graph を描画する

**Files:**

- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_render.ts`
- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_svg.ts`
- Test: `scripts/doc-driven-dev/tests/doc-dashboard-render.test.ts`

**Interfaces:**

- Consumes: Task 1 の `DashboardSnapshot`, `InventoryItem`, `summarizeTasks`, `documentBucket`。
- Produces: `renderDashboard(snapshot: DashboardSnapshot): string`。
- Produces: `escapeHtml(value: string): string`, `renderExecutionSvg(inspection: GraphInspection, selected: { current: string | null; edgeId: string | null }): string`。

- [ ] **Step 1: escaping とオフライン描画の failing test を追加する。**

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_render";
import { renderExecutionSvg } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_svg";
import { inspectGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_inspector";
import { loadGraphDefinition } from "../src/skills/doc-driven-dev-graph/scripts/lib/graph_definition";
import path from "node:path";

test("all untrusted HTML metacharacters are escaped", () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">&\''),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;");
});
test("graph SVG has safe IDs and a readable text equivalent", () => {
  const definition = loadGraphDefinition(path.resolve(__dirname,
    "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml"));
  const svg = renderExecutionSvg(inspectGraphDefinition(definition), { current: null, edgeId: null });
  assert.match(svg, /<svg/);
  assert.match(svg, /<title/);
  assert.doesNotMatch(svg, /<script|<foreignObject|(?:href|src)\s*=/i);
});
```

`xmlns="http://www.w3.org/2000/svg"` は namespace であり外部取得ではない。resource attribute と実行要素の不在を検査する。

- [ ] **Step 2: FAIL を確認する。**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-dashboard-render.test.ts`

Expected: renderer modules がないため FAIL。

- [ ] **Step 3: HTML shell、escape、検索 script を実装する。**

```typescript
export function escapeHtml(value: string): string {
  const escaped: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return value.replace(/[&<>"']/g, char => escaped[char]);
}

const filterScript = String.raw`
const form = document.querySelector('[data-filters]');
if (form) form.addEventListener('input', () => {
  const query = form.querySelector('[name="query"]').value.toLocaleLowerCase();
  const type = form.querySelector('[name="type"]').value;
  const status = form.querySelector('[name="status"]').value;
  let visible = 0;
  for (const row of document.querySelectorAll('[data-document-row]')) {
    row.hidden = !row.textContent.toLocaleLowerCase().includes(query)
      || (type !== '' && row.dataset.type !== type)
      || (status !== '' && row.dataset.status !== status);
    if (!row.hidden) visible += 1;
  }
  document.querySelector('[data-result-count]').textContent = String(visible);
});`;
```

`renderDashboard` は §2 の順で以下の構造を生成する。関数内で組み立てる各部分は HTML string、入力文字列は常に `escapeHtml` を通す。

```html
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'">
<title>文書駆動開発の進行状況</title>
<style>
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { max-width: 1200px; margin: auto; padding: 24px; line-height: 1.6; }
nav, .metrics { display: flex; flex-wrap: wrap; gap: 16px; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 8px; border-bottom: 1px solid #888; text-align: left; vertical-align: top; }
pre, .table-scroll { overflow: auto; }
[hidden] { display: none !important; }
:focus-visible { outline: 3px solid #5879ff; }
svg { width: 100%; height: auto; }
@media (max-width: 640px) { body { padding: 12px; } }
@media print { nav, form { display: none; } details > * { display: block; } }
</style>
</head>
<body>
<header><h1>文書駆動開発の進行状況</h1></header>
<nav aria-label="セクション"><a href="#graph">Graph</a><a href="#tasks">タスク</a><a href="#documents">文書</a><a href="#diagnostics">診断</a></nav>
<main></main>
<noscript>全情報を表示しています。絞り込みには JavaScript が必要です。</noscript>
</body>
</html>
```

header に repositoryName / requested / startedAt / generatedAt、main に実データを挿入する。
`filterScript` だけを末尾 inline script として追加し、文書データを JavaScript / JSON script に埋め込まない。
初期 HTML に全行を描くので JavaScript 無効でも閲覧できる。
入力欄は label 付き query / type / status、件数は `aria-live="polite"`。

描画規則:

1. メトリクスは canonical task inventory を path で一意化して Task 1 の関数に渡す。
2. Graph: `decision === null` の場合は未指定表示。そうでなければ route と explanation の生の値をラベル付きで描画。
3. 各 gate を status / reasons の表にする。requiredAudits / commitGate / caller supplied signals を別枠にする。
4. plan ごとの `<details>` に全 task と dependency edge 表を描く。runnable / active / resumableActive は別列。
5. inventory を draft / proposed / capturing / その他 / unmanaged に分ける。各 path を昇順で割り当てた `doc-0` 等の内部 ID に対応させる。
6. artifact relation の from / to が inventory にあれば内部 anchor、なければ escaped text。未解決 / external はラベルを付ける。外部 URL は自動でクリック可能にしない。
7. findings は severity / blocking / ruleId / path / line / message。topology issues と task issues は別表。
8. source の絶対 cwd、本文、owners は HTML に含めない。GraphState 全体の `JSON.stringify` を使わない。

- [ ] **Step 4: SVG と対応表を実装する。**

node ID 昇順の固定 grid を使う。実行の順序を座標から推測させず、全 edge の from / to / condition / priority を対応表で表示する。cycle / self-loop にも対応する。

```typescript
const positions = new Map(inspection.nodes.map((node, index) => [node.nodeId, {
  alias: `node-${index}`, x: 30 + (index % 3) * 300, y: 40 + Math.floor(index / 3) * 130,
}]));
const nodeWidth = 230;
const nodeHeight = 72;
const height = 70 + Math.ceil(inspection.nodes.length / 3) * 130;
const routeEdge = selected.edgeId;
```

各 node は `<g id="node-N"><rect/><text/></g>`、edge は数値座標の `<path marker-end="url(#arrow)">`。
self-loop は node 上端から右側へ戻る cubic path、それ以外は始点下端 → 終点上端の cubic path。
node ID / kind を escaped text にし、長い label は 26 文字で表示を短縮して完全な `<title>` を付ける。
current / selected edge は stroke と「指定ノード」「選択 edge」という text で強調する。
SVG 冒頭に `<title>Execution Graph</title>` と `<desc>遷移条件は直後の表を参照</desc>` を付ける。
SVG helper は `escapeHtml` を render module から import しない。小さな private XML escape を定義し、module 循環を作らない。

- [ ] **Step 5: adversarial fixture と表示 contract test を追加し PASS を確認する。**

Task 2 の collector で temporary repo を読み、描画時に必要な adversarial input を加える。Windows で作れない引用符入り path は in-memory snapshot の値として検証する。

```typescript
import fs from "node:fs";
import os from "node:os";
import { collectDashboard } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_collect";
import { renderDashboard } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_render";

test("standalone HTML preserves text without executing document content", async t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-render-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const graphPath = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/graphs/doc-driven-dev.yaml");
  const snapshot = await collectDashboard({ cwd, graphPath, focus: [], signals: [], now: () => "2026-09-21T00:00:00Z" });
  snapshot.inventory.push({ path: 'docs/specs/日本語".md', id: "SPEC-0001", type: "spec",
    title: "</script><img src=x onerror=alert(1)>", status: "draft", updated: null,
    kind: "canonical", graphCovered: false, parseError: null });
  const html = renderDashboard(snapshot);
  assert.match(html, /現在ノード未指定/);
  assert.match(html, /生成時点/);
  assert.ok(html.includes("&lt;/script&gt;&lt;img"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes(snapshot.state.cwd));
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|fetch\(/i);
  assert.equal(html, renderDashboard(snapshot));
});
```

render tests では空 inventory、全 done、全 wont-do、不正 status、draft-only、route blocked を追加する。
実装時に生成した実 HTML を browser で一度開き、検索、type / status filter、内部 anchor、キーボード操作、狭い画面、JavaScript 無効時の表を確認する。ネットワーク request が発生しないことを確認する。

- [ ] **Step 6: renderer と test を commit する。**

```bash
git add scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_render.ts scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_svg.ts scripts/doc-driven-dev/tests/doc-dashboard-render.test.ts
git commit -m "feat(doc-driven-dev): render offline progress dashboard"
```

### Task 4: CLI、出力保護、配布 bundle を完成させる

**Files:**

- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_cli.ts`
- Create: `scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/build_dashboard.ts`
- Generate: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_dashboard.js`
- Modify: `.gitignore`
- Test: `scripts/doc-driven-dev/tests/doc-dashboard-cli.test.ts`

**Interfaces:**

- Consumes: Task 2 `collectDashboard`、Task 3 `renderDashboard`、既存 `resolveGraphPath`。
- Produces: `parseDashboardArgs(argv: string[], processCwd: string): DashboardArgs`。
- Produces: `writeDashboard(cwd: string, output: string, html: string, force: boolean): string`。
- Produces: `runDashboard(argv: string[]): Promise<void>`。
- `DashboardArgs = { cwd: string; graph?: string; focus: string[]; current?: string; signals: string[]; out: string; force: boolean; help: boolean }`。

- [ ] **Step 1: 引数と上書き防止の failing tests を追加する。**

```typescript
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseDashboardArgs, writeDashboard } from "../src/skills/doc-driven-dev-graph/scripts/lib/dashboard_cli";

test("explicit overwrite is required", t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-write-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const file = writeDashboard(cwd, "reports/dashboard.html", "first", false);
  assert.throws(() => writeDashboard(cwd, "reports/dashboard.html", "second", false), /exist/i);
  assert.equal(fs.readFileSync(file, "utf8"), "first");
  writeDashboard(cwd, "reports/dashboard.html", "second", true);
  assert.equal(fs.readFileSync(file, "utf8"), "second");
  assert.throws(() => writeDashboard(cwd, "../escape.html", "bad", true), /outside/i);
  assert.throws(() => writeDashboard(cwd, "docs/specs/a.md", "bad", true), /html/i);
});
test("missing option value is an error", () => {
  assert.throws(() => parseDashboardArgs(["--focus"], process.cwd()), /Missing value/);
  assert.throws(() => parseDashboardArgs(["--current", "--force"], process.cwd()), /Missing value/);
});
```

- [ ] **Step 2: FAIL を確認する。**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-dashboard-cli.test.ts`

Expected: CLI helper module がないため FAIL。

- [ ] **Step 3: parser / writer / entrypoint を実装する。**

parser は既存 `route_graph.ts` の `requiredValue` パターンで各 option を明示的に列挙する。unknown option と余分な位置引数は拒否する。
`--cwd` は process cwd 相対で絶対化、`--out` は target cwd 相対で絶対化する。help は収集前に返す。

```typescript
const requiredValue = (argv: string[], index: number): string => {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argv[index]}`);
  return value;
};

// containment 判定。path separator と drive を OS の path API に任せる。
const isInside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};
```

writer は §3 の順序を実装する。mkdir 前に root、output、既存 ancestor の realpath を検査し、出力直前にも output の `lstat` と parent の realpath を検査する。
temporary name は `.${basename}.${randomUUID()}.tmp`。`randomUUID` は `node:crypto` から import する。

```typescript
fs.writeFileSync(temp, html, { encoding: "utf8", flag: "wx" });
try {
  if (force && fs.existsSync(output)) fs.renameSync(temp, output);
  else fs.linkSync(temp, output);
} finally {
  if (fs.existsSync(temp)) fs.unlinkSync(temp);
}
```

初回 / force 分岐の直前にも output が regular file か確認する。これは悪意ある並行 filesystem 操作に対する sandbox ではなく、ローカル生成先の誤指定防止契約。

entrypoint:

```typescript
#!/usr/bin/env node
import { runDashboard } from "./lib/dashboard_cli";

runDashboard(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
```

`runDashboard` は parse → help → input validation → graph path resolution → collect → render → write → stdout の順。
収集時に exception が出たら writer を呼ばない。

- [ ] **Step 4: source / bundle を検証する。**

Run:

```bash
mise exec -- pnpm --dir scripts/doc-driven-dev run build:scripts
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-dashboard-cli.test.ts
```

CLI test は既存 `doc-driven-dev-graph-cli.test.ts` と同様、`spawnSync(process.execPath, [tsxCli, sourceCli, ...args])` と `spawnSync(process.execPath, [generatedCli, ...args])` を shell なしで呼ぶ。
両方で同じ fixture を生成し、開始・生成時刻の text だけ正規化して HTML を比較する。
monorepo 外の temporary consumer に配布 `doc-driven-dev-graph` directory をコピーし、`--graph` なしでも sibling YAML を解決できることを検証する。

追加 matrix: path に空白 / 日本語、cwd 不在、unknown node / signal、invalid focus の blocked report、force なし既存出力、force の既存保持、symlink 出力 / ancestor、出力先 directory、読み取り失敗、書き込み失敗、help の無書き込み。
Windows で symlink 権限がない場合は junction による ancestor escape を検証し、symlink file test の skip 理由を記録する。

- [ ] **Step 5: 既定出力の ignore を追加して commit する。**

`.gitignore` に追加:

```gitignore
# generated local doc-driven development dashboard
/reports/doc-driven-dev/
```

```bash
git add .gitignore scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/lib/dashboard_cli.ts scripts/doc-driven-dev/src/skills/doc-driven-dev-graph/scripts/build_dashboard.ts scripts/doc-driven-dev/tests/doc-dashboard-cli.test.ts packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/scripts/build_dashboard.js
git commit -m "feat(doc-driven-dev): ship manual dashboard generation CLI"
```

### Task 5: doc-dashboard スキルと利用契約を配布する

**Files:**

- Create: `packages/doc-driven-dev/.apm/skills/doc-dashboard/SKILL.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-dashboard/SKILL.ja.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-dashboard/references/dashboard-contract.md`
- Create: `packages/doc-driven-dev/.apm/skills/doc-dashboard/references/dashboard-contract.ja.md`
- Modify: `packages/doc-driven-dev/README.md`
- Modify: `packages/doc-driven-dev/README.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-status/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-status/SKILL.ja.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md`
- Modify: `packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.ja.md`
- Modify: `scripts/doc-driven-dev/package.json`
- Test: `scripts/doc-driven-dev/tests/doc-dashboard-contract.test.ts`

**Interfaces:**

- Consumes: Task 4 の配布 CLI と §2 / §3 の表示・CLI contract。
- Produces: report 専用 `doc-dashboard` skill。生成 HTML の path、生成時刻、残存 / draft 件数、主要 blocker、coverage limitation をユーザーに返す。

- [ ] **Step 1: 配布 contract の failing test を追加する。**

```typescript
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("dashboard skill points at the distributed graph CLI in both languages", () => {
  const root = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");
  for (const name of ["SKILL.md", "SKILL.ja.md"]) {
    const text = fs.readFileSync(path.join(root, "doc-dashboard", name), "utf8");
    assert.match(text, /name: doc-dashboard/);
    assert.match(text, /\.\.\/doc-driven-dev-graph\/scripts\/build_dashboard\.js/);
    assert.match(text, /--current/);
    assert.match(text, /--force/);
  }
  assert.ok(fs.existsSync(path.join(root, "doc-driven-dev-graph/scripts/build_dashboard.js")));
});
```

- [ ] **Step 2: FAIL を確認する。**

Run: `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-dashboard-contract.test.ts`

Expected: `doc-dashboard/SKILL.md` 不在で FAIL。

- [ ] **Step 3: 英語 SKILL.md を次の内容で作成する。**

````markdown
---
name: doc-dashboard
description: Use when the user wants an HTML dashboard of doc-driven development progress, graph gates, remaining tasks, or draft documents.
license: MIT
---

# Document Progress Dashboard

Generate one offline HTML snapshot for a human to inspect. This is a reporting
capability, not an orchestration entrypoint. Canonical Markdown and Graph YAML
remain authoritative. Read [the contract](references/dashboard-contract.md)
for CLI options, coverage, and metric definitions.

## Workflow

1. Resolve the target repository and this skill's installed directory.
2. Keep focus, current node, and signals exactly as supplied by the user or
   active caller. Omit unspecified values; never infer execution position.
3. Run the sibling bundled script, resolving its path from this skill directory:

   ```bash
   mise exec -- node ../doc-driven-dev-graph/scripts/build_dashboard.js --cwd <repo-root>
   ```

   The relative script path above is relative to this skill directory, not
   the caller's working directory. Resolve it to an absolute path before running.
   If mise is not used by the consumer repository, use its documented Node runner.

4. Add `--focus`, `--current`, and `--signal` only when explicitly supplied.
   Add `--out` for a requested repository-relative HTML destination.
   Use `--force` only when updating an existing report is requested.
5. Return the generated HTML link, timestamp, remaining-task and draft counts,
   important blockers, and coverage limitations. CLI exit 0 means generation
   succeeded, not that lifecycle gates passed. If generation fails, report the
   error and do not present an older HTML as the new result.

## Boundaries

- Write only the requested report and its temporary output file.
- Do not edit statuses, approve documents, repair relations, rebuild indexes,
  dispatch delegates, or commit changes.
- Do not synthesize verification signals or claim the current node was observed.
- Task DAG runnable is not proof that execution gates passed.
- Do not start a server, watch process, or network request.
- Do not add a graph node or invent an EffectOutcome for this report command.
- Use doc-status for audit details and doc-driven-dev-graph for explicit routing
  requests; do not activate either as an additional orchestrator for generation.
````

- [ ] **Step 4: 日本語 SKILL.ja.md を同じ構造で作成する。**

````markdown
---
name: doc-dashboard
description: 文書駆動開発の進行状況、Graph gate、残存タスク、draft 文書を HTML ダッシュボードで確認したいときに使います。
license: MIT
---

# Document Progress Dashboard

人が確認するためのオフライン HTML snapshot を一つ生成します。この skill は
報告 capability です。orchestration の entrypoint ではありません。canonical
Markdown と Graph YAML を authority として維持します。CLI、対象範囲、集計定義は
[contract](references/dashboard-contract.ja.md) を参照してください。

## Workflow

1. 対象 repository と、この skill のインストール先を解決します。
2. focus、現在ノード、signal はユーザーまたは実行中 caller の指定をそのまま
   使用します。未指定値は省略し、実行位置を推測しません。
3. この skill directory から sibling の配布 script を解決して実行します。

   ```bash
   mise exec -- node ../doc-driven-dev-graph/scripts/build_dashboard.js --cwd <repo-root>
   ```

   上記 script path は caller の作業ディレクトリではなく、この skill directory
   からの相対パスです。実行前に絶対パスへ解決します。consumer repository が
   mise を使わない場合、その repository の Node 実行方法に従います。

4. 明示された場合のみ `--focus`、`--current`、`--signal` を追加します。
   保存先指定は repository 相対の `--out` に渡します。既存レポートの更新を
   求められた場合のみ `--force` を使います。
5. HTML のリンク、生成時刻、残存タスク数、draft 数、主な blocker、対象範囲の
   制約を返します。exit 0 は生成成功を意味し、gate 通過を意味しません。
   失敗時は理由を報告し、以前の HTML を今回の結果として示しません。

## Boundaries

- 指定レポートと出力用 temporary file のみを書き込みます。
- status 更新、承認、relation 修復、索引再生成、delegate 実行、commit をしません。
- 検証 signal を補完せず、指定ノードを観測済みの現在地と主張しません。
- Task DAG の runnable は実行 gate の通過を保証しません。
- server、watch process、ネットワーク通信を開始しません。
- Graph node を追加せず、表示コマンド用の EffectOutcome を創作しません。
- 詳細監査は doc-status、明示的な routing 要求は doc-driven-dev-graph を使います。
  HTML 生成のために追加 orchestrator を起動しません。
````

- [ ] **Step 5: references と導線を同期する。**

`dashboard-contract.{md,ja.md}` には §2 の現在地・件数・coverage、§3 の全 option・path・exit・上書き契約、自己完結 HTML の仕様を同順に記載する。英語版はその対応訳とする。
README capability 一覧に `doc-dashboard` と `doc-dashboard/SKILL` への相対 link を追加する。
doc-status / graph SKILL のリソース欄に追加する文:

```markdown
For a manually generated offline HTML view of graph facts, remaining tasks,
and draft documents, use [doc-dashboard](../doc-dashboard/SKILL.md).
```

```markdown
Graph の状態、残存タスク、draft 文書を手動生成するオフライン HTML で確認するには、
[doc-dashboard](../doc-dashboard/SKILL.ja.md) を使います。
```

`package.json` の `lint:md` に新規 SKILL 2 ファイル、references 2 ファイルを既存の quoted path 形式で追加する。
installed `.agents/skills` は生成された deployment なので直接変更しない。

- [ ] **Step 6: 最終検証を実行する。**

```bash
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-dashboard-model.test.ts tests/doc-dashboard-collect.test.ts tests/doc-dashboard-render.test.ts tests/doc-dashboard-cli.test.ts tests/doc-dashboard-contract.test.ts tests/doc-driven-dev-graph-cli.test.ts tests/doc-suite.test.ts
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsc --noEmit
mise exec -- pnpm --dir scripts/doc-driven-dev run lint:md
git diff --check
```

全 tests、typecheck、markdown lint が PASS。文書 / Graph の読み取り対象 fixture の内容 hash が前後で同一であることも CLI integration test で固定する。
build 後の diff は新 bundle と意図した source / docs に限定されることを確認し、無関係な生成差分を混ぜない。
§2 の各画面を browser で確認した結果と、実行できなかった platform-specific case があれば記録する。

- [ ] **Step 7: 公開ドキュメントと contract test を commit する。**

```bash
git add packages/doc-driven-dev/.apm/skills/doc-dashboard packages/doc-driven-dev/README.md packages/doc-driven-dev/README.ja.md packages/doc-driven-dev/.apm/skills/doc-status/SKILL.md packages/doc-driven-dev/.apm/skills/doc-status/SKILL.ja.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.md packages/doc-driven-dev/.apm/skills/doc-driven-dev-graph/SKILL.ja.md scripts/doc-driven-dev/package.json scripts/doc-driven-dev/tests/doc-dashboard-contract.test.ts
git commit -m "docs(doc-driven-dev): add dashboard skill and reporting contract"
```

### Task 6: ステータス別カンバン表示（追加要望）

2026-09-21 の追加要望により Task 4 と Task 5 の間で実施する。

- [ ] 集計の直後に、未着手・進行中・ブロック中・完了・見送りのレーンを置く。
- [ ] canonical task を path 単位のカードで表示し、タイトル、ID、所属 plan、依存関係、既存 DAG の実行・再開候補や理由を示す。
- [ ] 不明ステータスは専用レーンに残し、孤立・Graph 未対応 task も表示する。依存待ち todo のステータスを blocked に変更しない。
- [ ] Graph・監査・文書一覧・詳細表は補助ビューとして保持する。オフライン・JavaScript 無効でも読める単一 HTML とする。
- [ ] 狭い画面ではボード内を横スクロールでき、ページ全体ははみ出さない。キーボード操作と安全な内部リンクを確認する。
- [ ] renderer / board のテスト、型検査、bundle 再生成、実ブラウザ確認を行う。

主な変更先: `dashboard_render.ts`、必要に応じた board / HTML 共通 helper、renderer テスト、生成済み `build_dashboard.js`。スキル文書は Task 5 でこの表示を説明する。HTML は読み取り専用 snapshot であり、ドラッグによる文書更新や常駐サーバーは対象外。

## 5. 受け入れ条件と coverage

| 要求 | 証拠 / task |
| --- | --- |
| 単一 HTML の手動生成 | source / bundle / consumer CLI test、browser のオフライン表示: Task 3–4 |
| Graph の定義と状態 | inspector / projector との同値 test: Task 2 |
| current を捏造しない | current 未指定は `null`、UI に未指定: Task 2–3 |
| 次の遷移と blocker の理由 | evaluator の返り値と同値、監査・commit gate の表示: Task 2–3 |
| 全 plan の残存と依存 | plan ごとの `buildTaskGraph` 同値、path 一意の全体集計: Task 1–2 |
| draft 草案と proposed の区別 | strict status grouping と検索: Task 1、3 |
| 不正文書・空状態の可視性 | invalid / empty / alias / unmanaged fixtures: Task 2–3 |
| 読み取り対象を変更しない | fixture hash、生成失敗時の旧 HTML 維持: Task 2、4 |
| HTML injection と外部依存の排除 | hostile text test、resource attributes 検査、browser 確認: Task 3 |
| 配布できる skill | EN / JA contract、sibling path の consumer test、build parity: Task 4–5 |

## 6. 今回の境界と実装時の引き継ぎ

初回は設計・実装計画を成果物とし、その後の追加指示で `feature/doc-driven-dev-dashboard` ブランチ上の実装まで範囲を拡張した。checkbox と末尾の実行記録は実装・検証結果に合わせて更新する。
既存の canonical design / plan を approved にせず、Graph の task DAG も作成していない。

実装方式:

**Subagent-Driven:** task ごとに実装担当を分け、成果物ごとにレビューする（ユーザー指定）。実装順は Task 1 → 2 → 3 → 4 → 6 → 5 とする。

### 計画の自己レビュー

- ユーザー指定の手動・単一 HTML を CLI / render / skill の全層に反映した。
- 表示用の新しい状態 database、独自 router、暗黙の approve / signal を作らない。
- 調査で見つかった current 不在、wont-do と blocked の重なり、title 不在、bundle path 依存、audit coverage の差を契約として明記した。
- 各 task に Files / Interfaces / failing test / 実装方針と code / 検証 command / commit 境界を定義した。
- 実装対象は一つの報告 capability。watch / Web hosting / 更新操作 / 任意本文 preview は別要求として扱う。

## 7. 実行記録

ブランチ: `feature/doc-driven-dev-dashboard`。開始点: `559ac447`。サブエージェントが各 task を実装し、別の担当が仕様と品質をレビューする。

### 実装時に確定した判断

1. ユーザー指定に従い、既存 checkout に feature branch を作成した。追加 worktree は作らない。誤判断時の影響は同一 checkout での競合なので、担当ファイルを限定し既存変更を保持する。
2. サブエージェント方式を唯一の実装進行役とし、別の implementation-flow を重ねない。個別の契約と検証は維持する。誤判断時は追加 orchestration 固有の手順を補う必要がある。
3. 初回の設計のみという境界は、後続のブランチ作成・実装指示により更新した。canonical 文書の承認や外部公開には拡張しない。
4. Git wrapper の staging 表示に不整合があったため、Git の実体で index / HEAD を確認しコミットした。hook は無効化しない。
5. 同一 path の重複 status が衝突する場合、計画例の後勝ちではなく「不明」にする。完了を過大表示しないための判断であり、衝突解消までは有効 task 集計から除外される。
6. 既存 task graph の plan 所属は ID ではなく `relations.implements` の canonical plan path で指定する。計画の fixture 例を修正し、空 graph 同士の比較で合格しない独立 assertion を追加した。runtime の所属規則は変えない。
7. 一時ファイルの書き込みを cleanup 対象の try / finally 内に置き、排他作成に成功したファイルだけを削除する。計画のサンプルより失敗時の旧 HTML 保持を優先した。名前衝突時は他のファイルを残して生成を失敗させる。
8. 追加要望のカンバンを概要の直後に置き、Graph と詳細表を補助ビューとして維持する。status と依存上の実行可否は別に表示し、HTML から状態を書き換えない。

最終検証と完了 task は作業完了時にここへ記録する。

### 完了記録

| Task | 状態 | 実装コミット / 証拠 |
| --- | --- | --- |
| 1 | complete | `286a7ef..5bc9331`; model tests and typecheck passed. |
| 2 | complete | `3135b98`, `16d03b4`; collector tests and package suite passed. |
| 3 | complete | `0dc5d98`, `680babf`; renderer tests, typecheck, browser fixture passed. |
| 4 | complete | `4b9f49d`, `5eb450a`; CLI tests, output-safety checks, typecheck/build passed. |
| 6 | complete | `8dce762`, `29c52b2`; Kanban tests, browser fixture, 390px/no-JS checks, final re-review passed. |
| 5 | complete | `86adc1e`; contract test, Markdown lint, typecheck and package suite passed; bilingual skill distributed. |

Final package suite, typecheck, Markdown lint, bundle build, browser fixture, actual repository HTML, and `git diff --check` passed. The final review accepted one minor presentation tradeoff: a filter count can remain zero while a `:target` row is temporarily visible for an internal card link; the filter count continues to mean matching rows.
