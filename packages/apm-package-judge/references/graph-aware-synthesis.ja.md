# Graph-Aware Package Synthesis

Dependency graph findings を package-level evidence として使う。Graph findings は別の component report として扱わない。Graph findings は composition によって生まれる emergent behavior を記述する。

## Graph inputs（graph 入力）

Expected inputs:

- dependency graph JSON
- dependency graph semantic review report
- component review reports
- package inventory
- package docs または manifest excerpts

## How to use graph findings（graph findings の使い方）

### P1 Package Intent & Value Delta

次の場合は P1 を下げる:

- unrelated dependency branches が package purpose 外の capabilities を導入する。
- transitive dependency が core value を提供しているが、root package docs が composition を説明していない。
- graph が多くの support components を示す一方、clear center of gravity がない。

### P2 Component Coverage & Role Separation

次の場合は P2 を下げる:

- 複数 components が同じ role を果たしている。
- provenance graph が別 package 由来の duplicate skills/instructions を示す。
- component responsibilities を package intent へ trace できない。

### P3 Activation Architecture

次の場合は P3 を下げる:

- semantic interaction graph が activation collisions を示す。
- 複数 skills/agents/prompts が precedence なしに同じ task を対象にしている。
- prompts が intended skills または agents を bypass している。

### P4 Cross-Component Coherence

次の場合は P4 を下げる:

- instruction overlap edges が contradictory。
- prompts、skills、agents が incompatible workflows を指示している。
- local overrides が documentation なしに dependency behavior を shadow している。

### P5 Semantic Safety & Trust Boundaries

次の場合は P5 を下げる:

- capability exposure graph が undisclosed MCP/tools/hooks/scripts を示す。
- state-changing capabilities が dependencies 経由で現れる。
- agents が package-level disclosure なしに broad tool access を持つ。
- graph が benign prompt から mutating command または hook への path を示す。

### P6 Context Efficiency

次の場合は P6 を下げる:

- dependency graph が broad always-on instructions を追加する。
- 同じ domain に多くの類似 instructions または skills が load される。
- root package が stated use case に不要な transitive context を含む。

### P7 Runtime Usefulness

次の場合は P7 を下げる:

- graph が clear task activation paths を特定できない。
- core runtime path が多数の unrelated components を必要とする。
- representative tasks が conflicting components を activate する。

### P8 Maintainability & Evolvability

次の場合は P8 を下げる:

- provenance が ambiguous。
- 重要 behavior が deep dependencies に由来する。
- graph が documentation なしに high fan-in/fan-out を持つ。
- ownership boundaries が不明瞭。

## Default cap rules（既定 cap rules）

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

## Reporting requirement（レポート要件）

Final package report は、graph が partial であっても `Dependency / Interaction Graph Findings` section を含む必要がある。Graph を構築できなかった場合は理由を明記し、dependencies を持つ package では confidence を下げる。
