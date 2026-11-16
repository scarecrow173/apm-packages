#!/usr/bin/env node
// Deterministic setup-pstack generator for Devin.
//
// Parses `devin models list` output into the detected slug set, applies
// upstream's budget/effort arithmetic to the canonical role schema
// (roles.json, mirroring upstream setup-pstack step 5), and emits:
//   - ~/.devin/rules/pstack-models.md          (always_on rule, upstream's
//                                               `role: slug[, slug…]` lines)
//   - <devin agents dir>/pstack-<slug>.md and pstack-<slug>-ro.md profiles
// Every generated file carries a `# pstack-generated:` sha256 marker so
// re-runs can tell own output from user edits. Zero dependencies; runnable
// as `node setup.mjs <parse|plan|apply>`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

const ROLES_DOC = JSON.parse(
  fs.readFileSync(new URL("./roles.json", import.meta.url), "utf8"),
);
const ROLES = ROLES_DOC.roles;

// Upstream-verified arithmetic (skills/setup-pstack/SKILL.md step 3b):
// budget moves the role default's effort on this ladder, clamped at ends.
const LADDER = ["low", "medium", "high", "xhigh", "max"];
const BUDGET_DELTA = { unlimited: 1, large: 0, medium: -1, small: -2 };
// The effort each budget label names (most defaults sit at xhigh).
const BUDGET_EFFORT = { unlimited: "max", large: "xhigh", medium: "high", small: "medium" };
// Aliases are valid values though never detected slugs.
const ALIASES = new Set(["inherit-parent", "auto"]);
// A slug token: lowercase alphanumerics joined by single `-`/`.` separators.
const SLUG_RE = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
const MARKER_RE = /^([^\n]*pstack-generated: sha256:([0-9a-f]{64})[^\n]*)\n?$/m;

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/** `devin models list` text → detected slug[]. A line yields a slug only
 *  when it is an indented model row (real rows are indented) or when the
 *  trimmed line IS the slug (the paste-bare-slugs fallback path) — so
 *  prose like the footer `or switch models in a session with
 *  `/model <name>`.`, whose first token is slug-shaped, stays out. The
 *  first whitespace token must then match the slug pattern (headers like
 *  `SWE-2 (swe-2)` and `aliases:` rows fail it); `fusion-*` slugs are a
 *  lead+sidekick pair, not subagent models, so they are dropped. Order
 *  preserved, deduplicated. */
export function parseModels(raw) {
  const slugs = [];
  const seen = new Set();
  for (const line of String(raw).split("\n")) {
    const trimmed = line.trim();
    const token = trimmed.split(/\s+/)[0] ?? "";
    const row = /^\s/.test(line) || trimmed === token;
    if (
      !row ||
      !SLUG_RE.test(token) ||
      token.startsWith("fusion-") ||
      seen.has(token)
    ) {
      continue;
    }
    seen.add(token);
    slugs.push(token);
  }
  return slugs;
}

/** Arena Phase A families: longest matching prefix wins, a leading
 *  `cursor-` is dropped first, and anything else is the text before the
 *  first hyphen. */
export function familyOf(slug) {
  const s = slug.startsWith("cursor-") ? slug.slice("cursor-".length) : slug;
  if (s.startsWith("claude-fable-")) return "claude-fable";
  if (s.startsWith("claude-")) return "claude";
  if (s.startsWith("gemini-")) return "gemini";
  const i = s.indexOf("-");
  return i === -1 ? s : s.slice(0, i);
}

/** Effort token = last token, or the token before a trailing `fast`. */
export function effortOf(slug) {
  const parts = slug.split("-");
  const hasFast = parts[parts.length - 1] === "fast";
  return {
    effort: hasFast ? parts[parts.length - 2] : parts[parts.length - 1],
    hasFast,
  };
}

function rank(effort) {
  return LADDER.indexOf(effort);
}

function clampRank(i) {
  return Math.max(0, Math.min(LADDER.length - 1, i));
}

/** Rewrite `slug`'s effort token to `effort`, preserving a trailing
 *  `-fast` (never adding one — families without fast slugs, like fable and
 *  gemini, keep their shape). */
