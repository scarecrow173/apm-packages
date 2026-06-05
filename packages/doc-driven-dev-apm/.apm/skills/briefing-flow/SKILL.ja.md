---
name: briefing-flow
description: "新しい機能や変更の初期情報収集を始めるとき、要件が曖昧なとき、または spec-doc / adr-doc を書く前にどのスキルを使うか決めたいときに使う。キーワード: briefing, discovery, spec-doc, adr-doc, skill stack, entry decision。"
license: MIT
---

# ブリーフィングフロー

<SUBAGENT-STOP>
明示的なスキル指示付きで特定のタスクを実行するサブエージェントとして呼び出された場合は、このメタスキルを飛ばし、dispatch 指示に従ってください。
</SUBAGENT-STOP>

利用可能なすべてのスキルを動的に発見してルーティングし、情報収集と整理を行う。このスキルは briefing フェーズのオーケストレータであり、どのスキルが適用されるかを判断し、情報状態に応じて skill stack を構成し、spec-doc と adr-doc が完了するまで次段階への進行を制御する。

これはメタスキルである。直接ドキュメントは生成しない。代わりに、スキル発見、構成、順序付け、そして情報収集から下流の文書作成へ接続するゲートループを管理する。

## 利用タイミング

- 新しい機能、プロジェクト、大きな変更の初期情報収集を始めるとき。
- 要件が曖昧で、どのスキルから始めるべきか不明なとき。
- `doc-driven-dev-flow` から briefing フェーズの委譲先として呼び出されたとき。
- spec-doc / adr-doc を書く前に情報を整理したいとき。
- 何らかの情報収集作業を始めるとき。まずこのスキルを呼び出して構成を行う。

## ルール

**spec-doc / adr-doc を書く前に、下の Assess と Configure フェーズを完了すること。**
利用可能なスキルが今やろうとしている作業に当てはまるなら、必ず使う。
これは任意ではない。自分の判断で省略してはいけない。

---

## フローフェーズ

```text
Phase A: Assess  →  Phase B: Configure  →  Phase C: Gather & Generate  →  Phase D: Gate
```

| Phase | Purpose | Output |
| ----- | ------- | ------ |
| A. Assess | 要求を理解し、情報状態を判定する | Entry Decision を記録 + 特性を特定 |
| B. Configure | スキルを発見し、briefing 用の skill stack を構成する | 有効な skill stack を宣言 |
| C. Gather & Generate | 情報を集め、文書を並列生成する | spec-doc + adr-doc を生成 |
| D. Gate | 完了条件を検証し、次段階への準備完了を確認する | Gate の合否判定 |

---

## Phase A: 評価

要求や問題を受け取り、情報状態を判定する:

1. **要求を理解する** — 目的、背景、制約、関係者を特定する。
2. **情報状態を分類する** — Entry Decision テーブルで経路を決める:

| Question | If Yes → | If No → |
| -------- | -------- | ------- |
| 問題を 1 文で明確に説明できるか? | Continue | A-1 (Problem Framing) |
| 方向性はあるがトレードオフ分析が必要か? | A-2 (Option Framing) | Continue |
| 今すぐ acceptance criteria を書けるか? | A-4 (Direct Start) | A-1 or A-2 |
| 複数の情報源を収束させる必要があるか? | A-3 (Combined Discovery) | Single path |
| 外部情報の調査が必要か? | A-5 (Research Required) | Internal info sufficient |

1. **Entry Decision を記録する** — 選んだ経路と理由を 1 行で残す。

### Entry Decision の分岐

- **A-1. Problem Framing** — 問題が曖昧 → Frame カテゴリのスキルで問題定義を構造化する。
- **A-2. Option Framing** — 方向性はあるがトレードオフが不明 → Frame カテゴリのスキルで代替案を整理する。
- **A-3. Combined Discovery** — 複数スキルが必要 → briefing-profile の skill stack から動的に選ぶ。
- **A-4. Direct Documentation Start** — 要件が明確 → Phase C の dispatch trigger をすぐ発火する（理由は 1 行で記録）。
- **A-5. Research Required** — 外部調査が必要 → Discover / Research カテゴリのスキルを優先する。

これらは**順番**ではなく**選択肢**である。情報の十分性に基づいて選ぶ。
A-4 を選んでも Phase B (Configure) は省略しない。Document カテゴリのスキル構成は依然必要である。

**Profile の確認:** リポジトリの `.sdp` ディレクトリ配下にある `.sdp/briefing-flow-default/briefing-profile.json` を確認する。

> **`.sdp/briefing-flow-default/briefing-profile.json` とは?**
> リポジトリ固有の JSON 設定ファイルで、briefing に利用可能なすべてのスキルを列挙し、カテゴリに割り当て、flow stack の slot と activation rule を定義し、invocation resolution を指定する。
> この flow の adapter file を使って `skill-discovery-protocol` スキルが生成・更新し、そのワークフローの一部として検証される。

