# Skill Discovery Protocol — 運用規約

Version: 1.0.0

本文書は SDP 成果物の作成・更新・検証に関するルールと制約を定義する。
生成された成果物への手動編集は禁止される。

CLI 使用法、Adapter スキーマ、解決セマンティクスについては `cli-reference.ja.md` を参照。

---

## 1. スクリプト駆動操作ルール

**すべての成果物操作は `sdp` CLI を経由しなければならない。**

### 1.1 禁止操作

- JSON 成果物の手動編集（`*-catalog.json`、`*-profile.json`、
  `validation-report.json`、`resolved-invocations.json`）
- 派生 Markdown 成果物の手動編集（`sdp profile` で生成される `.md` サイドカー）
- `sdp` を迂回する外部スクリプトによる成果物内容の変更

### 1.2 手動編集が許可されるファイル

以下のファイルは**設定**であり、生成出力ではないため手動編集が可能:

- Adapter YAML ファイル（`assets/adapters/*.yaml`、フロー固有 `references/*.yaml`）
- `SKILL.md` / `SKILL.ja.md`（スキル定義文書）
- `protocol-contract.md` 等のリファレンス文書
- ソーススクリプト（`src/skills/**/scripts/*.ts`）

### 1.3 例外条件

手動での成果物編集は以下の場合のみ許可される:

1. `sdp` CLI が壊れており出力を生成できない場合（緊急復旧）
2. 編集直後に `sdp validate` を実行し適合性を確認する場合
3. コミットメッセージに `# MANUAL_EDIT: <理由>` を記載する場合

---

## 2. スクリプト責務分離

CLI は 3 つの責務ドメインに分離される:

| コマンド | 責務 | 動詞 |
| -------- | ---- | ---- |
| `sdp scan` | scan 成果物の生成・更新 | Write |
| `sdp infer` | agent-authored inference 成果物の初期化・schema check・更新 | Write |
| `sdp profile` | catalog/profile 成果物の生成・更新 | Write |
| `sdp validate` | 成果物の正当性検証 | Read + Check |
| `sdp query` | 成果物からの情報抽出 | Read |

### 2.1 Generate スクリプト

- 成功時は終了コード `0`、入力エラー時は `1`、スキーマエラー時は `2`
- **注:** `validate_outputs`（protocol-contract ステップ 8）は生成後に自動実行されない。
  バリデーションは独立した別コマンド（`sdp validate`）として実行し、
  CI/CD パイプラインで個別にオーケストレーションする設計。

### 2.2 Validate スクリプト

- 全ゲート通過時は終了コード `0`、いずれか失敗時は `1`、入力エラー時は `2`

### 2.3 Query スクリプト

- 純粋な読み取り専用操作（ファイルを変更しない）
- 成功時は終了コード `0`（結果なし = 空配列）、入力エラー時は `1`、
  未知サブコマンド時は `2`

### 2.4 Inference 編集ルール

agent は inference 編集に `sdp infer` subcommands を使わなければならない。
意図する loop は次のとおり。

1. `sdp infer init` で scan 結果から baseline entries を作成または merge する。
2. agent が scan された skill body を読み、skill ごとの inference spec または JSONL operations を用意する。
3. `sdp infer set-skill` または `sdp infer apply` で判断結果を記録する。
4. `sdp profile` の前に `sdp infer check` で artifact を検証する。

---

## 3. ビルドパイプライン

### 3.1 ソースから出力へのパス

```text
src/skills/skill-discovery-protocol/scripts/*.ts
  → esbuild (bundled, ESM)
  → .apm/skills/skill-discovery-protocol/scripts/*.js
```

### 3.2 ビルドコマンド

```bash
pnpm run build:scripts
```

これは `tsx scripts/build-skill-scripts.ts` を呼び出し、esbuild を使って
`src/skills/**/scripts/` 配下の全 TypeScript ソースを対応する
`.apm/skills/**/scripts/` 出力先にコンパイルする。

### 3.3 不変条件

- 出力 `.js` ファイルはリポジトリにコミットされる（エージェントが消費する配布形式）
- ソース `.ts` ファイルが唯一の信頼できるソース
- `.ts` への変更後は必ず `pnpm run build:scripts` を実行する
- ビルドは決定論的でなければならない（同一ソース → 同一出力バイト列）

---

## 4. 命名規約

### 4.1 `snake_case` 要件

以下の識別子は `snake_case` を使用しなければならない:

- `flow_stack.slots[]` の `slot_id`
- `provides[]` および `uses[]` の `capability` 値
- `invocation_resolution.overrides.slots` のオーバーライドキー
- `invocation_resolution.overrides.capabilities` のオーバーライドキー
- `classification` の `taxonomy[].id`
- `taxonomy[].match.capabilities[]` の値

### 4.2 強制方法

パターン `^[a-z][a-z0-9]*(_[a-z0-9]+)*$` に一致しない識別子は
**スキーマエラー**であり、Gate 1（Schema Validation）を失敗させる。

### 4.3 根拠

- すべての adapter と成果物間の一貫性
- 曖昧さなく機械読取可能（大文字小文字の折りたたみ問題なし）
- YAML キーおよび JSON フィールド名との互換性

---

## 5. `extends` 解決ルール

### 5.1 参照名解決

`extends` の値は参照名であり、ファイルパスではない。

解決アルゴリズム:

```text
searchDirs = adapter ファイルのディレクトリから上方に走査し、
             各祖先の "assets/adapters/" が存在すれば収集、
             最後に adapter 自身のディレクトリをフォールバックとして追加

for name in extends:
  for dir in searchDirs:
    candidates = [
      "{dir}/{name}.yaml",
      "{dir}/{name}.yml"
    ]
    if both exist in same dir → schema error
    if one exists → resolved, stop searching
  if not found in any dir → schema error
```

### 5.2 マージセマンティクス

- 宣言順: `extends: [a, b]` → まず `a` を解決、次に `b`
- マージ方向: 最上位の親 → ... → 直接の親 → 子 adapter
- オブジェクトフィールド: 再帰マージ（子が勝つ）
- スカラーフィールド: 後勝ち上書き
- 配列フィールド: 子が完全に置換（追記なし）

### 5.3 制約

- パス直書きは禁止（例: `extends: ["./my-adapter.yaml"]`）
- `priority` キーはどこでも禁止（存在すればスキーマエラー）
- 循環参照はスキーマエラー
- ネストされた extends は許可（ルートまで再帰解決）
- スキーマ検証は最終マージ結果に対して実行
