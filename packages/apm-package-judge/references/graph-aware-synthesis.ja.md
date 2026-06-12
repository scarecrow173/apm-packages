# Graph-Aware Package Synthesis

dependency graph findings を package-level evidence として使う。それらを単なる別の component report として扱ってはならない。graph findings は composition によって生じる emergent behavior を説明する。

## Graph inputs

期待される入力:

- dependency graph JSON
- dependency graph semantic review report
- component review reports
- package inventory
- package docs または manifest excerpts

## graph findings の使い方

### P1 Package Intent & Value Delta

以下の場合は P1 を下げる。

- unrelated dependency branches が package purpose 外の capabilities を導入している
- transitive dependency が core value を提供しているにもかかわらず、root package docs が composition を説明していない
- graph が、多数の support components を示す一方で明確な center of gravity を示さない

### P2 Component Coverage & Role Separation

以下の場合は P2 を下げる。

- 複数 components が同じ role を担う
- provenance graph が異なる packages 由来の duplicate skills/instructions を示す
- component responsibilities を package intent へ追跡できない

### P3 Activation Architecture

以下の場合は P3 を下げる。

- semantic interaction graph が activation collisions を示す
- 複数 skills/agents/prompts が precedence なしに同じ task を対象にする
- prompts が意図された skills または agents を bypass する

### P4 Cross-Component Coherence

以下の場合は P4 を下げる。

- instruction overlap edges が contradictory である
- prompts、skills、agents が incompatible workflows を指示する
- local overrides が documentation なしに dependency behavior を shadow する

### P5 Semantic Safety & Trust Boundaries

以下の場合は P5 を下げる。

- capability exposure graph が undisclosed MCP/tools/hooks/scripts を示す
- state-changing capabilities が dependencies 経由で現れる
- agents が package-level disclosure なしに broad tool access を持つ
- graph が benign prompt から mutating command/hook への path を示す

### P6 Context Efficiency

以下の場合は P6 を下げる。

- dependency graph が broad always-on instructions を追加する
- 同じ domain に対して類似 instructions または skills が多数読み込まれる
- root package が stated use case に不要な transitive context を含む

### P7 Runtime Usefulness

以下の場合は P7 を下げる。

- graph が clear task activation paths を特定できない
- core runtime path が多数の無関係な components を必要とする
- representative tasks が conflicting components を activate する

### P8 Maintainability & Evolvability

以下の場合は P8 を下げる。

- provenance が曖昧である
- 重要な behavior が deep dependencies 由来である
- graph が documentation なしに high fan-in/fan-out を持つ
- ownership boundaries が不明確である

## Default cap rules

| Graph finding | Package impact |
|---|---|
| Critical surprise capability | max grade D; P5 <= 8 |
| Undisclosed transitive MCP/tool | P5 <= 10 |
| Runtime activation collision | P3 <= 10; max grade C |
| Contradictory overlapping instruction | P4 <= 10; max grade C |
| Prompt bypasses intended safety path | P4 <= 12 and P5 <= 12 |
| Deep dependency dominance without docs | P1 <= 12 and P8 <= 14 |
| Dependency-induced context bloat | P6 <= 12 |
| Provenance ambiguity for core behavior | confidence cannot be high |

## Reporting requirement

最終 package report には、graph が partial であっても `Dependency / Interaction Graph Findings` section を含める必要がある。graph を構築できなかった場合は理由を明記し、dependency-using package では confidence を下げる。
