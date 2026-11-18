# Evidence Store コントラクト v1

Evidence Store（Issue `#240`）は **Evidence Record** —— Verification
Check の測定結果 —— を不変・Git 管理外のレコードとして保持します。
Evidence は検証の「結果」データです。run の状態（Execution Store）
でもなく、永続的知識（Markdown）でもありません。Effect Receipt は
effect が「実行された」ことの証拠であり、Evidence Record は check が
「何を結論づけたか」の記録です —— 名称・型・生成経路・判断は別のもの
です。

ランタイム: `scripts/evidence_store.js`（正本ソースは
`src/skills/lib/evidence_store/`）。全サブコマンドは他の通常エントリ
ポイントと同様に、共有 schema preflight を最初に実行します。

## レイアウト

```text
<checkout>/.apm/state/doc-driven-dev/      state root（Git 管理外）
├── runs/<run-id>/                         Execution Store（run ごとの状態）
└── evidence/                              Evidence Store ルート
    ├── manifest.json                      書き込み一度限りの store manifest
    ├── index.json                         派生の集約インデックス（再生成可能）
    └── records/<evidence-id>.json         ファイル 1 つにつき不変レコード 1 件
```

Execution Store と同じ state root・境界ルール（gitignore カバレッジ・
封じ込め・tracked-state プローブ）・worktree ごとの既定を共有します。
ある worktree のレコードは、共有 `stateRoot` を明示的に宣言しない限り
他環境からは見えません。

## レコードスキーマ（`records/<id>.json`、schemaVersion 1）

| フィールド | 意味 |
| --- | --- |
| `evidenceId` | 一意のレコード id（`EVID-<22文字 base62>` または呼び出し側 id）。ファイル名にもなる |
| `claim.ref` | 修飾 claim 参照 `<document-id>::<KEY>`（例: `SPEC-<id>::R-01`） |
| `claim.documentRevision` | 測定時点での claim ドキュメントの `sha256:<hex>` ダイジェスト |
| `check.ref` | 修飾 check 参照 `VD-<id>::CHK-NN` |
| `check.designRevision` | 測定時点での check 正規ペイロードの `sha256:<hex>` |
| `subject` | `{ kind: "commit", commit }` または `{ kind: "workspace", snapshotDigest }` —— 結果の測定対象。`snapshotDigest` は正規サブジェクトダイジェスト（後述） |
| `method` | 使用した検証メソッド（`unit`・`integration`・`e2e`・`property`・`static`・`model-checking`・`formal-proof`・`runtime-monitoring`・`manual-review`） |
| `provider` | `{ kind: repository\|ci\|external, name }` —— 結果を生成したアダプタ |
| `runId` | 生成元の Execution Store run、または `null` —— コンテキストのみで run の状態ではない |
| `environment` | runner/os/ツールチェーンの自由記述 —— JSON ラウンドトリップ後の形で記録。シリアライズ不能な値（循環・BigInt・関数）は `invalid-argument` で拒否 |
| `outcome` | `passed`・`failed`・`inconclusive`・`error`・`not-run` |
| `retention` | `transient`・`release`・`durable` —— 保存ポリシー（後述） |
| `artifacts` | 記録された artifact 参照（後述） |
| `derivedFrom` | 他レコードから昇格した場合の元 evidence id、それ以外は `null` —— `promote` のみが書き込み、intake での指定は拒否 |
| `createdAt` | ISO-8601 の作成タイムスタンプ |

レコードからは常に逆引きできます。測定した claim/check、それらを測定
した時点のピン留め revision（`resolve <id>` が `currentRevision` と
ピンの比較を報告）、対象の commit または workspace ダイジェストです。

### Artifact

`{ uri, sha256, availability, retention, expiresAt }`。

- `uri` は書き込み時に正規化されます —— スキームの小文字化、`file:`
  パスの字句解決、スキーム無しのパスは repo 相対 POSIX として扱います。
  危険なスキーム（`javascript:`・`data:`・`vbscript:`）、絶対パスや
  脱出パス、空白を含む参照は `invalid-argument` で拒否されます。
