# General Adapter Location Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the canonical `general.yaml` adapter into `skill-discovery-protocol/assets/adapters`, remove new dependence on `.apm/assets/adapters/general.yaml`, and keep flow adapters resolving `extends: "general"` without path changes.

**Architecture:** Update adapter resolution in `skill-discovery-protocol` so ancestor `assets/adapters` directories are searched first, then the bundled `skill-discovery-protocol/assets/adapters` directory is always appended as the final fallback. Keep `briefing-flow` and `implementation-flow` adapter files pointing at `extends: "general"`, and move the canonical YAML plus documentation wording to the new location. Add regression tests that prove both flow adapters resolve the bundled `general.yaml` and that the legacy root copy is no longer required.

**Tech Stack:** TypeScript, Node.js `node:test`, YAML adapter configs, `pnpm` build scripts.

---

### Task 1: Relocate the canonical general adapter

**Files:**
- Create: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/assets/adapters/general.yaml`
- Optional delete later: `packages/doc-driven-dev-apm/.apm/assets/adapters/general.yaml`

- [ ] **Step 1: Copy the current general adapter content into the bundled skill-discovery-protocol location**

Use the existing `general.yaml` content unchanged except for its location.

- [ ] **Step 2: Verify no flow adapter points to a path instead of `extends: "general"`**

Check `packages/doc-driven-dev-apm/.apm/skills/briefing-flow/assets/adapters/briefing-adapter.yaml` and `packages/doc-driven-dev-apm/.apm/skills/implementation-flow/assets/adapters/implementation-adapter.yaml`.

- [ ] **Step 3: Leave the legacy root copy in place until tests confirm zero dependency**

Do not remove `.apm/assets/adapters/general.yaml` until the new resolution path is proven by tests.

### Task 2: Update adapter extends resolution

**Files:**
- Modify: `packages/doc-driven-dev-apm/src/skills/skill-discovery-protocol/scripts/lib/adapter.ts`

- [ ] **Step 1: Add the bundled `skill-discovery-protocol/assets/adapters` directory to the search order**

Resolve `extends` by checking ancestor `assets/adapters` directories first, then the bundled directory for the protocol package.

- [ ] **Step 2: Keep circular detection and merge semantics intact**

Preserve existing validation and deep-merge behavior.

- [ ] **Step 3: Regenerate the bundled script outputs**

Run `pnpm -C packages/doc-driven-dev-apm run build:scripts` after the TypeScript change so `.apm/skills/.../scripts/*.js` stays in sync.

### Task 3: Update docs for the new canonical location

**Files:**
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/schema-reference.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/schema-reference.ja.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/operation-policy.md`
- Modify: `packages/doc-driven-dev-apm/.apm/skills/skill-discovery-protocol/references/operation-policy.ja.md`

- [ ] **Step 1: Rewrite references to say the canonical `general.yaml` lives under `skill-discovery-protocol/assets/adapters`**

- [ ] **Step 2: Update the `extends` resolution description to match the new search order**

- [ ] **Step 3: Keep English/Japanese structure aligned**

### Task 4: Add regression coverage

**Files:**
- Modify: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/integration.test.ts`
- Modify: `packages/doc-driven-dev-apm/tests/skills/skill-discovery-protocol/profile.test.ts` if needed

- [ ] **Step 1: Add a test that the briefing flow resolves `general` from the bundled protocol assets**

- [ ] **Step 2: Add a test that the implementation flow resolves `general` from the bundled protocol assets**

- [ ] **Step 3: Add a test that fails if resolution depends on `.apm/assets/adapters/general.yaml`**

### Task 5: Verify and clean up

**Files:**
- Optional delete: `packages/doc-driven-dev-apm/.apm/assets/adapters/general.yaml`

- [ ] **Step 1: Run the focused skill-discovery-protocol tests**

- [ ] **Step 2: Confirm no references to the legacy root copy remain**

- [ ] **Step 3: Delete the legacy copy only after the tests pass and searches show no live references**

