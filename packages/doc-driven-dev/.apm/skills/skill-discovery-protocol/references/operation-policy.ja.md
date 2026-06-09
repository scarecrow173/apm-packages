# Skill Discovery Protocol - 運用ポリシー

Version: 1.0.0

この文書は SDP アーティファクトの作成・更新・検証に関するルールと制約を定義する。
生成済みアーティファクトの手編集は禁止される。

CLI 利用、adapter スキーマ、解決セマンティクスについては `cli-reference.ja.md` を参照。

---

## 1. スクリプト専用運用ルール

**すべてのアーティファクト操作は `sdp` CLI を通さなければならない。**

### 1.1 禁止事項

- JSON アーティファクト（`*-catalog.json`, `*-profile.json`, `validation-report.json`, `resolved-invocations.json`）の手編集
- 生成された Markdown アーティファクト（`sdp profile` が生成する `.md` sidecar）の手編集
- `sdp` を経由しない外部スクリプトによるアーティファクト内容の変更

### 1.2 手動編集が許されるファイル

以下は **configuration** であり、生成物ではないため手動編集できる:

- Adapter YAML ファイル（`skill-discovery-protocol/assets/adapters/*.yaml`、フロー固有 `references/*.yaml`）
- `SKILL.md` / `SKILL.ja.md`（skill 定義文書）
- `protocol-contract.md` やその他の参照ドキュメント
- ソーススクリプト（`src/skills/**/scripts/*.ts`）

### 1.3 例外条件

手動の artifact 編集が許されるのは次の場合だけ:

1. `sdp` CLI が壊れていて生成できないとき（緊急復旧）
2. 編集直後に `sdp validate` を実行して適合性を確認すること
3. commit message に `# MANUAL_EDIT: <reason>` を付けること

---

## 2. スクリプト責務の分離

CLI は 3 つの責務ドメインに分かれる:

| Command | Responsibility | Verb |
| ------- | -------------- | ---- |
| `sdp scan` | scan artifact を作成・更新する | Write |
| `sdp infer` | agent-authored inference artifact を初期化・スキーマチェック・更新する | Write |
| `sdp profile` | catalog/profile artifact を作成・更新する | Write |
| `sdp validate` | artifact の正しさを検証する | Read + Check |
| `sdp query` | artifact から情報を取り出す | Read |

### 2.1 Generate Scripts

- 成功時は `0`、入力エラー時は `1`、スキーマエラー時は `2` を返す
- `validate_outputs`（protocol-contract step 8）は生成後に自動実行されない。
  これを別コマンド `sdp validate` に分離することで、CI/CD のオーケストレーションを独立させる。

### 2.2 Validate Scripts

- すべての gate が通れば `0`
- いずれかの gate が失敗すれば `1`
- 入力エラーは `2`

### 2.3 Query Scripts

- 読み取り専用。決してファイルを変更しない
- 成功時は `0`（空結果は空配列）
- 入力エラーは `1`
- 未知の subcommand は `2`

### 2.4 Inference 編集ルール

agent は inference 編集に `sdp infer` subcommand を使わなければならない。意図した loop は次の通り:

1. `sdp infer init` が scan 結果から baseline entry を作成または統合する
2. agent が scanned skill body を確認し、skill ごとの inference spec または JSONL 操作を作る
3. `sdp infer set-skill` または `sdp infer apply` が決定を記録する
4. `sdp profile` の前に `sdp infer check` で artifact を確認する

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

これは `tsx scripts/build-skill-scripts.ts` を呼び出し、`src/skills/**/scripts/`
配下のすべての TypeScript ソースを対応する `.apm/skills/**/scripts/` 出力先へ
esbuild でコンパイルする。

### 3.3 不変条件

- 出力 `.js` ファイルは repository にコミットされる（agent が使う配布形態だから）
- `.ts` ソースが single source of truth である
- `.ts` を変更したら必ず `pnpm run build:scripts` を実行する
- ビルドは deterministic でなければならない（同じソース → 同じバイト列）

---

## 4. 命名規約

### 4.1 `snake_case` 要件

以下の識別子は `snake_case` を使わなければならない:

- `flow_stack.slots[]` の `slot_id`
- `provides[]` と `uses[]` の `capability` 値
- `invocation_resolution.overrides.slots` の override key
- `invocation_resolution.overrides.capabilities` の override key
- `classification` の `taxonomy[].id`
- `taxonomy[].match.capabilities[]` の値

### 4.2 強制

`^[a-z][a-z0-9]*(_[a-z0-9]+)*$` に一致しない識別子は **schema error** であり、
Gate 1 (Schema Validation) を失敗させる。

### 4.3 理由

- すべての adapter と artifact にわたる一貫性
- 曖昧さのない machine-readable 形式
- YAML key と JSON field 名に適合する

---

## 5. `extends` 解決ルール

### 5.1 参照名の解決

`extends` の値は参照名であり、file path ではない。

解決アルゴリズム:

```text
searchDirs = adapter file directory から現在の skill tree 内を上に走査し、
             各祖先の "assets/adapters/" が存在すれば収集し、
             その後に bundled な "skill-discovery-protocol/assets/adapters/" を追加する

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

legacy の `.apm/assets/adapters/` copy は `extends` 解決の対象ではない。

### 5.2 Merge セマンティクス

- 宣言順: `extends: [a, b]` は `a` を先に解決し、その後 `b`
- マージ方向: 最上位の親 → ... → 直下の親 → child adapter
- object field: 再帰的にマージ（衝突時は child 優先）
- scalar field: last writer wins
- array field: child が完全に置き換える（append しない）

### 5.3 制約

- 直接 path を書くことは禁止（例: `extends: ["./my-adapter.yaml"]`）
- `priority` key はどこでも禁止（存在したら schema error）
- circular reference は schema error
- nested extends は許可（root まで再帰的に解決）
- schema validation は最終的な merged result に対して行う
