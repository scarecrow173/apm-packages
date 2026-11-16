import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// setup.mjs is plain Node ESM shipped with the skill; import it directly so
// these are real logic tests, not content greps. tsx compiles this file to
// CJS, so the ESM import happens inside before() rather than at top level.
const SETUP = join(
  __dirname,
  "../../../packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/setup.mjs",
);
const ROLES_JSON = join(
  __dirname,
  "../../../packages/pstack-devin/overlay/skills/setup-pstack-devin/scripts/roles.json",
);
const FIXTURE = join(__dirname, "fixtures", "setup-pstack-upstream-step5.txt");

interface Role { key: string; default: string; panel?: boolean }
interface PlanDiff { file: string; userModified: boolean; diskSha: string }
interface SetupModule {
  parseModels(raw: string): string[];
  familyOf(slug: string): string;
  effortOf(slug: string): { effort: string; hasFast: boolean };
  applyBudget(
    roles: Role[],
    choices: Record<string, string>,
    detected: string[],
    budget: string,
  ): { resolved: Record<string, string>; needsChoice: string[] };
  rulesFile(choices: Record<string, string>, budget: string): string;
  profileFile(model: string, opts: { ro: boolean }): string;
  planChanges(
    fsState: Record<string, string>,
    desired: Record<string, string>,
  ): {
    write: string[];
    diff: PlanDiff[];
    removeCandidates: string[];
    unchanged: string[];
  };
  detectRolesSchema(text: string): { schemaN: number | null; roleKeys: string[] };
  main(argv: string[], io?: unknown): Promise<void>;
}

let M: SetupModule;
before(async () => {
  M = (await import(pathToFileURL(SETUP).href)) as SetupModule;
});

const rolesDoc = JSON.parse(readFileSync(ROLES_JSON, "utf8")) as {
  schema: number;
  defaults_sha: string;
  roles: Role[];
};
const roles = rolesDoc.roles;
const fixture = readFileSync(FIXTURE, "utf8").replace(/\r\n/g, "\n");

function tmpdir(): string {
  return mkdtempSync(join(osTmpdir(), "pstack-setup-test-"));
}

test("parseModels drops fusion-* and keeps real slugs", () => {
  const slugs = M.parseModels(
    "SWE-2 (swe-2)\n" +
      "  swe-2-high\n" +
      "  swe-2-max\n" +
      "Fusion\n" +
      "  fusion-claude-opus-5-5-max-sidekick-swe-2-high\n" +
      "Adaptive\n" +
      "  adaptive\n",
  );
  assert.deepEqual(slugs.sort(), ["adaptive", "swe-2-high", "swe-2-max"]);
});

test("parseModels ignores headers, alias rows, and trailing annotations", () => {
  // Shape verified against `devin models list` on devin 3000.12.57: family
  // headers carry a title-case name plus a parenthetical, `aliases:` rows
  // name shorthand that is not a slug, and slug rows carry descriptions.
  const raw =
    "Available models (51 families)\n\n" +
    "SWE-2 (swe-2)\n" +
    "  aliases: swe\n" +
    "  swe-2-high          SWE-2 High  [262K context, Free]\n" +
    "  swe-2-medium-lightning  SWE-2 Medium Lightning  [262K context]\n\n" +
    "Gemini 3.8 Flash (gemini-3.8-flash)\n" +
    "  aliases: gemini\n" +
    "  gemini-3-8-flash-high   Gemini 3.8 Flash High  [1.05M context]\n";
  const slugs = M.parseModels(raw);
  assert.deepEqual(
    slugs.sort(),
    ["gemini-3-8-flash-high", "swe-2-high", "swe-2-medium-lightning"],
  );
  assert.ok(!slugs.includes("swe"), "family alias must not be a slug");
});

test("familyOf applies longest-prefix rules and strips cursor-", () => {
  assert.equal(M.familyOf("claude-fable-5-2-max"), "claude-fable");
  assert.equal(M.familyOf("claude-opus-5-5-xhigh"), "claude");
  assert.equal(M.familyOf("gemini-4-carbon-high"), "gemini");
  assert.equal(M.familyOf("cursor-claude-fable-5-2-max"), "claude-fable");
  assert.equal(M.familyOf("swe-2-high"), "swe");
  assert.equal(M.familyOf("adaptive"), "adaptive");
});

