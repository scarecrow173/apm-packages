---
name: doc-driven-dev-lifecycle
description: "文書駆動開発ライフサイクル全体の graph-backed thin router。route_lifecycle.js で canonical artifact と型付き signal を probe し、宣言済み delegate と planning の build_task_graph.js composite を dispatch し、明示的な Phase gate、audit、focus 選択、fail-closed loopback を強制する。**利用タイミング**: (1) 新機能・新プロジェクト・大規模変更を開始するとき、(2) canonical docs を migration または bootstrap するとき、(3) briefing から exit まで end-to-end orchestration が必要なとき、(4) graph topology と順序制約を強制するとき。キーワード: lifecycle graph、thin router、Task DAG、focus、フェーズゲート、メタスキル。"
license: MIT
---

# Doc-Driven Dev Lifecycle

既存の doc スキルを任意の migration、bootstrap フェーズ、5 フェーズのフローで選択・順序付けし、
明示的なゲートで制御することで文書駆動開発の全ライフサイクルを
オーケストレーションする。ライフサイクルは規範となる graph と state 契約の薄い
router であり、委譲された subgraph を平坦化しない。

これは**graph-backed メタスキル**である。`route_lifecycle.js` が canonical
document と型付き signal を probe し、宣言された graph edge だけをたどる。
次の delegate、必須 audit、blocker、および plan に focus がある場合は
`build_task_graph.js` が返す Task DAG を安定した route として出力する。

## 利用タイミング

- 新機能・新プロジェクト・大規模な変更をゼロから始めるとき。
- 既存 Markdown docs を canonical な doc-driven-dev tree へ移行する必要があるとき。
- briefing 前に canonical な docs tree を bootstrap する必要があるとき。
- どの doc スキルから始めるべきか不明なとき。
- アイデアから実行まで end-to-end の文書オーケストレーションが必要なとき。

## フロー概要

ライフサイクルは
`Phase -1 Migration（任意） -> Phase 0 Bootstrap -> Phase 1 Briefing ->
Phase 2 Design -> Phase 3 Planning & Tasking -> Phase 4 Implementation ->
Phase 5 Exit`
の順で進む。

各フェーズにはゲートがあり、通過しなければ次へ進めない。各フェーズには
loopback ルールもあり、ゲート不通過によって同一フェーズまたは前段フェーズへ
戻る場合と、後続フェーズで見つかった upstream gap によって前段へ戻る場合が
ある。
詳細は `references/flow-contract.ja.md` を参照。

Phase 5 に進む前に、実装結果を承認済み spec、ADR、design、plan、
task の検証証跡と照合する。すべてのフォローアップを `bug-fix`,
`decision-required`, `new-feature`, `doc-only`, `defer`, `wont-do` の
いずれかに分類する。未分類フォローアップが残っている間は Phase 5 に進まない。

## Router Loop

すべてのライフサイクル turn で graph router を使う。以下の人間向け Phase
ラベルは文脈として残すが、dispatch の判断は JSON route を使う。

1. 1 つ以上の `--focus` path で active artifact chain を選ぶ。
2. 現在の node と観測した signal を指定して `route_lifecycle.js` を実行する。
3. `reasonCode` が `focus-required` なら停止し、明示的な focus を得る。推測してはならない。
4. route が報告した required audit をすべて実行する。
5. 返された delegate、または文書化された planning の composite step だけを dispatch する。
6. 完了証跡を canonical document に記録する。
7. 返された node から、型付き signal を付けて router を再実行する。
8. `complete`、またはユーザー権限を要する blocker が報告された場合だけ停止する。

Planning gate では、文書化された composite step として
`build_task_graph.js` を実行できる。Task graph は独立した root task を fan-out
し、すべての predecessor 完了後に dependent task へ fan-in する。cycle、未解決
task reference、その他の graph issue があれば fail-closed とし、runnable task を返さない。

### Ownership と Source of Truth

- `graphs/lifecycle.yaml` は node/edge topology と delegate binding の規範である。
- `references/flow-contract.ja.md` は人間の承認基準、証跡、フォローアップ分類の規範である。
- `references/lifecycle-state.ja.md` は derived state、focus、signal、fail-closed 動作の規範である。
- Markdown artifact は project history と status の規範であり、router はそこから state を導出するだけで置き換えない。

