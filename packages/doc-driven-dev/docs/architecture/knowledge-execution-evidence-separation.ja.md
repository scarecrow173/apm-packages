# アーキテクチャ: Knowledge / Execution / Evidence 分離

`#232` とその子Issue `#233`–`#249` で追跡している `doc-driven-dev`
刷新の、メンテナ向けアーキテクチャ文書。各Issueで合意済みの内容を整理し、
現在の(v2)アーキテクチャ、移行後の(v3)アーキテクチャ、および両者の
対応関係を一つの参照文書にまとめたものである。

正本: `#232`(親契約・受け入れ条件)と §6 に列挙する子Issue。本文書とIssueが
矛盾する場合はIssueが優先する。現行アーキテクチャのコードレベルの権威は、
Graph Definition(`graphs/doc-driven-dev.yaml`)、
`.apm/skills/doc-driven-dev-graph/references/` 配下の各契約、および
`scripts/doc-driven-dev/src/skills/lib/` の共有ライブラリである。

## 1. 目的

現行の `doc-driven-dev-graph` は、持続的知識(Spec / Design / ADR /
Discovery)、一時的な実行状態(Plan / Task / 承認 / Checkpoint)、実装履歴
(IR / EXP)、検証の意図と結果を、単一のGit管理Markdown Artifact Graph上で
扱っている。`#127` が示したコストは、文書量の増大、共有Markdownへの更新
競合、実行状態と長期知識の責務混在である。`#232` はこれを、archive/index
の最適化ではなく、データモデルの責務分離によって解決する。

目標(`#232` より):

1. Git管理する情報を持続的な知識・仕様・設計・意思決定・検証設計に集中する
   (**Knowledge Graph**)。
2. Plan / Task / 承認 / Checkpoint / Effect Receipt を原則Git管理外の
   **Execution Store** へ移し、並列実行・再開・検証可能な冪等性を保持する。
3. 検証の意図(**Verification Design**)と実際の検証結果(**Evidence
   Record**)を分け、Claim / Check / 対象リビジョンを追跡する。
4. Graph StateをKnowledge / Execution / Evidenceの**派生Projection**とし、
   Graph Definition v3のone-edge routingとcaller-owned run-to-yieldを維持
   する。
5. 旧形式を検出した場合は **Schema Preflightで通常実行を停止し、明示的な
   Migrationへ誘導** する。通常実行の後方互換パーサー・v2 Graph並走・旧文書
   フォールバックは作らない。

## 2. 現在のアーキテクチャ(v2)

### 2.1 4つの層

- **Execution Graph** — `graphs/doc-driven-dev.yaml`、`schemaVersion: 2`。
  宣言されたノード(`probe`、`migration`、`bootstrap`、`briefing`、
  `design`、`planning`、`task-graph`、`implementation`、
  `followup-triage`、`exit-audit`、`complete`)、一意なpriorityを持つ
  edge、汎用condition DSL(`signal` / `gate` / `task-graph` 述語)、
  delegate/auditバインディング、`commitGate` 宣言。
  `route_graph.js` は1回の呼び出しにつき最大1つの宣言edge、terminal結果、
  またはfail-closedの同一ノードblocked結果を返す。2本目のedgeを再帰的に
  辿ることはない。
- **Artifact Graph** — canonical Markdownアーティファクト: 型付きID
  (`<PREFIX>-<22桁Base62>`)、type別 `status` 語彙、front matterの
  `relations`。Relationは無区別な語彙を両方向に手動保存する
  (`implements` / `implemented-by`、`derives-from` / `derived-by`、
  `verifies` / `verified-by`、`supersedes` / `superseded-by`、
  `refines` / `refined-by`、`defers` / `deferred-by`、および `source`、
  `depends-on`、`blocks`、`related`、`references`)。
- **Graph State** — 呼び出しごとにArtifact Graphから新規投影される
  (`schemaVersion: 2`)。解決済みfocus、gate結果、caller signal、ソート済み
  blocker、選択されたTask Graphを含む。派生状態であり保存されない。
