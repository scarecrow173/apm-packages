import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { inventoryAll } from "../src/skills/skill-discovery-protocol/scripts/lib/load_inventory";

/**
 * Issue #126 Task 4 — deterministic profile resolution and staged-loading
 * verification.
 *
 * Contract under test (progressive-loading-contract.md §1):
 * - Stage-1 profile resolution is deterministic: same scan + inference inputs
 *   produce a byte-identical profile, and `sdp query` reads the same
 *   applicability decision on every run.
 * - Missing / corrupt / stale profiles are regenerated through the documented
 *   path (`sdp scan --adapter` + agent-authored inference + `sdp profile
 *   --adapter`), and `sdp validate` is the detector.
 * - HARD GATE: resolution without a valid profile must fail closed — never
 *   degrade to "all skills applicable".
 *
 * "Stale" semantics (verified against scripts/lib/gates/staleness_gate.ts):
 * the catalog's `validated_at`/`generated_at` older than the adapter's
 * `validation.staleness.max_age_days` (default 30), OR a live re-scan via the
 * adapter whose skill set differs from the catalog (`new_skills` /
 * `removed_skills`). There is no scan hash; content drift is covered by the
 * separate deterministic gate (re-generation diff modulo timestamps).
 *
 * The staged-loading regression guard compares a live `inventoryAll` run on
 * the real package against the audited artifacts committed under
 * `tests/fixtures/skill-discovery-inventory/`. `referencedBytes` is
 * deliberately not asserted: the audit's +714 KB increase was a re-attribution
 * (`impl-doc/scripts/new_impl_record.js` resolved once the path was fixed),
 * not new waste.
 */

const skillRoot = path.resolve(
  __dirname,
  "../../../packages/doc-driven-dev/.apm/skills",
);
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

const artifactsDir = path.resolve(
  __dirname,
  "fixtures/skill-discovery-inventory",
);

// ─── CLI helpers (generated bundle, same spawn convention as profile.test.ts) ───

type CliResult = { status: number | null; stdout: string; stderr: string };

function runSdp(script: string, args: string[], cwd: string): CliResult {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, script), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runScan(args: string[], cwd: string) {
  return runSdp("scan.js", args, cwd);
}
function runProfile(args: string[], cwd: string) {
  return runSdp("profile.js", args, cwd);
}
function runValidate(args: string[], cwd: string) {
  return runSdp("validate.js", args, cwd);
}
function runQuery(args: string[], cwd: string) {
  return runSdp("query.js", args, cwd);
}

// ─── Fixture: mini .sdp workspace ───

const ADAPTER_ID = "sdp-gate-test";
const PROFILE_REL = `.sdp/${ADAPTER_ID}/gate-test-profile.json`;
const CATALOG_REL = ".sdp/skill-reference-catalog.json";

function profileAbsPath(dir: string) {
  return path.join(dir, ".sdp", ADAPTER_ID, "gate-test-profile.json");
}
function catalogAbsPath(dir: string) {
  return path.join(dir, ".sdp", "skill-reference-catalog.json");
}

const GATE_ADAPTER = `schema_version: "1.0"
adapter_id: "${ADAPTER_ID}"

protocol:
  name: "skill-discovery-protocol"
  min_version: "1.0"

enabled: true

scan:
  scopes:
    project:
      enabled: true
      roots:
        - ".apm/skills"
    user:
      enabled: false
      roots: []
    organization:
      enabled: false
      roots: []
    builtin:
      enabled: false
      roots: []

profile:
  title: "Gate Test Profile"

flow_stack:
  slots:
    - slot_id: "alpha_authoring"
      slot_type: "exclusive"
      activation: "always"
      default:
        skill: "gate-skill-a"
        reason: "Primary alpha skill"
    - slot_id: "beta_review"
      slot_type: "layerable"
      activation: "always"
      default:
        - skill: "gate-skill-b"
          reason: "Default reviewer"

classification:
  unmatched:
    action: "assign"
    category: "uncategorized"
    severity: "warn"
  taxonomy:
    - id: "alpha"
      label: "Alpha"
      description: "Alpha authoring skills"
      match:
        capabilities: ["alpha_authoring"]
        tags: ["alpha"]
        description_patterns: []
    - id: "beta"
      label: "Beta"
      description: "Beta review skills"
      match:
        capabilities: ["beta_review"]
        tags: ["beta"]
        description_patterns: []
    - id: "uncategorized"
      label: "Uncategorized"
      description: "Fallback"
      match:
        capabilities: []
        tags: []
        description_patterns: []

invocation_resolution:
  overrides:
    slots: {}
    capabilities: {}
  resolution_order:
    - "slot_override"
    - "capability_override"
    - "default_skill"
    - "provider_lookup"
  unresolved:
    required: "fail"
    optional: "warn"
  invalid_override:
    unknown_skill: "fail"
    capability_mismatch: "warn"
    override_not_allowed: "warn"

validation:
  schema: true
  staleness:
    enabled: true
    basis: "validated_at"
    max_age_days: 30
  deterministic:
    enabled: true
    compare:
      - "profile"
  invocation:
    enabled: true

render:
  stable_sort:
    skills:
      - "name"
    invocations:
      - "source_skill"
      - "slot"
      - "capability"
  normalize_whitespace: true
  newline: "lf"

artifacts:
  protocol:
    skill_reference_catalog: "skill-reference-catalog.json"
    flow_profile: "gate-test-profile.json"

readable_outputs:
  enabled: false
  include: []
`;