## フェーズ一覧

| Phase | 目的 | 主担当スキル | ゲート |
| ----- | ---- | ------------ | ------ |
| -1 | 既存 docs を canonical structure に移行する | `migrate_docs` | dry-run を確認済み; apply は original を削除せず canonical docs を作成する |
| 0 | briefing 前に canonical な docs tree を作成する | `scaffold_docs` | canonical `docs/` tree が存在し、既存ファイルが保持され、`docs/designs/overview.md` は `design-doc` に委ねられている |
| 1 | 要望を文書入力に変換する | `briefing-flow` | briefing 完了出力: 受け入れ条件付き spec + ADR |
| 2 | 設計を実装可能な形へ具体化する | `design-doc` | spec/ADR と整合した承認済み設計 |
| 3 | plan 統合と task 分解 | `plan-doc` + `task-doc` | 承認済み plan と検証付き task |
| 4 | ワークフロースキルでコード実装 | `implementation-flow` | 全タスクが検証通過 |
| 5 | 文書整合を確認する | `doc-status` | front matter, relations, index の整合 |

**重要な制約解決**: 任意の Phase -1 は既存 Markdown docs を移行しますが、original は削除しません。Phase 0 は canonical な docs tree を作成しますが、`docs/designs/overview.md` は作成せず `design-doc` に委ねます。Phase 1（Briefing）では、`briefing-flow` が管理する同じ discovery コンテキストから導出された場合、spec + ADR の並行作成が明示的に許可されます。後続フェーズではシーケンシャルゲートが適用されます（Phase 2 は Phase 1 完了が必須、Phase 3 は Phase 2 の承認済み設計と plan 承認後の task 作成が必須など）。

## フェーズ終了チェックリスト

### Phase -1 終了時

移行対象の既存 docs があるリポジトリでのみ必要。完了条件は migration contract で検証する:

- [ ] `migrate_docs` dry-run report を確認済み
- [ ] source-to-target mapping を受け入れている
- [ ] `--apply` run が original を削除せず canonical docs を作成している
- [ ] 既存の canonical target file が上書きされていない

### Phase 1 終了時

`briefing-flow` に委譲する。完了条件は `briefing-flow` の Phase D ゲートで検証される:

- [ ] spec-doc が存在し `status:` ≥ `proposed`
- [ ] spec-doc に `## Acceptance Criteria` に 1 件以上のエントリがある
- [ ] adr-doc が存在し `## Considered Options` に 2 件以上のエントリがある
- [ ] Entry Decision の選択が記録されている
- [ ] 「実装前ブロッカー」に分類された未解決項目がない

### Phase 0 終了時

bootstrap contract によって完了を検証する:

- [ ] canonical な `docs/ideas`, `docs/discovery`, `docs/specs`, `docs/designs`, `docs/plans`, `docs/tasks`, `docs/adr`, `docs/impl/ir`, `docs/impl/exp` ディレクトリが存在する
- [ ] 各 canonical ディレクトリに `README.md` がある
- [ ] 対象リポジトリ内の既存ファイルが変更されていない
- [ ] `docs/designs/overview.md` は bootstrap step では作成されていない

### Phase 2 終了時

- [ ] design-doc が存在し `status:` = `approved`
- [ ] design-doc が spec-doc と adr-doc を参照している
- [ ] 設計と ADR 制約の間に矛盾がない
- [ ] 実装境界が明確

### Phase 3 終了時（Planning & Tasking）

- [ ] plan-doc が存在し `status:` = `approved`
- [ ] plan-doc が design-doc を参照している
- [ ] PLAN-DOC-GATE-001 を満たしている（承認済み設計）
- [ ] 全ての task-doc エントリが作成済み
- [ ] 各タスクに `verification:` 条件がある
- [ ] タスクが plan-doc セクションにトレース可能
- [ ] タスク間の依存関係が文書化されている

## Entry Decision（Phase 1 → `briefing-flow` に委譲）

Phase 1 は [`briefing-flow`](../briefing-flow/SKILL.ja.md) メタスキルに委譲する。
`briefing-flow` は利用可能なスキルを動的に発見・ルーティングし、情報状態に応じて
適切なスキルスタックを構成して spec-doc + adr-doc の完成まで導く。

**MANDATORY**: Phase 1（Briefing）に入る際に
[`briefing-flow` SKILL](../briefing-flow/SKILL.ja.md) を読み、以下を理解すること:

