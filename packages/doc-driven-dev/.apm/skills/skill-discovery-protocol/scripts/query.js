#!/usr/bin/env node
"use strict";

// src/skills/skill-discovery-protocol/scripts/lib/query/registry.ts
var registry = /* @__PURE__ */ new Map();
function register(handler11) {
  registry.set(handler11.name, handler11);
}
function getHandler(name) {
  return registry.get(name);
}
function getAllHandlers() {
  return Array.from(registry.values());
}
function getSubcommandNames() {
  return Array.from(registry.keys());
}
function findClosestMatch(input) {
  const names = getSubcommandNames();
  let best = null;
  let bestDist = Infinity;
  for (const name of names) {
    const dist = levenshtein(input, name);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  if (best && bestDist <= Math.ceil(input.length / 2)) {
    return best;
  }
  return null;
}
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// src/skills/skill-discovery-protocol/scripts/lib/query/categories.ts
var handler = {
  name: "categories",
  description: "\u30AB\u30C6\u30B4\u30EA\u4E00\u89A7",
  execute(ctx) {
    const categories = ctx.profile.classification.categories;
    return categories.map((c) => ({
      id: c.id,
      label: c.label,
      skill_count: c.skills.length
    }));
  }
};
register(handler);

// src/skills/skill-discovery-protocol/scripts/lib/query/category_skills.ts
var handler2 = {
  name: "category-skills",
  description: "\u30AB\u30C6\u30B4\u30EA\u5185\u30B9\u30AD\u30EB\u4E00\u89A7",
  requiredArgs: ["category"],
  execute(ctx) {
    const categoryId = ctx.args.category;
    const categories = ctx.profile.classification.categories;
    const cat = categories.find((c) => c.id === categoryId);
    if (!cat) {
      return { error: `Category not found: ${categoryId}` };
    }
    return cat.skills;
  }
};
register(handler2);

// src/skills/skill-discovery-protocol/scripts/lib/query/resolution.ts
var handler3 = {
  name: "resolution",
  description: "\u89E3\u6C7A\u95A2\u4FC2\u4E00\u89A7",
  execute(ctx) {
    const invocations = ctx.profile.resolved_invocations;
    if (ctx.args.skill) {
      return invocations.filter((i) => i.source_skill === ctx.args.skill);
    }
    return invocations;
  }
};
register(handler3);

// src/skills/skill-discovery-protocol/scripts/lib/query/flow_stack.ts
var handler4 = {
  name: "flow-stack",
  description: "Flow Stack \u5B9A\u7FA9",
  execute(ctx) {
    const flowStack = ctx.profile.flow_stack;
    if (ctx.args.slot) {
      const slot = flowStack.slots.find((s) => s.slot_id === ctx.args.slot);
      if (!slot) {
        return { error: `Slot not found: ${ctx.args.slot}` };
      }
      return slot;
    }
    return flowStack;
  }
};
register(handler4);

// src/skills/skill-discovery-protocol/scripts/lib/query/execution_policy.ts
var handler5 = {
  name: "execution-policy",
  description: "\u5B9F\u884C\u30DD\u30EA\u30B7\u30FC",
  execute(ctx) {
    if (!ctx.catalog) {
      return { error: "Catalog not found (skill-reference-catalog.json must be co-located with profile)" };
    }
    const skills = ctx.catalog.skills;
    if (ctx.args.skill) {
      const skill = skills.find((s) => s.name === ctx.args.skill);
      if (!skill) {
        return { error: `Skill not found: ${ctx.args.skill}` };
      }
      return { skill: skill.name, execution_policy: skill.execution_policy };
    }
    return skills.map((s) => ({
      skill: s.name,
      execution_policy: s.execution_policy
    }));
  }
};
register(handler5);

// src/skills/skill-discovery-protocol/scripts/lib/query/capability_skills.ts
var handler6 = {
  name: "capability-skills",
  description: "capability \u9006\u5F15\u304D",
  requiredArgs: ["capability"],
  execute(ctx) {
    if (!ctx.catalog) {
      return { error: "Catalog not found (skill-reference-catalog.json must be co-located with profile)" };
    }
    const capabilityId = ctx.args.capability;
    const matching = ctx.catalog.skills.filter(
      (s) => s.provides.some((p) => p.capability === capabilityId)
    );
    return matching.map((s) => ({
      name: s.name,
      description: s.description,
      provides: s.provides.find((p) => p.capability === capabilityId)
    }));
  }
};
register(handler6);

// src/skills/skill-discovery-protocol/scripts/lib/query/skill_detail.ts
var handler7 = {
  name: "skill-detail",
  description: "\u30B9\u30AD\u30EB\u8A73\u7D30",
  requiredArgs: ["skill"],
  execute(ctx) {
    if (!ctx.catalog) {
      return { error: "Catalog not found (skill-reference-catalog.json must be co-located with profile)" };
    }
    const skillName = ctx.args.skill;
    const skill = ctx.catalog.skills.find((s) => s.name === skillName);
    if (!skill) {
      return { error: `Skill not found: ${skillName}` };
    }
    return skill;
  }
};
register(handler7);

// src/skills/skill-discovery-protocol/scripts/lib/runtime_guidance_ranker.ts
function normalizeTerms(terms = []) {
  return terms.map((term) => term.trim().toLowerCase()).filter((term) => term.length > 0);
}
function entryText(entry) {
  return `${entry.skill} ${entry.context} ${entry.guidance}`.toLowerCase();
}
function matchesAny(text, terms) {
  return terms.some((term) => text.includes(term) || term.includes(text));
}
function isCompatibleWithPolicy(entry, policy) {
  if (entry.requires_sequence && !policy.sequence_required) {
    return false;
  }
  if (entry.requires_step_reordering && !policy.allow_step_reordering) {
    return false;
  }
  if (entry.requires_partial_application && !policy.allow_partial_application) {
    return false;
  }
  return true;
}
function scoreGuidance(entry, selectionContext) {
  let score = entry.priority_delta ?? 0;
  const selectionTerms = normalizeTerms(selectionContext.terms);
  if (selectionTerms.length === 0) {
    return score;
  }
  const preferTerms = normalizeTerms(entry.prefer_when);
  const avoidTerms = normalizeTerms(entry.avoid_when);
  const haystack = entryText(entry);
  for (const term of selectionTerms) {
    if (haystack.includes(term) || term.includes(haystack)) {
      score += 1;
    }
    if (matchesAny(term, preferTerms)) {
      score += 3;
    }
    if (matchesAny(term, avoidTerms)) {
      score -= 3;
    }
  }
  return score;
}
function enrichCandidate(candidate, guidanceEntries) {
  const match = guidanceEntries.find(
    (entry) => entry.skill === candidate.skill && entry.context === candidate.context && entry.guidance === candidate.guidance
  );
  return match ? { ...match, ...candidate } : candidate;
}
function rankCandidates(candidates, guidanceEntries = [], executionPolicies = [], selectionContext = {}) {
  const policyBySkill = new Map(executionPolicies.map((skill) => [skill.name, skill.execution_policy]));
  const seen = /* @__PURE__ */ new Set();
  const scored = [];
  for (const rawCandidate of candidates) {
    const entry = enrichCandidate(rawCandidate, guidanceEntries);
    const policy = policyBySkill.get(entry.skill);
    if (policy && !isCompatibleWithPolicy(entry, policy)) {
      continue;
    }
    const dedupeKey = `${entry.skill}::${entry.context}::${entry.guidance}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    scored.push({
      guidance: entry,
      score: scoreGuidance(entry, selectionContext)
    });
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const skillCompare = left.guidance.skill.localeCompare(right.guidance.skill);
    if (skillCompare !== 0) {
      return skillCompare;
    }
    const contextCompare = left.guidance.context.localeCompare(right.guidance.context);
    if (contextCompare !== 0) {
      return contextCompare;
    }
    return left.guidance.guidance.localeCompare(right.guidance.guidance);
  });
  return scored.map((item) => item.guidance);
}
function rankRuntimeGuidance(entries, skills = [], selectionContext = {}) {
  return rankCandidates(entries, entries, skills, selectionContext);
}

// src/skills/skill-discovery-protocol/scripts/lib/query/runtime_guidance.ts
var handler8 = {
  name: "runtime-guidance",
  description: "\u5B9F\u884C\u6642\u30AC\u30A4\u30C0\u30F3\u30B9",
  execute(ctx) {
    const guidance = rankRuntimeGuidance(
      ctx.profile.runtime_guidance,
      ctx.catalog?.skills ?? []
    );
    if (ctx.args.skill) {
      return guidance.filter((g) => g.skill === ctx.args.skill);
    }
    return guidance;
  }
};
register(handler8);

// src/skills/skill-discovery-protocol/scripts/lib/query/unresolved.ts
var handler9 = {
  name: "unresolved",
  description: "\u672A\u89E3\u6C7A\u4E00\u89A7",
  execute(ctx) {
    const unresolved = [];
    for (const inv of ctx.profile.resolved_invocations) {
      if (!inv.resolved_skill) {
        unresolved.push({
          source: "resolved_invocations",
          source_skill: inv.source_skill,
          capability: inv.capability,
          slot: inv.slot,
          reason: inv.reason
        });
      }
    }
    for (const warning of ctx.profile.warnings) {
      if (warning.toLowerCase().includes("unresolved") || warning.toLowerCase().includes("resolution")) {
        unresolved.push({
          source: "warnings",
          message: warning
        });
      }
    }
    return unresolved;
  }
};
register(handler9);

// src/skills/skill-discovery-protocol/scripts/lib/query/validation_status.ts
var handler10 = {
  name: "validation-status",
  description: "\u691C\u8A3C\u72B6\u614B\u8981\u7D04",
  execute(ctx) {
    if (!ctx.validationReport) {
      return { error: "Validation report not found (validation-report.json must be co-located with profile)" };
    }
    return {
      validated_at: ctx.validationReport.validated_at,
      adapter_id: ctx.validationReport.adapter_id,
      summary: ctx.validationReport.summary,
      checks: ctx.validationReport.checks
    };
  }
};
register(handler10);

// src/skills/skill-discovery-protocol/scripts/lib/query/loader.ts
var fs = require("node:fs");
var path = require("node:path");
function isPathWithinProject(rootDir, candidatePath) {
  const rel = path.relative(rootDir, candidatePath);
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}
function findSdpRootDir(rootDir, profilePath) {
  let current = path.dirname(profilePath);
  while (isPathWithinProject(rootDir, current)) {
    if (path.basename(current) === ".sdp") {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return null;
}
function loadQueryContext(args) {
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();
  const profilePath = path.resolve(cwd, args.profile);
  if (!isPathWithinProject(cwd, profilePath)) {
    throw new Error(`Profile path is outside project boundary: ${args.profile}`);
  }
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }
  const profileContent = fs.readFileSync(profilePath, "utf8");
  const profile = JSON.parse(profileContent);
  if (!profile.schema_version) {
    throw new Error("Invalid profile: missing schema_version");
  }
  const profileDir = path.dirname(profilePath);
  const rootSdpDir = findSdpRootDir(cwd, profilePath);
  const catalog = loadOptionalJson(
    path.join(profileDir, "skill-reference-catalog.json")
  ) || (rootSdpDir ? loadOptionalJson(
    path.join(rootSdpDir, "skill-reference-catalog.json")
  ) : null);
  const validationReport = loadOptionalJson(
    path.join(profileDir, "validation-report.json")
  ) || (rootSdpDir ? loadOptionalJson(
    path.join(rootSdpDir, "validation-report.json")
  ) : null);
  return { profile, catalog, validationReport, args };
}
function loadOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// src/skills/skill-discovery-protocol/scripts/lib/query/render.ts
var JsonRenderer = class {
  render(data) {
    return JSON.stringify(data, null, 2);
  }
};
var MarkdownRenderer = class {
  render(data) {
    if (data == null || typeof data !== "object") {
      return String(data);
    }
    if (Array.isArray(data)) {
      return data.map((item) => {
        if (item == null || typeof item !== "object") {
          return `- ${String(item)}`;
        }
        const entries2 = Object.entries(item);
        if (entries2.length === 0) return `- (empty)`;
        const [firstKey, firstVal] = entries2[0];
        const heading = `- **${firstKey}:** ${String(firstVal)}`;
        const rest = entries2.slice(1).map(([k, v]) => `  - ${k}: ${String(v)}`);
        return [heading, ...rest].join("\n");
      }).join("\n");
    }
    const entries = Object.entries(data);
    return entries.map(([k, v]) => `- **${k}:** ${String(v)}`).join("\n");
  }
};
var TableRenderer = class {
  render(data) {
    if (data == null || typeof data !== "object") {
      return String(data);
    }
    if (Array.isArray(data)) {
      if (data.length === 0) return "";
      const cols = [
        ...new Set(
          data.flatMap(
            (item) => item != null && typeof item === "object" ? Object.keys(item) : []
          )
        )
      ];
      if (cols.length === 0) return data.map((item) => String(item)).join("\n");
      const widths = cols.map(
        (col) => Math.max(
          col.length,
          ...data.map((item) => {
            const val = item != null && typeof item === "object" ? String(item[col] ?? "") : "";
            return val.length;
          })
        )
      );
      const header2 = `| ${cols.map((c, i) => c.padEnd(widths[i])).join(" | ")} |`;
      const sep2 = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
      const rows2 = data.map((item) => {
        const cells = cols.map((col, i) => {
          const val = item != null && typeof item === "object" ? String(item[col] ?? "") : "";
          return val.padEnd(widths[i]);
        });
        return `| ${cells.join(" | ")} |`;
      });
      return [header2, sep2, ...rows2].join("\n");
    }
    const entries = Object.entries(data);
    if (entries.length === 0) return "";
    const keyWidth = Math.max(...entries.map(([k]) => k.length));
    const valWidth = Math.max(
      ...entries.map(([, v]) => String(v).length),
      5
    );
    const header = `| ${"key".padEnd(keyWidth)} | ${"value".padEnd(valWidth)} |`;
    const sep = `| ${"-".repeat(keyWidth)} | ${"-".repeat(valWidth)} |`;
    const rows = entries.map(
      ([k, v]) => `| ${k.padEnd(keyWidth)} | ${String(v).padEnd(valWidth)} |`
    );
    return [header, sep, ...rows].join("\n");
  }
};
var renderers = {
  json: new JsonRenderer(),
  md: new MarkdownRenderer(),
  table: new TableRenderer()
};
function getRenderer(format) {
  return renderers[format];
}

// src/skills/skill-discovery-protocol/scripts/query.ts
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--profile") args.profile = argv[++i];
    else if (arg === "--category") args.category = argv[++i];
    else if (arg === "--skill") args.skill = argv[++i];
    else if (arg === "--slot") args.slot = argv[++i];
    else if (arg === "--capability") args.capability = argv[++i];
    else if (arg === "--cwd") args.cwd = argv[++i];
    else if (arg === "--format") args.format = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (!arg.startsWith("--") && !args.subcommand) args.subcommand = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}
function usage() {
  const handlers = getAllHandlers();
  const lines = handlers.map((h) => `  ${h.name.padEnd(22)}${h.description}`);
  return `Usage: sdp query --profile <json> <subcommand> [options]

Options:
  --profile <path>      Path to flow profile JSON (required)
  --format <fmt>        Output format: json|md|table (default: json)
  --cwd <path>          Working directory
  --help, -h            Show help

Subcommands:
${lines.join("\n")}`;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.profile) {
    console.error("Error: --profile is required");
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  if (!args.subcommand) {
    console.error("Error: subcommand is required");
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  const handler11 = getHandler(args.subcommand);
  if (!handler11) {
    console.error(`Error: Unknown subcommand "${args.subcommand}"`);
    const closest = findClosestMatch(args.subcommand);
    if (closest) {
      console.error(`Did you mean: ${closest}?`);
    }
    console.error(`Available subcommands: ${getSubcommandNames().join(", ")}`);
    process.exitCode = 2;
    return;
  }
  if (handler11.requiredArgs) {
    for (const req of handler11.requiredArgs) {
      if (!args[req]) {
        console.error(`Error: --${req} is required for ${handler11.name}`);
        process.exitCode = 1;
        return;
      }
    }
  }
  let ctx;
  try {
    ctx = loadQueryContext(args);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
    return;
  }
  const result = handler11.execute(ctx);
  const format = args.format || "json";
  const renderer = getRenderer(format);
  console.log(renderer.render(result));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
