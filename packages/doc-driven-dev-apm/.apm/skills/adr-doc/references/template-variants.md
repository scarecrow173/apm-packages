# ADR Template Variants

This reference defines how to choose between the MADR 4.0.0 templates bundled
with the `adr-doc` skill.

## Default

Use `minimal` by default only when the decision is simple, unlikely to be
misread, and has little meaningful trade-off to preserve.

When in doubt, choose `full`. Missing reasoning is harder to recover later than
extra structure is to leave empty during drafting.

## Variant Summary

| Template | Use when |
| --- | --- |
| `minimal` | The decision is simple, low-risk, unlikely to be misunderstood, and has minimal trade-off. |
| `full` | The decision needs structured reasoning, explicit trade-offs, or durable comparison between options. |
| `bare-minimal` | Existing repository conventions already define ADR wording, and only the minimal MADR section structure should be inserted. |
| `bare` | Existing repository conventions already define ADR wording, but the full MADR section structure is useful. |

## Choose `full`

Choose `full` when any of these are true:

- There are multiple real options and the ADR should preserve structured
  trade-offs.
- Decision drivers must be explicit, including which criteria mattered.
- The decision is likely to be revisited, and the comparison between options
  needs to survive.
- Stakeholders need to see the reasoning process, not just the outcome.
- The decision is high-impact, cross-team, risky, compliance-relevant, or
  operationally difficult to reverse.

Use `full` for decisions where future readers will need to understand why the
chosen option was better than realistic alternatives.

## Choose `minimal`

Choose `minimal` only when all of these are true:

- The decision is simple and local.
- The implementation path is unlikely to be misunderstood.
- The trade-off is obvious or minimal.
- Capturing context, considered options, and outcome is enough for future
  readers.
- Stakeholders do not need a detailed comparison of alternatives.

Do not use `minimal` merely because the team wants shorter ADRs. If the decision
has meaningful alternatives or non-obvious criteria, use `full`.

## Choose `bare` or `bare-minimal`

Choose a bare template only when an existing repository convention already
defines prose guidance and the skill should avoid adding template hints.

- Use `bare-minimal` when the repository needs only the minimal MADR section
  structure.
- Use `bare` when the repository benefits from the full MADR section structure
  but not from embedded guidance text.

Do not choose a bare template to hide uncertainty, skip trade-off analysis, or
make a complex ADR appear simple.