- **Dynamic Task Graph** — フォーカス済みplanのtask文書(`docs/tasks`)の
  決定的読み取り専用Projection: `active` / `resumableActive` / `runnable` /
  `blocked` / `idle`。ID重複・未解決参照・循環・不正relation・空選択は
  fail-closed。

### 2.2 永続化モデル

すべてのアーティファクト種別がGit管理Markdownであり、Markdownが永続履歴かつ
status authorityである。永続化クラスは1種類しかない。

| 型 | canonical dir | 役割 | status語彙 |
| --- | --- | --- | --- |
| `idea` | `docs/ideas` | 生のアイデア捕捉 | draft, exploring, promoted, parked, archived, superseded |
| `brainstorm` | `docs/discovery` | ブレインストーミング出力 | capturing, confirmed, routed, superseded |
| `discovery` | `docs/discovery` | 探索・問題設定 | draft, active, resolved, archived, superseded |
| `spec` | `docs/specs` | 要件 | draft, proposed, approved, implemented, superseded, rejected |
| `design` | `docs/designs` | 設計文書 | draft, approved, superseded, rejected |
| `adr` | `docs/adr` | 意思決定(MADR) | proposed, accepted, rejected, deprecated, superseded, draft |
| `test-spec` | `docs/test-specs` | 検証の*意図* | draft, proposed, approved, deprecated, superseded |
| `plan` | `docs/plans` | 実行計画 | draft, approved, in-progress, blocked, completed, superseded |
| `task` | `docs/tasks` | 実行単位+DAG | todo, in-progress, blocked, done, wont-do |
| `ir` (Implementation Record) | `docs/impl/ir` | taskごとの実装記録 | impl-doc管轄 |
| `exp` (Experiment Log) | `docs/impl/exp` | JSONL実験イベント | impl-doc管轄 |

型レジストリ(`lib/doc_types.ts`)はdir・alias・ID prefix・status語彙を宣言
し、`lib/doc_ownership.ts` はcanonical dirごとにowner(`doc-suite`、
`adr-doc`、`impl-doc`)、mutator/auditor許可リスト、index形式を割り当てる。
`docs/impl` はresident typeを持たないowner付きscopeである。type別 `status`
が唯一のライフサイクル軸であり、独立した `lifecycle` フィールドは存在しない。

README / INDEXファイルは `doc-maintenance` のwriterが所有dirごとに再生成する
**派生物質化ビュー**(`#194`)であり、canonicalではない。

### 2.3 実行モデル

Callerは bounded **run-to-yield** ループを所有する(`execution-contract.md`):

1. `route_graph.js` が `current` に対して1つの `GraphRoute` を返す。
2. 宣言されたauditを安定順で実行し、返却されたdelegateのみをdispatchする。
3. 完了 / gate / follow-up の証拠を run の **Execution Store** に永続化する —
   受理されたoutcomeはEffect Receipt(`receipts/`)となり、edgeは
   checkpoint(`checkpoints/`)となる。callerは `--task-dir docs/tasks` を
   task-budgetアンカーとしてピン留めする。
4. 再投影して継続(`run-until-yield`)するか停止(`single-step`)する。

このループを取り巻く仕組み:

- **Yield table**: `terminal`、`approval-required`、`input-required`、
  `authority-required`、`unrecoverable-blocker`、`budget-exhausted`、
  `commit-required`。
- **Commit gate**: ノード単位で宣言(`implementation`)。effect実行前に
  `{ head, dirty }` のworktree baselineを捕捉し、pending edge上で途中yieldを
  またいで保持する。`commit-waived` が宣言済みの迂回手段。
- **Bounded autonomy**: `maxHops`(topology base + 凍結task budget)、route
  fingerprintループ検出、edge別・run別dispatch budget。
- **Resume**: 常にMarkdownを再投影する。canonical証拠またはproviderの
  冪等性証明で完了が示せるstageのみスキップし、なければ
  `authority-required` でyieldする。
