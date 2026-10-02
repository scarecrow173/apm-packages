# Report Format

review protocol の各 role（Reviewer A / Reviewer B / Validator / Judge /
Coordinator）間で受け渡される成果物の Contract。

## Issue Candidate

Reviewerの指摘はすべて**Issue Candidate**である — 確定した問題ではなく、仮説である。必須フィールド：

| Field | Content |
| --- | --- |
| Claim | 何が問題か、一文で。 |
| Location | 成果物のどこに問題があるか（ファイル、セクション、行）。 |
| Failure Scenario | 実際にどう失敗するかの具体的な記述。 |
| Impact | このまま受け入れた場合に何が起きるか。 |
| Evidence | 指摘の根拠 — 引用、差分、再現手順、参照資料。 |
| Proposed Severity | Reviewerが提案するSeverity（P0–P3）。 |
| Validation Method | その指摘を客観的にどう検証できるか。 |

具体的なFailure Scenarioを持たない候補は問題ではない — 差し戻すか破棄する。Reviewerの指摘だけを根拠に成果物を変更してはならない。

## Validatorの判定

| Verdict | 意味 | 扱い |
| --- | --- | --- |
| CONFIRMED | 根拠によって確認された。 | Severity判定へ進む。P0/P1はBlocking。 |
| REJECTED | False Positive。 | 以後の処理から除外する。 |
| UNVERIFIED | 十分に検証できない。 | 原則Non-blocking。潜在的影響が重大な場合は人間へエスカレーションする。 |

判定を報告する前に、同じRoot Causeを共有する候補を重複排除する。

## Severityレベル

| Severity | 意味 | Blocking |
| --- | --- | --- |
| P0 — Critical | 成果物を受け入れると重大かつ回復困難なFailureにつながる。 | Blocking |
| P1 — Major | 要求未達、重大な矛盾、現実的なFailure、重要な設計欠陥など、目的達成を実質的に妨げる。 | Blocking |
| P2 — Minor | 限定的な問題や、改善価値はあるが目的達成を妨げない問題。 | Non-blocking |
| P3 — Nit | 表現、style、好み、任意のcleanup・最適化。 | Non-blocking |

SeverityはReviewerのConfidenceではなく、実際のImpactに基づいて決定する。

## 最終判定

- `ACCEPT` — 成果物がAcceptance Criteriaを満たし、未解決のCONFIRMED P0/P1が残っていない。
- `ACCEPT WITH NON-BLOCKING NOTES` — 同上。P2/P3の指摘が記録されている。
- `BLOCKED` — 未解決のCONFIRMED P0/P1が残っている、またはレビューサイクルを使い果たした。人間へエスカレーションする。

## 最終レポート

Coordinator（protocol を実行する agent）の最終レポートは、以下をこの順序で含む。

- **Confirmed P0/P1** — 確認されたBlocking Issueとその解決内容。
- **Rejected false positives** — 除外された重要なREJECTED候補とその理由。
- **Remaining P2/P3** — 記録のみ。修正しない（明示的に要求された場合を除く）。
- **Validation performed** — 実施した客観的検証。
- **Residual Risk / Uncertainty** — 未解決のUNVERIFIED項目と残存リスク。
- **Final verdict** — `ACCEPT`、`ACCEPT WITH NON-BLOCKING NOTES`、または`BLOCKED`。
