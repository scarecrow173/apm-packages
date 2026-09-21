# Dashboard Contract

## レポートの表示面

コマンドはUTF-8の自己完結HTMLを一つ出力します。外部CSS、JavaScript、JSON、font、
image、network、server、watchへの依存はありません。authorityはcanonical Markdown
とGraph YAMLだけです。レポートは再生成可能なread-only snapshotで、収集時刻と生成時刻を記録します。

タスクの主画面は `#task-board` です。常設レーンは
`data-kanban-lane="todo"`、`"in-progress"`、`"blocked"`、`"done"`、
`"wont-do"` で、不正statusまたはparse errorのtaskには `unknown` レーンを表示します。
カードは `data-task-card` とcanonical `data-task-path` で識別します。status、title、
opaque ID、依存関係、所属plan、coverage、runnable / resumable の別の投影結果を示します。
opaque IDの重複カードは統合しません。依存待ちtaskはcanonical statusのレーンに残ります。
Graph、route preview、plan別task詳細、文書・relation表、diagnosticも残します。

diagnosticの手前に置く `#attention` セクションはhard blocker、route previewの
blocked reason、blocking finding、task graph issueを種別ごとのパネルに分け、
件数バッジ付きで集約します。空なら「進行を止める項目はありません」と表示します。
カードのreadinessバッジはplan所属を
またいだrunnable / resumable / blockedの集約で、plan別のmembership詳細は折り畳みます。
文書表の自由検索は `data-search-text` のID・title・canonical pathだけに一致し、
種別とstatusは専用selectに残ります。

主要画面より下のセクションは共通の検査用デザインを使います。`<details>`
グループは半透明のアコーディオンカードで、summary行はhoverで強調され、
開いている間は区切り線が付きます。`#graph` のExecution Graphは常時表示の
`.graph-canvas` フレームに収め、eyebrowヘッダにgraphメタ情報、gridを敷いた
`.graph-stage`、ノードkind別・edge種別のフレーム内凡例を置きます。キャンバスは
意味的な階層レイアウトで、`entry` から最優先の外向きedgeを辿った主スパインを
中段に、それ以外のノードを上段のセットアップレーンに配置します。長いスパインは
左→右の2段に折り返し、段またぎの継続edgeは段間チャネルの最深レーンを通って
下段先頭ノードへ降ります。戻りedgeはルーティングワイヤー状に、段間チャネル
（row 0下面へ入る）または下段のリターンチャネル（row 1内のspine→spine）を通り、
spine→branch の戻りは左マージンを上がって上段越しにラップします。
edgeは種別色分けで、前進（accent）・戻り/修復（`edge-back`）・自己ループのretry
（`edge-self` 破線）を区別し、同一ペアの並列edgeは結合タイトル付きの1本にまとめます。
ノードはkind色（action / delegate / audit / terminal）のカードで、アイコングリフ・等幅タイトル・
kindキャプションを持ちます。現在ノードはグローで強調し、選択edgeには
条件ラベルを付け、ノードにhoverすると接続edgeだけが強調され他は減光します。
キャンバス上段の `.probe-grid` はroute probeと2つの補助パネルを並べます。
route previewはroute probeパネルで、eyebrow見出し・`current → next` の
kind色 `.probe-node` チップ（アイコングリフ+等幅名、キャンバスのノード色と共通）を
edge条件ラベル付きの `.probe-link` コネクタで結び（blocked/現状維持時はdanger色の
✕マーカー）、status pill・edge / condition / delegate / commit gateのfacts・
required audit / blockerのラベル付き `.chip` 群（blockerは `chip-danger`）を示します。
`signals` パネルはsupplied / state / hard blockerのchipをラベル付きで並べ、
`gates` パネルは各gateをフロー順のstatusドット付きピル（pass / fail / blocked色、
理由はtooltip）と `N/M pass` スコアで示します。診断系 `<details>` のsummaryは
`lane-count` バッジを持ち、plan別 `<summary>` 行はplan status pillを持ちます。`#documents` のフィルタは
ツールバー風の帯に置き、結果件数は等幅で示します。表はmutedなstickyヘッダ、
アクセント色を乗せた行hover、`tr:target` のハイライトを使います。
`#attention` のパネルは中身がある間だけblocked色の左ボーダーを付け、
`#backlog` ストリップのカードはdraft色の左ボーダーを付けます。セクション見出しには
アクセント色の四角マーカー、footer注記は区切り線の下にmuted色で置きます。

レポートは監視dashboard風のチャート中心構成です。`#overview` はアクセントカラー付きの
statパネル（tabular numeralsの大数字）を並べ、`#charts` はinlineパネルとして
kanbanレーン色と一致したタスクstatusドーナツ、文書区分の横棒グラフ、graph coverageゲージ、
findings severityの積み棒、選択中plan / focusのfactsを表示します。
チャートはinline SVGまたはCSSのみで、`role="img"`、`<title>`、凡例リストで色以外でも読み取れます。

