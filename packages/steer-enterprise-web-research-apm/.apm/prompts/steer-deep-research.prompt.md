---
agent: 'agent'
description: 'Run a SteER / Enterprise Deep Research style web investigation with evidence ledger, reflection, audit, and final report'
---

Run a SteER / Enterprise Deep Research style investigation.

Research topic:
${input:topic:What should be researched?}

Decision/use case:
${input:decision:What decision should this research support?}

Output format:
${input:format:Report, comparison table, implementation plan, best-practice guide, or other?}

Constraints:
${input:constraints:Timeframe, region, source preferences, exclusions, depth, or audience?}

Process requirements:

1. Create or mentally maintain:
   - todo plan
   - persona/intent model
   - query log
   - evidence ledger
   - running summary
   - audit notes

2. Search iteratively:
   - official/primary sources first where applicable
   - general web
   - academic sources when research-oriented
   - GitHub/source repositories when implementation-oriented
   - critical/negative query to detect limitations or contradictions

3. After each loop, audit:
   - coverage
   - source quality
   - freshness
   - contradictions
   - unresolved gaps
   - whether another targeted search is needed

4. Pause for user steering only when a major fork, ambiguity, contradiction, or high-cost branch would materially affect the result.

5. Final answer must include:
   - scope and assumptions
   - key findings
   - evidence-backed analysis
   - confidence labels
   - unresolved gaps
   - recommended next actions
   - citations or source list from inspected sources

Do not fabricate citations or facts. If search tools are unavailable, say so and produce a research plan only.
