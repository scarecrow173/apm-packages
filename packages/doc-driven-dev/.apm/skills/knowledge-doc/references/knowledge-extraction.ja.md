# ナレッジ抽出契約

この契約は、実装作業がいつ永続的なナレッジを生み、Document Registry 3 の下で
それをどう保存するかを定義します。レガシーの常時生成型 `impl-doc` 契約を
置き換えるものです: 通常の実装修正は、Implementation Record・Experiment
Log・ナレッジドキュメントを**強制作成せず**に完了します。保存は既定ではなく
判断です。IR/EXP が担っていた実行証跡は、ランの
[Execution Store](../../doc-driven-dev-graph/references/execution-store-contract.ja.md)
レコードと [run trace](../../doc-driven-dev-graph/references/run-trace-contract.ja.md)
に属します。

実装ランからの知見を統合する前にこのリファレンスを読み込んでください。
`references/knowledge-conventions.md` がドキュメント形式を定義し、このファイルが
判断境界を定義します —— 何を残す価値があるか、どこに属するか、出処と競合を
どう扱うか。

## 永続的なナレッジの判定基準

知見を抽出するのは、それを生んだ変更を超えて真であり続ける場合のみです:

| 抽出するもの | 種別 | 理由 |
| --- | --- | --- |
| なぜその設計・修正になったか | `architecture` / `lesson` | 根拠はdiffより長生きし、次の変更に必要 |
| 再発防止 —— 同じ失敗を防ぐ規則 | `lesson` | ランは単なる事象ではなく永続的な制約を証明した |
| 実装中に確定した制約 | `codebase` / `architecture` | 将来の作業が守るべき不変条件 |
| 調査で確定した性質 | `codebase` | 非自明で検証済みのコードの事実 |
| 実行・デプロイ・復旧の方法 | `operation` | 運用手順はランを超えて残る |

| 抽出しないもの | 代わりの置き場所 |
| --- | --- |
| 成功/失敗の時系列、試行履歴 | [Run trace](../../doc-driven-dev-graph/references/run-trace-contract.ja.md) / [Execution Store](../../doc-driven-dev-graph/references/execution-store-contract.ja.md) —— 診断情報でありナレッジではない |
| コマンド実行ログとその出力 | [Run trace](../../doc-driven-dev-graph/references/run-trace-contract.ja.md) —— 一時的な証跡 |
| チャット的な作業記録・叙述 | どこにも永続化しない —— 会話の残滓 |
| タスク状態・進捗・割り当て | [Execution Store](../../doc-driven-dev-graph/references/execution-store-contract.ja.md) レコード |
| 検証結果 | Evidence Store / Verification Design |
| 未検証の推測・仮説・憶測 | どこにも —— 検証されるまで `status: draft` を維持 |

記録量の削減は検証済み知見の消去ではありません: ナレッジが永続的なら保存し、
ツリーを小さく保つために統合をスキップしません。

## 統合の決定 (明示的、既定ではない)

永続的なナレッジがある場合、まず
`scripts/consolidate_knowledge.js assess --title ... --kind ...` を実行します。
assess はすべての durable ディレクトリ (`docs/knowledge`、`docs/specs`、
`docs/designs`、`docs/adr`、`docs/discovery`、`docs/ideas`、
`docs/verification`) を走査し、各候補に `route` を付けて報告します。
その後、ちょうど1つを選びます:

| 決定 | 条件 | 効果 |
| --- | --- | --- |
| `integrate` | 既存のナレッジドキュメントがその話題をカバーしている | `--into` がそれを更新: `relations.source` に原典が追加され、Source/Provenance セクションに日付付き根拠エントリが入り、`updated` が更新される |
| `route` | 知見が Spec / Design / ADR (または他の durable 型) の変更に相当する | 統合は何も書き込まない; その型の所有スキル (`spec-doc`、`design-doc`、`adr-doc` など) 経由で変更を適用 |
| `create` | どの既存ドキュメントも担えない | 新しい `docs/knowledge` ドキュメント —— 未承認の競合がある間は拒否 |
| `none` | 永続的な結果がない | 有効な no-op 完了; 何も書き込まない |

責務境界は厳格です: `integrate` は非ナレッジ対象を拒否します。ナレッジの
書き込み側は spec・design・ADR を編集しません —— それらの変更は自身のレビュー
契約を持つ所有スキルに振ります。

## 出処と根拠 (原典・根拠)

記録されるすべての抽出は両方を持ちます:

- `--from` —— 抽出元 (原典): 知見が学習された Implementation Record、ラン、
  レビュー、インシデント、またはドキュメント。`relations.source` に保存;
  繰り返し指定可能。
- `--basis` —— 証拠の根拠 (根拠): その知見を信頼できる理由 (通過したテスト、
  レビュー、再現した振る舞い)。ドキュメントの Source/Provenance セクションに
  日付付き箇条書きとして記録。

`--status confirmed` は「検証・レビュー済み」の印です。常に記録済みの出処を
要求します —— `new_knowledge.js --status confirmed` は `--from` なしでは拒否し、
`consolidate_knowledge.js` はすべての `integrate` と `create` で `--from` +
`--basis` を要求します。未検証の推測は確定的なものとして永続化しません;
`draft` のままです。

## 重複と矛盾

`assess` は `conflicts` を報告します: 種別と用語を共有する、複数の用語を共有
する、または同一タイトルを持つ未確定のナレッジドキュメント。競合がある間
ゲートは `review-required` で、`apply --decision create` は各競合を
`--acknowledge <id|path>` で明示的に承認するまで拒否します —— これが明示的な
レビュー/承認ステップです。承認とは、人間 (または要求元のエージェント) が
レコードを比較したことを意味します: 統合するか、置き換えるか、あるいは理由を
`--note` に添えて作成します。

確定済み (settled `status` —— knowledge では `archived` / `superseded` ——
または `superseded` / `retired` `lifecycle`) ドキュメントの競合は
ブロックしません —— コンテキストのための候補としてのみ報告されます。

## ランの終了ゲート

統合なしでのラン完了は有効な `none` 結果です。ただし重要な知見が未整理のまま
残る場合 —— 競合が未レビュー、または永続的ナレッジが特定されたが未保存 ——
呼び出し側は静かに完了せず、ランの終了ゲートにそれを報告します。`assess` が
そのシグナルを公開します: `gate: "review-required"` は統合が未完了であることを
意味します。

## インデックス

`docs/knowledge/README.md` は派生的な実体化ビューのままです ——
`doc_maintenance.js index plan|apply` で明示的に再生成します。作成と統合は
それに触れません。
