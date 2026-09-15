import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");
const pkgRoot = path.join(repoRoot, "packages", "github-issue-handoff");
const skillDir = path.join(pkgRoot, ".apm", "skills", "github-issue-handoff");

function read(rel: string): string {
  return fs.readFileSync(path.join(skillDir, rel), "utf8");
}

function concepts(text: string, patterns: RegExp[], label: string) {
  const normalized = text.replace(/\s+/g, " ");
  for (const pattern of patterns) {
    assert.match(normalized, pattern, `${label}: expected ${pattern}`);
  }
}

const LABELS = [
  /handoff:needs-response/,
  /handoff:needs-requester/,
  /handoff:blocking/,
];

test("SKILL.md documents labels and the five mandatory artifacts", () => {
  const skill = read("SKILL.md");
  concepts(
    skill,
    [
      /\bhandoff\b/,
      ...LABELS,
      /branch/i,
      /push/i,
      /issue/i,
      /pull request|\bPR\b/i,
      /draft/i,
      /prompt/i,
    ],
    "SKILL.md",
  );
});

test("protocol.md covers requester lifecycle invariants", () => {
  const protocol = read("references/protocol.md");
  concepts(
    protocol,
    [
      ...LABELS,
      /push/i,
      /commit/i,
      /draft/i,
      /Closes #|Fixes #|Resolves #/i,
      /cannot be completed|fail/i,
      /secret|credential|token/i,
      /verify|confirm/i,
      /blocking/i,
      /follow-?up/i,
      /resume/i,
    ],
    "protocol.md",
  );
  // push must be required before Issue creation; no local-only handoff
  assert.match(
    protocol.replace(/\s+/g, " "),
    /push[^.]*before[^.]*issue|before[^.]*issue[^.]*push/i,
    "protocol.md: push-before-Issue ordering not documented",
  );
  // Issue close must be verified after merge
  assert.match(
    protocol.replace(/\s+/g, " "),
    /verif|confirm/i,
    "protocol.md: post-merge Issue close verification not documented",
  );
});

test("issue-format.md defines the Issue body contract and metadata comment", () => {
  const format = read("references/issue-format.md");
  concepts(
    format,
    [
      /## Question/,
      /## Context/,
      /## Findings/,
      /## Current assessment/,
      /## Repository state/,
      /## Requested review/,
      /## Blocking/,
      /<!-- github-issue-handoff/,
      /protocol:/,
      /round:/,
      /branch:/,
      /commit:/,
      /blocking:/,
      /\[Handoff\]/,
      /Closes #|Fixes #|Resolves #/,
      /draft/i,
      ...LABELS,
    ],
    "issue-format.md",
  );
  // exclusivity of the two pending-state labels
  assert.match(
    format.replace(/\s+/g, " "),
    /mutually exclusive|exclusive|排他/i,
    "issue-format.md: needs-response/needs-requester exclusivity not documented",
  );
});

test("every metadata comment example carries the full round field set", () => {
  const format = read("references/issue-format.md");
  const blocks = format.match(/<!-- github-issue-handoff[\s\S]*?-->/g) ?? [];
  assert.ok(
    blocks.length >= 2,
    "expected metadata examples for the issue and the follow-up round",
  );
  for (const [i, block] of blocks.entries()) {
    for (const field of [
      "protocol:",
      "round:",
      "branch:",
      "commit:",
      "blocking:",
    ]) {
      assert.ok(
        block.includes(field),
        `metadata block #${i} is missing "${field}"`,
      );
    }
  }
});

test("requester bootstraps discovery labels or fails closed", () => {
  const protocol = read("references/protocol.md").replace(/\s+/g, " ");
  assert.match(protocol, /gh label/, "label bootstrap command not documented");
  assert.match(
    protocol,
    /cannot be completed|fail closed/i,
    "fail-closed behavior for missing discovery labels not documented",
  );
});

test("responder dedup also covers requests for additional information", () => {
  for (const rel of [
    "assets/templates/responder-prompt.md",
    "references/responder-guide.md",
  ]) {
    const text = read(rel).replace(/\s+/g, " ");
    assert.match(
      text,
      /additional information/i,
      `${rel}: dedup must cover info-request responses`,
    );
    assert.match(
      text,
      /follow-?up/i,
      `${rel}: dedup must be keyed to newer requester follow-ups`,
    );
  }
  const ja = read("assets/templates/responder-prompt.ja.md");
  assert.match(ja, /追加情報/);
  assert.match(ja, /follow-?up/i);
});

test("responder-guide.md describes the repository-wide responder protocol", () => {
  const guide = read("references/responder-guide.md");
  concepts(
    guide,
    [
      /handoff:needs-response/,
      /all|every/i,
      /pull request|\bPR\b/i,
      /diff|commit/i,
      /comment/i,
      /duplicate/i,
      /independent/i,
      /handoff:needs-requester/,
    ],
    "responder-guide.md",
  );
});

test("responder-prompt.md is repository-wide and complete", () => {
  const prompt = read("assets/templates/responder-prompt.md");
  const normalized = prompt.replace(/\s+/g, " ");
  assert.ok(prompt.includes("{{repository}}"), "missing {{repository}}");
  assert.ok(
    prompt.includes("{{label}}") || prompt.includes("handoff:needs-response"),
    "missing {{label}} or default label",
  );
  assert.ok(
    prompt.includes("handoff:needs-response"),
    "default label handoff:needs-response missing",
  );
  concepts(
    prompt,
    [
      /all|every/i,
      /not.*(only|just|single|one issue)|do not stop|single issue/i,
      /pull request|\bPR\b/i,
      /diff|commit/i,
      /comment/i,
      /duplicate/i,
      /## Assessment/,
      /## Recommendation/,
      /## Reasoning/,
      /## Risks/,
      /## Suggested next step/,
    ],
    "responder-prompt.md",
  );
  // prompt must not depend on a specific responder product
  assert.doesNotMatch(
    normalized,
    /copilot|chatgpt|claude|gemini|\bdevin\b|codex/i,
    "responder prompt must not name a specific AI product",
  );
});

test("responder-prompt.ja.md mirrors the English contract", () => {
  const prompt = read("assets/templates/responder-prompt.ja.md");
  assert.ok(prompt.includes("{{repository}}"), "missing {{repository}}");
  assert.ok(
    prompt.includes("handoff:needs-response"),
    "default label missing in ja prompt",
  );
  concepts(
    prompt,
    [/すべて|全て/, /一件だけ|1件だけ/, /コメント/, /重複/],
    "responder-prompt.ja.md",
  );
});

test("no secrets-shaped content in package docs", () => {
  const files = [
    "SKILL.md",
    "SKILL.ja.md",
    "references/protocol.md",
    "references/protocol.ja.md",
    "references/issue-format.md",
    "references/issue-format.ja.md",
    "references/responder-guide.md",
    "references/responder-guide.ja.md",
    "assets/templates/responder-prompt.md",
    "assets/templates/responder-prompt.ja.md",
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
