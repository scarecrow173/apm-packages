---
name: implementation-flow
description: "利用可能スキルを発見・ルーティングしてコード実装をオーケストレーション。使用タイミング: task-docエントリの実行時、実装作業の開始時、複数スキルの連携時。.sdp/implementation-flow-default/implementation-flow-profile.jsonを生成。キーワード: implementation, task-doc, skill stack, code changes。"
license: MIT
---

# Implementation Flow

<SUBAGENT-STOP>
特定のタスクを実行するためにサブエージェントとしてディスパッチされた場合、
このメタスキルをスキップし、ディスパッチ指示に従うこと。
</SUBAGENT-STOP>

active profile が現在の環境で applicable と示したスキルを動的に発見・
ルーティングしてコード実装をオーケストレーションする。これは**実装フェーズの
オーケストレーター**であり、どのスキルが適用されるかを判断し、タスクごとに
スキルスタックを構成し、検証を経てから次に進む。

これは**メタスキル**であり、コードを直接生成しない。代わりにスキルの発見、
構成、順序付け、そして実装を上流文書に接続する検証ループを管理する。

Document Registry 3 では `task` は execution-bound（`persistence: ephemeral`）
で、以下の `task-doc` の作成手順は durable な Git 文書ではなく Execution
Store のレコードを指します。`impl-doc` の Implementation Record と
Experiment Log はレガシーの migration-only 種別で、`new_impl_record.js` /
`new_experiment_log.js` writer は配布されていません（Issue #249 で削除）。
それらに言及する
フェーズは、マイグレーションが読み取る v3 以前の証跡契約を記述します。
durable な検証証跡は `verification-doc` が `docs/verification` に記録し、
durable な知見は `knowledge-doc` で条件付きに統合します。

## 利用タイミング

- 承認済み `task-doc` エントリのコード変更を実行するとき。
- 複数のスキルを協調させて計画を実装するとき。
- `doc-driven-dev-graph` から implementation delegate として呼び出されるとき。
- ドキュメントが既に存在し、実装ガイダンスだけが必要なとき（スタンドアロン利用）。
- profile-based routing や複数 skill の連携が必要な実装作業を始めるとき。

## ルール

**コードを書く前に、下記の評価フェーズと構成フェーズを完了すること。**
まず profile-based assessment と configuration を完了する。profile-selected
skill は default routing policy として適用するが、explicit user override を
許可し、dispatch-specific override・emergency override・その他の non-default
routing decision には 1 行の理由を記録する。

---

## フローフェーズ

```text
Phase A: 評価  →  Phase B: 構成  →  Phase C0: Implementation Documentation（条件付き）  →  Phase C: 実行  →  Phase D: 検証  →  Phase E: レビュー
```

| フェーズ | 目的 | 出力 |
| -------- | ---- | ---- |
| A. 評価 | タスクを理解し、`.sdp/implementation-flow-default/implementation-flow-profile.json` を確認 | タスク特性の特定 |
| B. 構成 | スキルを発見し、タスク用のスキルスタックを構築/読込 | アクティブスキルスタックの宣言 |
| C0. Implementation Documentation | 条件付きドキュメント経路 — Registry 3 では変更前記録の強制なし | ドキュメント決定の記録 |
| C. 実行 | 優先度順にスキルを適用 | コード変更の実装 |
| D. 検証 | タスクが検証条件を通過することを確認 | 正しさのエビデンス |
| E. レビュー | レビューに提出し、フィードバックに対応 | レビュー完了 |

---

## Phase A: 評価

各タスク単位について:

1. **タスクを読む** — 要件、制約、検証条件を理解する。task が `relations.verified-by` で test spec をリンクしている場合はそれも読む。実装が維持すべき保証が記録されている。
2. **タスクを分類する** — 特性を特定する:
   - バグ修正またはテスト失敗か？
   - フレームワークやライブラリが関係するか？
   - 複数ファイルやシステムにまたがるか？
   - 非自明なアーキテクチャ判断があるか？
   - サブタスクを並列実行可能か？
   - サブタスクを、独立したコンテキストを持つ新規サブエージェントへ委譲できるか？
   - タスクが単純・機械的・低リスクで、現在のハーネスが提供する低コスト実行経路に載せても必要ツールを使えるか？
   - どの言語/プラットフォームが関係するか？
   - アプローチが不確実または探索的か — 比較すべき複数の有効な解があるか？

