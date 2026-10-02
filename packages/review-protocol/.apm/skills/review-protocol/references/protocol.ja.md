# Review Protocol

## 概要

仕様、設計、計画、実装、コード、ドキュメントなどの成果物をレビューする場合は、以下のプロトコルに従うこと。

目的は**重要な問題を効率よく発見・検証すること**であり、成果物を際限なく理想化することではない。

レビュー指摘がなくなるまで修正を繰り返してはならない。

## 1. 評価基準を先に確定する

レビュー前に、成果物の目的と受け入れ条件を確認する。

最低限、以下を明確にする。

- 何を達成する成果物か
- 必須要件
- 制約条件
- 前提条件
- 既存仕様・設計・システムとの整合条件
- 許容できないFailure
- 今回のスコープ

評価基準が不明確な場合は、勝手に理想像を設定してレビューしない。

不明点そのものをリスクとして扱う。

## 2. 客観的に検証できるものを先に検証する

利用可能な機械的・決定論的・客観的検証を、LLMによる主観的レビューより優先する。

例：

- 仕様・要求との照合
- schema / format validation
- consistency check
- 計算・データ検証
- prototype / simulation
- build / type check / lint
- automated test
- static analysis
- security scan
- 既存成果物との差分確認

客観的に判定できる問題を、LLMの推測だけで判断しない。

## 3. 独立したサブエージェントで並列レビューする

最低2つの独立したReviewerを並列起動する。

問題探索が終了するまで、Reviewer同士で指摘を共有しない。

### Reviewer A — 協調的レビュー

成果物が**目的を正しく、必要十分に達成しているか**を確認する。

重点的に探索する。

- 要求・目的との不一致
- 必要事項の欠落
- 内部矛盾
- 誤った前提
- 既存仕様・設計・システムとの不整合
- 実現性の問題
- 不必要な複雑性
- 将来の工程で重大な問題につながる設計上の欠陥

目的は成果物を理想化することではなく、**現在の目的に対して受け入れ可能か判断すること**である。

具体的な影響を説明できない好み、表現上の趣味、任意の改善はBlocking Issueとして報告しない。

### Reviewer B — 敵対的レビュー

「この成果物が失敗するとしたら、どのように失敗するか」という観点で確認する。

重点的に探索する。

- edge case
- failure mode
- 暗黙の前提
- 境界条件
- 想定外の利用・入力・状態
- 矛盾
- security / safety上の問題
- 運用上の問題
- 拡張時・統合時の破綻
- 回復不能または高コストな失敗
- 見落とされているリスク

各指摘には、具体的な**Failure Scenario**を必須とする。

単に「可能性がある」「もっと良くできる」という理由だけで問題として扱わない。

## 4. Reviewerは問題を確定しない

Reviewerの出力はすべて**Issue Candidate（問題候補）**として扱う。

各候補には最低限、以下を含める。

- Claim — 何が問題か
- Location — どこに問題があるか
- Failure Scenario — どう失敗するか
- Impact — 何が起きるか
- Evidence — 根拠
- Proposed Severity — 想定重大度
- Validation Method — どう検証できるか

Reviewerの指摘だけを根拠に成果物を変更してはならない。

## 5. Validatorが問題候補を検証する

Reviewerとは別のValidatorがIssue Candidateを検証する。

成果物の種類に応じて、可能な限り客観的な方法を使用する。

例：

- 原要求・一次資料との照合
- 既存仕様との照合
- 具体例・反例の作成
- 計算・シミュレーション
- prototype
- test
- 実コード実行
- static analysis
- データ検証
- 論理的な到達可能性の確認

各候補を以下に分類する。

- `CONFIRMED` — 根拠によって確認された
- `REJECTED` — False Positive
- `UNVERIFIED` — 十分に検証できない

`REJECTED`は除外する。

同じRoot Causeから発生する指摘は重複排除する。

`UNVERIFIED`は原則Blockingにしない。ただし潜在的影響が重大な場合は、未解決リスクとして人間に判断を求める。

## 6. Judgeが最終判定する

検証後、Reviewer・Validatorとは別のJudgeが結果を統合する。

Judgeが行うこと：

- Evidenceの評価
- False Positiveの除外
- Root Cause単位の重複排除
- Severityの決定
- Blocking / Non-blockingの決定

Judge自身が新しいレビューを開始してはならない。

Judgeが新しい問題に気付いた場合は、確定せず、新しいIssue CandidateとしてValidatorへ送る。

## 7. Severityを決定する

### P0 — Critical

成果物を受け入れると重大かつ回復困難なFailureにつながる。

**Blocking**

### P1 — Major

要求未達、重大な矛盾、現実的なFailure、重要な設計欠陥など、目的達成を実質的に妨げる。

**Blocking**

### P2 — Minor

限定的な問題や、改善価値はあるが目的達成を妨げない問題。

**Non-blocking**

### P3 — Nit

表現、style、好み、任意のcleanup・最適化。

**Non-blocking**

SeverityはReviewerのConfidenceではなく、**実際のImpact**に基づいて決定する。

## 8. CONFIRMED P0/P1だけを修正する

原則として自動修正対象は以下だけとする。

- `CONFIRMED P0`
- `CONFIRMED P1`

P2/P3は記録・報告してよいが、明示的に要求されない限り修正ループを発生させない。

修正は確認されたRoot Causeに限定する。

修正のついでにスコープを拡大したり、無関係な改善を行ったりしない。

## 9. 修正結果を検証する

修正後は全面レビューではなく、まず対象を絞って確認する。

確認すること：

- 元の問題が解消されたか
- Acceptance Criteriaを満たしているか
- 修正によって新しい矛盾やRegressionが発生していないか
- 関連する客観的検証を通過するか

小さな修正のたびに、すべてのReviewerを再起動してゼロから探索してはならない。

全面再レビューは、修正によって前提・構造・責務・境界・重要な判断などが大きく変化した場合のみ行う。

全面レビューは原則最大2サイクルとする。

それでもBlocking Issueが解消できない場合は、自律的な修正ループを停止し、人間へ判断を委ねる。

## 10. 停止条件

以下を満たした時点でレビューを終了する。

- Acceptance Criteriaを満たしている
- 必要な客観的検証を通過している
- 未解決の`CONFIRMED P0`がない
- 未解決の`CONFIRMED P1`がない
- 修正による重大なRegressionが確認されていない

P2/P3が残っていても終了する。

「さらに改善できる」
「別のReviewerなら何か見つけるかもしれない」
「より理想的な形にできる」

という理由だけでレビューを継続してはならない。

目標は問題候補をゼロにすることではない。

> **成果物が目的と受け入れ条件を満たし、Evidenceによって確認されたBlocking Issueが残っていない状態**

を完了条件とする。

## 11. 最終報告

最後に以下を簡潔に報告する。

- Confirmed P0/P1と対応内容
- Rejectedされた重要なFalse Positive
- 残っているP2/P3
- 実施したValidation
- Residual Risk / Uncertainty
- 最終判定

最終判定：

- `ACCEPT`
- `ACCEPT WITH NON-BLOCKING NOTES`
- `BLOCKED`

`ACCEPT`または`ACCEPT WITH NON-BLOCKING NOTES`に到達したら終了する。

明示的な要求がない限り、追加のレビューサイクルを開始しない。
