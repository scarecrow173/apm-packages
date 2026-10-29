# Parallel Delegation Safety Contract

この contract は、`implementation-flow` が独立した Task Graph エントリを
並列 subagent slice として実行してよい条件と、merge 時に結果をどう検証するかを
定義します。`taskGraph.edges` 上の dependency 独立性は並列 dispatch の
**必要条件であって十分条件ではありません**。slice が並列安全なのは、宣言された
write scope が他のすべての候補と検証可能な形で分離している場合だけです。
serial 実行は常に正しい fallback であり、この判定は scope を推測しません。

プログラム caller は `scripts/check_parallel.js`（dispatch 判定に
`lib/parallel_safety.ts`、merge 検証に `lib/merge_verification.ts`）を使い、
エージェント caller は同じ判定順序と同じ verdict 語彙を適用します。

## Eligibility Authority

task の eligibility は Task Graph projection が権威であり、この contract は
`buildTaskGraph` を再実装も弱体化もしません:

- `taskGraph.issues` が空でない場合 → `blocked`。どの slice も dispatch しません
  — scope を読む前に fail closed します。
- `GraphRoute.condition` が `tasks-active` の場合、候補は厳密に
  `taskGraph.resumableActive` です。
- それ以外の場合、候補は `taskGraph.runnable` です。
- 候補リストにない task は ineligible であり、この判定で並列・逐次いずれの
  開始対象としても評価されません。

## Write Scope Declaration

各 task の `## Affected Files` セクションだけが、宣言された write scope の
情報源です:

- `/` または `/*` で終わる項目は directory prefix、その他の項目は完全一致の
  file path です。path は forward-slash の repo 相対形式に正規化されます。
- 絶対パス、`..` による脱出、埋め込みの `*`/`?` セグメント、パスでない記述
  （例: `auth module`）は検証不能です。
- `## Affected Files` セクションがない、または空 → `scope-undeclared` →
  serial。
- 検証不能な項目が 1 つでもある → `scope-unverifiable` → serial。判定は
  記述から scope を推測したり、ありそうな path を当てはめたりしません。
- scope 判定は `Affected Files` という見出しに literal（case-insensitive）で
  マッチします。ローカライズされた見出しはセクション欠落として扱われ、
  現在は `scope-undeclared` → serial になります。
- フェンス付きコードブロック（```` ``` ```` / `~~~`）内の見出しや bullet は
  宣言ではなく文書です — フェンス内の `## Affected Files` はセクションを
  構成しません。セクション内の `###` 以深のサブセクション配下の bullet も
  scope に入りません。
- path は case-insensitive に比較されます（開発環境は Windows）。
  大文字小文字の綴り違いだけで scope や collision 判定を迂回できません。

## Conflict Classes

ペアワイズの write scope 重複は `write-conflict` であり、両方の task を
serial にします:

- 2 つの task が同じ file path を宣言した場合。
- 一方の scope の directory prefix が他方の path を包含する場合
  （`src/` 対 `src/auth/login.ts`）。dir 対 dir の prefix 包含も同様です。
- 共有 generated file — `docs/*/README.md` のような索引、lockfile、共有設定 —
  を 2 つ以上の task が宣言した場合。宣言しない方が望ましく、generated index の
  更新は serial merge phase に回します。
- task 文書の status / front-matter への書き込み: slice が更新してよいのは
  自分の task doc だけであり、scope が task 文書上で重なれば conflict です。

conflict ペアに 1 つでも関わる task は serial です（安全側）。conflict のない
task 同士は引き続き並行実行できます。`decision` が `parallel` になるのは
2 つ以上の task がクリアしたときだけであり、clean な task が 1 つだけの場合は
並列化する対象がないため `serial` を返します。

## Slice Isolation

独立した slice は別々の worktree または clone で編集します。各 slice の完了後、
実際の差分 — `git diff --name-only` と `git status --porcelain` — を収集し、
宣言された scope の部分集合であることを検証します:

- rename は source と destination の両方の path として報告されるため、
  保護された path からの rename が純粋な追加に偽装されることはありません。
- 宣言された scope の外の touched path → `scope-violation`。
- contract 上すでに必須な 2 種類の書き込みは scope 宣言を要しません:
  slice 自身の task doc（status/front-matter 更新）と `docs/impl/` 配下の
  evidence 成果物（implementation record）。
- 他の task の文書は一切書き込めません — scope 宣言で許可することはできず、
  自分以外の task doc に触れた場合 → `blocked`。
- 同じ path を 2 つの slice が触れた → `write-collision` → `merge-review`。
  last-writer-win が黙って受理されることはありません。

## Per-Slice Handoff

すべての並列 slice は
[delegate-execution-policy](../../doc-driven-dev-graph/references/delegate-execution-policy.ja.md)
が定義する `DelegateHandoff` を受け取り、自分の task に束縛されます:

| Field | 並列 binding |
| --- | --- |
| `focus` | slice 自身の task 文書 |
| `permissions.write` | 宣言された `## Affected Files` scope のみ — それ以外は不可 |
| `acceptanceCriteria` | task の `## Verification` チェックリスト |
| `completion` | 完了した `EffectOutcome` と、slice 自身の task ID を参照する evidence |

