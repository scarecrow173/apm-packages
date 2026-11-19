/**
 * Deterministic post-run assertions for a doc-driven-dev evaluation
 * environment. Runs against the materialized repo AFTER a candidate pass
 * and emits a JSON verdict the orchestrator records.
 *
 * Usage: tsx eval/checks/check_env.ts <env> <envDir> <snapshotFile>
 *
 * Each check is { id, pass, detail }. `pass: null` means informational —
 * the value is evidence for the judge, not a gate.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import matter from "gray-matter";

type Check = { id: string; pass: boolean | null; detail: string };

const DURABLE_DIRS: Record<string, string> = {
  "docs/ideas": "idea",
  "docs/discovery": "discovery",
  "docs/specs": "spec",
  "docs/designs": "design",
  "docs/adr": "adr",
  "docs/knowledge": "knowledge",
  "docs/verification": "verification",
};
const LEGACY_PREFIXES = ["docs/plans", "docs/tasks", "docs/test-specs", "docs/impl"];
const STATE_ROOT = ".apm/state/doc-driven-dev";

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(abs);
    else if (entry.isFile()) yield abs;
  }
}

function sha(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function diffSnapshot(repo: string, snapshot: Record<string, string>): { added: string[]; removed: string[]; changed: string[] } {
  const added: string[] = [];
  const changed: string[] = [];
  for (const abs of walk(repo)) {
    const rel = path.relative(repo, abs).split(path.sep).join("/");
    if (!(rel in snapshot)) added.push(rel);
    else if (sha(abs) !== snapshot[rel]) changed.push(rel);
  }
  const present = new Set([...walk(repo)].map((abs) => path.relative(repo, abs).split(path.sep).join("/")));
  const removed = Object.keys(snapshot).filter((rel) => !present.has(rel));
  return { added, removed, changed };
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function runDirs(repo: string): string[] {
  const runsDir = path.join(repo, STATE_ROOT, "runs");
  return fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((d) => fs.statSync(path.join(runsDir, d)).isDirectory()) : [];
}

function storeRecordCounts(repo: string, runId: string): { tasks: number; receipts: number; checkpoints: number } {
  const runDir = path.join(repo, STATE_ROOT, "runs", runId);
  const count = (sub: string) => (fs.existsSync(path.join(runDir, sub)) ? fs.readdirSync(path.join(runDir, sub)).filter((f) => f.endsWith(".json")).length : 0);
  return { tasks: count("tasks"), receipts: count("receipts"), checkpoints: count("checkpoints") };
}

function taskRecords(repo: string, runId: string): Array<Record<string, unknown>> {
  const dir = path.join(repo, STATE_ROOT, "runs", runId, "tasks");
  return [...walk(dir)].map((f) => readJson(f)).filter((r): r is Record<string, unknown> => r !== null);
}

function evidenceRecords(repo: string): Array<{ file: string; record: Record<string, unknown> }> {
  const dir = path.join(repo, STATE_ROOT, "evidence", "records");
  return [...walk(dir)]
    .map((f) => ({ file: f, record: readJson(f) }))
    .filter((e): e is { file: string; record: Record<string, unknown> } => e.record !== null);
}

function durableDocs(repo: string): Array<{ rel: string; data: Record<string, unknown> }> {
  const out: Array<{ rel: string; data: Record<string, unknown> }> = [];
  for (const dir of Object.keys(DURABLE_DIRS)) {
    for (const abs of walk(path.join(repo, dir))) {
      if (path.basename(abs) === "README.md" || !abs.endsWith(".md")) continue;
      const rel = path.relative(repo, abs).split(path.sep).join("/");
      out.push({ rel, data: matter(fs.readFileSync(abs, "utf8")).data });
    }
  }
  return out;
}

function gitStatus(repo: string): string[] {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
  return r.status === 0 ? r.stdout.split("\n").filter(Boolean) : [];
}

const ENV_CHECKS: Record<string, (repo: string, diff: ReturnType<typeof diffSnapshot>) => Check[]> = {
  river(repo, diff) {
    const durable = durableDocs(repo);
    const valid = durable.filter((d) => {
      const dir = path.posix.dirname(d.rel);
      const expected = DURABLE_DIRS[dir];
      return expected && d.data.type === expected && typeof d.data.id === "string" && typeof d.data.status === "string";
    });
    const legacyCreated = diff.added.filter((rel) => LEGACY_PREFIXES.some((p) => rel.startsWith(`${p}/`) && rel.endsWith(".md") && !rel.endsWith("/README.md")));
    const runs = runDirs(repo);
    const records = runs.map((r) => ({ r, ...storeRecordCounts(repo, r) }));
    return [
      { id: "durable-docs", pass: valid.length > 0, detail: `${valid.length} valid durable docs: ${valid.map((d) => d.rel).join(", ") || "none"}` },
      { id: "frontmatter-shape", pass: durable.every((d) => valid.includes(d)), detail: durable.length === valid.length ? "all durable docs carry registry-3 shape" : `invalid: ${durable.filter((d) => !valid.includes(d)).map((d) => d.rel).join(", ")}` },
      { id: "no-legacy-exec-docs", pass: legacyCreated.length === 0, detail: legacyCreated.length ? `created: ${legacyCreated.join(", ")}` : "none created" },
      { id: "runs-created", pass: null, detail: `${runs.length} runs; records: ${JSON.stringify(records)}` },
      { id: "git-state", pass: null, detail: `${gitStatus(repo).length} dirty entries` },
    ];
  },

  harbor(repo, diff) {
    const runs = runDirs(repo);
    const bound = "RUN-ledger-01";
    const tasks = taskRecords(repo, bound);
    const csv = tasks.find((t) => t.taskId === "TASK-0002");
    const counts = runs.includes(bound) ? storeRecordCounts(repo, bound) : { tasks: 0, receipts: 0, checkpoints: 0 };
    const newRecords = Math.max(0, counts.checkpoints - 1) + counts.receipts;
    const legacyCreated = diff.added.filter((rel) => LEGACY_PREFIXES.some((p) => rel.startsWith(`${p}/`) && rel.endsWith(".md") && !rel.endsWith("/README.md")));
    return [
      { id: "task-progress", pass: csv !== undefined && csv.status !== "todo", detail: `TASK-0002 status: ${csv ? JSON.stringify(csv.status) : "record missing"}` },
      { id: "store-records", pass: newRecords > 0, detail: `receipts=${counts.receipts} checkpoints=${counts.checkpoints} (seeded 1)` },
      { id: "no-new-runs", pass: runs.length === 1, detail: `runs: ${runs.join(", ") || "none"}` },
      { id: "no-legacy-exec-docs", pass: legacyCreated.length === 0, detail: legacyCreated.length ? `created: ${legacyCreated.join(", ")}` : "none" },
      { id: "git-state", pass: null, detail: `${gitStatus(repo).length} dirty entries` },
    ];
  },

  quarry(repo, diff) {
    const legacyChanged = diff.changed.filter((rel) => LEGACY_PREFIXES.some((p) => rel.startsWith(`${p}/`)));
    const v3DurableCreated = diff.added.filter((rel) => Object.keys(DURABLE_DIRS).some((p) => rel.startsWith(`${p}/`) && !rel.endsWith("/README.md")));
    const runs = runDirs(repo);
    const manifestStamped = fs.existsSync(path.join(repo, "docs/.doc-driven-dev/schema.json"));
    const journal = fs.existsSync(path.join(repo, "docs/.doc-driven-dev/migration.journal.json"));
    return [
      { id: "legacy-untouched", pass: legacyChanged.length === 0, detail: legacyChanged.length ? `modified: ${legacyChanged.join(", ")}` : "v2 corpus unmodified" },
      { id: "no-v3-durable", pass: v3DurableCreated.length === 0, detail: v3DurableCreated.length ? `created: ${v3DurableCreated.join(", ")}` : "none" },
      { id: "no-runs-created", pass: runs.length === 0, detail: `runs: ${runs.join(", ") || "none"}` },
      { id: "no-migration-apply", pass: !manifestStamped, detail: manifestStamped ? "schema.json stamped — apply ran" : "no apply" },
      { id: "migration-state", pass: null, detail: `journal=${journal}` },
      { id: "git-state", pass: null, detail: `${gitStatus(repo).length} dirty entries` },
    ];
  },

  atlas(repo, diff) {
    const evidence = evidenceRecords(repo);
    const validEvidence = evidence.filter((e) => typeof e.record.schemaVersion === "number" && typeof e.record.evidenceId === "string" && e.record.subject !== undefined);
    const verifiedInFrontmatter = durableDocs(repo).filter((d) => d.data.status === "verified" || d.data.lifecycle === "verified");
    const bound = "RUN-markwright-01";
    const counts = runDirs(repo).includes(bound) ? storeRecordCounts(repo, bound) : { tasks: 0, receipts: 0, checkpoints: 0 };
    const newRecords = Math.max(0, counts.checkpoints - 2) + counts.receipts;
    const legacyCreated = diff.added.filter((rel) => LEGACY_PREFIXES.some((p) => rel.startsWith(`${p}/`) && rel.endsWith(".md") && !rel.endsWith("/README.md")));
    return [
      { id: "evidence-records", pass: evidence.length === 0 || validEvidence.length === evidence.length, detail: `${evidence.length} records, ${validEvidence.length} schema-valid` },
      { id: "no-frontmatter-verified", pass: verifiedInFrontmatter.length === 0, detail: verifiedInFrontmatter.length ? `marked: ${verifiedInFrontmatter.map((d) => d.rel).join(", ")}` : "none" },
      { id: "store-records", pass: newRecords > 0, detail: `receipts=${counts.receipts} checkpoints=${counts.checkpoints} (seeded 2)` },
      { id: "no-legacy-exec-docs", pass: legacyCreated.length === 0, detail: legacyCreated.length ? `created: ${legacyCreated.join(", ")}` : "none" },
      { id: "git-state", pass: null, detail: `${gitStatus(repo).length} dirty entries` },
    ];
  },
};

function main(): void {
  const [env, envDirArg, snapshotArg] = process.argv.slice(2);
  const checks = ENV_CHECKS[env];
  const repo = envDirArg ? path.resolve(envDirArg) : "";
  if (!checks || !repo || !fs.existsSync(repo) || !snapshotArg) {
    console.error("usage: check_env.ts <river|harbor|quarry|atlas> <envDir> <snapshotFile>");
    process.exit(2);
  }
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(snapshotArg), "utf8")) as Record<string, string>;
  const diff = diffSnapshot(repo, snapshot);
  const results = checks(repo, diff);
  console.log(JSON.stringify({ env, repo: path.basename(repo), diff: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length }, checks: results }, null, 2));
}

main();
