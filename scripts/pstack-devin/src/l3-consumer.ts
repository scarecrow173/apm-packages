import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ToolMissingError } from "./l3-dist.js";

/** Manual L3 consumer probe — intentionally NOT wired into `verify:l3` or
 *  `verify`. It spawns the real `apm` binary, writes files into a scratch
 *  consumer, and (for the `--ref` git form) reaches the network. Run it
 *  deliberately:
 *
 *    mise exec -- pnpm --dir scripts/pstack-devin run probe:consumer
 *    tsx src/l3-consumer.ts --ref <40-hex sha>   # git source form
 *
 *  Evidence from each run is appended to
 *  `packages/pstack-devin/docs/l3-verification.md`.
 *
 *  The scratch directory lives outside the repository, so `mise exec`
 *  cannot resolve repo tools there — the pinned apm binary is resolved
 *  once via `mise which apm` from the repo root and invoked directly
 *  (the same pattern docs/verification-apm-0.33.0.md records).
 *
 *  Known caveat: on Windows the vendored `apm_modules/_local/<name>/`
 *  path plus deep `devin-plugin/` skill paths can exceed MAX_PATH on
 *  consumers without long-path support — recorded in `#212`. */

const REPO_GIT_URL = "https://github.com/scarecrow173/apm-packages.git";
const INSTALL_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_LINES = 40;

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const PKG_REL = "packages/pstack-devin";
const EVIDENCE_REL = "packages/pstack-devin/docs/l3-verification.md";