- **Run trace**(`run_trace.jsonl`): caller/CLIが出力するJSONLイベント。
  厳密に非正本の診断データ。

したがってcheckpointの完了、effect receipt、runの進行は、持続的知識と同じ
Git管理Markdown上に置かれている。

### 2.4 検証モデル

`test-spec-doc` は `docs/test-specs/` を生成する — 検証の*意図*(spec/design/
ADRにリンクしたFeature / Rule / Example構造)。結果は第一級アーティファクト
ではない: `implementation` gateは選択taskの解決済みに加えてcaller提供の
`implementation-verified` **signal** — 実質的なboolean証言 — を要求する。
どのclaimを、どの文書/checkリビジョンで、どのcommit/workspace状態に対して
検証したかを追跡する仕組みは存在しない。IR/EXP本文が記述的な記録を担う。

### 2.5 Skillとownerの配置

- Orchestration: `doc-driven-dev-graph`(唯一のgraph-wide router)、
  `briefing-flow`、`planning-flow`(graph-delegated subgraphで
  `plan-doc` → 承認yield → `test-spec-doc` → `task-doc` を逐次化)、
  `implementation-flow`(SDP `flow_stack`。`impl-doc` は常時起動の
  `implementation_documentation` slot)。
- 文書生成Skillは各自の文書契約を所有: `idea-doc`、`discovery-doc`、
  `adr-doc`、`spec-doc`、`design-doc`、`plan-doc`、`task-doc`、
  `test-spec-doc`、`impl-doc`。`deep-dive` はinterview skillであり、
  文書ownerではない。
- 検査・保守: `doc-status`(read-only list/lint/audit/health)、
  `doc-maintenance`(明示preview→apply修復、index物質化、`migrate_docs` /
  `migrate_ids`)、`doc-dashboard`(オフラインHTMLスナップショット)。
- `skill-discovery-protocol` はflow adapterが消費するflow-neutral catalogと
  flow profileを生成する。

### 2.6 このアーキテクチャが生む構造的問題

- **2つの寿命に1つの永続化クラス**。runごとの一時状態(plan、task、
  checkpoint、receipt)が永続履歴としてcommitされるため、`#127` 規模の文書
  増大は構造的であり、並列作業が同じtracked file上で競合する。
- **1つのGraphへの責務混在**。知識・実行状態・検証事実がArtifact Graphと
  gate評価を共有するため、focus解決とgate証拠がアクティブな作業と無関係な
  アーティファクト(例: 他planのtask件数)に依存する。
- **検証結果がモデル化されていない**。`implementation-verified` はcaller
  signalであり、結果をclaim・checkリビジョン・subject commit/workspaceに
  結びつけるものがない。陳腐化した・無関係な結果を最新として証言できる。
- **常時起動の履歴生成**。`impl-doc` が全taskで起動するため、持続的知識が
  生じたかどうかに関わらずIR/EXPが蓄積する。
- **型なし双方向relation**。手動管理の逆方向ペアは乖離し、legacyフィールド
  (`derives-from` 等)は機械的に安全な再割当てができない曖昧な意味を持つ。
- **スキーマ境界がない**。CLI境界で現行repoと旧repoを区別する仕組みがない。

## 3. 移行後のアーキテクチャ(v3)

### 3.1 3つのStore、それ以外はすべて派生

```text
 Git管理(持続的)              Git管理外(ローカル/明示的引継ぎ)
 ┌───────────────────────────┐  ┌────────────────────────────────────────┐
 │ Knowledge Graph           │  │ Execution Store                        │
 │  docs/specs designs adr   │  │  .apm/state/doc-driven-dev/runs/<id>/  │
 │  discovery ideas          │  │   manifest · plan.md · tasks           │
 │  docs/knowledge           │  │   checkpoints · receipts · trace       │
 │  docs/verification        │  └────────────────────────────────────────┘
 │  docs/.doc-driven-dev/    │  ┌────────────────────────────────────────┐
 │    schema.json            │  │ Evidence Store                         │
 └───────────────────────────┘  │  不変Evidence Record + artifact参照;   │
        │                       │  retention: transient/release/durable  │
        ▼                       │  (所在はmanifestで追跡)                │
        └──── 派生 ────────────►└────────────────────────────────────────┘
                  │
                  ▼
   Graph State v3 · Dynamic Task Graph(読み取り専用・Run単位)
   Verification Summary · Index · Dashboard · doc-status finding
```

