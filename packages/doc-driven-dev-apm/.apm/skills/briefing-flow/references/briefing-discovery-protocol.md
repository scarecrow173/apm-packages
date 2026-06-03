# Briefing Skill Discovery Protocol Reference

This flow uses the common `skill-discovery-protocol` for profile management.

## Quick Reference

Invoke `skill-discovery-protocol` instead of calling `sdp` directly from this flow.

- Adapter path: `.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml`
- Expected profile path: `.sdp/briefing-flow-default/briefing-profile.json`
- Expected inference artifact: `.sdp/skill-reference-inferences.json`
- Ask the skill to generate, validate, or query the profile artifacts as needed.

## Adapter

The flow-specific adapter is at `assets/adapters/briefing-adapter.yaml`.
It extends the `general` adapter and defines:

- Briefing-specific taxonomy (Frame/Discover/Research/Validate/Document/Meta)
- Flow stack slots (frame_structure/discover_gather/validate_check/document_output)
- Invocation resolution rules

## Entry Decision Integration

Entry Decisions (A-1 through A-5) drive skill activation during Phase B:

- A-1 (Problem Framing) / A-2 (Option Framing) → frame-category priority
- A-3 (Combined Discovery) → all categories considered
- A-5 (Research Required) → discover/research-category priority
- A-4 (Direct Start) → document-category only

These decisions affect which `flow_stack.slots` are activated, not the profile structure itself.