test("effortOf reads last token, or the one before a trailing fast", () => {
  assert.deepEqual(M.effortOf("swe-2-max"), { effort: "max", hasFast: false });
  assert.deepEqual(M.effortOf("claude-opus-5-5-high-fast"), {
    effort: "high",
    hasFast: true,
  });
});

test("applyBudget moves effort on the ladder and clamps at the top", () => {
  const r = M.applyBudget(
    roles,
    { "bug-fix": "swe-2-xhigh" },
    ["swe-2-max", "swe-2-xhigh", "swe-2-high"],
    "unlimited",
  );
  assert.equal(r.resolved["bug-fix"], "swe-2-max"); // +1 clamped at top
});

test("applyBudget small drops effort two rungs incl. fast suffix", () => {
  const r = M.applyBudget(
    roles,
    { "swarm workers": "m-xhigh-fast" },
    ["m-xhigh-fast", "m-low-fast", "m-medium"],
    "small",
  );
  assert.equal(r.resolved["swarm workers"], "m-low-fast");
});

test("undetected rewrite with empty fallback family is needsChoice", () => {
  const r = M.applyBudget(
    roles,
    { "bug-fix": "swe-2-high" },
    ["swe-2-high"],
    "large",
  );
  // high -> xhigh is not a detected slug and no detected slug in the role
  // default's family is at-or-below xhigh, so the role needs a choice.
  assert.deepEqual(r.needsChoice, ["bug-fix"]);
  assert.equal(r.resolved["bug-fix"], "swe-2-high"); // keeps current value
});

test("fallback substitutes the role default's family and flags it", () => {
  const r = M.applyBudget(
    roles,
    { "bug-fix": "swe-2-high" },
    ["swe-2-high", "claude-9-high"],
    "large",
  );
  // swe-2-xhigh undetected; claude-9-high is the highest-effort slug at or
  // below xhigh in the bug-fix default's family (claude) — surfaced for
  // confirmation rather than silently applied.
  assert.equal(r.resolved["bug-fix"], "claude-9-high");
  assert.deepEqual(r.needsChoice, ["bug-fix"]);
});

test("a choice already at the best at-or-below effort stays, unflagged", () => {
  const r = M.applyBudget(
    roles,
    { "bug-fix": "claude-9-high" },
    ["claude-9-high", "swe-2-high"],
    "unlimited",
  );
  // claude-9-max undetected; claude-9-high is the best <= max in the
  // default's family and equals the current value — a silent keep, like
  // upstream's gemini-tops-out-at-high example.
  assert.equal(r.resolved["bug-fix"], "claude-9-high");
  assert.ok(!r.needsChoice.includes("bug-fix"));
});

test("panel list: one slug per entry, fan-out preserved", () => {
  const r = M.applyBudget(
    roles,
    { "arena runners": "f-high, o-high-fast, g-high" },
    ["f-high", "o-high-fast", "g-high"],
    "medium",
  );
  assert.equal(r.resolved["arena runners"].split(",").length, 3); // never collapse
});

test("inherit-parent and auto pass through unchanged", () => {
  const r = M.applyBudget(
    roles,
    { "bug-fix": "auto", "swarm workers": "inherit-parent" },
    ["swe-2-high"],
    "unlimited",
  );
  assert.equal(r.resolved["bug-fix"], "auto");
  assert.equal(r.resolved["swarm workers"], "inherit-parent");
  assert.ok(!r.needsChoice.includes("bug-fix"));
  assert.ok(!r.needsChoice.includes("swarm workers"));
});

test("resolved entries are always detected slugs or aliases", () => {
  const detected = ["swe-2-high", "swe-2-xhigh", "claude-9-high"];
  const r = M.applyBudget(
    roles,
    { "bug-fix": "swe-2-high", "perf-issue": "claude-9-high" },
    detected,
    "medium",
  );
  const valid = new Set([...detected, "auto", "inherit-parent"]);
  for (const [key, value] of Object.entries(r.resolved)) {
    if (r.needsChoice.includes(key)) continue; // suggestions may echo input
    for (const slug of value.split(",").map((s) => s.trim())) {
      assert.ok(valid.has(slug), `undetected slug emitted for ${key}: ${slug}`);
    }
  }
});

