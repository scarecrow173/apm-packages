#!/usr/bin/env node
// run-drive.mjs — the verify-pstack-devin drive harness. Runs ONE
// package.json script of the app under test and captures self-contained
// evidence: command, cwd, timestamp, exit code, stdout, stderr, elapsed
// time, and `git status --porcelain` on the package before/after.
//
// Usage (from the repository root):
//
//   mise exec -- node .devin/skills/verify-pstack-devin/scripts/run-drive.mjs \
//     <evidence-dir> <script> [args...]
//
// Examples:
//   ... run-drive.mjs scripts/pstack-devin/fixtures/evidence/run-1 check:safety
//   ... run-drive.mjs scripts/pstack-devin/fixtures/evidence/run-1 verify:l2
//   ... run-drive.mjs scripts/pstack-devin/fixtures/evidence/run-1 apply:update <40-hex-sha>
//
// What runs is the exact maintainer command `mise exec -- pnpm --dir
// scripts/pstack-devin run <script> [args...]` — the helper only records.
// The drive's exit code is re-emitted as this process's exit code, so a
// failing drive fails the wrapper honestly (including check:upstream's
// exit-42 "update available" verdict).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// scripts/ → verify-pstack-devin/ → skills/ → .devin/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const STATUS_SPEC = "packages/pstack-devin/";
// apply:update runs a full build+verify pipeline (5-9 min per its
// docs); check-generated refetches ~546 upstream blobs. 30 min covers
// both with headroom.
const DRIVE_TIMEOUT_MS = 30 * 60 * 1000;

const usage =
  "usage: run-drive.mjs <evidence-dir> <script> [args...]\n" +
  "  <script>   a scripts/pstack-devin package.json script name\n" +
  "  [args...]  verbatim extra args (e.g. a 40-hex sha for apply:update)";

const [evidenceDir, script, ...driveArgs] = process.argv.slice(2);
if (evidenceDir === undefined || script === undefined) {
  console.error(usage);
  process.exit(2);
}
// Script names and args are interpolated into a shell command string —
// allow only a shell-safe charset so quoting is a non-issue. Covers
// `check:safety`, `--ref`, 40-hex shas, `KEY=value`.
const SAFE = /^[A-Za-z0-9._~:/=@+-]+$/;
for (const token of [script, ...driveArgs]) {
  if (!SAFE.test(token)) {
    console.error(`unsafe token rejected: ${JSON.stringify(token)}\n${usage}`);
    process.exit(2);
  }
}

const gitStatus = () => {
  const r = spawnSync(
    "git",
    ["-C", repoRoot, "status", "--porcelain", "--", STATUS_SPEC],
    { encoding: "utf8" },
  );
  if (r.error || r.status !== 0) {
    return `(unavailable: ${r.error?.message ?? (r.stderr ?? "").trim()})`;
  }
  return r.stdout.trim() === "" ? "(clean)" : r.stdout.trim();
};

// Full command string through the platform shell: on win32, mise's
// npm-backend pnpm is a .cmd shim that execFile cannot spawn (same
// boundary apply-update.ts's spawnRunner documents). All tokens are
// charset-validated above, so string interpolation is safe.
const command =
  `mise exec -- pnpm --dir scripts/pstack-devin run ${script}` +
  (driveArgs.length > 0 ? ` ${driveArgs.join(" ")}` : "");

const evDir = path.isAbsolute(evidenceDir)
  ? evidenceDir
  : path.join(repoRoot, evidenceDir);
fs.mkdirSync(evDir, { recursive: true });

const before = gitStatus();
const started = Date.now();
const res = spawnSync(command, {
  cwd: repoRoot,
  encoding: "utf8",
  shell: true,
  timeout: DRIVE_TIMEOUT_MS,
  maxBuffer: 64 * 1024 * 1024,
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const after = gitStatus();

const timedOut = res.error?.code === "ETIMEDOUT" || res.signal === "SIGTERM";
const exitCode = res.status === null ? (timedOut ? "timeout" : "spawn-error") : res.status;

const logName =
  [script, ...driveArgs].join("__").replace(/[^A-Za-z0-9._~+-]+/g, "-") + ".log";
const logPath = path.join(evDir, logName);
const logLines = [
  "# run-drive evidence",
  `command: ${command}`,
  `cwd: ${repoRoot}`,
  `date: ${new Date(started).toISOString()}`,
  `evidence-dir: ${evDir}`,
  "",
  `git-status-before -- ${STATUS_SPEC}`,
  before,
  "",
  "--- stdout ---",
  (res.stdout ?? "").trimEnd(),
  "",
  "--- stderr ---",
  (res.stderr ?? "").trimEnd(),
  "",
  `exit: ${exitCode}`,
  `elapsed: ${elapsed}s`,
];
if (timedOut) {
  logLines.push(`timeout: killed after ${DRIVE_TIMEOUT_MS / 60000}min`);
}
if (res.error !== undefined && !timedOut) {
  logLines.push(`spawn-error: ${res.error.message}`);
}
logLines.push("", `git-status-after -- ${STATUS_SPEC}`, after, "");
fs.writeFileSync(logPath, logLines.join("\n"), "utf8");

console.log(`run-drive: ${command}`);
console.log(`run-drive: exit ${exitCode} in ${elapsed}s — ${logPath}`);
if (res.stdout?.trim()) {
  // Surface the tool's own summary line(s) — last non-empty stdout lines —
  // so the verdict is visible without opening the log.
  const tail = res.stdout.trim().split(/\r?\n/).slice(-3);
  for (const l of tail) console.log(`  stdout| ${l}`);
}

process.exit(typeof exitCode === "number" ? exitCode : 1);
