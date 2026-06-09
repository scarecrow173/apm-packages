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

環境内の**全ての利用可能スキル**を動的に発見・ルーティングしてコード実装を
オーケストレーションする。これは**実装フェーズのオーケストレーター**であり、
どのスキルが適用されるかを判断し、タスクごとにスキルスタックを構成し、
検証を経てから次に進む。

これは**メタスキル**であり、コードを直接生成しない。代わりにスキルの発見、
構成、順序付け、そして実装を上流文書に接続する検証ループを管理する。

## 利用タイミング

- 承認済み `task-doc` エントリのコード変更を実行するとき。
- 複数のスキルを協調させて計画を実装するとき。
- `doc-driven-dev-flow` から実装フェーズの委譲先として呼び出されるとき。
- ドキュメントが既に存在し、実装ガイダンスだけが必要なとき（スタンドアロン利用）。
- 実装作業を開始するとき — 構成のためにまずこのスキルを呼ぶ。

## ルール

**コードを書く前に、下記の評価フェーズと構成フェーズを完了すること。**
利用可能なスキルが適用される場合、必ず使うこと。これは任意ではない。
合理化してスキップすることは許されない。

---

## フローフェーズ

```text
Phase A: 評価  →  Phase B: 構成  →  Phase C: 実行  →  Phase D: 検証  →  Phase E: レビュー
```

| フェーズ | 目的 | 出力 |
| -------- | ---- | ---- |
| A. 評価 | タスクを理解し、`.sdp/implementation-flow-default/implementation-flow-profile.json` を確認 | タスク特性の特定 |
| B. 構成 | スキルを発見し、タスク用のスキルスタックを構築/読込 | アクティブスキルスタックの宣言 |
| C. 実行 | 優先度順にスキルを適用 | コード変更の実装 |
| D. 検証 | タスクが検証条件を通過することを確認 | 正しさのエビデンス |
| E. レビュー | レビューに提出し、フィードバックに対応 | レビュー完了 |

---

## Phase A: 評価

各タスク単位について:

1. **タスクを読む** — 要件、制約、検証条件を理解する。
2. **タスクを分類する** — 特性を特定する:
   - バグ修正またはテスト失敗か？
   - フレームワークやライブラリが関係するか？
   - 複数ファイルやシステムにまたがるか？
   - 非自明なアーキテクチャ判断があるか？
   - サブタスクを並列実行可能か？
   - どの言語/プラットフォームが関係するか？

**タスク特性 → スキル活性化マッピング:**

| タスクが... | 活性化するスキル | カテゴリ |
| ------------ | ------------------ | -------- |
| バグ修正またはテスト失敗 | デバッグ/診断スキル | Process |
| フレームワーク/ライブラリ API を含む | 公式ドキュメント検証スキル | Verify |
| 複数の代替アプローチがある | 対抗的レビュースキル | Verify |
| 複数ファイルにまたがる | インクリメンタル実装スキル | Build |
| 独立したサブタスクに分割可能 | 並列ディスパッチスキル | Build |
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

---

## Phase B: 構成

`.sdp/implementation-flow-default/implementation-flow-profile.json` が利用可能な状態で:

1. **フロースタックを読込**: `skill-discovery-protocol` を使って `.sdp/implementation-flow-default/implementation-flow-profile.json` から `flow-stack` を読む
2. **解決を確認**: `skill-discovery-protocol` を使って `.sdp/implementation-flow-default/implementation-flow-profile.json` から `resolution` を読む
3. **実行ポリシーを確認**: `skill-discovery-protocol` を使って `.sdp/implementation-flow-default/implementation-flow-profile.json` から各候補スキルの `execution-policy` を読む
4. **Runtime guidance を確認**: `skill-discovery-protocol` を使って `.sdp/implementation-flow-default/implementation-flow-profile.json` から各候補スキルの `runtime_guidance` を読む
5. **競合を解決** — 同じカテゴリで複数スキルが活性化された場合:
   - より具体的な条件が優先（例: 「TypeScriptファイル」 > 「任意のファイル」）。
   - 明示的なプロファイルルールが推論された活性化より優先。
   - それでも同等なら両方適用（スキルはレイヤー、排他しない）。
