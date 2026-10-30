# Skill Discovery Protocol — Progressive Loading Contract 日本語版

Version: 1.0.0

本文書は、Skill Discovery Protocol を使う flow を agent が実行するときの
スキル指示文の段階的ロード方法を定義する。front matter の metadata が
最初、flow profile が 2 番目、applicable な `SKILL.md` 本文が 3 番目、
step 単位で必要な references・scripts・adapters が最後である。
これは instruction-level のロード規律であり、agent が読む指示テキストを
絞るものであって、gate・evidence・routing 判断を変更するものではない。

---

## 1. 段階的ロードモデル

| Stage | 対象 | ロードされるタイミング |
| ----- | ---- | ---------------------- |
| 0 | `name` + `description` front matter | 常時利用可能 — skill の選択面 |
| 1 | `.sdp/<adapter-id>/` 配下の flow profile | flow 実行ごとに 1 回、routing 判断の前 |
| 2 | `SKILL.md` 本文 | 解決済み profile が applicable と示した skill のみ |
| 3 | `references/*.md`、`scripts/*.js`、`assets/adapters/*.yaml` | active step が指名したときのみ |

stage は厳密に順序付けられる。後の stage が先の stage の代わりになることは
なく、どの stage も「念のため」に内容をロードしない。

### Stage 0 — selection surface

インストール済みすべての skill の `name` と `description` front matter は
常時利用可能で、唯一の always-on 選択面である。小さく保つ:
description は trigger と scope のシグナルを持ち、手順は持たない。
agent はこの選択面から候補 skill を選び、この stage では他に何も
ロードしない。load inventory が front matter の `description` テキストを
stage-0 のロード済みテキストとして数えるのはこのためである。

### Stage 1 — profile resolution

routing の前に、flow は adapter スコープの profile を解決する:
`.sdp/<adapter-id>/<flow_profile>`。`<adapter-id>` ディレクトリと
`flow_profile` ファイル名（`artifacts.protocol.flow_profile`）は
adapter が指定する。例: briefing-flow では
`.sdp/briefing-flow-default/briefing-profile.json`、
implementation-flow では
`.sdp/implementation-flow-default/implementation-flow-profile.json`。

- missing・corrupt・stale の場合 → flow の adapter
  （`assets/adapters/*-adapter.yaml`）を渡して `skill-discovery-protocol`
  を呼び出し、再生成する。この再生成経路は hard gate であり、変更しない。
- corrupt や stale の判定基準は [gate-spec.ja.md](gate-spec.ja.md) の
  validation gate が定義する。本 contract はその意味論を参照するだけで、
  再定義しない。
- profile が missing または invalid でも「すべての skill が applicable」
  にはならない。有効な profile がなければ applicability 判断自体が
  得られない — fail closed、再生成してから進める。
- `sdp query` の subcommand（`flow-stack`、`resolution`、
  `execution-policy`、`runtime-guidance`、および `cli-reference.md` の
  その他の subcommand）が profile への read channel である。
  `.sdp` の生 JSON を context に読み込むことはその代替にならない。

### Stage 2 — applicable skill bodies

`SKILL.md` 本文は、解決済み profile が applicable と示した skill —
`flow_stack.slots[]`、`resolved_invocations`、および flow に文書化された
configure 手順で選択された skill — についてのみロードする。
本文は applicable skill の always-on 指示面であり（inventory の
`alwaysOnChars`）、profile の `execution_policy` が step の厳格さを決め、
`runtime_guidance` は policy チェック後に soft ranking signal として
読まれる（hard gate ではない）。

### Stage 3 — on-demand step resources

applicable skill の中で、`references/*.md` ファイル、`scripts/*.js`
ツール、`assets/adapters/*.yaml` は active step が指名したときのみ
ロードする — inventory が `optional` と判定する conditional-load の行
（"if needed"、"as needed"、"see also"、条件付き bullet）である。
どの reference がその task type に MANDATORY で、どれがロードされずに
済むかは、各 skill 自身の reference loading guide が決める。

---

## 2. ロード規則

- **明示的な invocation 経路のみ。** ロードは profile が宣言する
  applicability と active step の必要性に従う。「すべての skill を
  activate」しない、すべての `SKILL.md` を一括ロードしない、
  網羅のために references を読まない。
- **Profile は hard gate。** 有効な解決済み profile なしに stage-2 の
  本文ロードは行わない。missing・corrupt・stale ではまず再生成する。
- **推測ではなく宣言済み relation。** applicability は profile が宣言する
  classification・slot・resolution から得る — ファイル名の近さ、
  ディレクトリの隣接、記憶からは判断しない。
- **en/ja 対等。** `SKILL.md`/`SKILL.ja.md` と `*.md`/`*.ja.md` の
  sibling は構造と意味を同期させる。English ファイルが inventory が測定する
  正準の指示面であり、localized sibling を代わりに読むのは host 言語の
  選択であり、内容の差ではない。
- **可搬性。** この規律が必要とするのは skill の filesystem、`.sdp`
  artifacts、`sdp` CLI のみであり、vendor 固有の必須依存はない。

---

## 3. 維持されるゲートと証拠

段階的ロードが減らすのは指示テキストであり、義務ではない。本 contract の
下でも次の normative gate は有効であり続ける:

- briefing gate での spec-doc と adr-doc の acceptance
- planning approval — plan review が pending の間は `approval-required` の yield
- code 変更開始前に開かれる Implementation Record
- task を完了とみなす前に記録される verification EVIDENCE
- task 終了前の review gate
- route が宣言する `commitGate` の commit 要件

profile がその skill を non-applicable と示したためにロードされなかった
skill body は、flow 自身が宣言する gate を免除できない。

---

## 4. 決定論的測定

決定論的測定の channel は skill load inventory（このリポジトリ内の
`scripts/doc-driven-dev/src/skills/skill-discovery-protocol/scripts/lib/load_inventory.ts`）である: 参照された
file・byte・instruction 文字数（`skillBytes`、`alwaysOnChars`）、および
kind（`reference`、`script`、`sdp-artifact`、`skill-invoke`、
`adapter`）と §1 の `optional` フラグで分類される load-directive 数。

本 contract は token・model latency・意味的な firing rate・model が
自然言語をどう解釈するかを測定せず、改善も主張しない。これらは明示的な
非対象である（§6）。

---

## 5. 境界と Context Retrieval との関係

本 contract が管理するのは SKILL/instruction のロード — flow 実行中に
agent が読む skill ファイル — である。document body の取得 —
delegate に渡される canonical Markdown artifact — は
`doc-driven-dev-graph` の
[context retrieval contract](../../doc-driven-dev-graph/references/context-retrieval-contract.ja.md)
が管理する: その L0–L3 の level、typed-relation traversal、fail-closed
finding は artifact 内容に適用され、skill instruction には適用されない。

両 contract は異なる layer で同じ規律を適用する: 近さの推測より明示的
選択、推論より宣言済み relation、黙った drop より fail-closed、
model 指標より決定論的な file/byte/count 測定。router と graph の
invariant は変更されない — `doc-driven-dev-graph` の routing、
`GraphRoute` の delegation、task-graph の意味論は本 contract の影響を
受けない。

---

## 6. 非対象

- token・cost・model latency・firing rate の評価は行わない。
- router・graph・task-graph の invariant は変更しない。
- profile schema や sdp pipeline は変更しない — 本 contract は
  pipeline の出力を消費する側である。
- document body の取得規則は持たない — context retrieval contract を参照。
- vendor 固有の必須依存はない。