- 存在して有効な場合 → Phase B (Configuration from Profile) に進む。
- 存在しない場合 → `skill-discovery-protocol` を呼び出し、adapter path `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml` を渡す。
- 存在するが stale / corrupted の場合 → 同じ adapter path を渡して `skill-discovery-protocol` を再度呼び出し、再生成する。

---

## スキル発見プロトコル

Profile の生成と検証は `skill-discovery-protocol` スキルが担当する。

この flow から呼び出すときは、次を渡す:

- Adapter path: `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`
- Expected profile path: `.sdp/briefing-flow-default/briefing-profile.json`
- Expected inference artifact: `.sdp/skill-reference-inferences.json`

スキルが artifact を作成または更新した後、`.sdp/skill-reference-inferences.json` を scan list と照合する。task routing に対して `provides` または `uses` が不完全なら、同じ adapter path で `skill-discovery-protocol` を再実行し、profile を使う前に inference 更新を依頼する。

詳細は [skill-discovery-protocol](../skill-discovery-protocol/SKILL.md) を参照。

---

## Phase B: 構成

`.sdp/briefing-flow-default/briefing-profile.json` が利用可能な状態で:

1. **Flow stack を読み込む**: `skill-discovery-protocol` を使って `.sdp/briefing-flow-default/briefing-profile.json` から `flow-stack` を読む
2. **Entry Decision に基づいて activation を適用する**: Phase A の経路に応じて優先カテゴリを決める
   - A-1 / A-2 → Frame カテゴリのスキルを優先
   - A-3 → 複数カテゴリにまたがる一致スキルを有効化
   - A-5 → Discover / Research カテゴリのスキルを優先
   - **一致する slot がない場合**: デフォルト stack のみで進める
3. **Resolution を確認する**: `skill-discovery-protocol` を使って `.sdp/briefing-flow-default/briefing-profile.json` から `resolution` を読む
4. **Execution policy を確認する**: `skill-discovery-protocol` を使って `.sdp/briefing-flow-default/briefing-profile.json` から各候補スキルの `execution-policy` を読む
5. **有効な skill stack を宣言する:**

```text
この briefing の ACTIVE SKILL STACK:
1. [Category] skill-name — reason
2. [Category] skill-name — reason
3. [Category] skill-name — reason
→ この構成で進めます。
```

**実行優先順:**

| Priority | Category | Rationale |
| -------- | -------- | --------- |
| 1 | Frame | 情報収集の前に問題や選択肢を構造化する |
| 2 | Discover | 外部情報を探索・発見する |
| 3 | Research | 深い調査を行う |
| 4 | Validate | 収集した情報の正確性と完全性を検証する |
| 5 | Document | 整理された情報を正式文書にする |

詳細なカテゴリ定義は、`assets/adapters/briefing-adapter.yaml` の `classification.taxonomy` を参照する。

---

## Phase C: 収集・生成

情報を集め、文書を並列に生成する。十分な情報が揃ったらすぐにサブエージェントへディスパッチし、コンテキストの鮮度低下を防ぐ。

### 情報収集

有効な stack の各スキルを優先順位に従って適用する:

1. 各スキル固有のプロセスに従う（そのスキルの `SKILL.md` を読む）。
2. profile からそのスキルの **execution mode** を確認する:
   - **Rigid skills**: 厳密に従う。手順を飛ばしたり並べ替えたりしない。
   - **Flexible skills**: 意図を保ちつつ、状況に合わせて調整する。
3. スキルはレイヤーであり、排他的ではない。複数のスキルが同時に適用される。

### ディスパッチトリガー

情報収集と並行して、条件が満たされたらサブエージェントをディスパッチする:

| Trigger | Fire Condition | Action |
| ------- | -------------- | ------ |
| spec-doc | 目的、範囲、acceptance criteria、除外事項が揃った | サブエージェントを起動し `spec-doc` スキルを委譲 |
| adr-doc | 採用方針、代替案、理由、影響が揃った | サブエージェントを起動し `adr-doc` スキルを委譲 |

**ディスパッチ原則:**

- **両方を待たない。** 先に準備できたトリガーをすぐに発火する。
- 情報収集はディスパッチ後も続ける（非ブロッキング）。
- 両方のスキルは独立にディスパッチできる。並列実行でよい。
- ディスパッチ時に渡す情報は、その時点の**生の収集結果**を含める。要約して劣化させない。
- サブエージェントは各スキルのワークフローに従って文書を生成する。

### 停止条件

Phase C は、次のすべてが満たされるまで反復する:

- 主要なユースケースについて、入力 / 処理 / 期待結果を説明できる。
- 重要な制約（技術、運用、期限、品質）が明示されている。
- 未解決の項目が "pre-implementation blocker" か "manageable downstream" に分類されている。
- `spec-doc` が生成済み（サブエージェント完了）。
- `adr-doc` が生成済み（サブエージェント完了）。

Stop conditions が満たされない場合:

1. 足りない情報を明示的な質問として書き出す。
2. 適切な Discover / Research / Frame スキルで解決する。
3. 結果を反映し、stop conditions を再評価する。

### 後発情報の反映

ディスパッチ後に追加情報を得た場合は、Phase D (Gate) の前に document supplement として反映する。

---

## Phase D: ゲート検証

ブリーフィングは、次の**すべて**が満たされるまで完了ではない:

### 完了条件チェックリスト

- [ ] `spec-doc` が存在し、`status:` が `proposed` 以上である（`draft` は通過不可）
- [ ] `spec-doc` に少なくとも 1 つの `acceptance_criteria:` がある
- [ ] `adr-doc` に少なくとも 2 つの `alternatives:` がある
- [ ] Entry Decision (A-1/A-2/A-3/A-4/A-5) の選択が記録されている
- [ ] "pre-implementation blocker" に分類された未解決項目が残っていない
- [ ] 両方の文書が同じ問題文脈を参照している

### ゲート不通過時のアクション

- spec-doc が不完全 → Phase C に戻って dispatch trigger を再度発火する。
- spec を書くには情報が不足している → Phase C に戻って追加収集を行う。
- adr-doc の alternatives が不足している → Frame / Discover スキルで選択肢を広げるため Phase C に戻る。
- Gate が通った → briefing 完了を宣言し、次段階（Design）への準備完了を通知する。

---

## ループバックルール

### Phase C → Phase A（情報状態の変化）

実行中に情報状態の根本的な変化が判明した場合:

1. 記録する: `"info-shift: [description]"`
2. Entry Decision を再評価する。
3. 必要なら skill stack を再構成する（Phase B に戻る）。

### Phase D → Phase C（文書品質不足）

文書が gate 条件を満たさない場合:

1. 記録する: `"doc-gap: [description]"`
2. 情報が不足しているなら、収集を再実行し、dispatch trigger を再発火する。

---

## ハードゲート

次の項目は、すべてのフェーズで常に有効な**不変条件**である。
違反を検知したら、ただちに STOP して対処する。

<HARD-GATE>
Profile ベースの構成を省略しないこと。
- Profile が存在しない場合 → `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml` を渡して `skill-discovery-protocol` を呼び出す。
- Profile が存在する場合 → 読み込み、その構成に従う。
"十分明確だから省略できる" や "このパターンはもう知っている" は、最も多い失敗パターンである。これらは体系的なスキルルーティングを壊す。
</HARD-GATE>

<HARD-GATE>
spec-doc の `status` が `proposed` 以上になるまで、briefing 完了を宣言しないこと。
`draft` のまま通過するのは禁止である。acceptance criteria のない spec は、計画の土台にならない。

**Why:** 不完全な Phase 1 の出力は、Phase 3-4 の再設計の 40% を引き起こす。
</HARD-GATE>

<HARD-GATE>
緊急修正のシナリオでも、次のフェーズへ進む前に、最低でも spec-doc または adr-doc を証拠として残すこと。

**Why:** 証拠のない緊急修正は、恒久的な技術的負債になる。最低限の証拠は 10 分で作れるが、謎コードのデバッグには何時間もかかる。
</HARD-GATE>

<HARD-GATE>
Profile が示しているスキルをスキップしないこと。active skill stack にスキルが含まれているなら、そのスキルのプロセスに従う。
上書きできるのは、ユーザーからの明示的な指示がある場合だけ。
</HARD-GATE>

---

## アンチパターン

次の思考や行動は失敗の兆候である。気づいたら STOP する:

| Anti-pattern | Why it fails |
| ------------ | ------------ |
| "Requirements are clear, no need to organize" | 暗黙の前提は後で矛盾として表面化する |
| "I already know how to do this" | profile は見落としていた情報源を明らかにする |
| "Research later, write first" | 情報不足の spec は実装時の手戻りを生む |
| "This skill doesn't apply here" | profile が適用対象だと言っているなら従う |
| "Acceptance criteria can be added later" | criteria のない spec は検証不能な計画になる |
| "Alternatives are obvious" | 1 案しかない ADR には意思決定の理由がない |
| "Spending too much time on briefing" | stop conditions が満たされたら止める。満たされるまで続ける |
| "It's urgent, skip the spec" | 最低限の証拠は 10 分。省略すると何時間から何日も失う |
