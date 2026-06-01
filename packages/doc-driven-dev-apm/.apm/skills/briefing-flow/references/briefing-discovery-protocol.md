# Briefing Skill Discovery Protocol Reference

This flow uses the common `skill-discovery-protocol` for profile management.

## Quick Reference

| Action | Command |
|--------|---------|
| Generate profile | `sdp profile --adapter .apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml` |
| Validate profile | `sdp validate --profile briefing-profile.json` |
| List categories | `sdp query --profile briefing-profile.json categories` |
| Check skill stack | `sdp query --profile briefing-profile.json flow-stack` |
| Check resolution | `sdp query --profile briefing-profile.json resolution` |

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

## Migration from Old Protocol

The old `briefing-profile.md` (markdown format) is deprecated.
Use `briefing-profile.json` instead.
