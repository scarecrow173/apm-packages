# Requester プロトコル

`github-issue-handoff` の Requester 側ライフサイクル全体です。概要は
`SKILL.md` にあり、この文書は運用上の詳細を定義します。

## Roles

**Requester** — 作業を行う主体。問題の調査、reviewable branch の準備、
関連 state の commit、push、Issue 作成、PR 作成とリンク、Responder prompt
のユーザーへの提示、回答の評価、follow-up、implementation の完了、merge 後の
Issue close 確認までを担当します。

**Responder** — repository を閲覧し Issue にコメントできる任意の主体。
人間、別のコーディングエージェント、レビュー用 AI、自動化を問いません。
特定の identity、bot アカウント、runtime、API、marker、label 権限を要求しては
いけません。plain な Issue コメントも有効な回答です。

## 前提条件

handoff 開始前に確認します:

- `git` が利用可能で、working tree が repository であること。
- `gh`（GitHub CLI）が利用可能で認証済みであること（`gh auth status`）。
- remote が GitHub repository で、Issues が有効であること。
- repository 検出の優先順位: 明示的な repository 指定 → `gh repo view` →
  `git remote`。それでも曖昧なら停止する。推測した repository に Issue や
  PR を作成してはいけません。Responder prompt に埋め込む repository は、
  handoff を実際に作成した repository と一致させます。

## ローカル調査ゲート

問題を見つけただけで handoff を開かないでください。まず:

1. 問題を再現または正確に特定する。
2. 関連する code、test、error、log を調べる。
3. repository documentation を調べる。
4. 仮説を立て、安価な検証を行う。
5. 独立したレビューの価値を判断する。

ローカル調査で安価に確定できる問いは、ローカルで確定させます。

## Branch

handoff には Responder が参照できる working branch が必須です。

- 現在の task branch がこの変更専用なら再利用します。
- default branch や無関係な branch 上にいる場合は新しい branch を作成します。
- repository の命名規約を優先します。規約がなければ
  `handoff/<short-topic>` のような名前が概念例です。branch 名の形式自体は
  protocol の一部ではありません。

branch 作成前に最低限、repository、現在の branch、意図する base branch、
working tree の状態、現在の HEAD を確認します。無関係な working tree の変更を
handoff branch へ混入させないでください。

## Checkpoint Commit

checkpoint commit は Responder がレビューする基準点であり、単なる保存では
ありません。

- Responder の判断に必要な state だけを含めます。問題を再現する変更、現在の
  implementation、failing / 追加した test、関連する configuration、draft
  design、migration、schema、関連する documentation。
- 無関係な refactor、無関係な formatting、editor の生成物、cache、一時出力、
  無関係な実験、secret を混ぜません。
- commit 前に `git status`、`git diff`、`git diff --cached` を確認します。
- レビューしやすくなるなら複数 commit に分割します。

commit message は repository の規約に従います。subject は何を変更したかを
明確にし、body では必要に応じて、この checkpoint が存在する理由、現在実装
されている挙動、検証済みの事項、未確定の事項、handoff を求めた理由を説明
します。credentials、token、private data、secret 値、機微な log 内容を
commit message に書いてはいけません。

## Push

Issue を作成する前に、branch と checkpoint commit を remote へ push します。
ローカルにしか存在しない state は Responder がレビューできません。

repository policy、ユーザーの指示、branch protection が push を禁止する
場合は、現在の repository policy 下では handoff protocol を完了できない旨を
明示して停止します。Issue だけを作る silent fallback へ切り替えてはいけません。

## Issue と Draft PR

Issue を作成する前に、protocol の label が repository に存在することを確認
します: `handoff`、`handoff:needs-response`、`handoff:needs-requester`、
`handoff:blocking`（`gh label list` で確認し、不足分を `gh label create`
で作成）。repository-wide の Responder スキャンは
`handoff:needs-response` label で handoff を発見します。`handoff` と
`handoff:needs-response` を作成・付与できない場合、handoff は完了できま
せん。発見されない Issue を作る代わりに、停止して報告してください。

続けて `issue-format.md` の形式で Issue を作成し、PR を作成します。

- PR は必須です。PR のない Issue は開始された handoff ではありません。
- PR は Draft として作成します。merge ではなく review のために存在します。
  repository の workflow が Draft PR を使わない場合のみ、その規約に従います。
- PR の base は変更が最終的に merge される branch です（通常は default
  branch、または repository の integration branch）。
- closing keyword（`Closes #<n>`。規約に応じて `Fixes` / `Resolves`）で
  リンクします。`Related to #<n>` だけでは不十分です。
- Responder が PR から diff、commit、changed files、checks へ到達できる
  状態にします。

## Responder Prompt

artifact が揃ったら、Responder prompt を展開してユーザーへ表示します。

- `assets/templates/responder-prompt.md` を実際の `owner/repo` と label
  （default は `handoff:needs-response`）で展開し、完成した prompt を
  その場で全文表示します。template の path を案内するだけでは不十分です。
