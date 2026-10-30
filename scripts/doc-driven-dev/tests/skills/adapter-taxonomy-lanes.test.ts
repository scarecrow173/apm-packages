import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import * as yaml from "js-yaml";

/**
 * Issue #146 — adapter taxonomy lane boundaries.
 *
 * The real shipped adapters (`briefing-adapter.yaml`,
 * `implementation-adapter.yaml`) previously gave their lane pairs identical
 * or overlapping match vocabulary:
 *
 * - briefing: `discover` and `research` shared capabilities
 *   [web_research, information_gathering], nearly identical tags, and the
 *   same description_patterns — every research skill classified into both.
 * - implementation: `verify` ("adversarial") and `review` ("review",
 *   "audit") collided so "adversarial review" landed in both lanes.
 *
 * Owner-decided boundaries, now enforced here through real profile
 * regeneration against the shipped adapter files:
 *
 * - briefing discover = broad/internal information gathering & exploration;
 *   research = explicitly external web research.
 * - implementation verify = correctness validation incl. adversarial
 *   review; review = post-implementation judgment gates.
 *
 * Multi-category membership is by design (classifier ORs capabilities,
 * tags, and description_patterns per taxonomy entry), so a genuinely dual
 * skill still lands in both lanes — that is asserted, not forbidden.
 */

const skillRoot = path.resolve(
  __dirname,
  "../../../../packages/doc-driven-dev/.apm/skills",
);
const sdpScripts = path.join(skillRoot, "skill-discovery-protocol", "scripts");

const BRIEFING_ADAPTER = path.join(
  skillRoot,
  "briefing-flow",
  "assets",
  "adapters",
  "briefing-adapter.yaml",
);
const IMPL_ADAPTER = path.join(
  skillRoot,
  "implementation-flow",
  "assets",
  "adapters",
  "implementation-adapter.yaml",
);

const BRIEFING_PROFILE_REL = path.join(
  ".sdp",
  "briefing-flow-default",
  "briefing-profile.json",
);
const IMPL_PROFILE_REL = path.join(
  ".sdp",
  "implementation-flow-default",
  "implementation-flow-profile.json",
);

type CliResult = { status: number | null; stdout: string; stderr: string };

