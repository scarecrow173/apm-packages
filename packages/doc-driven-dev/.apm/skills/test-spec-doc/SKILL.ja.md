---
name: test-spec-doc
description: テストが何を保証し、なぜ存在するのかを、Feature/Rule/Example 構造を持つ正規テスト仕様文書として、検証対象の spec・design・ADR にリンクして記録するときに使います。
license: MIT
---

# Test Spec Documentation Skill

この skill は、検証の*意図*を記録する test specification を書くために使います。
テストが何を保証するのか、なぜ存在するのか、いつ廃止してよいのかを記録し、
spec や design が変更されたときに「何を守るべきか」「そのテストはまだ必要か」を
人と coding agent が判断できるようにします。

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
2. test spec を作成します。

   ```bash
   node scripts/new_test_spec.js --title "Checkout total calculation" \
     --verifies docs/specs/0001-define-checkout-flow.md \
     --derives-from docs/designs/0001-checkout-design.md
   ```

   `--verifies` は繰り返し指定でき、各 target は存在している必要があります
   （TEST-SPEC-DOC-GATE-001）。test spec が特定の spec や design を詳細化する
   場合は `--derives-from` を使います。作成スクリプトは
   `assets/templates/test-spec.md` を使います。実行できない場合は template を
   コピーして手動で記入してください。
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

- `scripts/new_test_spec.js`: test spec を作成し index を更新します。
- `references/test-spec-conventions.ja.md`: test spec の directory、filename、
  status、relations、必須コンテンツ、index の規約。
- `assets/templates/test-spec.ja.md`: デフォルトの test spec 本文 template。
