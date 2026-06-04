---
type: implementation-profile
version: "1.0"
generated: "YYYY-MM-DD"
last_validated: "YYYY-MM-DD"
repository: "<repository-name>"
---

# Implementation Profile

このテンプレートは、リポジトリ固有の implementation profile を再生成・確認するときだけ使います。
プレースホルダの値を実行時の既定値として扱わないでください。

縺薙・繝輔ぃ繧､繝ｫ縺ｯ縺薙・繝ｪ繝昴ず繝医Μ縺ｮ繧ｹ繧ｭ繝ｫ讒区・繧貞ｮ夂ｾｩ縺励∪縺吶・`implementation-flow` 縺ｫ繧医ｋ繧ｹ繧ｭ繝ｫ逋ｺ隕九・繝ｭ繝医さ繝ｫ縺ｧ逕滓・縺輔ｌ縺ｾ縺吶・
## Available Skills・亥茜逕ｨ蜿ｯ閭ｽ縺ｪ繧ｹ繧ｭ繝ｫ・・
| Name | Category | Source | Activation | Execution | Condition |
| ---- | -------- | ------ | ---------- | --------- | --------- |
| test-driven-development | Build | .apm/skills/ | always-on | rigid | 窶・|
| incremental-implementation | Build | .apm/skills/ | always-on | rigid | 窶・|
| systematic-debugging | Process | .apm/skills/ | conditional | rigid | 繝舌げ菫ｮ豁｣縺ｾ縺溘・繝・せ繝亥､ｱ謨・|
| source-driven-development | Verify | .apm/skills/ | conditional | flexible | 繝輔Ξ繝ｼ繝繝ｯ繝ｼ繧ｯ/繝ｩ繧､繝悶Λ繝ｪ菴ｿ逕ｨ |
| doubt-driven-development | Verify | .apm/skills/ | conditional | flexible | 隍・焚縺ｮ驕ｸ謚櫁い縺後≠繧矩撼閾ｪ譏弱↑豎ｺ螳・|
| requesting-code-review | Review | .apm/skills/ | always-on | flexible | 窶・|
| receiving-code-review | Review | .apm/skills/ | conditional | flexible | 繝ｬ繝薙Η繝ｼ繝輔ぅ繝ｼ繝峨ヰ繝・け蜿嶺ｿ｡ |
| subagent-driven-development | Build | .apm/skills/ | conditional | rigid | 蟋碑ｭｲ縺ｫ驕ｩ縺励◆繧ｿ繧ｹ繧ｯ |
| dispatching-parallel-agents | Build | .apm/skills/ | conditional | rigid | 隍・焚縺ｮ迢ｬ遶九＠縺溘ち繧ｹ繧ｯ |
| <!-- 莉･荳九↓逋ｺ隕九＆繧後◆繧ｹ繧ｭ繝ｫ繧定ｿｽ蜉 --> | | | | | |

## Category Assignments・医き繝・ざ繝ｪ蜑ｲ繧雁ｽ薙※・・

### Process

繧ｿ繧ｹ繧ｯ縺ｸ縺ｮ繧｢繝励Ο繝ｼ繝∵婿豕輔ｒ豎ｺ螳壹☆繧九せ繧ｭ繝ｫ縲・
- systematic-debugging 窶・菫ｮ豁｣蜑阪・譬ｹ譛ｬ蜴溷屏險ｺ譁ｭ

### Build

螳溯｣・ｒ讒矩蛹悶＠縺ｦ螳溯｡後☆繧九せ繧ｭ繝ｫ縲・
- test-driven-development 窶・RED-GREEN-REFACTOR 繧ｵ繧､繧ｯ繝ｫ
- incremental-implementation 窶・阮・＞蝙ら峩繧ｹ繝ｩ繧､繧ｹ
- subagent-driven-development 窶・繝ｬ繝薙Η繝ｼ莉倥″繧ｿ繧ｹ繧ｯ蟋碑ｭｲ
- dispatching-parallel-agents 窶・荳ｦ陦檎峡遶句ｮ溯｡・

### Verify

