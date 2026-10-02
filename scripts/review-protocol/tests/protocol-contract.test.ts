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

test("report-format.md binds severity to blocking disposition", () => {
  const format = read("references/report-format.md").replace(/\s+/g, " ");
  assert.match(
    format,
    /P0[^|]*\|[^|]*\| *Blocking *\|/,
    "P0 must be Blocking in the severity table",
  );
  assert.match(
    format,
    /P1[^|]*\|[^|]*\| *Blocking *\|/,
    "P1 must be Blocking in the severity table",
  );
  assert.match(
    format,
    /P2[^|]*\|[^|]*\| *Non-blocking *\|/,
    "P2 must be Non-blocking in the severity table",
  );
  assert.match(
    format,
    /P3[^|]*\|[^|]*\| *Non-blocking *\|/,
    "P3 must be Non-blocking in the severity table",
  );
});

test("report-format.md binds verdicts to dispositions", () => {
  const format = read("references/report-format.md").replace(/\s+/g, " ");
  assert.match(
    format,
    /REJECTED *\|[^|]*\| *Excluded/,
    "REJECTED must be excluded from further processing",
  );
  assert.match(
    format,
    /UNVERIFIED *\|[^|]*\| *Non-blocking/,
    "UNVERIFIED must be non-blocking in principle",
  );
  assert.match(
    format,
    /CONFIRMED *\|[^|]*\|[^|]*blocking/i,
    "CONFIRMED must enter severity judgment for blocking",
  );
});

test("protocol.md binds each severity to its blocking status", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  assert.match(
    protocol,
    /P0 — Critical.*?Status: \*\*Blocking\*\*/,
    "P0 must be Blocking",
  );
  assert.match(
    protocol,
    /P1 — Major.*?Status: \*\*Blocking\*\*/,
    "P1 must be Blocking",
  );
  assert.match(
    protocol,
    /P2 — Minor.*?Status: \*\*Non-blocking\*\*/,
    "P2 must be Non-blocking",
  );
  assert.match(
    protocol,
    /P3 — Nit.*?Status: \*\*Non-blocking\*\*/,
    "P3 must be Non-blocking",
  );
});

test("fix scope is limited to CONFIRMED P0/P1 in SKILL.md and protocol.md", () => {
  for (const rel of ["SKILL.md", "references/protocol.md"]) {
    const text = read(rel).replace(/\s+/g, " ");
    assert.match(
      text,
      /(only|limited to)[^.]*CONFIRMED[^.]*P0[^.]*P1|CONFIRMED P0\/P1/i,
      `${rel}: fix scope must be limited to confirmed P0/P1`,
    );
  }
});

test("Japanese skill docs keep protocol tokens verbatim", () => {
  const files = [
    "SKILL.ja.md",
    "references/protocol.ja.md",
    "references/report-format.ja.md",
  ];
  const TOKENS = [
    /Reviewer A/,
    /Reviewer B/,
    /Validator/,
    /Judge/,
    /Issue Candidate/,
    /CONFIRMED/,
    /REJECTED/,
    /UNVERIFIED/,
    /\bP0\b/,
    /\bP1\b/,
    /\bP2\b/,
    /\bP3\b/,
    /Failure Scenario/,
    /ACCEPT WITH NON-BLOCKING NOTES/,
    /\bACCEPT\b/,
    /\bBLOCKED\b/,
  ];
  for (const rel of files) {
    const text = read(rel);
    for (const token of TOKENS) {
      assert.match(text, token, `${rel}: missing protocol token ${token}`);
    }
  }
  const jaProtocol = read("references/protocol.ja.md");
  assert.match(
    jaProtocol,
    /最大2|2サイクル/,
    "protocol.ja.md: two-cycle re-review cap missing",
  );
});

test("report-format.ja.md keeps Issue Candidate field names verbatim", () => {
  const format = read("references/report-format.ja.md").replace(/\s+/g, " ");
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
      `report-format.ja.md: missing Issue Candidate field "${field}"`,
    );
  }
});
