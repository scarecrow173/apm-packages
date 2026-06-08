# Skill Discovery Protocol — Operation Policy

Version: 1.0.0

This document defines the rules and constraints governing how SDP artifacts
are created, updated, and validated. Manual editing of generated artifacts
is forbidden.

For CLI usage, adapter schema, and resolution semantics, see `cli-reference.md`.

---

## 1. Script-Only Operation Rule

**All artifact operations MUST go through the `sdp` CLI.**

### 1.1 Forbidden Actions

- Hand-editing any JSON artifact (`*-catalog.json`, `*-profile.json`,
  `validation-report.json`, `resolved-invocations.json`)
- Hand-editing any derived Markdown artifact (`.md` sidecars generated
  by `sdp profile`)
- Modifying artifact content via external scripts that bypass `sdp`

### 1.2 Allowed Manual Edits

The following files are **configuration**, not generated output, and MAY
be edited manually:

- Adapter YAML files (`skill-discovery-protocol/assets/adapters/*.yaml`, flow-specific `references/*.yaml`)
- `SKILL.md` / `SKILL.ja.md` (skill definition documents)
- `protocol-contract.md` and other reference documentation
- Source scripts (`src/skills/**/scripts/*.ts`)

### 1.3 Exception Conditions

Manual artifact editing is allowed ONLY when:

1. The `sdp` CLI is broken and cannot generate output (emergency recovery)
2. The edit is immediately followed by `sdp validate` to confirm conformance
3. A comment `# MANUAL_EDIT: <reason>` is added to the commit message

---

## 2. Script Responsibility Separation

The CLI is divided into three responsibility domains:

| Command | Responsibility | Verb |
| ------- | -------------- | ---- |
| `sdp scan` | Create and update scan artifact | Write |
| `sdp infer` | Initialize, schema-check, and update agent-authored inference artifact | Write |
| `sdp profile` | Create and update catalog/profile artifacts | Write |
| `sdp validate` | Verify artifact correctness | Read + Check |
| `sdp query` | Extract information from artifacts | Read |

### 2.1 Generate Scripts

- Exit `0` on success, `1` on input error, `2` on schema error
- **Note:** `validate_outputs` (protocol-contract step 8) is NOT auto-executed
  after generation. Validation is a separate command (`sdp validate`) to allow
  independent CI/CD orchestration.

### 2.2 Validate Scripts

- Exit `0` if all gates pass, `1` if any gate fails, `2` on input error

### 2.3 Query Scripts

- Pure read-only operation; never modifies files
- Exit `0` on success (empty result = empty array), `1` on input error,
  `2` on unknown subcommand

### 2.4 Inference Editing Rule

Agents MUST use `sdp infer` subcommands for inference edits. The intended loop is:

1. `sdp infer init` creates or merges baseline entries from scan results.
2. The agent inspects scanned skill bodies and prepares per-skill inference specs or JSONL operations.
3. `sdp infer set-skill` or `sdp infer apply` records the decisions.
4. `sdp infer check` verifies the artifact before `sdp profile`.

---

## 3. Build Pipeline

### 3.1 Source to Output Path

```text
src/skills/skill-discovery-protocol/scripts/*.ts
  → esbuild (bundled, ESM)
  → .apm/skills/skill-discovery-protocol/scripts/*.js
```

### 3.2 Build Command

```bash
pnpm run build:scripts
```

This invokes `tsx scripts/build-skill-scripts.ts` which uses esbuild to
compile all TypeScript sources under `src/skills/**/scripts/` into their
corresponding `.apm/skills/**/scripts/` output locations.

### 3.3 Invariants

- Output `.js` files are committed to the repository (they are the
  distributable form consumed by agents)
- Source `.ts` files are the single source of truth
- Any modification to `.ts` MUST be followed by `pnpm run build:scripts`
- The build MUST be deterministic (same source → same output bytes)

---

## 4. Naming Convention

### 4.1 `snake_case` Requirement

The following identifiers MUST use `snake_case`:

- `slot_id` in `flow_stack.slots[]`
- `capability` values in `provides[]` and `uses[]`
- Override keys in `invocation_resolution.overrides.slots`
- Override keys in `invocation_resolution.overrides.capabilities`
- `taxonomy[].id` in `classification`
- `taxonomy[].match.capabilities[]` values

### 4.2 Enforcement

Any identifier that does not match the pattern `^[a-z][a-z0-9]*(_[a-z0-9]+)*$`
is a **schema error** and causes Gate 1 (Schema Validation) to fail.

### 4.3 Rationale

- Consistency across all adapters and artifacts
- Machine-readable without ambiguity (no case-folding issues)
- Compatible with YAML keys and JSON field names

---

## 5. `extends` Resolution Rules

### 5.1 Reference Name Resolution

`extends` values are reference names, NOT file paths.

Resolution algorithm:

```text
searchDirs = walk up from adapter file directory within the current skill tree,
             collecting each ancestor's "assets/adapters/" if it exists,
             then append the bundled "skill-discovery-protocol/assets/adapters/"

for name in extends:
  for dir in searchDirs:
    candidates = [
      "{dir}/{name}.yaml",
      "{dir}/{name}.yml"
    ]
    if both exist in same dir → schema error
    if one exists → resolved, stop searching
  if not found in any dir → schema error
```

The legacy `.apm/assets/adapters/` copy is not part of `extends` resolution.

### 5.2 Merge Semantics

- Declaration order: `extends: [a, b]` → resolve `a` first, then `b`
- Merge direction: top-most parent → ... → direct parent → child adapter
- Object fields: recursive merge (child wins on conflict)
- Scalar fields: last writer wins
- Array fields: child replaces entirely (no append)

### 5.3 Constraints

- Direct path writing is FORBIDDEN (e.g., `extends: ["./my-adapter.yaml"]`)
- `priority` key is FORBIDDEN anywhere (schema error if present)
- Circular references are a schema error
- Nested extends are allowed (recursive resolution up to root)
- Schema validation runs on the FINAL merged result
