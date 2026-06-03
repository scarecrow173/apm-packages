# Skill Reference Inference 実装計画

## 背景

`skill-discovery-protocol` は外部からインストールされた標準的な
`SKILL.md` を対象にする。したがって `SKILL.md` に独自の
`provides`、`uses`、`tags`、`execution_policy` があることを前提にしない。

scan は見つかったスキルの `SKILL.md` 全文を読み、エージェントがその全文から
capability 情報を推論し、catalog 化へ進む。

## 目標

成果物の流れを次の3段階にする。

1. `.sdp/skill-scan-list.json`
2. `.sdp/skill-reference-inferences.json`
3. `.sdp/skill-reference-catalog.json`

Catalog は flow 非依存のままにし、invocation slot は Flow Profile 側にだけ置く。

## 実装タスク

1. 標準 `SKILL.md` だけを使う回帰テストを追加する。
2. scan 結果用の型と schema を追加する。
3. inference 成果物用の型と schema を追加する。
4. scanner を `SKILL.md` 全文を保存する raw scan に変更する。
5. scan list と inference を結合する enrichment 層を追加する。
6. `sdp scan`、`sdp infer`、`sdp profile` の順に変更する。
7. validate の staleness と deterministic gate を新フローに合わせる。
8. integration fixture を標準 `SKILL.md` と inference JSON に更新する。
9. protocol docs と bundled skill docs を更新する。
10. schema と bundled scripts を再生成し、検証を実行する。

## 検証

- focused SDP tests
- package tests
- `apm compile --validate`
- `git diff --check`
- updated protocol docs の scoped markdownlint