function setEffort(slug, effort) {
  const parts = slug.split("-");
  const idx = parts[parts.length - 1] === "fast" ? parts.length - 2 : parts.length - 1;
  parts[idx] = effort;
  return parts.join("-");
}

/** The detected slug in `family` with the highest effort at or below
 *  `targetRank`; tie-breaks toward the wanted fast flag, then name order,
 *  so the result is deterministic. */
function bestFallback(family, targetRank, detected, wantFast) {
  const candidates = detected
    .filter((s) => familyOf(s) === family)
    .map((s) => ({ slug: s, ...effortOf(s) }))
    .filter((c) => rank(c.effort) !== -1 && rank(c.effort) <= targetRank);
  candidates.sort((a, b) =>
    rank(b.effort) - rank(a.effort) ||
    Number(b.hasFast === wantFast) - Number(a.hasFast === wantFast) ||
    (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return candidates[0]?.slug ?? null;
}

/** Apply the budget to every configured role and resolve against
 *  `detected`. `choices` is the working table — roles absent from it keep
 *  their documented defaults and do not appear in `resolved`/`needsChoice`
 *  (the caller merges defaults for display and file output; unknown keys
 *  are dropped, which is the retired-role behavior).
 *
 *  Per entry: `inherit-parent`/`auto` pass through; a slug with no ladder
 *  effort token (`adaptive`, `*-lightning`, `*-priority`) stays when
 *  detected; otherwise the effort token is set to the role's target — its
 *  default's effort moved by the budget. When that rewrite is not a
 *  detected slug, the role default's *family* supplies the detected slug
 *  with the highest effort at or below the target (per position for
 *  panel roles). `resolved` always carries the best value — a detected
 *  rewrite, the fallback, or the unchanged input — while `needsChoice`
 *  marks roles the caller must confirm (a substitution, or no fallback at
 *  all). A keep that lands on the unchanged input is clean: that is
 *  upstream's "gemini tops out at high" case. */
export function applyBudget(roles, choices, detected, budget) {
  const delta = BUDGET_DELTA[budget];
  if (delta === undefined) {
    throw new Error(
      `unknown budget ${JSON.stringify(budget)} — expected one of ` +
        Object.keys(BUDGET_DELTA).join(", "),
    );
  }
  const detSet = new Set(detected);
  const resolved = {};
  const needsChoice = [];
  for (const role of roles) {
    if (!(role.key in choices)) continue;
    const defaults = role.default.split(",").map((s) => s.trim());
    const entries = String(choices[role.key])
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const out = [];
    let flagged = false;
    entries.forEach((entry, i) => {
      const defEntry = defaults[Math.min(i, defaults.length - 1)];
      const targetRank = clampRank(rank(effortOf(defEntry).effort) + delta);
      const fallbackOrKeep = (hasFast) => {
        const fb = bestFallback(familyOf(defEntry), targetRank, detected, hasFast);
        if (fb === null || fb === entry) {
          // Empty pool: keep the input as the suggestion and flag. An
          // identical fallback means the role's own family already tops
          // out below target — a silent keep, no flag.
          if (fb === null) flagged = true;
          out.push(entry);
          return;
        }
        out.push(fb);
        flagged = true; // substitution changes what the user configured
      };
      if (ALIASES.has(entry)) {
        out.push(entry);
        return;
      }
      const e = effortOf(entry);
      if (rank(e.effort) === -1) {
        if (detSet.has(entry)) {
          out.push(entry); // effort-less slug: nothing to move
          return;
        }
        fallbackOrKeep(e.hasFast);
        return;
      }
      const rewritten = setEffort(entry, LADDER[targetRank]);
      if (detSet.has(rewritten)) {
        out.push(rewritten);
        return;
      }
      fallbackOrKeep(e.hasFast);
    });
    resolved[role.key] = out.join(", ");
    if (flagged) needsChoice.push(role.key);
  }
  return { resolved, needsChoice };
}

/** Wrap `body` (which must end in `\n`) with its trailing marker line. The
 *  sha covers the body only, so the marker can be verified in place. */
function stamp(body, markerLine) {
  return body + markerLine.replace("<sha>", sha256(body));
}

/** True when `content` is byte-identical to what the generator would emit:
 *  a marker on the last line whose sha256 matches the preceding body. */
function isOwnOutput(content) {
  const m = MARKER_RE.exec(content);
  if (m === null) return false;
  const body = content.slice(0, m.index);
  const after = content.slice(m.index + m[0].length);
  return after === "" && sha256(body) === m[2];
}

/** `~/.devin/rules/pstack-models.md` content: Devin `trigger: always_on`
 *  frontmatter, upstream's comment/defaults/budget lines (with `Task`
 *  adapted to `run_subagent`), and one `role: slug[, slug…]` line per
 *  configured role in roles.json order, so re-runs are byte-stable and
 *  mapped consumer reads keep working. Roles absent from `choices` get no
 *  line — the reader falls back to the skill default, which keeps every
 *  emitted slug inside the detected-or-alias set. */
export function rulesFile(choices, budget) {
  const effort = BUDGET_EFFORT[budget];
  if (effort === undefined) {
    throw new Error(
      `unknown budget ${JSON.stringify(budget)} — expected one of ` +
        Object.keys(BUDGET_EFFORT).join(", "),
    );
  }
  const body =
    "---\n" +
    "description: pstack per-role model choices (overrides skill defaults)\n" +
    "trigger: always_on\n" +
    "---\n" +
    "# pstack model configuration. One line per role. Delete a line to fall back to the skill default.\n" +
    "# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit `model` — `run_subagent` inherits the parent). Alias entries in a panel list still count toward its fan-out.\n" +
    `# defaults: ${ROLES_DOC.schema}\n` +
    `# budget: ${budget} (${effort})\n` +
    ROLES.filter(
      (r) => r.key in choices && String(choices[r.key]).trim().length > 0,
    )
      .map((r) => `${r.key}: ${String(choices[r.key]).trim()}`)
      .join("\n") +
    "\n";
  return stamp(body, "# pstack-generated: sha256:<sha>\n");
}

/** Profile content for `pstack-<slug>.md` (`ro: false`) or
 *  `pstack-<slug>-ro.md` (`ro: true`). The ro variant restricts
 *  `allowed-tools` to the doc-verified read set (`read`, `grep`, `glob` —
 *  the docs.devin.ai/cli/subagents.md example tokens) and states the
 *  residual risk honestly: it never claims a hard read-only guarantee.
 *  Body keeps the poteto-agent contract — read the spawning skill's
 *  SKILL.md in full — adapted for a delegate. */
export function profileFile(model, { ro }) {
  const name = `pstack-${model}${ro ? "-ro" : ""}`;
  const body =
    "---\n" +
    `name: ${name}\n` +
    `description: pstack delegate subagent pinned to model \`${model}\`${
      ro ? " for read-only fan-out entries" : ""
    }. Spawn with \`run_subagent\` \`profile: "${name}"\` when a pstack skill or \`~/.devin/rules/pstack-models.md\` names this model for a role or panel entry.\n` +
    `model: ${model}\n` +
    (ro ? "allowed-tools: read, grep, glob\n" : "") +
    "---\n" +
    "\n" +
    `# ${name}\n` +
    "\n" +
    `You are a pstack delegate subagent pinned to model \`${model}\`. ` +
    "Read the `SKILL.md` of the pstack skill that spawned you in full " +
    "before doing any work — your parent names it in the task brief.\n" +
    (ro
      ? "\nread-only intent enforced via allowed-tools — for a hard " +
        "guarantee spawn `subagent_explore` instead\n"
      : "");
  return stamp(body, "<!-- pstack-generated: sha256:<sha> -->\n");
}

/** Compare on-disk `fsState` (name → content) with the `desired` output.
 *  Absent → `write`; identical → `unchanged`; different-with-valid-marker
 *  → `diff` (own prior output); different-without-marker-or-mangled →
 *  `diff` flagged `userModified`. Each `diff` entry also records
 *  `diskSha`, the on-disk sha256 at plan time, so apply can tell when a
 *  file drifted after the plan was shown. Extra `pstack-*.md` on disk
 *  are `removeCandidates` — never deleted here. */
export function planChanges(fsState, desired) {
  const write = [];
  const diff = [];
  const unchanged = [];
  const removeCandidates = [];
  for (const name of Object.keys(desired).sort()) {
    if (!(name in fsState)) {
      write.push(name);
      continue;
    }
    if (fsState[name] === desired[name]) {
      unchanged.push(name);
      continue;
    }
    diff.push({
      file: name,
      userModified: !isOwnOutput(fsState[name]),
      diskSha: sha256(fsState[name]),
    });
  }
  for (const name of Object.keys(fsState).sort()) {
    if (name in desired) continue;
    if (/^pstack-.*\.md$/.test(name)) removeCandidates.push(name);
  }
  return { write, diff, removeCandidates, unchanged };
}

/** Parse upstream's step-5 block (or a generated rule file): the
 *  `# defaults: N` schema line and every `role:` key. Frontmatter inside
 *  `---` fences and `#` comment lines are skipped; role keys keep their
 *  literal commas. */
export function detectRolesSchema(text) {
  let schemaN = null;
  const roleKeys = [];
  let inFrontmatter = false;
  let frontmatterDone = false;
  for (const raw of String(text).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!frontmatterDone) {
      if (line === "---") {
        inFrontmatter = !inFrontmatter;
        if (!inFrontmatter) frontmatterDone = true;
        continue;
      }
      if (inFrontmatter) continue;
      frontmatterDone = true; // no leading frontmatter — parse this line
    }
    const dm = /^# defaults: (\d+)\s*$/.exec(line);
    if (dm) {
      schemaN = Number(dm[1]);
      continue;
    }
    if (line.startsWith("#") || line.trim() === "") continue;
    const rm = /^(.+?):\s+\S/.exec(line);
    if (rm) roleKeys.push(rm[1].trim());
  }
  return { schemaN, roleKeys };
}

/** Devin write roots: the global rules dir and the custom agents dir.
 *  `PSTACK_DEVIN_RULES_DIR`/`PSTACK_DEVIN_AGENTS_DIR` relocate both for
 *  tests. */
function devinRoots(env) {
  const home = os.homedir();
  const appdata = env.APPDATA ?? path.join(home, "AppData", "Roaming");
  return {
    rulesDir: env.PSTACK_DEVIN_RULES_DIR ?? path.join(home, ".devin", "rules"),
    agentsDir:
      env.PSTACK_DEVIN_AGENTS_DIR ??
      (process.platform === "win32"
        ? path.join(appdata, "devin", "agents")
        : path.join(home, ".config", "devin", "agents")),
  };
}

/** Resolve `p` and assert it stays under one of `roots`. A `.cursor` or
 *  `.claude` path segment is rejected outright — the script must never
 *  write to another harness's dirs. Returns the absolute target. */
function assertWriteTarget(p, roots) {
  const expanded = p.startsWith("~")
    ? path.join(os.homedir(), p.slice(1))
    : p;
  const resolved = path.resolve(expanded);
  const segments = resolved.split(path.sep).map((s) => s.toLowerCase());
  if (segments.includes(".cursor") || segments.includes(".claude")) {
    throw new Error(`refusing to write under a Cursor/Claude path: ${p}`);
  }
  const ok = roots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
  if (!ok) {
    throw new Error(
      `write target escapes Devin roots: ${p} (allowed: ${roots.join(", ")})`,
    );
  }
  return resolved;
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) {
      throw new Error(`unexpected argument ${JSON.stringify(a)}`);
    }
    const key = a.slice(2);
    if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      flags[key] = args[++i];
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function reqFlag(flags, name) {
  const v = flags[name];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`missing required --${name} <value>`);
  }
  return v;
}

