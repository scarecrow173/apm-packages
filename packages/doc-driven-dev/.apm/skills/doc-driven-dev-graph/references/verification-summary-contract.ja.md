# Verification Summary コントラクト v1

Verification Summary（Issue `#241`）は Verification Gate が消費する
純粋な集約です。宣言された 1 つの **対象サブジェクト** —— 「現在の
変更」 —— に対して、スコープ内の全 Verification Check を分類し、
Claim ごとにロールアップして、スコープ全体を 1 つの verdict —
`verified`・`failed`・`indeterminate` —— に集約します。live な
Knowledge Graph（check 設計）、不変の Evidence Store（測定結果）、
caller が供給する免除から計算され、caller が主張する
「implementation verified」 signal からは決して計算されません。

ランタイム: `scripts/evidence_store.js`（`assess`・`summary`
サブコマンド）と `route_graph.js`（`--verification-summary`、自動
計算）。正本ソースは `src/skills/lib/verification_assessment/` です。

## 3 つのコントラクト

| コントラクト | 役割 |
| --- | --- |
| `EvidenceAssessment` | レコードごとの派生判定: この測定結果は今も対象を語るか |
| `VerificationSummary` | 1 対象についての Claim/Check カバレッジ集約 —— gate の入力 |
| `VerificationWaiver` / `NotApplicableVerdict` | 検証される免除の主張 —— 拒否エントリは報告され、黙って適用されない |

Evidence Record は測定についての不変の事実です。assessment は live
graph と宣言された対象に対して再計算します —— ここにあるどの
処理も Evidence Store に書き込みません。

## EvidenceAssessment —— レコードごと、4 つの軸

```jsonc
{
  "schemaVersion": 1,
  "evidenceId": "EVID-…",
  "claim": "SPEC-…::R-01",
  "check": "VD-…::CHK-01",
  "outcome": "passed",
  "applicability": "applicable",      // このレコードは対象を測定したか
  "availability": "available",        // 記録パッケージは今も取得可能か
  "integrity": "verified",            // 測定は内部的に信頼できるか
  "assessment": "sufficient",         // レコードごとの結論
  "reasons": [{ "code": "…", "detail": "…" }]
}
```

### `applicability`

- `applicable` —— claim と check が live graph で解決し、両方の
  ピン留め revision が今も一致し、check が記録された claim を対象に
  し、記録された method が設計上の method であり、レコードの
  サブジェクトダイジェストが対象と一致する。
- `not-applicable` —— すべて解決できるが何かが異なる: claim または
  check の revision が変わった、check がその claim を対象にしてい
  ない、記録 method が設計上のものでない、サブジェクトダイジェスト
  が異なる。*別の* 対象を測定した `passed` 結果は、この対象に対し
  ては決して sufficient になりません。
- `unknown` —— 参照が解決できない、レコードのサブジェクトを
  ダイジェストできない、あるいは対象そのものが名付けられない。
  assessment は推測しません。

### `availability`

- `unavailable` —— 宣言された artifact がアクセス不能、または
  `expiresAt` の期限切れ。
- `unknown` —— 死んだ参照はないが、未取得の参照がある。
- `available` —— 宣言された全 artifact がダイジェスト検証済みで
  retention 内、または artifact が無い。

### `integrity`

- `invalid` —— レコード自身のパッケージが矛盾する: 宣言された
  artifact が dead/expired、または記録 method が設計上のものでない。
- `unverified` —— 裏付けがダイジェスト検証されていない（未取得の
  artifact）、または artifact を全く宣言しない attestation のみの
  結果。
- `verified` —— 宣言された全 artifact がダイジェスト検証済みで最新。

### `assessment`

- `sufficient` —— `applicable` + `passed` + integrity `verified`。
- `insufficient` —— `applicable` + 記録された `failed`（測定された
  失敗は、壊れた裏付けで格上げされません）。
- `indeterminate` —— それ以外のすべて。

### reason コード

`target-unverifiable`、`subject-unverifiable`、`subject-mismatch`、
`claim-unresolved`、`check-unresolved`、`claim-revision-mismatch`、
`check-revision-mismatch`、`check-target-mismatch`、
`method-mismatch`、`artifact-unavailable`、`artifact-expired`、
`artifact-unverified`、`attestation-only`、`outcome-failed`、
`outcome-not-passed`。

## VerificationSummary —— schemaVersion 1

```jsonc
{
  "schemaVersion": 1,
  "kind": "verification-summary",
  "target": {
    "subject": { "kind": "commit", "commit": "<full oid>" },
    "subjectDigest": "sha256:<64-hex>"   // null → 全レコードが target-unverifiable
  },
  "assessedAt": "<iso>",
  "scope": { "claims": ["…"], "checks": ["…"] },
  "claims": [{ "ref", "status", "checks", "requiredChecks", "reasons" }],
  "checks": [{ "ref", "claim", "method", "required", "designRevision",
               "constraints", "executed", "status",
               "evidence": { "sufficient": [], "insufficient": [], "indeterminate": [] },
               "latestConclusiveAt", "waiver", "notApplicable", "reasons" }],
  "evidence": [EvidenceAssessment],
  "rejectedWaivers": [{ "input", "waiver", "reasons" }],
  "rejectedNotApplicable": [{ "input", "verdict", "reasons" }],
  "shadowedExemptions": [{ "kind", "input", "scope": { "kind", "ref" } }],
  "counts": { "checks": {…}, "claims": {…}, "evidence": {…} },
  "verdict": "verified | failed | indeterminate",
  "reasons": ["…"]
}
```

