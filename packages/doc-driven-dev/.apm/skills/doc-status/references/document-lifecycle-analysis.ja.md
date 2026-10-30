# ドキュメント・ライフサイクル・コスト分析 (Issue #127)

**ステータス:** 分析リファレンス — 実測結果と削減分類。メンテナ向け。
`SKILL.md` から意図的にリンクしていないため、ランタイムの読み込み面は
増えない。

## 1. 目的と範囲

doc-driven-dev を長期間利用するほど、canonical Markdown(idea、
discovery、spec、design、plan、task、test-spec、ADR、Implementation
Record)が蓄積する。progressive disclosure(#124)はその蓄積のうち
*コンテキストに読み込まれる量*を削減するが、*生成・保守される量*は
削減しない。本ドキュメントはライフサイクル・コスト —— 生成量、
リレーション/参照密度、孤児率、ステータス・ドリフト、保守
ファインディング —— を計測し、Graph/contract の保証を弱めずに
ドキュメント量を削減できる箇所を分類する。

### 非目標

- LLM のタスク達成品質、トークン/コスト/レイテンシ、意味的な
  スキル発火の計測。
- Graph のステータス権威、型付きリレーション契約、必須エビデンス
  ゲートの変更。
- `doc-status`(#87–#94)が所有する診断や `doc-maintenance` が所有する
  修復/マイグレーションの再実装。
- 一括削除、自動アーカイブ、参照を壊すコンパクション、ドキュメントの
  強制マージ、必須エビデンスを Git 履歴に隠すことの提案。
- ランタイムのリポジトリ走査と delegate の body 読み取りの等価性を
  主張すること —— 両者は別チャネルである(§2.4 参照)。

## 2. 方法

### 2.1 計測ツール

`scripts/doc-driven-dev/src/skills/lib/lifecycle_stats.ts` が
`analyzeCorpus(cwd)` を公開する。これは新しい診断ではなく、**既存の
doc-status パイプライン上の射影**である。

| 再利用する面 | 提供するもの |
| ------------ | ------------ |
| `scanRepository`(`lib/doc_repository.ts`) | 1回の canonical 走査: kind(canonical/index/unmanaged)、type、status、relations、links、ロケール兄弟、`resolveRelationTarget`/`resolvePath`、`artifactKeyOf` |
| `collectFindings` + `summarizeHealth`(`lib/doc_report.ts`) | `doc_status audit/health` が報告するのと完全に同一のファインディングとヘルス・カテゴリ |
| `inboundLinkCounts` + `inboundRelationCounts`(`lib/doc_structure_lint.ts`) | `lintOrphans` が使うのと同一の内向きカバレッジ・マップ(再利用のため export —— ロジックの複製なし) |

新しい意味論は集約(タイプ別バケット)、**settled / in-flight** の
ステータス軸、**stale-upstream** ヒューリスティックのみである。

- *Settled* = ドキュメント自身のライフサイクル作業が完了した状態
  (`done`、`wont-do`、`completed`、`implemented`、`resolved`、
  `routed`、`promoted`、`parked`、`archived`、`superseded`、
  `rejected`、`deprecated`、`abandoned` —— タイプ別の集合は
  `SETTLED_STATUSES` 参照)。`approved`/`accepted` の規範的
  ベースラインは in-flight のまま: 進行中の作業がそこから派生するのは
  正当だからである。
- *Stale upstream* = in-flight のドキュメントが、死んだステータス
  (`superseded`/`rejected`/`deprecated`/`archived`/`abandoned`/
  `wont-do`/`completed`/`done`)の上流ターゲットに
  `implements`/`derives-from`/`refines` で解決済みリレーションを
  1つ以上持つ状態。契約ではなくヒューリスティック信号 ——
  resolved/active な上流や規範的ベースラインは決してフラグされない。
- 旧フィクスチャ表記 `type: "implementation-record"` は `impl`
  バケットにマージする(`TYPE_ALIASES`)—— 同じアーティファクト種の
  契約以前の綴り。

### 2.2 コーパス

`tests/fixtures/doc-lifecycle/corpora.ts` が決定論的な
`createFixtureRepo` ハーネス(固定の `created`/`updated` 日付、
固定 id、固定本文)上に3つのコーパスを構築する。

| コーパス | モデル化するもの |
| -------- | ---------------- |
| `small` | `createFixtureRepo({})` —— 標準7文書チェーン(新規プロジェクト) |
| `benchmark` | #124 の約60文書コンテキスト負荷コーパス。`benchmarkCorpusFiles` として `doc-driven-dev-fetch-context.test.ts` と逐語共有 |
| `long-running` | 約100文書の合成プロジェクト: 完了チェーン4本、置換チェーン、進行中チェーン、停滞チェーンに加え、蓄積した債務(未昇格キャプチャ、孤児、stale upstream、インデックス・ドリフト、壊れたリレーション、出所欠落、ja 兄弟、非管理文書) |

`benchmark` コーパスは契約以前の綴り(`SPEC-B0101`、
`status: "confirmed"`)をそのまま保持する。doc-status はそれらを
`invalid-id-*` / `invalid-status` ファインディングとして報告する。
これは**忠実に計測されたフィクスチャ債務**であり、下記では
ライフサイクル債務と分けて報告する。「ベンチマークが壊れている」と
読んではならない。

### 2.3 決定論と検証

- 出力はキーがソートされた素の JSON オブジェクト —— 時計値も環境依存も
  ない。同一コーパスへの2回の実行はバイト一致する
  (`doc-lifecycle-analysis.test.ts` が保証)。
- `tests/fixtures/doc-lifecycle/stats-{small,benchmark,long-running}.json`
  がコミット済みベースライン。テストはライブ出力とバイト比較する。
- 意図的なコーパス/契約変更後の再生成:
  `mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx tests/fixtures/doc-lifecycle/write_stats.ts`

### 2.4 計測*しない*もの

この統計は **リポジトリ全体の doc-status 走査**(監査チャネル)を
消費する。delegate 取得(#124 の L1/L2/L3 チャネル)は計測せず、
両者の等価性も主張しない。`doc-status` の lint スコープは9つの
`docTypes` を対象とし、`impl` レコードと非管理文書は走査・バケット
されるが lint されない —— それらの `findings` 数は構造上 0 である。
以下の孤児率は *lint が報告するままの、ファイルあたりの doc-status
孤児ファインディング*である。

## 3. 実測結果

### 3.1 コーパス・レベル

| 指標 | small | benchmark | long-running |
| ---- | ----- | --------- | ------------ |
| 走査 Markdown | 17 | 78 | 116 |
| 文書数(非インデックス) | 7 | 68 | 106 |
| …canonical / 非管理 | 7 / 0 | 68 / 0 | 105 / 1 |
| インデックス | 10 | 10 | 10 |
| 本文バイト | 181 | 57,451 | 42,793 |
| settled / in-flight | 0 / 7 | 0 / 68 | 57 / 49 |
| stale-upstream 文書 | 0 | 0 | 3 |
| duplicate-id グループ | 0 | 0 | 0 |
| ファインディング(ブロッキング/警告/情報) | 21 (0/0/21) | 348 (86/239/23) | 34 (7/8/19) |

### 3.2 タイプ別 —— long-running コーパス

| タイプ | ファイル数 | settled | stale | 本文バイト | 最大ファイル | 孤児(rel/idx/nav) | ファインディング |
| ------ | ---------- | ------- | ----- | ---------- | ------------ | ----------------- | ---------------- |
| task | 23 | 17 (74%) | 2 | 1,106 | 48 | 0/0/0 | 0 |
| impl | 18 | 16 (89%) | 0 | 1,318 | 70 | 0/0/0 | 0* |
| spec | 11 | 7 (64%) | 0 | 1,117 | 102 | 1/0/0 | 4 |
| discovery | 10 | 6 (60%) | 0 | 39,809 | 39,018 | 3/3/3 | 14 |
| plan | 9 | 6 (67%) | 0 | 120 | 12 | 1/0/0 | 2 |
| design | 9 | 0 | 1 | 219 | 25 | 1/0/0 | 2 |
| adr | 8 | 1 (13%) | 0 | 377 | 62 | 0/0/0 | 0 |
| idea | 8 | 3 (38%) | 0 | 136 | 16 | 8/0/0 | 8 |
| test-spec | 7 | 1 (14%) | 0 | 118 | 17 | 0/0/0 | 0 |
| brainstorm | 2 | 0 | 0 | 36 | 18 | 2/0/0 | 2 |
| 非管理 | 1 | 0 | 0 | 57 | 57 | 0/0/0 | 0 |

\* impl レコードは走査されるが `doc-status` lint スコープ外(§2.4)。

ステータス分布(long-running): task `done` 15 / `todo` 4 /
`wont-do` 2 / `in-progress` 1 / `blocked` 1;plan `completed` 5 /
`approved` 1 / `in-progress` 1 / `blocked` 1 / `superseded` 1;
spec `implemented` 6 / `approved` 3 / `proposed` 1 / `superseded` 1;
impl `completed` 15 / `in-progress` 1 / `superseded` 1 /
`complete`(旧表記)1。

### 3.3 リレーションと参照 —— long-running

- 宣言リレーション値 120: `implements` 39、`derives-from` 41、
  `derived-by` 14、`verifies` 7、`verified-by` 7、`source` 9、
  `supersedes`/`superseded-by`/`test-spec-skip` 各1。系譜フィールド
  (`implements`+`derives-from`+`refines`)= 宣言の67%。
- 解決: 110 resolved、7 external(discovery の source URL)、
  3 unresolved(仕込んだ `DISC-9999`、死んだローカル `source`、
  `test-spec-skip` の理由文字列 —— §4.5 参照)。
- 106 アーティファクト中 63 が解決済み内向きリレーションを1つ以上
  受ける —— コーパスの40%がリレーション孤島であり、孤児
  ファインディングと一致する。
- Markdown リンク: 17 宣言(16 の解決済み `impl→task` リンク、
  1つの非管理の壊れたリンク)。**106 文書中 102 が内向きリンクを
  ほぼ生成済みインデックス表のみから受けている** —— このコーパス
  ではインデックスが実質的にナビゲーション層全体を担っている。

### 3.4 ルール別ファインディング —— long-running

| ルール | 件数 | 備考 |
| ------ | ---- | ---- |
| orphan-relation | 16 | idea 8 + brainstorm 2 + discovery 孤児 3 + 置換済み plan + 壊れた spec + design overview |
| orphan-index / orphan-navigation / index-missing-entry | 3 / 3 / 3 | 未収載の discovery 孤児3件 |
| index-stale-entry / index-metadata-mismatch | 1 / 1 | 削除済み spec 行、doc の status から遅れた task 行 |
| broken-relation-link | 2 | `SPEC-9201 → DISC-9999`、`PLAN-9301 test-spec-skip`(§4.5) |
| inconsistent-reciprocal-relation | 1 | `SPEC-0502` が `DISC-0501.derived-by` に逆リンクされていない —— 置換ドリフト |
| traceability-missing-upstream | 2 | `SPEC-0001`、`DESIGN-OVERVIEW` |
| provenance-missing-source / provenance-unresolved-local-source | 1 / 1 | 孤児 discovery |
| (インデックス) | — | 2 件のファインディングはインデックスファイル自体に付く |

ベンチマーク・コーパス(対比用 —— 契約以前のフィクスチャ債務):
348 ファインディング。`invalid-id-prefix` 38 + `invalid-status`
25 + `provenance-missing-source` 20 + `traceability-missing-upstream`
14 + インデックス/孤児カバレッジ(約200)が支配的 —— README
スタブが何も列挙しないため。

## 4. 実測された影響トップ5

### 4.1 キャプチャ層が孤児の貯水池

long-running コーパスのキャプチャ層文書(idea/brainstorm/discovery)
18件中13件が**双方向ともセマンティック・リレーションを持たない**
—— `orphan-relation` 全16件のうち81%がキャプチャ系。
キャプチャ文書は作成が安く、ほぼ再訪されず、ライフサイクルのどこにも
昇格もクローズもする仕組みがない。*これが最大の削減面: ファイルを
短くするのではなく、数を減らすこと。*

### 4.2 コーパスの大半は決着済みエビデンス

long-running 文書の54%が settled。task(74%)と Implementation
Record(89%)が最も早く決着し、決して削除されない(当然 ——
それらはエビデンスの痕跡)。ファイルあたりの本文量は微小(task
中央値 ~48B、impl ~70B)だが、**全ファイルの41%** を占める
小レコードの長い尾であり、インデックス表・監査・ナビゲーションが
永遠に運ばねばならない。削減は削除ではなく*ステータス認識の
サーフェス*から来なければならない。

### 4.3 本文量は discovery エビデンスに集中

long-running の本文バイトの93%、benchmark の98%が discovery である
(1件39KBのエビデンス文書)。discovery 文書は書きっぱなしの調査
ダンプ —— ファイルあたりバイトは大きく、解決後の参照トラフィックは
ほぼゼロ。自然的な「コールド・ストレージ」層: 要約前段+エビデンス
追記構造の候補であり、削除の対象ではない。

### 4.4 生成インデックスは荷重支持層 —— そしてドリフトする

106文書中102が**インデックスのリンク経由でのみ**到達可能(本文
レベルの相互リンクは稀 —— orphan-navigation が測るのはまさにそれ)。
ゆえにインデックス表*こそが*ナビゲーション契約であり、そのドリフト
(約100文書のコーパスで10インデックス中5件のファインディング:
stale-entry、metadata-mismatch、missing-entry)は文書を到達可能面
から静かに消す。`doc-status` はこれら全てを既に報告し、
`doc-maintenance` は既にインデックスを再生成する。欠けているのは
能力ではなく頻度である。

### 4.5 ライフサイクル債務エッジは小さいが実在し、現状不可視

3件の stale-upstream(完了 plan 上の todo task;置換済み spec 上の
承認済み design)、置換由来の相互リレーション破断1件、未解決
リレーション・ターゲット3件、出所欠落2件。個々は軽微 —— だが
**統計が暴露した観測が2つある**:

- `test-spec-skip: "<理由>"`(`plan-conventions` に記載の慣行)は
  現在リレーション・ターゲットとして解決され、
  `broken-relation-link` を報告する —— 理由文字列が壊れた参照と
  して数えられている。
- 置換する spec は `derived-by` の逆リンクを自動では生まず、誰にも
  直すよう指示されない `inconsistent-reciprocal-relation` ドリフトを
  残す。

どちらも今日の doc-status 専用ルールではカバーされず、
stale-upstream ヒューリスティックが本分析でそれらを表面化した。

## 5. 必須 vs 任意の分類

スキル別: *必須* = Graph/contract またはゲートが義務付ける
エビデンス;*新規ファイル* = 新しい文書を作る価値がある場合;
*更新* = 既存文書の更新で十分な場合;*省略* = 正当に省略できる場合。

| スキル | 必須エビデンス | 新規ファイルが報われる場合 | 更新で十分な場合 | 省略可能 |
| ------ | -------------- | -------------------------- | ---------------- | -------- |
| idea-doc | spec チェーンが idea アンカーを要する場合のフロー入力のみ | 昇格に値する真に別個の提案ごと | 同一 idea の絞り込み・精緻化、parking | ひらめきごとのキャプチャ —— 実測された孤児の貯水池 |
| discovery-doc / deep-dive | 文書自体に契約必須の source エビデンス;spec が調査系譜を要する場合 | エビデンスに値する調査問い1件ごと | 同一調査の継続 | 見れば分かる問い;既存の resolved discovery と重複するもの |
| spec | フィーチャー作業に必須(受入ゲート) | 別個の機能/振る舞い契約ごと | 同一機能範囲内の改訂 | 外見的編集での supersede は不可、原地更新 |
| adr | アーキテクチャ決定ごとに必須 | 決定ごと(ADR は時点記録) | 明確化のみ | 決定済み ADR を新決定のため原地更新しない —— supersede する |
| design-doc | 設計権威が必要な場合 plan 前に必須 | システム/機能ベースラインごと | 承認済み同一ベースラインの反復 | 上流が置換済みのまま向き先を変えずに再ベースライン化(実測ドリフト) |
| plan-doc | implementation フローに必須(承認ゲート) | 作業パッケージごと | パッケージ内の状態/進捗/task | パッケージ内の範囲変更での新規 plan |
| task | plan 配下の作業項目ごとに必須(実行契約) | 委譲可能な作業項目ごと | 原地でのステータス遷移 | ~1ステップのマイクロタスク —— plan のタスク表に畳む |
| test-spec | plan 承認に必須(`verified-by`)—— `test-spec-skip` 理由記録を除く | 検証面ごと | 同一検証面のケース追加/調整 | verified-by はゲート —— skip 理由が唯一の免除 |
| impl-doc(IR/exp) | IR は実装タスクごとに必須;exp は任意 | IR はタスクごと;exp は記録に値する実験ごと | タスク存続中の IR | IR 省略は不可;exp は任意 |
| doc-status レポート | 文書アーティファクトなし —— 読み取り専用 | n/a | n/a | n/a |
| briefing-flow / implementation-flow | 実行ごとのフロー固有プロファイル/文書群 | フロー・インスタンスごと | n/a | n/a |

横断的な観測が2つある:

- 「必須」は文書タイプにグローバルではなく**フロー状態に付着**
  する: 完了 plan の test-spec は承認時に必須だったが、その後は
  永遠にエビデンスである。
- 実測コーパスが示す失敗様式は*キャプチャ層での過剰生成と下流での
  未クローズ*であり、必須アーティファクトの多さではない。実測集合で
  冗長な必須エビデンス文書は1件もない。

## 6. 削減機会と推奨

### バケットA —— スキル指示のみの変更(Graph/contract 変更なし)

| # | 推奨 | 実測根拠 | 工数 |
| - | ---- | -------- | ---- |
| A1 | idea/discovery 指示: 既存キャプチャの更新で十分な場合と新規ファイルが正当な場合を明示;作成時に `relations.source` を要求 | §4.1、§4.5 | 小 |
| A2 | supersede 時に in-flight な依存先の向き先変更またはクローズ(実測された stale-upstream パターン)と相互バックリンク出力を指示で要求 | §4.5 | 小 |
| A3 | task ガイダンス: task ファイルが報われる最小作業項目サイズ(マイクロ項目は plan の表に畳む) | §4.2 ファイルの尾 | 小 |

### バケットB —— インデックス/検索/ナビゲーション改善(第二権威なし)

| # | 推奨 | 実測根拠 | 工数 |
| - | ---- | -------- | ---- |
| B1 | ステータス認識インデックス・ビュー: settled 文書が見えるが強調されないよう生成インデックス表を分割または注記(active-first 順または settled セクション) | §4.2 | 中 |
| B2 | インデックス再生成を定周期化(doc-maintenance が再生成を、doc-status がドリフト報告を既に所有)—— 手動実行頼みでなくクローズアウト経路に配線 | §4.4 | 小 |
| B3 | キャプチャ層の経過/被リンク度を `doc_status` 出力利用側で表面化(孤児ファインディングは既存;欠けているのは可視性) | §4.1 | 小 |

### バケットC —— マイグレーションを要する構造変更(各々=個別 issue)

| # | 推奨 | 実測根拠 | マイグレーション懸念 |
| - | ---- | -------- | -------------------- |
| C1 | settled/歴史用インデックス層、またはインデックス/ナビゲーションが消費する `archive:` front-matter フラグの検討(ステータス権威は不変 —— 表示軸) | §4.2 | status からのフラグ導出バックフィル;インデックス形式変更は doc-maintenance マイグレーション;フラグ除去で可逆 |
| C2 | discovery エビデンス構造: 巨大エビデンス・ダンプを要約 front-matter 節+追記専用エビデンス尾部に分割し、証跡量に関わらず L1 メタデータを小さく保つ | §4.3 | 本文形式の慣行変更;既存ファイルは経過措置;テンプレート+慣行文書が移行 |
| C3 | リレーション解決に `test-spec-skip` がターゲットではなく理由文字列であることを教える(または `relations:` の外へ —— いずれにせよ契約可視) | §4.5 | スキーマ可視の変更: 契約レビュー+マイグレーション注記が必要;影響範囲は小 |

### 推奨するフォローアップ issue(実装単位ごとに1件)

1. スキル指示改訂: 更新 vs 新規 + source 必須ガイダンス(A1–A3)
   —— 1 issue。
2. ステータス認識インデックス/ナビゲーション・ビュー + クローズ
   アウト時インデックス再生成(B1–B3)—— 1 issue。
3. settled 層表示フラグ(`archive:` 軸)(C1)—— 1 issue。
4. discovery エビデンス前段/尾部構造(C2)—— 1 issue。
5. `test-spec-skip` 解決意味論(C3)—— 1 issue。
6. 実リポジトリで信号が安定することが証明されれば stale-upstream
   ヒューリスティックを `doc-status` lint ルールへ昇格 —— 1 issue。

## 7. 明示的な不作為

本分析は以下を提案**せず**、実装も導入してはならない:

- 文書の一括削除;
- 必須エビデンスを隠す自動アーカイブ;
- リレーション、リンク、安定 ID を壊すコンパクション;
- 文書の強制マージ(task を plan へ、impl を task へ畳む等);
- Graph ステータス権威や必須エビデンス・ゲートの変更;
- 現行アーティファクトの代わりに必須エビデンスを Git 履歴へ隠すこと;
- 第2のアーティファクト権威や永続ベクトル・インデックス;
- #87–#94 の診断/修復の再実装(本分析では再利用している)。

## 8. 再現方法

```text
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx tests/fixtures/doc-lifecycle/write_stats.ts
mise exec -- pnpm --dir scripts/doc-driven-dev exec tsx --test tests/doc-lifecycle-analysis.test.ts
```

入力: `scripts/doc-driven-dev/tests/fixtures/doc-lifecycle/corpora.ts`
(コーパス構築)、`scripts/doc-driven-dev/src/skills/lib/lifecycle_stats.ts`
(計測)、`scripts/doc-driven-dev/tests/doc-lifecycle-analysis.test.ts`
(形状/決定論/境界値ガード)、`tests/fixtures/doc-lifecycle/stats-*.json`
(コミット済みベースライン —— §3 の数値はこれらのファイル由来)。
