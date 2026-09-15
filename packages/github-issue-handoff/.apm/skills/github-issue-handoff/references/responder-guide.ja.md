# Responder ガイド

Responder が handoff Issue を処理する方法です。この文書は protocol の説明
です。Responder へ実際に渡す実行指示は
`assets/templates/responder-prompt.md` の prompt template です。
両者を混同しないでください。

## 誰が回答できるか

repository を閲覧し Issue にコメントできる任意の主体です。人間、別の
コーディングエージェント、レビュー用 AI、自動化を問いません。特定の
identity、bot アカウント、runtime、ツールは不要です。label 操作は任意で
あり、protocol の成立に必須ではありません。

## 対象範囲: open の `handoff:needs-response` Issue すべて

Responder の起動は repository-wide です。`handoff:needs-response` label が
付いた open Issue をすべて検索し、すべて処理します。一件だけ処理して終了
してはいけません。各 Issue は独立した問題であり、それぞれの証拠で評価
します。

Issue の最新 round に十分な回答が既にある場合は、同じ回答を重複投稿せず、
回答済みとして記録します。

## Issue ごとの手順

対象 Issue それぞれについて:

1. Issue 本文を最初から読む。
2. 既存コメントをすべて読み、最新の質問 round とそれ以前の議論を把握する。
3. linked Pull Request を開く。
4. 必要に応じて PR の base/head、commit、diff、changed files、checks を
   確認する。
5. Issue に記録された branch、commit、relevant files と repository の現在
   の状態を照合する。
6. Requester の "Current assessment" や仮説を前提ではなく主張として扱い、
   独立して評価する。
7. repository の code、test、documentation、既存規約を証拠として優先する。
8. 回答に必要な情報が不足している場合は推測で埋めず、必要な追加情報を
   具体的に質問する。
9. Issue へ回答コメントを書く。行単位の議論には PR review comment を
   補助的に使ってもよい。
10. 権限がある場合は `handoff:needs-response` を外して
    `handoff:needs-requester` を付けてもよい。label を変更できなくても
    コメントは必ず行う。コメントだけで Responder 側の protocol は成立
    する。

## 回答の構造

可能なら次の形を使います:

```markdown
## Assessment

Independent evaluation of the problem.

## Recommendation

The recommended action.

## Reasoning

Grounds in code, tests, specifications, and design.

## Risks / edge cases

Overlooked risks and boundary conditions.

## Suggested next step

What the Requester should verify, implement, or decide next.
```

回答は Requester への命令ではなく、独立したレビューです。

## 矛盾への対応

Issue や PR の記述と実際の repository state が矛盾する場合は、repository
上で確認できる証拠を優先し、その矛盾を明示します。

## Optional な自動化 marker

自動化された Responder は、重複回避、round の対応付け、監査のために
optional marker を含めてもよいです:

```markdown
<!-- github-issue-handoff-response
protocol: 1
round: 20260916T031522Z-a8f31c
-->
```

marker は optional です。これを含まないコメント（すべての人間のコメントを
含む）も同じく有効な回答です。

## 最終サマリー

最後に、今回確認した各 Issue について、回答済み / 追加情報待ち /
既に十分な回答があり変更不要、のいずれになったかを簡潔に報告します。