### Check の status

| Status | 意味 |
| --- | --- |
| `satisfied` | 最新の結論付き applicable assessment が `sufficient` |
| `failed` | 最新の結論付き applicable assessment が `insufficient` —— この対象での測定失敗 |
| `waived` | 結論付きエビデンスなし。検証済み waiver が check を免除 |
| `out-of-scope` | 結論付きエビデンスなし。検証済み impact-analysis verdict が check を免除 |
| `undetermined` | スコープ内で使える結果も有効な免除もない —— 未実行 check が入るバケット。黙って out-of-scope にはならない |
| `unresolved` | check 参照が解決できない —— required として gate される |

測定結果はどんな免除よりも優先します: 有効な waiver があっても
失敗した check は失敗のままです（waiver は義務を免除するもので
あり、現実を書き換えません）。満たされた check は `waived` ではなく
`satisfied` と報告します。advisory check（`required: false`）は
分類・報告されますが、verdict を gate しません。

method 由来の `constraints` は特別な義務を gate に見せます:
`manual-review` のエビデンスは人間の証明、`runtime-monitoring` の
エビデンスは継続的義務の一時点のサンプルです ——
`latestConclusiveAt` は gate policy が要求できる再近性データです。

### Claim の status

`covered`（claim を対象にする全 required check が satisfied・waived・
out-of-scope）、`partial`（一部のみ）、`uncovered`（ゼロ ——
required check が 0 件の gap を含む）、`failed`（required check が
失敗を測定）。

### verdict

- `failed` —— required check または claim が失敗を測定した。
- `indeterminate` —— required check が undetermined/unresolved、
  claim が uncovered/partial、check 設計の graph issue が宣言された
  inventory を信頼できないものにした、あるいは対象が検証不能。
- `verified` —— それ以外。空スコープは明示的な
  `no-required-coverage` の reason を伴って verified になります
  —— 黙ってはなりません。

summary が Evidence Store 自体を問い合わせる場合（caller 供給の
record 一覧は caller 自身の権威であり、再検査しません）、store の
marker 状態が verdict を制約します: 読み取れない・検証に失敗する
`manifest.json`、あるいは manifest のない record ファイルは、marker
が record を store の状態として証明できないことを意味します ——
verdict は `verified` に到達せず、`reasons` に
`evidence-store-corrupt` または `evidence-store-unmanifested` を
載せます。store が存在しない場合は正当な空入力のままです
（record 0 件は正直なカバレッジ）。これは repo-level lint が
`*-evidence-store` finding として報告するのと同じ境界です。

`verified` verdict は内部整合性を満たさなければなりません: required
check が `undetermined`/`unresolved`/`failed` のまま残らず、
カバーされない claim も残らない（advisory の失敗は gate しません）。
カバーされていない required coverage の上に `verified` を主張する
ファイルは不整合です —— 境界 validator が拒否し、gate は
`verification-summary-inconsistent` で block します。

## 免除 —— 検証される、信頼されることはない

### VerificationWaiver

`{ scope: { kind: "check" | "claim", ref }, authority, reason, grantedAt,
expiresAt }`。次のすべてを満たす場合のみ適用されます: 形状が完全、
`authority` が caller 供給の信頼済み許可リストにある（許可リストが
無ければ全 waiver を拒否）、`scope.ref` が live graph で解決できる、
`expiresAt` が assessment 時点で未来の期限（`expiresAt` が
`grantedAt` 以前なら malformed window）。拒否 reason:
`waiver-malformed`、`waiver-untrusted-authority`、
`waiver-scope-unresolved`、`waiver-expired`、`waiver-invalid-window`。

### NotApplicableVerdict

`{ check, revision, paths, rule, judger, method, reason }` —— check
が現在の変更に適用されないという、change-impact 解析に裏付けられた
積極的な宣言。全フィールド必須で `check` は解決できなければなりま
せん。拒否 reason: `not-applicable-malformed`、
`not-applicable-check-unresolved`。未実行の check が既定で
out-of-scope になることはありません —— この明示的 verdict のみが
それを可能にします。

`revision` は impact 解析が実行された revision を指名します。これは
**caller の証明（attestation）** です: サマリーは解析が述べた根拠
として記録するだけで、再導出・検証はしません —— verdict を生成した
impact 解析ツールこそが、何を測定したかの権威です。

