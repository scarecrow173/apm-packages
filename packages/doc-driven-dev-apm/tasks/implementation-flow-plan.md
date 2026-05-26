# Implementation Plan: implementation-flow メタスキル強化

## Overview

現在の `implementation-flow` は単純なスキル表と推奨組み合わせのリストに留まっている。
`addyosmani/agent-skills` の `using-agent-skills` と `obra/superpowers` の `using-superpowers` が
持つ「スキル発見・ルーティング・強制適用」のメタスキル設計を取り入れ、
doc-driven-dev の実装フェーズに最適化されたインテリジェントなスキルディスパッチャーに進化させる。

## Source Analysis

### addyosmani/agent-skills `using-agent-skills` から取り入れる要素

| 要素 | 現状 | 取り入れ方 |
|------|------|-----------|
| Decision Tree (Skill Discovery) | 平坦なテーブルのみ | タスク特性に基づく分岐ルーティング |
| Core Operating Behaviors | なし | 実装フェーズ向けに適応（仮定の表面化、混乱管理、簡潔さ） |
| Lifecycle Sequence | Process の 6 ステップ | 実装ループとしてより具体的に |
| Quick Reference (Phase別) | Recommended Combinations | シナリオ別ルーティング表 |
| Failure Modes | なし | 実装フェーズ固有の失敗パターン |

### obra/superpowers `using-superpowers` から取り入れる要素

| 要素 | 現状 | 取り入れ方 |
|------|------|-----------|
| Always-invoke rule | なし | スキルチェック義務化（実装行動の前に必ず） |
| Skill Priority order | なし | Process → Implementation → Review の優先順位 |
| Skill Types (Rigid/Flexible) | なし | 各スキルに rigid/flexible 分類を付与 |
| Red Flags table | なし | スキルスキップの合理化パターン |
| Subagent Stop directive | なし | サブエージェント実行時のスキップ指示 |

## Architecture Decisions

1. **SKILL.md を全面書き換え** — 現在の内容は新構造の中に包含されるため、追記ではなく再構築。
2. **references/ に補助ドキュメントを追加** — ルーティングロジックの詳細やスキル分類表。
3. **doc-driven-dev-flow 側は変更しない** — Phase 5 の委譲先名 `implementation-flow` は変わらない。
4. **Core Behaviors は doc-driven-dev の文脈に適応** — 仮定の表面化を「上流文書との照合」に、scope discipline を「task-doc のスコープ尊重」に変換。
5. **既存の 9 ワークフロースキルは変更しない** — メタスキル側の変更のみ。
6. **EN/JA ペアで提供** — 他スキルと同じバイリンガル方針。

## Dependency Graph

```
Task 1: Skill Discovery (ルーティングロジック設計)
    │
    ├── Task 2: Core Behaviors (実装フェーズ向け行動規範)
    │
    ├── Task 3: Skill Classification (rigid/flexible, priority)
    │
    └── Task 4: Failure Modes & Red Flags
            │
            └── Task 5: SKILL.md 統合書き換え (EN)
                    │
                    └── Task 6: SKILL.ja.md (JA 版)
                            │
                            └── Task 7: 検証・テスト
```

## Task List

### Phase 1: 設計・分析

#### Task 1: Skill Discovery ルーティング設計

**Description:** タスク特性に基づくスキル発見・ルーティングの決定木を設計する。
`using-agent-skills` の decision tree を実装フェーズに特化した形で再設計し、
doc-driven-dev の task-doc 属性（スコープ、リスク、依存関係）をルーティング入力に使う。

**Acceptance criteria:**
- [ ] タスク特性 → スキル群 のマッピング決定木がある
- [ ] doc-driven-dev の上流文書（task-doc の検証条件、ADR の制約）をルーティング入力として活用している
- [ ] 単一スキル適用 / 複数スキル組み合わせ の両パスがある
- [ ] サブエージェント実行時のスキップ条件が定義されている

**Verification:**
- [ ] 5 つ以上の典型シナリオでルーティング結果が妥当であることを手動確認

**Dependencies:** None

**Estimated scope:** S (設計ドキュメントとして references/ に 1 ファイル)

---

#### Task 2: Core Operating Behaviors 定義

**Description:** `using-agent-skills` の 6 つの Core Operating Behaviors を
実装フェーズ向けに適応する。上流文書との整合確認、task-doc スコープ尊重、
検証義務などを doc-driven-dev の文脈で再定義する。

**Acceptance criteria:**
- [ ] 実装フェーズ向けに適応された行動規範が 5-7 項目ある
- [ ] 各規範が doc-driven-dev の概念（task-doc, spec, ADR）と紐づいている
- [ ] Bad/Good の具体例がある

**Verification:**
- [ ] 各規範が現行ワークフロースキルのいずれかと矛盾しないことを確認

**Dependencies:** None

**Estimated scope:** S (SKILL.md 内セクションとして統合)

---

#### Task 3: Skill Classification 表設計

**Description:** 9 つのワークフロースキルに rigid/flexible 分類と
priority order（Process → Implementation → Review）を付与する。
`using-superpowers` の Skill Types と Priority を参考に、
実装フェーズのスキル間の優先順位を明確化する。

**Acceptance criteria:**
- [ ] 9 スキル全てに rigid/flexible ラベルがある
- [ ] Process / Implementation / Review のカテゴリ分類がある
- [ ] 複数スキル該当時の優先適用順が定義されている