- `sha256` は検証済みの内容ダイジェスト（`sha256:<hex>`）。`availability`
  が `available` のときのみ必須です —— ダイジェストのない
  `available` 主張は拒否されるため、未取得の参照が検証済み内容を
  装うことはできません。
- `availability`: `available`（取得済み・ダイジェスト検証済み）、
  `unverified`（参照のみ記録・未取得 —— ダイジェスト未指定時の既定）、
  `unavailable`（確認済みでアクセス不能）。`unverified` と
  `unavailable` の参照が `passed` の裏付けになることはありません。
- `retention` は既定でレコードのクラスを継承します。`expiresAt` は
  artifact の保持期限、または `null` です。

### 保存ポリシー（retention クラス）

- `transient` —— run に紐づく作業用エビデンス。run と共に破棄してよい。
- `release` —— リリース判断の根拠となるエビデンス。置き換わるまで保持。
- `durable` —— 長期のプロジェクトエビデンス。無期限に保持。

Retention はレコードごとです（artifact は独自の期限を持てます）。
書き込み一度限りの `manifest.json` が store の所在と retention 語彙を
記録するため、消費者は Git 管理外レコードの場所を突き止め、適切な
保持処理を適用できます。

## 一貫性モデル

- **不変。** `putImmutable` は書き込み tmp + ハードリンク作成で
  レコードをコミットします —— リンクがアトミックな作成なので、
  読み手が見るのは常に完全なファイルであり、競合する 2 つの書き手の
  うち正確に 1 つだけが勝ちます。**更新も削除も、どの層にも経路は
  ありません。**
- **冪等な再 put。** 同一 id・同一内容（`createdAt` を除く）の put は
  `duplicate: true` を返す no-op です。同一 id・異なる内容は
  `record-conflict` です。
- **追記経路に共有ファイル書き込みはありません。** 並列 put は各自の
  `records/<id>.json` にのみ触れるため、同時追記が共有ファイルの
  競合点を生むことはありません。
- **派生インデックス。** `index.json` は `reindex` でレコード
  ディレクトリから決定的に再構築されます（`recordCount`・outcome /
  retention / subject 別カウント、check/claim/run → evidence-id
  リスト、`generatedAt` は最新レコードのスタンプに固定）。同じ
  レコードからは同じバイト列 —— いつでも削除して再生成できます。
  クエリはレコードを直接走査し、インデックスを参照しません。
- **クラッシュリカバリ。** `*.tmp-*` の残りはクラッシュの証拠であり
  内容ではありません。`recover` が除去します。`evidenceId` が
  ファイル名と一致しないレコードは `corrupt-state` です。

## サブジェクトダイジェストと昇格

**サブジェクトダイジェスト**は check が測定した内容を指し示します。
両方のサブジェクト種別が同一の正規アルゴリズムを共有するため、
どちら側のアダプタも比較可能な値を計算できます。

```text
subjectDigest = "sha256:" + sha256("doc-driven-dev:subject-tree:v1:" + <git tree oid hex>)
```

Git の tree オブジェクト id はリポジトリ自身の内容同一性です ——
追跡される全パス・エントリモード・blob 内容を再帰的にカバーします。
名前空間付きの sha256 ラッパーは、リポジトリのオブジェクト形式
（sha1 / sha256 の tree）をレコード固定のダイジェスト形に正規化し
ます。

- `treeDigestOf(cwd, commit)` は commit 側を計算します。git を通じて
  `<commit>^{commit}^{tree}` を解決するため、ダイジェストは**存在が
  証明されたオブジェクトから計算**され、呼び出し側の主張ではありま
  せん。commit が解決できなければ `null` を返します。
- `workspaceDigestOf(treeOid)` は workspace 側を計算します。測定
  アダプタは検証対象の workspace を git tree oid にスナップショット
  します —— 規定の手順は一時インデックス（`GIT_INDEX_FILE=<tmp>`）
  に測定ツリーを取り込んで `git write-tree` —— し、返された
  ダイジェストを `subject.snapshotDigest` として記録します。

### workspace → commit 昇格

