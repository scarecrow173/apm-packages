import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { load } from "js-yaml";

/** Marketplace registration checks — pins the two `apm.yml` sites and
 *  the `apm install`-generated lockfile block for `pstack-devin` so
 *  registry drift (dropped dep entry, wrong marketplace subdir, stale
 *  lockfile, missing package dir) fails `verify:l3` loudly instead of
 *  surfacing as a broken consumer install. Asserts the registration
 *  contract only; package internals are the l1/l2/l3-dist checks' job.
 *  The lockfile is never hand-edited — a missing entry means re-run
 *  `mise exec -- apm install` at the repo root. */

export interface Finding {
  /** Path the finding names ("" when not file-bound). */
  file: string;
  issue: string;
}

export interface MarketplaceResult {
  /** `devDependencies.apm` carries ./packages/pstack-devin exactly once. */
  deps: Finding[];
  /** `marketplace.packages` carries the pstack-devin entry with the
   *  expected source/subdir/category. */
  marketplace: Finding[];
  /** `apm.lock.yaml` dependencies has the local_path entry for
   *  package pstack-devin. */
  lockfile: Finding[];
  /** `packages/pstack-devin` exists as a directory. */
  packageDir: Finding[];
}

const MANIFEST_REL = "apm.yml";
const LOCKFILE_REL = "apm.lock.yaml";
const PKG_NAME = "pstack-devin";
const PKG_SUBDIR = "packages/pstack-devin";
const DEP_ENTRY = `./${PKG_SUBDIR}`;
const MARKET_SOURCE = "scarecrow173/apm-packages";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** devDependencies.apm lists `./packages/pstack-devin` exactly once —
 *  the path form `apm install` resolves to the local package. */
export function checkDeps(manifest: unknown): Finding[] {
  const fail = (issue: string): Finding[] => [{ file: MANIFEST_REL, issue }];
  const doc = asRecord(manifest);
  if (doc === null) {
    return fail("apm.yml is not a YAML mapping");
  }
  const apmDeps = asRecord(doc.devDependencies)?.apm;
  if (!Array.isArray(apmDeps)) {
    return fail("devDependencies.apm is missing or not a list");
  }
  const count = apmDeps.filter((d) => d === DEP_ENTRY).length;
  if (count === 0) {
    return fail(
      `devDependencies.apm is missing the required entry "${DEP_ENTRY}"`,
    );
  }
  if (count > 1) {
    return fail(
      `devDependencies.apm entry "${DEP_ENTRY}" must appear exactly once, ` +
        `found ${count} times`,
    );
  }
  return [];
}

/** marketplace.packages carries the pstack-devin listing. `source` and
 *  `subdir` are pinned to this repo's values; `category` is asserted
 *  non-empty (re-categorizing is a marketplace decision, not drift). */
export function checkMarketplace(manifest: unknown): Finding[] {
  const fail = (issue: string): Finding[] => [{ file: MANIFEST_REL, issue }];
  const doc = asRecord(manifest);
  if (doc === null) {
    return fail("apm.yml is not a YAML mapping");
  }
  const packages = asRecord(doc.marketplace)?.packages;
  if (!Array.isArray(packages)) {
    return fail("marketplace.packages is missing or not a list");
  }
  const entries = packages.filter(
    (p) => asRecord(p)?.name === PKG_NAME,
  ) as Array<Record<string, unknown>>;
  if (entries.length === 0) {
    return fail(`marketplace.packages is missing an entry for ${PKG_NAME}`);
  }
  const out: Finding[] = [];
  if (entries.length > 1) {
    out.push({
      file: MANIFEST_REL,
      issue:
        `marketplace.packages must list ${PKG_NAME} exactly once, ` +
        `found ${entries.length} entries`,
    });
  }
  for (const e of entries) {
    if (e.subdir !== PKG_SUBDIR) {
      out.push({
        file: MANIFEST_REL,
        issue:
          `marketplace entry subdir must be "${PKG_SUBDIR}", ` +
          `got ${JSON.stringify(e.subdir)}`,
      });
    }
    if (e.source !== MARKET_SOURCE) {
      out.push({
        file: MANIFEST_REL,
        issue:
          `marketplace entry source must be "${MARKET_SOURCE}", ` +
          `got ${JSON.stringify(e.source)}`,
      });
    }
    if (typeof e.category !== "string" || e.category.trim() === "") {
      out.push({
        file: MANIFEST_REL,
        issue: `marketplace entry category must be a non-empty string`,
      });
    }
  }
  return out;
}