讓ｩ髯舌・縺ゅｋ繧ｽ繝ｼ繧ｹ縺ｫ蟇ｾ縺吶ｋ豁｣遒ｺ諤ｧ繧呈､懆ｨｼ縺吶ｋ繧ｹ繧ｭ繝ｫ縲・
- source-driven-development 窶・蜈ｬ蠑上ラ繧ｭ繝･繝｡繝ｳ繝域､懆ｨｼ
- doubt-driven-development 窶・豎ｺ螳壹・蟇ｾ謚礼噪繝ｬ繝薙Η繝ｼ

### Review

螳溯｣・ｾ後・蜩∬ｳｪ繧ｲ繝ｼ繝医ｒ謠蝉ｾ帙☆繧九せ繧ｭ繝ｫ縲・
- requesting-code-review 窶・繝ｬ繝薙Η繝ｼ蜑阪メ繧ｧ繝・け繝ｪ繧ｹ繝・
- receiving-code-review 窶・繝ｬ繝薙Η繝ｼ繝輔ぅ繝ｼ繝峨ヰ繝・け蜃ｦ逅・

### Domain

險隱槭√ヵ繝ｬ繝ｼ繝繝ｯ繝ｼ繧ｯ縲√∪縺溘・繝励Λ繝・ヨ繝輔か繝ｼ繝蝗ｺ譛峨・繧ｬ繧､繝繝ｳ繧ｹ縲・
- <!-- 萓・ typescript-conventions -->
- <!-- 萓・ react-patterns -->
- <!-- 萓・ api-and-interface-design -->

### Tooling

繝・・繝ｫ蝗ｺ譛峨・繝ｯ繝ｼ繧ｯ繝輔Ο繝ｼ縲・
- <!-- 萓・ git-workflow-and-versioning -->
- <!-- 萓・ ci-cd-and-automation -->
- <!-- 萓・ browser-testing-with-devtools -->

## Default Stack

讓呎ｺ也噪縺ｪ螳溯｣・ち繧ｹ繧ｯ逕ｨ縺ｮ蝓ｺ譛ｬ繧ｹ繧ｭ繝ｫ邨・∩蜷医ｏ縺帙・

| Priority | Category | Skill | Rationale |
| -------- | -------- | ----- | --------- |
| 1 | Build | test-driven-development | 繝・せ繝医′縺吶∋縺ｦ縺ｮ螟画峩縺ｮ豁｣遒ｺ諤ｧ繧貞ｮ夂ｾｩ |
| 2 | Build | incremental-implementation | 繝薙ャ繧ｰ繝舌Φ螟画峩繧帝亟豁｢ |
| 3 | Review | requesting-code-review | 縺吶∋縺ｦ縺ｮ繧ｿ繧ｹ繧ｯ縺後Ξ繝薙Η繝ｼ繧貞女縺代ｋ |

## Override Rules

| Condition | Action | Reason |
| --------- | ------ | ------ |
| 繝舌げ菫ｮ豁｣縺ｾ縺溘・繝・せ繝亥､ｱ謨・| 蜆ｪ蜈・ systematic-debugging 繧貞・鬆ｭ縺ｫ | 菫ｮ豁｣蜑阪↓險ｺ譁ｭ縺悟ｿ・・|
| 繝輔Ξ繝ｼ繝繝ｯ繝ｼ繧ｯ/繝ｩ繧､繝悶Λ繝ｪ菴ｿ逕ｨ繧呈､懷・ | 霑ｽ蜉: source-driven-development | 蜈ｬ蠑上ラ繧ｭ繝･繝｡繝ｳ繝医↓蟇ｾ縺励※讀懆ｨｼ |
| 髱櫁・譏弱↑繧｢繝ｼ繧ｭ繝・け繝√Ε豎ｺ螳・| 霑ｽ蜉: doubt-driven-development | 繧ｳ繝溘ャ繝亥燕縺ｫ繧｢繝励Ο繝ｼ繝√↓逡ｰ隴ｰ |
| 隍・焚縺ｮ迢ｬ遶九＠縺溘し繝悶ち繧ｹ繧ｯ | 鄂ｮ謠・ dispatching-parallel-agents 縺ｧ Build 繧堤ｽｮ謠・| 蜉ｹ邇・・縺溘ａ縺ｫ繝輔ぃ繝ｳ繧｢繧ｦ繝・|
| <!-- 繝ｪ繝昴ず繝医Μ蝗ｺ譛峨・繧ｪ繝ｼ繝舌・繝ｩ繧､繝峨ｒ霑ｽ蜉 --> | | |