- あわせて Issue URL、PR URL、branch、checkpoint commit の SHA、blocking
  かどうかを報告します。
- prompt は設計上 repository-wide です。作成直後の Issue だけでなく、open の
  `handoff:needs-response` Issue をすべて処理対象にします。
- 新規 handoff 時、ユーザーが要求したとき、template や parameter が変わった
  とき、follow-up 後に再度 Responder の処理が必要なときは再表示します。
  通常の resume で毎回再表示する必要はありません。

## 継続または Yield

handoff を作成したことは停止理由ではありません。独立した作業を続行します。
新しい relevant change が発生した場合は通常の workflow に従って commit・
push し、PR へ反映します。

`handoff:blocking` を付けて yield するのは、残っている意味のある作業が
すべて未解決の response に依存する場合だけです。

## Follow-up Round

同じ問題への追加質問は同じ Issue で行います。新しい Issue を乱造しません。
各 round には新しい round ID を付けます（`issue-format.md` 参照）。

前回 round 以降に関連コードが変わっている場合は、modify → verify → commit →
push の順で行い、follow-up に最新の push 済み SHA を記録します。純粋な追加
質問だけで repository state が変わっていない場合、新しい commit は不要です。

follow-up 後は state label を `handoff:needs-requester` から
`handoff:needs-response` へ戻します。

## Resume

再開時の手順:

1. 関連する open の handoff Issue を見つける。
2. Issue 本文と新しい comment をすべて読む。
3. linked PR と最新の push 済み commit を確認する。
4. response 候補を特定する。plain な comment も含む。
5. 各 response を repository の証拠と照合する。
6. assessment を更新する。
7. 続行、follow-up、または resolve する。

label は Responder が handoff を発見する仕組みなので正確に保ちます。
ただし、response の有無を判定する唯一の権威として扱ってはいけません。
label 権限のない Responder もコメントで回答します。state は comment と
commit から判断してください。

## 回答の評価

response は独立したレビューであり命令ではありません。証拠の優先順位は、
検証済みの証拠、repository の挙動、test、文書化された requirement、確立され
た制約、そして responder の意見の順です。response が repository の証拠と
矛盾する場合は証拠を優先し、必要なら追加検証または follow-up します。

## 完了

response を取り込み implementation が完了したら:

1. 必要な validation を実行する。
2. 意味のある message で最終変更を commit し push する。
3. PR を更新し、適切なら ready for review にする。
4. PR を merge する。
5. Issue が実際に close されたか確認する。body の closing keyword は
   証拠になりません。

merge 後も Issue が open なら原因を確認します（closing reference の破損、
Issue 番号の誤り、base branch 条件の差異、特殊な workflow など）。
implementation が本当に完了しているなら、merge 済み PR と実施した検証を示す
`## Resolution` の final comment を書き、Issue を明示的に close します。
完了した handoff を open のまま放置しません。

PR が merge されずに close された場合は成功ではありません。replacement PR、
follow-up / redesign、not planned のいずれかを明確にし、Issue を適切に処理
します。

Issue を close する前に確認します: 問いが解決済み、implementation が PR に
反映済み、validation が完了、PR の関係が存在、PR の disposition が明確、
未解決の follow-up がない、最終 repository state が追跡可能。

## エラーハンドリング

| 失敗 | 必要な対応 |
| --- | --- |
| `git` が使えない | 報告して停止。handoff は成立しません。 |
| `gh` がない・未認証 | 報告して停止し、install または認証をユーザーへ依頼します。 |
| repository 検出失敗・非 GitHub remote | 報告して停止。対象を推測しません。 |
| Issues 無効・権限不足 | 失敗した操作を報告して停止します。 |
| label 設定の失敗 | `handoff` / `handoff:needs-response` を確保できない場合は Issue 作成前に fail closed します。Responder スキャンは label で発見するためです。それ以外の label 不備は Issue に記録しても構いません。 |
| branch / commit / push の失敗 | 失敗箇所を報告し、Issue は作成しません。 |
| Issue 作成の失敗 | 報告。PR だけを残しません。 |
| PR 作成の失敗 | Issue URL と PR 未作成である旨を報告。PR ができるまで handoff は未完了です。 |
| protocol metadata の破損 | 次の round で正しい metadata を記録。人間可読な本文を authoritative に保ちます。 |
| linked PR の欠落 | handoff を開始済みと扱う前に linkage を再作成します。 |

## Secret 安全性

Issue、PR、commit message、prompt に以下を埋め込まないでください:
`.env` の内容、API key、token、password、cookie、Authorization header、
private key、secret を含む configuration、機微な customer data。
private repository であることは secret 投稿を正当化しません。

## 並行性

複数の handoff は独立しています。各 handoff は Issue、PR、branch、現在の
round、現在の commit、state label の対応を持ちます。Responder prompt は
repository-wide で、一回の実行で `handoff:needs-response` の全 Issue を
処理します。この 2 つの scope を混同しないでください。Requester の
lifecycle は Issue 単位、Responder の起動は repository 単位です。