**タスク特性 → スキル活性化マッピング:**

| タスクが... | 活性化するスキル | カテゴリ |
| ------------ | ------------------ | -------- |
| バグ修正またはテスト失敗 | デバッグ/診断スキル | Process |
| フレームワーク/ライブラリ API を含む | 公式ドキュメント検証スキル | Verify |
| 複数の代替アプローチがある | 対抗的レビュースキル | Verify |
| 複数ファイルにまたがる | インクリメンタル実装スキル | Build |
| 独立したサブタスクに分割可能 | 並列ディスパッチスキル | Build |
| 隔離コンテキストへ委譲可能 | サブエージェント dispatch スキル | Build |
| 単純・機械的・低リスクの作業 | コスト最適化 guidance スキル | Tooling |
| 特定の言語/プラットフォームを含む | 言語固有の規約 | Domain |
| git 操作や CI が必要 | ツール固有のワークフロースキル | Tooling |
| 完了準備が整った | コードレビュースキル | Review |

このマッピングは一般的なフレームワーク。`.sdp/implementation-flow-default/implementation-flow-profile.json` の invocation resolution は
このマッピングのリポジトリ固有インスタンス化であり、具体的なスキル名と条件を指定する。

**プロファイル確認:** リポジトリの `.sdp` ディレクトリ配下にある `.sdp/implementation-flow-default/implementation-flow-profile.json` を確認する。

> **`.sdp/implementation-flow-default/implementation-flow-profile.json` とは？**
> リポジトリ固有の構成ファイル。利用可能な全スキルをリストし、
> カテゴリに割り当て、always-on か conditional かを定義し、
> フロースタックと invocation resolution を指定する。
> このフローの adapter ファイルを使って `skill-discovery-protocol`
> スキルが生成・更新し、スキル変更時にも同じ経路で再生成する。

- 存在し有効な場合 → Phase B（プロファイルからの構成）へ。
- 存在しない場合 → `skill-discovery-protocol` スキルを呼び出し、adapter path `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml` を渡す。
- 存在するが破損、古くなっている、または必要な inference フィールドが欠けている場合 → 同じ adapter path を渡して `skill-discovery-protocol` を再度呼び出し、再生成する。

---

## スキル発見プロトコル

プロファイルの生成と検証は `skill-discovery-protocol` スキルが担当する。

このフローから呼び出すときは、次を渡す:

- Adapter path: `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
- Expected profile path: `.sdp/implementation-flow-default/implementation-flow-profile.json`
- Expected inference artifact: `.sdp/skill-reference-inferences.json`

スキルが成果物を生成または更新した後、scan list と照合して
`.sdp/skill-reference-inferences.json` を確認する。タスクルーティングに必要な
`provides` または `uses` が不足している場合は、同じ adapter path を渡して
`skill-discovery-protocol` を再度呼び出し、inference 更新を依頼してから
プロファイルを使う。

詳細は [skill-discovery-protocol](../skill-discovery-protocol/SKILL.ja.md) を参照。

リポジトリ固有の profile skeleton を更新・比較したいときは、
[`assets/templates/implementation-profile-template.ja.md`](assets/templates/implementation-profile-template.ja.md)
を読みます。通常の実行では読みません。

**段階的ロード:** まず profile を解決し、次に profile が applicable と示した
skill の `SKILL.md` 本文だけを読み、references と scripts は active step が
必要とするときだけ読む —
[progressive-loading-contract](../skill-discovery-protocol/references/progressive-loading-contract.ja.md) を参照。

---

## Phase B: 構成

`.sdp/implementation-flow-default/implementation-flow-profile.json` が利用可能な状態で:

1. **フロースタックを読込**: `skill-discovery-protocol` を使って `.sdp/implementation-flow-default/implementation-flow-profile.json` から `flow-stack` を読む
2. **解決を確認**: `skill-discovery-protocol` を使って `.sdp/implementation-flow-default/implementation-flow-profile.json` から `resolution` を読む
3. **実行ポリシーを確認**: `skill-discovery-protocol` を使って `.sdp/implementation-flow-default/implementation-flow-profile.json` から各候補スキルの `execution-policy` を読む
4. **Runtime guidance を確認**: `skill-discovery-protocol` を使って `.sdp/implementation-flow-default/implementation-flow-profile.json` から各候補スキルの `runtime_guidance` を読む
5. **能力スロットを評価**:
   - `subagent_utilization`: 独立したサブタスクを、明確な受け入れ条件付きで隔離コンテキストへ委譲できる場合に活性化する。
   - `cost_optimization`: タスクが単純・機械的・低リスクで、低コストモデルまたは低コスト委譲経路でも必要ツールを使える場合に活性化する。
   - どちらも routing guidance として扱う。ユーザー指示、hard gate、必須ツール、検証エビデンスを上書きしない。
6. **競合を解決** 同じカテゴリで複数スキルが活性化された場合:
   - より具体的な条件が優先（例: 「TypeScriptファイル」 > 「任意のファイル」）。
   - 明示的なプロファイルルールが推論された活性化より優先。
   - それでも同等なら両方適用（スキルはレイヤー、排他しない）。
7. **Domain/Tooling スキルを追加** — タスクで検出された言語、フレームワーク、プラットフォームに基づく。
   - **resolution override に一致するものがない場合:** フロースタックのデフォルトのみで進行。「追加スキル: なし」と宣言する。
   - **`GraphRoute.commitGate` が true の場合:** commit-capable な Tooling skill
     （例: `git-commit`）が active stack で必須。選択を announced stack に記録する。
8. **アクティブスキルスタックを宣言:**

```text
このタスクのアクティブスキルスタック:
1. [カテゴリ] スキル名 — 理由
2. [カテゴリ] スキル名 — 理由
3. [カテゴリ] スキル名 — 理由
→ この構成で進めます。
```

**実行の優先順位:**

| 優先度 | カテゴリ | 理由 |
| ------ | -------- | ---- |
| 1 | Process | 構築前に診断/計画が必要 |
| 2 | Build | 実装作業を構造化する |
| 3 | Domain | 言語/フレームワーク制約がビルド中に適用される |
| 4 | Verify | 権威ある情報源に対して検証する |
| 5 | Tooling | ツール固有のステップがワークフローに統合される |
| 6 | Review | 実装後の品質ゲート |

**カテゴリ例:**

- **Process**: `debugging-and-error-recovery`, `planning-and-task-breakdown`
- **Build**: `test-driven-development`, `incremental-implementation`
- **Domain**: `typescript-conventions`, `react-patterns`
- **Verify**: `source-driven-development`, `api-and-interface-design`
- **Tooling**: `git-commit`, `ci-cd-automation`
- **Review**: `requesting-code-review`, `code-review-and-quality`

詳細なカテゴリ定義はアダプターの `classification.taxonomy`（`assets/adapters/implementation-adapter.yaml`）を参照。

---

## Phase C0: Implementation Documentation（条件付き）

Registry 3 では常時生成契約が廃止されました: **コード変更前に
Implementation Record や Experiment Log は開きません** ——
`new_impl_record.js` / `new_experiment_log.js` writer は配布されて
おらず、通常の実装修正は IR も EXP も強制されるナレッジドキュメントもなく
完了します。

1. 既定ではドキュメントステップを実行しません —— 実行メモは durable な
   Git 文書ではなく、ランの Execution Store レコードと診断トレースに
   残ります。
2. task が durable な知見（設計・修正の根拠、再発防止、確定した制約、
   調査で確定した性質）を生んだ場合、クローズアウト前に
   `knowledge-doc` で統合します —— assess→決定→適用の契約は後述の
   **実装ドキュメント** セクション; `none` 決定も有効な結果です。
3. 未整理のまま残った重要な知見 —— 未レビューの競合や、特定したのに
   永続化しなかったナレッジ —— は静かに捨てず、ランの終了ゲートへ
   報告します。

このフェーズがかつて記述していた v3 以前の証跡契約（task ごとに
in-progress の ir を1件、最初のコード変更前に開く）は、`impl-doc` が
文書化する migration 可読な corpus の形です。通常実行への作成指示では
ありません。

---

## Phase C: 実行

### Graph handoff contract

`doc-driven-dev-graph` から Task Graph が委譲された場合、受け取った projection を
権威ある handoff として扱う:

- `taskGraph.issues` が空でない場合は、常に dispatch せず fail closed にする。
- `GraphRoute.condition` が `tasks-active` の場合は、厳密に
  `taskGraph.resumableActive` だけを使用する。空なら fail closed にし、この
  リストにない `active` task を開始または再開しない。
- `GraphRoute.condition` が `tasks-runnable` の場合は、未解決の active task が
  存在しても `taskGraph.runnable` を使用し、その active task の ID と status を
  変更しない。
- task の安定した ID と status を維持し、eligible にするために書き換えない。
- `taskGraph.edges` の dependency edge を使って依存する作業の順序を決め、その
  edge 上で独立している作業だけを並列化する。

**並列 delegation**: dependency の独立性は並列 dispatch の必要条件であって
十分条件ではない。各 slice の Execution Store task レコードの `scope`
フィールドが検証可能な形で分離している場合にだけ並列化する — eligibility、
isolation、merge verification、fallback の規則は
[references/parallel-delegation-contract.ja.md](references/parallel-delegation-contract.ja.md)
を参照。serial 実行は常に default fallback であり、scope を推測しない。
slice 自身の task レコードとランの Execution Store に記録する宣言済み
evidence は scope 宣言を要しない; 他の task のレコードは一切書き込めない。

アクティブスタック内の各スキルを優先度に従って適用する:

1. 各スキル固有のプロセスに従う（そのスキルの SKILL.md を読む）。
2. プロファイルからスキルの**実行モード**を確認する:
   - **Rigid スキル**: 正確に従う; ステップを飛ばしたり順序を変えない。
     例: `git-commit`（Conventional Commit 形式は必ず守る）
   - **Flexible スキル**: 精神を適用; 文脈に合わせる。
   例: `code-review-and-quality`（レビュー深度をタスクごとに優先度調整可）

   生成済みプロファイルを `skill-discovery-protocol` で参照し、対象スキルの `execution-policy` と `runtime_guidance` を確認する。
3. スキルはレイヤーとして重なる — 排他的ではない。複数スキルが同時に適用される。
4. 実行中のメモはランの Execution Store レコードに残り、durable 文書として
   記録しません。durable な知見が生まれたときだけ、後述の統合経路で
   `knowledge-doc` に渡します。

---

## Phase D: 検証

タスクは検証を通過するまで完了ではない:

1. タスクが定義された検証条件を通過することを確認する。
2. Hard Gate #1（EVIDENCE要件）を満たすエビデンスを記録してから次へ進む。
3. エビデンスをランの Execution Store トレースに記録し、durable な知見が
   あれば `knowledge-doc` の統合でクローズアウトする（後述の
   **実装ドキュメント** セクションを参照）。
4. 検証失敗 → Process カテゴリスキルで診断し、修正し、再検証する。

---

## Phase E: レビュー

**レビューゲート契約**: canonical review skill 拘束について [references/review-gate-contract.ja.md](references/review-gate-contract.ja.md) 参照。

1. Canonical review skill `requesting-code-review` を用いて実装をレビューに提出する(契約参照)。
2. フィードバックに体系的に対応する。
3. レビュー中に発見された新制約を記録する。

---

## 実装ドキュメント

Registry 3 では実装フェーズはダウンストリーム文書の生成を要求しません。
IR/EXP の作成はフローの一部ではなくなりました —— v3 以前の `docs/impl/`
corpus は migration の入力にすぎません（`impl-doc` 参照）。ランが産んだ
ものは Execution Store の診断トレースであり、通常の修正は新規 durable
文書ゼロで完了します。

durable な知見は `knowledge-doc` で条件付きに抽出します ——
ナレッジを代替 impl-log としては使いません。統合するのはランが永続的な
知識を産んだ場合のみです: 設計・修正の根拠、再発防止、確定した制約、
調査で確定した性質。時系列、コマンドログ、チャット的作業記録は絶対に
抽出しません。

知見が条件を満たす場合:

```bash
node ../knowledge-doc/scripts/consolidate_knowledge.js assess --title "<finding>" --kind codebase
```

1. `assess` が既存ナレッジと Spec/Design/ADR を走査し、候補と競合を
   報告します（相対 script path はインストール済み skill directory
   基準です）。
2. ちょうど1つの決定を適用します —— 既存ナレッジドキュメントへの
   `integrate`（優先）、所有スキルへの `route`、明示的な競合承認後の
   `create`、または `none`。
3. すべての永続化経路は抽出元（`--from`）と根拠（`--basis`）を記録し、
   未検証の推測は `confirmed` ではなく `draft` のままです。

未整理の重要な知見 —— 特定したのに永続化しなかったナレッジ、未レビューの
競合 —— は静かに捨てず、ランの終了ゲートへ報告します。

完全な決定契約は [`knowledge-doc` SKILL](../knowledge-doc/SKILL.ja.md) と
その[抽出契約](../knowledge-doc/references/knowledge-extraction.ja.md)
を、migration ツーリングが読む
legacy corpus 契約は [`impl-doc` SKILL](../impl-doc/SKILL.ja.md) を参照。

---

## Hard Gates

以下は**全フェーズを通じて常時有効な不変条件**である。
違反を検出した時点で即座に STOP し、対処すること。

<HARD-GATE>
検証にはエビデンスが必要。「確信」ではなく証拠。許容される証拠:
- テストスイート合格（コマンド + 出力を示す）
- ビルド完了（コマンド + 終了コードを示す）
- ランタイム動作確認（データ/スクリーンショット/ログを示す）
「動く」だけでは検証にならない。
エビデンスを記録するまで次タスクに進んではならない。
</HARD-GATE>

<HARD-GATE>
実装中に spec や design の誤りまたは不足が判明した場合、
実装を中断し適切な上流文書へフィードバックしてから継続すること。
ループバックは理由を 1 行記録する。
</HARD-GATE>

<HARD-GATE>
実装作業が skill routing に依存する場合、プロファイルベースの構成をスキップしてはならない。
- プロファイルが存在しない場合 → `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml` を渡して `skill-discovery-protocol` を呼び出す。
- プロファイルが存在する場合 → 読み込んでその構成に従う。
「これは簡単だからスキップしてよい」「やり方はわかっている」が最も多い
失敗パターン。体系的なスキルルーティングの目的を損なう。
</HARD-GATE>

<HARD-GATE>
このフローがドキュメントを強制することはありません —— ただし統合の
決定は沈黙ではなく明示的に行います。
- Implementation Record や Experiment Log は開きません; `impl`/`exp` の
  mutator は配布されておらず、registry は両方を migration-only 型として
  扱います。
- durable な知見がある場合、クローズアウト前に
  `node ../knowledge-doc/scripts/consolidate_knowledge.js assess` を実行し、
  ちょうど1つの決定を適用します; `none` が有効なのは条件を満たすものが
  ない場合のみです。
- 未整理のまま残った重要な知見（未レビューの競合、特定したのに永続化
  しなかったナレッジ）は終了ゲートへ報告します。
</HARD-GATE>

<HARD-GATE>
profile-selected skill は default routing policy として扱う。アクティブ
スキルスタックにスキルが含まれている場合、そのスキルのプロセスに従う。
ただし user が routing decision を明示的に override した場合はその指示を優先する。
dispatch-specific override・emergency override・その他の non-default routing には
1 行の理由を記録する。
</HARD-GATE>

<HARD-GATE>
dispatch した `GraphRoute` が `commitGate` を宣言している場合、logical change が
uncommitted のままでは task slice を `completed` にできません。resolve された
commit tooling（profile が `git-commit` を選択した場合はそれ、それ以外は
repository の commit convention）で commit します。commit が granted authority の
範囲外なら `completed` ではなく `yield`/`commit-required` を返します。
</HARD-GATE>

---

## アンチパターン

これらの思考や行動は失敗を示す — 気づいたら STOP:

| アンチパターン | なぜ失敗するか |
| ---------------- | -------------- |
| 「単純すぎてスキル構成は不要」 | 構成は予期しないミスを防ぐ |
| 「やり方は既に知っている」 | プロファイルは見落としを防ぐ |
| 「始めてから構成しよう」 | 構成は実行の前。常に |
| 「このスキルはここでは当てはまらない」 | プロファイルが適用と言うなら default として扱い、override するなら記録する |
| 「ついでに隣のコードを整理しよう」 | タスク境界内に留まる。別タスクを起票 |
| 「検証は自明」 | エビデンスを示す: テスト合格、ビルド出力、ランタイムデータ |
| 「小さな変更にレビューは不要」 | 全タスクに Review カテゴリスキル。例外なし |
| 「全部まとめてやろう」 | インクリメンタル実行。1 スライスずつ |
| ビッグバン実装 | 一度に多数ファイル変更 → 検証不能。各スライスは独立で検証可能であるべき |
| 仮定駆動コーディング | 記憶から実装 → 上流文書に対して検証すべき |
| 黙っての再解釈 | 不一致をフィードバックせずに異なるものを実装 |
| オーバーエンジニアリング | タスクが要求していないものを構築 |
| ループバック信号の無視 | spec/design のギャップが明らかな時に継続 |
| エビデンスなしの自信 | テスト合格や検証済みデータなしに「動く」 |
| 「task scope がなくてもよい」 | 未宣言の write scope は serial を強制 — parallel scope を推測しない |

---

## エントリ条件

- 検証条件が定義されたタスク単位（`task-doc` または同等）が存在すること。
- `doc-driven-dev-graph` から呼び出される場合、planning node が完了し、タスクが承認済みであること。

## 完了条件

- 全タスク単位が実装済みである。
- 各タスクが定義された検証条件を通過している。
- 実装中に発見された新制約が上流文書に反映されている。
- Review カテゴリスキルが適用されている（コードレビュー完了）。
- 実装知見の統合決定が明示的である: durable なナレッジは記録済みの
  抽出元と根拠付きで統合/作成されるか、所有ドキュメントスキルへ
  振られるか、意識的に `none` とされる; 未整理の重要な知見は終了
  ゲートへ報告される。
- `impl`/`exp` ドキュメントは作成されない —— Registry 3 では legacy
  migration-only 形式である。
- クローズアウトで所属ディレクトリ索引を同一変更内に再生成した
  （`doc_maintenance.js index plan|apply`）: settled 行は
  `## Settled` 層へ移動し、再生成までは `doc_status lint` が古い索引を
  報告する。