6. **Domain/Tooling スキルを追加** — タスクで検出された言語、フレームワーク、プラットフォームに基づく。
   - **resolution override に一致するものがない場合:** フロースタックのデフォルトのみで進行。「追加スキル: なし」と宣言する。
7. **アクティブスキルスタックを宣言:**

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
- **Build**: `incremental-implementation`, `dispatching-parallel-agents`
- **Domain**: `typescript-conventions`, `react-patterns`
- **Verify**: `source-driven-development`, `doubt-driven-development`
- **Tooling**: `git-commit`, `ci-cd-automation`
- **Review**: `requesting-code-review`, `receiving-code-review`

詳細なカテゴリ定義はアダプターの `classification.taxonomy`（`assets/adapters/implementation-adapter.yaml`）を参照。

---

## Phase C: 実行

アクティブスタック内の各スキルを優先度に従って適用する:

1. 各スキル固有のプロセスに従う（そのスキルの SKILL.md を読む）。
2. プロファイルからスキルの**実行モード**を確認する:
   - **Rigid スキル**: 正確に従う; ステップを飛ばしたり順序を変えない。
     例: `git-commit`（Conventional Commit 形式は必ず守る）
   - **Flexible スキル**: 精神を適用; 文脈に合わせる。
   例: `requesting-code-review`（レビュー観点をタスクごとに優先度調整可）

   生成済みプロファイルを `skill-discovery-protocol` で参照し、対象スキルの `execution-policy` と `runtime_guidance` を確認する。
3. スキルはレイヤーとして重なる — 排他的ではない。複数スキルが同時に適用される。

---

## Phase D: 検証

タスクは検証を通過するまで完了ではない:

1. タスクが定義された検証条件を通過することを確認する。
2. Hard Gate #1（EVIDENCE要件）を満たすエビデンスを記録してから次へ進む。
3. 検証失敗 → Process カテゴリスキルで診断し、修正し、再検証する。

---

## Phase E: レビュー

1. 実装をレビューに提出する（Review カテゴリスキルが利用可能な場合）。
2. フィードバックに体系的に対応する。
3. レビュー中に発見された新制約を記録する。

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
プロファイルベースの構成をスキップしてはならない。
- プロファイルが存在しない場合 → `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml` を渡して `skill-discovery-protocol` を呼び出す。
- プロファイルが存在する場合 → 読み込んでその構成に従う。
「これは簡単だからスキップしてよい」「やり方はわかっている」が最も多い
失敗パターン。体系的なスキルルーティングの目的を損なう。
</HARD-GATE>

<HARD-GATE>
プロファイルが適用を示すスキルの使用をスキップしてはならない。アクティブ
スキルスタックにスキルが含まれている場合、そのスキルのプロセスに従うこと。
プロファイルが適用と言っているのに「このスキルはここでは本当は適用されない」と
合理化することは許されない。オーバーライドにはユーザーの明示的な指示が必要。
</HARD-GATE>

---

## アンチパターン

これらの思考や行動は失敗を示す — 気づいたら STOP:

| アンチパターン | なぜ失敗するか |
| ---------------- | -------------- |
| 「単純すぎてスキル構成は不要」 | 構成は予期しないミスを防ぐ |
| 「やり方は既に知っている」 | プロファイルは見落としを防ぐ |
| 「始めてから構成しよう」 | 構成は実行の前。常に |
| 「このスキルはここでは当てはまらない」 | プロファイルが適用と言うなら従う。オーバーライドはユーザーの明示的指示が必要 |
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

---

## エントリ条件

- 検証条件が定義されたタスク単位（`task-doc` または同等）が存在すること。
- `doc-driven-dev-flow` から呼び出される場合、Phase 4 タスクが承認済みであること。

## 完了条件

- 全タスク単位が実装済みである。
- 各タスクが定義された検証条件を通過している。
- 実装中に発見された新制約が上流文書に反映されている。
- Review カテゴリスキルが適用されている（コードレビュー完了）。

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

ユーザーが「このタスクは構成をスキップ」と言えば、ユーザーに従う。
ユーザーが主導権を持つ。ただし上書き指示がない場合、フローは必須。
