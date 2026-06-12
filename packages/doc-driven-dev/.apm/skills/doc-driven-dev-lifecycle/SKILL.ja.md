---
name: doc-driven-dev-lifecycle
description: "文書駆動開発の全ライフサイクルを 6 フェーズのフローでオーケストレーションする。**利用タイミング**: (1) 新機能・新プロジェクト・大規模な変更をゼロから始めるとき、(2) どの doc スキルから始めるべきか不明なとき、(3) briefing から実行まで end-to-end の文書オーケストレーションが必要なとき、(4) 文書作成フェーズ間の順序制約を強制する必要があるとき。スキル順序: briefing-flow → design-doc → plan-doc → task-doc → implementation-flow → doc-status。キーワード: 文書ライフサイクル、オーケストレーション、フェーズゲート、メタスキル。"
license: MIT
---

# Doc-Driven Dev Lifecycle

既存の doc スキルを 6 フェーズのフローで選択・順序付けし、明示的なゲートで
制御することで文書駆動開発の全ライフサイクルをオーケストレーションする。

これは**メタスキル**であり、スクリプトを持たず直接的な成果物を生成しない。
代わりに「どのスキルを」「いつ」呼び出すかを判定し、フロー契約で定義された
順序制約と完了条件を強制する。

## 利用タイミング

- 新機能・新プロジェクト・大規模な変更をゼロから始めるとき。
- どの doc スキルから始めるべきか不明なとき。
- アイデアから実行まで end-to-end の文書オーケストレーションが必要なとき。

## フロー概要

```text
Phase 1: Briefing  →  Phase 2: Design  →  Phase 3: Planning  →  Phase 4: Execution Slice  →  Phase 5: Implementation  →  Phase 6: Exit
```

各フェーズにはゲートがあり、通過しなければ次へ進めない。
詳細は `references/flow-contract.ja.md` を参照。

## フェーズ一覧

| Phase | 目的 | 主担当スキル | ゲート |
| ----- | ---- | ------------ | ------ |
| 1 | 要望を文書入力に変換する | `briefing-flow` | briefing 完了出力: 受け入れ条件付き spec + ADR |
| 2 | 設計を実装可能な形へ具体化する | `design-doc` | spec/ADR と整合した承認済み設計 |
| 3 | 実装計画へ統合する | `plan-doc` | PLAN-DOC-GATE-001（承認済み設計必須） |
| 4 | plan を実装単位へ分解する | `task-doc` | plan にトレース可能な検証付きタスク |
| 5 | ワークフロースキルでコード実装 | `implementation-flow` | 全タスクが検証通過 |
| 6 | 文書整合を確認する | `doc-status` | front matter, relations, index の整合 |

## フェーズ終了チェックリスト

### Phase 1 終了時

`briefing-flow` に委譲する。完了条件は `briefing-flow` の Phase D ゲートで検証される:
- [ ] spec-doc が存在し `status:` ≥ `proposed`
- [ ] spec-doc に `acceptance_criteria:` が 1 件以上ある
- [ ] adr-doc が存在し `alternatives:` が 2 件以上ある
- [ ] Entry Decision の選択が記録されている
- [ ] 「実装前ブロッカー」に分類された未解決項目がない

### Phase 2 終了時
- [ ] design-doc が存在し `status:` = `approved`
- [ ] design-doc が spec-doc と adr-doc を参照している
- [ ] 設計と ADR 制約の間に矛盾がない
- [ ] 実装境界が明確

### Phase 3 終了時
- [ ] plan-doc が存在し `status:` ≥ `proposed`
- [ ] plan-doc が design-doc を参照している
- [ ] PLAN-DOC-GATE-001 を満たしている（承認済み設計）
- [ ] task-doc 粒度に分解可能

### Phase 4 終了時
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
|--------|----------|----------|----------|
| `deep-dive` | Frame | 制約と判断軸を含む確認済み intent 要約 | 明確な outcome、制約、未解決項目 |
| `steer-web-research` | Discover | 外部情報の調査結果 | エビデンス付きの調査レポート |
| `spec-doc` | Document | 正式な仕様書 | `acceptance_criteria:` 3 件以上、`status: proposed` |
| `adr-doc` | Document | アーキテクチャ決定記録 | `alternatives:` 2 件以上、理由が文書化 |

