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
| `subject` | `{ kind: "commit", commit }` または `{ kind: "workspace", snapshotDigest }` —— 結果の測定対象 |
| `method` | 使用した検証メソッド（`unit`・`integration`・`e2e`・`property`・`static`・`model-checking`・`formal-proof`・`runtime-monitoring`・`manual-review`） |
| `provider` | `{ kind: repository\|ci\|external, name }` —— 結果を生成したアダプタ |
| `runId` | 生成元の Execution Store run、または `null` —— コンテキストのみで run の状態ではない |
| `environment` | runner/os/ツールチェーンの自由記述（そのまま記録） |
| `outcome` | `passed`・`failed`・`inconclusive`・`error`・`not-run` |
| `retention` | `transient`・`release`・`durable` —— 保存ポリシー（後述） |
| `artifacts` | 記録された artifact 参照（後述） |
| `derivedFrom` | 他レコードから昇格した場合の元 evidence id、それ以外は `null` |
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

## workspace → commit 昇格

workspace の結果が commit のエビデンスとして**黙って扱われることは
ありません。** 昇格の経路は `promote <id> --commit <sha>
--tree-digest <hex>` のみです。commit の tree ダイジェストが
workspace の `snapshotDigest` と一致する必要があります —— 2 つの
対象が同一バイトであることの内容同一性の証明です。ダイジェスト不一致
は `subject-mismatch` で拒否され、commit 対象のレコードは昇格できま
せん。昇格は `derivedFrom` を持つ**新しい**不変レコードを書き込みま
す —— 元の workspace エビデンスは変更されません。

## 境界 —— 書き込み前に拒否

Execution Store と同じゲートです。`/.apm/state/` の ignore カバレッジ
が設定済みであること、state root 配下に Git 追跡ファイルが存在しない
こと、evidence ルートと records ディレクトリが解決済みルート内に
realpath されること —— ルート外に落ちる `evidence/` シンボリンクは
`boundary-escape` です。レコード id は共有のファイルシステム安全
パターンに一致するため、id がパス脱出やディスク上の別 id への別名に
なることはありません。

## CLI

```bash
node .apm/skills/doc-driven-dev-graph/scripts/evidence_store.js <command> \
  --cwd <repo> [--state-root <path>] [--allow-external-root] [--json]
```

- `put --file <evidence.json> [--resolve]` —— レコードを保存。
  `--resolve` は `claim.documentRevision`/`check.designRevision` を
  稼働中の Knowledge Graph からピン留めします（どちらかの参照が解決
  できなければ put は中断されます）。
- `get <id>` / `query [--check|--claim|--outcome|--retention|
  --subject-kind|--run-id]` / `manifest`
- `resolve <id>` —— レコードの逆引き: 参照の状態 + claim/check ごとの
  `matchesPinned`。
- `promote <id> --commit <sha> --tree-digest <hex> [--as <new-id>]`
- `reindex` —— `index.json` を再生成。`recover` —— tmp の残りを除去。

エラーは `{ "error": <code>, "message": ..., "detail": ... }` を終了
コード 1 で出力します。preflight ゲートは終了コード 2 です。コード:
`boundary-gitignore`・`boundary-tracked`・`boundary-escape`・
`external-root-not-authorized`・`record-conflict`・`evidence-not-found`・
`subject-mismatch`・`corrupt-state`・`unsupported-version`・
`invalid-argument`。

## ライブラリ API

`putImmutable / getById / query / buildIndex / rebuildIndex / promoteToCommit /
loadManifest / recoverEvidence / documentRevisionOf` に加え、
`resolveEvidence / resolveEvidenceIn`（逆引き —— Evidence Assessment
`#241` が消費するインターフェース）を
`src/skills/lib/evidence_store` から提供します。
