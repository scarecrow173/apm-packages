const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repoRoot = path.resolve(__dirname, "../../..");
const sourceSkillRoot = path.join(repoRoot, "scripts", "doc-driven-dev", "src", "skills");
const publishedSkillRoot = path.join(repoRoot, "packages", "doc-driven-dev", ".apm", "skills");
const testsRoot = path.join(repoRoot, "scripts", "doc-driven-dev", "tests");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(fullPath);
    }
    return [fullPath];
  });
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function listPublishedSkills() {
  return new Set(
    fs
      .readdirSync(publishedSkillRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => {
        const dir = path.join(publishedSkillRoot, entry.name);
        return fs.existsSync(path.join(dir, "SKILL.md")) || fs.existsSync(path.join(dir, "SKILL.ja.md"));
      })
      .map((entry) => entry.name),
  );
}

function listSkillTestDirectories() {
  const skillsTestRoot = path.join(testsRoot, "skills");
  if (!fs.existsSync(skillsTestRoot)) {
    return [];
  }

  return fs
    .readdirSync(skillsTestRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

test("source script entrypoints only exist for published package skills", () => {
  const publishedSkills = listPublishedSkills();
  const entryPoints = walk(sourceSkillRoot)
    .filter((filePath) => filePath.endsWith(".ts"))
    .filter((filePath) => toPosix(path.relative(sourceSkillRoot, filePath)).includes("/scripts/"))
    .filter((filePath) => !toPosix(path.relative(sourceSkillRoot, filePath)).includes("/scripts/lib/"));

  const orphaned = entryPoints
    .map((filePath) => {
      const rel = toPosix(path.relative(sourceSkillRoot, filePath));
      const skill = rel.split("/")[0];
      return publishedSkills.has(skill) ? null : rel;
    })
    .filter(Boolean);

  assert.deepEqual(
    orphaned,
    [],
    `Remove or publish these source script entrypoints: ${orphaned.join(", ")}`,
  );
});

test("tests only reference published package scripts that exist", () => {
  const testFiles = walk(testsRoot).filter((filePath) => filePath.endsWith(".test.ts"));
  const missing = [];

  for (const filePath of testFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    const relTestPath = toPosix(path.relative(testsRoot, filePath));

    for (const match of source.matchAll(/runScript\("([^"]+)",\s*"([^"]+\.js)"/g)) {
      const [, skill, script] = match;
      const target = path.join(publishedSkillRoot, skill, "scripts", script);
      if (!fs.existsSync(target)) {
        missing.push(`${relTestPath} -> ${skill}/scripts/${script}`);
      }
    }

    if (relTestPath === "adr-doc.test.ts") {
      for (const match of source.matchAll(/runScript\("([^"]+\.js)"/g)) {
        const [, script] = match;
        const target = path.join(publishedSkillRoot, "adr-doc", "scripts", script);
        if (!fs.existsSync(target)) {
          missing.push(`${relTestPath} -> adr-doc/scripts/${script}`);
        }
      }
    }

    if (relTestPath === "impl-doc.test.ts") {
      for (const match of source.matchAll(/runScript\("([^"]+\.js)"/g)) {
        const [, script] = match;
        const target = path.join(publishedSkillRoot, "impl-doc", "scripts", script);
        if (!fs.existsSync(target)) {
          missing.push(`${relTestPath} -> impl-doc/scripts/${script}`);
        }
      }
    }

    if (relTestPath.includes("skills/skill-discovery-protocol/")) {
      for (const match of source.matchAll(/"(infer|profile|query|scan|sdp|validate)\.js"/g)) {
        const [, scriptName] = match;
        const target = path.join(publishedSkillRoot, "skill-discovery-protocol", "scripts", `${scriptName}.js`);
        if (!fs.existsSync(target)) {
          missing.push(`${relTestPath} -> skill-discovery-protocol/scripts/${scriptName}.js`);
        }
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    `Update or remove test references to missing package scripts: ${missing.join(", ")}`,
  );
});

test("skill-specific test directories only exist for published package skills", () => {
  const publishedSkills = listPublishedSkills();
  const orphaned = listSkillTestDirectories().filter((skill) => !publishedSkills.has(skill));

  assert.deepEqual(
    orphaned,
    [],
    `Remove or relocate orphaned skill test directories: ${orphaned.join(", ")}`,
  );
});