`#task-board` はタスクの主画面として従来どおりです。その内部のkanbanレーン上段に
`#backlog` ストリップを置き、statusが `draft` のcanonical文書をカードで一覧して
今後レビュー・着手する候補を文書表の行へリンクします。

ヘッダのpulse dotは進行を止める項目の有無を映します（存在する間は赤、なければ緑）。
配色は閲覧環境のcolor schemeに従い、navのトグルボタンまたは `T` キーで `<html>` の
`data-theme` を手動切替できます。選択はlocalStorageに保持され、
JavaScriptなしでは `prefers-color-scheme` のフォールバックが効きます。
バッジとピルはセマンティックカラーの `color-mix` 半透明塗り、sticky navは半透明＋
backdrop blur、ページ背面には薄いgrid backdropを敷きます（printとreduced-motionでは無効）。

done / wont-doレーンは
折り畳み、各レーンのカード一覧はレーン内でスクロールします。readinessフィルタと
長い詳細セクションの全開閉ボタンを備え、文書フィルタの状態は `#filter=` のURL hashに
保持します。スタイルと挙動はすべてinlineで、画像はdata URIのfaviconのみです。
`<style>` ブロックの先頭にはビルド時に生成されるvendored Pico CSS v2 classless（MIT）を置き、
その後にdashboard固有の上書きを続けます。上書きの基礎tokenは `--pico-*` 変数を参照し、
laneやstatusのセマンティックカラーだけ独自のlight / darkパレットを持ちます。
マークアップはPico classlessの規約に従い、`nav > ul` のセクションリンク、
`table.striped` の縞模様テーブル、再生成注意書きの `footer` を使います。
閲覧時にstylesheetをfetchしません。

## 件数と対象範囲

- 残存は有効な `todo`、`in-progress`、`blocked`。完了は `done` のみです。`wont-do` は
  別集計で有効taskの分母に含め、dependencyを満たしません。
- 完了率は `done / validTaskTotal`。分母0は対象なしと表示し、不正またはparse不能なtaskは別に数えます。
- repository全体のtaskはcanonical pathで重複排除します。plan viewでは所属planごとに表示できます。
  orphanとgraph-uncovered taskも残します。
- `draft`、`proposed`、`capturing` は別のcanonical文書グループです。unmanaged Markdownのstatusは推測しません。
- focusはfocus集計を変えますが、repository全体のinventoryやdraft件数を隠しません。曖昧なfocusは
  `focus-required` blockerとして残ります。
- `requiredAudits`、`commitGate`、runnable、resumableは必要条件または投影です。audit、commit、route、
  実行の完了を証明しません。
- findingは通常のdoc-status coverageです。parse failure、壊れたrelation、graph issue、graph対象外の
  alias、unmanaged文書を成功へ置き換えません。

件数、進捗、レーン、blocker、coverageを報告する前に、今回生成したHTMLを検査します。ユーザーの申告や
CLI exit 0だけをsnapshotの証拠にしません。検査できない場合は生成成功とパスだけを返します。

## CLI

```bash
mise exec -- node <doc-dashboard-skill-dir>/../doc-driven-dev-graph/scripts/build_dashboard.js --cwd <repo-root>
```

| Option | Contract |
| --- | --- |
| `--cwd <dir>` | 読み取りroot。既定は `process.cwd()`。directory必須。 |
| `--graph <file>` | process cwd相対のGraph path。既定は同梱sibling YAML。 |
| `--focus <id-or-path>` | 繰り返し指定できるfocus selector。既存resolutionへ渡します。 |
| `--current <node>` | route previewを有効化。不明nodeは生成前に失敗します。 |
| `--signal <signal>` | 明示signal。未宣言signalは生成前に失敗します。 |
| `--out <file.html>` | `--cwd` 相対の保存先。既定は `reports/doc-driven-dev/index.html`。 |
| `--force` | 明示的に再生成を求めた既存レポートを、先に削除せず置換します。 |
| `--help` | path基準を含むusageを表示し、読み取り・生成しません。 |

出力は対象repository内の `.html` に限定します。directory、symlink、symlink ancestor経由のrepository外への脱出は拒否します。
既存fileには `--force` が必要です。render完了後にtemporary fileを作り、初回は排他的作成、置換はrenameで旧HTMLを失敗時に保持します。
成功時は `Dashboard written: <absolute path>` を出力してexit 0、入力・収集・publish errorはstderrへ出してexit 1です。
再生成に失敗した場合、旧HTMLはstaleなので新しい結果として報告しません。