type InferenceSkill = {
  name: string;
  review_status: string;
  provides: { capability: string; description?: string }[];
  uses: {
    capability: string;
    required: boolean;
    default_skill?: string;
    override_allowed: boolean;
  }[];
  execution_policy: Record<string, unknown>;
  tags: string[];
};

function inferenceEntry(name: string, overrides: Partial<InferenceSkill> = {}): InferenceSkill {
  return {
    name,
    review_status: "reviewed",
    provides: [],
    uses: [],
    execution_policy: {
      strictness: "flexible",
      sequence_required: false,
      allow_step_reordering: true,
      allow_partial_application: true,
      guidance: `${name} guidance`,
    },
    tags: [],
    ...overrides,
  };
}

const INFERENCE_SKILLS: InferenceSkill[] = [
  inferenceEntry("gate-skill-a", {
    provides: [{ capability: "alpha_authoring", description: "Author alpha docs" }],
    uses: [
      {
        capability: "beta_review",
        required: false,
        default_skill: "gate-skill-b",
        override_allowed: true,
      },
    ],
    tags: ["alpha"],
  }),
  inferenceEntry("gate-skill-b", {
    provides: [{ capability: "beta_review", description: "Review beta output" }],
    execution_policy: {
      strictness: "rigid",
      sequence_required: true,
      allow_step_reordering: false,
      allow_partial_application: false,
      guidance: "Follow strict review process",
    },
    tags: ["beta"],
  }),
];

const SKILL_C_INFERENCE = inferenceEntry("gate-skill-c", {
  provides: [{ capability: "gamma_research", description: "Gamma research" }],
  tags: ["gamma"],
});

