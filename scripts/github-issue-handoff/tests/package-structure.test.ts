import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");
const pkgRoot = path.join(repoRoot, "packages", "github-issue-handoff");
const skillDir = path.join(pkgRoot, ".apm", "skills", "github-issue-handoff");

const requiredFiles = [
  "apm.yml",
  "README.md",
  "README.ja.md",
  "AGENTS.md",
  "AGENTS.ja.md",
  ".apm/skills/github-issue-handoff/SKILL.md",
  ".apm/skills/github-issue-handoff/SKILL.ja.md",
  ".apm/skills/github-issue-handoff/references/protocol.md",
  ".apm/skills/github-issue-handoff/references/protocol.ja.md",
  ".apm/skills/github-issue-handoff/references/issue-format.md",
  ".apm/skills/github-issue-handoff/references/issue-format.ja.md",
  ".apm/skills/github-issue-handoff/references/responder-guide.md",
  ".apm/skills/github-issue-handoff/references/responder-guide.ja.md",
  ".apm/skills/github-issue-handoff/assets/templates/responder-prompt.md",
  ".apm/skills/github-issue-handoff/assets/templates/responder-prompt.ja.md",
];

test("all required package files exist", () => {
  for (const rel of requiredFiles) {
    assert.ok(
      fs.existsSync(path.join(pkgRoot, rel)),
      `missing required file: ${rel}`,
    );
  }
});

test("SKILL.md frontmatter has name and trigger-scoped description", () => {
  const { data } = matter(
    fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"),
  );
  assert.equal(data.name, "github-issue-handoff");
  assert.ok(
    typeof data.description === "string" && data.description.length > 0,
    "SKILL.md description missing",
  );
  assert.ok(
    data.description.length <= 1024,
    "SKILL.md description exceeds 1024 characters",
  );
  assert.match(
    data.description,
    /handoff|second opinion|independent review|resum/i,
    "description should describe handoff/review trigger conditions",
  );
  assert.match(
    data.description,
    /when/i,
    "description should state when to use the skill",
  );
});

test("SKILL.ja.md frontmatter name matches SKILL.md", () => {
  const en = matter(
    fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"),
  ).data;
  const ja = matter(
    fs.readFileSync(path.join(skillDir, "SKILL.ja.md"), "utf8"),
  ).data;
  assert.equal(ja.name, en.name);
  assert.ok(typeof ja.description === "string" && ja.description.length > 0);
});

test("package manifest declares github-issue-handoff with .apm includes", () => {
  const text = fs.readFileSync(path.join(pkgRoot, "apm.yml"), "utf8");
  assert.match(text, /^name: github-issue-handoff$/m);
  assert.match(text, /^includes:\s*\r?\n\s+- \.apm\//m);
});

test("root apm.yml registers package in devDependencies and marketplace", () => {
  const text = fs.readFileSync(path.join(repoRoot, "apm.yml"), "utf8");
  assert.match(
    text,
    /- \.\/packages\/github-issue-handoff/,
    "missing devDependencies.apm entry",
  );
  assert.match(
    text,
    /- name: github-issue-handoff\s+category: automation\s+source: scarecrow173\/apm-packages\s+subdir: packages\/github-issue-handoff/,
    "missing marketplace entry with category automation",
  );
});

function headings(rel: string): string[] {
  const text = fs.readFileSync(path.join(pkgRoot, rel), "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => /^#{1,6} /.test(line))
    .map((line) => line.replace(/^(#{1,6}) .*/, "$1"));
}

const pairedDocs = [
  "README",
  "AGENTS",
  ".apm/skills/github-issue-handoff/SKILL",
  ".apm/skills/github-issue-handoff/references/protocol",
  ".apm/skills/github-issue-handoff/references/issue-format",
  ".apm/skills/github-issue-handoff/references/responder-guide",
  ".apm/skills/github-issue-handoff/assets/templates/responder-prompt",
];

test("English and Japanese docs share heading structure", () => {
  for (const base of pairedDocs) {
    const en = headings(`${base}.md`);
    const ja = headings(`${base}.ja.md`);
    assert.deepEqual(
      ja,
      en,
      `heading structure mismatch between ${base}.md and ${base}.ja.md`,
    );
  }
});
