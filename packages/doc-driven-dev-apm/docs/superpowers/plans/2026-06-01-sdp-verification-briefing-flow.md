---
id: "REPORT-SDP-BRIEF-20260601"
type: "report"
status: "done"
title: "SDP検証レポート briefing-flow"
created: "2026-06-01"
updated: "2026-06-01"
owners: []
relations:
  source:
    - ".apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml"
    - ".apm/skills/skill-discovery-protocol/scripts/profile.js"
    - ".apm/skills/skill-discovery-protocol/scripts/validate.js"
  references:
    - ".sdp/skill-reference-catalog.json"
    - ".sdp/briefing-flow-default/briefing-profile.json"
    - ".sdp/briefing-flow-default/validation-report.json"
---

# 実行コマンド
- `pnpm -s exec node .apm/skills/skill-discovery-protocol/scripts/profile.js --adapter .apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml` : exit 1
- `pnpm -s exec node .apm/skills/skill-discovery-protocol/scripts/validate.js --profile .sdp/briefing-flow-default/briefing-profile.json --adapter .apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml` : exit 1
- `node .apm/skills/skill-discovery-protocol/scripts/profile.js --adapter .apm/skills/briefing-flow/assets/adapters/briefing-flow/assets/adapters/briefing-adapter.yaml` : exit 0
- `node .apm/skills/skill-discovery-protocol/scripts/validate.js --profile .sdp/briefing-flow-default/briefing-profile.json --adapter .apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml` : exit 0

# 生成物パス
- `.sdp/skill-reference-catalog.json`（共有カタログ、未変更）
- `.sdp/briefing-flow-default/briefing-profile.json`
- `.sdp/briefing-flow-default/validation-report.json`

# Gate結果
- schema: pass
- staleness: pass
- deterministic: pass
- blocking: pass
- overall: pass

# 警告/注意点
- `validation-report.json` 内の警告項目はなし（`unused_override_warnings: []`）。
- 本環境では `pnpm -s exec node ...` が無出力で exit 1 となるため、実検証は `node` 直実行で完了した。

# 判定（pass/fail）
- **pass**
