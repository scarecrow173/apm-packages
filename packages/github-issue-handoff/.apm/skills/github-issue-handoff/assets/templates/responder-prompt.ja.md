# Responder Prompt テンプレート

<!--
プレースホルダー:
- {{repository}}（必須）: 対象 GitHub リポジトリの owner/name。
- {{label}}（任意）: 走査する handoff state ラベル。デフォルト: handoff:needs-response

両方のプレースホルダーを展開し、以下の完成テキストを、リポジトリを閲覧し
GitHub Issue にコメントできる任意の Responder へ渡してください。人間、
別のエージェント、レビューツール、自動化を問いません。
-->

対象GitHubリポジトリ:

`{{repository}}`

このリポジトリで、open Issue のうち
`{{label}}`（デフォルト: `handoff:needs-response`）ラベルが付いているものを
すべて確認してください。

対象 Issue を一件だけ処理して終了せず、現在該当する Issue をすべて列挙・
確認してください。各 Issue は独立した問題として扱ってください。

各 Issue について以下を行ってください。

1. Issue 本文を最初から読む。
2. 既存コメントをすべて確認し、最新の質問 round とそれ以前の議論を把握する。
3. Issue に紐づく Pull Request を確認する。
4. PR の base/head、commit、diff、changed files、checks を必要に応じて
   確認する。
5. Issue 本文に記載された branch、commit、relevant files と現在の
   repository state を照合する。
6. Requester の Current assessment や仮説を正しい前提として扱わず、独立
   して評価する。
7. repository のコード、テスト、ドキュメント、既存規約を証拠として優先
   する。
8. 回答に必要な情報が不足している場合は推測で埋めず、必要な追加情報を
   具体的に質問する。
9. 各 Issue へ回答コメントを書く。
10. 複数 Issue がある場合は、それぞれを独立した問題として処理する。
11. 既に最新 round へ十分な回答が存在する場合は、同じ回答を重複投稿しない。
12. 権限がある場合は回答後に `handoff:needs-response` を外し、
    `handoff:needs-requester` を付けてもよい。ただし label 変更ができなく
    ても回答コメントは必ず行う。

各回答では、可能なら以下の構造を使用してください。

```markdown
## Assessment

問題に対する独立評価。

## Recommendation

推奨する対応。

## Reasoning

コード、テスト、仕様、設計上の根拠。

## Risks / edge cases

見落としやすいリスクや境界条件。

## Suggested next step

Requester が次に行うべき検証・実装・判断。
```

回答は Requester への命令ではなく、独立したレビューとして書いてください。

Issue や PR の記述と実際の repository state が矛盾している場合は、
repository 上で確認できる証拠を優先し、その矛盾を明示してください。

最終的に、今回確認した対象 Issue について、
回答済み / 追加情報待ち / 既に回答済みで変更不要
のいずれになったかを簡潔にまとめてください。