- Entry Decision（A-1〜A-5）の経路選択
- Briefing スキル発見プロトコルとプロファイル設定
- スキルスタックを使った情報収集の実行
- Phase D ゲート（spec-doc + adr-doc 完了条件）

`briefing-flow` の Phase D ゲートを通過した時点で Phase 1 完了とみなす。
この時点で得られる `spec-doc` と `adr-doc` が、Phase 2 (`design-doc`) に入るための
完了成果物になる。

## Phase 1 スキルインターフェース

Phase 1 は `briefing-flow` に委譲されるため、スキルの発見・構成・実行は
`briefing-flow` 内の Briefing スキル発見プロトコルと `briefing-profile.md` で管理される。

以下は `briefing-flow` が管理する主要スキルの概要:

| スキル | カテゴリ | 期待出力 | 完了指標 |
| ------ | -------- | -------- | -------- |
| `idea-doc` | Document | `docs/ideas/` 配下の軽量 idea 記録 | 次のアクションが決まり捕捉済み；下流文書作成後に `status: promoted` |
| `deep-dive` | Frame | 制約と判断軸を含む確認済み intent 要約 | 明確な outcome、制約、未解決項目 |
| `steer-web-research` | Discover | 外部情報の調査結果 | エビデンス付きの調査レポート |
| `discovery-doc` | Document | `docs/discovery/` 配下の構造化探索成果物 | `status: resolved`、昇華候補に対処済み、`relations.derived-by` に下流文書リンク済み |
| `spec-doc` | Document | 正式な仕様書 | `## Acceptance Criteria` に 3 件以上のエントリ、`status: proposed` |
| `adr-doc` | Document | アーキテクチャ決定記録 | `## Considered Options` に 2 件以上のエントリ、理由が文書化 |

**注**: `briefing-flow` はこれらに限定されず、環境内の全利用可能スキルを動的に発見する。
詳細は [`briefing-flow` SKILL](../briefing-flow/SKILL.ja.md) を参照。

## Hard Gates

<HARD-GATE>
フェーズを飛ばしてはならない。各フェーズのゲートを満たしてから次へ進むこと。
ゲートを満たせない場合は、当フェーズ内でループするか前フェーズへ戻る。

**Why:** フェーズスキップは手戻りの最大原因。Phase 1 の出力不完全が Phase 3
の再設計の 40% を引き起こす。各ゲートは下流フェーズが上流品質を前提としているため存在する。
</HARD-GATE>

<HARD-GATE>
承認済み design-doc なしに plan-doc を作成してはならない（PLAN-DOC-GATE-001）。
承認済み plan-doc なしに task-doc を作成してはならない。

**Why:** 不安定な設計上での計画立案は 2-3 倍の手戻りを引き起こす。計画後の設計変更は
全タスクの再分解が必要。このゲートは「実装中に考えればいい」症候群を防ぐ。
</HARD-GATE>

<HARD-GATE>
緊急修正シナリオでも、最低限 spec-doc または adr-doc を根拠として残してから
実装に進むこと。

**Why:** 証跡なしの緊急修正は永久に技術的負債となる。6 か月後、なぜその修正が存在するのか、
まだ必要なのか誰もわからない。最低限の証跡は 10 分、謎コードのデバッグは数時間。
</HARD-GATE>

## プロセス

既存ドキュメントを持つ repository では、Phase 0 の前に任意の Phase -1 として
`migrate_docs` を実行します。まず dry-run で source-to-target mapping を確認し、
mapping が妥当な場合だけ `--apply` で再実行します。

**Migration contract**: `migrate_docs` は original を保持しながら既存 Markdown
docs を canonical な doc-driven-dev tree へ変換します。詳細は
`references/migration-contract.ja.md` を参照。

- **Bootstrap** — `scaffold_docs` を実行して canonical な docs tree を作成する。

**Bootstrap contract**: `scaffold_docs` は briefing の前に canonical な `docs/`
tree を作成する。既存ファイルを保持し、`docs/designs/overview.md` は
作成しない。`docs/designs/overview.md` は `design-doc` が所有する。

- **Briefing** — `briefing-flow` に委譲する。

