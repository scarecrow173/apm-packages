# Skill Discovery Protocol Reference

This flow uses the common `skill-discovery-protocol` for profile management.

## Quick Reference

| Action | Command |
|--------|---------|
| Generate profile | `sdp generate --adapter .apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml` |
| Validate profile | `sdp validate --profile implementation-profile.json` |
| List categories | `sdp query --profile implementation-profile.json categories` |
| Check skill stack | `sdp query --profile implementation-profile.json flow-stack` |
| Check resolution | `sdp query --profile implementation-profile.json resolution` |

## Adapter

The flow-specific adapter is at `assets/adapters/implementation-adapter.yaml`.
It extends the `general` adapter and defines:
- Implementation-specific taxonomy (Process/Build/Verify/Review/Domain/Tooling/Meta)
- Flow stack slots
- Invocation resolution overrides

## Migration from Old Protocol

The old `implementation-profile.md` (markdown format) is deprecated.
Use `implementation-profile.json` instead. The `sdp query` command provides
equivalent information extraction capabilities.
