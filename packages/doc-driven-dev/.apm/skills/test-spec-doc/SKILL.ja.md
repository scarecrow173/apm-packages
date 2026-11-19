---
name: test-spec-doc
description: "docs/test-specs/ 配下の legacy test-spec corpus の読み取りと migration を行います。
  Document Registry 3 では migration 専用 — 通常実行の作成経路はなく、永続的な検証意図は
  verification-doc で docs/verification に記録します。
  キーワード: test spec, test specification, verifies, docs/test-specs"
license: MIT
---

# Test Spec Documentation Skill

この skill は、Registry 2 以前の test specification を読み取り・監査・
migration するために使います — migration input としてのみ。
test spec は検証の*意図*を記録するものです。
テストが何を保証するのか、なぜ存在するのか、いつ廃止してよいのかを記録し、
spec や design が変更されたときに「何を守るべきか」「そのテストはまだ必要か」を
人と coding agent が判断できるようにします。

## Document Registry v3 の位置づけ

Document Registry 3 では `test-spec` は **legacy 形式**です。migration
ツーリング(doc-maintenance の `migrate_docs` / `migrate_ids`)のみが解釈
し、durable 文書としての作成・lint はできません。`docs/test-spec` と
`docs/test-specs` は migration-owned scope です。`new_test_spec.js` creator は
配布されていません(Issue #249 で削除) — `test-spec` を解釈するのは
registry だけであり、その型名は共有クエリ面で拒否します:

`Document type "test-spec" is a legacy format under Document Registry 3: it is interpreted only by migration tooling and cannot be created or linted as a durable document`

durable な検証意図は現在、**verification-doc** skill
(`new_verification.js`)が `docs/verification` に `verification` 文書として
記録します。以下の規約は Registry 2 以前の `docs/test-specs` corpus を
読み取り・移行するための契約であり、この skill が Git 文書を mint する
話ではなくなりました。

test spec は実行可能な Gherkin でもテスト結果ログでもありません。共通 front
matter 契約と固定セクション（Purpose、Feature、Rules、Examples、Guarantees、
Non-goals、Risk）で構成します。実行可能な検証コマンドは task の
`## Verification` セクションに、実行結果は `impl-doc` の experiment log に
記録します。

## 前提条件

<HARD-GATE>
test spec を作成するには、少なくとも 1 つの upstream document を
`relations.verifies` に記録し、それが既存ファイルに解決できる必要があります。
検証対象の upstream 契約を持たない test spec は存在意義を失うため、作成しません。
</HARD-GATE>

## ワークフロー

1. 書く前に既存 doc を確認します。
   `docs/specs/`、`docs/designs/`、`docs/test-specs/` と関連する acceptance
   criteria を確認し、新しい test spec が既存の保証と重複しないようにします。
2. 検証意図を `verification` 文書として記録します。

   Document Registry 3 では `new_test_spec.js` creator は配布されていません
   (上記 *Document Registry v3 の位置づけ* 参照)。durable な
   検証意図は `docs/verification` にあり、**verification-doc** が作成
   します:

   ```bash
   node ../verification-doc/scripts/new_verification.js --title "Checkout total calculation" \
     --from docs/specs/define-checkout-flow.md
   ```

   `references/test-spec-conventions.ja.md` は Registry 2 以前の corpus を
   読み取り・移行するための契約であり、`assets/templates/test-spec.ja.md`
   は legacy 本文の参照構造です。
3. 固定セクションをすべて記入します。
   各セクションが答えるべき内容は `references/test-spec-conventions.ja.md` を
   参照してください。Rules と Examples は Gherkin の `Rule`/`Example` keyword に
   倣いますが、prose として読める形に留め、step definition にはしません。
4. 実装する task とリンクします。
   その振る舞いを実装する task は `relations.verified-by` に test spec を記録します。
   test spec から task への逆リンクは張りません。test spec の `verifies` は
   常に保護対象の上流 contract（spec、design、ADR）を指します。
5. status を最新に保ちます。
   `draft`、`proposed`、`approved`、`deprecated`、`superseded` を使います。
   pass/fail を `status` に記録してはいけません。runtime の結果は揮発的であり、
   `impl-doc` の experiment log に記録します。

## ライフサイクル上の位置

`planning-flow` の中で、test spec は plan 承認後・task 分解前に作成します。
task 分割ではなく approved spec と design から派生させます。task 境界は
変わり得ますが、保証すべき内容は維持されなければならないからです。
plan に検証可能な振る舞いが無い場合は作成を skip し、plan の front matter の
`relations:` に `test-spec-skip: "<理由>"` を記録します —— リンク先ではなく
理由文字列です。これにより audit が意図的な skip と
単純な欠落を区別できます。

## 必須コンテンツ

- **Purpose**: この test spec がなぜ存在し、いつ廃止してよいか。
- **Feature**: 仕様対象の振る舞い。
- **Rules**: feature が満たすべき不変条件や契約。
- **Examples**: rule を具体的に固定するシナリオ。
- **Guarantees**: 正しい実装が保証すべきこと。
- **Non-goals**: ここで意図的に検証しない振る舞いや範囲。
- **Risk**: これらの保証を失った場合に何が壊れ、何が失われるか。

## 他文書との境界

検証に関する内容は複数の文書型に存在します。それぞれの役割を守ってください。

| 文書 | 検証に関する内容 | 答える問い |
| --- | --- | --- |
| `spec` | Acceptance Criteria | 作業が正しいと言えるために何が真であるべきか。 |
| `test-spec` | Purpose、Feature、Rules、Examples、Guarantees、Non-goals、Risk | どの振る舞いが保証され、そのテストがなぜ存在するか。 |
| `plan` | Verification / Verification Matrix | どの check が各実装 step を証明するか。 |
| `task` | Done When / Verification | この slice が通すべき command はどれか。 |
| `design` | Verification Notes | planning 前に design を検証するものは何か。 |
| `adr` | review checklist の Verification | 決定の成功をどう確認するか。 |
| `impl-doc` | Implementation Record / Experiment Log | 何を試し、結果がどうだったか。 |

目安:

- spec の acceptance criteria を test spec にそのまま写さないでください。
  test spec はそれらを rule と example に分解し、各保証が*なぜ*維持される
  べきかを記録します。
- すべての acceptance criterion に test spec が必要なわけではありません。
  redesign を生き残るべき意図を持つ保証——境界 rule、不変条件、将来の変更が
  黙って落とし得る振る舞い——にだけ書きます。
- task の `## Verification` は実行可能な command を置く場所です。test spec
  へ移さないでください。task と test spec は `relations.verified-by` で
  リンクします。

## リソース

- `new_test_spec.js`: Registry 3 で*削除*されました。`test-spec` は
  legacy・migration 専用形式で、creator 経路はありません。検証意図は代わりに
  **verification-doc**(`new_verification.js`)で作成します。
- `references/test-spec-conventions.ja.md`: legacy corpus の契約です。
  directory、filename、status、relations、必須コンテンツ —— migration
  ツーリングと Registry 2 以前ファイルの読み取りに使います。
- `assets/templates/test-spec.ja.md`: legacy test spec 本文 template。
  参照構造のみであり、Registry 3 の作成経路で埋めるものではありません。