**MANDATORY**: Phase 1（Briefing）に入る際に
[`briefing-flow` SKILL](../briefing-flow/SKILL.ja.md) を読み、以下を理解すること:

- Entry Decision（A-1〜A-5）の経路選択
- Briefing スキル発見プロトコルとプロファイル設定
- スキルスタックを使った情報収集の実行
- Phase D ゲート（spec-doc + adr-doc 完了条件）

**Do NOT Load** `briefing-flow` の references は Phase 1 開始時に `briefing-flow` 自身が管理する。

- **Design** — `design-doc` を呼び出し、spec/ADR との整合を検証する。

**MANDATORY**: Phase 3（Planning & Tasking）に入る前に
[`references/flow-contract.ja.md`](references/flow-contract.ja.md) §3 を読み、
詳細なゲート条件を理解すること。PLAN-DOC-GATE-001 と TASK-DOC-GATE-001 の要件を把握する。

- **Plan** — `plan-doc` を呼び出し、PLAN-DOC-GATE-001 を尊重して plan をレビューし、
  task 作成前に `status: approved` を取得する。
- **Task** — `task-doc` を呼び出し、承認済み plan を検証手順付きエントリへ分解する。
  TASK-DOC-GATE-001 を尊重する。

**MANDATORY**: Phase 4（Implementation）に入る前に
[`implementation-flow` SKILL](../implementation-flow/SKILL.ja.md) を読み、以下を理解すること:

- Skill Discovery Protocol とプロファイル設定
- スキルスタックを使ったタスク単位の実行
- 検証証拠の要件

Phase 4 の各 task で最初のコード変更前に
[`impl-doc` SKILL](../impl-doc/SKILL.ja.md) と
[`impl-doc` 規約](../impl-doc/references/impl-conventions.ja.md) を読むこと。
task に `in-progress` の Implementation Record がない状態では、Phase 4 の task 実行を開始しない。

**Do NOT Load** `implementation-flow` は Phase 3 完了前には読まないこと —
plan 承認とタスク分解が完了してから実装設定を始める。

- **Implement** — ワークフロースキルをタスク単位で適用し、検証通過を確認する。
- **Exit 監査** — `doc-status` を呼び出し、文書整合を検証する。

## ループバックルール

### Phase 2 → Phase 1 (Spec ギャップ)

設計作業で要件の不足または不明確さが判明した場合:

1. ギャップを1行で記録: "spec-gap: [説明]"
2. 影響を受ける spec-doc セクションを特定
3. `briefing-flow` を再実行（スコープ: 発見されたギャップのみ）
4. spec-doc を更新、必要なら status を `proposed` に戻す

### Phase 3 → Phase 2 (設計ギャップ)

計画立案で設計の不十分さが判明した場合:

1. ギャップを記録: "design-gap: [説明]"
2. 不足している設計決定または境界を特定
3. 影響を受けるコンポーネントに対して `design-doc` を再実行
4. 再開前に更新された設計が spec/ADR と整合することを確認

### Phase 3 → ADR/Design 更新 (新制約)

タスク分解で新たな制約が発見された場合:

1. 制約を記録: "constraint: [説明]"
2. ADR または design-doc のどちらを更新すべきか判断
3. 影響を受けるドキュメントを最小スコープで更新
4. ブロックされたタスクから Phase 3 を再開

### Phase 4 → Phase 1 または 2 (実装での発見)

実装で根本的なギャップが判明した場合:

1. 発見を記録: "impl-gap: [説明]"
2. 重大度を評価: spec レベル (→Phase 1) または設計レベル (→Phase 2)
3. 現在のタスクを一時停止し、適切なフェーズに戻る
4. 上流修正後、一時停止したタスクから再開

---

## アンチパターン

これらの考えや行動は失敗のサイン — 気づいたら STOP：