/** The root lockfile records the local-path dependency `apm install`
 *  resolved — proof the registered package actually deploys. A missing
 *  or mislabeled entry means the lockfile is stale: regenerate with
 *  `mise exec -- apm install`, never hand-edit. */
export function checkLockfile(repoRoot: string): Finding[] {
  const fail = (issue: string): Finding[] => [{ file: LOCKFILE_REL, issue }];
  const abs = path.join(repoRoot, LOCKFILE_REL);
  if (!fs.existsSync(abs)) {
    return fail(`${LOCKFILE_REL} missing — run \`mise exec -- apm install\``);
  }
  let doc: unknown;
  try {
    doc = load(fs.readFileSync(abs, "utf8"));
  } catch (e) {
    return fail(`${LOCKFILE_REL} is not valid YAML: ${errMsg(e)}`);
  }
  const deps = asRecord(doc)?.dependencies;
  if (!Array.isArray(deps)) {
    return fail(`${LOCKFILE_REL} dependencies is missing or not a list`);
  }
  const matches = deps.filter(
    (d) => asRecord(d)?.local_path === DEP_ENTRY,
  ) as Array<Record<string, unknown>>;
  if (matches.length === 0) {
    return fail(
      `${LOCKFILE_REL} has no dependencies entry with local_path ` +
        `"${DEP_ENTRY}" — regenerate via \`mise exec -- apm install\``,
    );
  }
  const out: Finding[] = [];
  for (const d of matches) {
    if (d.name !== PKG_NAME) {
      out.push({
        file: LOCKFILE_REL,
        issue:
          `lockfile entry for "${DEP_ENTRY}" must name package ` +
          `"${PKG_NAME}", got ${JSON.stringify(d.name)}`,
      });
    }
  }
  return out;
}

/** The registered directory must exist — a dangling marketplace listing
 *  breaks every consumer install. */
export function checkPackageDir(repoRoot: string): Finding[] {
  const abs = path.join(repoRoot, PKG_SUBDIR);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return [
      { file: PKG_SUBDIR, issue: `${PKG_SUBDIR} is missing or not a directory` },
    ];
  }
  return [];
}

/** All marketplace-registration assertions for one repo root — the
 *  directory carrying `apm.yml`, `apm.lock.yaml`, and `packages/`. */
export function runMarketplaceChecks(repoRoot: string): MarketplaceResult {
  let manifest: unknown;
  let manifestError: string | null = null;
  const abs = path.join(repoRoot, MANIFEST_REL);
  if (!fs.existsSync(abs)) {
    manifestError = `${MANIFEST_REL} missing`;
  } else {
    try {
      manifest = load(fs.readFileSync(abs, "utf8"));
    } catch (e) {
      manifestError = `${MANIFEST_REL} is not valid YAML: ${errMsg(e)}`;
    }
  }
  // Both manifest-bound groups report the same load failure — neither
  // assertion can hold against an unreadable manifest.
  const loadFail: Finding[] =
    manifestError === null ? [] : [{ file: MANIFEST_REL, issue: manifestError }];
  return {
    deps: manifestError === null ? checkDeps(manifest) : loadFail,
    marketplace:
      manifestError === null ? checkMarketplace(manifest) : loadFail,
    lockfile: checkLockfile(repoRoot),
    packageDir: checkPackageDir(repoRoot),
  };
}

export function hasMarketplaceFailures(r: MarketplaceResult): boolean {
  return (
    r.deps.length +
      r.marketplace.length +
      r.lockfile.length +
      r.packageDir.length >
    0
  );
}

// src/ → scripts/pstack-devin/ → scripts/ → repo root.
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const MAX_LISTED = 20;

function report(kind: string, items: Finding[]): void {
  if (items.length === 0) return;
  console.log(`${kind}: ${items.length} findings`);
  for (const f of items.slice(0, MAX_LISTED)) {
    console.log(`  ${f.file}: ${f.issue}`);
  }
  if (items.length > MAX_LISTED) {
    console.log(`  ... and ${items.length - MAX_LISTED} more`);
  }
}

function main(argv: string[]): void {
  const unknown = argv.find((a) => a.startsWith("--"));
  if (unknown !== undefined) {
    throw new Error(`unknown argument: ${unknown} (usage: none)`);
  }
  const r = runMarketplaceChecks(repoRoot);

  report("deps", r.deps);
  report("marketplace", r.marketplace);
  report("lockfile", r.lockfile);
  report("packageDir", r.packageDir);

  console.log(
    `check-marketplace: deps ${r.deps.length}, ` +
      `marketplace ${r.marketplace.length}, lockfile ${r.lockfile.length}, ` +
      `packageDir ${r.packageDir.length}`,
  );
  if (hasMarketplaceFailures(r)) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
