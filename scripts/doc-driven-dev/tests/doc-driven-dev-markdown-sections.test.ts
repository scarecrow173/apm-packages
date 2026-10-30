import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  bodyLabelNames,
  bodyLabelPattern,
  hasSection,
  headingNames,
  SECTION_BODY_LABEL_ALIASES,
  SECTION_HEADING_ALIASES,
  sectionBody,
  stripFencedBlocks,
  subHeadingCount,
} from "../src/skills/lib/markdown_sections";
import {
  hasSection as adrHasSection,
  sectionBody as adrSectionBody,
} from "../src/skills/adr-doc/scripts/lib/adr_utils";

const skillsRoot = path.resolve(__dirname, "../../../packages/doc-driven-dev/.apm/skills");

// --- sectionBody / hasSection -------------------------------------------------

test("sectionBody resolves the canonical English heading", () => {
  const body = "# Spec\n\n## Acceptance Criteria\n\n- [ ] done\n\n## Scope\n\n- x\n";
  assert.equal(sectionBody(body, "Acceptance Criteria"), "- [ ] done");
  assert.equal(hasSection(body, "Acceptance Criteria"), true);
});

test("sectionBody resolves a declared Japanese alias", () => {
  const body = "# Spec\n\n## 受け入れ基準\n\n- [ ] 完了\n\n## 範囲\n\n- x\n";
  assert.equal(sectionBody(body, "Acceptance Criteria"), "- [ ] 完了");
  assert.equal(hasSection(body, "Acceptance Criteria"), true);
  assert.equal(sectionBody(body, "Scope"), "- x");
});

test("an unrecognized heading still misses (fail-closed)", () => {
  const body = "# Spec\n\n## 受入条件\n\n- [ ] 完了\n";
  assert.equal(sectionBody(body, "Acceptance Criteria"), "");
  assert.equal(hasSection(body, "Acceptance Criteria"), false);
});

test("a canonical heading wins over an alias present in the same document", () => {
  const body = [
    "# Task",
    "",
    "## 影響ファイル",
    "",
    "- src/alias.ts",
    "",
    "## Affected Files",
    "",
    "- src/canonical.ts",
    "",
  ].join("\n");
  assert.equal(sectionBody(body, "Affected Files"), "- src/canonical.ts");
});

test("aliases resolve in declared order, not document order", () => {
  // "Open Questions" declares ["未解決の論点", "未解決事項"]: the first declared
  // alias wins even when the second appears earlier in the document.
  const body = [
    "# Doc",
    "",
    "## 未解決事項",
    "",
    "- second-declared",
    "",
    "## 未解決の論点",
    "",
    "- first-declared",
    "",
  ].join("\n");
  assert.equal(sectionBody(body, "Open Questions"), "- first-declared");
});

test("headings without declared aliases keep exact-case-insensitive matching", () => {
  const body = "# Impl\n\n## follow-ups\n\n- none\n";
  assert.equal(hasSection(body, "Follow-ups"), true);
  assert.equal(sectionBody(body, "Follow-ups"), "- none");
});

test("headingNames returns the canonical first, then declared aliases", () => {
  assert.deepEqual(headingNames("Affected Files"), ["Affected Files", "影響ファイル"]);
  assert.deepEqual(headingNames("Follow-ups"), ["Follow-ups"]);
});

test("subHeadingCount counts headings at exactly the requested depth", () => {
  const section = "### A\n\ntext\n\n### B\n\n#### too-deep\n\n### C\n";
  assert.equal(subHeadingCount(section), 3);
  assert.equal(subHeadingCount(section, 4), 1);
});

// --- fenced code blocks are documentation, not declarations -------------------

test("a fenced ## heading never satisfies hasSection or sectionBody", () => {
  const fenced = "# Spec\n\n```md\n## Acceptance Criteria\n\n- [ ] fake\n```\n";
  assert.equal(hasSection(fenced, "Acceptance Criteria"), false);
  assert.equal(sectionBody(fenced, "Acceptance Criteria"), "");
  const tilde = "# Spec\n\n~~~\n## Acceptance Criteria\n\n- [ ] fake\n~~~\n";
  assert.equal(hasSection(tilde, "Acceptance Criteria"), false);
});

test("a fenced localized alias heading never satisfies hasSection", () => {
  const fenced = "# Spec\n\n```md\n## 受け入れ基準\n\n- [ ] fake\n```\n";
  assert.equal(hasSection(fenced, "Acceptance Criteria"), false);
});

