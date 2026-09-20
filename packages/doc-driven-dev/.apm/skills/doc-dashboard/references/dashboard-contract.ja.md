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
