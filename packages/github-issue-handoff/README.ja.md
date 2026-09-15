# github-issue-handoff

`github-issue-handoff` は同名の skill を 1 つ含む APM パッケージです。
ローカルのコーディングエージェントが第三者の判断を求めるための永続的な
仕組みを提供します。レビュー可能な repository state を GitHub 上に保存し、
Draft PR にリンクした Issue で構造化された問いを立て、portable な
Responder prompt をユーザーへ渡し、後から回答を取り込んで作業を再開
できます。

Responder は repository を閲覧し GitHub Issue にコメントできる任意の主体
です。人間、別のコーディングエージェント、レビュー用 AI、自動化を問い
ません。protocol は特定の製品やサービスに依存しません。

## インストール

このリポジトリを marketplace として登録し、名前でインストールします:

```bash
apm marketplace add scarecrow173/apm-packages
apm install github-issue-handoff@apm-packages
```

または monorepo のサブディレクトリを version selector 付きで直接参照します:

```yaml
dependencies:
  apm:
    - scarecrow173/apm-packages/packages/github-issue-handoff#main
```

配布される skill は `.apm/skills/github-issue-handoff/` 配下にあります。

## 前提条件

- `git` と GitHub CLI（`gh`）が認証済み（`gh auth status`）であること。
- 作業 repository に GitHub remote があり、Issues が有効であること。
- branch 作成、push、Issue と Pull Request の作成権限があること。

branch、commit、push は protocol の必須要素です。handoff は push 済みの
checkpoint commit を持つ reviewable branch から始まり、local-only の state
からは始まりません。repository policy が push を禁止する場合、protocol は
完了できず明示的に失敗します。Issue だけを作る fallback には退避しません。

## handoff の流れ

1. **まずローカルで調査する。** 再現し、code・test・error・log・docs を
   調べ、外部レビューの価値がある場合だけ escalate します。
2. **branch を用意する。** 専用の task branch を再利用するか新規作成し、
   無関係な変更を混ぜません。
3. **reviewable state を commit する。** 再現コード、現在の
   implementation、failing test、draft など Responder が必要とするもの
   だけを、意図・検証・未確定事項を説明する commit message で。
4. **push してから Issue を作る。** 構造化された Issue が問い、context、
   findings、現在の assessment、repository state、求める review を記録
   します。
5. **linked Draft PR を開く。** PR 本文は closing reference
   （`Closes #<n>`）を持ち、merge すると Issue が close されます。Draft
   は判断が未確定であることを示します。
6. **Responder prompt を表示する。** エージェントは template を実際の
   repository と label で展開し、完成した prompt をユーザーへ表示します。
7. **継続または yield。** 独立した作業は続けます。残作業がすべて回答待ち
   の場合だけ `handoff:blocking` を付けます。
8. **再開して解決する。** plain な人間の comment を含む回答を repository
   の証拠と照合し、実装・検証・merge し、Issue の close を確認します
   （merge で閉じなければ明示的に close）。

Issue は問いの記録、PR はその実装の記録です。Issue は通常 merge によって
close され、それ以前には閉じません。

## Label

- `handoff` — protocol 参加 Issue。
- `handoff:needs-response` — Responder の回答待ち。
- `handoff:needs-requester` — Requester の確認待ち。
- `handoff:blocking` — 残作業がすべて response 依存。

2 つの pending state は排他的です。Responder に label 管理を必須要求
しません。

## Roles

**Requester** — 作業主体: 調査、branch 準備、commit、push、Issue + Draft
PR の作成、prompt 表示、回答の評価、実装完了、merge、close 確認。

**Responder** — コメント可能な任意の主体: open の
`handoff:needs-response` Issue をすべて確認し、各 linked PR の diff・
commit・ファイルを調べ、独立した assessment で回答します。

## Responder prompt

`assets/templates/responder-prompt.md`（英語）と
`responder-prompt.ja.md`（日本語）は再利用可能な prompt template で、
handoff 時に対象 repository（`{{repository}}`）と label（`{{label}}`、
デフォルト `handoff:needs-response`）で展開されます。

重要な性質が 2 つあります:

- prompt は **repository-wide** です。Responder は open の
  `handoff:needs-response` Issue をすべて処理対象にするため、定期的または
  手動の起動でも未回答 handoff を取り残しにくくなります。
- Requester は handoff 作成時に **展開済みの prompt をユーザーへ表示**
  します。ユーザーはそれを人、別のエージェント、任意のレビュー workflow
  へそのまま渡せます。

## Blocking

`handoff:blocking` は、残っている意味のある作業がすべて回答待ちの場合を
意味します。それ以外では作業を続行します。

## セキュリティ

`.env` の内容、token、key、cookie、credentials、機微な customer data などの
secret を Issue、PR、commit message、Responder prompt に書かないでくだ
さい。private repository であっても同じです。

## トラブルシューティング

| 症状 | 対応 |
| --- | --- |
| `gh` がない / 未認証 | GitHub CLI を install し `gh auth login` を実行。 |
| 非 GitHub remote / repository が曖昧 | protocol は推測せず停止します。明示的に `owner/repo` を指定。 |
| Issues 無効 / 権限エラー | Issues の有効化・権限付与。skill は失敗した操作を報告します。 |
| policy や branch protection で push 不可 | handoff は完了できません。明示的に報告され、Issue だけの fallback はしません。 |
| PR merge 後も Issue が open | closing reference を確認し、resolution comment を書いて明示的に close。 |
| PR が merge されず close | 完了した handoff ではありません。replacement・redesign・not planned を決めて Issue を更新。 |

## 検証

リポジトリルートから:

```bash
mise exec -- pnpm --dir scripts/github-issue-handoff test
mise exec -- pnpm --dir scripts/github-issue-handoff run lint:md
```

このパッケージのディレクトリから:

```bash
mise exec -- apm compile --dry-run
mise exec -- apm compile --validate
```
