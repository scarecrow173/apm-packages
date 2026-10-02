import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");
const pkgRoot = path.join(repoRoot, "packages", "review-protocol");
const skillDir = path.join(pkgRoot, ".apm", "skills", "review-protocol");

const requiredFiles = [
  "apm.yml",
  "README.md",
  "README.ja.md",
  "AGENTS.md",
  "AGENTS.ja.md",
  ".apm/skills/review-protocol/SKILL.md",
  ".apm/skills/review-protocol/SKILL.ja.md",
  ".apm/skills/review-protocol/references/protocol.md",
  ".apm/skills/review-protocol/references/protocol.ja.md",
  ".apm/skills/review-protocol/references/report-format.md",
  ".apm/skills/review-protocol/references/report-format.ja.md",
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
  assert.equal(data.name, "review-protocol");
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
    /review|spec|design|plan|code|document/i,
    "description should describe the review trigger conditions",
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

test("package manifest declares review-protocol with .apm includes", () => {
  const text = fs.readFileSync(path.join(pkgRoot, "apm.yml"), "utf8");
  assert.match(text, /^name: review-protocol$/m);
  assert.match(text, /^includes:\s*\r?\n\s+- \.apm\//m);
  assert.doesNotMatch(
    text,
    /^  (test|lint-md):/m,
    "manifest scripts must not reference the repo-only pnpm workspace",
  );
});

test("maintainer docs run repo-managed tools through mise exec", () => {
  for (const rel of [
    "AGENTS.md",
    "AGENTS.ja.md",
    "README.md",
    "README.ja.md",
  ]) {
    const text = fs.readFileSync(path.join(pkgRoot, rel), "utf8");
    assert.ok(
      text.includes("mise exec -- pnpm --dir scripts/review-protocol"),
      `${rel}: validation commands must go through mise exec`,
    );
  }
});

test("root apm.yml registers package in devDependencies and marketplace", () => {
  const text = fs.readFileSync(path.join(repoRoot, "apm.yml"), "utf8");
  assert.match(
    text,
    /- \.\/packages\/review-protocol/,
    "missing devDependencies.apm entry",
  );
  assert.match(
    text,
    /- name: review-protocol\s+category: workflow\s+source: scarecrow173\/apm-packages\s+subdir: packages\/review-protocol/,
    "missing marketplace entry with category workflow",
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
  ".apm/skills/review-protocol/SKILL",
  ".apm/skills/review-protocol/references/protocol",
  ".apm/skills/review-protocol/references/report-format",
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