async function readAll(stream) {
  if (typeof stream === "string") return stream;
  let data = "";
  for await (const chunk of stream) data += chunk;
  return data;
}

function readDirMap(dir, filter) {
  const map = {};
  if (!fs.existsSync(dir)) return map;
  for (const name of fs.readdirSync(dir).sort()) {
    if (filter.test(name) && fs.statSync(path.join(dir, name)).isFile()) {
      map[name] = fs.readFileSync(path.join(dir, name), "utf8");
    }
  }
  return map;
}

/** Every slug in every choice value must be a detected slug or an alias —
 *  fail closed before anything is generated. */
function assertDetected(choices, detected) {
  const valid = new Set([...detected, ...ALIASES]);
  const bad = [];
  for (const [key, value] of Object.entries(choices)) {
    for (const entry of String(value).split(",").map((s) => s.trim())) {
      if (entry.length > 0 && !valid.has(entry)) bad.push(`${key}: ${entry}`);
    }
  }
  if (bad.length > 0) {
    throw new Error(
      "choices reference slugs outside the detected set — refusing " +
        `to write undetected models:\n  ${bad.join("\n  ")}`,
    );
  }
}

function cmdPlan(flags, env, out) {
  const roots = devinRoots(env);
  const rulesPath = assertWriteTarget(
    flags["rules-path"] ?? path.join(roots.rulesDir, "pstack-models.md"),
    [roots.rulesDir],
  );
  const agentsDir = flags["agents-dir"]
    ? assertWriteTarget(flags["agents-dir"], [roots.agentsDir])
    : path.resolve(roots.agentsDir);

  const choicesDoc = JSON.parse(fs.readFileSync(reqFlag(flags, "choices"), "utf8"));
  const choices = { ...(choicesDoc.choices ?? choicesDoc) };
  delete choices.choices; // meta keys are not roles
  delete choices.budget;
  const budget =
    typeof flags.budget === "string" ? flags.budget : (choicesDoc.budget ?? "large");
  const detected = parseModels(fs.readFileSync(reqFlag(flags, "models"), "utf8"));

  // Retired/unknown role keys are dropped, not validated — the same
  // retired-line semantics as deleting a rules line. Filtering here keeps
  // assertDetected, applyBudget, rulesFile and the profile set on one
  // role-key universe; dropped keys are reported so the caller can tell
  // the user which lines were ignored.
  const knownKeys = new Set(ROLES.map((r) => r.key));
  const droppedRoles = [];
  for (const key of Object.keys(choices)) {
    if (!knownKeys.has(key)) {
      delete choices[key];
      droppedRoles.push(key);
    }
  }
  assertDetected(choices, detected);

  const budgetRun = applyBudget(ROLES, choices, detected, budget);
  const desiredRules = rulesFile(choices, budget);

  const slugs = new Set();
  for (const value of Object.values(choices)) {
    for (const entry of String(value).split(",").map((s) => s.trim())) {
      if (entry.length > 0 && !ALIASES.has(entry)) slugs.add(entry);
    }
  }
  const desiredProfiles = {};
  for (const slug of [...slugs].sort()) {
    desiredProfiles[`pstack-${slug}.md`] = profileFile(slug, { ro: false });
    desiredProfiles[`pstack-${slug}-ro.md`] = profileFile(slug, { ro: true });
  }

  const fsRules = {};
  if (fs.existsSync(rulesPath)) {
    fsRules[path.basename(rulesPath)] = fs.readFileSync(rulesPath, "utf8");
  }
  const rulesChange = planChanges(fsRules, { [path.basename(rulesPath)]: desiredRules });
  const profilesChange = planChanges(
    readDirMap(agentsDir, /^pstack-.*\.md$/),
    desiredProfiles,
  );

  const files = { [rulesPath]: desiredRules };
  for (const [name, content] of Object.entries(desiredProfiles)) {
    files[path.join(agentsDir, name)] = content;
  }
  out.write(
    JSON.stringify(
      {
        budget,
        detected,
        resolved: budgetRun.resolved,
        needsChoice: budgetRun.needsChoice,
        droppedRoles,
        targets: {
          rules: rulesPath,
          rulesDir: path.dirname(rulesPath),
          agentsDir,
        },
        changes: {
          rules: { path: rulesPath, ...rulesChange },
          profiles: { dir: agentsDir, ...profilesChange },
        },
        files,
      },
      null,
      2,
    ) + "\n",
  );
}

