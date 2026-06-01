---
id: "REPORT-SDP-IMPL-20260601"
type: "report"
status: "done"
title: "SDP検証レポート implementation-flow"
created: "2026-06-01"
updated: "2026-06-01"
owners: []
relations:
  source:
    - ".apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml"
    - ".apm/skills/skill-discovery-protocol/scripts/generate.js"
    - ".apm/skills/skill-discovery-protocol/scripts/validate.js"
  references:
    - ".sdp/skill-reference-catalog.json"
    - ".sdp/implementation-flow-default/implementation-flow-profile.json"
    - ".sdp/implementation-flow-default/validation-report.json"
---

# 実行コマンド
- pnpm -s exec node .apm/skills/skill-discovery-protocol/scripts/generate.js --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml（exit 0）
- pnpm -s exec node .apm/skills/skill-discovery-protocol/scripts/validate.js --profile .sdp/implementation-flow-default/implementation-flow-profile.json --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml（exit 0）

# 生成物パス
- .sdp/skill-reference-catalog.json（shared catalog, unchanged）
- .sdp/implementation-flow-default/implementation-flow-profile.json
- .sdp/implementation-flow-default/validation-report.json

# ゲート結果
- overall_result: pass
- adapter_id: implementation-flow-default
- schema_validation.result: pass
- staleness_validation.result: pass
- deterministic_validation.result: pass
- blocking_validations.result: pass
- blocking_validations.checks: unresolved_required=pass, unknown_skill_override=pass, capability_mismatch=pass, override_not_allowed=pass, unused_slots=pass

# 警告/注意点
- 警告なし（validation-report.json 上の warnings 相当項目は空）
- shared catalog（.sdp/skill-reference-catalog.json）は更新なし

# 判定（pass/fail）
- pass
