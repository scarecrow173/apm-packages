---
name: review-protocol
description: 仕様・設計・計画・実装・コード・ドキュメントを受け入れる前にレビューするときに使います。見逃した欠陥のコストが高い場合、レビューが形だけの承認や際限のない指摘に堕ちやすい場合、指摘を変更の根拠にする前に証拠で検証したい場合に有効です。diff・lint・type check・test で確定できる些末な変更には使いません。
license: MIT
---

# Review Protocol

spec・design・plan・implementation・code・document といった artifact を
レビューするための、境界付き・evidence 駆動の protocol。目的は重要な
問題を効率的に発見・検証することであり、reviewer がコメントを出し
尽くすまで反復することではない。

- **Coordinator**: review を実行する agent — 評価基準を確定し、
  reviewer を派遣し、candidate をルーティングし、承認された修正を
  適用し、停止時期を判断する。
- **Reviewer A / Reviewer B**: 異なる領域をカバーし、完了まで互いの
  findings を見ない 2 人の独立した reviewer。
- **Validator**: 各 Issue Candidate を客観的な証拠に照らして検証する
  独立した role。
- **Judge**: 検証済みの結果を統合し、severity と blocking 状態を決定
  する独立した role。

runtime が対応する場合は各 role を独立した subagent として派遣する。
そうでなければ明確に分離した pass として実行する。Reviewer・
Validator・Judge を単一の actor にまとめてはいけない。

## いつ使うか

- sign-off 前に明示的な acceptance criteria に照らして artifact を
  レビューするとき
- blocking な欠陥の見逃しが高コストになる重要度の高い artifact
- 際限のない polish や未検証の指摘に陥りがちな review loop

使わないもの:

- diff の確認、linter、type check、test で確定できる些末な変更
- acceptance criteria のない open-ended な改善 — 先に criteria を定義する
- 具体的な failure scenario のない style の好み

## ライフサイクル

1. **評価基準を確定する** — purpose、must requirements、constraints、
   assumptions、consistency requirements、許容できない失敗、scope。
   不明確な基準はそれ自体が risk であり、理想を捏造しない。
2. **客観的チェックを先に実行する** — 主観的な review の前に、利用
   可能な機械的・決定的なチェック（spec diff、schema validation、
   build、type check、lint、test、静的解析）をすべて実行する。
3. **独立した reviewer を少なくとも 2 人並列に派遣する** — Reviewer A
   （cooperative）と Reviewer B（adversarial）。出力は Issue
   Candidate のみ。
4. **すべての candidate を検証する** — Validator が各 candidate を
   `CONFIRMED`、`REJECTED`、`UNVERIFIED` に分類する。`REJECTED` は
   棄却。`UNVERIFIED` は潜在的な影響が深刻でない限り non-blocking —
   深刻な場合は人間へ escalate する。
5. **Judge** — 証拠を評価し、false positive を落とし、root cause で
   dedupe し、severity `P0`–`P3` を割り当て、Blocking / Non-blocking
   を決定する。
6. **CONFIRMED な P0/P1 のみ修正する** — 確定した root cause に scope
   を限定する。P2/P3 は報告するだけで反復しない。
7. **修正を再検証する** — 対象を絞ったチェックのみ。完全な re-review
   は最大 2 サイクルまでで、修正が assumptions・構造・責務・境界・
   重要な決定を変更した場合のみ行う。
8. **停止する** — acceptance criteria が成立し、未解決の CONFIRMED な
   P0/P1 が残っていないとき。verdict `ACCEPT`、
   `ACCEPT WITH NON-BLOCKING NOTES`、`BLOCKED` のいずれかで最終
   レポートを出力する。

## 不変条件

- reviewer の主張は artifact を決して変更しない — 修正を許可するのは
  Validator の `CONFIRMED` verdict のみ。
- 自動修正は CONFIRMED な P0/P1 に限定される。明示的に要求されない
  限り P2/P3 は fix loop を生じない。
- すべての Issue Candidate は具体的な Failure Scenario を持つ —
  「こうすればより良くなる」は issue ではない。
- severity は実際の影響で決定し、reviewer の確信度では決定しない。
- 完全な re-review の上限は 2 サイクル。その後も未解決の blocking
  issue は永遠に retry せず、人間へ escalate する。
- Judge は独自に新しい review を開始しない — 新たな観察は新しい
  Issue Candidate として Validator へルーティングする。
- 目標は証拠で確認された blocking issue が残っていないことであり、
  コメントゼロではない。

## 参照

- `references/protocol.md` — 11 フェーズの完全な protocol: 評価基準、
  客観的チェック、reviewer scope、検証、判定、severity、修正 scope、
  再検証、停止条件、最終レポート。
- `references/report-format.md` — Issue Candidate のフィールド契約、
  verdict と severity の定義、最終レポート形式。