function runSdp(script: string, args: string[], cwd: string): CliResult {
  const result = spawnSync(
    process.execPath,
    [path.join(sdpScripts, script), ...args],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdp-taxonomy-lanes-"));
}

// ─── Fixture skills ───
// Descriptions are the representative ambiguous queries from #146:
// "adversarial review" must land in verify only, "web research" in research
// only, "search and gather" in discover only.

const FIXTURE_SKILLS: Record<string, string> = {
  "fixture-web-scout": "Perform web research on an external topic",
  "fixture-context-scout": "Search and gather context from the codebase",
  "fixture-dual-scout": "Gather context and conduct external web research",
  "fixture-adversarial-checker":
    "Adversarial review of design decisions and assumptions",
  "fixture-gate-review": "Code review and security audit gate for changes",
  "fixture-dual-reviewer": "Adversarial correctness probe and code review",
  "fixture-brief-worker": "Coordinate briefing information needs",
  "fixture-impl-worker": "Coordinate task verification needs",
};

const FIXTURE_INFERENCES = [
  {
    name: "fixture-web-scout",
    provides: [
      { capability: "web_research", description: "External web research" },
    ],
    uses: [],
    tags: ["research", "web"],
  },
  {
    name: "fixture-context-scout",
    provides: [
      {
        capability: "information_gathering",
        description: "Internal context gathering",
      },
    ],
    uses: [],
    tags: ["search", "explore"],
  },
  {
    // Genuinely dual: declares both lane capabilities, so membership in BOTH
    // discover and research is the correct multi-category outcome.
    name: "fixture-dual-scout",
    provides: [
      {
        capability: "information_gathering",
        description: "Internal context gathering",
      },
      { capability: "web_research", description: "External web research" },
    ],
    uses: [],
    tags: ["search", "research"],
  },
  {
    name: "fixture-adversarial-checker",
    provides: [
      {
        capability: "adversarial_review",
        description: "Adversarial correctness review",
      },
    ],
    uses: [],
    tags: ["verify"],
  },
  {
    name: "fixture-gate-review",
    provides: [
      { capability: "code_review", description: "Post-implementation review" },
      { capability: "security_audit", description: "Security audit gate" },
    ],
    uses: [],
    tags: ["review", "audit"],
  },
  {
    // Genuinely dual: declares both lane capabilities, so membership in BOTH
    // verify and review is the correct multi-category outcome.
    name: "fixture-dual-reviewer",
    provides: [
      {
        capability: "adversarial_review",
        description: "Adversarial correctness review",
      },
      { capability: "code_review", description: "Post-implementation review" },
    ],
    uses: [],
    tags: ["verify", "review"],
  },
  {
    name: "fixture-brief-worker",
    provides: [],
    uses: [
      {
        capability: "information_gathering",
        required: false,
        override_allowed: true,
      },
      { capability: "web_research", required: false, override_allowed: true },
    ],
    tags: ["process"],
  },
  {
    name: "fixture-impl-worker",
    provides: [],
    uses: [
      {
        capability: "adversarial_review",
        required: false,
        override_allowed: true,
      },
      { capability: "code_review", required: false, override_allowed: true },
    ],
    tags: ["process"],
  },
];

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

Fixture skill for taxonomy lane tests.
`,
    "utf8",
  );
}

function setupProject(dir: string) {
  for (const [name, description] of Object.entries(FIXTURE_SKILLS)) {
    writeSkill(dir, name, description);
  }
  fs.mkdirSync(path.join(dir, ".sdp"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".sdp", "skill-reference-inferences.json"),
    JSON.stringify(
      {
        schema_version: "1.0",
        generated_at: "2026-01-01T00:00:00Z",
        inference_source: "agent",
        skills: FIXTURE_INFERENCES.map((skill) => ({
          review_status: "reviewed",
          execution_policy: {
            strictness: "flexible",
            sequence_required: false,
            allow_step_reordering: true,
            allow_partial_application: true,
            guidance: `${skill.name} guidance`,
          },
          ...skill,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
}

function generateProfile(dir: string, adapterPath: string) {
  const scan = runSdp("scan.js", ["--adapter", adapterPath], dir);
  assert.equal(scan.status, 0, `scan stderr: ${scan.stderr}`);
  const profile = runSdp("profile.js", ["--adapter", adapterPath], dir);
  assert.equal(profile.status, 0, `profile stderr: ${profile.stderr}`);
}

function loadProfile(dir: string, relPath: string) {
  const profilePath = path.join(dir, relPath);
  assert.ok(fs.existsSync(profilePath), `profile should exist: ${relPath}`);
  return JSON.parse(fs.readFileSync(profilePath, "utf8"));
}

function categoryMap(profile: {
  classification: { categories: { id: string; skills: string[] }[] };
}): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const category of profile.classification.categories) {
    map.set(category.id, new Set(category.skills));
  }
  return map;
}

function lanesOf(categories: Map<string, Set<string>>, skill: string): string[] {
  return [...categories.entries()]
    .filter(([, skills]) => skills.has(skill))
    .map(([id]) => id)
    .sort();
}

function resolvedSkill(
  profile: {
    resolved_invocations: {
      source_skill: string;
      capability: string;
      resolved_skill: string;
    }[];
  },
  sourceSkill: string,
  capability: string,
): string {
  const invocation = profile.resolved_invocations.find(
    (inv) => inv.source_skill === sourceSkill && inv.capability === capability,
  );
  assert.ok(
    invocation,
    `expected resolved invocation ${sourceSkill} -> ${capability}`,
  );
  return invocation.resolved_skill;
}

// ═══════════════════════════════════════════════════════════════════
// Shipped adapter taxonomy: boundary vocabulary
// ═══════════════════════════════════════════════════════════════════

test("briefing adapter: discover and research lanes carry disjoint vocabulary", () => {
  const adapter = yaml.load(fs.readFileSync(BRIEFING_ADAPTER, "utf8")) as any;
  const taxonomy = adapter.classification.taxonomy;
  const discover = taxonomy.find((e: { id: string }) => e.id === "discover");
  const research = taxonomy.find((e: { id: string }) => e.id === "research");

  // discover = broad/internal gathering; research = external web research.
  // The lanes must no longer share capabilities, tags, or patterns.
  assert.deepEqual(discover.match.capabilities, ["information_gathering"]);
  assert.deepEqual(research.match.capabilities, ["web_research"]);
  for (const tag of discover.match.tags) {
    assert.ok(
      !research.match.tags.includes(tag),
      `discover tag "${tag}" must not appear in research lane`,
    );
  }
  for (const pattern of discover.match.description_patterns) {
    assert.ok(
      !research.match.description_patterns.includes(pattern),
      `discover pattern "${pattern}" must not appear in research lane`,
    );
  }
});

test("implementation adapter: review patterns no longer collide with adversarial review", () => {
  const adapter = yaml.load(fs.readFileSync(IMPL_ADAPTER, "utf8")) as any;
  const taxonomy = adapter.classification.taxonomy;
  const verify = taxonomy.find((e: { id: string }) => e.id === "verify");
  const review = taxonomy.find((e: { id: string }) => e.id === "review");

  assert.deepEqual(verify.match.capabilities, [
    "source_verification",
    "adversarial_review",
  ]);
  assert.deepEqual(review.match.capabilities, ["code_review", "security_audit"]);

  // The bare "review"/"audit" patterns are what pulled "adversarial review"
  // into the review lane; review patterns must now be phrase/word-level.
  assert.ok(
    !review.match.description_patterns.includes("review"),
    "review lane must not keep bare 'review' pattern",
  );
  assert.ok(
    !review.match.description_patterns.includes("audit"),
    "review lane must not keep bare 'audit' pattern",
  );
  for (const pattern of review.match.description_patterns) {
    assert.ok(
      pattern.includes(" ") || pattern.includes("-") || pattern.startsWith("\\b"),
      `review pattern "${pattern}" should be phrase-level or word-anchored`,
    );
  }
});

// ═══════════════════════════════════════════════════════════════════
// Profile regeneration: representative skills land in the intended lane
// ═══════════════════════════════════════════════════════════════════

test("briefing profile: web-research skill lands in research only, explore/search skill in discover only", () => {
  const dir = tempDir();
  setupProject(dir);
  generateProfile(dir, BRIEFING_ADAPTER);

  const profile = loadProfile(dir, BRIEFING_PROFILE_REL);
  const categories = categoryMap(profile);

  // "Perform web research on an external topic" -> research only.
  assert.deepEqual(
    lanesOf(categories, "fixture-web-scout"),
    ["research"],
    "web-research fixture must classify into the research lane only",
  );

  // "Search and gather context from the codebase" -> discover only.
  // Before #146 this also leaked into research via shared "search" tag.
  assert.deepEqual(
    lanesOf(categories, "fixture-context-scout"),
    ["discover"],
    "search/gather fixture must classify into the discover lane only",
  );

  // Genuinely dual skill (both lane capabilities) -> both lanes is correct.
  assert.deepEqual(
    lanesOf(categories, "fixture-dual-scout"),
    ["discover", "research"],
    "dual-capability fixture must remain a member of both lanes",
  );

  // resolved_invocations route each capability into its own lane.
  const webProvider = resolvedSkill(profile, "fixture-brief-worker", "web_research");
  assert.ok(
    categories.get("research")!.has(webProvider),
    `web_research must resolve to a research-lane skill, got ${webProvider}`,
  );
  const gatherProvider = resolvedSkill(
    profile,
    "fixture-brief-worker",
    "information_gathering",
  );
  assert.ok(
    categories.get("discover")!.has(gatherProvider),
    `information_gathering must resolve to a discover-lane skill, got ${gatherProvider}`,
  );
});

test("implementation profile: adversarial-review skill lands in verify only, gate review in review only", () => {
  const dir = tempDir();
  setupProject(dir);
  generateProfile(dir, IMPL_ADAPTER);

  const profile = loadProfile(dir, IMPL_PROFILE_REL);
  const categories = categoryMap(profile);

  // "Adversarial review of design decisions" -> verify only.
  // Before #146 this also landed in review via the bare "review" pattern.
  assert.deepEqual(
    lanesOf(categories, "fixture-adversarial-checker"),
    ["verify"],
    "adversarial-review fixture must classify into the verify lane only",
  );

  // "Code review and security audit gate for changes" -> review only.
  assert.deepEqual(
    lanesOf(categories, "fixture-gate-review"),
    ["review"],
    "gate-review fixture must classify into the review lane only",
  );

  // Genuinely dual skill (adversarial_review + code_review) -> both lanes.
  assert.deepEqual(
    lanesOf(categories, "fixture-dual-reviewer"),
    ["review", "verify"],
    "dual-capability fixture must remain a member of both lanes",
  );

  // resolved_invocations route each capability into its own lane.
  const verifyProvider = resolvedSkill(
    profile,
    "fixture-impl-worker",
    "adversarial_review",
  );
  assert.ok(
    categories.get("verify")!.has(verifyProvider),
    `adversarial_review must resolve to a verify-lane skill, got ${verifyProvider}`,
  );
  const reviewProvider = resolvedSkill(
    profile,
    "fixture-impl-worker",
    "code_review",
  );
  assert.ok(
    categories.get("review")!.has(reviewProvider),
    `code_review must resolve to a review-lane skill, got ${reviewProvider}`,
  );
});