test("fenced content inside a real section is not part of the section body", () => {
  const body = [
    "## Considered Options",
    "",
    "```",
    "### Phantom",
    "- fake bullet",
    "```",
    "",
    "### Real",
    "",
  ].join("\n");
  const section = sectionBody(body, "Considered Options");
  assert.equal(section, "### Real");
  assert.equal(subHeadingCount(section), 1);
});

test("an unclosed fence drops the remainder of the body", () => {
  const body = "# Doc\n\n```\n## Acceptance Criteria\n\n- [ ] fake\n";
  assert.equal(hasSection(body, "Acceptance Criteria"), false);
  assert.equal(sectionBody(body, "Acceptance Criteria"), "");
});

test("a heading after a closed fence still resolves", () => {
  const body = "# Doc\n\n```\n## Phantom\n```\n\n## Acceptance Criteria\n\n- [ ] real\n";
  assert.equal(hasSection(body, "Acceptance Criteria"), true);
  assert.equal(sectionBody(body, "Acceptance Criteria"), "- [ ] real");
});

test("a fence opener whose info string contains the fence char is ordinary text", () => {
  // CommonMark: "``` has a `backtick`" is a paragraph line, not an opener.
  const body = "# Doc\n\n``` has a `tick`\n\n## Acceptance Criteria\n\n- [ ] real\n";
  assert.equal(hasSection(body, "Acceptance Criteria"), true);
  assert.equal(sectionBody(body, "Acceptance Criteria"), "- [ ] real");
});

test("stripFencedBlocks is idempotent and keeps non-fence lines", () => {
  const body = "# Doc\n\ntext\n\n```\ncode\n```\n\n## Real\n";
  const once = stripFencedBlocks(body);
  assert.equal(once, "# Doc\n\ntext\n\n\n## Real\n");
  assert.equal(stripFencedBlocks(once), once);
});

// --- body labels ------------------------------------------------------------

test("bodyLabelPattern accepts the canonical spelling plus declared aliases", () => {
  assert.equal(bodyLabelPattern("Affected paths").test("* Affected paths: src/x.ts"), true);
  assert.equal(bodyLabelPattern("Affected paths").test("* 影響するパス: src/x.ts"), true);
  assert.equal(bodyLabelPattern("Affected paths").test("* 別の書き方: src/x.ts"), false);
});

test("bodyLabelPattern covers either-of canonical checks", () => {
  const pattern = bodyLabelPattern("Patterns to follow", "Constraints");
  assert.equal(pattern.test("* Patterns to follow: existing code"), true);
  assert.equal(pattern.test("* Constraints: keep API stable"), true);
  assert.equal(pattern.test("* 従うパターン: 既存コード"), true);
  assert.equal(pattern.test("* 制約: API を維持"), true);
  // 避けるパターン (patterns to avoid) is a different label and must not satisfy.
  assert.equal(pattern.test("* 避けるパターン: なし"), false);
});

test("bodyLabelNames returns the canonical first, then declared aliases", () => {
  assert.deepEqual(bodyLabelNames("Affected paths"), ["Affected paths", "影響するパス"]);
  assert.deepEqual(bodyLabelNames("Unmapped Label"), ["Unmapped Label"]);
});

// --- adr_utils AST helpers (depth-agnostic) -----------------------------------

test("adr_utils hasSection/sectionBody accept a localized heading at ## depth", async () => {
  const content = "---\ntype: adr\n---\n\n# ADR\n\n## 実装計画\n\n* Affected paths: src/x.ts\n";
  assert.equal(await adrHasSection(content, "Implementation Plan"), true);
  assert.equal(await adrSectionBody(content, "Implementation Plan"), "* Affected paths: src/x.ts");
});

test("adr_utils hasSection accepts a localized heading at ### depth", async () => {
  const content = "# ADR\n\n## 決定内容\n\n### 影響\n\n* 良い点: x\n\n### 確認方法\n\ny\n";
  assert.equal(await adrHasSection(content, "Consequences"), true);
  assert.equal(await adrHasSection(content, "Confirmation"), true);
});

test("adr_utils sectionBody prefers the canonical heading when both spellings exist", async () => {
  const content = "# ADR\n\n## 実装計画\n\nalias body\n\n## Implementation Plan\n\ncanonical body\n";
  assert.equal(await adrSectionBody(content, "Implementation Plan"), "canonical body");
});

test("adr_utils hasSection still fails closed on an unrecognized heading", async () => {
  const content = "# ADR\n\n## 実装の計画\n\nbody\n";
  assert.equal(await adrHasSection(content, "Implementation Plan"), false);
});

// --- template drift guard -------------------------------------------------------

