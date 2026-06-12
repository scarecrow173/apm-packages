# Judge Calibration Guide 日本語版

すべての component judges の採点を一貫させるためにこの guide を使う。Content は expert knowledge/value delta、trigger quality、anti-pattern specificity、progressive disclosure、freedom calibration、practical usability に基づいて評価する。

## When to read this guide（いつ読むか）

- entrypoint orchestrator は reviewers を dispatch する前に読む。
- component judges は個別 component の採点直前に読む。
- dependency graph judge は graph findings を採点する前に読む。
- package synthesis judge は final package score を割り当てる前に読む。

## Universal calibration questions（共通キャリブレーション質問）

すべての component type に対して以下を問う:

1. この component は正しいタイミングで発火するか。
2. base model が安定して適用できない knowledge または behavior を追加しているか。
3. happy-path instructions だけでなく、boundaries と anti-patterns を定義しているか。
4. task fragility に対して freedom level が適切か。
5. expected output または return contract は明確か。
6. always-on、preload、resource-loading の token waste を避けているか。
7. dependencies と sibling components と安全に compose できるか。
8. realistic eval task で機能しているか検出できるか。

## Score normalization（score 正規化）

Component judges は 120 点満点で採点する。Package synthesis は 160 点満点で採点する。常に raw score と percentage の両方を報告する。

## Trigger quality rule（発火品質ルール）

Activation text は runtime behavior である。強い description は以下を含む:

- WHAT: component が何をするか
- WHEN: いつ使うべきか
- KEYWORDS: user requests や package files に現れやすい語
- EXCLUSIONS: 似ているが誤った適用対象

## Component type bias（component type ごとの重みづけ）

- Skills: expert knowledge と progressive disclosure を重く見る。
- Agents: delegation trigger、tool boundary、return contract を重く見る。
- Prompts: invocation contract、input handling、output contract を重く見る。
- Instructions: scope precision と always-on context cost を重く見る。
- MCP: tool descriptions、schemas、side effects、trust boundary を重く見る。
- Hooks/commands: deterministic trigger、idempotency、side effects、failure behavior を重く見る。
- Graph: provenance、collisions、hidden capabilities、synthesis usefulness を重く見る。
- Package: composition を重く見る。単純平均は使わない。