| アンチパターン | なぜ失敗するか |
| ---------------- | -------------- |
| 「緊急修正だから実装に直行」 | 証跡なしの実装は後で「なぜこうなった」が追跡不能 |
| 「設計は自明、design-doc は不要」 | 暗黙の設計は実装中に矛盾が発覚し手戻り 2-3 倍 |
| 「計画は後でいい」 | 設計変更後のプラン修正は全タスク再分解が必要 |
| 「要件は頭の中で明確」 | 頭の中の要件は検証不能、後で「それは言ってない」問題発生 |
| 「このフェーズゲートは厳しすぎる」 | ゲートを緩めると下流フェーズで累積的品質低下 |
| 「実装後にドキュメントを書く」 | 実装後ドキュメントは実装と乖離、メンテ不能化 |
| 「ループバックは非効率」 | ループバックなしで進むと問題が下流で拡大 |
| 「小さな変更だから全フロー不要」 | 「小さい変更」の積み重ねが設計を腐敗させる |
| 「ADR は官僚主義」 | 決定根拠なしは将来の自分が同じ議論を繰り返す |
| 「並行でドキュメントを作れば時短」 | **許可される場合**: 独立したドキュメント（spec + ADR を同じ discovery から平行作成）。**禁止される場合**: 依存関係のあるドキュメント（plan-doc 承認前に task-doc 作成、設計合意前に spec なし）。Plan 作成と task 分解は Phase 3 内で連続して実行するが、承認ゲートを跨いで並列化しない。 |

---

## よくある問題

| 問題 | 検出 | 解決策 |
| ---- | ---- | ------ |
| Spec-doc が draft のまま | front matter の `status: draft` または `acceptance_criteria:` が空/欠落 | 1-2 に戻り、不足している受け入れ条件を明示的に特定 |
| Entry 経路が不明 | 5分以上迷っている、「今すぐ受け入れ条件を書けるか？」 | Yes→D, No→A または B |
| 設計が ADR と不整合 | 設計が ADR にない制約を参照、または ADR 制約に違反 | ADR に新制約を追加するか、設計を修正する |
| Plan-doc がゲートで拒否 | `design_doc:` 参照がない、または design-doc の `status:` != `approved` | まず design-doc の承認ステータスを確認 |
| タスク分解が粗すぎる | `grep verification:` が任意の task-doc で空を返す | 各タスクがテスト可能な完了条件を持つまで分解 |
| 実装で spec のギャップ発見 | 実装が spec の受け入れ条件にない動作を要求 | ギャップの理由を記録、Phase 1 に戻り、再開前に spec を更新 |
| doc-status 監査失敗 | `doc-status` 出力が任意の文書で ERROR または WARN を表示 | 監査で指摘された具体的な問題を修正し、doc-status を再実行 |

---

## Phase 4: Implementation

plan 承認とタスク分解（Phase 3）後、`implementation-flow` を呼び出してコード実行を
オーケストレーションする。タスク単位で適切なワークフロースキルを
選択・順序付けし、検証ループを管理し、発見された制約をフィードバックする。

スキル選択、推奨組み合わせ、タスク単位実行プロセスの詳細は
`implementation-flow` SKILL を参照。

### エントリ条件

Phase 4 は Phase 3 のタスクが承認され実行準備が整った時に開始する。
Phase 4 の各 task で最初のコード変更前に `impl-doc` SKILL と規約を読み、
task に `in-progress` の Implementation Record がない状態では、Phase 4 の task 実行を開始しない。

### Phase 4 完了条件

- 全 `task-doc` エントリが実装済みかつ検証通過している。
- 実装中に発見された新制約が ADR/design に反映されている。
- コードレビューが完了している。
- すべての task はコード変更前に `in-progress` の Implementation Record を開き、
  その状態で実装を開始している。
- すべての Implementation Record は実装中に最新状態へ保たれている。
- すべての Implementation Record は task クローズ前に完了・監査されている。
- Experiment Log を使った task は、対応する Implementation Record から参照され、
  Phase 5 の前に監査されている。

### Phase 5 への移行

実装完了後、Phase 4 終了ゲート: 実装後レビュー / フォローアップ分類を通過する。
Phase 5 に進む前に、実装結果を承認済み spec、ADR、design、plan、task の
検証証跡と照合する。すべてのフォローアップを `bug-fix`, `decision-required`,
`new-feature`, `doc-only`, `defer`, `wont-do` のいずれかに分類する。
未分類フォローアップが残っている間は Phase 5 に進まない。

Phase 4 終了ゲートを通過した後、Phase 5（`doc-status`）に進み
最終的な文書整合検証を行う。

## Phase 5: Exit

Phase 5 の `doc-status` 監査がブロッキング指摘なしで通過したとき、
全文書が整合・追跡可能であることが確認され、フローは完了となる。

## 参照

詳細なフロー契約: `references/flow-contract.ja.md`