**Verification:**
- [ ] 分類が各スキル SKILL.md の性質と整合していることを確認

**Dependencies:** None

**Estimated scope:** S (SKILL.md 内セクションとして統合)

---

#### Task 4: Failure Modes & Red Flags 設計

**Description:** `using-agent-skills` の Failure Modes と `using-superpowers` の
Red Flags を統合し、実装フェーズ固有の失敗パターンを定義する。
スキル適用をスキップする合理化パターンを列挙する。

**Acceptance criteria:**
- [ ] 実装フェーズ固有の失敗パターンが 7-10 項目ある
- [ ] 「スキルを使わない言い訳」パターンが Red Flags テーブルにある
- [ ] 各失敗パターンに対応する正しい行動がある

**Verification:**
- [ ] 現行スキルの Hard Gates と矛盾しないことを確認

**Dependencies:** None

**Estimated scope:** S (SKILL.md 内セクションとして統合)

---

### Checkpoint: Phase 1 完了

- [ ] ルーティング決定木が設計済み
- [ ] Core Behaviors が定義済み
- [ ] Skill Classification が完了
- [ ] Failure Modes & Red Flags が設計済み
- [ ] 全設計要素が相互に矛盾しないことを確認

### Phase 2: 統合・実装

#### Task 5: SKILL.md 統合書き換え (EN)

**Description:** Task 1-4 の設計を統合し、`implementation-flow/SKILL.md` を全面書き換えする。
新しい構造: Subagent Stop → Skill Discovery → Core Behaviors → Skill Classification →
Process → Hard Gates → Failure Modes → Entry/Completion/Loopback。

**Acceptance criteria:**
- [ ] 既存の全内容（スキル表、組み合わせ、プロセス、Gates、条件）が新構造に包含されている
- [ ] Skill Discovery 決定木が含まれている
- [ ] Core Behaviors セクションがある
- [ ] Skill Types / Priority セクションがある
- [ ] Red Flags テーブルがある
- [ ] SUBAGENT-STOP ディレクティブがある
- [ ] doc-driven-dev-flow からの委譲インタフェースが維持されている

**Verification:**
- [ ] `pnpm test` パス（既存テストが Phase 6 Exit を検出すること）
- [ ] `pnpm run lint:md` でスキルファイルにエラーなし

**Dependencies:** Task 1, 2, 3, 4

**Files likely touched:**
- `.apm/skills/implementation-flow/SKILL.md`

**Estimated scope:** M (1 ファイルだが内容量大)

---

#### Task 6: SKILL.ja.md 作成 (JA)

**Description:** Task 5 で完成した英語版を日本語に翻訳し、
`implementation-flow/SKILL.ja.md` を書き換える。

**Acceptance criteria:**
- [ ] 英語版と 1:1 の構造対応がある
- [ ] 技術用語の一貫した翻訳（既存 .ja.md ファイル群と統一）
- [ ] frontmatter の description が日本語化されている

**Verification:**
- [ ] `pnpm run lint:md` パス

**Dependencies:** Task 5

**Files likely touched:**
- `.apm/skills/implementation-flow/SKILL.ja.md`

**Estimated scope:** M (1 ファイルだが内容量大)

---

### Checkpoint: Phase 2 完了

- [ ] `pnpm test` — 全テスト合格
- [ ] `pnpm run lint:md` — スキルファイルにエラーなし
- [ ] doc-driven-dev-flow Phase 5 からの委譲が機能的に維持されていることを確認

### Phase 3: 検証

#### Task 7: 最終検証・整合確認

**Description:** 全体の整合性を検証する。doc-driven-dev-flow、AGENTS.md、README
との参照関係が壊れていないことを確認し、必要に応じて微修正。

**Acceptance criteria:**
- [ ] doc-driven-dev-flow SKILL.md が `implementation-flow` を正しく参照している
- [ ] AGENTS.md の implementation-flow 記述が新内容と整合している
- [ ] README.md の Workflow Skills テーブルの description が最新
- [ ] 全テスト合格

**Verification:**
- [ ] `pnpm test` パス
- [ ] `pnpm run lint:md` パス（tasks/ 除外で判定）
- [ ] grep で "implementation-flow" の全参照箇所を確認

**Dependencies:** Task 6

**Files likely touched:**
- `AGENTS.md`, `AGENTS.ja.md` (description 微修正の可能性)
- `README.md`, `README.ja.md` (description 微修正の可能性)

**Estimated scope:** S

---

### Checkpoint: 完了

- [ ] 全受け入れ条件を満たしている
- [ ] テスト・lint 合格
- [ ] レビュー準備完了

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SKILL.md が長大になりすぎてコンテキストウィンドウを圧迫 | Med | references/ に補助ドキュメントを分離する判断を Task 5 で行う |
| 既存テストが新構造で壊れる | Low | テストは Phase 6 Exit とファイル存在のみ確認 — 内容は問わない |
| Skill Discovery の決定木が複雑すぎて逆に使いにくい | Med | 最大 3 レベルの深さに制限し、フォールバックを用意する |
| doc-driven-dev-flow との委譲インタフェースが壊れる | High | Phase 5 の Entry/Completion Criteria は変えない |

## Open Questions

- references/ に補助ドキュメントを分離するか、SKILL.md 1 ファイルに収めるか（Task 5 実装時に判断）
- Skill Discovery の決定木をテキスト形式にするか Mermaid/dot 形式にするか