function cmdApply(flags, env, out) {
  const roots = devinRoots(env);
  const allowed = [roots.rulesDir, roots.agentsDir];
  const plan = JSON.parse(fs.readFileSync(reqFlag(flags, "plan"), "utf8"));
  const yes = flags.yes === true;
  const allowRemove = flags.remove === true;

  // Stale-plan guard (plan↔apply TOCTOU): every write target's current
  // on-disk state must equal what the plan recorded — absent for `write`
  // entries, the desired bytes' sha for `unchanged` (disk equaled the
  // desired content at plan time), the recorded `diskSha` for `diff`.
  // Any other state is a difference the user never saw in the plan
  // output, so refuse rather than overwrite it — even under --yes, which
  // only authorizes the diffs the plan displayed.
  const desired = new Map(
    Object.entries(plan.files ?? {}).map(([t, c]) => [path.resolve(t), c]),
  );
  const expected = new Map(); // resolved target -> sha256 hex | null (absent)
  for (const { change, dir } of [
    { change: plan.changes?.rules, dir: plan.targets?.rulesDir },
    { change: plan.changes?.profiles, dir: plan.targets?.agentsDir },
  ]) {
    if (change == null || typeof dir !== "string" || dir === "") continue;
    for (const name of change.write ?? []) {
      expected.set(path.resolve(path.join(dir, name)), null);
    }
    for (const name of change.unchanged ?? []) {
      const target = path.resolve(path.join(dir, name));
      expected.set(
        target,
        desired.has(target) ? sha256(desired.get(target)) : undefined,
      );
    }
    for (const d of change.diff ?? []) {
      expected.set(
        path.resolve(path.join(dir, d.file)),
        typeof d.diskSha === "string" ? d.diskSha : undefined,
      );
    }
  }
  const stale = [];
  for (const target of desired.keys()) {
    let current = null;
    try {
      current = sha256(fs.readFileSync(target, "utf8"));
    } catch (e) {
      if (e?.code !== "ENOENT") current = "<unreadable>"; // dir/perm drift
    }
    if (expected.get(target) !== current) stale.push(target);
  }
  if (stale.length > 0) {
    throw new Error(
      `plan is stale — ${stale.length} write target(s) changed on disk ` +
        `since the plan was made (${stale.join(", ")}) — re-run plan`,
    );
  }

  const diffs = [
    ...(plan.changes?.rules?.diff ?? []),
    ...(plan.changes?.profiles?.diff ?? []),
  ];
  if (diffs.length > 0 && !yes) {
    const flagged = diffs.filter((d) => d.userModified).map((d) => d.file);
    throw new Error(
      `refusing to apply: ${diffs.length} file(s) differ on disk` +
        (flagged.length > 0
          ? ` (${flagged.length} user-modified: ${flagged.join(", ")})`
          : "") +
        " — review the plan, then re-run with --yes to overwrite",
    );
  }

  for (const [target, content] of desired) {
    const resolved = assertWriteTarget(target, allowed);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content);
    out.write(`wrote ${resolved}\n`);
  }

  const removes = [
    ...(plan.changes?.rules?.removeCandidates ?? []).map((n) =>
      path.join(plan.targets?.rulesDir ?? "", n)),
    ...(plan.changes?.profiles?.removeCandidates ?? []).map((n) =>
      path.join(plan.targets?.agentsDir ?? "", n)),
  ];
  for (const candidate of removes) {
    const resolved = assertWriteTarget(candidate, allowed);
    if (allowRemove) {
      fs.rmSync(resolved, { force: true });
      out.write(`removed ${resolved}\n`);
    } else {
      out.write(`kept ${resolved} (pass --remove to delete)\n`);
    }
  }
}

/** CLI: `parse` (stdin `devin models list` → slugs JSON),
 *  `plan --choices <file> --models <file> [--budget <label>]` (plan JSON to
 *  stdout), `apply --plan <file> [--yes] [--remove]`. `io` injects
 *  env/stdin/stdout for tests. */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const out = io.stdout ?? process.stdout;
  const [cmd, ...rest] = argv;
  const flags = parseFlags(rest);
  if (cmd === "parse") {
    const slugs = parseModels(await readAll(io.stdin ?? process.stdin));
    out.write(JSON.stringify(slugs) + "\n");
    return;
  }
  if (cmd === "plan") {
    cmdPlan(flags, env, out);
    return;
  }
  if (cmd === "apply") {
    cmdApply(flags, env, out);
    return;
  }
  throw new Error(
    "usage: setup.mjs <parse|plan|apply>\n" +
      "  parse                                   stdin: `devin models list` → slugs JSON\n" +
      "  plan --choices <file> --models <file>   [--budget <label>] [--rules-path <p>] [--agents-dir <d>]\n" +
      "  apply --plan <file>                     [--yes] [--remove]",
  );
}

const invoked =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