workspace の結果が commit のエビデンスとして**黙って扱われることは
ありません。** 昇格の経路は `promote <id> --commit <sha>` のみです。
ストアは commit の tree を git で解決し —— 存在しなければならない
オブジェクト —— 正規ダイジェストを計算して、レコードの
`snapshotDigest` との一致を要求します。これが内容同一性チェックで
す。比較の両側が同一アルゴリズムで計算され、commit 側はオブジェクト
データベースに対して検証されます。ダイジェスト不一致は
`subject-mismatch`、解決できない commit は `invalid-argument` で
拒否され、commit 対象のレコードは昇格できません。昇格は
`derivedFrom` を持つ**新しい**不変レコードを書き込みます —— 元の
workspace エビデンスは変更されません。

**信頼境界を明確に述べます。** ストアは *commit* 側をオブジェクト
データベースで検証し、両ダイジェストが同一の正規アルゴリズムで計算
されたことを確認します。しかし測定時の workspace を再観測することは
できないため、`snapshotDigest` はアダプタの証明（attestation）の
ままです —— 昇格が証明するのは「記録された証明と commit が同一の
内容を指す」ことであって、「証明が正直だった」ことではありません。
その保証が必要な呼び出し側は、測定アダプタを信頼する（あるいは帯域
外でゲートする）必要があります。

## 境界 —— 書き込み前に拒否

Execution Store と同じゲートです。`/.apm/state/` の ignore カバレッジ
が設定済みであること、state root 配下に Git 追跡ファイルが存在しない
こと、evidence ルートと records ディレクトリが解決済みルート内に
realpath されること —— ルート外に落ちる `evidence/` シンボリンクは
`boundary-escape` です。レコード id は共有のファイルシステム安全
パターンに一致するため、id がパス脱出になることはありません。

**大文字小文字を区別しないファイルシステム**（既定の macOS/Windows）
では、大文字小文字だけが異なる id もディスク上では衝突します。
`EVID-A.json` と `EVID-a.json` は同一ファイルです。ストアが両者を
統合することはありません —— 同名への書き込みは通常の追記一度限り
の衝突（内容が異なれば `record-conflict`）であり、ファイル名と
`evidenceId` が一致しない格納ファイルは `corrupt-state` です。
失敗はサイレントではなく fail-closed です。呼び出し側は大文字小文字
の違いで id を区別してはいけません。

## CLI

```bash
node .apm/skills/doc-driven-dev-graph/scripts/evidence_store.js <command> \
  --cwd <repo> [--state-root <path>] [--allow-external-root] [--json]
```

- `put --file <evidence.json> [--resolve]` —— レコードを保存。
  `--resolve` は `claim.documentRevision`/`check.designRevision` を
  稼働中の Knowledge Graph からピン留めします（どちらかの参照が解決
  できなければ put は中断され、check はレコードの claim を対象に
  していなければなりません）。
- `get <id>` / `query [--check|--claim|--outcome|--retention|
  --subject-kind|--run-id]` / `manifest`
- `resolve <id>` —— レコードの逆引き: 参照の状態 + claim/check ごとの
  `matchesPinned`、さらに `checkTargetsClaim` —— 解決された check
  の `target` がレコードの `claim.ref` と一致するか。
- `promote <id> --commit <sha> [--as <new-id>]` —— ストア自身が
  commit の tree を解決してダイジェストを計算します。コマンド
  ラインでダイジェストは受け取りません。
- `reindex` —— `index.json` を再生成。`recover` —— tmp の残りを除去。

エラーは `{ "error": <code>, "message": ..., "detail": ... }` を終了
コード 1 で出力します。preflight ゲートは終了コード 2 です。コード:
`boundary-gitignore`・`boundary-git-unavailable`・`boundary-tracked`・
`boundary-escape`・`external-root-not-authorized`・`record-conflict`・
`evidence-not-found`・`subject-mismatch`・`corrupt-state`・
`state-unwritable`・`unsupported-version`・`invalid-argument`。

## ライブラリ API

`putImmutable / getById / query / buildIndex / rebuildIndex / promoteToCommit /
loadManifest / recoverEvidence / documentRevisionOf /
workspaceDigestOf / treeDigestOf` に加え、
`resolveEvidence / resolveEvidenceIn`（逆引き —— Evidence Assessment
`#241` が消費するインターフェース）を
`src/skills/lib/evidence_store` から提供します。