拒否はサマリーの `rejectedWaivers` / `rejectedNotApplicable` に入り、
免除しようとした check にも `status: "rejected"` で添付されます ——
拒否された免除は沈黙ではなくデータです。評価された免除はすべて
—— check エントリ上でも拒否エントリ上でも ——
`{ input, verdict, status, reasons }` のレコードです（拒否エントリ
では `waiver`/`verdict` が検証済み形状を指名）: `input` は逐語の
候補であり、決してコントラクト型ではありません。`verdict` は検証済
みの形状 —— 候補が形状検証に失敗した場合（`*-malformed` の拒否で
あり、境界 validator はその reason の同伴を要求します）に限り
`null` です。読み取り可能なスコープを綴った malformed 候補も、その
スコープに拒否を添付します —— そして後続候補を shadow できます。

決定的な入力順は各スコープキー（waiver は `check:<ref>` または
`claim:<ref>`、verdict は check ref）を先頭の候補に与えます。同じ
スコープの後続の APPLIED 候補はどこにも添付されません —— 逐語の
`input` と競合した `scope` とともに `shadowedExemptions` に記録され、
`shadowed-exemption:<kind>:<ref>` の reason がそれを指名します。
shadow された*拒否*候補にエントリは要りません —— 拒否リストが既に
それを保持しています。

## Graph Gate との束縛

implementation gate の権威は、canonical サブジェクトダイジェストを
通じて checkout の `HEAD` に束縛された Verification Summary です ——
ダイジェスト*こそが*内容同一性なので、commit と workspace の綴りは
同じように束縛され、別のサブジェクトを対象にしたサマリーは古い
artifact です。

- サマリーなし → `verification-summary` で blocked。
- HEAD 自体が解決不能（unborn branch、非 repo） → 束縛は証明不能
  —— `verification-summary-head-unreadable` で blocked。
- `subjectDigest` ≠ HEAD のもの → `verification-summary-target-mismatch`
  で blocked。
- `verdict` ≠ `verified` → `verification-<verdict>` とサマリー自身の
  reasons で blocked。オペレーターは*どの*カバレッジが失敗したかを
  見られます。
- `verdict` = `verified` だがカバーされない required coverage がある
  → `verification-summary-inconsistent` で blocked —— gate は主張さ
  れた verdict を信頼せず、安価な不変条件を再検査します。

`route_graph.js` は常に gate にサマリーを供給します:
`--verification-summary <file>` 指定時は、このコントラクトの
validator を通過するまでファイルを読みません（読めない・検証でき
ない入力は拒否）。ファイル無しの場合、router は live の Evidence
Store と Knowledge Graph から `HEAD` に対してサマリーを自ら計算し
ます。サマリーファイルは caller の免除チャンネルです —— waiver と
条件付き out-of-scope verdict は caller だけが供給できる判定です。

自動計算は意図的に呼び出しごとです: 各 route 判定がサマリーを再導出
するため、動いた `HEAD` や変化した store に対するキャッシュ済み
assessment を routing が読むことはありません。トレードオフとして
失敗ドメインは広がります —— そもそもスキャンできない Evidence
Store（読み取り不能な record、境界違反）は検証サブコマンドだけでなく
route 呼び出し全体を失敗させ、marker が record を証明できない
store は degrade したサマリーを返し、gate は `evidence-store-*`
reason がどの面で失敗したかを示した上で `verification-indeterminate`
で block します。これは意図的な fail-closed です:
カバレッジを証明できない store は gate を決して満たせません。

## CLI

```bash
# 宣言した対象に対するレコードごとの assessment
node .apm/skills/doc-driven-dev-graph/scripts/evidence_store.js \
  assess <evidence-id> (--commit <sha> | --snapshot <digest>) --cwd <repo> --json

# Verification Summary —— 免除は JSON ファイル。--out は
# `route_graph --verification-summary` が消費する素のサマリーを書く
node .apm/skills/doc-driven-dev-graph/scripts/evidence_store.js \
  summary (--commit <sha> | --snapshot <digest>) \
  [--scope-claim <ref>]… [--scope-check <ref>]… [--run-id <id>] \
  [--waivers <file>] [--waiver-authority <name>]… \
  [--not-applicable <file>] [--out <file>] --cwd <repo> --json

# caller 供給サマリーで route（読む前に検証される）
node .apm/skills/doc-driven-dev-graph/scripts/route_graph.js \
  --verification-summary <file> --cwd <repo> --json
```

`--commit` は任意の git リビジョンを受け付けます —— `HEAD`・
ブランチ・タグ・oid —— サマリーは解決された full oid と canonical
サブジェクトダイジェストを記録します。`--snapshot` はアダプタが
証明した `sha256:<64-hex>` の workspace ダイジェストをそのまま
受け取ります。

## ライブラリ API

`assessEvidence / assessEvidenceIn / recordSubjectDigest`、
`buildVerificationSummary / buildVerificationSummaryIn / normalizeTarget`、
`validateVerificationSummary / validateAssessment / validateWaiver /
validateNotApplicableVerdict`、`verificationCoverageGap`、および
`NOT_APPLICABLE_REASONS` / `WAIVER_REASONS` の語彙を
`src/skills/lib/verification_assessment` から提供します。
