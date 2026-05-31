"use strict";

const fs = require("node:fs");
const path = require("node:path");
const matter = require("gray-matter");

const { resolvePath } = require("./expand.ts");

import type { AdapterConfig, ScannedSkill } from "./types";

function isSkillDir(dirPath: string): boolean {
  return fs.existsSync(path.join(dirPath, "SKILL.md"));
}

function parseSkillMd(skillDir: string): ScannedSkill {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const content = fs.readFileSync(skillMdPath, "utf8");
  const { data } = matter(content);

  const name: string = data.name || path.basename(skillDir);
  const description: string = data.description || "";

  const provides: ScannedSkill["provides"] = Array.isArray(data.provides)
    ? data.provides.map((p: unknown) => {
        if (typeof p === "string") return { capability: p };
        if (typeof p === "object" && p !== null) return p as { capability: string; description?: string };
        return { capability: String(p) };
      })
    : [];

  const uses: ScannedSkill["uses"] = Array.isArray(data.uses)
    ? data.uses.map((u: unknown) => {
        if (typeof u === "string") return { capability: u, required: false, override_allowed: true };
        if (typeof u === "object" && u !== null) {
          const obj = u as Record<string, unknown>;
          return {
            capability: String(obj.capability || ""),
            required: Boolean(obj.required),
            default_skill: obj.default_skill ? String(obj.default_skill) : undefined,
            override_allowed: obj.override_allowed !== false,
          };
        }
        return { capability: String(u), required: false, override_allowed: true };
      })
    : [];

  const execution_policy: ScannedSkill["execution_policy"] = data.execution_policy
    ? {
        strictness: data.execution_policy.strictness || "flexible",
        sequence_required: Boolean(data.execution_policy.sequence_required),
        allow_step_reordering: data.execution_policy.allow_step_reordering !== false,
        allow_partial_application: data.execution_policy.allow_partial_application !== false,
        guidance: data.execution_policy.guidance || undefined,
      }
    : {
        strictness: "flexible",
        sequence_required: false,
        allow_step_reordering: true,
        allow_partial_application: true,
      };

  const tags: string[] = Array.isArray(data.tags) ? data.tags.map(String) : [];

  return { name, description, provides, uses, execution_policy, tags };
}

function scanSkillDirs(rootPath: string): ScannedSkill[] {
  if (!fs.existsSync(rootPath)) return [];

  const skills: ScannedSkill[] = [];
  const stat = fs.statSync(rootPath);
  if (!stat.isDirectory()) return [];

  let entries: string[];
  try {
    entries = fs.readdirSync(rootPath);
  } catch (e: unknown) {
    console.error(`Warning: Cannot read directory "${rootPath}": ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry);
    const entryStat = fs.statSync(fullPath);
    if (entryStat.isDirectory() && isSkillDir(fullPath)) {
      try {
        skills.push(parseSkillMd(fullPath));
      } catch (e: unknown) {
        console.error(`Warning: Failed to parse SKILL.md in "${fullPath}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return skills;
}

function scanApmModules(rootPath: string): ScannedSkill[] {
  if (!fs.existsSync(rootPath)) return [];
  const skills: ScannedSkill[] = [];

  let orgs: string[];
  try {
    orgs = fs.readdirSync(rootPath);
  } catch (e: unknown) {
    console.error(`Warning: Cannot read directory "${rootPath}": ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }

  for (const org of orgs) {
    const orgPath = path.join(rootPath, org);
    if (!fs.statSync(orgPath).isDirectory()) continue;

    let packages: string[];
    try {
      packages = fs.readdirSync(orgPath);
    } catch (e: unknown) {
      console.error(`Warning: Cannot read directory "${orgPath}": ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    for (const pkg of packages) {
      const pkgPath = path.join(orgPath, pkg);
      if (!fs.statSync(pkgPath).isDirectory()) continue;
      // Look for skills/ dir inside package
      const skillsDir = path.join(pkgPath, "skills");
      if (fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory()) {
        skills.push(...scanSkillDirs(skillsDir));
      }
      // Also check if the package itself is a skill
      if (isSkillDir(pkgPath)) {
        try {
          skills.push(parseSkillMd(pkgPath));
        } catch (e: unknown) {
          console.error(`Warning: Failed to parse SKILL.md in "${pkgPath}": ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }
  return skills;
}

function scanRootInstructions(rootPath: string): ScannedSkill[] {
  // Root instruction files are not traditional skills with SKILL.md.
  // For now, skip them in catalog generation (they are informational only).
  return [];
}

function scanSkills(cwd: string, adapter: AdapterConfig): ScannedSkill[] {
  const allSkills: ScannedSkill[] = [];
  const seen = new Set<string>();

  const scopes = adapter.scan.scopes;
  for (const [scopeName, scope] of Object.entries(scopes)) {
    if (!scope.enabled) continue;
    for (const root of scope.roots) {
      const rootPath = resolvePath(root, cwd);

      // Project scope: enforce project boundary for security
      if (scopeName === "project") {
        const normalizedRoot = path.normalize(rootPath);
        const normalizedCwd = path.normalize(cwd);
        if (!normalizedRoot.startsWith(normalizedCwd + path.sep) && normalizedRoot !== normalizedCwd) {
          console.error(`Warning: scan root "${root}" resolves outside project boundary, skipping`);
          continue;
        }
      }

      if (root === "apm_modules") {
        const moduleSkills = scanApmModules(rootPath);
        for (const s of moduleSkills) {
          if (!seen.has(s.name)) { seen.add(s.name); allSkills.push(s); }
        }
      } else if (root === ".") {
        const rootSkills = scanRootInstructions(rootPath);
        for (const s of rootSkills) {
          if (!seen.has(s.name)) { seen.add(s.name); allSkills.push(s); }
        }
      } else {
        const dirSkills = scanSkillDirs(rootPath);
        for (const s of dirSkills) {
          if (!seen.has(s.name)) { seen.add(s.name); allSkills.push(s); }
        }
      }
    }
  }

  return allSkills;
}

module.exports = { scanSkills, scanSkillDirs, parseSkillMd };