分割軸は**寿命と信頼境界**であり、ファイル形式ではない。持続的知識はGitに
残り、runごとの実行状態と検証結果は独自の整合性規則を持つStoreへ移り、
その上のあらゆるビューは派生的で再生成可能である。

### 3.2 Document Registry v3(`#234`)

文書型・保存先・status・lifecycle・owner・許可relationの唯一の正本となる
共通Registry。部分的な権威だった `doc_types.ts` + `doc_repository.ts` +
`doc_ownership.ts` を置き換える。

- 型ごとに `persistence: durable | ephemeral | evidence | derived`、
  canonical dir、alias、`idPrefix`、type別 `status`、`lifecycle`、index
  owner、必須フィールド、許可relationを宣言する。
- 新しいdurable型: **Knowledge**(`docs/knowledge`、
  `knowledge_kind: codebase | architecture | operation | lesson`)と
  **Verification Design**(`docs/verification`)。
- `lifecycle: draft | current | superseded | retired` はtype `status` とは
  別軸。未知のlifecycleを暗黙に `current` と推定しない。
- Plan / TaskはExecution型へ移管され、canonical文書集合から外れる —
  durable文書として新規作成できない。IR/EXPはlegacy専用。
- 22桁Base62 ID機構は再利用。ADRのowner境界とshared/owner別index契約は維持。

### 3.3 Knowledge Relations v1(`#235`)

- **Claim ID**(`SPEC-<id>::R-01`)は見出し・本文の変更でも安定し、文書内で
  一意。重複・削除・文書間移動を検出する。
- 型付き**単方向**relationで、source→targetのみを正本保存する:
  `motivates`(idea/discovery→spec)、`decides-for`(ADR→spec/design)、
  `realizes`(design→spec)、`informs` / `explains`(knowledge→doc)、
  `supersedes`(durable間)。逆リンクは常に派生。
- `checks`(VD→claim)はcheckの `target` から導出、`supported-by`
  (claim←evidence)はEvidence Storeから導出。front matterと本文への二重保存
  は行わない。
- Lint: 許可source/target行列、Claim存在、循環、重複、未解決参照。legacy
  relationはmigration入力のみであり、新意味への無条件変換はしない。
- Knowledge GraphはPlan/Task/Evidenceの件数・順序で不安定にならない。

### 3.4 Execution Store v1(`#236`–`#238`)

root: worktreeごとの `.apm/state/doc-driven-dev/runs/<run-id>/`
(gitignore対象)。共有rootは明示設定時のみ許可。

- **Run manifest**: runId、revision、base commit、graph id、focus、承認
  digest、status。
- **Plan**: run内の編集可能Markdown。承認はplan digest + actor + timeに
  紐づく — planを変更すれば承認は無効化される。
- **Task**: ID、status、`dependsOn`、check参照、version。
  `(runId, taskId)` で参照し、裸のglobal task IDは使わない。
- **Checkpoint / Receipt / Trace**: 種別ごとの独立ファイル。
  `run_trace.jsonl` は引き続き非正本の診断。
- 整合性: run・task単位のCAS、runごとの単一writer、atomic replace + fsync、
  partial write検出を伴うcrash resume。CAS競合は更新を拒否し、lost updateを
  防ぐ。
- 可搬性: デフォルトはローカル。worktree/マシン間の引継ぎには明示的な
  export/importまたは宣言済み共有Storeが必要で、認可・衝突・スナップショット
  整合性を検査する。activeなRunのdisposeには最終状態と引継ぎ要件の検査を
  要する。