test("rulesFile is byte-stable and uses upstream's exact line format", () => {
  const choices = Object.fromEntries(
    roles.map((r) => [r.key, "swe-2-xhigh"]),
  );
  const a = M.rulesFile(choices, "large");
  assert.equal(a, M.rulesFile(choices, "large"));
  assert.match(a, /trigger: always_on/);
  assert.match(a, /# defaults: 2/);
  assert.match(a, /# budget: large \(xhigh\)/);
  assert.match(a, /^feature, refactoring: swe-2-xhigh$/m);
  assert.match(a, /run_subagent/);
  assert.doesNotMatch(a, /alwaysApply|Task `model`/);
  // byte-stable ordering = roles.json order
  const order = [...a.matchAll(/^([A-Za-z][^\n:#]*?): /gm)]
    .map((m) => m[1])
    .filter((k) => k !== "description" && k !== "trigger");
  assert.deepEqual(order, roles.map((r) => r.key));
});

test("ro profile restricts allowed-tools and stays honest about guarantees", () => {
  const p = M.profileFile("swe-2-max", { ro: true });
  assert.match(p, /^name: pstack-swe-2-max-ro$/m);
  assert.match(p, /^model: swe-2-max$/m);
  const tools = /^allowed-tools:\s*(.+)$/m.exec(p)?.[1] ?? "";
  for (const token of tools.split(",").map((s) => s.trim())) {
    assert.ok(["read", "grep", "glob"].includes(token), `unverified tool: ${token}`);
  }
  assert.doesNotMatch(p, /allowed-tools[^\n]*(exec|write|edit)/i);
  assert.doesNotMatch(p, /完全read-only|fully read-only/i);
  assert.match(p, /subagent_explore/);
});

test("planChanges: own output unchanged -> skip; user-edited -> flagged diff", () => {
  const ownX = M.profileFile("swe-2-x", { ro: false });
  const ownY = M.profileFile("swe-2-y", { ro: false });
  const st = { "pstack-x.md": ownX, "pstack-y.md": "user edited" };
  const pl = M.planChanges(st, { "pstack-x.md": ownX, "pstack-y.md": ownY });
  assert.equal(pl.unchanged.length, 1);
  assert.equal(pl.diff.length, 1);
  assert.equal(pl.diff[0].file, "pstack-y.md");
  assert.equal(pl.diff[0].userModified, true);
});

test("own stale output diffs without the user-modified flag; missing -> write", () => {
  const ownX = M.profileFile("swe-2-x", { ro: false });
  const st = { "pstack-x.md": ownX };
  const pl = M.planChanges(st, {
    "pstack-x.md": M.profileFile("swe-2-x2", { ro: false }),
    "pstack-z.md": M.profileFile("swe-2-z", { ro: false }),
  });
  assert.deepEqual(pl.write, ["pstack-z.md"]);
  assert.equal(pl.diff.length, 1);
  assert.equal(pl.diff[0].userModified, false);
});

test("obsolete pstack-*.md files are removeCandidates only", () => {
  const ownX = M.profileFile("swe-2-x", { ro: false });
  const st = { "pstack-x.md": ownX, "pstack-old.md": ownX, "notes.md": "keep" };
  const pl = M.planChanges(st, { "pstack-x.md": ownX });
  assert.deepEqual(pl.removeCandidates, ["pstack-old.md"]);
  assert.deepEqual(pl.unchanged, ["pstack-x.md"]);
});

test("detectRolesSchema parses upstream's step-5 block", () => {
  const parsed = M.detectRolesSchema(fixture);
  assert.equal(parsed.schemaN, 2);
  assert.deepEqual(parsed.roleKeys, roles.map((r) => r.key));
});

test("roles.json schema stays a superset of upstream's step-5 roles", () => {
  const parsed = M.detectRolesSchema(fixture);
  const known = new Set(roles.map((r) => r.key));
  const missing = parsed.roleKeys.filter((k) => !known.has(k));
  assert.deepEqual(
    missing,
    [],
    `roles.json is missing upstream role(s): ${missing.join(", ")} — ` +
      "update the roles.json config AND its schema to match upstream",
  );
  assert.equal(rolesDoc.schema, parsed.schemaN);
  const sha = createHash("sha256").update(fixture, "utf8").digest("hex");
  assert.equal(
    rolesDoc.defaults_sha,
    `sha256:${sha}`,
    "roles.json defaults_sha diverged from upstream step-5 block — " +
      "re-extract the fixture and update the roles.json config AND schema",
  );
});

test("main refuses paths outside the Devin roots", async () => {
  const dir = tmpdir();
  const choices = join(dir, "choices.json");
  const models = join(dir, "models.txt");
  writeFileSync(choices, JSON.stringify({ "bug-fix": "swe-2-high" }));
  writeFileSync(models, "  swe-2-high\n  swe-2-max\n");
  await assert.rejects(
    M.main([
      "plan",
      "--choices", choices,
      "--models", models,
      "--rules-path", join(dir, ".cursor", "rules", "pstack-models.mdc"),
    ]),
    /cursor|claude|devin roots/i,
  );
});

test("parseModels keeps the real `devin models list` footer out", () => {
  // The real footer (devin 3000.12.57): `or` is slug-shaped and used to
  // leak into the detected set. Real model rows are indented, so the
  // unindented footer now fails the row test — as do the header line and
  // the `aliases:` row (its first token carries a colon).
  const raw =
    "Available models (51 families)\n\n" +
    "SWE-2 (swe-2)\n" +
    "  aliases: swe\n" +
    "  swe-2-high                                                                 SWE-2 High  [262K context, Free]\n\n" +
    "Pass a family slug, alias, or model UID to `--model` (e.g. `--model opus`)\n" +
    "or switch models in a session with `/model <name>`.\n";
  assert.deepEqual(M.parseModels(raw), ["swe-2-high"]);
});

test("parseModels still accepts a pasted bare-slug list", () => {
  // The unindented fallback: the whole trimmed line IS the slug — the
  // "ask the user to paste the slugs" path from upstream step 2.
  assert.deepEqual(M.parseModels("swe-2-high\nswe-2-max\n"), [
    "swe-2-high",
    "swe-2-max",
  ]);
});

/** env confined to tmp dirs + a capturing stdout for main()'s io seam. */
function ioFor(dir: string) {
  const env = {
    PSTACK_DEVIN_RULES_DIR: join(dir, "rules"),
    PSTACK_DEVIN_AGENTS_DIR: join(dir, "agents"),
  };
  let text = "";
  return {
    io: { env, stdout: { write: (s: string) => { text += s; } } },
    text: () => text,
  };
}

interface PlanDoc {
  resolved: Record<string, string>;
  needsChoice: string[];
  droppedRoles: string[];
  targets: { rules: string; rulesDir: string; agentsDir: string };
  files: Record<string, string>;
}

/** Run `plan` fully inside `dir`: choices/models/plan.json plus the
 *  PSTACK_DEVIN_* roots all live under the tmp dir. */
async function runPlan(
  dir: string,
  choices: Record<string, string>,
  models: string,
): Promise<{ plan: PlanDoc; planPath: string }> {
  const cap = ioFor(dir);
  const choicesPath = join(dir, "choices.json");
  const modelsPath = join(dir, "models.txt");
  writeFileSync(choicesPath, JSON.stringify(choices));
  writeFileSync(modelsPath, models);
  await M.main(
    ["plan", "--choices", choicesPath, "--models", modelsPath],
    cap.io,
  );
  const planPath = join(dir, "plan.json");
  writeFileSync(planPath, cap.text());
  return { plan: JSON.parse(cap.text()) as PlanDoc, planPath };
}

test("plan drops unknown role keys as droppedRoles instead of throwing", async () => {
  // Retired-role semantics: an unknown key is ignored like a deleted
  // rules line — even when its value is not a detected slug. Before the
  // choices filter, assertDetected iterated raw choice keys and threw.
  const dir = tmpdir();
  const { plan } = await runPlan(
    dir,
    { "retired role": "undetected-x", "bug-fix": "swe-2-high" },
    "  swe-2-high\n  swe-2-xhigh\n",
  );
  assert.deepEqual(plan.droppedRoles, ["retired role"]);
  assert.ok(!("retired role" in plan.resolved));
  assert.ok(
    Object.keys(plan.files).every((f) => !f.includes("undetected-x")),
    "a dropped role's slug must not produce profile files",
  );
});

test("apply refuses a stale plan even with --yes", async () => {
  // The plan records the rules file as a fresh write; a target that
  // appears on disk afterwards is a difference the plan output never
  // showed, so --yes — which covers only the diffs the plan displayed —
  // cannot authorize the overwrite.
  const dir = tmpdir();
  const { plan, planPath } = await runPlan(
    dir,
    { "bug-fix": "swe-2-high" },
    "  swe-2-high\n  swe-2-xhigh\n",
  );
  mkdirSync(join(dir, "rules"), { recursive: true });
  writeFileSync(plan.targets.rules, "user content\n");
  await assert.rejects(
    M.main(["apply", "--plan", planPath, "--yes"], ioFor(dir).io),
    /stale.*re-run plan/i,
  );
  assert.equal(readFileSync(plan.targets.rules, "utf8"), "user content\n");
});

test("apply refuses when a recorded diff's content drifts after planning", async () => {
  // The file already differed at plan time (a `diff` the user saw); a
  // second edit keeps the same classification, so only the recorded
  // diskSha can catch the drift.
  const dir = tmpdir();
  mkdirSync(join(dir, "rules"), { recursive: true });
  const rulesPath = join(dir, "rules", "pstack-models.md");
  writeFileSync(rulesPath, "version A\n");
  const { planPath } = await runPlan(
    dir,
    { "bug-fix": "swe-2-high" },
    "  swe-2-high\n  swe-2-xhigh\n",
  );
  writeFileSync(rulesPath, "version B\n");
  await assert.rejects(
    M.main(["apply", "--plan", planPath, "--yes"], ioFor(dir).io),
    /stale/i,
  );
  assert.equal(readFileSync(rulesPath, "utf8"), "version B\n");
});

test("apply refuses to overwrite a diff without --yes", async () => {
  const dir = tmpdir();
  mkdirSync(join(dir, "rules"), { recursive: true });
  const rulesPath = join(dir, "rules", "pstack-models.md");
  writeFileSync(rulesPath, "user content\n");
  const { planPath } = await runPlan(
    dir,
    { "bug-fix": "swe-2-high" },
    "  swe-2-high\n  swe-2-xhigh\n",
  );
  await assert.rejects(
    M.main(["apply", "--plan", planPath], ioFor(dir).io),
    /refusing to apply.*--yes/s,
  );
  assert.equal(readFileSync(rulesPath, "utf8"), "user content\n");
});

test("apply keeps remove candidates without --remove", async () => {
  const dir = tmpdir();
  mkdirSync(join(dir, "agents"), { recursive: true });
  const staleProfile = join(dir, "agents", "pstack-old.md");
  writeFileSync(staleProfile, "obsolete profile\n");
  const { planPath } = await runPlan(
    dir,
    { "bug-fix": "swe-2-high" },
    "  swe-2-high\n  swe-2-xhigh\n",
  );
  const cap = ioFor(dir);
  await M.main(["apply", "--plan", planPath], cap.io);
  assert.equal(readFileSync(staleProfile, "utf8"), "obsolete profile\n");
  assert.match(cap.text(), /kept .*pstack-old\.md.*--remove/s);
});

test("apply --remove deletes the recorded remove candidates", async () => {
  const dir = tmpdir();
  mkdirSync(join(dir, "agents"), { recursive: true });
  const staleProfile = join(dir, "agents", "pstack-old.md");
  writeFileSync(staleProfile, "obsolete profile\n");
  const { planPath } = await runPlan(
    dir,
    { "bug-fix": "swe-2-high" },
    "  swe-2-high\n  swe-2-xhigh\n",
  );
  const cap = ioFor(dir);
  await M.main(["apply", "--plan", planPath, "--remove"], cap.io);
  assert.equal(existsSync(staleProfile), false);
  assert.match(cap.text(), /removed .*pstack-old\.md/s);
});

test("apply writes every plan file when disk matches the plan", async () => {
  // Happy path: all targets were absent at plan time (`write`), still
  // absent at apply — the stale guard must not false-positive.
  const dir = tmpdir();
  const { plan, planPath } = await runPlan(
    dir,
    { "bug-fix": "swe-2-high" },
    "  swe-2-high\n  swe-2-xhigh\n",
  );
  await M.main(["apply", "--plan", planPath], ioFor(dir).io);
  for (const [target, content] of Object.entries(plan.files)) {
    assert.equal(readFileSync(target, "utf8"), content, `wrong content: ${target}`);
  }
});
