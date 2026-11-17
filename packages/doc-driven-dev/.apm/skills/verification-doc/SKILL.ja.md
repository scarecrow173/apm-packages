---
name: verification-doc
description: 検証意図 —— 何を、どのクレームに対して、どの方法で検証するか —— を docs/verification/ の永続的な検証設計ドキュメントとして記録する場合に使用する。checks[] 契約はクレーム ID を対象とする。従来の test-spec 形式を置き換える。
license: MIT
---

# Verification Design Documentation Skill

このスキルは `docs/verification/` 配下の永続的な検証設計ドキュメントを作成・
保守します。検証設計ドキュメントは検証の*意図*を記録します: 何を検証するか、
どのクレームを守るのか、どの方法で検証するか、なぜその検証が存在するのか。

検証設計ドキュメントは Document Registry 3 で **durable** です ——
マイグレーション専用アーティファクトとなった旧 `test-spec` 形式を置き換えます。
実行可能なコマンドは引き続きタスクの `## Verification` セクションに、
実行結果は Evidence Store に属します。

**Check 契約 (Verification Design v1):** フロントマターの `checks:` 配列が
Check→Claim の唯一の権威です。各エントリは `VerificationCheckV1` です:

```yaml
checks:
  - id: CHK-01                      # 安定かつ文書内一意
    target: SPEC-<id>::R-01         # 修飾クレーム参照 —— 唯一のリンク
    method: unit                    # unit | integration | e2e | property |
                                    # static | model-checking | formal-proof |
                                    # runtime-monitoring | manual-review
    implementation: cart.test.ts::total_sums_lines
    preconditions: [cart has at least one line]
    passCriteria:
      kind: unit                    # `method` と一致必須
      expect: total equals the sum of line subtotals
    limitations: [rounding beyond 2dp out of scope]
    required: true                  # required な検証項目は preconditions を宣言する
```

チェック ID (`CHK-<digits>`) は編集をまたいで安定かつ文書内一意で、
修飾チェック参照は `VD-<id>::CHK-NN` です —— タスクの `checks` エントリや
Evidence Record が参照するものです。`passCriteria.kind` は `method` と一致
しなければならない型付き識別子であり、メソッドごとに固有のクライテリア
フィールドを持つため、単一の真偽値が異なる検証方法を潰すことはありません。
`<!-- check:CHK-NN -->` 形式の本文アンカーは、チェックの id をその散文の
説明に結び付ける任意の仕組みです。

## ワークフロー

1. 作成前に再利用を確認します。検証したいクレームのカバレッジを解決します:

   ```bash
   node scripts/resolve_verification.js --for-claim SPEC-<id>::R-01
   ```

   `docs/verification/` と関連する spec/design も確認します。既存の設計が
   意図をカバーする場合は **新規文書を作成せず更新してください**。
   `relations.supersedes` で置き換えるのは、実際に置き換わる場合のみです。
2. 既存の設計を更新します。

   ```bash
   node scripts/update_verification.js --doc VD-<id> \
     --check '{"target":"SPEC-<id>::R-01","method":"unit",...}' \
     --status proposed
   ```

   `--check` はチェック id で upsert します (id を省略したペイロードには
   次の `CHK-NN` が割り当てられます)。`--remove-check CHK-NN` はチェックを
   削除します。`--title`、`--status`、`--lifecycle`、`--from`、
   `--supersedes` はドキュメントのフィールドをその場で更新します ——
   チェック ID が振り直されることはありません。

   **必須**: 書き込みの前に `references/verification-conventions.md` を
   読み込んでください —— Check スキーマ全体、メソッドごとのクライテリア
   フィールド、ファイル名規約、ステータス値を定義しています。
3. 再利用できるものがない場合のみ、新しい設計を作成します。

   ```bash
   node scripts/new_verification.js --title "Checkout total calculation" \
     --from docs/specs/checkout-flow.md \
     --check '{"target":"SPEC-<id>::R-01","method":"unit",...}'
   ```

   `--check` は繰り返し指定できます。各ペイロードは Check スキーマ全体で
   検証され、`target` は生きたクレームに解決されなければなりません ——
   不明なクレーム ID は書き込みを拒否します。スクリプトを実行できない場合は
   `assets/templates/verification.md` をコピーして手動で記入します。
4. 設計を lint します。
   `doc_status lint --type verification` はチェックの問題を報告します:
   重複または不正なチェック ID、宣言されたクレームに解決されない target、
   `method` と矛盾する `passCriteria.kind`、preconditions のない required
   チェック、宣言されたチェックを指さない本文アンカー。
5. ステータスを最新に保ちます。
   `draft` は意図の記録中、`proposed` は記述済み、`approved` はレビュー済み、
   `deprecated` は検証が不要になった、`superseded` は新しい設計に置き換えられた
   ことを示します。

## フロントマター

```yaml
---
id: "VD-<22-char base62>"
type: "verification"
status: "draft"
lifecycle: "draft"
title: "Checkout total calculation"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
checks: []            # VerificationCheckV1 エントリ —— Check 契約
owners: []
relations:
  source: []
  supersedes: []
---
```

ステータス値: `draft`、`proposed`、`approved`、`deprecated`、`superseded`。
`deprecated` と `superseded` は確定状態で、インデックスの `## Settled` 層に
振り分けられます。

## 禁止事項

- `test-spec` ドキュメントを作成しない —— Registry 3 では `test-spec` は
  レガシーのマイグレーション専用型であり、`new_test_spec.js` はレジストリ
  境界で拒否し、preflight はレガシーファイルをマイグレーションへ振り分けます
- 合否の結果をこのドキュメントに記録しない —— 実行結果は揮発性の
  エビデンスであり、永続的な検証意図ではありません
- Check→Claim リンクを `relations` に複写しない —— `checks[].target` が
  唯一の権威であり、グラフは `checks`/`checked-by` エッジを導出します。
  手管理されたコピーは定義上不正です
- 既存の検証設計がクレームをカバーするのに新しい検証設計を作成しない ——
  `resolve_verification.js --for-claim` で再利用・更新してください
- チェック ID を振り直したり書き換えたりしない —— `CHK-NN` キーは安定です。
  編集は id を維持し、チェックの設計リビジョンのみを変更します
- `docs/verification/README.md` を正規データとして扱わない —— インデックスは
  `doc_maintenance.js index plan|apply` で実体化される派生ビューです

## リソース

- `scripts/new_verification.js`: 検証設計ドキュメントを作成します ——
  `--check '<json>'` はスキーマ検証済みチェックを追加します
  (インデックスの実体化は明示的です: `doc_maintenance.js index plan|apply`)。
- `scripts/update_verification.js`: 既存設計のフィールドとチェックをその場で
  更新します —— `--check` は id で upsert、`--remove-check` は削除します。
- `scripts/resolve_verification.js`: 読み取り専用の解決 —— `--for-claim` は
  再利用優先のカバレッジ検索、`--doc` は設計のチェック一覧、`--ref` は
  タスクの `checks` エントリや Evidence Record が使う
  `VD-<id>::CHK-NN` チェック参照境界です。
- `references/verification-conventions.md`: ディレクトリ、ファイル名、
  ステータス、リレーション、Check スキーマ全体 ——
  **作成・更新操作の前に必ず読み込むこと**
- `assets/templates/verification.md`: 既定の検証設計本文テンプレート ——
  `new_verification.js` が自動で読み込むため**手動で読み込まないこと**