このStoreへ移管されるもの(`#237`、`#238`):

- **Planning Flow + Task Graph**: run内でplan承認 → task具体化。Task Graphは
  runスナップショットの読み取り専用決定Projectionで、v2の意味を維持する
  (`active` / `runnable` / `resumableActive` / `blocked` / `idle`、
  cycle/duplicate/未解決/空でfail-closed、`wont-do` は依存を充足しない)。
  異なるrunやworktree由来のtaskを混線させない。
- **Caller Effect Receipt / Checkpoint / Commit Gate**(`#238` でlanded):
  `docs/tasks` の
  proof pathとfront matter `effectOutcomes` / `checkpointEvidence` は廃止。
  `EffectOutcome` のinput/outputは型付きReference(durable文書+revision /
  execution task+version / provider冪等性)になる。effect scope照合、
  dispatch attribution、保存済みreceipt再利用、commit gateのbaseline意味を
  `recordReceipt` / `recordCheckpoint` 経由で継承する。provider成功後に記録が
  断絶した場合、冪等性照合なしに完了済みと断定しない。

### 3.5 検証: Design / Evidence / Assessment(`#239`–`#241`)

単一の `test-spec` 意図文書と `implementation-verified` signalを、3つの契約
へ置き換える:

- **Verification Design v1**(durable、`docs/verification/`):
  `VerificationCheckV1 { id, target, method, implementation, preconditions,
  passCriteria, limitations, required }`。`target` はClaimを参照。
  `method` はdiscriminated union(`unit`、`integration`、`e2e`、
  `property`、`static`、`model-checking`、`formal-proof`、
  `runtime-monitoring`、`manual-review`)で、criteriaは手法別に型付け —
  異なる検証手法の成功条件を1つのbooleanに潰さない。`checks[].target` が
  唯一の正本であり、Graphのrelationは導出。既存VDを更新・再利用し、必要な
  場合のみ新規作成する。
- **Evidence Record v1**(immutable store): evidence IDごとの追記専用Record。
  claim `documentRevision`、check `designRevision`、subject(`commit` |
  `workspace(snapshotDigest)`)、method/provider/runId/environment、
  `outcome: passed | failed | inconclusive | error | not-run`、artifactの
  URI/SHA-256/retentionを記録。`putImmutable` は同一ID・異内容で失敗し、
  同一内容の重複putは冪等。索引は派生で再生成可能。内容同一性の証明なしに
  workspace結果をcommit結果へ昇格しない。retention区分:
  `transient | release | durable`。リポジトリ / CI / 外部providerの
  artifactを区別する。
- **Evidence Assessment + Verification Summary**: 記録済みEvidenceが*現在の
  対象*に有効かを評価: `applicability`、`availability`、`integrity`、
  `assessment: sufficient | insufficient | indeterminate`、および理由。
  claim/check revisionまたはsubject commit/workspaceが不一致なら、
  `passed` Recordもsufficientではない。Summaryはrequired checkのcoverageを
  分類し、`not-applicable` 判定を明示的根拠付きで記録 — `unexecuted` と
  混同しない。**Verification Gate** はAssessmentをauthorityとし、一律passの
  `implementation-verified` signalは廃止。waiverは権限・理由・範囲・期限を
  伴い、単なるskipと区別する。

**Evidence ≠ Receipt**: Effect Receiptはeffectが*実行された*ことの証明、
Evidence Recordはcheckの*結果*の記録。型・生成経路・API・UI表現を意図的に
分離する。

### 3.6 Graph v3(`#243`)

- `GraphStateV3 { knowledge, execution, verification, focus, gates, signals,
  blockers, hardBlockers }` — 3つのStoreの投影で、Artifact Graph投影を
  置き換える。
- **Focus** はdurable Claim/Document IDとRun IDで解決する。他run・他chainの
  plan/task件数で `focus-required` にはならない。曖昧なfocusは引き続き
  fail-closed。