## ループバックルール

- タスクが spec の不足を明らかにした場合 → spec/design 担当にフィードバック; そのタスクを一時停止。
- タスクスコープ内で解決できないテスト失敗 → Process カテゴリスキルを呼び出す。
- 複数の独立タスクがブロックされた場合 → 並列実行スキルを検討。
- 実装が ADR 制約と矛盾した場合 → ADR を更新するかアプローチを変更。
- ループバック時は理由を 1 行記録する。

---

## 指示の優先順位

1. **ユーザーの明示的な指示**（AGENTS.md、直接の要求）— 最優先。
2. **このスキルおよび呼び出されたワークフロースキル** — デフォルト動作を上書き。
3. **デフォルトシステムプロンプト** — 最低優先。

ユーザーが「このタスクは構成をスキップ」と言えば、ユーザーに従い、その override を記録する。
ユーザーが主導権を持つ。ただし上書き指示がない場合、profile-selected routing を default として使う。

## Graph Effect Outcome

`doc-driven-dev-graph` からこの skill が呼び出された場合、audit または delegate effect
ごとに正確な [`EffectOutcome footer`](../doc-driven-dev-graph/references/execution-outcome-contract.ja.md)
を返します。local partial variant を作成しません。

`completed` は logical change が commit 済みで統合決定が明示的（永続化、
route、または `none`）な verified task slice にのみ使い、declared
spec/design/constraint repair には `retry`、slice が granted authority 内で
commit できない変更を生んだ場合は `commit-required` を理由とする `yield`、
permission のない irreversible effect には `authority-required` を理由とする
`yield`、declared safe repair がない場合は `unrecoverable-blocker` を理由とする
`yield` を使います。必須の `edgeId`、stage、effect identity、authoritative input
scope、proof field はその footer が定義します。
