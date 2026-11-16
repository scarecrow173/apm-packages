import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertSafeRelPath } from "./config.js";
import { ALLOWLIST } from "./safety-scan-allowlist.js";
import type { AllowlistEntry } from "./safety-scan-allowlist.js";

export { ALLOWLIST } from "./safety-scan-allowlist.js";
export type { AllowlistEntry } from "./safety-scan-allowlist.js";

export interface SecretFinding {
  file: string;
  line: number;
  /** SECRET_PATTERNS label naming the rule that fired. */
  label: string;
  /** Redacted token preview — locates the match without leaking it. */
  match: string;
}

export interface OversizedFinding {
  file: string;
  size: number;
}

export interface ExecFinding {
  file: string;
  issue: string;
}

export interface PluginJsonFinding {
  file: string;
  issue: string;
}

export interface SafetyResult {
  secrets: SecretFinding[];
  oversized: OversizedFinding[];
  execMismatch: ExecFinding[];
  pluginJson: PluginJsonFinding[];
}

export interface ScanOptions {
  /** Files larger than this are flagged. Default 5 MiB. */
  maxBytes?: number;
  /** Suppression entries; defaults to the shipped ALLOWLIST. */
  allowlist?: AllowlistEntry[];
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const SEMVER_RE =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Secret shapes that must never reach the shipped tree. Prefix rules
 *  (`gho_`, `github_pat_`, `xox*-`, `-----BEGIN`) fire on the prefix alone —
 *  a truncated or example-shaped token is still worth a loud look, and the
 *  allowlist is the explicit escape hatch. Identifier-anchored rules carry
 *  a `(?<![A-Za-z0-9_-])` boundary so `sk-…` inside words like `desk-…`
 *  does not fire. */
export const SECRET_PATTERNS: ReadonlyArray<{
  label: string;
  pattern: RegExp;
}> = [
  { label: "github-pat", pattern: /(?<![A-Za-z0-9_-])ghp_[A-Za-z0-9]{36}/g },
  { label: "github-oauth", pattern: /(?<![A-Za-z0-9_-])gho_/g },
  { label: "github-fine-grained-pat", pattern: /(?<![A-Za-z0-9_-])github_pat_/g },
  { label: "openai-key", pattern: /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9]{20,}/g },
  { label: "aws-access-key", pattern: /(?<![A-Za-z0-9_-])AKIA[0-9A-Z]{16}/g },
  { label: "private-key", pattern: /BEGIN [A-Z ]*PRIVATE KEY/g },
  { label: "slack-token", pattern: /(?<![A-Za-z0-9_-])xox[baprs]-/g },
  { label: "google-api-key", pattern: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/g },
  { label: "pem-begin", pattern: /-----BEGIN/g },
  {
    label: "jwt",
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g,
  },
];

/** Magic bytes of formats an exec bit can actually launch. Everything else
 *  a provenance executable names must start with `#!`. */
const EXEC_MAGICS: ReadonlyArray<Buffer> = [
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF
  Buffer.from([0x4d, 0x5a]),             // MZ (PE)
  Buffer.from([0xfe, 0xed, 0xfa, 0xce]), // Mach-O 32
  Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), // Mach-O 64
  Buffer.from([0xce, 0xfa, 0xed, 0xfe]), // Mach-O 32 reverse
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), // Mach-O 64 reverse
  Buffer.from([0xca, 0xfe, 0xba, 0xbe]), // Mach-O fat / Java class
];

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const PLUGIN_REL = "packages/pstack-devin/devin-plugin";
const MANIFEST_REL = ".devin-plugin/plugin.json";
const MAX_LISTED = 20;

/** Recursive rel-path list (forward slashes, sorted). Re-asserts the
 *  generated tree holds only regular files — inventory already rejects
 *  symlinks/submodules at build time, so anything else here is drift. */
function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string): void => {
    const dirents = fs
      .readdirSync(abs, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const de of dirents) {
      const r = rel === "" ? de.name : `${rel}/${de.name}`;
      if (de.isDirectory()) {
        walk(path.join(abs, de.name), r);
      } else if (de.isFile()) {
        out.push(r);
      } else {
        throw new Error(`generated tree entry is not a regular file: ${r}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

/** Show enough of a token to locate it without echoing the secret. */
function redact(token: string): string {
  return `${token.slice(0, 6)}…`;
}

function headBytes(p: string, n: number): Buffer {
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.alloc(n);
    const read = fs.readSync(fd, buf, 0, n, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/** True when the file begins with `#!` or a recognized executable magic. */
function canExecute(p: string): boolean {
  const head = headBytes(p, 4);
  if (head.length >= 2 && head[0] === 0x23 && head[1] === 0x21) return true;
  return EXEC_MAGICS.some((m) => head.subarray(0, m.length).equals(m));
}

function scanSecrets(
  root: string,
  files: string[],
  allow: Set<string>,
): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const rel of files) {
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const { label, pattern } of SECRET_PATTERNS) {
        for (const m of lines[i].matchAll(pattern)) {
          if (allow.has(`${label}${rel}`)) continue;
          out.push({ file: rel, line: i + 1, label, match: redact(m[0]) });
        }
      }
    }
  }
  return out;
}

/** `provenance.json executables` is the authority for exec bits (the git
 *  index modes it records are checked separately by check-generated). This
 *  verifies the tree side: every listed entry must exist as a regular file
 *  and be a shape an exec bit can launch — shebang script or binary magic.
 *  Shebang files NOT listed are fine: upstream ships 644 scripts that run
 *  through an interpreter. */