- Graph Definition `schemaVersion: 3` とGraphRoute v3は、宣言topology、
  one-edge routing、priority、required audit、approval/commit gate、
  run-to-yield、hard blockerを維持する。
- Gateは文書の存在ではなく、**対象の要求/判断/実装/検証が十分か**を検査し、
  `pass | fail | blocked` とbasisを返す。`not-applicable` / `waived` は
  証拠と権限を要求する。
- 通常経路: `probe → briefing/design → planning → task-graph →
  implementation → verification → knowledge-consolidation → exit-audit`。
  宣言済みloopback付き。`docs/tasks` の強制生成、旧Artifact chain、v2
  GraphRoute受容は廃止。CLIは `runId` / `stateRoot` を取り、通常v3 CLIは
  `--task-dir` を拒否する。

### 3.7 Schema ManifestとPreflight(`#233`)

- 消費者は `docs/.doc-driven-dev/schema.json` を持ち、
  `schemaVersion: 1`、`documentRegistry: 3`、`knowledgeRelations: 1`、
  `verificationDesign: 1`、`evidenceRecord: 1`、`graphDefinition: 3` を
  宣言する。Execution Runは独立した `schemaVersion: 1` で管理する。
- 共有preflightガード(`schema_preflight.ts`)を通常のCLI/生成/変更入口に
  挿入し、`current | uninitialized | migration-required |
  migration-incomplete | unsupported-version | invalid` のいずれかを返す。
  Manifestだけに依存せず、実ファイル/型/relationの軽量整合検査を併用する。
- 結果はread-only JSON診断(reason code、検出version、path、推奨コマンド)。
  current以外はすべてfail-closedし、明示列挙されたmigration操作のみを
  認可する。

### 3.8 Migration(`#245`、`#247`)

`doc-maintenance` が所有。legacy readerが存在する唯一の場所。

- `migrate plan` — 完全read-only。全legacyアーティファクト(spec/ADR/design/
  discovery/test-spec/plan/task/IR/EXP、relation、index、caller
  checkpoint/receipt)を収集し、決定的レポートを返す: 入力hash、ファイル
  一覧、書込予定、変換可能項目、意味判断が必要なblocker、残存リスク、
  明示的解決入力、`planHash`。
- `migrate apply --expect <planHash>` — 明示的apply: 完全preflight
  (source/target/owner/git-dirty/state root/manifest/参照)、staging +
  migration journal、`prepare → transform → validate → publish →
  finalize`。異種ストレージを一括atomic renameできないため、journalで
  resume/rollbackを駆動し、partial failureの誤報を禁止する。旧文書の削除は
  移行後整合確認のあと。Schema Manifestの `current` 確定は最後に行う。
  2回目のapplyは安全なno-op。
- 変換規則: test-spec → Verification Design(Guarantee/Rule/Example/限界を
  保持)。plan/task/承認/DAG → run snapshot。IR/EXP → Knowledge / ADR /
  Spec / Design / Evidence / diagnostic traceへ分類。曖昧なrelation、
  lifecycle、証拠はblockerとして提示 — 意味を推測しない。
- **Active Run**: ローカル状態はclone/worktree間で自動共有されないため、
  applyには明示的export/importまたは宣言済み終了処理を要求する。共有されない
  ローカル状態をコピーしただけでは引継ぎと見なさない。

### 3.9 Flow・Skill・診断(`#244`、`#246`、`#249`)

- `briefing-flow` / `planning-flow` / `implementation-flow` / SDP
  `flow_stack` をv3のdelegate境界へ再接続: 既存文書の再利用と要件充足性を
  起点とし、強制生成を廃止。`plan-doc` / `task-doc` はrun内の状態操作へ
  再定義。`test-spec-doc` と `impl-doc` は通常trigger経路から外す(常時起動
  の `implementation_documentation` slotを条件付きへ変更)。