function templateHeadings(file: string): string[] {
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => /^#{2,6}\s+/.test(line))
    .map((line) => line.replace(/^#{2,6}\s+/, "").trim());
}

test("every localized heading in shipped .ja.md templates is a declared alias", () => {
  const mismatches: string[] = [];
  const localizedPairs: Array<{ en: string; ja: string }> = [];
  for (const skill of fs.readdirSync(skillsRoot)) {
    const templatesDir = path.join(skillsRoot, skill, "assets", "templates");
    if (!fs.existsSync(templatesDir)) continue;
    for (const file of fs.readdirSync(templatesDir).filter((name) => name.endsWith(".ja.md"))) {
      const enPath = path.join(templatesDir, file.replace(/\.ja\.md$/, ".md"));
      if (!fs.existsSync(enPath)) {
        mismatches.push(`${skill}/${file}: missing English template sibling`);
        continue;
      }
      const enHeadings = templateHeadings(enPath);
      const jaHeadings = templateHeadings(path.join(templatesDir, file));
      if (enHeadings.length !== jaHeadings.length) {
        mismatches.push(`${skill}/${file}: heading count drift en=${enHeadings.length} ja=${jaHeadings.length}`);
        continue;
      }
      enHeadings.forEach((en, index) => {
        const ja = jaHeadings[index];
        if (en === ja) return;
        localizedPairs.push({ en, ja });
        const aliases = SECTION_HEADING_ALIASES[en] ?? [];
        if (!aliases.includes(ja)) {
          mismatches.push(`${skill}/${file}: "${en}" -> "${ja}" is not declared in SECTION_HEADING_ALIASES`);
        }
      });
    }
  }
  assert.ok(localizedPairs.length > 0, "expected at least one localized template heading");
  assert.deepEqual(mismatches, []);
});

test("every declared canonical and alias still appears in the shipped templates", () => {
  const enHeadings = new Set<string>();
  const jaHeadings = new Set<string>();
  for (const skill of fs.readdirSync(skillsRoot)) {
    const templatesDir = path.join(skillsRoot, skill, "assets", "templates");
    if (!fs.existsSync(templatesDir)) continue;
    for (const file of fs.readdirSync(templatesDir)) {
      const headings = templateHeadings(path.join(templatesDir, file));
      for (const heading of headings) {
        if (file.endsWith(".ja.md")) jaHeadings.add(heading);
        else if (file.endsWith(".md")) enHeadings.add(heading);
      }
    }
  }
  const stale: string[] = [];
  for (const [canonical, aliases] of Object.entries(SECTION_HEADING_ALIASES)) {
    if (!enHeadings.has(canonical)) stale.push(`canonical "${canonical}" not found in any .md template`);
    for (const alias of aliases) {
      if (!jaHeadings.has(alias)) stale.push(`alias "${alias}" (${canonical}) not found in any .ja.md template`);
    }
  }
  assert.deepEqual(stale, []);
});

function templateBodyLabels(file: string): string[] {
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => /^\s*[-*+]\s+([^:：]{1,80}):/.exec(line)?.[1]?.trim())
    .filter((label): label is string => Boolean(label));
}

test("every declared body label spelling still appears in the shipped templates", () => {
  // Bullet labels are not positionally parallel across locales (the ja
  // templates add labels like 良い点:/悪い点: with no English counterpart),
  // so this guard only checks that declared spellings still exist somewhere
  // in the shipped templates — a template edit that drops or renames a
  // checked label must fail here rather than silently breaking the checks.
  const enLabels = new Set<string>();
  const jaLabels = new Set<string>();
  for (const skill of fs.readdirSync(skillsRoot)) {
    const templatesDir = path.join(skillsRoot, skill, "assets", "templates");
    if (!fs.existsSync(templatesDir)) continue;
    for (const file of fs.readdirSync(templatesDir)) {
      const labels = templateBodyLabels(path.join(templatesDir, file));
      for (const label of labels) {
        if (file.endsWith(".ja.md")) jaLabels.add(label);
        else if (file.endsWith(".md")) enLabels.add(label);
      }
    }
  }
  const stale: string[] = [];
  for (const [canonical, aliases] of Object.entries(SECTION_BODY_LABEL_ALIASES)) {
    if (!enLabels.has(canonical)) stale.push(`canonical "${canonical}" not found in any .md template`);
    for (const alias of aliases) {
      if (!jaLabels.has(alias)) stale.push(`alias "${alias}" (${canonical}) not found in any .ja.md template`);
    }
  }
  assert.deepEqual(stale, []);
});
