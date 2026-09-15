---
name: github-issue-handoff
description: コーディング作業中に、ローカルの調査だけでは判断しきれない第三者の評価が必要なときに使います。複数の妥当な案があるアーキテクチャやAPI/データモデルの重要判断、十分なdebugging後も原因不明の問題、requirementと既存挙動の矛盾、セキュリティ上重要または巻き戻し困難な変更が典型例です。既存handoff Issueへの回答を確認して作業を再開するときにも使います。通常タスクや、test・lint・リポジトリ文書で確定できる問題には使いません。
license: MIT
---

# GitHub Issue Handoff

handoff は、レビュー可能な repository state を GitHub 上に永続化する仕組みです。
専用 branch、push 済みの checkpoint commit、構造化された Issue、リンクされた
Draft PR を組み合わせ、任意の第三者が特定の問いを評価して Issue コメントで
非同期に回答できるようにします。

- **Requester**: handoff を開始し、維持し、解決まで面倒を見る作業主体。
- **Responder**: repository を閲覧し GitHub Issue にコメントできる任意の主体。
  人間、別のコーディングエージェント、レビュー用 AI、自動化を問いません。
  特定の製品・runtime・アカウント・専用ツールを要求してはいけません。

Issue は「何を判断してほしいか」を記録します。branch・commit・linked PR は
「その時点で実際にどのコードだったか」を記録します。Responder prompt は
ユーザーが任意の Responder へそのまま渡せる portable な指示であり、
特定の実行環境ではありません。

## いつ使うか

独立したレビューに実質的な価値がある場合に handoff します。

- 巻き戻しが高価・困難な architecture、API contract、data model の判断
- trade-off のある複数の妥当な選択肢
- concurrency、consistency、security 上敏感、destructive migration の判断
- 十分な debugging を行っても原因が不明な問題
- requirement と既存挙動が矛盾するケース
- 自分の仮説・severity・scope に対する独立評価

handoff しないもの:

- syntax error、formatter や lint で確定する問題、test で確定できる問題
- repository documentation に既に明記されている問い
- 安全に試行できる小さな implementation detail
- 十分な証拠が既に存在する判断

## Handoff 前に調査する

問題を見つけただけで escalate してはいけません。まず:

1. 問題を再現または特定する。
2. 関連する code、test、error、log、repository docs を調べる。
3. 仮説を立て、安価な検証を行う。
4. その上で外部レビューの価値を判断する。

## Handoff ライフサイクル

1. repository、現在の branch、merge 予定の base、working tree、HEAD を確認する。
   現在の task branch がこの変更専用で適切なら再利用し、そうでなければ新しい
   branch を作る（例: `handoff/<short-topic>`。repository の規約を優先）。
2. Responder の判断に必要な state だけを commit する。再現コード、現在の
   implementation、failing test、draft、schema、docs など。事前に
   `git status`、`git diff`、`git diff --cached` を確認する。無関係な変更、
   生成物、cache、secret を混ぜない。
3. branch を push する。local-only の handoff は handoff ではない。
4. `references/issue-format.md` の形式で handoff Issue を作成する。
5. Issue へ closing keyword（`Closes #<n>`）でリンクする Draft PR を作成する。
   base は最終的に merge される branch。
6. `assets/templates/responder-prompt.md` を実際の repository と label で
   展開し、完成した prompt をユーザーに表示する。ファイル path の案内だけでは
   不十分。
7. 独立して進められる作業は続行する。残作業がすべて response 依存の場合だけ
   yield する。
8. 再開時は Issue 本文、新規 comment、linked PR、最新の push 済み commit を
   確認し、回答を repository の証拠と照合して評価する。盲目的に実装しない。
9. implementation を完成させ、validation を実行し、push し、PR を merge し、
   Issue が実際に close されたことを確認する。

Requester の完全な protocol: `references/protocol.md`。
Issue/PR/metadata の形式: `references/issue-format.md`。
Responder 側の protocol: `references/responder-guide.md`。

## 不変条件

- 5 つの artifact はすべて必須: reviewable branch、push 済み checkpoint
  commit、handoff Issue、linked Draft PR、ユーザーへ表示した完成 prompt。
- Issue より先に push する。repository policy が push を禁止する場合は、
  handoff protocol を完了できない旨を明示して停止する。Issue だけを作る
  fallback へ勝手に切り替えない。
- PR は "Related to" ではなく closing keyword で Issue へリンクする。
- Label: `handoff` に加えて state を 1 つだけ付ける。
  `handoff:needs-response`（Responder の回答待ち）または
  `handoff:needs-requester`（Requester の確認待ち）。残作業がすべて
  response 依存の場合のみ `handoff:blocking` を追加する。Issue 作成前に
  label が repository に存在することを確認する（`gh label create`）。
  `handoff:needs-response` がなければ Responder スキャンは handoff を
  発見できないため、この確保に失敗した場合は handoff 自体を fail closed
  にする。
- 人間の plain comment も有効な response。Responder への label 操作は任意で
  あって必須ではない。
- commit message は永続的な履歴。意図、現在の挙動、検証済み事項、未確定事項を
  説明し、secret は絶対に書かない。
- merge 後は Issue が close されたか確認する。auto-close が失敗したら merge
  済み PR を示す final comment を書いて明示的に close する。merge されずに
  close された PR は完了した handoff として扱わない。

## Blocking

`handoff:blocking` は、残っている意味のある作業がすべて response 依存の場合に
だけ付ける。Issue を作成したこと自体は中断理由にならない。

## 失敗時の報告

ライフサイクルの途中で失敗した場合は、作成済みの artifact と失敗箇所を正確に
報告する。中途半端な成功を完了として報告しない。