- **`knowledge-doc`**(新規、`docs/knowledge`): 新規作成より先に既存
  Spec/Design/ADR/Knowledgeの検索・更新・統合を優先。実装で得た知見
  (設計・修正の理由、再発防止、確定した制約)を持続知識へ統合する一方、
  チャット的作業記録やコマンド実行ログは持続知識に混ぜない。保存すべき
  知見がない完了は正当なno-op。重要な知見が未整理ならRun終了Gateへ伝える。
- `doc-status` / `doc-maintenance` / Index / `doc-dashboard` を新しい正本へ
  切替: 型付きrelation、Claim/Check ID、stale参照、Evidenceの
  applicability/availability/integrity、tracked/ephemeral違反、
  migration-needed。index物質化は派生のままで `docs/knowledge` +
  `docs/verification` を対象に追加。Git管理外Runやtransient Evidenceは
  README indexへ混ぜない。DashboardはExecution ReceiptとEvidenceを混同しない。
- 配布: 英日SKILL/referenceの同等性、sourceからのJS/schema再生成、v2
  runtime残骸(legacy proof path、`--task-dir`、test-spec/impl-docの既定
  trigger、v2通常入口)の撤去 — legacy readerはmigration内部のみに残る。

### 3.10 Deterministic E2E(`#248`)

既存の `route_graph` + `runCaller` + scripted delegate + 独立Validatorの
ハーネス構造を維持し、Golden Caseを新契約へ切り替える — 宣言済み17ケース:
v3でのbootstrapからexitまで、旧treeでのpreflight停止+migration専用、
run間のfocus/resume、承認digest変更時の再承認、task DAG意味、CAS競合、
receipt scope/冪等性、commit gate baseline、Evidenceのrevision/subject不一致、
部分的coverageとwaiver期限切れ、新規Markdownゼロの完了、Knowledge統合、
plan/applyのhash固定と冪等性、migration中断・再開、indexなしworktree、
通常入口でのv2拒否。

## 4. 概念対応表: v2 → v3

| v2の概念 | v3の概念 | 補足 |
| --- | --- | --- |
| `docs/plans`、`docs/tasks` Markdown | Execution Store run snapshot(plan.md + task record) | planは編集可、taskは `(runId, taskId)` キー |
| task front matterの `status`、`depends-on` | task recordの `status` / `dependsOn` + CAS version | 同じDAG意味、読み取り専用Projection |
| task `effectOutcomes` / `checkpointEvidence` | run単位のCheckpoint / Effect Receiptファイル | 型付きreference、scope/冪等性照合 |
| `DEFAULT_PROOF_PATH = docs/tasks/...` | `recordReceipt` / `recordCheckpoint` API | proof pathは通常runtimeから撤去 |
| `test-spec` 文書 | Verification Design(`docs/verification`) | 意図のみ、Guarantee→Checkへ |
| `implementation-verified` signal | Evidence Assessment → Verification Gate | revision/subject不一致は検証済みとしない |
| (結果Storeなし) | Evidence Store(`EvidenceRecordV1`) | 不変、リビジョン管理、artifact参照 |
| taskごとの `ir` / `exp` | `knowledge-doc` 条件付き抽出 + diagnostic trace | 常時生成を廃止 |
| 無型双方向 `relations` | 型付き順方向relation + 派生逆リンク | `motivates`/`decides-for`/`realizes`/`informs`/`explains`/`supersedes` |
| 唯一のライフサイクル `status` | `status`(type別) + `lifecycle` の2軸 | 旧status→lifecycleはmigrationで判定 |
| README/INDEX物質化ビュー | 不変 — 派生index(knowledge/verification dirを追加) | run/transient evidenceは除外 |
| Artifact chainによるfocus | Claim/Document ID + Run IDによるfocus | run間干渉を解消 |
| `--task-dir` CLIセレクタ | `runId` / `stateRoot` | v2値は通常実行で拒否 |
| (スキーマ境界なし) | Schema Manifest + 共有Preflight | 全入口で非currentはfail-closed |
| in-graph `migrate_docs`/`migrate_ids` | `doc_maintenance migrate plan/apply` | journalで再開可能、hash固定 |
| `schemaVersion: 2` graph/state/route | `schemaVersion: 3` + Store別version | 単一の現行スキーマ、v2並走なし |