function writeInferenceFile(dir: string, skills: InferenceSkill[]) {
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-reference-inferences.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-01-01T00:00:00Z",
        inference_source: "agent",
        skills,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function writeSkill(dir: string, name: string, description: string) {
  const skillDir = path.join(dir, ".apm", "skills", name);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---
name: ${name}
description: "${description}"
---

# ${name}

Use this skill for ${description}.
`,
    "utf8",
  );
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-profile-gate-"));
}

function setupProject(dir: string) {
  writeSkill(dir, "gate-skill-a", "alpha authoring");
  writeSkill(dir, "gate-skill-b", "beta review");
  fs.writeFileSync(path.join(dir, "gate-adapter.yaml"), GATE_ADAPTER, "utf8");
  writeInferenceFile(dir, INFERENCE_SKILLS);
}

/**
 * The documented regeneration path: the flow re-invokes the skill discovery
 * protocol with its adapter — `sdp scan` produces the scan list, the
 * agent-authored inference document is already in place, and `sdp profile`
 * writes catalog + adapter-scoped profile.
 */
function regenerate(dir: string) {
  const scan = runScan(["--adapter", "gate-adapter.yaml"], dir);
  assert.equal(scan.status, 0, `scan stderr: ${scan.stderr}`);
  const profile = runProfile(["--adapter", "gate-adapter.yaml"], dir);
  assert.equal(profile.status, 0, `profile stderr: ${profile.stderr}`);
}

function validateAll(dir: string) {
  return runValidate(
    ["--profile", PROFILE_REL, "--adapter", "gate-adapter.yaml"],
    dir,
  );
}

// ═══════════════════════════════════════════════════════════════════
// Step 1 — profile resolution determinism
// ═══════════════════════════════════════════════════════════════════

test("profile and catalog output are byte-identical across regeneration runs", () => {
  const dir = tempDir();
  setupProject(dir);

  regenerate(dir);
  const profilePath = profileAbsPath(dir);
  const catalogPath = catalogAbsPath(dir);
  assert.ok(fs.existsSync(profilePath), "profile must be produced at adapter-scoped path");
  const profile1 = fs.readFileSync(profilePath, "utf8");
  const catalog1 = fs.readFileSync(catalogPath, "utf8");

  regenerate(dir);
  const profile2 = fs.readFileSync(profilePath, "utf8");
  const catalog2 = fs.readFileSync(catalogPath, "utf8");

  assert.equal(profile2, profile1, "same inputs must yield byte-identical profile");
  assert.equal(catalog2, catalog1, "same inputs must yield byte-identical catalog");
});

test("sdp query resolution returns the same applicability decision on every run", () => {
  const dir = tempDir();
  setupProject(dir);
  regenerate(dir);

  const first = runQuery(["--profile", PROFILE_REL, "resolution"], dir);
  assert.equal(first.status, 0, `resolution stderr: ${first.stderr}`);
  const second = runQuery(["--profile", PROFILE_REL, "resolution"], dir);
  assert.equal(second.status, 0);
  assert.equal(second.stdout, first.stdout, "resolution output must be deterministic");

  const invocations = JSON.parse(first.stdout);
  assert.ok(Array.isArray(invocations) && invocations.length > 0);
  const knownSkills = new Set(["gate-skill-a", "gate-skill-b"]);
  const knownMethods = new Set([
    "slot_override",
    "capability_override",
    "default_skill",
    "provider_lookup",
  ]);
  for (const inv of invocations) {
    assert.ok(knownSkills.has(inv.resolved_skill), `unexpected resolved skill ${inv.resolved_skill}`);
    assert.ok(knownMethods.has(inv.resolution_method));
  }
  // The fixture resolves beta_review through the declared default_skill.
  assert.ok(
    invocations.some(
      (inv: { capability: string; resolved_skill: string }) =>
        inv.capability === "beta_review" && inv.resolved_skill === "gate-skill-b",
    ),
  );

  const flowStack1 = runQuery(["--profile", PROFILE_REL, "flow-stack"], dir);
  const flowStack2 = runQuery(["--profile", PROFILE_REL, "flow-stack"], dir);
  assert.equal(flowStack1.status, 0);
  assert.equal(flowStack2.stdout, flowStack1.stdout, "flow-stack output must be deterministic");
});

// ═══════════════════════════════════════════════════════════════════
// Step 2 — missing / corrupt / stale → regenerate + hard gate
// ═══════════════════════════════════════════════════════════════════

test("missing profile: query fails closed; documented path regenerates a valid profile", () => {
  const dir = tempDir();
  setupProject(dir);

  // Hard gate: with no profile, resolution must not answer at all — and
  // certainly not with an "all skills applicable" result.
  const blocked = runQuery(["--profile", PROFILE_REL, "resolution"], dir);
  assert.notEqual(blocked.status, 0, "query without a profile must not succeed");
  assert.ok(
    blocked.stderr.includes("Profile not found"),
    `expected fail-closed error, got: ${blocked.stderr}`,
  );
  assert.ok(
    !blocked.stdout.includes("gate-skill"),
    "fail-closed output must not claim any skill applicability",
  );

  // Documented contract path: re-invoke the protocol with the adapter.
  regenerate(dir);
  assert.ok(fs.existsSync(profileAbsPath(dir)), "adapter path must produce the profile");

  const valid = validateAll(dir);
  assert.equal(valid.status, 0, `validate stderr: ${valid.stderr}\nstdout: ${valid.stdout}`);
  assert.ok(valid.stdout.includes("Overall:       pass"));

  const resolved = runQuery(["--profile", PROFILE_REL, "resolution"], dir);
  assert.equal(resolved.status, 0);
  assert.ok(JSON.parse(resolved.stdout).length > 0);
});

test("corrupt JSON profile: validate reports invalid, query fails closed, regen restores", () => {
  const dir = tempDir();
  setupProject(dir);
  regenerate(dir);

  fs.writeFileSync(profileAbsPath(dir), "{ not valid json", "utf8");

  const invalid = validateAll(dir);
  assert.equal(invalid.status, 2, "unparseable profile is an input error, not a pass");
  assert.ok(invalid.stderr.includes("Invalid JSON"));

  const blocked = runQuery(["--profile", PROFILE_REL, "resolution"], dir);
  assert.notEqual(blocked.status, 0, "corrupt profile must not resolve");
  assert.ok(
    !blocked.stdout.includes("gate-skill"),
    "fail-closed output must not claim any skill applicability",
  );

  // Regeneration through the adapter rewrites the corrupt artifact.
  regenerate(dir);
  const restored = validateAll(dir);
  assert.equal(restored.status, 0, `validate stderr: ${restored.stderr}\nstdout: ${restored.stdout}`);
});

test("content-tampered profile: deterministic gate reports the drift", () => {
  const dir = tempDir();
  setupProject(dir);
  regenerate(dir);

  // Schema-valid JSON whose content no longer matches regeneration output —
  // corrupt in the sense the deterministic gate owns.
  const profilePath = profileAbsPath(dir);
  const tampered = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  tampered.resolved_invocations = [];
  fs.writeFileSync(profilePath, JSON.stringify(tampered, null, 2), "utf8");

  const result = validateAll(dir);
  assert.equal(result.status, 1, "tampered profile must fail a gate");
  assert.ok(result.stdout.includes("Deterministic: fail"));
  assert.ok(result.stdout.includes("Overall:       fail"));

  // Contract path: regenerate restores a profile the gates accept.
  regenerate(dir);
  const restored = validateAll(dir);
  assert.equal(restored.status, 0, `validate stderr: ${restored.stderr}\nstdout: ${restored.stdout}`);
});

test("field-missing profile: validate writes report and fails, query fails closed", () => {
  const dir = tempDir();
  setupProject(dir);
  regenerate(dir);

  // Parseable JSON but missing required flow-profile fields — schema drift.
  fs.writeFileSync(
    profileAbsPath(dir),
    JSON.stringify({ schema_version: "1.0", adapter_id: ADAPTER_ID }, null, 2),
    "utf8",
  );

  // Fixed boundary (#145): the blocking gate no longer dereferences the
  // missing fields, so the run completes normally — schema gate reports
  // the drift, validation-report.json is written, and the exit code is a
  // validation failure (1), not the generic input-error crash (2).
  const result = validateAll(dir);
  assert.equal(result.status, 1, "drifted profile must fail validation");
  assert.ok(
    !result.stdout.includes("Overall:       pass"),
    "drifted profile must never report pass",
  );

  const reportPath = path.join(dir, ".sdp", ADAPTER_ID, "validation-report.json");
  assert.ok(
    fs.existsSync(reportPath),
    "validate must still write validation-report.json for a schema-incomplete profile",
  );
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(report.schema_validation.result, "fail");
  assert.equal(report.overall_result, "fail");
  assert.ok(report.schema_validation.errors.length > 0);

  // Hard gate substance: query never fabricates applicability from an
  // invalid profile. The loader now rejects the profile at the boundary —
  // nonzero exit with a structured error, never a printed `undefined`.
  const queried = runQuery(["--profile", PROFILE_REL, "resolution"], dir);
  assert.notEqual(queried.status, 0, "invalid profile must not resolve");
  assert.ok(
    !queried.stdout.includes("gate-skill"),
    "invalid profile must not yield any skill applicability",
  );
  assert.ok(
    !queried.stdout.includes("undefined"),
    "query must not print undefined for a schema-incomplete profile",
  );
  assert.ok(queried.stderr.includes("Invalid profile"));

  // A profile with no schema_version at all is rejected outright.
  fs.writeFileSync(profileAbsPath(dir), JSON.stringify({ adapter_id: ADAPTER_ID }), "utf8");
  const blocked = runQuery(["--profile", PROFILE_REL, "resolution"], dir);
  assert.equal(blocked.status, 1, "profile without schema_version must not resolve");
  assert.ok(blocked.stderr.includes("Invalid profile"));
});

test("schema-incomplete profile: query resolution fails nonzero with structured error (#145)", () => {
  const dir = tempDir();
  setupProject(dir);
  regenerate(dir);

  // schema_version present, required fields missing — the loader must
  // reject this at the boundary instead of letting handlers dereference
  // absent fields.
  fs.writeFileSync(
    profileAbsPath(dir),
    JSON.stringify({ schema_version: "1.0", adapter_id: ADAPTER_ID }, null, 2),
    "utf8",
  );

  const resolution = runQuery(["--profile", PROFILE_REL, "resolution"], dir);
  assert.notEqual(resolution.status, 0);
  assert.ok(resolution.stderr.includes("Invalid profile"));
  assert.ok(
    !resolution.stdout.includes("undefined"),
    "resolution must not print undefined",
  );

  // Regression: `resolution --skill x` used to crash on `.filter` of the
  // missing array (TypeError). It now fails cleanly at the loader.
  const filtered = runQuery(
    ["--profile", PROFILE_REL, "resolution", "--skill", "gate-skill-a"],
    dir,
  );
  assert.notEqual(filtered.status, 0);
  assert.ok(filtered.stderr.includes("Invalid profile"));
  assert.ok(
    !filtered.stderr.includes("TypeError"),
    `expected structured error, got crash: ${filtered.stderr}`,
  );
  assert.ok(!filtered.stdout.includes("undefined"));

  // The boundary applies to every subcommand, not just resolution.
  const flowStack = runQuery(["--profile", PROFILE_REL, "flow-stack"], dir);
  assert.notEqual(flowStack.status, 0);
  assert.ok(flowStack.stderr.includes("Invalid profile"));
});

test("validate on overall fail does not refresh validated_at (drift stays detected)", () => {
  const dir = tempDir();
  setupProject(dir);
  regenerate(dir);

  // Age the catalog so the staleness gate fails on the timestamp basis…
  const catalogPath = catalogAbsPath(dir);
  const agedDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const aged = fs
    .readFileSync(catalogPath, "utf8")
    .replace(/"validated_at": "[^"]*"/, `"validated_at": "${agedDate}"`);
  fs.writeFileSync(catalogPath, aged, "utf8");

  // …and tamper the profile so a substantive gate (deterministic drift)
  // also fails. A failed run must never re-stamp validated_at: that
  // would erase the evidence the gates exist to report.
  const profilePath = profileAbsPath(dir);
  const tampered = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  tampered.resolved_invocations = [];
  fs.writeFileSync(profilePath, JSON.stringify(tampered, null, 2), "utf8");

  const result = validateAll(dir);
  assert.equal(result.status, 1, "drifted artifacts must fail validation");
  assert.ok(result.stdout.includes("Staleness:     fail"));
  assert.ok(result.stdout.includes("Deterministic: fail"));
  assert.ok(result.stdout.includes("Overall:       fail"));

  const report = JSON.parse(
    fs.readFileSync(
      path.join(dir, ".sdp", ADAPTER_ID, "validation-report.json"),
      "utf8",
    ),
  );
  assert.equal(report.staleness_validation.result, "fail");
  assert.equal(report.staleness_validation.basis, "validated_at");
  assert.ok(report.staleness_validation.age_days >= 60);

  // The aged timestamp is preserved byte-for-byte — no in-band refresh
  // on a failing validation.
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.equal(catalog.validated_at, agedDate);
});

test("stale-by-age alone recovers via regen + validate refreshing validated_at (#144)", () => {
  const dir = tempDir();
  setupProject(dir);
  regenerate(dir);

  const catalogPath = catalogAbsPath(dir);
  const agedDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const aged = fs
    .readFileSync(catalogPath, "utf8")
    .replace(/"validated_at": "[^"]*"/, `"validated_at": "${agedDate}"`);
  fs.writeFileSync(catalogPath, aged, "utf8");

  // writeArtifact compares modulo timestamps, so a regen on unchanged
  // inputs is still a no-op — the aged validated_at is preserved on disk
  // until validate re-stamps it in-band.
  runScan(["--adapter", "gate-adapter.yaml"], dir);
  const noOp = runProfile(["--adapter", "gate-adapter.yaml"], dir);
  assert.equal(noOp.status, 0);
  assert.ok(noOp.stdout.includes("Unchanged") || noOp.stdout.includes("up to date"));

  // The documented recovery path now closes the loop: with age as the
  // only staleness defect and every other gate passing, `sdp validate`
  // re-stamps validated_at on the artifacts and reports pass.
  const healed = validateAll(dir);
  assert.equal(healed.status, 0, `validate stderr: ${healed.stderr}\nstdout: ${healed.stdout}`);
  assert.ok(healed.stdout.includes("Staleness:     pass"));
  assert.ok(healed.stdout.includes("Overall:       pass"));
  assert.ok(healed.stdout.includes("Refreshed validated_at"));

  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  assert.notEqual(catalog.validated_at, agedDate);
  assert.ok(
    new Date(catalog.validated_at).getTime() > new Date(agedDate).getTime(),
    "validate must re-stamp a newer validated_at",
  );
  const profile = JSON.parse(fs.readFileSync(profileAbsPath(dir), "utf8"));
  assert.ok(
    new Date(profile.validated_at).getTime() > new Date(agedDate).getTime(),
    "profile validated_at is refreshed alongside the catalog",
  );

  // Re-running validate now passes the staleness gate on the refreshed
  // basis — the documented procedure fully recovers pure-age staleness.
  const second = validateAll(dir);
  assert.equal(second.status, 0, `validate stderr: ${second.stderr}\nstdout: ${second.stdout}`);
  assert.ok(second.stdout.includes("Staleness:     pass"));
});

test("stale profile: skill drift is detected and the adapter path regenerates", () => {
  const dir = tempDir();
  setupProject(dir);
  regenerate(dir);

  // Stale = live re-scan finds a skill the catalog does not know.
  writeSkill(dir, "gate-skill-c", "gamma research");

  const stale = validateAll(dir);
  assert.equal(stale.status, 1, "catalog drift must fail the staleness gate");
  assert.ok(stale.stdout.includes("Staleness:     fail"));
  const staleReport = JSON.parse(
    fs.readFileSync(
      path.join(dir, ".sdp", ADAPTER_ID, "validation-report.json"),
      "utf8",
    ),
  );
  assert.ok(staleReport.staleness_validation.new_skills.includes("gate-skill-c"));

  // Documented contract path: agent updates inference for the new skill,
  // then the adapter regenerates scan → profile.
  writeInferenceFile(dir, [...INFERENCE_SKILLS, SKILL_C_INFERENCE]);
  regenerate(dir);

  const fresh = validateAll(dir);
  assert.equal(fresh.status, 0, `validate stderr: ${fresh.stderr}\nstdout: ${fresh.stdout}`);

  const catalog = JSON.parse(fs.readFileSync(catalogAbsPath(dir), "utf8"));
  assert.equal(catalog.skill_count, 3);
  assert.ok(catalog.skills.some((s: { name: string }) => s.name === "gate-skill-c"));
});

// ═══════════════════════════════════════════════════════════════════
// Step 3 — staged-loading regression guard (live vs audited baseline)
// ═══════════════════════════════════════════════════════════════════

type StoredDirective = { kind: string; target: string; line: number; optional: boolean };
type StoredFlow = {
  flow: string;
  skillBytes: number;
  alwaysOnChars: number;
  directives: StoredDirective[];
  totals: { directives: number; referencedBytes: number; missing: number };
};
type StoredInventory = {
  flows: StoredFlow[];
  totals: {
    flows: number;
    skillBytes: number;
    alwaysOnChars: number;
    directives: number;
    referencedBytes: number;
    missing: number;
  };
};

function loadStoredInventory(fileName: string): StoredInventory {
  return JSON.parse(fs.readFileSync(path.join(artifactsDir, fileName), "utf8"));
}

function kindCounts(flows: { directives: { kind: string }[] }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const flow of flows) {
    for (const d of flow.directives) {
      counts[d.kind] = (counts[d.kind] ?? 0) + 1;
    }
  }
  return counts;
}

// Bounds vs the audit's stored artifacts. The audit (Task 2) recorded zero
// directive change and +40 alwaysOnChars; Task 3 then added staged-loading
// paragraphs linking the progressive-loading contract — the only
// post-audit additions this guard tolerates, enumerated below.
const ALWAYS_ON_TOLERANCE = 100;

// Per-flow count of new `reference` directives Task 3 added: one contract
// link per staged-loading paragraph in the three flows, plus the en/ja
// entries added to the skill-discovery-protocol references index.
const CONTRACT_LINK_ALLOWANCE: Record<string, number> = {
  "briefing-flow": 1,
  "implementation-flow": 1,
  "planning-flow": 1,
  "skill-discovery-protocol": 2,
};

// Task 3's measured alwaysOnChars growth: +302 briefing, +302 impl, +316
// planning, +168 sdp = +1088; later incidental doc edits (audit-behavior
// notes such as #154's fenced-block clause) consumed the rest of the
// headroom. +1400 keeps the bound tight — bulk growth of the always-on
// instruction surface is the regression this guard exists for.
const ALWAYS_ON_TASK3_TOLERANCE = 1400;

/** Multiset diff of (kind,target) pairs: directives in `live` not in `base`. */
function addedDirectives(
  liveFlow: StoredFlow,
  baseFlow: StoredFlow,
): StoredDirective[] {
  const remaining = baseFlow.directives.map((d) => `${d.kind}${d.target}`);
  const added: StoredDirective[] = [];
  for (const d of liveFlow.directives) {
    const key = `${d.kind}${d.target}`;
    const idx = remaining.indexOf(key);
    if (idx >= 0) remaining.splice(idx, 1);
    else added.push(d);
  }
  return added;
}

test("staged-loading guard: stored final inventory is consistent with baseline", () => {
  const baseline = loadStoredInventory("inventory-baseline.json");
  const final = loadStoredInventory("inventory-final.json");

  assert.equal(
    final.totals.directives,
    baseline.totals.directives,
    "audit recorded no directive-count change",
  );
  assert.equal(final.totals.missing, 0, "audit closed the single missing target");
  assert.ok(
    final.totals.alwaysOnChars <= baseline.totals.alwaysOnChars + ALWAYS_ON_TOLERANCE,
    `audit alwaysOnChars delta ${final.totals.alwaysOnChars - baseline.totals.alwaysOnChars} exceeds tolerance`,
  );
  assert.deepEqual(kindCounts(final.flows), kindCounts(baseline.flows));
});

test("staged-loading guard: live package inventory does not regress vs the audited endpoint", () => {
  const baseline = loadStoredInventory("inventory-baseline.json");
  const final = loadStoredInventory("inventory-final.json");
  const live = inventoryAll(skillRoot);
  const finalByFlow = new Map(final.flows.map((f) => [f.flow, f]));

  assert.equal(
    live.totals.missing,
    0,
    "shipped-kind directive targets must all resolve (audit fix must hold)",
  );
  assert.ok(
    live.totals.alwaysOnChars <= baseline.totals.alwaysOnChars + ALWAYS_ON_TASK3_TOLERANCE,
    `always-on instruction chars grew beyond the audit + Task-3 bound: ` +
      `${baseline.totals.alwaysOnChars} -> ${live.totals.alwaysOnChars}`,
  );

  // Directive counts: the only tolerated growth over the audited endpoint is
  // the Task-3 contract links, enumerated per flow. Every other flow must be
  // at or below its final count.
  for (const flow of live.flows) {
    const allowance = CONTRACT_LINK_ALLOWANCE[flow.flow] ?? 0;
    const base = finalByFlow.get(flow.flow);
    assert.ok(base, `live inventory has unknown flow ${flow.flow}`);
    assert.ok(
      flow.totals.directives <= base.totals.directives + allowance,
      `${flow.flow}: directives ${base.totals.directives} -> ${flow.totals.directives} ` +
        `exceeds allowance +${allowance}`,
    );

    // And the additions must actually be the contract links, nothing else.
    const added = addedDirectives(flow, base);
    const allowedAdded = added.filter(
      (d) => d.kind === "reference" && d.target.includes("progressive-loading-contract"),
    );
    assert.equal(
      added.length,
      allowedAdded.length,
      `${flow.flow}: unexpected new load directives: ${JSON.stringify(
        added.filter((d) => !d.target.includes("progressive-loading-contract")),
      )}`,
    );
  }

  // No directive kind may grow beyond baseline + the contract-link allowance
  // (all contract links are `reference` kind).
  const baselineKinds = kindCounts(baseline.flows);
  const liveKinds = kindCounts(live.flows);
  const contractLinks = Object.values(CONTRACT_LINK_ALLOWANCE).reduce((a, b) => a + b, 0);
  for (const [kind, baseCount] of Object.entries(baselineKinds)) {
    const allowance = kind === "reference" ? contractLinks : 0;
    assert.ok(
      (liveKinds[kind] ?? 0) <= baseCount + allowance,
      `directive kind "${kind}" grew ${baseCount} -> ${liveKinds[kind] ?? 0} ` +
        `(allowed +${allowance})`,
    );
  }
  for (const kind of Object.keys(liveKinds)) {
    assert.ok(kind in baselineKinds, `new directive kind "${kind}" appeared`);
  }
});
