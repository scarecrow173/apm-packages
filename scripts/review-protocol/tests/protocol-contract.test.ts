import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");
const pkgRoot = path.join(repoRoot, "packages", "review-protocol");
const skillDir = path.join(pkgRoot, ".apm", "skills", "review-protocol");

function read(rel: string): string {
  return fs.readFileSync(path.join(skillDir, rel), "utf8");
}

function concepts(text: string, patterns: RegExp[], label: string) {
  const normalized = text.replace(/\s+/g, " ");
  for (const pattern of patterns) {
    assert.match(normalized, pattern, `${label}: expected ${pattern}`);
  }
}

const ROLES = [/Reviewer A/i, /Reviewer B/i, /Validator/i, /Judge/i];
const SEVERITIES = [/\bP0\b/, /\bP1\b/, /\bP2\b/, /\bP3\b/];
const VERDICTS = [/CONFIRMED/, /REJECTED/, /UNVERIFIED/];

test("SKILL.md documents roles, verdicts, and severities", () => {
  concepts(
    read("SKILL.md"),
    [
      ...ROLES,
      /Issue Candidate/i,
      ...VERDICTS,
      ...SEVERITIES,
      /blocking/i,
      /parallel|independent/i,
      /acceptance criteria/i,
    ],
    "SKILL.md",
  );
});

test("SKILL.md invariants gate fixes on CONFIRMED P0/P1 and bound iteration", () => {
  const skill = read("SKILL.md").replace(/\s+/g, " ");
  assert.match(
    skill,
    /P0\/P1|P0.*P1/,
    "fix scope limited to confirmed P0/P1 not documented",
  );
  assert.match(
    skill,
    /two cycles|at most.*(two|2).*(cycle|review)|(two|2).*cycles/i,
    "full re-review cycle cap not documented",
  );
});

test("protocol.md fixes evaluation criteria before reviewing", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  assert.match(protocol, /evaluation criteria|acceptance criteria/i);
  assert.match(protocol, /before/i);
  concepts(
    protocol,
    [/requirement/i, /constraint/i, /scope/i, /assumption/i],
    "protocol.md",
  );
});

test("protocol.md requires objective verification before subjective review", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  concepts(
    protocol,
    [
      /objective|mechanical|deterministic/i,
      /build|type ?check|lint|test/i,
      /static analysis|schema/i,
    ],
    "protocol.md",
  );
});

test("protocol.md defines cooperative Reviewer A and adversarial Reviewer B", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  assert.match(protocol, /Reviewer A/i);
  assert.match(protocol, /cooperative/i);
  assert.match(protocol, /Reviewer B/i);
  assert.match(protocol, /adversarial/i);
  assert.match(
    protocol,
    /at least two|minimum (of )?two/i,
    "minimum two independent reviewers not documented",
  );
  assert.match(
    protocol,
    /do not share|without sharing|never share|independent/i,
    "no-cross-talk rule not documented",
  );
  assert.match(protocol, /Failure Scenario/i);
});

test("protocol.md separates Validator and Judge from reviewers", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  concepts(
    protocol,
    [
      /Validator/i,
      /Judge/i,
      ...VERDICTS,
      /root cause/i,
      /duplicat|dedup/i,
      /candidate/i,
    ],
    "protocol.md",
  );
});

test("protocol.md bounds iteration and defines stop conditions", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  assert.match(
    protocol,
    /(two|2).*(cycle|re-?review)/i,
    "re-review cycle cap missing",
  );
  concepts(
    protocol,
    [/stop condition/i, /escalat|human/i, /\bP0\b/, /\bP1\b/],
    "protocol.md",
  );
});

test("report-format.md defines the Issue Candidate schema", () => {
  const format = read("references/report-format.md").replace(/\s+/g, " ");
  for (const field of [
    "Claim",
    "Location",
    "Failure Scenario",
    "Impact",
    "Evidence",
    "Proposed Severity",
    "Validation Method",
  ]) {
    assert.ok(
      format.includes(field),
      `report-format.md: missing Issue Candidate field "${field}"`,
    );
  }
});

test("report-format.md defines severities, verdicts, and the final report", () => {
  const format = read("references/report-format.md").replace(/\s+/g, " ");
  concepts(
    format,
    [
      ...SEVERITIES,
      ...VERDICTS,
      /ACCEPT WITH NON-BLOCKING NOTES/,
      /\bACCEPT\b/,
      /\bBLOCKED\b/,
      /residual risk/i,
      /blocking/i,
      /non-?blocking/i,
    ],
    "report-format.md",
  );
});

test("no secrets-shaped content in package docs", () => {
  const files = [
    "SKILL.md",
    "SKILL.ja.md",
    "references/protocol.md",
    "references/protocol.ja.md",
    "references/report-format.md",
    "references/report-format.ja.md",
  ];
  for (const rel of files) {
    const text = read(rel);
    assert.doesNotMatch(
      text,
      /ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      `${rel}: looks like it embeds a credential`,
    );
  }
});
