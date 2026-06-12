# apm-package-judge

`apm-package-judge` は、APM package を component ごとの専門 judge と dependency graph aware synthesis で評価する semantic review package です。

この package は mechanical audit を実行しません。`apm audit --ci`、lockfile correctness、content hash、drift check などは対象外です。評価対象は、agent が package を読んだときに正しく、安全に、有用に、過剰な context cost なしで振る舞えるかです。

## Entry point（エントリーポイント）

標準の entrypoint skill は次です。

```text
.apm/skills/apm-semantic-package-judge/SKILL.md
```

日本語版 `SKILL.ja.md` は参照用 localization です。runtime entrypoint は、harness が明示的に localization を選択しない限り標準の `SKILL.md` です。

## Architecture（構成）

```text
apm-semantic-package-judge
  -> apm-dependency-graph-reviewer
      -> apm-dependency-graph-builder
      -> apm-dependency-graph-judge
  -> component reviewer agents
      -> apm-skill-component-judge
      -> apm-agent-component-judge
      -> apm-prompt-component-judge
      -> apm-instruction-component-judge
      -> apm-mcp-component-judge
      -> apm-hook-command-component-judge
  -> apm-package-synthesizer
      -> apm-package-synthesis-judge
```

## Component judges（component judge）

各 component judge は 120 点満点です。Package synthesis は 160 点満点です。最終 score は component score の単純平均ではなく、graph findings、cap rules、cross-component conflicts、semantic safety、context efficiency を使って決めます。

## Calibration guide（キャリブレーションガイド）

`references/judge-calibration-guide.md` と `references/judge-calibration-guide.ja.md` が、component judges 全体の採点粒度を揃えます。各 component judge は採点前にこの guide を読み、package synthesis judge は final score の前に読みます。

## Source layout（source layout）

APM source primitives は `.apm/` 配下に置きます。

```text
.apm/skills/<name>/SKILL.md
.apm/agents/*.agent.md
.apm/prompts/*.prompt.md
.apm/instructions/*.instructions.md
.apm/hooks/*.json
```

日本語参照版は `.ja.md` として提供します。runtime entrypoint は、harness が明示的に localized files を選択しない限り、標準の非 localized filenames です。
