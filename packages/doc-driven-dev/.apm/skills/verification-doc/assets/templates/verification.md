# {{title}}

## Purpose

<!-- The verification intent this design preserves: which claims it
     checks and when the design may be retired. -->

## Scope

<!-- The claims, contracts, or behaviors this design verifies — and the
     boundaries it stays inside. -->

## Checks

<!-- The authoritative check list is the front-matter `checks:` array —
     the sole Check→Claim authority. Each entry is a VerificationCheckV1
     { id, target, method, implementation, preconditions, passCriteria,
     limitations, required }: `id` is a stable CHK-NN key, `target` a
     qualified Claim reference (DOC-ID::KEY), `method` one of unit /
     integration / e2e / property / static / model-checking /
     formal-proof / runtime-monitoring / manual-review, and
     `passCriteria.kind` must equal `method`. Describe each check's intent
     in prose here and bind it to its front-matter id with a body anchor
     of the form check:CHK-NN inside an HTML comment. -->

## Non-goals

<!-- What this design deliberately does not verify. -->