## Merge Verification

slice の結果を受理する前に、各 slice を検証します
（`verifyParallelMerge`）:

- **Scope** — 実際の touched path が宣言された scope 内に収まること。
  scope の権威は task doc の `## Affected Files` です: doc が読める場合、
  supplied `declaredScope` の各項目は doc の宣言で包含されている必要があり、
  doc の宣言にない、またはそれより広い項目は inflated な主張として
  `blocked` されます。他の task 文書を対象とする違反は `blocked` 相当、
  その他の scope 外 path は `merge-review` 相当です。
- **Collision** — 同じ path を触った slice が 2 つ以上ないこと。
- **Evidence binding** — すべての evidence path が `docs/impl/` 配下か slice
  自身の task doc であり、かつファイル内容が slice 自身の task ID を文字どおり
  含むこと（`verifyEvidenceBinding`）。`evidence-mismatch` は `blocked` 相当
  です — ある task の evidence を別の task に適用することはできません。

merge verdict の ladder は `merge`（clean）→ `merge-review`（collision または
task 文書以外の scope 違反）→ `blocked`（evidence mismatch、task 文書への
scope 違反、不正な入力）です。

clean な merge の後、graph を再投影して gate を再評価します — `doc-status`、
test、`requiredAudits` は通常どおり実行され、merge がそれらをスキップする
ことはなく、未検証の task が `done` になることもありません。canonical artifact
の identity（ID、relations、status）は無傷でなければなりません。

## Fallback Ladder

この contract は一方向にだけ低下します:

1. **Serial fallback** — 情報が不足または競合 → task を serial に実行します。
   scope を推測しません。
2. **Merge review** — 実際の diff が衝突した、または scope 外に逸脱 → 停止して
   手動レビュー。last-writer-win で解決しません。
3. **Blocked / yield** — evidence を束縛できない、または検証入力が不正 →
   `blocked`。granted authority 内で作業を進められない場合は `yield` を
   返します。

並列 delegation が `commitGate` や `authority-required` を迂回することは
ありません — 各 slice は独立に effect-outcome contract を満たします。

## CLI Contract

```text
node scripts/check_parallel.js --plan <path-or-id> [--cwd DIR] [--task-dir DIR] [--json]
node scripts/check_parallel.js --verify-merge <slices.json> [--cwd DIR] [--base-ref REF] [--task-dir DIR] [--json]
```

- `--plan` モードは解決した plan artifact から Task Graph を構築し、
  `ParallelReport` を出力します。`decision` が `parallel` のとき exit `0`、
  `serial` または `blocked` のとき exit `1`。
- `--verify-merge` モードは slice の結果を読み、`MergeReport` を出力します。
  `verdict` が `merge` のとき exit `0`、それ以外は exit `1`。
- 2 つのモードは排他です。`--cwd` はプロセスの作業ディレクトリが既定、
  `--task-dir` は `docs/tasks` が既定です。`--help`（`-h`）は usage を
  stdout に出力して exit `0` で終了します。`--json` 付きではエラーが
  `{"error": "..."}` として stdout に出力され、それ以外は usage とともに
  stderr に出力されます — 引数エラーとランタイムエラーは常に exit `1` です。

`ParallelReport` のフィールド:

| Field | 内容 |
| --- | --- |
| `decision` | `parallel` \| `serial` \| `blocked` |
| `eligible` | 候補 task ID（`resumableActive`、なければ `runnable`） |
| `parallel` | 並行実行して安全な task ID |
| `serial` | `[{ id, reasons }]` — serial 限定の task。理由は `scope-undeclared`、`scope-unverifiable`、`write-conflict` |
| `conflicts` | `[{ a, b, path }]` — task `a` と `b` の間で重複した path |
| `taskGraphIssues` | `blocked` 時の Task Graph issue code |

`MergeReport` のフィールド:

| Field | 内容 |
| --- | --- |
| `verdict` | `merge` \| `merge-review` \| `blocked` |
| `findings` | `[{ code, taskId?, path?, message }]` — code は `scope-violation`、`write-collision`、`evidence-mismatch` |

slices ファイルは
`[{ taskId, declaredScope, evidencePaths, taskDocPath, touchedPaths?, baseRef? }]`
です。supplied フィールドは**信頼されるのではなく主張として検証**されます:
`declaredScope` は task doc の `## Affected Files` と照合され、
`touchedPaths` は宣言 scope と contract が暗に許可する書き込みと照合され、
`evidencePaths` は evidence subtree と task-ID binding と照合されます —
`docs/impl/` の symlink が checkout 外の evidence を束縛できないよう
realpath チェックも含みます。`touchedPaths` は省略して verifier が
`collectChangedPaths` で実際の diff を収集する方が望ましいです。
slice 単位の `baseRef` は `--base-ref` より優先され（既定 `HEAD`）、
slice より前の時点を指す必要があります — slice の変更以後の base では
収集される diff が権威あるものではなく不完全になります。

この contract が対象とするのはリポジトリ内の repo 相対 path のみです。
checkout 外の共有リソース — service、共有ディレクトリ、リモート状態など —
の直列化は引き続き dispatcher の責任です。
