# Deferred Design Concerns — doc-driven-dev 拡張

## Problem Statement
HMW: 設計を approved にしつつ、「今は作らないが将来作る別機能・拡張」を、
忘却・矛盾・ゲートのブロックなしに機械可読で追跡可能に残すには？

## Recommended Direction
独立ファイル（status: draft の spec/design）として将来機能を残し、
現在の approved 文書から **専用 relation `defers` で参照**する。
本文の「Deferred Design Concerns」セクションには各据え置きの
**理由・再着手トリガ・無視した場合のリスク**を書き、リンク列挙はしない
（relation を正本とし二重管理を避ける）。

将来機能の表現自体は既存の draft spec/design で充足するため、
新規開発は「relation ペア追加」と「judge 向けの矛盾例外文言」に絞られる。

## 重要な調査結果（assumption #1 の確定 — 当初想定からの変更）
当初は「`audit_docs` が approved→draft の参照を矛盾としてフラグする」と想定し、
スクリプトに例外実装が必要だと考えていた。**しかし原本 TS を精読した結果、
この想定は誤りだった。**

- `auditDocuments`（`scripts/doc-driven-dev/src/skills/lib/doc_suite_utils.ts`）が
  出す finding は `invalid-status` / `broken-relation-link`（参照先**ファイル不在**）/
  index 系のみ。**relation の参照先の status を読むコードは一行も無い。**
- 一方 `doc-status` の SKILL.md 27 行目は
  "plan is approved but referenced design is draft" を blocking contradiction の例として
  挙げている。
- → 矛盾検知は**スクリプトには存在せず、SKILL.md の指示に従う judge（LLM）側にのみ存在**する。
  すなわち本機能の本丸は「スクリプト例外」ではなく「**SKILL.md と実装の乖離の扱い**」である。

## Key Assumptions to Validate
- [x] `audit_docs` が approved→draft 矛盾を機械検知するか → **しない**（確認済み）
- [ ] `relationFields` に 1 ペア追加したとき、schema・テンプレート・doc-status / plan-doc
      SKILL の何ファイルに波及するか棚卸し（relationSchema は配列から自動生成のため波及は限定的の見込み）
- [ ] 据え置き項目の「卒業」遷移（draft→proposed 着手時に defers をどう扱うか）が
      運用で破綻しないか素振り

## MVP Scope
**In:**
- relation ペア `defers` / `deferred-by` を `relationFields` に追加（schema・テンプレートは自動波及）
- `doc-status` SKILL.md の「approved→draft は矛盾」例に、
  **`defers`/`deferred-by` 経由は意図的据え置きとして矛盾扱いしない**旨の judge 向け例外文言を追加
- design.md / spec.md テンプレートに `## Deferred Design Concerns`（理由・再着手トリガ・リスク）を追加
- 実例 1 件で end-to-end 検証（approved design → draft 将来機能を defers で結ぶ）

**Out:**
- `audit_docs` への新規矛盾検知の実装（そもそも無いので、ここでは作らない）
- 自動「卒業」遷移ツール（当面は手動 + doc-status 目視）
- 据え置き項目専用の新 doc type（既存 spec/design + draft を流用）
- 据え置きの優先度・期限管理（YAGNI）

## Not Doing (and Why)
- 新しい doc type の新設 — draft spec/design で足りる。type 追加は lifecycle 全体の複雑度を上げる
- section へのリンク手書き列挙 — front matter relation と二重管理になる。relation を単一の正本にする
- スクリプト側に矛盾検知を新設してまで例外を足す — 検知ロジック自体が無いので不要かつ過剰

## Open Questions
- relation 名は `defers`/`deferred-by` でよいか（既存の active/passive 命名規約に整合）
- SKILL.md と script の乖離（27 行目の矛盾検知が未実装）を、本機能のついでに是正するか
  別 concern として切り出すか
- 「再着手トリガ」を本文の自由記述に留めるか、front matter の構造化フィールドにするか

## Provenance
- 前回セッション「Doc-driven dev design concerns」（cwd を誤って code-knowledge で開始）からの継続。
  本リポジトリ apm-packages が doc-driven-dev パッケージの**原本**であり、本機能の実装対象。
