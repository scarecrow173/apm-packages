---
name: doc-dashboard
description: 文書駆動開発の進行状況、Graph gate、残存タスク、draft 文書をオフラインHTMLで確認したいときに使います。
license: MIT
---

# Document Progress Dashboard

人が確認するための、手動生成するオフラインHTML snapshotを一つ生成します。
これは報告 capability であり、orchestration の entrypoint ではありません。
canonical Markdown と Graph YAML が authority です。CLI、対象範囲、集計定義は
[dashboard contract](references/dashboard-contract.ja.md) を参照してください。

## Workflow

1. 対象 repository と、この skill のインストール先を解決します。
2. `--focus`、`--current`、`--signal` は caller が明示した場合だけ渡します。
   未指定値を補完せず、文書 status から実行位置を推測しません。
3. この skill directory から sibling の配布 script を解決して実行します。

   ```bash
   mise exec -- node ../doc-driven-dev-graph/scripts/build_dashboard.js --cwd <repo-root>
   ```

   相対 script path は caller の作業ディレクトリではなく、インストール済み
   skill directory 基準です。実行前に絶対パスへ解決します。consumer repository
   が mise を使わない場合は、その repository の Node 実行方法に従います。

4. `--out` は要求された repository 相対のHTML保存先にだけ使います。既存レポートの
   再生成を求められた場合は `--force` を使います。
5. 件数、進捗、レーン、blocker、coverage を報告する前に、今回生成したHTMLを
   実際に検査します。HTMLから読み取ったリンク、生成時刻、件数、主な blocker、
   対象範囲の制約だけを返します。検査できない場合は生成先だけを返し、snapshot
   の事実は未確認だと明記します。

## レポートの読み方

タスクボードを主画面とします。常設レーンは `todo`、`in-progress`、`blocked`、
`done`、`wont-do` で、不正 status または parse error の task には `unknown` レーンを
追加します。カードには title、opaque ID、canonical path、依存関係、所属 plan、
coverage、runnable / resumable の別の投影結果を表示します。依存待ちの todo は
todo レーンに残ります。Graph topology、route preview、plan 別 task 詳細、文書、
relation、diagnostic は補助ビューとして残ります。

## Boundaries

- ボードは read-only snapshot です。drag、status編集、Markdownへの永続化はありません。
- status更新、承認、relation修復、索引再生成、delegate実行、commitをしません。
- 検証 signal を補完せず、指定された現在ノードを観測済みと主張しません。runnable
  と resumable は投影結果であり、実行完了の証明ではありません。
- server、watch process、ネットワーク通信、外部asset読み込みを開始しません。
- Graph node を追加せず、レポート生成用の `EffectOutcome` を創作しません。
- 詳細監査は `doc-status`、明示的な routing 要求は `doc-driven-dev-graph` を使い、
  HTML生成のために追加 orchestrator を起動しません。
- exit 0 はレポート生成成功だけを示します。再生成に失敗したとき、古いHTMLを
  新しい結果として報告しません。