function scanExecutables(root: string): ExecFinding[] {
  const out: ExecFinding[] = [];
  const provRel = "provenance.json";
  const provPath = path.join(root, provRel);
  if (!fs.existsSync(provPath)) {
    return [{ file: provRel, issue: "missing — cannot verify executables" }];
  }
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(provPath, "utf8"));
  } catch (e) {
    return [{
      file: provRel,
      issue: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    }];
  }
  const executables = (doc as { executables?: unknown }).executables;
  if (
    !Array.isArray(executables) ||
    executables.some((x) => typeof x !== "string")
  ) {
    return [{ file: provRel, issue: "executables must be a string array" }];
  }
  for (const rel of executables as string[]) {
    try {
      assertSafeRelPath(rel, "provenance.executables entry");
    } catch (e) {
      out.push({
        file: rel,
        issue: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      out.push({
        file: rel,
        issue: "listed in provenance.executables but missing on disk",
      });
      continue;
    }
    if (!canExecute(abs)) {
      out.push({
        file: rel,
        issue: "no shebang or executable signature — exec bit cannot take effect",
      });
    }
  }
  return out;
}

/** The generated Devin manifest is the one file whose contents this package
 *  owns outright — pin its distribution contract: local-only `pstack`. */
function scanPluginJson(root: string): PluginJsonFinding[] {
  const out: PluginJsonFinding[] = [];
  const abs = path.join(root, MANIFEST_REL);
  if (!fs.existsSync(abs)) {
    return [{ file: MANIFEST_REL, issue: "missing" }];
  }
  let doc: unknown;
  try {
    doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    return [{
      file: MANIFEST_REL,
      issue: `invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    }];
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return [{ file: MANIFEST_REL, issue: "must be a JSON object" }];
  }
  const m = doc as Record<string, unknown>;
  if (m.name !== "pstack") {
    out.push({
      file: MANIFEST_REL,
      issue: `name must be "pstack", got ${JSON.stringify(m.name)}`,
    });
  }
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
    out.push({
      file: MANIFEST_REL,
      issue: `version must be semver, got ${JSON.stringify(m.version)}`,
    });
  }
  if (
    !Array.isArray(m.platforms) ||
    m.platforms.length !== 1 ||
    m.platforms[0] !== "local"
  ) {
    out.push({
      file: MANIFEST_REL,
      issue: `platforms must be ["local"], got ${JSON.stringify(m.platforms)}`,
    });
  }
  return out;
}

/** Scan a built devin-plugin tree for distribution-safety violations:
 *  secret-shaped tokens (allowlistable per file+label), files over the byte
 *  cap, provenance executables that do not exist or could not run, and
 *  `.devin-plugin/plugin.json` drift from the local-only `pstack`
 *  contract. Empty buckets = clean; the CLI exits 1 on any finding. */
export function scanSafety(root: string, opts: ScanOptions = {}): SafetyResult {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowlist = opts.allowlist ?? ALLOWLIST;
  const allow = new Set(
    allowlist
      .filter((e) => e.justification.trim() !== "")
      .map((e) => `${e.label}${e.path}`),
  );
  const files = listFiles(root);

  const oversized: OversizedFinding[] = [];
  for (const rel of files) {
    const size = fs.statSync(path.join(root, rel)).size;
    if (size > maxBytes) oversized.push({ file: rel, size });
  }

  return {
    secrets: scanSecrets(root, files, allow),
    oversized,
    execMismatch: scanExecutables(root),
    pluginJson: scanPluginJson(root),
  };
}

function report(kind: string, items: { file: string; text: string }[]): void {
  if (items.length === 0) return;
  console.log(`${kind}: ${items.length} findings`);
  for (const f of items.slice(0, MAX_LISTED)) {
    console.log(`  ${f.file}: ${f.text}`);
  }
  if (items.length > MAX_LISTED) {
    console.log(`  ... and ${items.length - MAX_LISTED} more`);
  }
}

function main(): void {
  let maxBytes = DEFAULT_MAX_BYTES;
  for (const a of process.argv.slice(2)) {
    const m = /^--max-bytes=(\d+)$/.exec(a);
    if (m === null) {
      throw new Error(`unknown argument: ${a} (usage: --max-bytes=N)`);
    }
    maxBytes = Number(m[1]);
  }
  const dir = path.join(repoRoot, PLUGIN_REL);
  if (!fs.existsSync(dir)) {
    throw new Error(
      `${PLUGIN_REL} does not exist — run ` +
        "`pnpm --dir scripts/pstack-devin run build`",
    );
  }
  const r = scanSafety(dir, { maxBytes });
  const fileCount = listFiles(dir).length;

  report(
    "secrets",
    r.secrets.map((f) => ({
      file: `${f.file}:${f.line}`,
      text: `${f.label} (${f.match})`,
    })),
  );
  report(
    "oversized",
    r.oversized.map((f) => ({ file: f.file, text: `${f.size} > ${maxBytes}` })),
  );
  report(
    "execMismatch",
    r.execMismatch.map((f) => ({ file: f.file, text: f.issue })),
  );
  report(
    "pluginJson",
    r.pluginJson.map((f) => ({ file: f.file, text: f.issue })),
  );

  const total =
    r.secrets.length +
    r.oversized.length +
    r.execMismatch.length +
    r.pluginJson.length;
  console.log(
    `safety scan: ${fileCount} files scanned, ${total} findings ` +
      `(${r.secrets.length} secrets, ${r.oversized.length} oversized, ` +
      `${r.execMismatch.length} exec, ${r.pluginJson.length} manifest)`,
  );
  if (total > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