**注**: `briefing-flow` はこれらに限定されず、環境内の全利用可能スキルを動的に発見する。
詳細は [`briefing-flow` SKILL](../briefing-flow/SKILL.ja.md) を参照。

## Hard Gates

<HARD-GATE>
フェーズを飛ばしてはならない。各フェーズのゲートを満たしてから次へ進むこと。
ゲートを満たせない場合は、当フェーズ内でループするか前フェーズへ戻る。

**Why:** フェーズスキップは手戻りの最大原因。Phase 1 の出力不完全が Phase 3-4
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

1. **Briefing** — `briefing-flow` に委譲する。

**MANDATORY**: Phase 1（Briefing）に入る際に
[`briefing-flow` SKILL](../briefing-flow/SKILL.ja.md) を読み、以下を理解すること:
- Entry Decision（A-1〜A-5）の経路選択
- Briefing スキル発見プロトコルとプロファイル設定
- スキルスタックを使った情報収集の実行
- Phase E ゲート（spec-doc + adr-doc 完了条件）

**Do NOT Load** `briefing-flow` の references は Phase 1 開始時に `briefing-flow` 自身が管理する。

2. **Design** — `design-doc` を呼び出し、spec/ADR との整合を検証する。

**MANDATORY**: Phase 3（Planning）に入る前に
[`references/flow-contract.ja.md`](references/flow-contract.ja.md) §3-4 を読み、
詳細なゲート条件を理解すること。PLAN-DOC-GATE-001 の要件を把握する。

3. **Plan** — `plan-doc` を呼び出し、PLAN-DOC-GATE-001 を尊重する。
4. **Execute** — `task-doc` エントリに分解し、各タスクに検証手順を付与する。

**MANDATORY**: Phase 5（Implementation）に入る前に
[`implementation-flow` SKILL](../implementation-flow/SKILL.ja.md) を読み、以下を理解すること:
- Skill Discovery Protocol とプロファイル設定
- スキルスタックを使ったタスク単位の実行
- 検証証拠の要件

**Do NOT Load** `implementation-flow` は Phase 4 完了前には読まないこと —
タスク分解が完了してから実装設定を始める。

5. **Implement** — ワークフロースキルをタスク単位で適用し、検証通過を確認する。
6. **Exit 監査** — `doc-status` を呼び出し、文書整合を検証する。

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

### Phase 4 → ADR/Design 更新 (新制約)
タスク分解で新たな制約が発見された場合:
1. 制約を記録: "constraint: [説明]"
2. ADR または design-doc のどちらを更新すべきか判断
3. 影響を受けるドキュメントを最小スコープで更新
4. ブロックされたタスクから Phase 4 を再開

### Phase 5 → Phase 1 または 2 (実装での発見)
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
| 「並行でドキュメントを作れば時短」 | 依存関係のあるドキュメントの並行作成は整合性破綻 |

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

## Phase 5: Implementation

タスク分解（Phase 4）後、`implementation-flow` を呼び出してコード実行を
オーケストレーションする。タスク単位で適切なワークフロースキルを
選択・順序付けし、検証ループを管理し、発見された制約をフィードバックする。

スキル選択、推奨組み合わせ、タスク単位実行プロセスの詳細は
`implementation-flow` SKILL を参照。

### エントリ条件

Phase 5 は Phase 4 のタスクが承認され実行準備が整った時に開始する。

### Phase 5 完了条件

- 全 `task-doc` エントリが実装済みかつ検証通過している。
- 実装中に発見された新制約が ADR/design に反映されている。
- コードレビューが完了している。

### Phase 6 への移行

実装完了後、Phase 6（`doc-status`）に進み最終的な文書整合検証を行う。

## Phase 6: Exit

Phase 6 の `doc-status` 監査がブロッキング指摘なしで通過したとき、
全文書が整合・追跡可能であることが確認され、フローは完了となる。

## 参照

詳細なフロー契約: `references/flow-contract.ja.md`
