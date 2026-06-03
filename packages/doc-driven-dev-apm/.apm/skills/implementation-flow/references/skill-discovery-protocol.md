# Skill Discovery Protocol Reference

This flow uses the common `skill-discovery-protocol` for profile management.

## Quick Reference

Invoke `skill-discovery-protocol` instead of calling `sdp` directly from this flow.

- Adapter path: `.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`
- Expected profile path: `.sdp/implementation-flow-default/implementation-flow-profile.json`
- Expected inference artifact: `.sdp/skill-reference-inferences.json`
- Ask the skill to generate, validate, or query the profile artifacts as needed.

## Adapter

The flow-specific adapter is at `assets/adapters/implementation-adapter.yaml`.
It extends the `general` adapter and defines:
- Implementation-specific taxonomy (Process/Build/Verify/Review/Domain/Tooling/Meta)
- Flow stack slots
- Invocation resolution overrides