export interface ConsumerResult {
  scratch: string;
  source: "path" | "git";
  exitCode: number | null;
  /** Files the install deployed outside `apm_modules/` and the
   *  consumer's own bookkeeping (apm.yml / apm.lock.yaml / .gitignore). */
  deployed: string[];
  /** File count vendored under `apm_modules/`. */
  vendored: number;
  /** Whether the install wrote a lockfile. */
  lockfile: boolean;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Resolve the mise-pinned apm executable. The probe runs outside the
 *  repo, where `mise exec` has no mise.toml to resolve — `mise which`
 *  from the repo root yields a binary usable anywhere. */
export function resolveApm(root: string): string {
  const r = spawnSync("mise", ["which", "apm"], {
    cwd: root,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (r.error) {
    if ((r.error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new ToolMissingError(
        "`mise` not found on PATH — the consumer probe needs the " +
          "repo-pinned apm; run `mise install`",
      );
    }
    throw r.error;
  }
  if (r.status !== 0) {
    throw new ToolMissingError(
      "`mise which apm` failed — run `mise install` so the pinned apm " +
        `resolves:\n${`${r.stdout ?? ""}${r.stderr ?? ""}`.trim()}`,
    );
  }
  const exe = (r.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== "" && fs.existsSync(l));
  if (exe === undefined) {
    throw new ToolMissingError(
      `could not resolve an apm binary from \`mise which apm\`:\n` +
        (r.stdout ?? "").trim(),
    );
  }
  return exe;
}

/** Scratch consumer manifest. Default is a `path:` dependency on the
 *  working tree — offline, exercising what `apm install` deploys for a
 *  local consumer. `--ref` switches to the `git:`+`ref:` form — a real
 *  remote install (network) against the published repository. */
export function consumerManifest(
  pkgRoot: string,
  opts: { ref?: string } = {},
): string {
  const dep =
    opts.ref === undefined
      ? [`    - path: ${pkgRoot.replace(/\\/g, "/")}`]
      : [
          `    - git: ${REPO_GIT_URL}`,
          "      path: packages/pstack-devin",
          `      ref: ${opts.ref}`,
        ];
  return [
    "name: pstack-consumer-probe",
    "version: 0.0.0",
    "description: L3 consumer install probe for pstack-devin (issue `#216`)",
    "license: MIT",
    "targets: [codex]",
    "dependencies:",
    "  apm:",
    ...dep,
    "",
  ].join("\n");
}

/** Recursive rel-path list (forward slashes, sorted). */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    for (const de of fs
      .readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const r = rel === "" ? de.name : `${rel}/${de.name}`;
      if (de.isDirectory()) walk(path.join(abs, de.name), r);
      else if (de.isFile()) out.push(r);
    }
  };
  walk(dir, "");
  return out;
}

const CONSUMER_OWN_FILES = new Set(["apm.yml", "apm.lock.yaml", ".gitignore"]);

/** Run the install probe: scratch dir → manifest → `apm install` →
 *  classify what landed. Throws (loudly) on an unresolvable apm binary;
 *  a non-zero install is reported, not raised. */
export function probeConsumer(
  apmExe: string,
  pkgRoot: string,
  opts: { ref?: string; scratch?: string } = {},
): ConsumerResult & { output: string } {
  const scratch = opts.scratch ?? fs.mkdtempSync(path.join(os.tmpdir(), "pstack-consumer-"));
  fs.writeFileSync(path.join(scratch, "apm.yml"), consumerManifest(pkgRoot, opts));
  const r = spawnSync(apmExe, ["install"], {
    cwd: scratch,
    encoding: "utf8",
    timeout: INSTALL_TIMEOUT_MS,
  });
  if (r.error) throw r.error;
  const files = listFiles(scratch);
  const deployed = files.filter(
    (f) => !f.startsWith("apm_modules/") && !CONSUMER_OWN_FILES.has(f),
  );
  return {
    scratch,
    source: opts.ref === undefined ? "path" : "git",
    exitCode: r.status,
    output: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    deployed,
    vendored: files.filter((f) => f.startsWith("apm_modules/")).length,
    lockfile: fs.existsSync(path.join(scratch, "apm.lock.yaml")),
  };
}

/** Evidence section appended to docs/l3-verification.md — dated, with the
 *  verbatim command tail so a maintainer can diff behavior across runs. */
export function evidenceSection(
  r: ConsumerResult & { output: string },
  apmExe: string,
): string {
  const tail = r.output
    .trim()
    .split(/\r?\n/)
    .slice(-MAX_OUTPUT_LINES)
    .join("\n");
  // Local date — the doc's own sections record local dates.
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [
    `## Consumer probe — ${date} (${r.source} source)`,
    "",
    `- platform: ${process.platform}`,
    `- apm: \`${apmExe}\` (resolved via \`mise which apm\`)`,
    r.source === "path"
      ? "- source: `path:` dependency on the working tree (offline)"
      : `- source: \`git:\` ${REPO_GIT_URL} (network)`,
    `- command: \`apm install\` in scratch \`${r.scratch}\``,
    `- exit: ${r.exitCode}`,
    `- lockfile written: ${r.lockfile ? "yes" : "no"}`,
    `- vendored under \`apm_modules/\`: ${r.vendored} files`,
    "- deployed primitives (outside `apm_modules/`):",
    "",
    "```text",
    ...(r.deployed.length > 0 ? r.deployed : ["(none)"]),
    "```",
    "",
    "Output (verbatim tail):",
    "",
    "```text",
    tail === "" ? "(no output)" : tail,
    "```",
    "",
  ].join("\n");
}

export function runConsumer(argv: string[]): void {
  let ref: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ref" && i + 1 < argv.length) {
      ref = argv[++i];
    } else if (a.startsWith("--ref=")) {
      ref = a.slice("--ref=".length);
    } else {
      throw new Error(`unknown argument: ${a} (usage: [--ref <sha>])`);
    }
  }
  const pkgRoot = path.join(repoRoot, PKG_REL);
  if (!fs.existsSync(pkgRoot)) {
    throw new Error(`${PKG_REL} does not exist`);
  }
  const apmExe = resolveApm(repoRoot);
  const r = probeConsumer(apmExe, pkgRoot, { ref });

  const evidence = path.join(repoRoot, EVIDENCE_REL);
  fs.appendFileSync(evidence, `\n${evidenceSection(r, apmExe)}`);

  console.log(
    `consumer probe: source=${r.source}, exit=${r.exitCode}, ` +
      `${r.deployed.length} deployed, ${r.vendored} vendored`,
  );
  for (const f of r.deployed) console.log(`  ${f}`);
  console.log(`  scratch: ${r.scratch}`);
  console.log(`  evidence appended: ${EVIDENCE_REL}`);
  if (r.exitCode !== 0) {
    console.log(r.output.trim());
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runConsumer(process.argv.slice(2));
  } catch (e: unknown) {
    console.error(errMsg(e));
    process.exit(1);
  }
}