## 5. 変わらないもの

- 宣言topologyに基づくone-edge routing。routerが2本目のedgeを辿ることは
  ない。
- Caller所有の `run-until-yield` / `single-step`、yield table、bounded
  autonomy budget、fingerprintループ検出。
- Commit gateのbaseline意味(`head` + `dirty`、`commit-required`、
  `commit-waived`) — receiptの置き場所は変わるが強制は維持。
- Fail-closed姿勢: 不正入力、未知signal、曖昧focus、証拠不足は推測せず
  ブロックする。
- 派生物質化indexと `doc-maintenance` のpreview→apply規律、ADRとsuite dirの
  owner境界。
- 非正本診断としての `run_trace.jsonl`。
- durable知識のauthorityとしてのMarkdown — 対象を全アーティファクトから
  知識と検証設計へ絞る。

## 6. Issue対応表

| Issue | スコープ | 依存 |
| --- | --- | --- |
| `#233` | Schema Manifest v1 + 共有Migration Preflight | — |
| `#234` | Document Registry v3 / lifecycle / owner契約 | `#233` |
| `#236` | Execution Store v1: CAS、atomicity、引継ぎ | `#233` |
| `#235` | Claim ID + Knowledge Relations v1 | `#234` |
| `#237` | Planning flow + Task GraphのExecution Store化 | `#234`, `#236` |
| `#238` | Caller Effect Receipt / Checkpoint / commit gate移管 | `#236` |
| `#239` | Verification Design v1 + Check契約 | `#234`, `#235` |
| `#240` | Immutable Evidence Store | `#239` |
| `#241` | Evidence Assessment + Verification Summary + gate方針 | `#235`, `#239`, `#240` |
| `#242` | `knowledge-doc` Skill + 抽出契約 | `#234`, `#235` |
| `#243` | Graph State / Route / Definition v3 | `#233`, `#235`, `#237`, `#238`, `#241`, `#242` |
| `#244` | Flow + SDP `flow_stack` 再接続 | `#237`, `#239`, `#242`, `#243` |
| `#245` | Migration inventory + read-only plan | `#233`–`#237`, `#239`, `#240`, `#242` |
| `#246` | doc-status / doc-maintenance / index / dashboard更新 | `#233`–`#235`, `#239`–`#241`, `#243` |
| `#247` | Migration apply + resume/rollback + 事後gate | `#237`, `#238`, `#240`, `#242`, `#243`, `#245`, `#246` |
| `#248` | Deterministic E2E + 回帰fixture | `#237`, `#238`, `#241`, `#243`, `#244`, `#246`, `#247` |
| `#249` | 英日skill/CLI/配布物整合 + 旧runtime撤去 | `#244`, `#246`–`#248` |

フェーズ順(`#232`): **A** 基盤(`#233`, `#234`, `#236`) →
**B** 独立領域(`#235`, `#237`, `#238`, `#239`, `#240`, `#241`, `#242`、
並列可能) → **C** 実行経路切替(`#243`, `#244`) →
**D** 移行+診断(`#245`, `#246`, `#247`) →
**E** 完了保証+配布(`#248`, `#249`)。

## 7. 設計が担うガードレール

- 通常処理は新スキーマのみを読み、legacy解析はmigration内部のみに存在する。
- 二重正本を作らない: 逆relation、check relation、evidence summary、indexは
  常に派生生成する。
- EvidenceとEffect Receiptは全層で別契約。
- Migration planはhash固定・preview・明示apply・再開可能・事後監査が必須。
  active Runの引継ぎは前提条件であり、想定で済ませない。
- Deterministic E2Eが構造・権限・証拠・再開を検証する。LLMの文章品質は
  設計上のスコープ外。
