# 検証設計規約

本規約は Document Registry 3 の下で `verification-doc` が
`docs/verification/` 配下の永続的な検証設計ドキュメントを
作成・監査・インデックス化する方法を定義します。

検証設計ドキュメントは検証の*意図*を記録します: 何を検証するか、
どのクレームを守るのか、どの方法で検証するか、なぜその検証が存在
するのか。従来の `test-spec` 形式を置き換えます (Registry 3 では
マイグレーション専用)。

## ディレクトリ

正規ディレクトリは `docs/verification/` です。エイリアスディレクトリは
宣言されていません —— 単一の正規スペルがルーティングと所有権を
明確に保ちます。

## ファイル名

`new_verification.js` は `--title` から `<slugified-title>.md` を生成
するか、明示的な `--name` を使います。ファイル名は
lower-kebab-case です。

## フロントマター

```yaml
---
id: "VD-<22-char base62>"
type: "verification"
status: "draft"
lifecycle: "draft"
title: "…"
created: "YYYY-MM-DD"
updated: "YYYY-MM-DD"
checks:
  - id: "CHK-01"
    target: "SPEC-<id>::R-01"
    method: "unit"
    implementation: "…"
    preconditions: []
    passCriteria:
      kind: "unit"
      expect: "…"
    limitations: []
    required: true
checkHighWater: 1
owners: []
relations:
  source: []
  supersedes: []
---
```

### 必須フィールド

- `id` — `VD-` プレフィックスと共通の 22 文字 Base62 アーティファクト ID。
- `type` — 常に `verification`。

### ステータスとライフサイクル

`status` は型固有のワークフロー状態、`lifecycle` はレジストリの永続性
軸です (`draft` → `current` → `superseded`/`retired`)。新規ドキュメント
は `lifecycle: "draft"` が既定です。不明なライフサイクル値は無効で、
`current` に矯正されることはありません。

| ステータス | 意味 |
| --- | --- |
| `draft` | 検証意図を記録中。 |
| `proposed` | 設計記述済み。レビュー待ち。 |
| `approved` | レビュー済み。検証契約として受理。 |
| `deprecated` | 検証が不要になった (確定)。 |
| `superseded` | 新しい検証設計に置き換えられた (確定)。 |

## Check 契約 (`checks:`)

フロントマターの `checks:` 配列が Check→Claim の唯一の権威です。
各エントリは `VerificationCheckV1` で、8 つのフィールドすべてが必須
です:

| フィールド | 契約 |
| --- | --- |
| `id` | `CHK-<digits>` —— 文書内で安定かつ一意。修飾チェック参照 `VD-<id>::CHK-NN` はタスクの `checks` エントリや Evidence Record が参照するものです。 |
| `target` | 修飾クレーム参照 `<document-id>::<KEY>` (例: `SPEC-<id>::R-01`)。クレームは存在必須 —— 不明なクレーム ID は検出項目であり、writer は拒否します。 |
| `method` | `unit`、`integration`、`e2e`、`property`、`static`、`model-checking`、`formal-proof`、`runtime-monitoring`、`manual-review` のいずれか。 |
| `implementation` | チェックの実現方法 —— テスト名、証明スクリプト、モニター、レビュー手順。 |
| `preconditions` | チェックが適用される条件。`required: true` のチェックは少なくとも 1 件宣言必須。 |
| `passCriteria` | 型付き判別和 `{ kind: <method>, <criterion>: "…" }`。`kind` は `method` と一致必須。 |
| `limitations` | チェックの既知の限界。空でよいが存在必須。 |
| `required` | `true` は Evidence Assessment の必須ゲート、`false` は参考的。 |

`passCriteria` はメソッド型付き —— `kind` が判別子で `method` と一致
必須なので、あるメソッドのクライテリアペイロードが別メソッドとして
読まれることはありません。各メソッドは 1 つの必須クライテリア
フィールドを持ちます:

| メソッド | 必須 `passCriteria` フィールド |
| --- | --- |
| `unit` | `expect` |
| `integration` | `expect` |
| `e2e` | `expect` |
| `property` | `invariant` |
| `static` | `rule` |
| `model-checking` | `property` |
| `formal-proof` | `theorem` |
| `runtime-monitoring` | `signal` |
| `manual-review` | `checklistItem` |

`checks:` の兄弟フィールドとして `checkHighWater` があります ——
ドキュメントで宣言・割り当てられたことのある最大の `CHK-<digits>`
序数です。スクリプトがチェック集合の変更ごとに書き込み、削除された
チェック ID が二度と再発行されないようにする永続的なハイウォーター
マークとして機能します (`--remove-check` は id を解放しないため、
末尾削除後の追加は新しい `CHK-NN` を採番します)。スクリプト管理の
フィールドとして扱ってください —— 手動で小さく書き換えると id の
再発行を再び許してしまいます。

`<!-- check:CHK-NN -->` 形式 (あるいは自己修飾の
`<!-- check:VD-<id>::CHK-NN -->`) の本文アンカーは、チェックの id を
その散文の説明に結び付けます —— 任意ですが、存在する場合はフロント
マターが宣言したチェックを指さなければなりません。検証ドキュメント
外のアンカーは無効です。

lint (`doc_status lint --type verification`) が報告する項目:
不正な `checks` データ、フィールド欠落、無効・重複チェック ID、
無効な target やメソッド、`passCriteria`/`method` の矛盾、
preconditions のない required チェック、不明なクレーム ID、
無効・重複・誤配置・未解決の本文アンカー。

## リレーション

- `relations.source` — この検証設計の動機となったドキュメント、
  Issue、エビデンス。
- `relations.supersedes` — このドキュメントが置き換える検証設計
  ドキュメント。

Check→Claim リレーション (`checks` / `checked-by`) は
`checks[].target` から*導出*されます —— Knowledge Graph が射影する
ため、`relations` には格納されません。Evidence の `supported-by`
リンクは Evidence Store から来るため、ここにも格納されません。

## 再利用と更新

クレームをカバーする既存設計は複製せず、その場で更新します:

```bash
node scripts/resolve_verification.js --for-claim SPEC-<id>::R-01
node scripts/update_verification.js --doc VD-<id> --check '<json>'
```

`--check` はチェック id で upsert し (id を省略したペイロードには
次の `CHK-NN` が割り当てられます)、`--remove-check CHK-NN` は削除、
`--title`/`--status`/`--lifecycle`/`--from`/`--supersedes` はフィールド
を更新します。編集はチェック id を維持します —— 変わるのは
チェックの設計リビジョンのみです。

## インデックス

`docs/verification/README.md` は生成される派生インデックス
(`<!-- doc-suite:generated-index -->`) です。テーブルを手動保守せず、
明示的に実体化します:

```bash
node ../doc-maintenance/scripts/doc_maintenance.js index plan
node ../doc-maintenance/scripts/doc_maintenance.js index apply
```
